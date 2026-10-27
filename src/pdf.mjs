// One-page 100 x 40 mm PDF, basic built-in Helvetica. No dependencies.
// Intentionally minimal label (order ID, customer name, package), not the CRM artwork.
import {Buffer} from 'node:buffer';
const ASCII=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
const esc=s=>ASCII(s).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
function clamp(s,max){return ASCII(s).trim().slice(0,max)}
export function labelPdf({order_id,customer_name,package_name}){
 if(!Number.isSafeInteger(order_id)||order_id<1)throw Error('invalid_order_id');
 if(typeof customer_name!=='string'||customer_name.trim().length<2||customer_name.length>120)throw Error('invalid_customer_name');
 // Conservative widths for Helvetica-Bold on the 100mm physical page:
 // name: 22 x 0.945 x 11.5pt < 250pt; package: 27 x 0.945 x 9.5pt < 250pt.
 // Text begins at x=16pt and must finish before x=267pt.
 const id=clamp(order_id,12),name=clamp(customer_name,22),pkg=clamp(package_name||'Pedido de fotos',27);
 // Physical page in PDF points: 100x40 mm.
 // Enhanced contrast (all lines bold, 1pt border), centered margins and raised footer for tear safety.
 const stream=[
  '1 w 8 10 267.465 93.386 re S',
  'BT /F2 14 Tf 16 84 Td ('+esc('EVYDENCIA | PEDIDO #'+id)+') Tj ET',
  'BT /F2 11.5 Tf 16 62 Td ('+esc(name)+') Tj ET',
  'BT /F2 9.5 Tf 16 43 Td ('+esc(pkg)+') Tj ET',
  'BT /F2 8.5 Tf 16 24 Td (DISPONIVEL PARA RETIRADA) Tj ET'
 ].join('\n')+'\n';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 283.465 113.386] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  '<< /Length '+Buffer.byteLength(stream,'latin1')+' >>\nstream\n'+stream+'endstream'
 ];
 let out='%PDF-1.4\n%EVYD\n';const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out,'latin1'));out+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'}
 const xref=Buffer.byteLength(out,'latin1');
 out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(let i=1;i<offsets.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 out+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return Buffer.from(out,'latin1');
}
