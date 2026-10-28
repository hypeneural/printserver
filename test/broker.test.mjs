import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {labelPdf} from '../src/pdf.mjs';
import {makeBroker} from '../src/broker.mjs';

const ADMIN='A'.repeat(45),AGENT='B'.repeat(45),RID='d83ed2db-f4f1-4a55-b632-61e246a22b38';
const data={order_id:5001,operator_id:'42',status_key:'waiting_product_retrieve',confirmed_by_operator:true,purpose:'arrival',request_id:RID,customer_name:'Cliente Sintético',package_name:'Pacote Teste'};
async function setup(options={}){
 const dir=await mkdtemp(join(tmpdir(),'evyd-printserver-'));
 const broker=await makeBroker({file:join(dir,'state.json'),adminToken:ADMIN,agentToken:AGENT,...options});
 const server=await broker.listen(0);
 const root='http://127.0.0.1:'+server.address().port;
 return {dir,root,close:async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}};
}
async function call(root,path,body,role='admin',method='POST'){
 const response=await fetch(root+path,{method,headers:{Authorization:'Bearer '+(role==='admin'?ADMIN:AGENT),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
 return {status:response.status,body:await response.json()};
}
test('PDF is 100x40 mm, ASCII-safe, and contains xref',()=>{
 const pdf=labelPdf(data).toString('latin1');
 assert.match(pdf,/%PDF-1.4/);
 assert.match(pdf,/MediaBox \[0 0 283.465 113.386\]/);
 assert.match(pdf,/PEDIDO #5001/);
 assert.match(pdf,/startxref/);
 assert.match(pdf,/%%EOF/);
});
test('queue enforces confirmed status 10 and distinct agent role',async()=>{
 const a=await setup();
 try{
  assert.equal((await call(a.root,'/v1/jobs',{...data,confirmed_by_operator:false})).status,422);
  assert.equal((await call(a.root,'/v1/jobs',{...data,status_key:'session_schedule'})).status,422);
  assert.equal((await call(a.root,'/v1/jobs',data,'agent')).status,401);
  assert.equal((await call(a.root,'/v1/jobs',data)).status,201);
  const duplicate=await call(a.root,'/v1/jobs',{...data,request_id:'70bca7a8-cdb7-4b8c-a2a8-68ebae46889e'});
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.body.replay,true);
  const claim=await call(a.root,'/v1/agent/claim',{},'agent');
  assert.equal(claim.status,200);
  assert.equal(claim.body.job.pdf_base64.slice(0,8),'JVBERi0x');
  const claimAgain=await call(a.root,'/v1/agent/claim',{},'agent');
  assert.equal(claimAgain.body.job,null);
  assert.equal((await call(a.root,'/v1/agent/ack',{job_id:claim.body.job.job_id,lease_token:'bad',result:'spooled'},'agent')).status,409);
  const ack=await call(a.root,'/v1/agent/ack',{job_id:claim.body.job.job_id,lease_token:claim.body.job.lease_token,result:'spooled'},'agent');
  assert.equal(ack.body.job.state,'spooled');
  assert.equal((await call(a.root,'/v1/agent/ack',{job_id:claim.body.job.job_id,lease_token:claim.body.job.lease_token,result:'spooled'},'agent')).status,409);
  assert.ok(!(await readFile(join(a.dir,'state.json'),'utf8')).includes('pdf_base64'));
 }finally{await a.close()}
});
test('queue is durable after restarting broker and never automatically reprints',async()=>{
 const a=await setup();
 try{
  const first=await call(a.root,'/v1/jobs',data);
  assert.equal(first.status,201);
  const b=await makeBroker({file:join(a.dir,'state.json'),adminToken:ADMIN,agentToken:AGENT});
  const s=await b.listen(0);
  try{
   const second=await call('http://127.0.0.1:'+s.address().port,'/v1/jobs',data);
   assert.equal(second.status,200);
   assert.equal(second.body.job.job_id,first.body.job.job_id);
  }finally{await new Promise(resolve=>s.close(resolve))}
 }finally{await a.close()}
});
test('dedup tombstone survives metadata pruning and process restart',async()=>{
 const a=await setup();
 try{
  const created=await call(a.root,'/v1/jobs',data);
  assert.equal(created.status,201);
  const future=Date.now()+8*864e5;
  const b=await makeBroker({file:join(a.dir,'state.json'),adminToken:ADMIN,agentToken:AGENT,now:()=>future});
  const srv=await b.listen(0);
  try{
   const root='http://127.0.0.1:'+srv.address().port;
   const old=await call(root,'/v1/jobs/'+created.body.job.job_id,null,'admin','GET');
   assert.equal(old.status,404);
   const retry=await call(root,'/v1/jobs',{...data,request_id:'70bca7a8-cdb7-4b8c-a2a8-68ebae46889e'});
   assert.equal(retry.status,409);
   const onDisk=JSON.parse(await readFile(join(a.dir,'state.json'),'utf8'));
   assert.ok(onDisk.seen_arrival_orders.includes(data.order_id));
   assert.ok(!onDisk.jobs.some(j=>j.order_id===data.order_id));
  }finally{await new Promise(resolve=>srv.close(resolve))}
 }finally{await a.close()}
});
test('uncertain ACK is final and not retried',async()=>{
 const a=await setup();
 try{
  await call(a.root,'/v1/jobs',data);
  const claim=await call(a.root,'/v1/agent/claim',{},'agent');
  const ack=await call(a.root,'/v1/agent/ack',{job_id:claim.body.job.job_id,lease_token:claim.body.job.lease_token,result:'unknown'},'agent');
  assert.equal(ack.body.job.state,'unknown');
  assert.equal((await call(a.root,'/v1/agent/claim',{},'agent')).body.job,null);
  assert.equal((await call(a.root,'/v1/jobs',data)).status,409);
 }finally{await a.close()}
});
test('no secrets means fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-printserver-'));
 try{
  await assert.rejects(makeBroker({file:join(dir,'state.json'),adminToken:'short',agentToken:AGENT}),/secrets/);
  await assert.rejects(makeBroker({file:join(dir,'state.json'),adminToken:AGENT,agentToken:AGENT}),/secrets/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('persistence failure cannot make an uncommitted label claimable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-print-failed-save-'));
 const file=join(dir,'state.json');
 const broker=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT});
 const server=await broker.listen(0);
 const root='http://127.0.0.1:'+server.address().port;
 try{
  // Block the atomic rename by replacing destination with a directory.
  await mkdir(file);
  const rejected=await call(root,'/v1/jobs',data);
  assert.equal(rejected.status,500);
  assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job,null,
   'failed durable commit must not leave a printable in-memory job');
  const leftovers=await readdir(dir);
  assert.equal(leftovers.some(name=>name.includes('.tmp')),false,
   'temporary snapshots must not retain customer data');
  await rm(file,{recursive:true});
  const accepted=await call(root,'/v1/jobs',data);
  assert.equal(accepted.status,201);
  assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job.job_id,accepted.body.job.job_id);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
 }
});

test('failed claim commit never loses a queued job or exposes an uncommitted lease',async()=>{
 const a=await setup();
 const file=join(a.dir,'state.json'),backup=file+'.backup';
 try{
  const created=await call(a.root,'/v1/jobs',data);
  assert.equal(created.status,201);
  await rename(file,backup);await mkdir(file);
  const failed=await call(a.root,'/v1/agent/claim',{},'agent');
  assert.equal(failed.status,500);
  await rm(file,{recursive:true});await rename(backup,file);
  const claimed=await call(a.root,'/v1/agent/claim',{},'agent');
  assert.equal(claimed.status,200);
  assert.equal(claimed.body.job.job_id,created.body.job.job_id);
  assert.equal((await call(a.root,'/v1/agent/claim',{},'agent')).body.job,null);
 }finally{await a.close()}
});
test('failed acknowledgment commit retains lease and PDF until a confirmed ACK',async()=>{
 const a=await setup();
 const file=join(a.dir,'state.json'),backup=file+'.backup';
 try{
  await call(a.root,'/v1/jobs',data);
  const claimed=(await call(a.root,'/v1/agent/claim',{},'agent')).body.job;
  await rename(file,backup);await mkdir(file);
  const payload={job_id:claimed.job_id,lease_token:claimed.lease_token,result:'spooled'};
  const failed=await call(a.root,'/v1/agent/ack',payload,'agent');
  assert.equal(failed.status,500);
  await rm(file,{recursive:true});await rename(backup,file);
  const ok=await call(a.root,'/v1/agent/ack',payload,'agent');
  assert.equal(ok.status,200);
  assert.equal(ok.body.job.state,'spooled');
  const disk=await readFile(file,'utf8');
  assert.ok(!disk.includes('pdf_base64'));
  assert.ok(!disk.includes('lease_token'));
 }finally{await a.close()}
});
test('expired prune is rolled back when disk cannot commit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-prune-failure-'));
 const file=join(dir,'state.json'),backup=file+'.bak';
 const base=Date.now();
 let clock=base;
 const broker=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT,now:()=>clock});
 const server=await broker.listen(0);
 const root='http://127.0.0.1:'+server.address().port;
 try{
  const created=await call(root,'/v1/jobs',data);
  assert.equal(created.status,201);
  clock=base+16*60*1000;
  await rename(file,backup);await mkdir(file);
  const rejected=await call(root,'/v1/jobs/'+created.body.job.job_id,null,'admin','GET');
  assert.equal(rejected.status,500);
  await rm(file,{recursive:true});
  await rename(backup,file);
  clock=base;
  const stillQueued=await call(root,'/v1/jobs/'+created.body.job.job_id,null,'admin','GET');
  assert.equal(stillQueued.status,200);
  assert.equal(stillQueued.body.job.state,'queued','failed cleanup must preserve prior state');
 }finally{await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true})}
});
test('agent heartbeat is short-lived, read-only, and admin-token only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-agent-health-'));
 let clock=Date.now();
 const broker=await makeBroker({file:join(dir,'state.json'),adminToken:ADMIN,agentToken:AGENT,now:()=>clock});
 const server=await broker.listen(0);
 const root='http://127.0.0.1:'+server.address().port;
 try{
  const before=await call(root,'/v1/agent/status',null,'admin','GET');
  assert.equal(before.status,200);
  assert.equal(before.body.agent_online,false);
  assert.equal(before.body.agent_poll_age_seconds,null);
  assert.equal((await call(root,'/v1/agent/status',null,'agent','GET')).status,401);
  const claimed=await call(root,'/v1/agent/claim',{},'agent');
  assert.equal(claimed.status,200);
  assert.equal(claimed.body.job,null);
  const online=await call(root,'/v1/agent/status',null,'admin','GET');
  assert.equal(online.body.agent_online,true);
  assert.equal(online.body.agent_poll_age_seconds,0);
  clock+=31000;
  const offline=await call(root,'/v1/agent/status',null,'admin','GET');
  assert.equal(offline.body.agent_online,false);
  assert.equal(offline.body.agent_poll_age_seconds,31);
  assert.equal((await readFile(join(dir,'state.json'),'utf8').catch(()=>'')),'' ,
   'empty queue heartbeat must not persist sensitive state');
 }finally{await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true})}
});
test('very long uppercase text is bounded within calibrated printable width',()=>{
 const pdf=labelPdf({...data,customer_name:'W'.repeat(120),package_name:'W'.repeat(120)}).toString('latin1');
 assert.match(pdf,/\(W{22}\) Tj/);
 assert.match(pdf,/\(W{27}\) Tj/);
 assert.doesNotMatch(pdf,/\(W{28,}\) Tj/);
});

test('independent labels accept real commercial status without changing legacy arrival guard',async()=>{
 const a=await setup();
 try{
  const keys=['session_schedule','selection_schedule_confirmed','order_aborted','chargeback',null];
  for(const [offset,status_key]of keys.entries()){
   const order_id=data.order_id+offset;
   const request={...data,order_id,status_key,purpose:'order_label',remaining_cents:9000};
   const created=await call(a.root,'/v1/jobs',request);
   assert.equal(created.status,201,'label dispatch must not require paid/ready status');
   assert.equal(created.body.job.status_key,status_key);
   assert.equal(created.body.job.purpose,'order_label');
  }
  assert.equal((await call(a.root,'/v1/jobs',{...data,order_id:6000,status_key:'session_schedule'})).status,422);
  assert.equal((await call(a.root,'/v1/jobs',{...data,order_id:6000,purpose:'order_label',confirmed_by_operator:false})).status,422);
  assert.equal((await call(a.root,'/v1/jobs',{...data,order_id:6000,purpose:'order_label'},'agent')).status,401);
 }finally{await a.close()}
});

test('independent order lookup is authenticated, validates IDs and does not claim missing history as printed',async()=>{
 const a=await setup();
 try{
  const absent=await call(a.root,'/v1/orders/6001/label-job',null,'admin','GET');
  assert.equal(absent.status,200);
  assert.deepEqual(absent.body,{order_id:6001,state:'not_requested',job:null,needs_reconciliation:false,printed_physically:false});
  assert.equal((await call(a.root,'/v1/orders/6001/label-job',null,'agent','GET')).status,401);
  assert.equal((await call(a.root,'/v1/orders/0/label-job',null,'admin','GET')).status,400);
  assert.equal((await call(a.root,'/v1/orders/2147483648/label-job',null,'admin','GET')).status,400);
  assert.equal(await readFile(join(a.dir,'state.json'),'utf8').catch(()=>''),'','empty read must not manufacture queue state');
  const health=await fetch(a.root+'/healthz').then(r=>r.json());
  assert.deepEqual(health.capabilities,{independent_order_labels:true,order_label_receipts:true});
 }finally{await a.close()}
});

test('shared-origin capabilities use an admin-only v1 route without changing health or queue state',async()=>{
 const a=await setup();
 try{
  const expected={service:'evydencia-printserver',capabilities:{independent_order_labels:true,order_label_receipts:true}};
  const capabilities=await call(a.root,'/v1/capabilities',null,'admin','GET');
  assert.equal(capabilities.status,200);
  assert.deepEqual(capabilities.body,expected);
  assert.equal((await call(a.root,'/v1/capabilities',null,'agent','GET')).status,401);
  assert.equal((await fetch(a.root+'/v1/capabilities')).status,401);
  assert.equal((await call(a.root,'/v1/capabilities',{},'admin','POST')).status,404);
  const health=await fetch(a.root+'/healthz');
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{ok:true,...expected});
  assert.equal(await readFile(join(a.dir,'state.json'),'utf8').catch(()=>''),'','capability reads must not create queue state');
 }finally{await a.close()}
});

test('independent labels deduplicate across purposes and concurrent callers',async()=>{
 const a=await setup();
 try{
  const requests=await Promise.all(Array.from({length:8},(_,i)=>call(a.root,'/v1/jobs',{
   ...data,purpose:i%2?'arrival':'order_label',request_id:RID
  })));
  assert.equal(requests.filter(r=>r.status===201).length,1);
  assert.equal(requests.filter(r=>r.status===200&&r.body.replay).length,7);
  assert.equal(new Set(requests.map(r=>r.body.job.job_id)).size,1);
  const disk=JSON.parse(await readFile(join(a.dir,'state.json'),'utf8'));
  assert.equal(disk.jobs.length,1);
  assert.equal(disk.order_label_receipts.length,1);
  assert.equal(disk.order_label_receipts[0].job_id,requests[0].body.job.job_id);
  assert.equal((await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET')).body.state,'queued');
 }finally{await a.close()}
});

test('independent print receipt survives spool ACK, metadata pruning and restart without another job',async()=>{
 let clock=Date.now();
 const a=await setup({now:()=>clock});
 try{
  const created=await call(a.root,'/v1/jobs',{...data,purpose:'order_label',status_key:'session_schedule'});
  assert.equal(created.status,201);
  const claim=(await call(a.root,'/v1/agent/claim',{},'agent')).body.job;
  await call(a.root,'/v1/agent/ack',{job_id:claim.job_id,lease_token:claim.lease_token,result:'spooled'},'agent');
  clock+=8*864e5;
  const lookup=await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.equal(lookup.status,200);
  assert.equal(lookup.body.state,'spooled');
  assert.equal(lookup.body.needs_reconciliation,false);
  assert.equal(lookup.body.printed_physically,false);
  assert.equal(lookup.body.job.job_id,created.body.job.job_id);
  assert.equal((await call(a.root,'/v1/jobs/'+claim.job_id,null,'admin','GET')).status,404,'existing job-ID lookup retention is unchanged');
  const disk=JSON.parse(await readFile(join(a.dir,'state.json'),'utf8'));
  assert.equal(disk.jobs.length,0);
  const receipt=disk.order_label_receipts[0];
  assert.equal(receipt.state,'spooled');
  assert.equal(receipt.status_key,'session_schedule','receipt must preserve real metadata, not status10');
  for(const field of ['customer_name','package_name','operator_id','pdf_base64','lease_token','label_png_base64'])assert.equal(field in receipt,false);
  const b=await makeBroker({file:join(a.dir,'state.json'),adminToken:ADMIN,agentToken:AGENT,now:()=>clock});
  const s=await b.listen(0);
  try{
   const root='http://127.0.0.1:'+s.address().port;
   const repeated=await call(root,'/v1/jobs',data);
   assert.equal(repeated.status,200);
   assert.equal(repeated.body.replay,true);
   assert.equal(repeated.body.job.job_id,claim.job_id);
   assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job,null);
  }finally{await new Promise(done=>s.close(done))}
 }finally{await a.close()}
});

test('independent lookup preserves legacy tombstones as not_verified and never requeues them',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-legacy-tombstone-'));
 const file=join(dir,'state.json');
 await writeFile(file,JSON.stringify({version:2,jobs:[],seen_arrival_orders:[data.order_id]}));
 const b=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT});
 const s=await b.listen(0);const root='http://127.0.0.1:'+s.address().port;
 try{
  const lookup=await call(root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.deepEqual(lookup.body,{order_id:5001,state:'not_verified',job:null,needs_reconciliation:true,printed_physically:false});
  assert.equal((await call(root,'/v1/jobs',{...data,purpose:'order_label',status_key:'order_aborted'})).status,409);
  assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job,null);
 }finally{await new Promise(done=>s.close(done));await rm(dir,{recursive:true,force:true})}
});

test('independent migration retains existing legacy job receipt after expiration and pruning',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-legacy-job-'));
 const file=join(dir,'state.json');let clock=Date.now();
 await writeFile(file,JSON.stringify({version:2,jobs:[{...data,job_id:RID,state:'queued',created_at:clock,expires_at:clock+1000,pdf_base64:'synthetic'}],seen_arrival_orders:[data.order_id]}));
 const b=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT,now:()=>clock});
 const s=await b.listen(0);const root='http://127.0.0.1:'+s.address().port;
 try{
  clock+=8*864e5;
  const lookup=await call(root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.equal(lookup.body.state,'expired');
  assert.equal(lookup.body.needs_reconciliation,true);
  const disk=JSON.parse(await readFile(file,'utf8'));
  assert.equal(disk.jobs.length,0);
  assert.equal(disk.order_label_receipts[0].state,'expired');
  assert.equal(disk.order_label_receipts[0].job_id,RID);
  assert.equal((await call(root,'/v1/jobs',{...data,purpose:'order_label'})).status,409);
 }finally{await new Promise(done=>s.close(done));await rm(dir,{recursive:true,force:true})}
});

test('independent lookup retains timeout and failed receipts as manual reconciliation',async()=>{
 for(const terminal of ['unknown','failed']){
  const a=await setup();
  try{
   await call(a.root,'/v1/jobs',{...data,purpose:'order_label'});
   const claim=(await call(a.root,'/v1/agent/claim',{},'agent')).body.job;
   assert.equal((await call(a.root,'/v1/agent/ack',{job_id:claim.job_id,lease_token:claim.lease_token,result:terminal},'agent')).status,200);
   const lookup=await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET');
   assert.equal(lookup.body.state,terminal);
   assert.equal(lookup.body.needs_reconciliation,true);
   assert.equal((await call(a.root,'/v1/jobs',data)).status,409);
  }finally{await a.close()}
 }
});

test('independent failed persistence rolls back receipt creation and ACK state',async()=>{
 const a=await setup();const file=join(a.dir,'state.json'),backup=file+'.bak';
 try{
  await mkdir(file);
  assert.equal((await call(a.root,'/v1/jobs',{...data,purpose:'order_label'})).status,500);
  assert.equal((await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET')).body.state,'not_requested');
  await rm(file,{recursive:true});
  await call(a.root,'/v1/jobs',{...data,purpose:'order_label'});
  const claim=(await call(a.root,'/v1/agent/claim',{},'agent')).body.job;
  await rename(file,backup);await mkdir(file);
  assert.equal((await call(a.root,'/v1/agent/ack',{job_id:claim.job_id,lease_token:claim.lease_token,result:'spooled'},'agent')).status,500);
  const lookup=await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.equal(lookup.body.state,'claimed','failed ACK must not expose an uncommitted successful receipt');
  await rm(file,{recursive:true});await rename(backup,file);
  assert.equal((await call(a.root,'/v1/agent/ack',{job_id:claim.job_id,lease_token:claim.lease_token,result:'spooled'},'agent')).status,200);
 }finally{await a.close()}
});

test('independent lease timeout remains unknown after restart and cannot enqueue another label',async()=>{
 let clock=Date.now();const a=await setup({now:()=>clock});
 try{
  const created=await call(a.root,'/v1/jobs',{...data,purpose:'order_label'});
  await call(a.root,'/v1/agent/claim',{},'agent');
  clock+=121000;
  const lookup=await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.equal(lookup.body.state,'unknown');
  assert.equal(lookup.body.job.job_id,created.body.job.job_id);
  assert.equal(lookup.body.needs_reconciliation,true);
  const b=await makeBroker({file:join(a.dir,'state.json'),adminToken:ADMIN,agentToken:AGENT,now:()=>clock});
  const server=await b.listen(0);const root='http://127.0.0.1:'+server.address().port;
  try{
   assert.equal((await call(root,'/v1/orders/5001/label-job',null,'admin','GET')).body.state,'unknown');
   assert.equal((await call(root,'/v1/jobs',data)).status,409);
   assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job,null);
  }finally{await new Promise(done=>server.close(done))}
 }finally{await a.close()}
});

test('independent expired receipt is rolled back with failed prune persistence',async()=>{
 let clock=Date.now();const originalClock=clock;const a=await setup({now:()=>clock});
 const file=join(a.dir,'state.json'),backup=file+'.bak';
 try{
  await call(a.root,'/v1/jobs',{...data,purpose:'order_label'});
  await rename(file,backup);await mkdir(file);
  clock+=16*60000;
  assert.equal((await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET')).status,500);
  await rm(file,{recursive:true});await rename(backup,file);clock=originalClock;
  const lookup=await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET');
  assert.equal(lookup.body.state,'queued');
  assert.equal(lookup.body.needs_reconciliation,false);
 }finally{await a.close()}
});

test('independent strict printing still rejects absent artwork and malformed metadata',async()=>{
 const a=await setup({requireCrmArtwork:true});
 try{
  const request={...data,purpose:'order_label',status_key:'order_aborted'};
  const missing=await call(a.root,'/v1/jobs',request);
  assert.equal(missing.status,422);
  assert.equal(missing.body.error,'crm_artwork_required');
  for(const invalid of [undefined,'','not\na_status','x'.repeat(81)]){
   assert.equal((await call(a.root,'/v1/jobs',{...request,status_key:invalid})).status,422);
  }
  assert.equal((await call(a.root,'/v1/orders/5001/label-job',null,'admin','GET')).body.state,'not_requested');
 }finally{await a.close()}
});

test('independent corrupt receipts fail closed and conflicting order jobs are not silently selected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-corrupt-receipt-'));const file=join(dir,'state.json');
 try{
  await writeFile(file,JSON.stringify({version:2,jobs:[],seen_arrival_orders:[5001],order_label_receipts:[{order_id:5001,state:'spooled'}]}));
  await assert.rejects(makeBroker({file,adminToken:ADMIN,agentToken:AGENT}),/invalid_order_label_receipts/);
  const now=Date.now(),legacy={...data,job_id:RID,state:'spooled',created_at:now,expires_at:now+60000};
  await writeFile(file,JSON.stringify({version:2,jobs:[legacy,{...legacy,job_id:'70bca7a8-cdb7-4b8c-a2a8-68ebae46889e'}]}));
  await assert.rejects(makeBroker({file,adminToken:ADMIN,agentToken:AGENT}),/conflicting_order_label_receipts/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('independent restore rejects state or metadata conflicts for the same durable job',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-conflicting-receipt-'));const file=join(dir,'state.json');
 const now=Date.now(),job={...data,job_id:RID,state:'queued',render_source:'minimal',created_at:now,expires_at:now+60000,pdf_base64:'synthetic'};
 const receipt={job_id:RID,request_id:data.request_id,order_id:data.order_id,state:'queued',render_source:'minimal',created_at:now,expires_at:now+60000,purpose:'arrival',status_key:data.status_key};
 try{
  for(const change of [{state:'spooled'},{request_id:'70bca7a8-cdb7-4b8c-a2a8-68ebae46889e'},{created_at:now-1},{render_source:'crm_canonical'},{purpose:'order_label'}]){
   await writeFile(file,JSON.stringify({version:2,jobs:[job],seen_arrival_orders:[5001],order_label_receipts:[{...receipt,...change}]}));
   await assert.rejects(makeBroker({file,adminToken:ADMIN,agentToken:AGENT}),/conflicting_order_label_receipts/);
  }
  await writeFile(file,JSON.stringify({version:2,jobs:[],order_label_receipts:[{...receipt,status_key:'order_aborted'}]}));
  await assert.rejects(makeBroker({file,adminToken:ADMIN,agentToken:AGENT}),/invalid_order_label_receipts/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('independent missing active jobs remain uncertain receipts after restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-missing-active-job-'));const file=join(dir,'state.json');
 const now=Date.now();
 try{
  for(const state of ['queued','claimed']){
   const receipt={job_id:RID,request_id:data.request_id,order_id:data.order_id,state,render_source:'minimal',created_at:now,expires_at:now+60000,purpose:'order_label',status_key:'order_aborted'};
   await writeFile(file,JSON.stringify({version:2,jobs:[],order_label_receipts:[receipt]}));
   const b=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT});const server=await b.listen(0);const root='http://127.0.0.1:'+server.address().port;
   try{
    const lookup=await call(root,'/v1/orders/5001/label-job',null,'admin','GET');
    assert.equal(lookup.body.state,state);
    assert.equal(lookup.body.needs_reconciliation,true);
    assert.equal((await call(root,'/v1/jobs',{...data,purpose:'order_label'})).status,409);
    assert.equal((await call(root,'/v1/agent/claim',{},'agent')).body.job,null);
   }finally{await new Promise(done=>server.close(done))}
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});
