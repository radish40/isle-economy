import * as R from '../vendor/world-rules.mjs';
import {saleNet} from './longnight.mjs';
const recipes=R.RECIPES.filter(r=>r.price);
const total=qs=>(qs||[]).reduce((a,b)=>a+b,0);
// Compare attainable sale windows for BOTH sides. Unknown future supply uses
// the conservative end of the forecast, never an assumed guaranteed profit.
export function saleValue(s,prices,future,t,id,q=0,n=1,offset=0,coins=0){
 const crop=R.CROPS.some(c=>c.id===id);
 const value=(p,before,when)=>saleNet(s,when,coins,crop?R.cropTierValue(before,n,Math.round(p*R.QUALITY[q])):n*Math.round(p*R.QUALITY[q]));
 const sold=s.cnt?.['sc_'+id]||0;
 return Math.max(value(prices[id]||0,sold+offset,t),...future.filter(f=>f.at>t).map(f=>value(f.prices[id]?.low||0,(R.worldDay(f.at)===R.worldDay(t)?sold:0)+offset,f.at)));
}
export function processingChoices(s,prices,future,t,reserve={},energy=100,coins=0){
 return recipes.map(recipe=>{
  const inv=structuredClone(s.inv),actions=[],used={};let possible=true;
  const take=(id,n,trail=[])=>{
   let left=n,value=0,offset=used[id]||0;
   const available=Math.max(0,total(inv[id])-(reserve[id]||0));
   let direct=Math.min(left,available);
   for(let q=0;q<3&&direct;q++){
    const m=Math.min(direct,inv[id]?.[q]||0);if(!m)continue;
    value+=saleValue(s,prices,future,t,id,q,m,offset,coins);offset+=m;
    inv[id][q]-=m;direct-=m;left-=m;used[id]=(used[id]||0)+m;
   }
   if(!left)return value;
   const r=recipes.find(r=>r.id===id);
   if(!r||trail.includes(id)){possible=false;return Infinity;}
   for(let k=0;k<left;k++){
    let cost=energy;
    for(const [key,num]of Object.entries(r.in))cost+=take(key,num,[...trail,id]);
    actions.push({a:'craft',id,n:1});
    // An intermediate can itself be sold instead of consumed downstream.
    value+=Math.max(cost,saleValue(s,prices,future,t,id,0,1,0,coins));
   }
   return value;
  };
  let material=0;for(const [id,n]of Object.entries(recipe.in))material+=take(id,n,[recipe.id]);
  actions.push({a:'craft',id:recipe.id,n:1});
  const proceeds=saleValue(s,prices,future,t,recipe.id,0,1,0,coins);
  return {id:recipe.id,name:recipe.name,material,proceeds,margin:proceeds-material-energy,possible,actions,used};
 }).filter(c=>c.possible).sort((a,b)=>b.margin-a.margin);
}
// Preserve at most one incomplete batch per recipe, using a shared allocation
// ledger. Only missing goods that current infrastructure can produce qualify.
export function processingReserves(s,prices,future,t,food={},coins=0,ages={}){
 const reserve={...food},decisions=[],budget=Math.min(50000,Math.max(0,coins-30000)*.15);let locked=0;
 const reachable=id=>s.plots.some((p,i)=>p?.c===id&&R.cropStage(p,t,R.sprinkled(s,i)).stage>=0)||s.barn.some(a=>R.ANIMALS.find(x=>x.id===a.k)?.product===id&&R.animalReady(a,t).fed)||R.ORES.some(o=>o.id===id&&o.floor<=Math.min(s.mine.max,R.PICK_FLOOR[s.tools.pick]));
 const ranked=recipes.map(r=>{
  let material=0,have=0,need=0;const keep={};let feasible=true;
  for(const [id,n]of Object.entries(r.in)){
   let left=n;const avail=Math.max(0,total(s.inv[id])-(food[id]||0));keep[id]=Math.min(n,avail);have+=keep[id];need+=n;
   for(let q=0;q<3&&left;q++){const m=Math.min(left,s.inv[id]?.[q]||0);material+=saleValue(s,prices,future,t,id,q,m,n-left,coins);left-=m;}
   if(left){material+=saleValue(s,prices,future,t,id,0,left,0,coins);if(!reachable(id))feasible=false;}
  }
  return {id:r.id,keep,margin:saleValue(s,prices,future,t,r.id,0,1,0,coins)-material-100,have,need,feasible};
 }).filter(x=>x.feasible&&x.have>0&&x.margin>200).sort((a,b)=>b.margin-a.margin);
 for(const r of ranked){
  if(ages[r.id]&&t-ages[r.id]>=86400)continue;
  if(Object.entries(r.keep).some(([id,n])=>total(s.inv[id])-(reserve[id]||0)<n))continue;
  const value=Object.entries(r.keep).reduce((v,[id,n])=>v+saleValue(s,prices,future,t,id,2,n,0,coins),0);
  if(locked+value>budget)continue;
  for(const [id,n]of Object.entries(r.keep))reserve[id]=(reserve[id]||0)+n;
  locked+=value;decisions.push({...r,locked:value});
 }
 return {reserve,decisions,locked};
}
