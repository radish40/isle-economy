import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
import {Engine} from './engine.mjs';
const prefix='/lab/isle-economy',root=fileURLToPath(new URL('../public/',import.meta.url));
const port=Number(process.env.PORT||3020),host=process.env.HOST||'127.0.0.1';
const origin=new URL(process.env.DASHBOARD_ORIGIN||('http://127.0.0.1:'+port)).origin;
const token=process.env.DASHBOARD_TOKEN;
if(!token||token.length<24)throw Error('DASHBOARD_TOKEN 至少需要 24 个字符');
const hash=value=>createHash('sha256').update(value).digest();
const expected=hash('owner:'+token);
const engine=new Engine(process.env.DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));
await engine.init();
const send=(res,status,value,type='application/json')=>{res.writeHead(status,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(value):value);};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'){
   const ok=engine.schedulerHealthy(),s=engine.state;
   const phase=s.pending?'pending':engine.survey.blocked?'version-blocked':s.recovery?'auto-recovering':s.enabled?'running':s.lastStop?.kind==='error'?'error-stopped':'paused';
   send(res,ok?200:503,{ok,ready:!!engine.world,phase});return;
  }
  const auth=req.headers.authorization||'';
  if(!auth.startsWith('Basic ')||!timingSafeEqual(hash(Buffer.from(auth.slice(6),'base64')),expected)){
   res.writeHead(401,{'www-authenticate':'Basic realm="Isle Economy"','cache-control':'no-store'});res.end();return;
  }
  if(url.pathname===prefix+'/api/status'&&req.method==='GET'){send(res,200,engine.snapshot());return;}
  if(url.pathname===prefix+'/api/survey'&&req.method==='GET'){send(res,200,engine.survey.snapshot());return;}
  if(url.pathname===prefix+'/api/finance'&&req.method==='GET'){const hours=Number(url.searchParams.get('hours')||24);send(res,200,engine.finance.report(Date.now(),Number.isFinite(hours)?hours:24));return;}
  if(url.pathname===prefix+'/api/control'&&req.method==='POST'){
   if(req.headers.origin!==origin){send(res,403,{error:'请求来源不符'});return;}
   let input='';for await(const chunk of req){input+=chunk;if(input.length>2048)throw Error('请求过大');}
   send(res,200,await engine.control(JSON.parse(input)));return;
  }
  if(req.method!=='GET'){send(res,405,{error:'方法不支持'});return;}
  const files={[prefix+'/']:'index.html',[prefix+'/app.js']:'app.js',[prefix+'/chart.js']:'chart.js',[prefix+'/style.css']:'style.css'};
  const file=files[url.pathname];if(!file){send(res,404,{error:'没有这个页面'});return;}
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  send(res,200,await fs.readFile(path.join(root,file),'utf8'),type);
 }catch(e){send(res,400,{error:String(e.message).slice(0,200)});}
});
server.listen(port,host);
await engine.tick();
const timer=setInterval(()=>engine.tick(),10000);
process.on('SIGTERM',()=>{clearInterval(timer);server.close();if(!engine.busy){engine.close();process.exit(0);}else setTimeout(()=>process.exit(0),25000).unref();});
