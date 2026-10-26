import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {labelPdf} from '../src/pdf.mjs';
import {makeBroker} from '../src/broker.mjs';

const ADMIN='A'.repeat(45),AGENT='B'.repeat(45),RID='d83ed2db-f4f1-4a55-b632-61e246a22b38';
const data={order_id:5001,operator_id:'42',status_key:'waiting_product_retrieve',confirmed_by_operator:true,purpose:'arrival',request_id:RID,customer_name:'Cliente Sintético',package_name:'Pacote Teste'};
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'evyd-printserver-'));
 const broker=await makeBroker({file:join(dir,'state.json'),adminToken:ADMIN,agentToken:AGENT});
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
