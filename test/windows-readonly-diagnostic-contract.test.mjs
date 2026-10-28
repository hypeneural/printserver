import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
test('Windows 11 fleet diagnostic is strictly read-only and is included in PowerShell AST checks',()=>{
 const script=readFileSync(new URL('windows/Test-LabelRuntimeReadOnly.ps1',root),'utf8');
 const parser=readFileSync(new URL('scripts/Validate-SyntaxOnly.ps1',root),'utf8');
 assert.match(script,/#requires -Version 5\.1/);
 for(const cmd of ['Get-Printer','Get-PrintConfiguration','Get-PrintJob','Get-ScheduledTask','Get-ScheduledTaskInfo','Get-Service']){
  assert.match(script,new RegExp('\\b'+cmd+'\\b'));
 }
 assert.match(parser,/windows\/Test-LabelRuntimeReadOnly\.ps1/);
 assert.doesNotMatch(script,/\b(Start-Process|Start-ScheduledTask|Stop-ScheduledTask|Restart-Service|Set-Printer|Remove-Printer|Remove-PrintJob|Invoke-RestMethod|Start-PrintJob|Set-PrintConfiguration)\b/i);
 assert.match(script,/print_submitted=\$false/);
});
