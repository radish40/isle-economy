import * as R from '../vendor/world-rules.mjs';
import {processingChoices,processingReserves} from './processing.mjs';
import {availableState,replenishActions,seasonEnd,cargoChoice,cargoFood} from './longnight.mjs';
export { R };
export const count = (s,id) => [0,1,2].reduce((a,q)=>a+R.b12Available(s,id,q),0);
const forecasts=new Map();
export function forecast(t, steps=12) {
  const key=R.b12ClockStart()+':'+t+':'+steps;if(forecasts.has(key))return forecasts.get(key);
  const rows=[];
  for(let at=t;rows.length<steps&&at<=t+86400;at=R.b12NextIsleBoundary(at)){
    const day=R.isleDay(at);
    rows.push({at,day,season:R.SEASONS[R.seasonOf(day)],weather:R.WEATHERS[R.weatherOf(day)],events:R.marketEvents(day),prices:Object.fromEntries(Object.keys(R.BASE_PRICE).map(id=>{
      const base=R.BASE_PRICE[id]*R.marketFactor(id,day)*R.eventFactor(id,day);
      return [id,{low:Math.max(1,Math.round(base*.8)),high:Math.max(1,Math.round(base*1.06))}];
    }))});
  }
  if(forecasts.size>200)forecasts.clear();forecasts.set(key,rows);return rows;
}
export function unitValue(s,prices,id,q=0) {
  const p=Math.round((prices[id] || 0)*R.QUALITY[q]);
  return R.CROPS.some(c=>c.id===id)?R.cropTierValue(s.cnt?.['sc_'+id]||0,1,p):p;
}
export function inventoryValue(s,prices) {
  return Object.entries(s.inv).reduce((total,[id,qs])=>total+qs.reduce((v,n,q)=>v+n*Math.round((prices[id]||0)*R.QUALITY[q]),0),0);
}
export function foodChoices(s,prices) {
  const room=Math.max(0,R.energyMax(s)-s.en);
  return R.CROPS.flatMap(c=>(s.inv[c.id]||[]).flatMap((n,q)=>{
    const restore=Math.min(room,Math.round(c.eat*R.QUALITY[q]));
    return R.b12Available(s,c.id,q)>0&&restore>0?[{id:c.id,q,restore,value:unitValue(s,prices,c.id,q),costPerEnergy:unitValue(s,prices,c.id,q)/restore}]:[];
  })).sort((a,b)=>a.costPerEnergy-b.costPerEnergy);
}
export function fishExpected(s,t,prices,bait=false) {
  const weather=R.weatherOf(R.isleDay(t)),pool=R.fishPool(s,t);
  if(!pool.length)return 0;
  const boost=(bait?2:1)*(weather===1?1.5:1);
  const weights=pool.map(f=>f.w*(f.price>=9000?boost:1));
  const miss=Math.max(.05,.22-.04*s.tools.rod-(bait?.08:0)-(weather===1?.05:0));
  const gold=.08+.05*s.tools.rod,quality=gold*1.5+(1-gold)*(.28*1.25+.72);
  return (1-miss)*quality*pool.reduce((v,f,i)=>v+prices[f.id]*weights[i],0)/weights.reduce((a,b)=>a+b,0)-(bait?R.SHOP.bait.price:0);
}
export function mineExpected(s,t,prices,bomb=false) {
  const floor=Math.min(s.mine.max,R.PICK_FLOOR[s.tools.pick]),snow=R.weatherOf(R.isleDay(t))===3;
  const pool=R.ORES.filter(o=>o.floor<=floor),weights=pool.map(o=>o.w*(snow&&o.price>=12000?1.6:1)*(bomb&&o.price>=7000?1.35:1)*(1+(floor-o.floor)/40));
  const mean=pool.reduce((v,o,i)=>v+prices[o.id]*weights[i],0)/weights.reduce((a,b)=>a+b,0);
  return mean*(bomb?6+2*(.3+.05*s.tools.pick):1.25+.05*s.tools.pick)-(bomb?R.SHOP.bomb.price:0);
}
export function craftCandidates(s,prices,reserve={}) {
  return R.RECIPES.filter(r=>r.price).map(r=>{
    let material=0,possible=true;
    for(const [id,need] of Object.entries(r.in)){
      let left=need;
      if(count(s,id)-(reserve[id]||0)<need){possible=false;break;}
      for(let q=0;q<3&&left>0;q++) {const n=Math.min(left,s.inv[id]?.[q]||0);material+=n*unitValue(s,prices,id,q);left-=n;}
    }
    return {id:r.id,name:r.name,material,proceeds:prices[r.id]||0,margin:(prices[r.id]||0)-material,possible};
  }).filter(c=>c.possible).sort((a,b)=>b.margin-a.margin);
}
// Evaluate a full crop lifetime, including different first/repeat growth speeds.
// This is a planning estimate; the executor relies on actual server maturity.
export function cropOptions(s,t,prices,i,energyValue=100) {
  return R.CROPS.filter(c=>c.seasons.includes(R.seasonOf(R.isleDay(t)))).map(c=>{
    const auto=R.sprinkled(s,i)||R.weatherOf(R.isleDay(t))===1;
    const end=seasonEnd(t);
    let times=1,finish=t+c.grow*.8*(auto?.6:.62)*60;
    while(times<(c.times||1)&&finish<end){times++;finish+=(c.regrow||0)*.64*(auto?.6:.62)*60;}
    // Existing plants finish after the season boundary; a new regrowth started
    // outside its planting season dies. Count only harvests it can actually reach.
    const minutes=c.grow*.8+(times-1)*(c.regrow||0)*.64;
    const hours=minutes*(auto?.6:.62)/60;
    const yields=1.54,quality=1.285;
    const costs=2+times*(auto?1:4);
    const raw=(prices[c.id]||c.price)*quality;
    const recipes=R.RECIPES.filter(r=>r.price&&Object.keys(r.in).length===1&&r.in[c.id]);
    const processed=Math.max(0,...recipes.map(r=>(prices[r.id]||0)/r.in[c.id]));
    const sale=Math.max(raw,processed);
    const gross=times*yields*sale;
    return {id:c.id,name:c.name,hours,energy:costs,gross,net:gross-c.seed-costs*energyValue,perHour:(gross-c.seed-costs*energyValue)/hours};
  }).sort((a,b)=>b.perHour-a.perHour);
}
export function investmentOptions(s,t,prices,coins) {
  const buffer=Math.max(30000,s.plotN*1500),out=[];
  const add=(name,actions,cost,daily,why,delay=0)=>{if(cost!=null&&Number.isFinite(daily)&&daily>0)out.push({name,actions:Array.isArray(actions)?actions:[actions],action:Array.isArray(actions)?actions[0]:actions,cost,daily,delay,days:delay+cost/daily,affordable:coins-cost>=buffer,why});};
  let sprinkler=null;
  if(s.tools.spr<3){
    sprinkler={saving:0,energy:0};
    for(let i=R.WORLD.sprCover[s.tools.spr];i<Math.min(s.plotN,R.WORLD.sprCover[s.tools.spr+1]);i++){
      const before=fieldProjection(s,t,prices,i,s.tools.spr),after=fieldProjection(s,t,prices,i,s.tools.spr+1);
      sprinkler.saving+=after.net-before.net;sprinkler.energy+=before.energy-after.energy;
    }
  }
  const cheap=R.CROPS.filter(c=>c.seasons.includes(R.seasonOf(R.isleDay(t)))).sort((a,b)=>prices[a.id]/a.eat-prices[b.id]/b.eat)[0];
  const foodAuto=s.tools.spr>0||R.weatherOf(R.isleDay(t))===1;
  const fuelNet=cheap?Math.max(0,1.54*1.285*cheap.eat-(foodAuto?3:6))*24/(cheap.grow*.8*(foodAuto?.6:.62)/60)*2:0;
  const maintenance=Math.max(0,s.plotN-2)*50;
  const storedFood=R.CROPS.reduce((n,c)=>n+[0,1,2].reduce((a,q)=>a+R.b12Available(s,c.id,q)*Math.round(c.eat*R.QUALITY[q]),0),0);
  const workEnergy=Math.max(0,Math.min(2400,s.en+480+fuelNet+Math.min(160,storedFood)-maintenance));
  const baseline=workProjection(s,t,prices,workEnergy);
  if(sprinkler){
    const extra=workProjection(s,t,prices,Math.max(0,workEnergy+sprinkler.energy)).net-baseline.net;
    add('洒水器 Lv'+(s.tools.spr+1),{a:'upgrade',k:'spr'},R.upgradePrice(s,'spr'),sprinkler.saving+extra,'逐分钟比较剩余复收、雨天和换季重种；节省的体力仅在钓矿剩余额度内估值');
  }
  for(const tool of ['rod','pick'])if(s.tools[tool]<4){
    // Finish opening the currently unlocked mine first. Never pay for a new
    // ceiling while the current tool still has unvisited floors.
    if(tool==='pick'&&s.mine.max<R.PICK_FLOOR[s.tools.pick])continue;
    const upgraded=structuredClone(s);upgraded.tools[tool]++;
    const improved=workProjection(upgraded,t,prices,workEnergy),daily=Math.max(0,improved.net-baseline.net)*(tool==='pick'?.75:1);
    add(tool==='rod'?'鱼竿 Lv'+upgraded.tools.rod:'镐子 Lv'+upgraded.tools.pick,{a:'upgrade',k:tool},R.upgradePrice(s,tool),daily,'按当前剩余额度、真实长夜边界与估算体力分配钓矿；梯子按期望逐层推进，非即刻满矿层');
  }
  if(s.plotN<R.WORLD.plotsMax){const c=cropOptions(s,t,prices,s.plotN)[0];add('第'+(s.plotN+1)+'块地',{a:'expand',k:'plot'},R.WORLD.plotPrice(s.plotN+1),Math.max(0,c?.perHour||0)*24,'扣种子与体力机会成本；新增地块按实际洒水器覆盖计算');}
  if(s.traps.length<R.WORLD.trapMax){
    let daily=0;for(let k=1;k<=8;k++){const at=t+k*R.WORLD.trapEvery*60,p=investmentPrices(at,t,prices),pool=R.fishPool(s,at,1),mean=pool.reduce((v,f)=>v+p[f.id]*f.w,0)/pool.reduce((v,f)=>v+f.w,0);daily+=mean*(R.weatherOf(R.isleDay(at))===2?2:1);}
    add('第'+(s.traps.length+1)+'个蟹笼',{a:'buyTrap'},R.WORLD.trapPrice(s.traps.length+1),daily,'按未来8次实际收笼时间、鱼池、风天和价格中位估值；不耗体力');
  }
  const animalEstimate=a=>{
    const adult=R.b12AfterActive(t,R.B12_GROW_DAYS[a.id]*R.ISLE_SPAN),retire=R.b12AfterActive(adult,R.B12_ADULT_DAYS[a.id]*R.ISLE_SPAN);
    const grow=(adult-t)/86400,life=(retire-adult)/86400;
    // Price at adulthood is unknown: use base price and conservative supply,
    // not today's temporary product event, for a multi-week animal investment.
    const daily=Math.max(0,a.productPrice*.8*1.25*1440/a.every-150-100-(a.price*.6+grow*150)/life);
    return {grow,life,daily};
  };
  if(s.barn.length<s.barnN)for(const a of R.ANIMALS){const v=animalEstimate(a);add(a.name,{a:'buyAnimal',k:a.id},a.price,v.daily,'含真实幼年等待、喂养体力、保守成年售价和退休折旧',v.grow);}
  if(s.barn.length===s.barnN&&s.barnN<R.WORLD.barnMax)for(const a of R.ANIMALS){const v=animalEstimate(a);add('扩畜栏并添'+a.name,[{a:'expand',k:'barn'},{a:'buyAnimal',k:a.id}],R.WORLD.barnPrice(s.barnN+1)+a.price,v.daily,'扩栏与幼崽全款一起预算；含幼年等待和退休折旧，不投资空栏',v.grow);}
  return out.sort((a,b)=>a.days-b.days);
}
const investmentPriceCache=new Map();
function investmentPrices(at,start,current){
 const day=R.isleDay(at);if(day===R.isleDay(start))return current;
 const key=R.b12ClockStart()+':'+day;
 if(!investmentPriceCache.has(key)){
  if(investmentPriceCache.size>100)investmentPriceCache.clear();
  investmentPriceCache.set(key,Object.fromEntries(Object.entries(R.BASE_PRICE).map(([id,p])=>[id,Math.max(1,p*R.marketFactor(id,day)*R.eventFactor(id,day)*.93)])));
 }
 return investmentPriceCache.get(key);
}
export function workProjection(s,t,prices,energy){
 const view=structuredClone(s);let pool=0,net=0,depth=Math.min(s.mine.max,R.PICK_FLOOR[s.tools.pick]),index=R.isleIndex(t);
 let used=s.iq?.d===index?{fish:s.iq.fish||0,mine:s.iq.mine||0,bomb:s.iq.bomb||0}:{fish:0,mine:0,bomb:0};
 const actions={fish:0,mine:0,bomb:0};
 // Bounded hourly allocation, with the same shared mining quota convention as
 // the live planner. Unused energy can represent food carried to later hours.
 for(let hour=0;hour<24;hour++){
  const at=t+hour*3600,day=R.isleIndex(at),p=investmentPrices(at,t,prices);pool+=energy/24;
  if(day!==index){index=day;used={fish:0,mine:0,bomb:0};}
  for(let n=0;n<100&&pool>=3;n++){
   view.mine.max=Math.floor(depth);
   const mineLeft=R.WORLD.daily.mine-used.mine-6*used.bomb;
   const jobs=[...(used.fish<R.WORLD.daily.fish?[{a:'fish',cost:4,value:Math.max(fishExpected(view,at,p),fishExpected(view,at,p,true))}]:[]),...(mineLeft>0?[{a:'mine',cost:3,value:mineExpected(view,at,p)}]:[]),...(mineLeft>=6&&used.bomb<R.WORLD.daily.bomb?[{a:'bomb',cost:6,value:mineExpected(view,at,p,true)}]:[])].filter(j=>j.cost<=pool&&j.value>j.cost*100).sort((a,b)=>b.value/b.cost-a.value/a.cost);
   const job=jobs[0];if(!job)break;
   pool-=job.cost;net+=job.value-job.cost*100;used[job.a]++;actions[job.a]++;
   if(job.a!=='fish')depth=Math.min(R.PICK_FLOOR[s.tools.pick],depth+(job.a==='bomb'?.6:.25));
  }
 }
 return {net,actions,energyUsed:energy-pool,expectedFloor:Math.floor(depth)};
}
export function fieldProjection(s,t,prices,index,spr){
 const view={...s,tools:{...s.tools,spr}},end=t+86400;let plant=structuredClone(s.plots[index]||null),net=0,water=0,harvests=0,energy=0;
 for(let at=t;at<end;at+=60){
  const p=investmentPrices(at,t,prices),auto=index<R.WORLD.sprCover[spr]||R.weatherOf(R.isleDay(at))===1;
  if(!plant){const c=R.CROPS.find(c=>c.id===cropOptions(view,at,p,index)[0]?.id);if(!c)continue;net-=c.seed+200;energy+=2;plant={c:c.id,t:at,w:0,g:0,h:0};}
  const st=R.cropStage(plant,at,auto);
  if(st.stage<0){plant=null;net-=100;energy++;continue;}
  if(st.stage===3){
   const w=auto?3:plant.w,quality=1+.5*(.05+.1*w)+.25*(.2+.08*w),yieldN=plant.sv?.length?1:1.3+.08*w;
   net+=p[plant.c]*quality*yieldN-100;harvests++;energy++;
   plant=st.crop.regrow&&plant.h+1<(st.crop.times||1)?{c:plant.c,t:at,w:0,g:0,h:plant.h+1}:null;
  }else if(!auto&&plant.w<=st.stage){plant.w++;plant.g+=Math.floor(st.left*.25);net-=100;water++;energy++;}
 }
 return {net,water,harvests,energy};
}
export function defenseChoice(s,t,prices,coins){
 const exposure=s.plots.reduce((v,p)=>v+(p?(prices[p.c]||0):0),0);
 const active=R.b12Effect(s,'alert',t),until=active?.until||0;
 // Insurance budget, not an asserted reduction in theft probability.
 const budget=exposure*.025;
 const choice=Object.entries(R.GUARD_ITEMS).filter(([,g])=>g.slot==='alert').sort((a,b)=>b[1].detect/b[1].price-a[1].detect/a[1].price).find(([,g])=>g.price<=budget&&coins-g.price>=30000);
 return {exposure,detect:R.GUARD_ITEMS[active?.id]?.detect||0,until,action:!active&&choice?{a:'buy',id:choice[0]}:null};
}
export function maintenanceReserve(s,t){
 const rain=R.weatherOf(R.isleDay(t))===1;
 return Math.max(4,s.plots.filter((p,i)=>p&&R.cropStage(p,t,R.sprinkled(s,i)||rain).stage>=0&&R.cropStage(p,t,R.sprinkled(s,i)||rain).left<=600).length+2);
}
export function planWorld(world,options={}) {
  const s=structuredClone(world.state),t=world.now,prices=world.prices;
  R.refresh(s,t);if(s.iq?.d!==R.isleIndex(t))s.iq={d:R.isleIndex(t)};
  const actions=[],reasons=[];let coins=world.coins;
  const weather=R.weatherOf(R.isleDay(t)),floor=Math.min(s.mine.max,R.PICK_FLOOR[s.tools.pick]);
  const future=forecast(t,7),buffer=Math.max(30000,s.plotN*1500);
  const append=(a,why)=>{
    if(actions.length>=32)return false;
    const result=R.applyActions(s,[a],{t,day:R.worldDay(t),prices,coins,rand:()=>.5});
    if(!result.out[0]?.ok)return false;
    coins+=result.earn-result.spend;actions.push(a);reasons.push(why);return true;
  };
  const ensure=(need,maxFoodCost=Infinity)=>{
    for(let k=0;s.en<need&&k<10;k++){
      // Harvest quality and quantity are random; eat only stock already observed
      // at the start of this plan, net of meals scheduled earlier in the batch.
      const food=foodChoices(s,prices).find(({id,q})=>R.b12Available(world.state,id,q)>
        actions.filter(a=>a.a==='eat'&&a.id===id&&a.q===q).length);
      if(!food||food.costPerEnergy>maxFoodCost||!append({a:'eat',id:food.id,q:food.q},'用单位体力成本最低的食物补充'))break;
    }return s.en>=need;
  };
  const foodReserve={};
  for(const c of R.CROPS){const qs=s.inv[c.id]||[];if(qs.some(n=>n>0)&&(prices[c.id]||0)/c.eat<=130){foodReserve[c.id]=Math.min(count(s,c.id),Math.ceil(160/c.eat));break;}}
  // Mature goods first. A further tick re-plans using actual random harvests.
  s.barn.forEach((a,i)=>{
    const st=R.animalReady(a,t);if(st.ready)append({a:'collect',i},'收取畜产，避免窝满停产');
    if(st.retired)return;
    if(!s.cnt['pet'+i]&&a.m<100)append({a:'pet',i},'免费提升动物心情');
    if(t-a.f>=22*3600){if(!count(s,'feed')&&coins>buffer)append({a:'buy',id:'feed',n:s.barn.length},'补充一天饲料');if(ensure(1))append({a:'feed',i},'在24小时断粮前续喂');}
  });
  s.traps.forEach((tr,i)=>{if(R.trapReady(tr,t,weather===2).n)append({a:'trap',i},'收取蟹笼');});
  s.plots.forEach((p,i)=>{if(!p)return;const st=R.cropStage(p,t,R.sprinkled(s,i)||weather===1);
    if(st.stage===3&&ensure(1))append({a:'harvest',i},'成熟即收，保留普通操作品质和额外产量');
    else if(st.stage<0&&ensure(1))append({a:'clear',i},'只清理已枯萎作物');
  });
  if(actions.some(a=>['harvest','collect','trap'].includes(a.a)))return {actions,reasons,investments:investmentOptions(world.state,t,prices,world.coins),forecast:future};
  for(const a of replenishActions(s))append(a,'按已配置目标补足仓库预留，不改变人工预留设置');
  if(actions.some(a=>a.a==='warehouse'))return {actions,reasons,investments:[],forecast:future};
  const retired=s.barn.findIndex(a=>R.animalReady(a,t).retired&&!R.animalReady(a,t).ready);
  if(retired>=0&&options.invest!==false){
    const def=R.ANIMALS.find(a=>a.id===s.barn[retired].k);
    if(coins>=buffer+def.price&&append({a:'sellAnimal',i:retired},'收空退休动物后回收40%税前货款')){
      append({a:'buyAnimal',k:def.id},'换养同种幼年动物；成长期间不计产出');
      return {actions,reasons,investments:[],forecast:future};
    }
  }
  if(R.b12GuardRefundQuote(s))append({a:'guardRefund'},'领取旧守家道具未使用时长补偿，单列非经营收入');
  const night=R.b12NightView(s,t);if(night.claimable)append({a:'nightClaim',key:night.key},'领取当前夜潮小礼，不重复领取');
  if(!foodChoices(s,prices).length&&options.cargo!==false){const food=cargoFood({...world,state:s,coins});if(food){for(const a of food.actions)append(a,'货船购入低成本'+food.name+'补充体力');return {actions,reasons,investments:[],forecast:future};}}
  const defense=defenseChoice(s,t,prices,coins);
  if(defense.action)append(defense.action,'警戒槽空缺；按在田价值购买发现率道具（不保证免偷）');
  // Plan chains against raw AND product sale windows; re-evaluate after every
  // chain so shared ingredients cannot be assigned twice.
  const energyValue=foodChoices(s,prices)[0]?.costPerEnergy||100;
  const processing=[];
  for(let k=0;k<12&&(s.iq.craft||0)<R.WORLD.daily.craft;k++){
    const best=processingChoices(availableState(s),prices,future,t,foodReserve,energyValue,coins).find(c=>c.margin>200&&c.actions.length<=R.WORLD.daily.craft-(s.iq.craft||0)&&actions.length+c.actions.length<=32);
    if(!best)break;
    const craftNeed=best.actions.length+maintenanceReserve(s,t);
    if(s.en<craftNeed){ensure(craftNeed,best.margin/best.actions.length);break;}
    for(const a of best.actions)append(a,'加工链 '+best.name+'：预计较原料择时出售多 '+Math.round(best.margin)+'（含体力成本）');
    processing.push({id:best.id,margin:best.margin,steps:best.actions.map(a=>a.id)});
  }
  const held=processingReserves(availableState(s),prices,future,t,foodReserve,coins,options.reserveAges||{});
  // Avoid selling food reserves, and only wait if a future conservative price wins.
  for(const [id,qs]of Object.entries(availableState(s).inv)){
    if(!prices[id])continue;
    const later=Math.max(...future.slice(1).map(f=>f.prices[id]?.low||0));
    const hold=coins>=buffer&&later>prices[id]*1.08;
    if(hold)continue;
    let reserve=held.reserve[id]||0;
    for(let q=0;q<3;q++){const keep=Math.min(qs[q]||0,reserve);reserve-=keep;const n=(qs[q]||0)-keep;if(n>0)append({a:'sell',id,q,n:Math.min(999,n)},coins<buffer?'补充周转资金':'当前价格接近未来24小时保守高点');}
  }
  const details={processing,reservations:held.decisions,defense};
  if(actions.some(a=>['craft','sell','eat','buy'].includes(a.a)))return {actions,reasons,investments:investmentOptions(s,t,prices,coins),forecast:future,...details};
  if(!actions.length&&options.cargo!==false){const cargo=cargoChoice({...world,state:s,coins});if(cargo){for(const a of cargo.actions)append(a,'货船'+(cargo.kind==='craft'?'补料加工':'购销')+' '+cargo.name+'：当前报价扣税后预计增值 '+Math.round(cargo.margin)+'币');return {actions,reasons,investments:[],forecast:future,...details,cargo};}}
  const investments=investmentOptions(s,t,prices,coins);
  // Keep bundled capital actions together within the executor's eight-action
  // batch; finish any earlier maintenance before starting an investment.
  if(options.invest!==false&&!actions.length){const best=investments.find(x=>x.affordable);
    if(best){
      const trial=R.applyActions(structuredClone(s),best.actions,{t,day:R.worldDay(t),prices,coins,rand:()=>.5});
      if(trial.out.every(o=>o.ok)){for(const a of best.actions)append(a,'产能投资：'+best.name+'；模型约'+best.days.toFixed(1)+'天回本，保留'+buffer+'币周转');return {actions,reasons,investments,forecast:future,...details};}
    }
  }
  // Keep a small self-grown food supply. Never remove a productive planted crop.
  const cheapFood=R.CROPS.filter(c=>c.seasons.includes(R.seasonOf(R.isleDay(t)))).sort((a,b)=>(prices[a.id]/a.eat)-(prices[b.id]/b.eat))[0];
  let foodPlots=s.plots.filter(p=>p?.c===cheapFood?.id).length;
  s.plots.forEach((p,i)=>{
    if(p){if(!R.sprinkled(s,i)&&weather!==1){const st=R.cropStage(p,t);if(st.stage>=0&&st.stage<3&&p.w<=st.stage&&ensure(1))append({a:'water',i},'按生长阶段浇水，缩短生长并提高品质');}return;}
    const fuel=foodPlots<2&&count(s,cheapFood.id)<Math.ceil(160/cheapFood.eat);
    const c=R.CROPS.find(c=>c.id===(fuel?cheapFood.id:cropOptions(s,t,prices,i,energyValue)[0]?.id));
    if(c&&coins>=Math.max(5000,c.seed)&&ensure(2)&&append({a:'plant',i,c:c.id},fuel?'补齐低成本食物田':'按收益、体力和生长周期选择当季作物'))if(fuel)foodPlots++;
  });
  const goals=R.dailyGoals(R.worldDay(t),s);
  for(let k=0;k<4;k++)if(!s.cnt['goal'+k]&&(s.cnt[goals[k]?.id]||0)>=goals[k]?.n)append({a:'goal',k},'领取已完成目标，奖励单独记账');
  if(!s.cnt.goal4&&[0,1,2,3].every(k=>s.cnt['goal'+k]))append({a:'goal',k:4},'领取全部目标奖励');
  if(actions.length)return {actions,reasons,investments,forecast:future,...details};
  // The public rule currently increments real-day mine for bombs but not iq.mine.
  // Charge six quota units ourselves; never rely on that discrepancy to exceed limits.
  const fishLeft=R.WORLD.daily.fish-(s.iq.fish||0),mineLeft=R.WORLD.daily.mine-(s.iq.mine||0)-6*(s.iq.bomb||0);
  const without=fishExpected(s,t,prices,false),withBait=fishExpected(s,t,prices,true);
  const bait=withBait>without,fish=bait?withBait:without,mine=mineExpected(s,t,prices),bomb=mineExpected(s,t,prices,true);
  const work=[...(fishLeft>0?[{action:{a:'fish',bait},cost:4,value:fish,label:'钓鱼'}]:[]),...(mineLeft>0?[{action:{a:'mine',f:floor},cost:3,value:mine,label:'采矿'}]:[]),...((s.iq.bomb||0)<10&&mineLeft>=6?[{action:{a:'bomb',f:floor},cost:6,value:bomb,label:'炸矿'}]:[])].sort((a,b)=>b.value/b.cost-a.value/a.cost);
  const job=work[0];
  const energyReserve=Math.max(maintenanceReserve(s,t),options.energyReserve||0);
  if(job&&job.value/job.cost>R.WORLD.coffee.price/R.WORLD.coffee.energy*1.3&&s.en<job.cost+energyReserve&&!foodChoices(s,prices).length&&(s.cnt.coffee||0)<3&&coins>R.WORLD.coffee.price+5000){
    append({a:'coffee'},'没有可用食物，预计作业收益覆盖咖啡250/体力成本；遵守自然日3杯上限');
  }
  if(job&&job.value>0&&ensure(job.cost+energyReserve,job.value/job.cost/1.3)){
    if(job.action.a==='fish'&&bait&&!count(s,'bait')&&coins>buffer+400)append({a:'buy',id:'bait',n:1},'鱼饵增加的期望收益超过400成本');
    if(job.action.a==='bomb'&&!count(s,'bomb')){if(coins>buffer+2500)append({a:'buy',id:'bomb',n:1},'炸矿期望收益已扣2500炸药成本');else return {actions,reasons,investments,forecast:future};}
    if(job.action.a==='fish'&&bait&&!count(s,'bait'))job.action.bait=false;
    append(job.action,job.label+'：预计净产值/体力 '+Math.round(job.value/job.cost)+'，保留'+energyReserve+'点维护/互访体力');
  }
  return {actions,reasons,investments,forecast:future,...details};
}
