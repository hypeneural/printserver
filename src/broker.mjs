// Durable single-process HTTP print queue. Operator/MCP and Windows agent have separate tokens.
// Never stores CRM credentials and never changes orders or sends customer messages.
import http from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {labelPdf} from './pdf.mjs';
import {crmPngToLabelPdf} from './crm-label-pdf.mjs';

const MAX_JOBS=500;
// Backpressure: pending CRMs PNG/PDF are much larger than the legacy text labels.
// Do not serialize an unbounded set of raster PDFs every time the agent polls.
const DEFAULT_MAX_PENDING_PDF_BASE64=32*1024*1024;
// Opt-in: refuse outdated plain labels during Christmas rollout.
const REQUIRE_CRM_ARTWORK=process.env.PRINTSERVER_REQUIRE_CRM_ARTWORK==='1';
const MAX_PNG_BASE64=4*1024*1024;
const ALLOWED_STATUS='waiting_product_retrieve';
const LABEL_PURPOSES=new Set(['arrival','order_label']);
const JOB_STATES=new Set(['queued','claimed','spooled','expired','failed','unknown']);
const REPLAYABLE_STATES=new Set(['queued','claimed','spooled']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validOrderId=id=>Number.isSafeInteger(id)&&id>0&&id<=2147483647;
const validStatusMetadata=value=>value===null||(typeof value==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value));
const fail=(status,error)=>Object.assign(new Error(error),{status});
const validSecret=t=>typeof t==='string'&&t.length>=32&&t.length<=256&&!/\s/.test(t);
const hash=b=>createHash('sha256').update(b).digest('hex');
const safeEqual=(a,b)=>{
 if(!validSecret(b)||typeof a!=='string'||a.length>300)return false;
 return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
};
const validOrder=body=>(
 body&&validOrderId(body.order_id)&&
 typeof body.customer_name==='string'&&body.customer_name.trim().length>=2&&body.customer_name.length<=120&&
 (body.package_name==null||(typeof body.package_name==='string'&&body.package_name.length<=120))&&
 typeof body.operator_id==='string'&&/^[0-9]{1,12}$/.test(body.operator_id)&&
 typeof body.request_id==='string'&&uuid.test(body.request_id)&&
 body.confirmed_by_operator===true&&LABEL_PURPOSES.has(body.purpose)&&
 (body.purpose==='arrival'?body.status_key===ALLOWED_STATUS:validStatusMetadata(body.status_key))&&
 (body.label_png_base64===undefined||(
  typeof body.label_png_base64==='string'&&body.label_png_base64.length<=MAX_PNG_BASE64&&
  /^[A-Za-z0-9+/]+={0,2}$/.test(body.label_png_base64)&&
  body.label_source==='crm_canonical'&&
  typeof body.label_png_sha256==='string'&&/^[0-9a-f]{64}$/.test(body.label_png_sha256)
 ))
);

// Durable receipts deliberately omit artwork, operator credentials and customer fields.
const publicJob=j=>({
 job_id:j.job_id,request_id:j.request_id,order_id:j.order_id,
 state:j.state,render_source:j.render_source||'minimal',created_at:j.created_at,expires_at:j.expires_at,
 purpose:j.purpose||'arrival',
 status_key:Object.hasOwn(j,'status_key')?j.status_key:((j.purpose||'arrival')==='arrival'?ALLOWED_STATUS:null),
 ...(j.completed_at!==undefined?{completed_at:j.completed_at}:{}),
 ...(j.error_code?{error_code:j.error_code}:{})
});
const validReceipt=r=>r&&validOrderId(r.order_id)&&uuid.test(r.job_id||'')&&uuid.test(r.request_id||'')&&
 JOB_STATES.has(r.state)&&LABEL_PURPOSES.has(r.purpose)&&
 (r.purpose==='arrival'?r.status_key===ALLOWED_STATUS:validStatusMetadata(r.status_key))&&
 ['minimal','crm_canonical'].includes(r.render_source)&&
 Number.isSafeInteger(r.created_at)&&r.created_at>=0&&Number.isSafeInteger(r.expires_at)&&r.expires_at>=0&&
 (r.completed_at===undefined||(Number.isSafeInteger(r.completed_at)&&r.completed_at>=0))&&
 (r.error_code===undefined||(typeof r.error_code==='string'&&/^[a-z_]{1,80}$/.test(r.error_code)));

export async function makeBroker({file,adminToken,agentToken,now=()=>Date.now(),requireCrmArtwork=REQUIRE_CRM_ARTWORK,maxPendingPdfBase64=DEFAULT_MAX_PENDING_PDF_BASE64}){
 if(!validSecret(adminToken)||!validSecret(agentToken)||safeEqual(adminToken,agentToken)){
  throw Error('printserver_missing_or_reused_secrets');
 }
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 let jobs,seenArrivalOrders=new Set(),receipts=new Map(),receiptsDirty=false;
 const remember=job=>{
  const receipt=publicJob(job);
  if(!validReceipt(receipt))throw Error('invalid_order_label_receipt');
  if(JSON.stringify(receipts.get(job.order_id))!==JSON.stringify(receipt)){
   receipts.set(job.order_id,receipt);receiptsDirty=true;
  }
 };
 try{
  const obj=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(obj.jobs))throw Error('invalid_jobs');
  jobs=obj.jobs;
  if(obj.seen_arrival_orders!==undefined&&(!Array.isArray(obj.seen_arrival_orders)||obj.seen_arrival_orders.some(id=>!Number.isSafeInteger(id)||id<1)))throw Error('invalid_seen_arrival_orders');
  seenArrivalOrders=new Set(obj.seen_arrival_orders||[]);
  if(obj.order_label_receipts!==undefined&&!Array.isArray(obj.order_label_receipts))throw Error('invalid_order_label_receipts');
  for(const input of obj.order_label_receipts||[]){
   if(!validReceipt(input)||receipts.has(input.order_id))throw Error('invalid_order_label_receipts');
   const receipt=publicJob(input);receipts.set(receipt.order_id,receipt);seenArrivalOrders.add(receipt.order_id);
  }
  for(const job of jobs)if(LABEL_PURPOSES.has(job.purpose)&&validOrderId(job.order_id)){
   const previous=receipts.get(job.order_id);
   // A mismatched snapshot must never regress a completed receipt to queued work.
   if(previous&&JSON.stringify(previous)!==JSON.stringify(publicJob(job)))throw Error('conflicting_order_label_receipts');
   seenArrivalOrders.add(job.order_id);remember(job);
  }
 }catch(e){if(e.code==='ENOENT')jobs=[];else throw e}
 let lastAgentPollAt=null;
 let serial=Promise.resolve();
 const exclusive=fn=>{
  const p=serial.then(fn);
  serial=p.then(()=>{},()=>{});
  return p;
 };
 const save=async()=>{
  const tmp=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';
  try{
   await writeFile(tmp,JSON.stringify({version:2,jobs,seen_arrival_orders:[...seenArrivalOrders],order_label_receipts:[...receipts.values()]}),{mode:0o600,flag:'wx',flush:true});
   await rename(tmp,file);
   receiptsDirty=false;
  }finally{
   // A disk error must not leave orphan temporary snapshots containing customer data.
   await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e});
  }
 };
 // Snapshot one job, not the entire queue, to keep the 5-second agent poll cheap.
 const persistJobMutation=async(job,mutate)=>{
  const before={...job},beforeReceipt=receipts.get(job.order_id),beforeDirty=receiptsDirty;
  try{mutate();remember(job);await save()}
  catch(e){
   // Never expose an ACK or claim that was not committed to disk.
   for(const key of Object.keys(job))delete job[key];
   Object.assign(job,before);
   if(beforeReceipt)receipts.set(job.order_id,beforeReceipt);else receipts.delete(job.order_id);
   receiptsDirty=beforeDirty;
   throw e;
  }
 };
 const persistPrune=async()=>{
  // Expiration/deletion must not remain visible in memory if its disk write fails.
  const snapshot=jobs.map(j=>({...j})),beforeReceipts=new Map(receipts),beforeDirty=receiptsDirty;
  if(!prune())return;
  try{await save()}catch(e){jobs=snapshot;receipts=beforeReceipts;receiptsDirty=beforeDirty;throw e}
 };
  const prune=()=>{
  const ts=now();
  let changed=false;
  for(const j of jobs){
   if(j.state==='queued'&&j.expires_at<=ts){j.state='expired';delete j.pdf_base64;changed=true}
   if(j.state==='claimed'&&j.lease_expires_at<=ts){j.state='unknown';delete j.pdf_base64;delete j.lease_token;changed=true}
   if(LABEL_PURPOSES.has(j.purpose))remember(j);
  }
  // Retain tiny per-order tombstones indefinitely; purge large job payload metadata after 7 days.
  const before=jobs.length;
  jobs=jobs.filter(j=>j.state==='queued'||j.state==='claimed'||j.created_at>=ts-7*864e5);
  return changed||jobs.length!==before||receiptsDirty;
 };
 const orderLookup=orderId=>{
  const receipt=receipts.get(orderId);
  const missingActiveJob=receipt&&['queued','claimed'].includes(receipt.state)&&!jobs.some(j=>j.job_id===receipt.job_id);
  return {
   order_id:orderId,state:receipt?.state||(seenArrivalOrders.has(orderId)?'not_verified':'not_requested'),
   job:receipt?publicJob(receipt):null,
   needs_reconciliation:Boolean(receipt
    ? !REPLAYABLE_STATES.has(receipt.state)||missingActiveJob||(requireCrmArtwork&&receipt.render_source!=='crm_canonical')
    : seenArrivalOrders.has(orderId)),
   printed_physically:false
  };
 };
 // Idle poll/GET never writes to disk unless state has actually changed.
 const sweeper=setInterval(()=>{void exclusive(persistPrune).catch(()=>{})},60000);
 sweeper.unref();
 const respond=(res,status,obj)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
 };
 const readJson=async(req,maxBytes=8192)=>{
  let size=0,buf='';
  for await(const c of req){
   size+=c.length;
   if(size>maxBytes)throw fail(413,'body_too_large');
   buf+=c.toString('utf8');
  }
  try{return JSON.parse(buf||'{}')}catch{throw fail(400,'invalid_json')}
 };
 async function handle(req,res){
  try{
   if(req.method==='GET'&&req.url==='/healthz')return respond(res,200,{ok:true,service:'evydencia-printserver',
    capabilities:{independent_order_labels:true,order_label_receipts:true}});
   const u=new URL(req.url,'http://localhost');
   const role=u.pathname.startsWith('/v1/agent/')&&u.pathname!=='/v1/agent/status'?'agent':'admin';
   const expected=role==='agent'?agentToken:adminToken;
   const auth=req.headers.authorization||'';
   if(!safeEqual(auth.startsWith('Bearer ')?auth.slice(7):'',expected))throw fail(401,'unauthorized');
   if(req.method==='GET'&&u.pathname==='/v1/agent/status'&&role==='admin'){
    // Transient signal derived from authenticated polls; no PII and no disk writes.
    // Agent polls only while printer and spooler report ready. A reboot starts offline.
    const age=lastAgentPollAt===null?null:Math.max(0,now()-lastAgentPollAt);
    return respond(res,200,{
     agent_online:age!==null&&age<=30000,
     agent_poll_age_seconds:age===null?null:Math.floor(age/1000),
     status_source:'authenticated_agent_poll',
     physical_print_verified:false
    });
   }
   const lookupPath=/^\/v1\/orders\/([^/]+)\/label-job$/.exec(u.pathname);
   if(req.method==='GET'&&lookupPath&&role==='admin'){
    const raw=lookupPath[1],orderId=Number(raw);
    if(!/^[1-9]\d*$/.test(raw)||!validOrderId(orderId))throw fail(400,'invalid_order_id');
    return await exclusive(async()=>{await persistPrune();return respond(res,200,orderLookup(orderId))});
   }
      if(req.method==='POST'&&u.pathname==='/v1/jobs'&&role==='admin'){
    const body=await readJson(req,MAX_PNG_BASE64+8192);
    if(!validOrder(body))throw fail(422,'invalid_or_unconfirmed_order');
    if(requireCrmArtwork&&!body.label_png_base64)throw fail(422,'crm_artwork_required');
    return await exclusive(async()=>{
     await persistPrune();
     const existing=receipts.get(body.order_id);
     if(existing){
      // A previously spooled MINIMAL label must never be reported as a successful
      // replay of the canonical Christmas artwork during the strict rollout.
      // The tombstone still wins: never enqueue a second physical label here.
      if(orderLookup(body.order_id).needs_reconciliation)
       return respond(res,409,{error:'manual_reconciliation_required',job:publicJob(existing)});
      return respond(res,200,{replay:true,job:publicJob(existing)});
     }
     if(seenArrivalOrders.has(body.order_id))return respond(res,409,{error:'manual_reconciliation_required',job:null});
     if(jobs.length>=MAX_JOBS)throw fail(503,'queue_full');
     let pdf,renderSource='minimal';
     if(body.label_png_base64){
      const png=Buffer.from(body.label_png_base64,'base64');
      if(png.toString('base64')!==body.label_png_base64||hash(png)!==body.label_png_sha256)throw fail(422,'invalid_crm_png_hash');
      try{pdf=crmPngToLabelPdf(png)}catch{throw fail(422,'invalid_crm_label_png')}
      renderSource='crm_canonical';
     }else pdf=labelPdf(body);
     const ts=now();
     const job={
      job_id:randomUUID(),request_id:body.request_id,order_id:body.order_id,
      operator_id:body.operator_id,purpose:body.purpose,status_key:body.status_key,render_source:renderSource,created_at:ts,
      expires_at:ts+15*60*1000,state:'queued',
      pdf_base64:pdf.toString('base64'),sha256:hash(pdf)
     };
     // Includes leased jobs still awaiting ACK; never lose accepted work to memory pressure.
     const bytesPending=jobs.reduce((bytes,j)=>bytes+(typeof j.pdf_base64==='string'?j.pdf_base64.length:0),0);
     if(bytesPending+job.pdf_base64.length>maxPendingPdfBase64)throw fail(503,'queue_capacity_exceeded');
     jobs.push(job);
     seenArrivalOrders.add(body.order_id);
     const beforeReceipt=receipts.get(body.order_id),beforeDirty=receiptsDirty;
     try{
      remember(job);
      await save();
     }catch(e){
      // If persistence fails, never leave an uncommitted job claimable by the agent.
      jobs.pop();
      seenArrivalOrders.delete(body.order_id);
      if(beforeReceipt)receipts.set(body.order_id,beforeReceipt);else receipts.delete(body.order_id);
      receiptsDirty=beforeDirty;
      throw e;
     }
     return respond(res,201,{replay:false,job:publicJob(job)});
    });
   }
   if(req.method==='GET'&&u.pathname.startsWith('/v1/jobs/')&&role==='admin'){
    const id=decodeURIComponent(u.pathname.slice('/v1/jobs/'.length));
    if(!uuid.test(id))throw fail(400,'invalid_job_id');
    return await exclusive(async()=>{
     await persistPrune();
     const job=jobs.find(x=>x.job_id===id);
     return job?respond(res,200,{job:publicJob(job)}):respond(res,404,{error:'not_found'});
    });
   }
   if(req.method==='POST'&&u.pathname==='/v1/agent/claim'){
    // No request arguments: agents cannot choose arbitrary data to print.
    await readJson(req);
    return await exclusive(async()=>{
     await persistPrune();
     lastAgentPollAt=now();
     const job=jobs.find(x=>x.state==='queued');
     if(!job)return respond(res,200,{job:null});
     await persistJobMutation(job,()=>{
      job.state='claimed';
      job.lease_token=randomBytes(32).toString('hex');
      job.lease_expires_at=now()+120000;
     });
     return respond(res,200,{job:{
      job_id:job.job_id,lease_token:job.lease_token,
      pdf_base64:job.pdf_base64,sha256:job.sha256,expires_at:job.expires_at
     }});
    });
   }
   if(req.method==='POST'&&u.pathname==='/v1/agent/ack'){
    const body=await readJson(req);
    if(!uuid.test(body.job_id||'')||!['spooled','failed','unknown'].includes(body.result)||typeof body.lease_token!=='string')throw fail(422,'invalid_ack');
    return await exclusive(async()=>{
     const job=jobs.find(x=>x.job_id===body.job_id);
     if(!job||job.state!=='claimed'||!safeEqual(body.lease_token,job.lease_token))throw fail(409,'lease_invalid_or_unknown');
     await persistJobMutation(job,()=>{
      job.state=body.result;
      job.completed_at=now();
      if(job.state==='failed')job.error_code='local_print_failed';
      if(job.state==='unknown')job.error_code='print_result_uncertain';
      delete job.pdf_base64;
      delete job.lease_token;
     });
     return respond(res,200,{job:publicJob(job)});
    });
   }
   return respond(res,404,{error:'not_found'});
  }catch(e){return respond(res,e.status||500,{error:e.status?e.message:'internal_error'})}
 }
 return {handle,listen:(port=0,host='127.0.0.1')=>new Promise(resolve=>{
  const server=http.createServer((req,res)=>void handle(req,res));
  server.listen(port,host,()=>resolve(server));
 })};
}
