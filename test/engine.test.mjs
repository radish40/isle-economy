import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../src/engine.mjs';
import {R} from '../src/economy.mjs';
import {trainingPlan} from '../src/activities.mjs';
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isle-test-'));const e=new Engine(dir);t.after(()=>{e.close();return fs.rm(dir,{recursive:true,force:true});});await e.init();e.survey.state.checkedAt=Date.now();e.survey.state.assets=structuredClone(e.survey.baseline);e.survey.poll=async()=>{};e.world={coins:100000};e.sync=async()=>{};return e;}
test('ambiguous timeout keeps durable operation and blocks automatic restart',async t=>{
 const e=await setup(t);e.state.enabled=true;e.request=async()=>{throw Error('timeout');};
 await assert.rejects(e.transact('/api/pet/world/act',{operation:'stable-op',actions:[{a:'sell'}]},'test'));
 assert.equal(e.state.enabled,false);assert.equal(e.state.pending.id,'stable-op');
 e.close();const next=new Engine(e.dir);await next.init();assert.equal(next.state.enabled,false);assert.equal(next.state.pending.id,'stable-op');await assert.rejects(next.control({enabled:true}));next.close();
});
test('rate rejection can safely replan but must back off',async t=>{
 const e=await setup(t);e.state.enabled=true;e.request=async()=>{const x=Error('rate');x.status=429;x.data={retry:30};throw x;};
 await assert.rejects(e.transact('/api/pet/world/act',{operation:'op'},'test'));
 assert.equal(e.state.pending,null);assert.equal(e.state.enabled,true);assert.ok(e.state.nextRun>Date.now()+25000);
});
test('receipt capital expenditure is counted only for successful capital actions',async t=>{
 const e=await setup(t);e.request=async()=>({coins:19000,rev:2,out:[{a:'upgrade',ok:true,spend:80000},{a:'buy',ok:true,spend:1000},{a:'expand',ok:false,spend:170000}]});
 await e.transact('/api/pet/world/act',{operation:'op',actions:[{a:'upgrade',k:'pick'},{a:'buy',id:'feed'},{a:'expand',k:'plot'}]},'test');
 assert.equal(e.state.capitalTotal,80000);assert.equal(e.state.pending,null);assert.equal(e.state.ledger.length,1);
});
test('wrong game account cannot become a planning snapshot',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isle-id-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const e=new Engine(dir,{sourceAccountId:42});await e.init();e.request=async()=>({me:{id:1}});await assert.rejects(e.sync(),/绑定账号/);assert.equal(e.world,null);e.close();
});
test('only one writer can own the data directory',async t=>{const e=await setup(t);const other=new Engine(e.dir);await assert.rejects(other.init(),/已有经营实例/);});
test('HTTP 408 is ambiguous and preserves pending',async t=>{const e=await setup(t);e.state.enabled=true;e.request=async()=>{const x=Error('timeout');x.status=408;throw x;};await assert.rejects(e.transact('/api/pet/world/act',{operation:'op'},'test'));assert.ok(e.state.pending);assert.equal(e.state.enabled,false);});
test('2xx invalid receipt cannot clear pending',async t=>{const e=await setup(t);e.request=async()=>({error:'bad response'});await assert.rejects(e.transact('/api/pet/world/act',{operation:'op',actions:[]},'test'));assert.ok(e.state.pending);});
test('official handoff settlement is excluded from the new operating baseline',async t=>{
 const e=await setup(t);e.state.enabled=true;e.checkRules=async()=>{};
 e.world={coins:40000,rev:1,now:1794201000,prices:{turnip:500},state:{auto:{on:true},inv:{turnip:[4,0,0]}}};
 e.transact=async()=>{e.world={...e.world,coins:150000,state:{auto:{on:false},inv:{}}};return {};};
 await e.tick();assert.equal(e.state.baseline.coins,150000);assert.equal(e.state.baseline.inventory,0);assert.equal(e.state.handoff.legacyCashChange,110000);
});
test('neighbor discovery paginates with no energy and resumes its cursor',async t=>{
 const e=await setup(t);e.world={coins:100000,state:{en:0},prices:{}};const urls=[];
 e.request=async url=>{urls.push(url);return {neighbors:[],nextCursor:'page'+urls.length};};
 await e.scanVisits();assert.equal(urls.length,3);assert.match(urls[1],/cursor=page1/);assert.equal(e.state.neighborCursor,'page3');
 e.nextScan=0;await e.scanVisits();assert.match(urls[3],/cursor=page3/);
});
test('expired neighbor cursor is reset without pausing the writer',async t=>{
 const e=await setup(t);e.state.neighborCursor='expired';e.request=async()=>{const err=Error('list changed');err.status=400;throw err;};
 await e.scanVisits();assert.equal(e.state.neighborCursor,null);
});
test('a stale unavailable target cannot buy food or reserve theft energy',async t=>{
 const e=await setup(t);e.state.targets={7:{id:7,available:false,seenAt:Date.now(),score:{margin:50000,cost:15,fineMax:5000}}};
 e.world={coins:100000,now:1794193119,state:R.newWorld(1794193119),prices:{}};
 e.request=async()=>{throw Error('must not request');};assert.equal(await e.tryVisit(),false);
});
test('theft cannot exceed loss budget or spend an unfunded fine',async t=>{
 const e=await setup(t);e.state.targets={7:{id:7,available:true,seenAt:Date.now(),score:{margin:50000,cost:5,fineMax:5000}}};
 e.state.visitResults=[{at:Date.now(),result:{fine:6000}}];e.state.ledger=[];e.request=async()=>{throw Error('must not request');};
 assert.equal(await e.tryVisit(),false);e.state.visitResults=[];e.world.coins=32000;assert.equal(await e.tryVisit(),false);
});
test('a temporary optional read failure does not disable production',async t=>{
 const e=await setup(t);e.state.enabled=true;e.state.arena=false;e.checkRules=async()=>{};
 e.world={coins:100000,now:1794193119,state:R.newWorld(1794193119),prices:{}};e.plan={actions:[]};
 e.scanVisits=async()=>{const err=Error('temporary');err.readOnly=true;err.status=503;throw err;};e.replan=()=>{};e.extras=async()=>false;
 await e.tick();assert.equal(e.state.enabled,true);assert.ok(e.nextScan>Date.now());assert.equal(e.state.pending,null);
});
test('a temporary world read failure backs off and resumes from a fresh snapshot',async t=>{
 const e=await setup(t);e.state.enabled=true;let reads=0,writes=0;
 e.world={state:{auto:{on:false}},rev:1};
 e.plan={actions:[{a:'harvest',i:0}],reasons:['harvest']};
 e.sync=async()=>{if(++reads===1)throw Object.assign(Error('upstream unavailable'),{readOnly:true,status:503});e.world.rev=2;};
 e.transact=async(_,body)=>{assert.equal(body.rev,2);writes++;};
 await e.tick();assert.equal(e.state.enabled,true);assert.equal(writes,0);assert.ok(e.state.nextRun>Date.now());
 await e.tick();assert.equal(reads,1);
 e.state.nextRun=0;await e.tick();assert.equal(writes,1);
});
test('a confirmed write followed by a failed refresh is not replayed or disabled',async t=>{
 const e=await setup(t);e.state.enabled=true;e.state.steal=false;e.world={coins:100000,state:{auto:{on:false}},rev:1};
 let reads=0,writes=0;
 e.sync=async()=>{if(++reads===2)throw Object.assign(Error('refresh timeout'),{readOnly:true});if(reads>2)e.plan={actions:[]};};
 e.extras=async()=>false;e.replan=()=>{};
 e.plan={actions:[{a:'harvest',i:0}],reasons:['harvest']};
 e.request=async()=>{writes++;return {coins:100000,rev:2,out:[{a:'harvest',ok:true}]};};
 await e.tick();assert.equal(e.state.enabled,true);assert.equal(e.state.pending,null);assert.equal(e.state.ledger.length,1);assert.ok(e.state.nextRun>Date.now());
 e.state.nextRun=0;await e.tick();assert.equal(writes,1);
});
test('a fatal read retains its stop cause across later observations and restart',async t=>{
 const e=await setup(t);e.state.enabled=true;
 e.sync=async()=>{throw Object.assign(Error('upstream rejected the session'),{readOnly:true,status:401});};
 await e.tick();assert.equal(e.state.enabled,false);
 e.sync=async()=>{};await e.tick();assert.match(e.state.status,/upstream rejected the session/);
 e.close();const next=new Engine(e.dir);await next.init();assert.equal(next.snapshot().lastStop.kind,'error');next.close();
});
test('auth-read stop survives restart and resumes only when the read and account check recover',async t=>{
 const e=await setup(t);e.state.enabled=true;e.world=null;e.state.clockStart=1794200000;
 const rejected=()=>Object.assign(Error('upstream login required'),{readOnly:true,status:401,endpoint:'/api/pet/world/lotto'});
 e.sync=async()=>{throw rejected();};await e.tick();
 assert.equal(e.state.enabled,false);assert.equal(e.snapshot().autoRecovering,true);
 e.close();
 const next=new Engine(e.dir,{sourceAccountId:42});await next.init();
 try{
 next.survey.state.checkedAt=Date.now();next.survey.state.assets=structuredClone(next.survey.baseline);
 next.survey.poll=async()=>{};next.state.nextRun=0;
 let home=0,eligible=false;
 next.request=async endpoint=>{
  if(endpoint==='/api/pet/battle/home'){home++;return {me:{id:42}};}
  if(endpoint==='/api/pet/world/lotto'){if(!eligible)throw rejected();return {};}
  if(endpoint==='/api/pet/world/tax')return {};
  assert.equal(endpoint,'/api/pet/world');
  const now=Math.floor(Date.now()/1000);R.b12ConfigureClock(next.state.clockStart);return {now,coins:100000,rev:1,clockStart:next.state.clockStart,isleDay:R.isleDay(now),nextIsleAt:R.b12NextIsleBoundary(now),state:R.newWorld(now),prices:{}};
 };
 next.replan=()=>{};next.finance=null;
 await next.tick();assert.equal(next.state.enabled,false);assert.equal(home,1);
 eligible=true;next.state.nextRun=0;await next.tick();
 assert.equal(home,2);assert.equal(next.state.enabled,true);assert.ok(next.state.lastRecoveryAt);
 }finally{next.close();}
});
test('manual pause cancels automatic auth recovery',async t=>{
 const e=await setup(t);e.state.enabled=true;e.world=null;
 e.sync=async()=>{throw Object.assign(Error('upstream login required'),{readOnly:true,status:403,endpoint:'/api/pet/world'});};
 await e.tick();await e.control({enabled:false});
 e.sync=async()=>{};e.state.nextRun=0;await e.tick();
 assert.equal(e.state.enabled,false);assert.equal(e.snapshot().autoRecovering,false);assert.equal(e.state.lastStop.kind,'manual');
});
test('scheduler heartbeat tolerates idle backoff but detects a hung loop',async t=>{
 const e=await setup(t);assert.equal(e.schedulerHealthy(),false);
 e.state.nextRun=Date.now()+300000;await e.tick();
 assert.equal(e.schedulerHealthy(),true);
 assert.equal(e.schedulerHealthy(e.lastLoopAt+46000),false);
 e.busy=true;e.tickStartedAt=Date.now()-241000;await e.tick();
 assert.equal(e.schedulerHealthy(),false);
});
test('mature harvest executes before optional discovery or stealing',async t=>{
 const e=await setup(t);e.state.enabled=true;e.checkRules=async()=>{};e.world={state:{auto:{on:false}},rev:1};
 e.plan={actions:[{a:'harvest',i:0}],reasons:['harvest']};e.scanVisits=async()=>{throw Error('must not scan');};
 let actions;e.transact=async(_,body)=>{actions=body.actions;return {};};await e.tick();assert.equal(actions[0].a,'harvest');
});
test('version blocks prevent all writes while surveys continue during manual pause',async t=>{
 const e=await setup(t);let polls=0;e.survey.poll=async()=>{polls++;};e.state.enabled=true;
 e.world={coins:100000,now:1794193119,state:R.newWorld(1794193119),prices:{}};
 e.survey.state.assets['/pet-world-rules.js'].changed=true;e.plan={actions:[{a:'sell'}],reasons:[]};
 e.request=async()=>{throw Error('must not write');};
 await assert.rejects(e.transact('/api/pet/world/act',{actions:[]},'test'),/暂停写入/);
 await e.tick();assert.match(e.state.status,/暂停写入/);assert.equal(e.state.pending,null);
 await e.control({enabled:false});e.survey.state.assets['/pet-world-rules.js'].changed=false;
 await e.tick();assert.equal(polls,2);assert.equal(e.state.enabled,false);
});
test('malformed optional write receipt retains pending and compatibility evidence',async t=>{
 const e=await setup(t);e.state.enabled=true;e.request=async()=>({ok:true});
 await assert.rejects(e.transact('/api/pet/battle/chest',{},'test'),/宝箱回执/);
 assert.ok(e.state.pending);assert.ok(e.survey.state.receiptBlock);assert.equal(e.state.enabled,false);
});
test('confirmed cash drift records the receipt before blocking further writes',async t=>{
 const e=await setup(t);const now=Math.floor(Date.now()/1000);e.state.enabled=true;
 e.world={state:R.newWorld(now),now,prices:{},coins:100000};
 e.request=async()=>({coins:99700,rev:2,out:[{ok:true,a:'buy',spend:300}]});
 await e.transact('/api/pet/world/act',{actions:[{a:'buy',id:'feed',n:1}]},'test');
 assert.equal(e.state.pending,null);assert.equal(e.state.ledger.length,1);assert.equal(e.survey.blocked,true);
 await assert.rejects(e.transact('/api/pet/world/act',{actions:[]},'test'),/暂停写入/);
});

test('house upgrades are rejected before any write, even if a planner regresses',async t=>{
 const e=await setup(t);e.request=async()=>{throw Error('must not request');};
 await assert.rejects(e.transact('/api/pet/world/act',{actions:[{a:'upgrade',k:'house'}]},'test'),/小屋/);
 assert.equal(e.state.pending,null);
});
test('training records quoted expense and persists it for finance restart',async t=>{
 const e=await setup(t),gear={coins:100000,daily:{trained:0},prices:{trainDaily:300,trainTiers:[[100,30],[200,45],[300,60]]}},q=trainingPlan(gear);
 e.request=async()=>({...gear,coins:86500,daily:{trained:300}});
 await e.transact('/api/pet/battle/train?xp=300',{operation:'train'},'training',q);
 assert.equal(e.state.pending,null);assert.equal(e.finance.total.expenses,13500);assert.equal(e.state.ledger[0].spend,13500);
 e.close();const next=new Engine(e.dir);await next.init();assert.equal(next.finance.total.expenses,13500);next.close();
});
test('training malformed or inconsistent receipt retains pending and quote',async t=>{
 const e=await setup(t),gear={coins:100000,daily:{trained:0},prices:{trainDaily:300,trainTiers:[[300,30]]}},q=trainingPlan(gear);
 e.request=async()=>({...gear,coins:91000,daily:{trained:200}});
 await assert.rejects(e.transact('/api/pet/battle/train?xp=300',{operation:'train'},'training',q),/回执/);
 assert.equal(e.state.pending.trainingQuote.cost,9000);assert.ok(e.survey.blocked);assert.equal(e.finance.total.expenses,0);
});
test('lottery draw pending backs off across restart while NPC progresses',async t=>{
 const e=await setup(t),now=1794210323,cur=R.lottoDrawId(now);e.world={now,coins:100000,rev:1,state:R.newWorld(now),prices:{}};
 e.world.state.lotto=[{d:cur-1}];e.state.arena=false;e.state.training=false;
 e.request=async url=>url.endsWith('/home')?{me:{},today:{}}:url.endsWith('/gear')?{daily:{trained:300},prices:{trainDaily:300,trainTiers:[[300,30]]}}:{cur,next:1794211200,price:500,last:[]};
 const sent=[];e.transact=async(_,body)=>{sent.push(body.actions);return {out:[{ok:true,a:'lottoClaim',pending:true}]};};
 await e.extras();assert.equal(sent[0][0].a,'lottoClaim');assert.ok(e.state.nextLotteryClaimAt>Date.now()+290000);assert.equal(e.state.pending,null);
 e.nextExtra=0;await e.extras();assert.equal(sent[1][0].a,'npc');await e.save();
 e.close();const next=new Engine(e.dir);await next.init();assert.equal(next.state.nextLotteryClaimAt,e.state.nextLotteryClaimAt);next.close();
});
test('optional activity gets a turn during non-urgent planting loops',async t=>{
 const e=await setup(t);e.state.enabled=true;e.checkRules=async()=>{};e.world={state:{auto:{on:false}},rev:1};
 e.plan={actions:[{a:'plant',i:0}],reasons:['plant']};let calls=0;e.extras=async()=>{calls++;return true;};
 e.scanVisits=async()=>{throw Error('already used this tick');};await e.tick();assert.equal(calls,1);assert.equal(e.state.enabled,true);
});
