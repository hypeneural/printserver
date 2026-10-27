// Wraps an image rendered by the CRM's own Natal preset, with no customer data.
// No printing/network calls. Output is gitignored and always 100x40 mm.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {crmPngToLabelPdf} from '../src/crm-label-pdf.mjs';
const source=resolve(process.argv[2]||'../evydencia-crm-mcp/private/crm-label-natal-synthetic.png');
if(!source.endsWith('crm-label-natal-synthetic.png'))throw Error('fixture_filename_must_be_synthetic');
const dir=resolve('test-output');
const png=await readFile(source);
const pdf=crmPngToLabelPdf(png);
await mkdir(dir,{recursive:true,mode:0o700});
const pdfFile=join(dir,'crm-label-natal-synthetic.pdf');
await writeFile(pdfFile,pdf,{mode:0o600});
const result={synthetic:true,order_id:999999,physical_mm:[100,40],
 source_sha256:createHash('sha256').update(png).digest('hex'),
 pdf_sha256:createHash('sha256').update(pdf).digest('hex'),
 pdf_file:'crm-label-natal-synthetic.pdf',printed_physically:false};
await writeFile(join(dir,'crm-label-natal-synthetic.manifest.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({synthetic:true,pdf_file:'test-output/crm-label-natal-synthetic.pdf',physical_mm:[100,40],printed:false}));
