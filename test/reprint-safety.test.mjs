import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeBroker} from '../src/broker.mjs';
const ADMIN='A'.repeat(45),AGENT='B'.repeat(45);
const req=(id,extra={})=>({order_id:7401,operator_id:'42',status_key:'waiting_product_retrieve',confirmed_by_operator:true,purpose:'order_label',request_id:id,customer_name:'Cliente Ficticio',package_name:'Teste',...extra});
const R1='d83ed2db-f4f1-4a55-b632-61e246a22b38',R2='a77045d2-c8d5-429e-9530-17c88a5527d1';
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'reprint-')),file=join(dir,'state.json');
 const broker=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT});
 const server=await broker.listen(0);
 const root='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,role='admin',method='POST')=>{
  const res=await fetch(root+path,{method,headers:{Authorization:'Bearer '+(role==='admin'?ADMIN:AGENT),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});
  return {status:res.status,data:await res.json()};
 };
 return {dir,file,server,root,call,close:async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}};
}
test('explicit reprint needs canonical spooled receipt and remains opt-in',async()=>{
 const a=await setup();
 try{
  const first=await a.call('/v1/jobs',req(R1));
  assert.equal(first.status,201);
  const id=first.data.job.job_id;
  assert.equal((await a.call('/v1/jobs/reprint',req(R2,{reprint_of_job_id:id}))).status,422);
  const normal=await a.call('/v1/jobs',req(R2));
  assert.equal(normal.data.replay,true);
  assert.equal(normal.data.job.job_id,id);
  const claim=await a.call('/v1/agent/claim',{},'agent');
  const ack=await a.call('/v1/agent/ack',{job_id:id,lease_token:claim.data.job.lease_token,result:'spooled'},'agent');
  assert.equal(ack.data.job.state,'spooled');
  // Minimal/legacy artwork cannot silently become a canonical reprint.
  assert.equal((await a.call('/v1/jobs/reprint',req(R2,{reprint_of_job_id:id,label_png_base64:'AAAA'}))).status,422);
  const history=await a.call('/v1/orders/7401/label-history',null,'admin','GET');
  assert.equal(history.data.history.length,1);
  assert.equal(history.data.history[0].created_at,first.data.job.created_at);
  assert.equal((await a.call('/v1/orders/7401/label-history',null,'agent','GET')).status,401);
 }finally{await a.close()}
});
test('reprint rejects invalid and missing parent without weakening ordinary idempotence',async()=>{
 const a=await setup();
 try{
  assert.equal((await a.call('/v1/jobs/reprint',req(R2,{reprint_of_job_id:R1}))).status,422);
  assert.equal((await a.call('/v1/orders/7401/label-history',null,'admin','GET')).data.history.length,0);
 }finally{await a.close()}
});
