// Exact-image PDF wrapper: CRM OrderLabelService stays the ONLY image renderer.
// Accepts bounded non-interlaced PNG from GD (8-bit RGB/RGBA), preserving QR pixels.
// No font, logo or QR reproduction here; the print agent receives one fixed 100x40mm page.
import {inflateSync, deflateSync} from 'node:zlib';
const MM_TO_PT=72/25.4;
const PDF_W=100*MM_TO_PT,PDF_H=40*MM_TO_PT;
const MAX_PNG=3*1024*1024, MAX_PIXELS=1600000;
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const fail=(code)=>{throw new Error('crm_label_'+code)};
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0};
export function unpackCrmPng(input){
 const png=Buffer.isBuffer(input)?input:Buffer.from(input||[]);
 if(png.length<60||png.length>MAX_PNG||!png.subarray(0,8).equals(pngSignature))fail('invalid_png');
 let pos=8,seenHeader=false,seenEnd=false,width=0,height=0,channels=0,parts=[],compressed=0;
 while(pos+12<=png.length){
  const n=png.readUInt32BE(pos);if(n>MAX_PNG||pos+12+n>png.length)fail('invalid_chunks');
  const type=png.toString('ascii',pos+4,pos+8),body=png.subarray(pos+8,pos+8+n);
  const expected=png.readUInt32BE(pos+8+n);
  if(crc32(png.subarray(pos+4,pos+8+n))!==expected)fail('crc_failed');
  pos+=n+12;
  if(type==='IHDR'){
   if(seenHeader||n!==13)fail('invalid_header');
   seenHeader=true;width=body.readUInt32BE(0);height=body.readUInt32BE(4);
   const bitDepth=body[8],colorType=body[9],compression=body[10],filter=body[11],interlace=body[12];
   channels=colorType===2?3:colorType===6?4:0;
   if(!channels||bitDepth!==8||compression!==0||filter!==0||interlace!==0)fail('unsupported_png');
   if(width<10||height<10||width*height>MAX_PIXELS||Math.abs(width/height-2.5)>.035)fail('invalid_dimensions');
  }else if(type==='IDAT'){
   if(!seenHeader||seenEnd)fail('invalid_chunk_order');
   compressed+=n;if(compressed>MAX_PNG)fail('oversize');
   parts.push(body);
  }else if(type==='IEND'){if(!seenHeader||!parts.length||n!==0)fail('invalid_end');seenEnd=true;break}
  else if(/^[A-Z]/.test(type)&&type!=='PLTE')fail('unsupported_chunk');
 }
 if(!seenEnd||pos!==png.length)fail('incomplete_png');
 const stride=width*channels,expected=(stride+1)*height;
 let data;try{data=inflateSync(Buffer.concat(parts),{maxOutputLength:expected+1})}catch{fail('invalid_idat')}
 if(data.length!==expected)fail('incorrect_pixel_count');
 const rgb=Buffer.alloc(width*height*3),alpha=channels===4?Buffer.alloc(width*height):null;
 let prior=Buffer.alloc(stride),readPos=0,rgbPos=0,alphaPos=0,hasTransparency=false;
 for(let y=0;y<height;y++){
  const f=data[readPos++],line=Buffer.alloc(stride);if(f>4)fail('invalid_filter');
  for(let i=0;i<stride;i++){
   const a=i>=channels?line[i-channels]:0,b=prior[i],c=i>=channels?prior[i-channels]:0;
   const predict=f===0?0:f===1?a:f===2?b:f===3?((a+b)>>>1):paeth(a,b,c);
   line[i]=(data[readPos++]+predict)&255;
  }
  for(let x=0;x<width;x++){
   const off=x*channels;
   rgb[rgbPos++]=line[off];rgb[rgbPos++]=line[off+1];rgb[rgbPos++]=line[off+2];
   if(alpha){const v=line[off+3];alpha[alphaPos++]=v;if(v!==255)hasTransparency=true}
  }
  prior=line;
 }
 return {width,height,rgb,alpha:hasTransparency?alpha:null};
}
function buildPdf(width,height,rgb,alpha){
 const parts=[],offsets=[0];let size=0;
 const push=b=>{const x=typeof b==='string'?Buffer.from(b,'latin1'):b;parts.push(x);size+=x.length};
 const obj=(id,body)=>{
  offsets[id]=size;push(id+' 0 obj\n');if(Array.isArray(body)){push(body[0]);push(body[1]);push(body[2])}else push(body);push('\nendobj\n');
 };
 const stream=(dict,buffer)=>[dict.replace('<<','<< /Length '+buffer.length+' '),Buffer.from('stream\n','ascii'),Buffer.concat([buffer,Buffer.from('\nendstream','ascii')])];
 push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
 obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PDF_W.toFixed(5)+' '+PDF_H.toFixed(5)+'] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 6 0 R >>');
 const zRgb=deflateSync(rgb,{level:6});
 obj(4,stream('<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode '+(alpha?'/SMask 5 0 R ':'')+'>>\n',zRgb));
 if(alpha){const zAlpha=deflateSync(alpha,{level:6});obj(5,stream('<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>\n',zAlpha))}
 else obj(5,'<< /Producer (Evydencia no alpha mask) >>');
 const commands=Buffer.from('q '+PDF_W.toFixed(5)+' 0 0 '+PDF_H.toFixed(5)+' 0 0 cm /Im0 Do Q\n','ascii');
 obj(6,stream('<< >>\n',commands));
 const xref=size;
 push('xref\n0 7\n0000000000 65535 f \n');
 for(let i=1;i<=6;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 push('trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return Buffer.concat(parts);
}
export function crmPngToLabelPdf(png){
 const {width,height,rgb,alpha}=unpackCrmPng(png);
 return buildPdf(width,height,rgb,alpha);
}
