import test from 'node:test';
import assert from 'node:assert/strict';
import {R,investmentOptions,workProjection,fieldProjection,planWorld} from '../src/economy.mjs';
const anchor=1794212939;
R.b12ConfigureClock(anchor);
const ts=s=>Date.parse(s+'+08:00')/1000;
const world=(t=anchor)=>{
 const state=R.newWorld(t);R.b12State(state);
 state.plotN=24;state.plots=Array(24).fill(null);state.tools={rod:4,pick:4,spr:3,house:0};state.mine.max=30;
 state.barnN=8;state.barn=[];state.traps=Array.from({length:4},()=>({p:t}));state.inv={};
 return {state,now:t,coins:1000000,prices:{...R.BASE_PRICE}};
};
const capital=p=>p.actions.filter(a=>['upgrade','expand','buyTrap','buyAnimal'].includes(a.a));

test('rod investment retains value after the current mining quota is exhausted',()=>{
 const w=world();w.state.tools.rod=1;w.state.tools.pick=3;w.state.mine.max=16;
 w.state.iq={d:R.isleIndex(w.now),mine:40,bomb:10,fish:30};
 const before=structuredClone(w),rows=investmentOptions(w.state,w.now,w.prices,w.coins);
 assert.ok(rows.find(x=>x.action.k==='rod')?.daily>0);
 assert.ok(!rows.some(x=>x.action.k==='pick'));
 assert.deepEqual(w,before);
});

test('work allocation only replenishes quotas at actual island boundaries through long night',()=>{
 const w=world(ts('2026-11-09T22:00:00'));
 w.state.iq={d:R.isleIndex(w.now),fish:80,mine:40,bomb:10};
 const days=new Set(Array.from({length:24},(_,i)=>R.isleIndex(w.now+i*3600))).size-1;
 const p=workProjection(w.state,w.now,w.prices,100000);
 assert.equal(p.actions.fish,days*R.WORLD.daily.fish);
 assert.equal(p.actions.mine+6*p.actions.bomb,days*R.WORLD.daily.mine);
 assert.equal(p.actions.bomb,days*R.WORLD.daily.bomb);
});

test('a higher pick does not instantly grant deep ore and no energy means no marginal work',()=>{
 const w=world();w.state.mine.max=8;w.state.tools.pick=3;
 assert.equal(workProjection(w.state,w.now,w.prices,0).net,0);
 assert.equal(workProjection(w.state,w.now,w.prices,0).expectedFloor,8);
 assert.ok(workProjection(w.state,w.now,w.prices,24).expectedFloor<16);
});

test('positive investments beyond three days can execute, while pause and cash reserve prevent spending',()=>{
 const w=world();w.state.traps=Array.from({length:3},()=>({p:w.now}));
 w.state.barn=Array.from({length:8},()=>({k:'pig',f:w.now,p:w.now,m:100}));
 const row=investmentOptions(w.state,w.now,w.prices,w.coins).find(x=>x.action.a==='buyTrap');
 assert.ok(row.days>3);
 assert.deepEqual(capital(planWorld(w,{cargo:false})),[{a:'buyTrap'}]);
 assert.deepEqual(capital(planWorld(w,{cargo:false,invest:false})),[]);
 w.coins=row.cost+36000-1;
 assert.deepEqual(capital(planWorld(w,{cargo:false})),[]);
});

test('barn expansion budgets a whole animal and executes both actions together',()=>{
 const w=world();w.state.barnN=5;w.state.barn=Array.from({length:5},()=>({k:'pig',f:w.now,p:w.now,m:100}));
 const before=structuredClone(w),rows=investmentOptions(w.state,w.now,w.prices,w.coins);
 assert.equal(rows.length,R.ANIMALS.length);
 for(const row of rows){
  const a=R.ANIMALS.find(a=>a.id===row.actions[1].k);
  assert.equal(row.cost,R.WORLD.barnPrice(6)+a.price);
  assert.ok(row.delay>0);assert.ok(row.days>row.cost/row.daily);
  assert.deepEqual(row.actions,[{a:'expand',k:'barn'},{a:'buyAnimal',k:a.id}]);
 }
 const p=planWorld(w,{cargo:false});assert.deepEqual(capital(p),rows[0].actions);
 const result=R.applyActions(structuredClone(w.state),p.actions,{t:w.now,day:R.worldDay(w.now),prices:w.prices,coins:w.coins,rand:()=>.5});
 assert.ok(result.out.every(x=>x.ok));assert.equal(result.spend,rows[0].cost);
 assert.deepEqual(w,before);
 w.coins=R.WORLD.barnPrice(6)+36000;
 assert.deepEqual(capital(planWorld(w,{cargo:false})),[]);
});

test('maintenance cannot push half of a barn bundle outside the eight-action live batch',()=>{
 const w=world();w.state.barnN=7;w.state.barn=Array.from({length:7},()=>({k:'pig',f:w.now-23*3600,p:w.now,m:99}));
 w.state.inv={feed:[7,0,0]};w.coins=10000000;
 const p=planWorld(w,{cargo:false});assert.ok(p.actions.some(a=>a.a==='feed'));
 assert.deepEqual(capital(p),[]);
});

test('field projection preserves observed regrowth state and automatic watering spends no water energy',()=>{
 const w=world();w.state.tools.spr=0;
 w.state.plots[8]={c:'strawberry',t:w.now,w:2,g:100,h:3};
 const before=structuredClone(w.state),manual=fieldProjection(w.state,w.now,w.prices,8,0),auto=fieldProjection(w.state,w.now,w.prices,8,2);
 assert.equal(auto.water,0);assert.ok(manual.water>0);
 assert.ok(auto.harvests>0&&manual.harvests>0);
 assert.deepEqual(w.state,before);
});
