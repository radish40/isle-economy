import test from 'node:test';
import assert from 'node:assert/strict';
import {R,forecast,craftCandidates,foodChoices,planWorld,investmentOptions} from '../src/economy.mjs';
const t=1794193119;
const state=()=>R.newWorld(t);
const prices=Object.fromEntries(Object.keys(R.BASE_PRICE).map(id=>[id,R.priceOf(id,R.isleDay(t))]));
test('forecast encloses both supply extremes and uses island dates',()=>{
 for(const row of forecast(t,12))for(const id of Object.keys(prices)){
   assert.ok(R.priceOf(id,row.day,0)<=row.prices[id].high);
   assert.ok(R.priceOf(id,row.day,1e9)>=row.prices[id].low);
 }assert.equal(forecast(t)[0].day,R.isleDay(t));
});
test('gold ingredients are valued at their sell price, not normal price',()=>{
 const s=state();s.inv={strawberry:[0,0,4]};const p={strawberry:4000,jam:20000};
 assert.equal(craftCandidates(s,p).find(x=>x.id==='jam').margin,-4000);
 s.inv={strawberry:[4,0,0]};assert.equal(craftCandidates(s,p).find(x=>x.id==='jam').margin,4000);
});
test('food selection prices only usable energy and respects empty/full inventory',()=>{
 const s=state();s.en=99;s.inv={turnip:[1,0,0],pumpkin:[1,0,0]};
 assert.equal(foodChoices(s,{turnip:540,pumpkin:9000})[0].restore,1);
 s.en=100;assert.deepEqual(foodChoices(s,prices),[]);
});
test('planner never mutates observed state, and cannot spend the cash reserve on investment',()=>{
 const s=state();s.plots=Array(6).fill(null);const world={state:s,coins:42087,now:t,prices};const before=JSON.stringify(world);
 const p=planWorld(world);assert.equal(JSON.stringify(world),before);
 const capital=p.actions.filter(a=>['upgrade','expand','buyTrap','buyAnimal'].includes(a.a));
 const result=R.applyActions(structuredClone(s),capital,{t,day:R.worldDay(t),prices,coins:42087,rand:()=>.5});
 assert.ok(42087-result.spend>=30000);
 for(const i of investmentOptions(s,t,prices,42087).filter(x=>x.affordable))assert.ok(42087-i.cost>=30000);
});
test('official wage is already in spend; do not subtract wage again',()=>{
 const s=state();s.auto={...R.AUTO_DEFAULT,on:true,t:t-14400,crop:'none',fishPct:0,keep:100,sell:false};
 const r=R.autoSettle(s,{now:t,today:R.isleDay(t),prices,coins:100000,rand:()=>.5});
 assert.equal(r.log.wage,3000);assert.ok(r.spend>=r.log.wage);
});

test('investment candidates exclude house upgrades at every house level',()=>{
 for(let house=0;house<=5;house++){
  const s=state();s.tools.house=house;
  assert.ok(investmentOptions(s,t,prices,10000000).every(x=>!(x.action?.a==='upgrade'&&x.action?.k==='house')));
  assert.ok(planWorld({state:s,now:t,prices,coins:10000000}).actions.every(a=>!(a.a==='upgrade'&&a.k==='house')));
 }
});
