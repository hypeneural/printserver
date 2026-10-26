import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
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
 const response=await fetch(root+path,{method,headers:{Authorization:'Bearer '+(role==='admin'?ADMIN:AGENT),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{body:'{}'})});
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
test('no secrets means fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'evyd-printserver-'));
 try{
  await assert.rejects(makeBroker({file:join(dir,'state.json'),adminToken:'short',agentToken:AGENT}),/secrets/);
  await assert.rejects(makeBroker({file:join(dir,'state.json'),adminToken:AGENT,agentToken:AGENT}),/secrets/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
