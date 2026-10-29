import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeBroker} from '../src/broker.mjs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
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

const TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc32=b=>{let c=0xffffffff;for(const x of b)c=TABLE[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,b)=>{const content=Buffer.concat([Buffer.from(type),b]),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(b.length);crc.writeUInt32BE(crc32(content));return Buffer.concat([n,content,crc])};
function artwork(){
 const w=250,h=100,header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
 const rows=Array.from({length:h},()=>Buffer.concat([Buffer.from([0]),Buffer.alloc(w*4,255)]));
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
 return {label_source:'crm_canonical',label_png_base64:png.toString('base64'),label_png_sha256:createHash('sha256').update(png).digest('hex')};
}
test('canonical reprint creates one new job, retains timestamps, and is durable',async()=>{
 const a=await setup();const art=artwork();
 try{
  const first=await a.call('/v1/jobs',req(R1,art));
  assert.equal(first.status,201);
  const previous=first.data.job.job_id;
  const claim=await a.call('/v1/agent/claim',{},'agent');
  assert.equal((await a.call('/v1/agent/ack',{job_id:previous,lease_token:claim.data.job.lease_token,result:'spooled'},'agent')).status,200);
  const attempt=req(R2,{...art,reprint_of_job_id:previous});
  const one=await a.call('/v1/jobs/reprint',attempt);
  assert.equal(one.status,201,JSON.stringify(one.data));
  assert.equal(one.data.job.reprint_of_job_id,previous);
  assert.notEqual(one.data.job.job_id,previous);
  assert.equal((await a.call('/v1/jobs/reprint',attempt)).data.job.job_id,one.data.job.job_id);
  const another=await a.call('/v1/jobs/reprint',req('0e7a5727-8c6f-481a-920d-dbf9167bf775',{...art,reprint_of_job_id:previous}));
  assert.equal(another.status,409);
  const list=await a.call('/v1/orders/7401/label-history',null,'admin','GET');
  assert.equal(list.data.history.length,2);
  assert.equal(list.data.history[0].job_id,previous);
  assert.equal(list.data.history[1].job_id,one.data.job.job_id);
  assert.ok(Number.isSafeInteger(list.data.history[0].created_at));
  assert.equal((await a.call('/v1/jobs/'+previous,null,'admin','GET')).status,200);
  const disk=JSON.parse(await readFile(a.file,'utf8'));
  assert.equal(disk.order_label_history.length,1);
  assert.equal(disk.order_label_receipts.length,1);
  assert.equal(disk.order_label_receipts[0].job_id,one.data.job.job_id);
  const restored=await makeBroker({file:a.file,adminToken:ADMIN,agentToken:AGENT});
  const server=await restored.listen(0);
  try {
   const url='http://127.0.0.1:'+server.address().port;
   const result=await fetch(url+'/v1/orders/7401/label-history',{headers:{Authorization:'Bearer '+ADMIN}});
   assert.equal((await result.json()).history.length,2);
  }finally{await new Promise(resolve=>server.close(resolve))}
 }finally{await a.close()}
});
