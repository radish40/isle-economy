import * as R from '../vendor/world-rules.mjs';
import {trainingIssues} from './activities.mjs';
const deterministic=new Set(['buy','sell','craft','upgrade','expand','buyAnimal','sellAnimal','buyTrap','plant','coffee','eat','water','feed','lotto','stockBuy','warehouse','guardRefund','nightClaim']);
export function writeContractIssues(endpoint,result){
 const issues=[],num=v=>Number.isFinite(v)&&v>=0;
 if(endpoint.startsWith('/api/pet/world/visit/')){
  const r=result?.result;
  if(!r||!['win','lose','draw'].includes(r.outcome)||!num(r.n)||!num(r.energy)||!num(r.fine)||!Array.isArray(r.items))issues.push('互访结算结构不符');
 }else if(endpoint==='/api/pet/world/auto'){
  if(!result?.state||!num(result.rev))issues.push('挂机开关回执结构不符');
 }else if(endpoint.startsWith('/api/pet/battle/train?')){
  issues.push(...trainingIssues(result));
 }else if(endpoint==='/api/pet/battle/chest'){
  if(!result?.daily||!Array.isArray(result.catalog)||typeof result.got?.item!=='string')issues.push('宝箱回执结构不符');
 }else if(endpoint==='/api/pet/battle'){
  if(!Array.isArray(result?.battle?.fighters)||!Array.isArray(result?.battle?.events)||![-1,0,1].includes(result?.battle?.winner))issues.push('擂台战报结构不符');
 }
 return issues;
}
// Only compare deterministic batches at the same market/day boundary. Random
// harvests, combat and fishing require distributions, not one-sample alarms.
export function receiptIssues(world,actions,result,now=Math.floor(Date.now()/1000)){
 if(!world?.state||!actions?.length||actions.some(a=>!deterministic.has(a.a)))return [];
 if(!Array.isArray(result.out)||result.out.length!==actions.length)return ['动作回执数量不符'];
 if(!result.out.every(o=>o.ok))return [];
 if(R.isleIndex(world.now)!==R.isleIndex(now)||R.worldDay(world.now)!==R.worldDay(now))return [];
 const s=structuredClone(world.state),issues=[];let coins=world.coins;
 for(let i=0;i<actions.length;i++){
  const expected=R.applyActions(s,[actions[i]],{t:world.now,day:R.worldDay(world.now),prices:world.prices,coins,rand:()=>.5}).out[0];
  const actual=result.out[i];if(!expected?.ok)return [];
  for(const k of ['spend','earn','tax'])if(Math.abs((actual[k]||0)-(expected[k]||0))>.01)issues.push(actions[i].a+' '+k+'：预期 '+(expected[k]||0)+'，实收 '+(actual[k]||0));
  coins+=(expected.earn||0)-(expected.spend||0);
 }
 return issues;
}
