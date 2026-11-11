import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {R,planWorld,inventoryValue,forecast,foodChoices,maintenanceReserve,fishExpected,mineExpected} from './economy.mjs';
import {scoreVisit,observeVisit} from './visits.mjs';
import {Survey,inspectSource} from './survey.mjs';
import {receiptIssues,writeContractIssues} from './receipt-check.mjs';
import {Finance} from './finance.mjs';
import {npcActions,lotteryPlan,trainingPlan,trainingReceipt} from './activities.mjs';
export const BASE='https://52dmeme.com';
const transientRead=e=>e.readOnly&&!e.compatibility&&(!e.status||e.status===408||e.status>=500);
export async function atomic(file,value){const temp=file+'.new';await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(temp,file);}
export class Engine {
 constructor(dir,{sourceAccountId=Number(process.env.SOURCE_ACCOUNT_ID)}={}){this.dir=dir;this.sourceAccountId=sourceAccountId;this.busy=false;this.world=null;this.plan=null;this.ruleChecked=0;this.nextExtra=0;this.lastWrite=0;this.nextScan=0;}
 async init(){
  await fs.mkdir(this.dir,{recursive:true,mode:0o700});
  this.lock=new DatabaseSync(path.join(this.dir,'writer-lock.sqlite'));
  try{this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS writer (id INTEGER)');}catch(error){this.lock.close();this.lock=null;throw Error('已有经营实例占用数据目录');}
  this.state=await fs.readFile(path.join(this.dir,'engine.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return {enabled:false,invest:true,steal:true,arena:true,status:'等待接入',since:Date.now(),ledger:[],pending:null,capitalTotal:0};});
  for(const key of ['lottery','npc','training','cargo'])this.state[key]??=true;
  if(!this.state.visitResults){
   const receipts=await fs.readFile(path.join(this.dir,'receipts.jsonl'),'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return '';});
   this.state.visitResults=receipts.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(r=>r.endpoint?.startsWith('/api/pet/world/visit/')&&r.result&&r.at>Date.now()-7*86400000).map(r=>({at:r.at,endpoint:r.endpoint,result:r.result}));
  }
  if(this.state.pending){this.state.enabled=false;this.state.status='存在未确认请求，已暂停，需核对回执';}
  this.ruleHash=createHash('sha256').update(await fs.readFile(new URL('../vendor/world-rules.mjs',import.meta.url))).digest('hex');
  const baseline=JSON.parse(await fs.readFile(new URL('../vendor/survey-baseline.json',import.meta.url),'utf8'));
  if(baseline['/pet-world-rules.js'].semanticHash!==inspectSource(await fs.readFile(new URL('../vendor/world-rules.mjs',import.meta.url),'utf8')).semanticHash)throw Error('测绘基线与已验证规则不一致');
  this.survey=new Survey(path.join(this.dir,'survey'),baseline);await this.survey.init();
  this.finance=new Finance(this.dir,(this.state.baseline?.at||0)*1000);await this.finance.init();
  await this.save();
 }
 async save(){await this.survey?.save();await this.finance?.save();await atomic(path.join(this.dir,'engine.json'),this.state);}
 close(){this.lock?.close();this.lock=null;}
 async request(endpoint,body){
  const cookie=(await fs.readFile(path.join(this.dir,'session.cookie'),'utf8')).trim();
  const cookieHash=createHash('sha256').update(cookie).digest('hex');
  if(this.cookieHash&&this.cookieHash!==cookieHash){this.accountChecked=false;this.state.enabled=false;throw Error('登录会话已更换，需要重新核对账号');}
  this.cookieHash=cookieHash;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let response,data;try{response=await fetch(BASE+endpoint,{method:body?'POST':'GET',redirect:'manual',signal:controller.signal,headers:{cookie,accept:'application/json','content-type':'application/json',origin:BASE,referer:BASE+'/pets','user-agent':'Mozilla/5.0'},...(body?{body:JSON.stringify(body)}:{})});data=await response.json();}catch(error){error.readOnly=!body;if(!body){error.endpoint=endpoint;if(response&&!response.ok)error.status=response.status;}throw error;}finally{clearTimeout(timer);}
  if(!response.ok){const error=new Error('上游 '+response.status+'：'+String(data.error||data.message||'请求失败').slice(0,160));error.status=response.status;error.data=data;error.readOnly=!body;if(!body)error.endpoint=endpoint;throw error;}
  if(!body&&this.survey){const issues=this.survey.observe(endpoint,data);if(issues.length){const e=Error('接口变化：'+issues.join('；'));e.compatibility=true;e.readOnly=true;throw e;}}
  return data;
 }
 async sync(){
  if(!this.accountChecked){if(!Number.isSafeInteger(this.sourceAccountId)||this.sourceAccountId<1)throw Error('请配置 SOURCE_ACCOUNT_ID');const home=await this.request('/api/pet/battle/home');if(home.me?.id!==this.sourceAccountId)throw Error('登录账号与绑定账号不符');this.accountChecked=true;}
  const j=await this.request('/api/pet/world');
  if(!j.state||!Number.isFinite(j.coins)||!Number.isFinite(j.rev))throw Error('上游状态结构变化，停止执行');
  if(this.state.clockStart&&this.state.clockStart!==j.clockStart){this.survey.recordReceipt(['长夜时钟起点发生变化，需要重新核验']);throw Error('长夜时钟起点发生变化');}
  R.b12ConfigureClock(j.clockStart);this.state.clockStart=j.clockStart;
  if(j.isleDay!==R.isleDay(j.now)||j.nextIsleAt!==R.b12NextIsleBoundary(j.now)){this.survey.recordReceipt(['本地岛钟与服务器不一致']);throw Error('本地岛钟与服务器不一致');}
  this.world=j;if(this.survey?.blocked)this.plan=null;else this.replan();
  if(!this.state.baseline)this.state.baseline={coins:j.coins,inventory:inventoryValue(j.state,j.prices),prices:j.prices,at:j.now};
  if(this.finance){this.finance.since=this.state.baseline.at*1000;this.finance.observe(j.now*1000,inventoryValue(j.state,this.state.baseline.prices));}
  if(Date.now()>=(this.nextFund||0)){
   this.nextFund=Date.now()+300000;
   const fund=await this.request('/api/pet/world/tax');this.fundSummary=fund;
   await this.finance?.observeFund(fund);
  }
  return j;
 }
 replan(){
  const now=Date.now(),targets=Object.values(this.state.targets||{});
  const opportunity=this.state.steal&&targets.some(x=>x.available&&x.score?.margin>0&&x.seenAt>now-180000&&now-(x.attemptAt||0)>=300000);
  this.plan=planWorld(this.world,{invest:this.state.invest,cargo:this.state.cargo,energyReserve:opportunity?15+maintenanceReserve(this.world.state,this.world.now):4,reserveAges:this.state.reserveAges||{}});
  this.state.reserveAges??={};
  for(const r of this.plan.reservations||[])this.state.reserveAges[r.id]??=this.world.now;
  // An expired batch cannot be re-locked until its ingredients have cleared.
  for(const id of Object.keys(this.state.reserveAges)){const recipe=R.RECIPES.find(r=>r.id===id);if(recipe&&Object.keys(recipe.in).every(k=>!(this.world.state.inv[k]||[]).some(n=>n>0)))delete this.state.reserveAges[id];}
 }
 async checkRules(){
  await this.survey.poll();
  if(Date.now()>=(this.nextContractProbe||0)){
   this.nextContractProbe=Date.now()+300000;
   // Only re-check previously used, failing read endpoints. No newly found
   // endpoint is invoked automatically, and no POST is used as a probe.
   for(const c of Object.values(this.survey.state.contracts).filter(c=>c.issues?.length&&c.probe).slice(0,3)){
    try{await this.request(c.probe);}catch(e){if(!e.compatibility)throw e;}
   }
  }
 }
 async transact(endpoint,body,reason,trainingQuote){
  if(this.state.pending)throw Error('未确认请求尚未处理');
  if(this.survey?.blocked){const e=Error('暂停写入：'+this.survey.reason);e.compatibility=true;throw e;}
  if(body.actions?.some(a=>a.a==='upgrade'&&a.k==='house'))throw Error('按当前策略，小屋不自动升级');
  if(Date.now()-this.lastWrite<3000)return false;
  const pending={id:body.operation||randomUUID(),endpoint,body,reason,at:Date.now(),coins:trainingQuote?.coins??this.world?.coins,trainingQuote};
  this.state.pending=pending;await this.save();this.lastWrite=Date.now();
  try{
   const result=await this.request(endpoint,body);
   if(!result||typeof result!=='object'||result.error)throw Error('未收到有效交易回执');
   const contract=writeContractIssues(endpoint,result);
   if(contract.length){this.survey?.recordReceipt(contract);throw Error(contract.join('；'));}
   if(endpoint.endsWith('/act')&&(!Array.isArray(result.out)||result.out.length!==body.actions.length||!Number.isFinite(result.rev)))throw Error('动作回执结构不符，需核对');
   for(const key of ['coins','rev'])if(result[key]!==undefined&&(!Number.isFinite(result[key])||result[key]<0))throw Error('回执金额或版本无效');
   for(const o of result.out||[]){if(typeof o.ok!=='boolean')throw Error('回执成功状态无效');for(const key of ['earn','spend','gross','tax','refund'])if(o[key]!==undefined&&(!Number.isFinite(o[key])||o[key]<0))throw Error('回执金额无效');if(o.ok&&o.gross!==undefined&&o.earn!==o.gross-(o.tax||0))throw Error('税前货款、税款与净到账不符');}
   const row={id:pending.id,at:Date.now(),endpoint,actions:body.actions,reason,out:result.out,result:result.result,
    before:pending.coins,after:result.coins,spend:result.out?.reduce((s,o)=>s+(o.ok?o.spend||0:0),0)||0,earn:result.out?.reduce((s,o)=>s+(o.ok?o.earn||0:0),0)||0};
   if(endpoint.startsWith('/api/pet/battle/train?')){
    try{row.training=trainingReceipt(trainingQuote,result);}catch(e){this.survey?.recordReceipt([e.message]);throw e;}
    row.spend=row.training.spend;
    if(!row.training.walletMatches)this.survey?.recordReceipt(['训练次数已确认，钱包变动与阶梯费用不一致；费用按提交前服务端报价记账，需核对外部收支']);
   }
   if(endpoint.endsWith('/act'))this.survey?.recordReceipt(receiptIssues(this.world,body.actions,result));
   this.state.pending=null;this.state.ledger.push(row);this.state.ledger=this.state.ledger.slice(-1500);
   if(endpoint.startsWith('/api/pet/world/visit/')&&row.result)this.state.visitResults=[...(this.state.visitResults||[]),{at:row.at,endpoint,result:row.result}].filter(r=>r.at>Date.now()-7*86400000);
   this.state.capitalTotal=(this.state.capitalTotal||0)+(result.out||[]).filter(o=>o.ok&&['upgrade','expand','buyTrap','buyAnimal'].includes(o.a)).reduce((s,o)=>s+(o.spend||0),0);
   await fs.appendFile(path.join(this.dir,'receipts.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});
   this.finance?.record(row);
   await this.save();await this.sync();return result;
  }catch(error){
   if(!this.state.pending){if(!error.compatibility&&!transientRead(error)&&![409,429].includes(error.status)&&!this.canRecoverRead(error))this.stop('error',error.message);await this.save();throw error;}
   if([400,401,403,404,409,422,429].includes(error.status)){this.state.pending=null;if(error.status===429)this.state.nextRun=Date.now()+Math.max(10000,(error.data?.retry||10)*1000);}
   else this.stop('pending','请求结果未确认，已暂停避免重复操作：'+error.message);
   await this.save();throw error;
  }
 }
 async extras(){
  if(Date.now()<this.nextExtra)return false;
  this.nextExtra=Date.now()+60000;
  const home=await this.request('/api/pet/battle/home'),gear=await this.request('/api/pet/battle/gear');
  this.arenaSummary={me:home.me,today:home.today,daily:gear.daily,free:gear.free,trainDaily:gear.prices.trainDaily,trainTiers:gear.prices.trainTiers};
  const info=this.state.lottery?await this.request('/api/pet/world/lotto'):null;
  if(info)this.lotterySummary={cur:info.cur,next:info.next,price:info.price,checkedAt:Date.now()};
  // Rotate optional activities so unsettled draws and arena progression cannot
  // monopolize the scheduler. Each pass submits at most one bounded batch.
  const kinds=['lottery','npc','training','arena'],start=this.state.extraCursor||0;
  for(let i=0;i<kinds.length;i++){
   const index=(start+i)%kinds.length,kind=kinds[index];if(!this.state[kind])continue;
   let result=false;
   if(kind==='lottery'){
    const plan=lotteryPlan(this.world,info,this.state.nextLotteryClaimAt||0);
    if(plan.actions.length){
     result=await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions:plan.actions},plan.kind==='claim'?'兑奖已开奖彩票':'本期彩票补足30注 · 随机选号');
     if(result&&plan.kind==='claim')this.state.nextLotteryClaimAt=this.world.state.lotto?.some(t=>t.d<info.cur)?Date.now()+300000:0;
    }
   }else if(kind==='npc'){
    const actions=npcActions(this.world.state);
    if(actions.length)result=await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions},'52弟抽牌比大小 · 用完每日共享次数');
   }else if(kind==='training'){
    const quote=trainingPlan(gear);
    if(quote){result=await this.transact('/api/pet/battle/train?xp='+quote.xp,{operation:randomUUID()},'擂台突破训练 +'+quote.xp+' · 阶梯费用 '+quote.cost+'币',quote);if(result)this.arenaSummary.daily=result.daily;}
   }else result=await this.arenaExtra(home,gear);
   if(result){this.state.extraCursor=(index+1)%kinds.length;this.state.status='运行中 · '+kind;return true;}
  }
  return false;
 }
 async arenaExtra(home,gear){
  if(this.state.arena&&gear.daily.ready){await this.transact('/api/pet/battle/chest',{},'领取免费擂台宝箱');return true;}
  // Equipment choices, paid enhancement, respecs and point allocation stay manual.
  const needExperience=(home.me?.progress?.day_xp||0)<(home.me?.progress?.cap||0);
  if(this.state.arena&&(gear.daily.chest<gear.daily.chestMax||needExperience)&&home.today.used<30){
   const opponents=await this.request('/api/pet/battle/opponents?limit=20');
   const pool=opponents.opponents||opponents.items||[];
   const target=pool.filter(x=>x.id!==home.me.id&&x.level<=home.me.level).sort((a,b)=>a.level-b.level)[0];
   if(target){await this.transact('/api/pet/battle',{operation:randomUUID(),opponent_id:target.id},'免费挑战积累经验和宝箱进度');return true;}
  }
  return false;
 }
 scoreTarget(d,history){
  const {state:s,now:t,prices}=this.world,iq=s.iq||{};
  const fish=(iq.fish||0)<R.WORLD.daily.fish?Math.max(fishExpected(s,t,prices,false),fishExpected(s,t,prices,true))/4:0;
  const mineLeft=R.WORLD.daily.mine-(iq.mine||0)-6*(iq.bomb||0);
  const mine=mineLeft>0?mineExpected(s,t,prices)/3:0;
  const bomb=mineLeft>=6&&(iq.bomb||0)<10?mineExpected(s,t,prices,true)/6:0;
  return scoreVisit(d,this.world,history,Math.max(150,fish,mine,bomb));
 }
 async scanVisits(){
  if(!this.state.steal||Date.now()<this.nextScan)return;
  this.nextScan=Date.now()+60000;
  this.state.targets??={};const targets=this.state.targets,now=Date.now();
  // Three sequential pages per pass; resume cursor on the next minute.
  for(let page=0;page<3;page++){
   let d;
   try{d=await this.request('/api/pet/world/neighbors?limit=20'+(this.state.neighborCursor?'&cursor='+encodeURIComponent(this.state.neighborCursor):''));}
   catch(e){if(this.state.neighborCursor&&[400,409].includes(e.status)){this.state.neighborCursor=null;break;}throw e;}
   if(!Array.isArray(d.neighbors))throw Error('邻居列表结构变化');
   for(const n of d.neighbors){if(n.newbie){delete targets[n.id];continue;}const old=targets[n.id];targets[n.id]={...old,id:n.id,name:n.name,level:n.level,available:n.canSteal,score:n.canSteal?old?.score:null,listedAt:now,nextAt:n.canSteal&&!old?.attemptAt?now:(old?.nextAt||now)};}
   this.state.neighborCursor=d.nextCursor||null;
   if(!this.state.neighborCursor)break;
  }
  const due=Object.values(targets).filter(x=>x.nextAt<=now&&now-(x.attemptAt||0)>=300000)
   .sort((a,b)=>Number(b.available)-Number(a.available)||(b.score?.margin||0)-(a.score?.margin||0)||(a.seenAt||0)-(b.seenAt||0)).slice(0,4);
  for(const target of due){
   try{
    const d=await this.request('/api/pet/world/visit/'+target.id);
    if(!d.isle||!d.owner){delete targets[target.id];continue;}
    const history=(this.state.visitResults||[]).filter(r=>r.endpoint==='/api/pet/world/visit/'+target.id&&r.at>Math.max(Date.now()-7*86400000,(this.state.clockStart||0)*1000)).map(r=>r.result);
    targets[target.id]={...target,...observeVisit(d,Date.now()),score:this.scoreTarget(d,history)};
   }catch(e){if([403,404].includes(e.status)){delete targets[target.id];continue;}throw e;}
  }
  this.state.targets=Object.fromEntries(Object.values(targets).filter(x=>now-(x.listedAt||x.seenAt)<86400000)
   .sort((a,b)=>(b.listedAt||b.seenAt)-(a.listedAt||a.seenAt)).slice(0,500).map(x=>[x.id,x]));
  this.visitSummary={tracked:Object.keys(this.state.targets).length,available:Object.values(this.state.targets).filter(x=>x.available).length,checkedAt:Date.now(),
   targets:Object.values(this.state.targets).sort((a,b)=>(b.score?.margin||0)-(a.score?.margin||0)).slice(0,12)};
 }
 async tryVisit(){
  if(!this.state.steal||Date.now()<(this.nextVisit||0))return false;
  const now=Date.now(),losses=(this.state.visitResults||[]).filter(x=>x.at>now-86400000&&x.result?.fine).reduce((s,x)=>s+x.result.fine,0);
  const target=Object.values(this.state.targets||{}).filter(x=>x.available&&x.score?.margin>0&&x.seenAt>now-180000&&now-(x.attemptAt||0)>=300000)
   .sort((a,b)=>b.score.margin-a.score.margin)[0];
  if(!target||losses+target.score.fineMax>10000||this.world.coins<30000+target.score.fineMax)return false;
  const d=await this.request('/api/pet/world/visit/'+target.id);
  if(!d.isle||!d.owner){delete this.state.targets[target.id];return false;}
  const history=(this.state.visitResults||[]).filter(r=>r.endpoint==='/api/pet/world/visit/'+target.id&&r.at>Math.max(now-7*86400000,(this.state.clockStart||0)*1000)).map(r=>r.result);
  const score=this.scoreTarget(d,history);
  this.state.targets[target.id]={...target,...observeVisit(d,now),score};
  if(!score||score.margin<=0||losses+score.fineMax>10000||this.world.coins<30000+score.fineMax)return false;
  const s=this.world.state,maintenance=maintenanceReserve(s,this.world.now),need=score.cost+maintenance;
  if(s.en<need){
   const food=foodChoices(s,this.world.prices)[0];
   if(food&&food.value<score.margin)return !!await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions:[{a:'eat',id:food.id,q:food.q}]},'为已核实的正预期互访目标补充体力');
   if(!food&&(s.cnt.coffee||0)<3&&score.margin>R.WORLD.coffee.price*1.3&&this.world.coins>30000+score.fineMax+R.WORLD.coffee.price)
    return !!await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions:[{a:'coffee'}]},'目标预计净值覆盖整杯咖啡成本，补充互访体力');
   return false;
  }
  // Sack only if this one target's conservative extra yield repays its price.
  if(!R.thiefBuff(s,'sack',this.world.now)&&score.loot*score.probability>R.THIEF_ITEMS.sack.price*1.3&&this.world.coins>30000+score.fineMax+R.THIEF_ITEMS.sack.price)
   return !!await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions:[{a:'buy',id:'sack'}]},'当前目标的保守额外产值覆盖麻袋成本');
  this.state.targets[target.id].attemptAt=now;this.state.targets[target.id].nextAt=now+300000;
  return !!await this.transact('/api/pet/world/visit/'+target.id,{operation:randomUUID(),kind:'all',i:0},'按净值选择互访：'+score.spots+'处，估算净值 '+Math.round(score.margin)+'；成功率情景 '+Math.round(score.probability*100)+'%，样本 '+score.samples);
 }

 stop(kind,reason){
  const message=String(reason).slice(0,200);
  delete this.state.recovery;
  this.state.enabled=false;this.state.lastStop={kind,reason:message,at:Date.now()};
  this.state.status='已暂停 · '+message;
 }
 canRecoverRead(error){
  return error.readOnly&&[401,403].includes(error.status)&&error.endpoint?.startsWith('/api/pet/');
 }
 schedulerHealthy(now=Date.now()){
  return now-(this.busy?this.tickStartedAt:this.lastLoopAt)<(this.busy?240000:45000);
 }
 async tick(){
  this.lastLoopAt=Date.now();
  if(this.busy||Date.now()<(this.state.nextRun||0))return;
  this.busy=true;this.tickStartedAt=this.lastLoopAt;
  let failed=false;
  try{
   // Survey keeps running even while the user pauses production or a version
   // change blocks writes. Never plan against a known-incompatible snapshot.
   await this.checkRules();
   if(this.state.recovery?.endpoint==='/api/pet/world/tax')this.nextFund=0;
   await this.sync();
   const recovery=this.state.recovery;
   if(!this.state.enabled&&recovery&&!this.state.pending&&!this.survey?.blocked){
    if(!['/api/pet/world','/api/pet/battle/home','/api/pet/world/tax'].includes(recovery.endpoint))await this.request(recovery.endpoint);
    this.state.enabled=true;this.state.lastRecoveryAt=Date.now();delete this.state.recovery;
    this.state.status='已自动恢复 · 等待下一轮执行';
    return;
   }
   if(!this.state.enabled){this.state.status=this.state.pending?'请求待核对':this.state.lastStop?'已暂停 · '+this.state.lastStop.reason:'观察中，尚未执行';return;}
   if(this.survey?.blocked){this.state.status='暂停写入 · '+this.survey.reason;return;}
   if(this.world.state.auto?.on){
    const before=this.world.coins;
    await this.transact('/api/pet/world/auto',{rev:this.world.rev,operation:randomUUID(),config:{...this.world.state.auto,on:false}},'新调度接管，关闭官方挂机避免冲突');
    this.state.handoff={at:this.world.now,legacyCashChange:this.world.coins-before};
    this.state.baseline={coins:this.world.coins,inventory:inventoryValue(this.world.state,this.world.prices),prices:this.world.prices,at:this.world.now};
    this.state.capitalTotal=0;
    this.finance=new Finance(this.dir,this.state.baseline.at*1000);await this.finance.init();
    this.state.status='已切换自主调度';return;
   }
   let urgent=this.plan.actions.some(a=>['harvest','collect','trap','feed'].includes(a.a));
   // Mature assets and feeding keep priority. One optional batch per minute
   // also runs during planting/food loops, preventing daily tasks from starving.
   if(!urgent&&await this.extras())return;
   if(!urgent){
    try{
     const scanning=this.state.steal&&Date.now()>=this.nextScan;
     await this.scanVisits();
     if(scanning){await this.sync();urgent=this.plan.actions.some(a=>['harvest','collect','trap','feed'].includes(a.a));}
     if(!urgent&&await this.tryVisit())return;
    }catch(e){
     if(e.status===429){this.state.nextRun=Date.now()+Math.max(60000,(e.data?.retry||60)*1000);throw e;}
     if(!e.readOnly||this.state.pending||e.status&&e.status<500)throw e;
     this.nextScan=this.nextVisit=Date.now()+60000;
     this.visitSummary={...this.visitSummary,error:'互访读取暂时失败，稍后重试'};
    }
    if(this.survey?.blocked){this.plan=null;this.state.status='暂停写入 · '+this.survey.reason;return;}
    this.replan();
   }
   const plan=this.plan;
   if(plan.actions.length){
    const actions=plan.actions.slice(0,8);
    await this.transact('/api/pet/world/act',{rev:this.world.rev,operation:randomUUID(),actions},plan.reasons.slice(0,8));
    this.state.status=this.survey?.blocked?'暂停写入 · '+this.survey.reason:'运行中 · '+plan.reasons[0];
   }else this.state.status='等待成熟、体力或合适行情';
  }catch(e){
   failed=true;
   const reason=String(e.message).slice(0,200);
   if(this.state.pending){if(this.state.lastStop?.kind!=='pending')this.stop('pending','请求结果未确认：'+reason);}
   else if(this.canRecoverRead(e)&&(this.state.enabled||this.state.recovery)){
    if(!this.state.recovery){
     this.stop('read-auth',reason);
     this.state.recovery={endpoint:e.endpoint};
    }
    this.accountChecked=false;
    this.state.nextRun=Date.now()+120000;
    this.state.status='上游暂未通过登录校验，2分钟后复查 · '+reason;
   }else if(e.status===429||transientRead(e)){
    const seconds=e.status===429?Math.max(60,Number(e.data?.retry)||0):Math.min(300,30*2**(this.readFailures||0));
    if(e.status!==429)this.readFailures=Math.min(4,(this.readFailures||0)+1);
    this.state.nextRun=Math.max(this.state.nextRun||0,Date.now()+seconds*1000);
    this.state.status='上游暂不可用，'+seconds+'秒后重试 · '+reason;
   }else if(!e.compatibility&&e.status!==409){
    if(this.state.enabled||this.state.recovery||!this.state.lastStop)this.stop('error',reason);
    else this.state.status='已暂停 · '+this.state.lastStop.reason;
   }else this.state.status=reason;
  }finally{if(!failed)this.readFailures=0;try{await this.save();}finally{this.busy=false;}}
 }
 snapshot(){
  const w=this.world,b=this.state.baseline;
  const capex=this.state.capitalTotal||0;
  return {enabled:this.state.enabled,status:this.state.status,lastStop:this.state.lastStop,lastRecoveryAt:this.state.lastRecoveryAt,autoRecovering:!!this.state.recovery,busy:this.busy,pending:!!this.state.pending,settings:Object.fromEntries(['invest','steal','arena','lottery','npc','training','cargo'].map(k=>[k,this.state[k]])),ruleHash:this.ruleHash,
   world:w?{coins:w.coins,now:w.now,isleNo:w.isleNo,clockStart:w.clockStart,longNight:R.b12IsLongNight(w.now),nextIsleAt:w.nextIsleAt,season:R.SEASONS[R.seasonOf(R.isleDay(w.now))],weather:R.WEATHERS[R.weatherOf(R.isleDay(w.now))],state:w.state,prices:w.prices}:null,
   metrics:w&&b?{since:b.at,cashNet:w.coins-b.coins,capex,operatingNet:w.coins-b.coins+capex,inventoryDelta:inventoryValue(w.state,b.prices)-b.inventory,legacySettlement:this.state.handoff?.legacyCashChange||0}:null,
   plan:this.plan,arena:this.arenaSummary,lottery:this.lotterySummary,fund:this.fundSummary,animals:w?.state.barn?.map(a=>({kind:a.k,...R.b12AnimalStage(a,w.now)})),cargo:w?R.b12Stock(w.now).map(x=>({...x,left:R.b12StockLeft(w.state,x,w.now)})):[],visits:this.visitSummary,survey:this.survey?.snapshot(),ledger:this.state.ledger.slice(-70).reverse()};
 }
 async control(settings){
  if(this.busy)throw Error('正在同步，请稍后再试');
  if(settings.enabled&&this.state.pending)throw Error('先核对未确认请求，不能直接恢复');
  if(settings.enabled&&this.survey?.blocked)throw Error('暂不能启动：'+this.survey.reason);
  if(settings.enabled===false&&(this.state.enabled||this.state.recovery))this.stop('manual','通过看板关闭执行');
  if(settings.enabled===true)delete this.state.recovery;
  for(const key of ['enabled','invest','steal','arena','lottery','npc','training','cargo'])if(typeof settings[key]==='boolean')this.state[key]=settings[key];
  if(settings.rescan===true){this.survey.nextCore=0;this.survey.nextFull=0;this.nextContractProbe=0;}
  await this.save();return this.snapshot();
 }
}
