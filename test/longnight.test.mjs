import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../vendor/world-rules.mjs';
import {forecast,planWorld,foodChoices,defenseChoice} from '../src/economy.mjs';
import {availableState,replenishActions,cargoChoice,cargoFood} from '../src/longnight.mjs';
import {receiptIssues} from '../src/receipt-check.mjs';
const anchor=1794212939;
R.b12ConfigureClock(anchor);
const ts=s=>Date.parse(s+'+08:00')/1000;
const world=(t=anchor)=>{const state=R.newWorld(t);R.b12State(state);return {now:t,state,coins:200000,prices:Object.fromEntries(Object.keys(R.BASE_PRICE).map(id=>[id,R.priceOf(id,R.isleDay(t))]))};};
const apply=(w,actions)=>R.applyActions(w.state,actions,{t:w.now,day:R.worldDay(w.now),prices:w.prices,coins:w.coins,rand:()=>.5});

test('island clock, fishing quota and lottery freeze overnight while real energy restores',()=>{
 const a=ts('2026-11-09T22:00:00'),b=ts('2026-11-10T07:59:59'),w=world(a);
 assert.equal(R.isleIndex(a),R.isleIndex(b));assert.equal(R.lottoDrawId(a),R.lottoDrawId(b));
 w.state.en=0;w.state.enT=a;R.refresh(w.state,b);assert.equal(w.state.en,100);
 assert.equal(R.b12NextIsleBoundary(ts('2026-11-09T21:59:00')),ts('2026-11-10T10:00:00'));
 const rows=forecast(ts('2026-11-09T21:00:00'));
 assert.equal(rows[1].at,ts('2026-11-10T10:00:00'));assert.ok(rows.every(r=>r.at<=rows[0].at+86400));
 assert.equal(new Set(rows.map(r=>r.day)).size,rows.length);
});
test('grown crops and adult animal production continue during long night',()=>{
 const t=ts('2026-11-09T22:00:00'),s=world(t).state;
 const p={c:'tomato',t,w:0,g:0,h:0};assert.equal(R.cropStage(p,t+8*3600).stage,3);
 const a={k:'chicken',f:t,p:t,m:100};assert.ok(R.animalReady(a,t+8*3600).n>0);
 assert.equal(R.b12AnimalStage(a,t).stage,2);
});
test('harvest does not feed the same batch with a predicted quality',()=>{
 const w=world(ts('2026-11-11T05:55:22')),s=w.state;
 s.en=1;s.inv={};s.tools.spr=1;
 const p={c:'corn',t:w.now-4*3600,w:0,g:0,h:0};s.plots[0]={...p};s.plots[1]={...p};
 const first=planWorld(w,{invest:false,cargo:false});
 const rolls=[.1,.9];
 const r=R.applyActions(s,first.actions,{t:w.now,day:R.worldDay(w.now),prices:w.prices,coins:w.coins,rand:()=>rolls.shift()??.5});
 assert.equal(r.out[0].got[0].q,2);
 assert.ok(r.out.every(o=>o.ok),JSON.stringify(r.out));
 assert.deepEqual(first.actions,[{a:'harvest',i:0}]);
 const next=planWorld(w,{invest:false,cargo:false});
 assert.deepEqual(next.actions,[{a:'eat',id:'corn',q:2},{a:'harvest',i:1}]);
 assert.ok(apply(w,next.actions).out.every(o=>o.ok));
});
test('juveniles wait for active island days; retired animals retain goods and reject feed',()=>{
 const w=world();w.state.barn=[{k:'pig',born:anchor,f:anchor,p:anchor,m:100}];
 assert.equal(R.animalReady(w.state.barn[0],anchor+3600).n,0);
 const retire=R.b12AnimalStage(w.state.barn[0],anchor).retireAt;
 w.now=retire+1;w.state.barn[0].held=[2];w.state.barn[0].heldAt=retire-1;
 assert.equal(R.animalReady(w.state.barn[0],w.now).n,1);
 const r=apply(w,[{a:'feed',i:0},{a:'collect',i:0}]);assert.equal(r.out[0].ok,false);assert.equal(r.out[1].ok,true);assert.equal(w.state.inv.truffle[2],1);
});

test('feeding buys the shortfall when existing feed is consumed by earlier animals',()=>{
 const w=world();w.state.barn=Array.from({length:3},()=>({k:'pig',f:anchor-23*3600,p:anchor,m:100}));w.state.inv={feed:[1,0,0]};
 const p=planWorld(w,{invest:false,cargo:false}),r=apply(w,p.actions);
 assert.equal(r.out.filter(o=>o.ok&&o.a==='feed').length,3);assert.ok(r.out.some(o=>o.ok&&o.a==='buy'));
});
test('planner collects retired stock before selling and never sells productive animals',()=>{
 const w=world(),a={k:'pig',f:anchor,p:anchor,m:100};w.state.barn=[a];
 w.now=R.b12AnimalStage(a,anchor).retireAt+1;a.held=[2];a.heldAt=w.now-10;w.state.plots=Array(w.state.plotN).fill(null);
 let p=planWorld(w,{invest:true,cargo:false});assert.ok(p.actions.some(x=>x.a==='collect'));assert.ok(!p.actions.some(x=>x.a==='sellAnimal'));
 apply(w,p.actions);p=planWorld(w,{invest:true,cargo:false});assert.deepEqual(p.actions.map(x=>x.a),['sellAnimal','buyAnimal']);
 const live=world();live.state.barn=[{k:'pig',f:anchor,p:anchor,m:100}];assert.ok(!planWorld(live).actions.some(x=>x.a==='sellAnimal'));
});
test('warehouse is a reserved subset; planner neither sells nor eats reserved goods',()=>{
 const w=world();w.state.inv={turnip:[6,0,0],feed:[2,0,0]};w.state.b12.vault={turnip:[6,0,0],feed:[2,0,0]};w.state.en=0;
 assert.equal(availableState(w.state).inv.turnip[0],0);assert.equal(foodChoices(w.state,w.prices).length,0);
 const before=structuredClone(w.state);
 const p=planWorld(w,{invest:false,cargo:false});
 assert.ok(!p.actions.some(x=>x.a==='sell'||x.a==='eat'));
 assert.deepEqual(w.state,before);
 assert.equal(apply(w,[{a:'eat',id:'turnip',q:0}]).out[0].ok,false);
});
test('warehouse replenishment uses existing targets and does not add duplicate inventory',()=>{
 const w=world();w.state.inv={turnip:[6,0,0]};w.state.b12.keep={turnip:[4,0,0]};
 const actions=replenishActions(w.state);assert.deepEqual(actions,[{a:'warehouse',id:'turnip',q:0,n:4,keep:true}]);
 apply(w,actions);assert.equal(w.state.inv.turnip[0],6);assert.equal(R.b12Available(w.state,'turnip',0),2);assert.deepEqual(replenishActions(w.state),[]);
});
test('cargo opportunities obey personal limits, taxes and prices; no blind buying at a loss',()=>{
 const w=world(),item=R.b12Stock(w.now).find(x=>R.BASE_PRICE[x.id]);w.state.inv={};w.state.en=0;
 w.prices=Object.fromEntries(Object.keys(R.BASE_PRICE).map(id=>[id,1]));w.prices[item.id]=item.price*2;
 const c=cargoChoice(w);assert.ok(c&&c.margin>0);assert.ok(c.spend<=50000);assert.ok(c.actions[0].n<=item.limit);
 const r=apply(w,c.actions);assert.ok(r.out.every(x=>x.ok));assert.equal(r.earn-r.spend,c.margin);
 const spent=w.state.b12.shop.n[item.id];assert.equal(R.b12StockLeft(w.state,item,w.now),item.limit-spent);
 w.prices[item.id]=1;assert.equal(cargoChoice(w),null);
 assert.equal(apply(w,[{a:'stockBuy',id:item.id,n:1,day:'stale'}]).out[0].ok,false);
});
test('cargo can fill a profitable recipe without consuming warehouse reserves',()=>{
 let found=false;
 for(let k=0;k<40&&!found;k++){
  const w=world(anchor+k*86400),stock=R.b12Stock(w.now),recipe=R.RECIPES.find(r=>r.price&&Object.keys(r.in).some(id=>stock.some(x=>x.id===id)));
  if(!recipe)continue;
  w.state.inv=Object.fromEntries(Object.entries(recipe.in).map(([id,n])=>[id,[n,0,0]]));
  const missing=Object.keys(recipe.in).find(id=>stock.some(x=>x.id===id));w.state.inv[missing]=[0,0,0];
  w.prices=Object.fromEntries(Object.keys(R.BASE_PRICE).map(id=>[id,1]));w.prices[recipe.id]=200000;
  const choice=cargoChoice(w);if(choice?.kind!=='craft')continue;
  assert.ok(choice.actions.some(a=>a.a==='craft'));assert.ok(apply(w,choice.actions).out.every(o=>o.ok));found=true;
 }
 assert.ok(found);
});
test('old guard refund is one-time; alert slot blocks duplicate purchases',()=>{
 const w=world();w.state.guard={m:.5,until:anchor+86400};assert.equal(R.b12GuardRefundQuote(w.state),2500);
 const r=apply(w,[{a:'guardRefund'},{a:'guardRefund'}]);assert.equal(r.out[0].refund,2500);assert.equal(r.out[1].ok,false);
 w.state.b12.effects={alert:{id:'guard1',until:anchor+86400}};w.state.plots=[{c:'strawberry'}];
 assert.equal(defenseChoice(w.state,anchor,{strawberry:100000},200000).action,null);
});
test('taxed sales report net earn; deterministic receipt check follows marginal tax',()=>{
 const w=world();w.coins=2999999;w.prices={turnip:1000};w.state.inv={turnip:[10,0,0]};
 const before=structuredClone(w),actions=[{a:'sell',id:'turnip',q:0,n:10}],r=apply(w,actions);
 assert.equal(r.out[0].gross,10000);assert.equal(r.out[0].tax,99);assert.equal(r.out[0].earn,9901);
 assert.deepEqual(receiptIssues(before,actions,r,w.now),[]);assert.equal(R.b12BalanceTax(20000000),37000);
});
test('night gifts have one key until next 22:00 and are never claimed twice',()=>{
 const w=world(ts('2026-11-09T22:00:00'));
 for(let seed=0;seed<500;seed++){w.state.b12.storySeed=seed;if(R.b12NightView(w.state,w.now).claimable)break;}
 const view=R.b12NightView(w.state,w.now);assert.equal(view.key,R.b12NightView(w.state,w.now+23*3600).key);
 const r=apply(w,[{a:'nightClaim',key:view.key},{a:'nightClaim',key:view.key}]);assert.equal(r.out[0].ok,true);assert.equal(r.out[1].ok,false);
 assert.notEqual(R.b12NightView(w.state,w.now+86400).key,view.key);
});
