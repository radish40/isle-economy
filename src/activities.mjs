import {randomInt} from 'node:crypto';
import * as R from '../vendor/world-rules.mjs';

export const ACTIVITY_RESERVE=5000;
export function npcActions(state){
 const used=state.cnt?.npc??0;
 if(!Number.isInteger(used)||used<0)throw Error('52弟次数结构不符');
 return Array.from({length:Math.max(0,Math.min(8,R.NPC.daily-used))},()=>({a:'npc',g:'card'}));
}
export function lotteryIssues(info){
 const issues=[];
 if(!Number.isInteger(info?.cur)||info.cur<0||!Number.isFinite(info?.next)||!Array.isArray(info?.last))issues.push('彩票期号或开奖时间结构不符');
 if(info?.price!==R.LOTTO.price)issues.push('彩票单价与已验证规则不符');
 return issues;
}
export function lotteryPlan(world,info,claimAfter=0,now=Date.now(),rng=randomInt){
 const issues=lotteryIssues(info);if(issues.length)throw Error(issues.join('；'));
 const held=world.state.lotto??[];
 if(!Array.isArray(held)||held.some(t=>!Number.isInteger(t.d)))throw Error('持有彩票结构不符');
 const old=held.some(t=>t.d<info.cur);
 if(old)return now>=claimAfter?{kind:'claim',actions:[{a:'lottoClaim'}]}:{kind:'waiting',actions:[]};
 const n=Math.max(0,Math.min(8,R.LOTTO.max-held.length,Math.floor((world.coins-ACTIVITY_RESERVE)/info.price)));
 const actions=Array.from({length:n},()=>{
  const pool=Array.from({length:R.LOTTO.nums},(_,i)=>i+1),numbers=[];
  for(let i=0;i<R.LOTTO.pick;i++)numbers.push(pool.splice(rng(pool.length),1)[0]);
  return {a:'lotto',n:numbers.sort((a,b)=>a-b),b:rng(R.LOTTO.balls)+1};
 });
 return {kind:'buy',actions};
}
export function trainingIssues(gear){
 const issues=[],p=gear?.prices,done=gear?.daily?.trained;
 if(!Number.isFinite(gear?.coins)||gear.coins<0)issues.push('训练余额结构不符');
 if(!Number.isSafeInteger(done)||done<0||!Number.isSafeInteger(p?.trainDaily)||p.trainDaily<0||done>p.trainDaily)issues.push('训练次数或上限结构不符');
 const tiers=p?.trainTiers;
 if(!Array.isArray(tiers)||!tiers.length||tiers.some((x,i)=>!Array.isArray(x)||x.length!==2||!Number.isSafeInteger(x[0])||x[0]<=0||!Number.isSafeInteger(x[1])||x[1]<=0||i>0&&x[0]<=tiers[i-1][0]))issues.push('训练阶梯价格结构不符');
 return issues;
}
export function trainingCost(done,xp,tiers){
 let cost=0;
 for(let i=done;i<done+xp;i++)cost+=(tiers.find(([upTo])=>i<upTo)||tiers.at(-1))[1];
 return cost;
}
export function trainingPlan(gear){
 const issues=trainingIssues(gear);if(issues.length)throw Error(issues.join('；'));
 const done=gear.daily.trained,limit=gear.prices.trainDaily,tiers=gear.prices.trainTiers;
 const xp=[300,200,100,50,10].find(n=>n<=limit-done&&trainingCost(done,n,tiers)<=gear.coins-ACTIVITY_RESERVE);
 return xp?{xp,done,limit,tiers,coins:gear.coins,cost:trainingCost(done,xp,tiers)}:null;
}
export function trainingReceipt(quote,result){
 const issues=trainingIssues(result);if(issues.length)throw Error(issues.join('；'));
 if(!quote||result.daily.trained!==quote.done+quote.xp||result.prices.trainDaily!==quote.limit||JSON.stringify(result.prices.trainTiers)!==JSON.stringify(quote.tiers))throw Error('训练回执与提交前次数或价格不符');
 return {xp:quote.xp,beforeTrained:quote.done,afterTrained:result.daily.trained,spend:quote.cost,source:'server-tier-quote',walletDelta:quote.coins-result.coins,walletMatches:quote.coins-result.coins===quote.cost};
}
