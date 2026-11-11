import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Survey,inspectSource,sourceDiff,contractIssues} from '../src/survey.mjs';
import {receiptIssues,writeContractIssues} from '../src/receipt-check.mjs';
import {R} from '../src/economy.mjs';
const old='export const WORLD={cost:{craft:1},plotsMax:24}; export function cost(){return WORLD.cost.craft;}';
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isle-survey-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let now=1000000,source=old;
 const s=new Survey(dir,{'/pet-world-rules.js':inspectSource(old)},{clock:()=>now,fetcher:async()=>new Response(source)});await s.init();
 return {s,advance:()=>now+=900000,source:v=>source=v};
}
test('static inspection never executes source and extracts facts and dependencies',()=>{
 const info=inspectSource(old+'; globalThis.mustNotExecute=true; import x from "/pet-isle.js?v=new"; const url="/api/pet/world";');
 assert.equal(globalThis.mustNotExecute,undefined);assert.equal(info.facts['WORLD.cost.craft'],1);
 assert.deepEqual(info.dependencies,['/pet-isle.js']);assert.deepEqual(info.endpoints,['/api/pet/world']);
});
test('format-only edits pass but automatic semicolon insertion and template raw edits do not',()=>{
 assert.equal(inspectSource(old).semanticHash,inspectSource('// comment\n'+old.replaceAll('=', ' = ')).semanticHash);
 assert.notEqual(inspectSource('export function f(){return 1;}').semanticHash,inspectSource('export function f(){return\n1;}').semanticHash);
 assert.notEqual(inspectSource('tag`\\n`').semanticHash,inspectSource('tag`\n`').semanticHash);
});
test('rule changes are named and code changes are not silently classified as data-only',()=>{
 const diff=sourceDiff(inspectSource(old),inspectSource(old.replace('craft:1','craft:2')));
 assert.ok(diff.some(x=>x.key==='WORLD.cost.craft'&&x.before===1&&x.after===2));
 assert.ok(diff.some(x=>x.kind==='code'&&x.key==='WORLD'));
});
test('a changed version remains blocked after restart; rollback to known semantics recovers',async t=>{
 const f=await fixture(t);assert.equal(f.s.blocked,true);await f.s.poll();assert.equal(f.s.blocked,false);
 f.source(old.replace('craft:1','craft:2'));f.advance();await f.s.poll();assert.equal(f.s.blocked,true);
 const restarted=new Survey(f.s.dir,f.s.baseline);await restarted.init();assert.equal(restarted.blocked,true);
 f.source('// comment only\n'+old);f.advance();await f.s.poll();assert.equal(f.s.blocked,false);assert.equal(f.s.state.assets['/pet-world-rules.js'].formatOnly,true);
});
test('failed reads and invalid JavaScript block writes without adopting a new baseline',async t=>{
 const {s,source,advance}=await fixture(t);await s.poll();const baseline=s.baseline;
 source('<html>maintenance</html>');advance();await s.poll();assert.equal(s.blocked,true);assert.equal(s.baseline,baseline);
 s.fetcher=async()=>new Response('failure',{status:503});advance();await s.poll();assert.match(s.reason,/读取未完成/);
});
test('surveys are throttled and do not send credentials to public script requests',async t=>{
 const {s}=await fixture(t);let calls=0;s.fetcher=async(url,options)=>{calls++;assert.equal(options.headers.cookie,undefined);return new Response(old);};
 await s.poll();await s.poll();assert.equal(calls,1);
});
test('missing required fields block; optional additions and empty neighbor arrays do not',async t=>{
 const {s,advance}=await fixture(t);await s.poll();
 assert.deepEqual(s.observe('/api/pet/world/neighbors?limit=20',{neighbors:[],extra:1}),[]);
 assert.equal(s.blocked,false);assert.ok(s.observe('/api/pet/world/neighbors',{neighbors:{}}).length);assert.equal(s.blocked,true);
 s.observe('/api/pet/world/neighbors',{neighbors:[{id:1,name:'private user name'}]});assert.equal(s.blocked,true);
 advance();s.observe('/api/pet/world/neighbors',{neighbors:[]});assert.equal(s.blocked,false);
 assert.equal(JSON.stringify(s.state.contracts).includes('private user name'),false);
 assert.ok(contractIssues('/api/pet/world',{state:{},coins:1}).length);
});
test('version archives are bounded',async t=>{
 const {s,source,advance}=await fixture(t);
 for(let i=0;i<12;i++){source(old+'\n// revision '+i);advance();await s.poll();}
 assert.equal((await fs.readdir(path.join(s.dir,'archive'))).length,10);
});
test('cash checks detect hidden deterministic backend drift but skip random outcomes and day boundaries',()=>{
 const t=1794193119,s=R.newWorld(t),w={state:s,now:t,prices:{},coins:100000};
 assert.deepEqual(receiptIssues(w,[{a:'buy',id:'feed',n:1}],{out:[{ok:true,spend:150}]},t),[]);
 assert.ok(receiptIssues(w,[{a:'buy',id:'feed',n:1}],{out:[{ok:true,spend:300}]},t).length);
 assert.deepEqual(receiptIssues(w,[{a:'fish'}],{out:[{ok:true,earn:123456}]},t),[]);
 assert.deepEqual(receiptIssues(w,[{a:'buy',id:'feed',n:1}],{out:[{ok:true,spend:300}]},t+86400),[]);
});
test('non-world write contracts reject incomplete success responses',()=>{
 for(const endpoint of ['/api/pet/battle/chest','/api/pet/world/visit/7','/api/pet/world/auto','/api/pet/battle'])assert.ok(writeContractIssues(endpoint,{ok:true}).length);
 assert.deepEqual(writeContractIssues('/api/pet/world/visit/7',{result:{outcome:'lose',n:0,energy:15,fine:0,items:[]}}),[]);
});
