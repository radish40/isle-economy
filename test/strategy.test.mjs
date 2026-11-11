import test from 'node:test';
import assert from 'node:assert/strict';
import {R,defenseChoice,planWorld} from '../src/economy.mjs';
import {processingChoices,processingReserves,saleValue} from '../src/processing.mjs';
import {scoreVisit,observeVisit} from '../src/visits.mjs';
const t=1794193119;
test('processing compares future raw price and does not turn gold into normal at a loss',()=>{
 const s=R.newWorld(t);s.inv={strawberry:[0,0,4]};
 assert.ok(processingChoices(s,{strawberry:4000,jam:20000},[],t).find(x=>x.id==='jam').margin<0);
 s.inv={strawberry:[4,0,0]};
 const f=[{at:t+14400,prices:{strawberry:{low:6000},jam:{low:22000}}}];
 assert.ok(processingChoices(s,{strawberry:3000,jam:20000},f,t).find(x=>x.id==='jam').margin<0);
});
test('a crown chain consumes actual leaf materials and preserves food quantity',()=>{
 const s=R.newWorld(t);s.inv={diamond:[2,0,0],gold:[4,0,0],coal:[2,0,0],strawberry:[6,0,0]};
 const p={diamond:36000,gold:4200,coal:480,ingot:23000,crown:108000,strawberry:3000,jam:20000};
 const c=processingChoices(s,p,[],t,{strawberry:3}).find(c=>c.id==='crown');
 assert.deepEqual(c.actions.map(x=>x.id),['ingot','crown']);assert.ok(c.margin>0);
 assert.equal(processingChoices(s,p,[],t,{strawberry:3}).some(c=>c.id==='jam'),false);
 const r=R.applyActions(structuredClone(s),c.actions,{t,day:R.worldDay(t),prices:p,coins:100000,rand:()=>.5});
 assert.ok(r.out.every(o=>o.ok));
});
test('partial ingredients have a budget, a reachable missing ingredient, and an expiry',()=>{
 const s=R.newWorld(t);s.inv={strawberry:[3,0,0]};s.plots=[{c:'strawberry',t,g:0,w:0,h:0}];
 const p={strawberry:1000,jam:17000};
 assert.equal(processingReserves(s,p,[],t,{},100000).reserve.strawberry,3);
 assert.equal(processingReserves(s,p,[],t,{},30000).reserve.strawberry,undefined);
 assert.equal(processingReserves(s,p,[],t,{},100000,{jam:t-86400}).reserve.strawberry,undefined);
 s.plots=[];assert.equal(processingReserves(s,p,[],t,{},100000).reserve.strawberry,undefined);
});
test('shared recipe reserves cannot allocate coal twice',()=>{
 const s=R.newWorld(t);s.inv={iron:[3,0,0],gold:[3,0,0],coal:[2,0,0]};s.mine.max=16;s.tools.pick=2;
 const held=processingReserves(s,{iron:100,gold:100,coal:100,ingot:20000,ironbar:10000},[],t,{},1000000);
 assert.ok((held.reserve.coal||0)<=2);
});
test('defense never duplicates active protection or spends the operating buffer',()=>{
 const s=R.newWorld(t);s.plots=Array.from({length:24},()=>({c:'strawberry'}));
 const p={strawberry:10000};assert.equal(defenseChoice(s,t,p,100000).action.id,'guard1');
 s.b12={effects:{alert:{id:'guard1',until:t+1}}};assert.equal(defenseChoice(s,t,p,100000).action,null);
 s.b12.effects.alert.until=t;assert.equal(defenseChoice(s,t,p,30000).action,null);
});
const visit=()=>({owner:{id:7,guard:true,level:100},isle:{plots:[{c:'pumpkin',steal:true,stage:3}],barn:[]},rules:{energy:5,perSpot:1,energyMax:15,fineMax:5000,protect:1800}});
test('a valuable single plot qualifies regardless of guard level; low value does not',()=>{
 const d=visit();assert.ok(scoreVisit(d,{prices:{pumpkin:30000}}).margin>0);
 assert.ok(scoreVisit(d,{prices:{pumpkin:500}}).margin<0);
 d.owner.newbie=true;assert.equal(scoreVisit(d,{prices:{pumpkin:30000}}),null);
});
test('maturity window uses public remaining time plus protection and rechecks ripe plots',()=>{
 const d=visit();d.isle.plots=[{stage:1,left:600,steal:false}];
 const o=observeVisit(d,1000);assert.equal(o.estimatedWindow,2401000);assert.ok(o.nextAt<=o.estimatedWindow);
 d.isle.plots=[{stage:3,steal:false}];assert.equal(observeVisit(d,1000).nextAt,301000);
});
test('losses reduce sparse-sample assumptions and better work raises theft opportunity cost',()=>{
 const d=visit(),world={prices:{pumpkin:30000}};
 const first=scoreVisit(d,world),lost=scoreVisit(d,world,[{n:0}]),work=scoreVisit(d,world,[],1000);
 assert.ok(lost.probability<first.probability);assert.ok(work.margin<first.margin);
});
test('crop opportunity cost accounts for a future daily tier reset',()=>{
 const s=R.newWorld(t);s.cnt.sc_strawberry=400;
 assert.equal(saleValue(s,{strawberry:100},[],t,'strawberry',0,4),280);
 assert.equal(saleValue(s,{strawberry:100},[{at:t+86400,prices:{strawberry:{low:100}}}],t,'strawberry',0,4),400);
});
