import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeBroker} from '../src/broker.mjs';
import {unpackCrmPng,crmPngToLabelPdf} from '../src/crm-label-pdf.mjs';
const TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc32=b=>{let c=0xffffffff;for(const x of b)c=TABLE[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,b)=>{
 const body=Buffer.concat([Buffer.from(type,'ascii'),b]),n=Buffer.alloc(4),crc=Buffer.alloc(4);
 n.writeUInt32BE(b.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([n,body,crc]);
};
function png(width=25,height=10,channels=4){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);
 header[8]=8;header[9]=channels===4?6:2;
 const pixels=[];
 for(let y=0;y<height;y++){
  const row=Buffer.alloc(width*channels+1);row[0]=0;
  for(let x=0;x<width;x++){
   const o=1+x*channels,dark=(x+y)%3===0;
   row[o]=row[o+1]=row[o+2]=dark?0:255;
   if(channels===4)row[o+3]=255;
  }
  pixels.push(row);
 }
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(pixels))),chunk('IEND',Buffer.alloc(0))]);
}
const ADMIN='A'.repeat(48),AGENT='B'.repeat(48);
const body={order_id:5127,operator_id:'2',status_key:'waiting_product_retrieve',confirmed_by_operator:true,purpose:'arrival',request_id:'25f8a560-19d3-4f07-a1d6-33d8cf47715d',customer_name:'Pessoa Ficticia',package_name:'Natal Ficticio'};
async function harness(){
 const dir=await mkdtemp(join(tmpdir(),'crm-label-artwork-'));
 const b=await makeBroker({file:join(dir,'jobs.json'),adminToken:ADMIN,agentToken:AGENT,requireCrmArtwork:true});
 const s=await b.listen(0);
 const root='http://127.0.0.1:'+s.address().port;
 return {dir,root,close:async()=>{await new Promise(resolve=>s.close(resolve));await rm(dir,{recursive:true,force:true})}};
}
async function call(root,path,payload,key=ADMIN){
 const r=await fetch(root+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 return {code:r.status,data:await r.json()};
}
test('wraps exact RGB CRM raster in one physical 100x40 PDF without redrawing QR',()=>{
 const input=png(250,100,3),decoded=unpackCrmPng(input);
 assert.equal(decoded.width,250);assert.equal(decoded.height,100);assert.equal(decoded.alpha,null);
 assert.equal(decoded.rgb[0],0);assert.equal(decoded.rgb[3],255);
 const pdf=crmPngToLabelPdf(input).toString('latin1');
 assert.match(pdf,/%PDF-1.4/);
 assert.match(pdf,/MediaBox \[0 0 283\.46457 113\.38583\]/);
 assert.match(pdf,/\/XObject/);
 assert.match(pdf,/\/Width 250 \/Height 100/);
 assert.ok(!pdf.includes('DISPONIVEL PARA RETIRADA'),'must not add a second layout/text layer');
});
test('validates alpha PNG and rejects altered CRC or unsupported media size',()=>{
 const rgba=unpackCrmPng(png());
 assert.equal(rgba.width,25);assert.equal(rgba.height,10);
 const bad=png();bad[55]^=1;
 assert.throws(()=>unpackCrmPng(bad),/crm_label_crc_failed/);
 assert.throws(()=>unpackCrmPng(png(10,10)),/crm_label_invalid_dimensions/);
});
test('strict broker refuses plain fallback and prints only canonical verified PNG',async()=>{
 const h=await harness();
 try{
  const noArt=await call(h.root,'/v1/jobs',body);
  assert.equal(noArt.code,422);
  const art=png(250,100,4);
  const good={...body,label_source:'crm_canonical',label_png_base64:art.toString('base64'),
   label_png_sha256:createHash('sha256').update(art).digest('hex')};
  const accepted=await call(h.root,'/v1/jobs',good);
  assert.equal(accepted.code,201);
  assert.equal(accepted.data.job.render_source,'crm_canonical');
  const claim=await call(h.root,'/v1/agent/claim',{},AGENT);
  assert.equal(claim.code,200);
  assert.match(Buffer.from(claim.data.job.pdf_base64,'base64').toString('latin1',0,30),/%PDF-1.4/);
  const duplicate=await call(h.root,'/v1/jobs',good);
  assert.equal(duplicate.code,200);assert.equal(duplicate.data.replay,true);
 }finally{await h.close()}
});

test('realistic 1181x472 Christmas artwork can exceed old Windows 256KiB PDF limit',async()=>{
 const {randomBytes}=await import('node:crypto');
 const width=1181,height=472,rows=[],widthBytes=width*3;
 for(let y=0;y<height;y++){
  const row=Buffer.alloc(1+widthBytes);
  randomBytes(widthBytes).copy(row,1);
  rows.push(row);
 }
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(width,0);hdr.writeUInt32BE(height,4);hdr[8]=8;hdr[9]=2;
 const image=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
  chunk('IHDR',hdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
 const pdf=crmPngToLabelPdf(image);
 assert.ok(pdf.length>262144,'must exercise the old agent rejection');
 assert.ok(pdf.length<5242880,'must fit the new bounded Windows limit');
 const h=await harness();
 try{
  const request={...body,label_source:'crm_canonical',label_png_base64:image.toString('base64'),
   label_png_sha256:createHash('sha256').update(image).digest('hex')};
  const job=await call(h.root,'/v1/jobs',request);
  assert.equal(job.code,201);
  const claimed=await call(h.root,'/v1/agent/claim',{},AGENT);
  assert.equal(claimed.code,200);
  const bytes=Buffer.from(claimed.data.job.pdf_base64,'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),claimed.data.job.sha256);
  assert.ok(bytes.length>262144 && bytes.length<5242880);
  const ack=await call(h.root,'/v1/agent/ack',{job_id:job.data.job.job_id,
   lease_token:claimed.data.job.lease_token,result:'spooled'},AGENT);
  assert.equal(ack.code,200);
  assert.equal(ack.data.job.state,'spooled');
 }finally{await h.close()}
});

test('a legacy minimal job is never replayed as a canonical artwork job in strict mode',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'crm-label-legacy-'));
 const file=join(dir,'jobs.json');
 const legacy=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT,requireCrmArtwork:false});
 const s1=await legacy.listen(0);
 try{
  const submitted=await call('http://127.0.0.1:'+s1.address().port,'/v1/jobs',body);
  assert.equal(submitted.code,201);
  assert.equal(submitted.data.job.render_source,'minimal');
 }finally{await new Promise(resolve=>s1.close(resolve))}
 const strict=await makeBroker({file,adminToken:ADMIN,agentToken:AGENT,requireCrmArtwork:true});
 const s2=await strict.listen(0);
 try{
  const art=png(),attempt={...body,label_source:'crm_canonical',label_png_base64:art.toString('base64'),
   label_png_sha256:createHash('sha256').update(art).digest('hex')};
  const replay=await call('http://127.0.0.1:'+s2.address().port,'/v1/jobs',attempt);
  assert.equal(replay.code,409);
  assert.equal(replay.data.error,'manual_reconciliation_required');
  assert.equal(replay.data.job.render_source,'minimal');
 }finally{
  await new Promise(resolve=>s2.close(resolve));
  await rm(dir,{recursive:true,force:true})
 }
});

test('PowerShell 5.1 agent has bounded PDF limit, ACK on validation failure and no automatic retry',async()=>{
 const {readFileSync}=await import('node:fs');
 const script=readFileSync(new URL('../windows/agent.ps1',import.meta.url),'utf8');
 assert.match(script,/\$bytes\.Length -gt 5242880/);
 assert.match(script,/ApiPost '\/v1\/agent\/ack'/);
 assert.match(script,/result=\$result/);
 assert.match(script,/never auto-retry/i);
});
test('corrupt or mismatched artwork never generates a print job',async()=>{
 const h=await harness();
 try{
  const art=png(250,100,4),good={...body,label_source:'crm_canonical',
   label_png_base64:art.toString('base64'),label_png_sha256:'0'.repeat(64)};
  assert.equal((await call(h.root,'/v1/jobs',good)).code,422);
  const claim=await call(h.root,'/v1/agent/claim',{},AGENT);
  assert.equal(claim.data.job,null);
 }finally{await h.close()}
});
