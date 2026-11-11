import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {trainingIssues,lotteryIssues} from './activities.mjs';
const BASE='https://52dmeme.com';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,function(k,v){
 if(k==='start'||k==='end'||k==='loc'||k==='raw'&&this.type==='Literal')return undefined;
 return typeof v==='bigint'?{bigint:String(v)}:v;
});
const modulePath=value=>{
 if(typeof value!=='string')return null;
 const u=new URL(value,BASE);
 return u.origin===BASE&&/^\/(?:pets|pet-[a-z-]+)\.js$/.test(u.pathname)?u.pathname:null;
};
const member=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'&&!n.computed?member(n.object)+'.'+n.property.name:null;
// Parse as data only. Never import, eval, or run downloaded game code.
export function inspectSource(source){
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),symbols={},facts={},dependencies=new Set(),endpoints=new Set();
 const flatten=(n,key)=>{
  if(!n)return;
  if(n.type==='Literal'&&['string','number','boolean'].includes(typeof n.value))facts[key]=n.value;
  else if(n.type==='UnaryExpression'&&n.operator==='-'&&n.argument.type==='Literal'&&typeof n.argument.value==='number')facts[key]=-n.argument.value;
  else if(n.type==='ArrayExpression')n.elements.forEach((v,i)=>flatten(v,key+'['+i+']'));
  else if(n.type==='ObjectExpression')for(const p of n.properties)if(p.type==='Property'&&!p.computed)flatten(p.value,key+'.'+(p.key.name??p.key.value));
 };
 for(const node of ast.body){
  const d=node.type==='ExportNamedDeclaration'?node.declaration:node;
  if(!d)continue;
  if(d.type==='VariableDeclaration')for(const v of d.declarations)if(v.id.type==='Identifier'){symbols[v.id.name]=hash(canonical(v.init));flatten(v.init,v.id.name);}
  if(d.type==='FunctionDeclaration'&&d.id)symbols[d.id.name]=hash(canonical(d));
  if(d.type==='ExpressionStatement'&&d.expression.type==='AssignmentExpression'){
   const a=d.expression,key=member(a.left);if(key){symbols[key]=hash(canonical(a));flatten(a.right,key);}
  }
 }
 const walk=n=>{
  if(!n||typeof n!=='object')return;
  if(n.type==='ImportDeclaration'||n.type==='ImportExpression'){
   const p=modulePath(n.source?.value);if(p)dependencies.add(p);
  }
  if(n.type==='Literal'&&typeof n.value==='string'&&/^\/api\/pet\//.test(n.value))endpoints.add(n.value.split('?')[0]);
  for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);
 };
 walk(ast);
 return {rawHash:hash(source),semanticHash:hash(canonical(ast)),symbols,facts,dependencies:[...dependencies].sort(),endpoints:[...endpoints].sort()};
}
export function sourceDiff(before,after){
 const changes=[];
 for(const key of new Set([...Object.keys(before.facts),...Object.keys(after.facts)]))if(before.facts[key]!==after.facts[key])changes.push({kind:'value',key,before:before.facts[key],after:after.facts[key]});
 for(const key of new Set([...Object.keys(before.symbols),...Object.keys(after.symbols)]))if(before.symbols[key]!==after.symbols[key])changes.push({kind:'code',key});
 if(before.semanticHash!==after.semanticHash&&!changes.length)changes.push({kind:'code',key:'模块结构或入口'});
 return changes;
}
const shape=(value,out={},prefix='$',depth=0)=>{
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 out[prefix]=[...new Set([...(out[prefix]||[]),type])].sort();
 if(depth>=6)return out;
 if(Array.isArray(value))value.slice(0,8).forEach(v=>shape(v,out,prefix+'[]',depth+1));
 else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value).slice(0,100))shape(v,out,prefix+'.'+k,depth+1);
 return out;
};
export const routeKey=endpoint=>endpoint.split('?')[0].replace(/\/\d+(?=\/|$)/g,'/:id');
export function contractIssues(endpoint,d){
 const route=routeKey(endpoint),issues=[];
 const has=(p,type)=>{const v=p.split('.').reduce((o,k)=>o?.[k],d);if(type==='number'?!Number.isFinite(v):type==='array'?!Array.isArray(v):type==='object'?(!v||typeof v!=='object'||Array.isArray(v)):typeof v!==type)issues.push(p+' 必须为 '+type);};
 if(route==='/api/pet/world'){
  for(const p of ['clockStart','nextIsleAt'])has(p,'number');has('isleDay','string');has('state.b12','object');
  for(const p of ['coins','rev','now','state.en','state.enT','state.plotN','state.barnN','state.mine.max','state.tools.rod','state.tools.pick','state.tools.spr','state.tools.house'])has(p,'number');
  for(const p of ['state.plots','state.barn','state.traps'])has(p,'array');
  for(const p of ['prices','state.inv','state.cnt'])has(p,'object');
  if(d?.prices&&Object.values(d.prices).some(x=>!Number.isFinite(x)||x<0))issues.push('prices 含无效价格');
  if(d?.state?.cnt?.npc!==undefined&&(!Number.isInteger(d.state.cnt.npc)||d.state.cnt.npc<0))issues.push('52弟次数结构不符');
  if(d?.state?.lotto!==undefined&&(!Array.isArray(d.state.lotto)||d.state.lotto.some(t=>!Number.isInteger(t?.d))))issues.push('持有彩票结构不符');
 }else if(route==='/api/pet/world/neighbors'){has('neighbors','array');}
 else if(route==='/api/pet/world/visit/:id'){
  for(const p of ['owner.id','rules.energy','rules.energyMax','rules.perSpot','rules.fineMax'])has(p,'number');
  for(const p of ['isle.plots','isle.barn'])has(p,'array');
 }else if(route==='/api/pet/battle/home'){has('me.id','number');has('me.level','number');has('today.used','number');}
 else if(route==='/api/pet/battle/gear'){has('daily','object');has('daily.chest','number');has('daily.chestMax','number');issues.push(...trainingIssues(d));}
 else if(route==='/api/pet/world/lotto')issues.push(...lotteryIssues(d));
 else if(route==='/api/pet/world/tax'){
  for(const p of ['now','season','day','policy.free','policy.high','current.sales','current.balance_tax','current.phase','treasury.balance'])has(p,'number');has('history','array');
  if(d?.history?.some?.(x=>!Number.isSafeInteger(x.created_at)||!Number.isSafeInteger(x.delta)||!['pet-world-sale-tax','pet-world-balance-tax','pet-world-subsidy'].includes(x.kind)))issues.push('公库账目结构变化');
 }
 return issues;
}
export class Survey {
 constructor(dir,baseline,{fetcher=fetch,clock=Date.now}={}){this.dir=dir;this.baseline=baseline;this.fetcher=fetcher;this.clock=clock;this.nextCore=0;this.nextFull=0;this.dirty=false;this.state={checkedAt:0,assets:{},contracts:{},events:[],version:null};}
 async init(){
  await fs.mkdir(path.join(this.dir,'archive'),{recursive:true,mode:0o700});
  try{this.state=JSON.parse(await fs.readFile(path.join(this.dir,'current.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 get blocked(){return !this.state.checkedAt||Object.keys(this.baseline).some(k=>!this.state.assets[k]?.semanticHash)||!!this.state.error||Object.values(this.state.assets).some(a=>a.changed)||Object.values(this.state.contracts).some(c=>c.issues?.length)||!!this.state.receiptBlock;}
 get reason(){
  if(!this.state.checkedAt)return '等待首次版本测绘';
  if(this.state.error)return this.state.error;
  if(Object.keys(this.baseline).some(k=>!this.state.assets[k]?.semanticHash))return '测绘模块尚未完整读取';
  if(this.state.receiptBlock)return '实际回执与固定规则不符，需要核验';
  if(Object.values(this.state.contracts).some(c=>c.issues?.length))return '接口字段不兼容，需要适配';
  if(Object.values(this.state.assets).some(a=>a.changed))return '发现玩法或接口代码变化，需要适配';
  return '与已验证版本兼容';
 }
 async readSource(asset){
  if(!modulePath(asset)||modulePath(asset)!==asset)throw Error('非白名单公共模块');
  const response=await this.fetcher(BASE+asset,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw Error(asset+' HTTP '+response.status);
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1024*1024)throw Error('公共脚本超过1MB限制');parts.push(Buffer.from(value));}}
  finally{await reader.cancel();}
  return Buffer.concat(parts).toString('utf8');
 }
 async poll(){
  const now=this.clock();if(now<this.nextCore&&now<this.nextFull)return;
  const full=now>=this.nextFull,keys=full?Object.keys(this.baseline):['/pet-world-rules.js'];
  this.nextCore=now+300000;if(full)this.nextFull=now+900000;
  const sources={},failures=[];
  // Small independent public GET batches; never send the account cookie here.
  for(let i=0;i<keys.length;i+=3){
   const results=await Promise.allSettled(keys.slice(i,i+3).map(async key=>({key,source:await this.readSource(key)})));
   for(let j=0;j<results.length;j++){
    const result=results[j],key=keys[i+j];
    if(result.status==='rejected'){failures.push(key);continue;}
    const source=result.value.source;sources[key]=source;
    try{
     const info=inspectSource(source),base=this.baseline[key],changes=sourceDiff(base,info);
     this.state.assets[key]={...info,checkedAt:now,changed:info.semanticHash!==base.semanticHash,formatOnly:info.rawHash!==base.rawHash&&info.semanticHash===base.semanticHash,changes:changes.slice(0,100),changeCount:changes.length};
    }catch{failures.push(key);this.state.assets[key]={...this.state.assets[key],changed:true,changes:[{kind:'parse',key:'新源码无法静态解析'}]};}
   }
  }
  this.state.checkedAt=now;
  if(full)this.state.fullCheckedAt=now;
  if(failures.length){this.state.error='测绘读取未完成：'+failures.join('、');this.nextCore=this.nextFull=now+60000;}
  else this.state.error=null;
  const version=hash(canonical(Object.entries(this.state.assets).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,v.rawHash])));
  if(version!==this.state.version){
   this.state.version=version;
   this.state.events.unshift({at:now,version,blocked:this.blocked,reason:this.reason});this.state.events=this.state.events.slice(0,30);
   // Preserve public source evidence alongside diffs; bounded to ten versions.
   await fs.writeFile(path.join(this.dir,'archive',version+'.json'),JSON.stringify({at:now,assets:this.state.assets,sources}),{mode:0o600});
   const files=await fs.readdir(path.join(this.dir,'archive'));
   const stats=await Promise.all(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(async f=>({f,t:(await fs.stat(path.join(this.dir,'archive',f))).mtimeMs})));
   for(const item of stats.sort((a,b)=>b.t-a.t).slice(10))await fs.unlink(path.join(this.dir,'archive',item.f));
  }
  this.dirty=true;await this.save();
 }
 observe(endpoint,data){
  const key=routeKey(endpoint),old=this.state.contracts[key],current=shape(data),observedIssues=contractIssues(endpoint,data);
  let issues=observedIssues,recoverySince=null;
  // A single good response after a schema failure is insufficient to resume.
  if(!issues.length&&old?.issues?.length){recoverySince=old.recoverySince??this.clock();if(this.clock()-recoverySince<60000)issues=old.issues;}
  const added=old?Object.keys(current).filter(k=>!Object.hasOwn(old.fields,k)):[];
  const fields={...(old?.fields||{})};for(const [k,v]of Object.entries(current))fields[k]=[...new Set([...(fields[k]||[]),...v])].sort();
  this.state.contracts[key]={checkedAt:this.clock(),fields,issues,recoverySince,added:added.slice(0,20),probe:endpoint.split('?')[0]};this.dirty=true;
  return issues;
 }
 recordReceipt(issues){
  if(!issues.length)return;
  this.state.receiptBlock={at:this.clock(),issues:issues.slice(0,20)};this.dirty=true;
 }
 async save(){if(!this.dirty)return;await fs.writeFile(path.join(this.dir,'current.json.new'),JSON.stringify(this.state),{mode:0o600});await fs.rename(path.join(this.dir,'current.json.new'),path.join(this.dir,'current.json'));this.dirty=false;}
 snapshot(){return {...this.state,blocked:this.blocked,reason:this.reason,intervals:{rules:300,modules:900},coverage:'公开客户端及已使用接口；不等于服务端完整规则'};}
}
