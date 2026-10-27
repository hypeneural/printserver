// Creates ONLY a synthetic PDF in ignored test-output; never fetches CRM data.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {labelPdf} from '../src/pdf.mjs';
const targetDir=resolve('test-output');
await mkdir(targetDir,{recursive:true,mode:0o700});
const target=join(targetDir,'test_synthetic_label.pdf');
const pdf=labelPdf({order_id:999999,customer_name:'HOMOLOGACAO SINTETICA',package_name:'TESTE TERMICA 100x40 MM'});
await writeFile(target,pdf,{flag:'w',mode:0o600});
console.log(JSON.stringify({synthetic:true,output:target,bytes:pdf.length,crm_access:false,physical_print:false}));
