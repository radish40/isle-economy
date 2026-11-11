import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../vendor/world-rules.mjs';
import {npcActions,lotteryPlan,trainingPlan,trainingReceipt,trainingIssues} from '../src/activities.mjs';
import {contractIssues} from '../src/survey.mjs';
const t=1794210323,cur=R.lottoDrawId(t),info={cur,next:1794211200,price:500,last:[]};
const world=()=>({now:t,coins:100000,state:R.newWorld(t)});
const gear=(done=0,coins=100000)=>({coins,daily:{trained:done},prices:{trainDaily:300,trainTiers:[[100,30],[200,45],[300,60]]}});
test('lottery batches buy only remaining held capacity and valid random selections',()=>{
 const w=world();w.state.lotto=Array.from({length:27},()=>({d:cur,n:[1,2,3,4,5],b:1}));
 const p=lotteryPlan(w,info);assert.equal(p.actions.length,3);
 const r=R.applyActions(w.state,p.actions,{t,day:R.worldDay(t),coins:w.coins,prices:{},rand:()=>.5});
 assert.ok(r.out.every(o=>o.ok));assert.equal(r.spend,1500);assert.equal(w.state.lotto.length,30);
 assert.equal(lotteryPlan(structuredClone(w),info).actions.length,0);
});
test('lottery issues claim old holdings first and wait without blocking other tasks',()=>{
 const w=world();w.state.lotto=[{d:cur-1,n:[1,2,3,4,5],b:1}];
 assert.equal(lotteryPlan(w,info).kind,'claim');assert.deepEqual(lotteryPlan(w,info,2000,1000).actions,[]);
 const pending=R.applyActions(w.state,[{a:'lottoClaim'}],{t,day:R.worldDay(t),coins:w.coins,prices:{},rand:()=>.5});
 assert.equal(pending.out[0].pending,true);assert.equal(w.state.lotto.length,1);
 const settled=R.applyActions(w.state,[{a:'lottoClaim'}],{t,day:R.worldDay(t),coins:w.coins,prices:{},rand:()=>.5,draws:{[cur-1]:{n:[1,2,3,4,5],b:1}}});
 assert.equal(settled.earn,1000000);assert.equal(lotteryPlan(w,info).actions.length,8);
});
test('lottery respects funds, rejects price drift and remains bounded',()=>{
 const w=world();w.coins=5499;assert.equal(lotteryPlan(w,info).actions.length,0);
 w.coins=6000;assert.equal(lotteryPlan(w,info).actions.length,2);
 assert.throws(()=>lotteryPlan(w,{...info,price:501}),/单价/);
 assert.ok(contractIssues('/api/pet/world/lotto',{...info,cur:null}).length);
});
test('NPC uses shared daily quota, ties do not consume it and each batch is bounded',()=>{
 const w=world();w.state.cnt.npc=50;const a=npcActions(w.state);assert.equal(a.length,2);
 const draw=R.applyActions(w.state,a,{t,day:R.worldDay(t),coins:w.coins,prices:{},rand:()=>.5});
 assert.ok(draw.out.every(o=>o.res==='draw'));assert.equal(w.state.cnt.npc,50);assert.equal(npcActions(w.state).length,2);
 w.state.cnt.npc=52;assert.deepEqual(npcActions(w.state),[]);
 R.refresh(w.state,t+86400);assert.equal(npcActions(w.state).length,8);
});
test('training follows live tiers and the largest supported affordable batch',()=>{
 assert.equal(trainingPlan(gear()).cost,13500);
 const p=trainingPlan(gear(90));assert.equal(p.xp,200);assert.equal(p.cost,10200);
 assert.equal(trainingPlan(gear(0,5300)).xp,10);
 assert.equal(trainingPlan(gear(0,5299)),null);
 assert.equal(trainingPlan(gear(300)),null);
 assert.equal(trainingPlan(gear(295)),null); // no unverified 5-XP API request
 assert.ok(trainingIssues({...gear(),prices:{trainDaily:300,trainTiers:[[200,30],[100,45]]}}).length);
});
test('training receipt confirms XP and cost provenance without guessing from wallet jumps',()=>{
 const q=trainingPlan(gear()),r=trainingReceipt(q,gear(300,86500));assert.equal(r.spend,13500);assert.equal(r.walletMatches,true);
 const external=trainingReceipt(q,gear(300,96500));assert.equal(external.spend,13500);assert.equal(external.walletMatches,false);
 assert.throws(()=>trainingReceipt(q,gear(200,86500)),/回执/);
 assert.throws(()=>trainingReceipt(q,{coins:86500}),/训练/);
});
