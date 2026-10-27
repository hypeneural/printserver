#!/usr/bin/env node
/** Local synthetic-only validation of THIS repository. No live endpoints or printer use. */
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env=Object.fromEntries(['PATH','Path','PATHEXT','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.CI='1';
env.NODE_ENV='test';
const steps=[
 {name:'node_syntax',command:process.execPath,args:['--check','src/broker.mjs']},
 {name:'queue_and_artwork',command:process.execPath,args:['--test','test/broker.test.mjs','test/crm-label-pdf.test.mjs']}
];
if(process.platform==='win32'){
 steps.push({name:'windows_powershell_parser_only',command:'powershell.exe',args:[
 '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
 'scripts/Validate-SyntaxOnly.ps1'
 ]});
}
const results=[];
for(const step of steps){
 const started=Date.now();
 const child=spawnSync(step.command,step.args,{
  cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,shell:false
 });
 const ok=!child.error&&child.status===0;
 results.push({name:step.name,ok,exit_code:child.status,error_code:child.error?.code||null,elapsed_ms:Date.now()-started});
 if(!ok)break;
}
const ok=results.length===steps.length&&results.every(x=>x.ok);
process.stdout.write(JSON.stringify({
 source:'PRINTSERVER_LOCAL_SYNTHETIC_VALIDATION',
 mode:'offline_only',
 windows_parser_checked:process.platform==='win32'&&results.some(x=>x.name==='windows_powershell_parser_only'&&x.ok),
 changes_applied:false,external_requests_performed:false,
 print_job_created:false,physical_print_performed:false,
 steps:results,ok
},null,2)+'\n');
process.exitCode=ok?0:1;
