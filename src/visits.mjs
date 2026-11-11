import * as R from '../vendor/world-rules.mjs';
export function scoreVisit(d,world,history=[],energyValue=150){
 if(!d.isle||!d.rules||d.owner?.newbie||d.left?.today===0||d.left?.owner===0)return null;
 const crops=d.isle.plots.filter(p=>p?.steal),pens=d.isle.barn.filter(p=>p?.steal),spots=crops.length+pens.length;
 if(!spots)return null;
 const r=d.rules,cost=R.b12StealCost(world.state||{},world.now||0,spots,r.energy,r.perSpot,r.energyMax);
 if(!Number.isFinite(cost)||cost<1||!Number.isFinite(r.fineMax)||r.fineMax<0)return null;
 // One ordinary item per spot is a lower quantity scenario. Do not assume
 // battle bonus, sack yield or livestock availability not returned by server.
 const loot=crops.reduce((v,p)=>v+(world.prices[p.c]||0),0)+pens.reduce((v,p)=>v+(world.prices[R.ANIMALS.find(a=>a.id===p.k)?.product]||0),0);
 if(!Number.isFinite(loot)||loot<=0)return null;
 const wins=history.filter(x=>(x.n||0)>0).length,n=history.length;
 // Wilson lower confidence bound after enough observations. Sparse samples
 // retain a labelled 35% scenario, not an empirical success-rate claim.
 const phat=n?wins/n:0,z=1.64;
 const lower=n?(phat+z*z/(2*n)-z*Math.sqrt(phat*(1-phat)/n+z*z/(4*n*n)))/(1+z*z/n):0;
 const probability=d.owner?.guard===false?1:n>=10?Math.min(.8,lower):Math.min(.35,(1.4+wins)/(4+n));
 const margin=probability*loot-(1-probability)*r.fineMax-cost*energyValue;
 return {id:d.owner.id,spots,cost,loot,probability,samples:n,margin,energyValue,fineMax:r.fineMax};
}
export function observeVisit(d,now){
 const plants=d.isle?.plots||[],ready=plants.some(p=>p?.steal)||(d.isle?.barn||[]).some(p=>p?.steal);
 const waits=plants.filter(p=>p&&p.stage>=0&&p.stage<3&&Number.isFinite(p.left)).map(p=>p.left+(d.rules?.protect||1800));
 // left is an estimate: later watering/harvesting can change it. Always
 // re-read eligibility before a POST. Mature protected plots get a short poll.
 const protectedRipe=plants.some(p=>p?.stage===3&&!p.steal);
 const seconds=ready?60:protectedRipe?300:Math.min(1800,...waits);
 return {id:d.owner.id,name:d.owner.name,level:d.owner.level,seenAt:now,nextAt:now+Math.max(60,seconds)*1000,available:ready,
  estimatedWindow:waits.length?now+Math.min(...waits)*1000:null};
}
