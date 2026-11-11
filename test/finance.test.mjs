import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Finance,HALF_HOUR as H} from '../src/finance.mjs';
const start=Date.parse('2026-11-09T12:00:00+08:00');
const receipt=(id,at,out)=>({id,at,endpoint:'/api/pet/world/act',out});
async function setup(t,since=start){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isle-finance-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=new Finance(dir,since);await f.init();return f;}
test('half-hour boundaries are half-open and zero-activity intervals remain visible',async t=>{
 const f=await setup(t);f.record(receipt('a',start+H-1,[{ok:true,a:'sell',earn:100}]));f.record(receipt('b',start+H,[{ok:true,a:'sell',earn:200}]));
 const rows=f.report(start+3*H).rows;assert.equal(rows[0].income,100);assert.equal(rows[1].income,200);assert.equal(rows[2].income,0);assert.equal(rows[2].open,false);assert.equal(rows[3].open,true);
});
test('operating cash excludes capital, failed actions, unliquidated loot and wallet jumps',async t=>{
 const f=await setup(t);f.record({...receipt('a',start,[{ok:true,a:'sell',earn:1000},{ok:true,a:'buy',spend:100},{ok:true,a:'expand',spend:500},{ok:false,a:'sell',earn:9000}]),before:0,after:900000});
 f.record({id:'v',at:start,endpoint:'/api/pet/world/visit/7',result:{value:99999,fine:50}});
 f.record({id:'old',at:start,endpoint:'/api/pet/world/auto',out:[{ok:true,a:'sell',earn:112576}]});
 assert.equal(f.total.income,1000);assert.equal(f.total.expenses,150);assert.equal(f.total.operating,850);assert.equal(f.total.cashNet,350);
});
test('full receipt history survives restart and is not limited to the dashboard ledger',async t=>{
 const f=await setup(t);const rows=Array.from({length:1601},(_,i)=>receipt(String(i),start+i,[{ok:true,a:'sell',earn:1}]));
 await fs.writeFile(path.join(f.dir,'receipts.jsonl'),[...rows,rows[0]].map(x=>JSON.stringify(x)).join('\n')+'\n');
 const next=new Finance(f.dir,start);await next.init();next.record(rows[0]);assert.equal(next.total.income,1601);assert.equal(next.report(start+H).rows[0].income,1601);
});
test('confirmed red packets are separate and duplicate external IDs do not double count',async t=>{
 const f=await setup(t),e={id:'packet',at:start+123,amount:12345,kind:'红包'};
 await fs.writeFile(path.join(f.dir,'external-income.json'),JSON.stringify([e,e]));const next=new Finance(f.dir,start);await next.init();
 const report=next.report(start+H);assert.equal(report.totals.external,12345);assert.equal(report.totals.operating,0);assert.equal(report.rows[0].external,12345);
});
test('inventory history is never fabricated before observation and persists separately',async t=>{
 const f=await setup(t);f.observe(start+H+600000,100);f.observe(start+H+660000,140);await f.save();
 const next=new Finance(f.dir,start);await next.init();const rows=next.report(start+H+700000).rows;
 assert.equal(rows[0].inventoryDelta,null);assert.equal(rows[1].inventoryDelta,40);assert.equal(rows[1].inventoryPartial,true);
});
test('first handoff interval is partial, historical receipts before handoff are excluded',async t=>{
 const f=await setup(t,start+120000);f.record(receipt('old',start,[{ok:true,a:'sell',earn:100}]));f.record(receipt('new',start+180000,[{ok:true,a:'sell',earn:20}]));
 const rows=f.report(start+H+1).rows;assert.equal(rows[0].partial,true);assert.equal(rows[0].income,20);assert.equal(rows[1].open,true);
});

test('lottery and NPC cash plus verified training costs enter the same half-hour',async t=>{
 const f=await setup(t);
 f.record(receipt('lotto',start,[{ok:true,a:'lotto',spend:500},{ok:true,a:'lottoClaim',earn:200}]));
 f.record(receipt('npc',start,[{ok:true,a:'npc',earn:1000,got:[{id:'gold',n:3}]}]));
 f.record({id:'train',at:start,endpoint:'/api/pet/battle/train?xp=300',before:100000,after:900000,training:{spend:13500,source:'server-tier-quote'}});
 f.record({id:'unknown',at:start,endpoint:'/api/pet/battle/train?xp=300',before:100000,after:86500});
 assert.equal(f.total.income,1200);assert.equal(f.total.expenses,14000);assert.equal(f.total.operating,-12800);assert.equal(f.total.capex,0);
});

test('sale tax is informational, guard refund is external, and fund receipts deduplicate across restart',async t=>{
 const f=await setup(t);
 f.record(receipt('sale',start,[{ok:true,a:'sell',gross:10000,tax:100,earn:9900}]));
 f.record(receipt('refund',start,[{ok:true,a:'guardRefund',earn:2500,refund:2500}]));
 const report={now:start/1000,history:[{id:1,created_at:start/1000,kind:'pet-world-sale-tax',delta:-100},{id:2,created_at:start/1000,kind:'pet-world-balance-tax',delta:-1000},{id:3,created_at:start/1000,kind:'pet-world-subsidy',delta:5000}]};
 await f.observeFund(report);await f.observeFund(report);
 assert.equal(f.total.income,9900);assert.equal(f.total.expenses,1000);assert.equal(f.total.operating,8900);assert.equal(f.total.saleTax,100);assert.equal(f.total.external,7500);
 const next=new Finance(f.dir,start);await next.init();await next.observeFund(report);assert.equal(next.total.expenses,1000);assert.equal(next.total.subsidy,5000);
 assert.equal(f.report(start+1).totals.external,7500);
});

test('retirement proceeds recover capital rather than inflate operating income',async t=>{
 const f=await setup(t);f.record(receipt('replace',start,[{ok:true,a:'sellAnimal',gross:60000,tax:100,earn:59900},{ok:true,a:'buyAnimal',spend:150000}]));
 assert.equal(f.total.operating,0);assert.equal(f.total.capitalRecovery,59900);assert.equal(f.total.capex,150000);assert.equal(f.total.cashNet,-90100);
});
