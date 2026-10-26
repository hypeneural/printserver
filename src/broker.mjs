// Durable single-process HTTP print queue. Operator/MCP and Windows agent have separate tokens.
// Never stores CRM credentials and never changes orders or sends customer messages.
import http from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {labelPdf} from './pdf.mjs';

const MAX_JOBS=500;
const ALLOWED_STATUS='waiting_product_retrieve';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status,error)=>Object.assign(new Error(error),{status});
const validSecret=t=>typeof t==='string'&&t.length>=32&&t.length<=256&&!/\s/.test(t);
const hash=b=>createHash('sha256').update(b).digest('hex');
const safeEqual=(a,b)=>{
 if(!validSecret(b)||typeof a!=='string'||a.length>300)return false;
 return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
};
const validOrder=body=>(
 body&&Number.isSafeInteger(body.order_id)&&body.order_id>0&&body.order_id<=2147483647&&
 typeof body.customer_name==='string'&&body.customer_name.trim().length>=2&&body.customer_name.length<=120&&
 (body.package_name==null||(typeof body.package_name==='string'&&body.package_name.length<=120))&&
 typeof body.operator_id==='string'&&/^[0-9]{1,12}$/.test(body.operator_id)&&
 typeof body.request_id==='string'&&uuid.test(body.request_id)&&
 body.status_key===ALLOWED_STATUS&&body.confirmed_by_operator===true&&
 body.purpose==='arrival'
);

export async function makeBroker({file,adminToken,agentToken,now=()=>Date.now()}){
 if(!validSecret(adminToken)||!validSecret(agentToken)||safeEqual(adminToken,agentToken)){
  throw Error('printserver_missing_or_reused_secrets');
 }
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 let jobs;
 try{
  const obj=JSON.parse(await readFile(file,'utf8'));
  if(!Array.isArray(obj.jobs))throw Error('invalid_jobs');
  jobs=obj.jobs;
 }catch(e){if(e.code==='ENOENT')jobs=[];else throw e}
 let serial=Promise.resolve();
 const exclusive=fn=>{
  const p=serial.then(fn);
  serial=p.then(()=>{},()=>{});
  return p;
 };
 const save=async()=>{
  const tmp=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';
  await writeFile(tmp,JSON.stringify({version:1,jobs}),{mode:0o600,flag:'wx'});
  await rename(tmp,file);
 };
 const publicJob=j=>({
  job_id:j.job_id,request_id:j.request_id,order_id:j.order_id,
  state:j.state,created_at:j.created_at,expires_at:j.expires_at,
  ...(j.completed_at?{completed_at:j.completed_at}:{}),
  ...(j.error_code?{error_code:j.error_code}:{})
 });
 const prune=()=>{
  const ts=now();
  for(const j of jobs){
   if(j.state==='queued'&&j.expires_at<=ts){j.state='expired';delete j.pdf_base64}
   if(j.state==='claimed'&&j.lease_expires_at<=ts){j.state='unknown';delete j.pdf_base64}
  }
  if(jobs.length>MAX_JOBS)jobs=jobs.filter(j=>j.state==='queued'||j.state==='claimed'||j.created_at>=ts-7*864e5).slice(-MAX_JOBS);
 };
 const respond=(res,status,obj)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
 };
 const readJson=async(req)=>{
  let size=0,buf='';
  for await(const c of req){
   size+=c.length;
   if(size>8192)throw fail(413,'body_too_large');
   buf+=c.toString('utf8');
  }
  try{return JSON.parse(buf||'{}')}catch{throw fail(400,'invalid_json')}
 };
 async function handle(req,res){
  try{
   if(req.method==='GET'&&req.url==='/healthz')return respond(res,200,{ok:true,service:'evydencia-printserver'});
   const u=new URL(req.url,'http://localhost');
   const role=u.pathname.startsWith('/v1/agent/')?'agent':'admin';
   const expected=role==='agent'?agentToken:adminToken;
   const auth=req.headers.authorization||'';
   if(!safeEqual(auth.startsWith('Bearer ')?auth.slice(7):'',expected))throw fail(401,'unauthorized');
   if(req.method==='POST'&&u.pathname==='/v1/jobs'&&role==='admin'){
    const body=await readJson(req);
    if(!validOrder(body))throw fail(422,'invalid_or_unconfirmed_order');
    return await exclusive(async()=>{
     prune();
     const existing=jobs.find(j=>j.purpose==='arrival'&&j.order_id===body.order_id);
     if(existing){
      if(existing.state==='expired'||existing.state==='failed'||existing.state==='unknown')return respond(res,409,{error:'manual_reconciliation_required',job:publicJob(existing)});
      return respond(res,200,{replay:true,job:publicJob(existing)});
     }
     if(jobs.length>=MAX_JOBS)throw fail(503,'queue_full');
     const pdf=labelPdf(body);
     const ts=now();
     const job={
      job_id:randomUUID(),request_id:body.request_id,order_id:body.order_id,
      operator_id:body.operator_id,purpose:'arrival',created_at:ts,
      expires_at:ts+15*60*1000,state:'queued',
      pdf_base64:pdf.toString('base64'),sha256:hash(pdf)
     };
     jobs.push(job);await save();
     return respond(res,201,{replay:false,job:publicJob(job)});
    });
   }
   if(req.method==='GET'&&u.pathname.startsWith('/v1/jobs/')&&role==='admin'){
    const id=decodeURIComponent(u.pathname.slice('/v1/jobs/'.length));
    if(!uuid.test(id))throw fail(400,'invalid_job_id');
    return await exclusive(async()=>{
     prune();await save();
     const job=jobs.find(x=>x.job_id===id);
     return job?respond(res,200,{job:publicJob(job)}):respond(res,404,{error:'not_found'});
    });
   }
   if(req.method==='POST'&&u.pathname==='/v1/agent/claim'){
    // No request arguments: agents cannot choose arbitrary data to print.
    await readJson(req);
    return await exclusive(async()=>{
     prune();
     const job=jobs.find(x=>x.state==='queued');
     if(!job){await save();return respond(res,200,{job:null})}
     job.state='claimed';job.lease_token=randomBytes(32).toString('hex');job.lease_expires_at=now()+120000;
     await save();
     return respond(res,200,{job:{
      job_id:job.job_id,lease_token:job.lease_token,
      pdf_base64:job.pdf_base64,sha256:job.sha256,expires_at:job.expires_at
     }});
    });
   }
   if(req.method==='POST'&&u.pathname==='/v1/agent/ack'){
    const body=await readJson(req);
    if(!uuid.test(body.job_id||'')||!['spooled','failed'].includes(body.result)||typeof body.lease_token!=='string')throw fail(422,'invalid_ack');
    return await exclusive(async()=>{
     const job=jobs.find(x=>x.job_id===body.job_id);
     if(!job||job.state!=='claimed'||!safeEqual(body.lease_token,job.lease_token))throw fail(409,'lease_invalid_or_unknown');
     job.state=body.result;job.completed_at=now();
     if(job.state==='failed')job.error_code='local_print_failed';
     delete job.pdf_base64;delete job.lease_token;await save();
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
