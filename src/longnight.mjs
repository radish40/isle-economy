import * as R from '../vendor/world-rules.mjs';

// This is a view for valuation only. Never pass a masked view to the executor:
// the shared rule masks reserved inventory itself for each real action.
export function availableState(s){
 const view=structuredClone(s);
 view.inv=Object.fromEntries(Object.keys(s.inv).map(id=>[id,[0,1,2].map(q=>R.b12Available(s,id,q))]));
 if(view.b12)view.b12.vault={};
 return view;
}
export function replenishActions(s){
 const actions=[];
 for(const [id,qs] of Object.entries(s.b12?.keep||{}))for(let q=0;q<3;q++){
  const n=Math.min(qs[q]||0,s.inv[id]?.[q]||0);
  if(n>(s.b12?.vault?.[id]?.[q]||0))actions.push({a:'warehouse',id,q,n,keep:true});
 }
 return actions.slice(0,8);
}
export function seasonEnd(t){
 let at=t;for(let i=0;i<=R.isleSeasonLeft(t);i++)at=R.b12NextIsleBoundary(at);
 return at;
}
export function saleNet(s,t,coins,gross){
 if(!R.b12ClockStart()||t<R.b12ClockStart())return gross;
 return gross-R.b12SaleQuote(coins,s.b12?.tax?.day===R.worldDay(t)?s.b12.tax.paid||0:0,gross).tax;
}
export function cargoChoice(world){
 const {state:s,now:t,coins,prices}=world,day=R.isleDay(t),buffer=Math.max(30000,s.plotN*1500);
 const budget=Math.max(0,Math.min(50000,coins-buffer)),stock=R.b12Stock(t,prices);
 const context={t,day:R.worldDay(t),prices,coins,rand:()=>.5};
 const choices=[];
 for(const item of stock){
  if(!prices[item.id]||!R.BASE_PRICE[item.id])continue;
  const n=Math.min(R.b12StockLeft(s,item,t),Math.floor(budget/item.price));if(n<1)continue;
  const actions=[{a:'stockBuy',id:item.id,n,day},{a:'sell',id:item.id,q:0,n}];
  const result=R.applyActions(structuredClone(s),actions,context),margin=result.earn-result.spend;
  if(result.out.every(o=>o.ok)&&margin>Math.max(200,result.spend*.08))choices.push({kind:'trade',actions,margin,spend:result.spend,name:item.name});
 }
 // Buy only missing components of one currently profitable recipe. Existing
 // materials retain their current sale opportunity cost; no speculative hoard.
 if((s.iq?.craft||0)<R.WORLD.daily.craft&&s.en>=10)for(const recipe of R.RECIPES.filter(r=>r.price)){
  const view=availableState(s),actions=[],existing=[];let cost=0,possible=true;
  for(const [id,need]of Object.entries(recipe.in)){
   let left=need;
   for(let q=0;q<3;q++){const n=Math.min(left,view.inv[id]?.[q]||0);if(n){existing.push({a:'sell',id,q,n});left-=n;}}
   if(left){const item=stock.find(x=>x.id===id);if(!item||left>R.b12StockLeft(s,item,t)){possible=false;break;}cost+=item.price*left;actions.push({a:'stockBuy',id,n:left,day});}
  }
  if(!possible||!actions.length||cost>budget||actions.length>6)continue;
  const opportunity=R.applyActions(structuredClone(s),existing,context).earn;
  actions.push({a:'craft',id:recipe.id,n:1},{a:'sell',id:recipe.id,q:0,n:1});
  const result=R.applyActions(structuredClone(s),actions,context),margin=result.earn-result.spend-opportunity-100;
  if(result.out.every(o=>o.ok)&&margin>Math.max(300,cost*.1))choices.push({kind:'craft',actions,margin,spend:result.spend,name:recipe.name});
 }
 return choices.sort((a,b)=>b.margin-a.margin)[0]||null;
}
export function cargoFood(world){
 const {state:s,now:t,coins}=world,room=R.energyMax(s)-s.en;
 if(s.en>=20||room<8)return null;
 const choices=R.b12Stock(t).flatMap(item=>{
  const crop=R.CROPS.find(c=>c.id===item.id),left=R.b12StockLeft(s,item,t);
  if(!crop||!left||item.price/crop.eat>120)return [];
  const n=Math.min(6,left,Math.floor(room/crop.eat),Math.floor((coins-5000)/item.price));
  return n>0?[{item,crop,n}]:[];
 }).sort((a,b)=>a.item.price/a.crop.eat-b.item.price/b.crop.eat);
 const best=choices[0];if(!best)return null;
 return {name:best.item.name,actions:[{a:'stockBuy',id:best.item.id,n:best.n,day:R.isleDay(t)},...Array.from({length:best.n},()=>({a:'eat',id:best.item.id,q:0}))]};
}
