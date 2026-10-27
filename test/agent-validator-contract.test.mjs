import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
test('single canonical local validator rather than duplicate runner',()=>{
 assert.equal(pkg.scripts['agent:validate:local'],'node scripts/validate-agent-local.mjs');
 assert.ok(existsSync(resolve(root,'scripts/validate-agent-local.mjs')));
 assert.equal(existsSync(resolve(root,'scripts/agent-validate-local.mjs')),false,
  'Keep the existing validated entrypoint and avoid duplicate maintenance');
});
test('Windows printing scripts are inspected but not executed in local validator',()=>{
 const js=readFileSync(resolve(root,'scripts/validate-agent-local.mjs'),'utf8');
 const ps=readFileSync(resolve(root,'scripts/Validate-SyntaxOnly.ps1'),'utf8');
 assert.match(js,/Validate-SyntaxOnly\.ps1/);
 assert.match(ps,/Parser\]::ParseFile/);
 assert.doesNotMatch(ps,/\bStart-Process\b|\bInvoke-RestMethod\b/);
});
