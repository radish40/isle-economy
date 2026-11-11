import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
export const HALF_HOUR=1800000;
const capital=new Set(['upgrade','expand','buyAnimal','buyTrap']);
const empty=at=>({at,income:0,expenses:0,capex:0,capitalRecovery:0,operating:0,cashNet:0,external:0,saleTax:0,balanceTax:0,refund:0,subsidy:0,transactions:0});
export class Finance {
 constructor(dir,since=0){this.dir=dir;this.since=since;this.buckets=new Map();this.seen=new Set();this.total=empty(since);this.samples=[];this.external=[];this.fund={events:[],checkedAt:0,gaps:0};this.dirty=false;}
 async init(){
  try{this.samples=JSON.parse(await fs.readFile(path.join(this.dir,'finance-samples.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{this.external=JSON.parse(await fs.readFile(path.join(this.dir,'external-income.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{this.fund=JSON.parse(await fs.readFile(path.join(this.dir,'public-fund.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const event of this.fund.events)this.record(event);
  const externalIds=new Set();this.external=this.external.filter(e=>Number.isFinite(e.at)&&Number.isFinite(e.amount)&&e.amount>0&&e.id&&!externalIds.has(e.id)&&externalIds.add(e.id));
  try{
   await fs.access(path.join(this.dir,'receipts.jsonl'));
   const lines=createInterface({input:createReadStream(path.join(this.dir,'receipts.jsonl')),crlfDelay:Infinity});
   for await(const line of lines)if(line.trim())this.record(JSON.parse(line));
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 record(row){
  if(!Number.isFinite(row.at)||row.at<this.since||this.seen.has(row.id))return;
  this.seen.add(row.id);
  // Training costs use the server's tier quote and a confirmed XP increment;
  // wallet jumps alone are never treated as activity income or expenses.
  const training=row.endpoint?.startsWith('/api/pet/battle/train?')&&row.training?.source==='server-tier-quote'&&Number.isFinite(row.training.spend)&&row.training.spend>=0;
  const fund=row.endpoint==='/observed/public-fund'&&row.fund;
  if(row.endpoint!=='/api/pet/world/act'&&!row.endpoint?.startsWith('/api/pet/world/visit/')&&!training&&!fund)return;
  const at=Math.floor(row.at/HALF_HOUR)*HALF_HOUR,b=this.buckets.get(at)||empty(at),delta=empty(at);
  for(const o of row.out||[])if(o.ok){
   if(Number.isFinite(o.earn)){if(o.a==='guardRefund'){delta.refund+=o.earn;delta.external+=o.earn;}else if(o.a==='sellAnimal')delta.capitalRecovery+=o.earn;else delta.income+=o.earn;}
   if(Number.isFinite(o.tax))delta.saleTax+=o.tax; // earn is already net of sale tax
   if(Number.isFinite(o.spend)){if(capital.has(o.a))delta.capex+=o.spend;else delta.expenses+=o.spend;}
  }
  if(Number.isFinite(row.result?.fine))delta.expenses+=row.result.fine;
  if(training)delta.expenses+=row.training.spend;
  if(fund?.kind==='pet-world-balance-tax'&&fund.delta<0){delta.balanceTax=-fund.delta;delta.expenses+=delta.balanceTax;}
  if(fund?.kind==='pet-world-subsidy'&&fund.delta>0){delta.subsidy=fund.delta;delta.external+=fund.delta;}
  delta.operating=delta.income-delta.expenses;delta.cashNet=delta.operating-delta.capex+delta.capitalRecovery;delta.transactions=1;
  for(const key of ['income','expenses','capex','capitalRecovery','operating','cashNet','external','saleTax','balanceTax','refund','subsidy','transactions']){b[key]+=delta[key];this.total[key]+=delta[key];}
  this.buckets.set(at,b);
 }
 async observeFund(report){
  const known=new Set(this.fund.events.map(x=>x.id)),occurrences=new Map();
  for(const x of report.history){
   if(x.kind==='pet-world-sale-tax')continue; // already included in net sale receipts
   const key=x.id??[x.kind,x.created_at,x.delta].join(':'),index=occurrences.get(key)||0;occurrences.set(key,index+1);
   const id='fund:'+key+':'+index;
   if(known.has(id))continue;
   const event={id,at:x.created_at*1000,endpoint:'/observed/public-fund',fund:{kind:x.kind,delta:x.delta}};
   this.fund.events.push(event);this.record(event);
  }
  // The source exposes only twenty entries. Surface possible gaps instead of
  // manufacturing missing transactions from current balance or season totals.
  if(this.fund.checkedAt&&report.history.length>=20&&report.history.every(x=>x.created_at*1000>this.fund.checkedAt))this.fund.gaps++;
  this.fund.checkedAt=report.now*1000;
  const file=path.join(this.dir,'public-fund.json');await fs.writeFile(file+'.new',JSON.stringify(this.fund),{mode:0o600});await fs.rename(file+'.new',file);
 }
 observe(at,inventory){
  if(!Number.isFinite(at)||!Number.isFinite(inventory)||at<this.since)return;
  const last=this.samples.at(-1);if(last&&at-last.at<60000)return;
  this.samples.push({at,inventory});this.samples=this.samples.filter(x=>x.at>=at-8*86400000);this.dirty=true;
  // Receipts stay on disk; retain only the chart's recent buckets in memory.
  for(const key of this.buckets.keys())if(key<at-8*86400000)this.buckets.delete(key);
 }
 async save(){if(!this.dirty)return;const file=path.join(this.dir,'finance-samples.json');await fs.writeFile(file+'.new',JSON.stringify(this.samples),{mode:0o600});await fs.rename(file+'.new',file);this.dirty=false;}
 report(now=Date.now(),hours=24){
  const start=Math.floor(Math.max(this.since,now-Math.min(168,Math.max(1,hours))*3600000)/HALF_HOUR)*HALF_HOUR;
  const rows=[];
  for(let at=start;at<=now;at+=HALF_HOUR){
   const end=at+HALF_HOUR,b={...(this.buckets.get(at)||empty(at)),end,open:end>now,partial:at<this.since};
   b.external+=this.external.filter(e=>e.at>=Math.max(at,this.since)&&e.at<end&&e.at<=now).reduce((n,e)=>n+e.amount,0);
   const within=this.samples.filter(s=>s.at>=Math.max(at,this.since)&&s.at<end&&s.at<=now),prev=this.samples.findLast(s=>s.at<at&&s.at>=this.since);
   const first=prev&&at-prev.at<=90000?prev:within[0],last=within.at(-1);
   b.inventoryDelta=first&&last?last.inventory-first.inventory:null;
   b.inventoryFrom=first?.at??null;b.inventoryTo=last?.at??null;
   const points=first?[first,...within.filter(s=>s.at>first.at)]:[];
   b.inventoryPartial=!first||!last||first.at>Math.max(at,this.since)+90000||Math.min(end,now)-last.at>90000||points.some((s,i)=>i>0&&s.at-points[i-1].at>120000);
   rows.push(b);
  }
  const external=this.external.filter(e=>e.at>=this.since&&e.at<=now);
  return {since:this.since,now,intervalMs:HALF_HOUR,rows,totals:{...this.total,external:this.total.external+external.reduce((v,e)=>v+e.amount,0)},external,fundCoverage:{checkedAt:this.fund.checkedAt,possibleGaps:this.fund.gaps},
   inventorySince:this.samples[0]?.at??null,note:'经营结余=税后经营收入−日常支出；净现金流再扣基建、加回退休动物回收款。红包、补偿、补贴单列；库存估值未到账。'};
 }
}
