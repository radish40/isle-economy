const $=id=>document.getElementById(id),fmt=n=>Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:0});
const time=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
let current=null;
function render(j){
 current=j;$('status').textContent=j.status;$('toggle').disabled=!!j.pending||!j.enabled&&!j.autoRecovering&&j.survey?.blocked;$('toggle').textContent=j.enabled?'暂停经营':j.autoRecovering?'取消自动恢复':'启动经营';
 for(const key of ['invest','steal','arena','lottery','npc','training','cargo'])$(key).checked=j.settings[key];
 const survey=j.survey;
 $('survey-status').textContent=survey?`${survey.reason}；最近检查 ${survey.checkedAt?time(survey.checkedAt):'尚未完成'}。覆盖公开客户端与已使用接口，不能证明后端全部规则。`:'测绘尚未就绪';
 $('survey-assets').replaceChildren(...Object.entries(survey?.assets||{}).map(([file,a])=>{const tr=node('tr','');tr.append(node('td',file),node('td',a.changed?'待适配':a.formatOnly?'仅格式变化':'兼容'),node('td',a.dependencies?.length||0));return tr;}));
 const changes=Object.entries(survey?.assets||{}).flatMap(([file,a])=>(a.changes||[]).map(c=>file+' · '+c.key+(c.kind==='value'?`：${JSON.stringify(c.before)??'不存在'} → ${JSON.stringify(c.after)??'不存在'}`:'：代码结构变化')));
 changes.push(...Object.entries(survey?.contracts||{}).flatMap(([route,c])=>(c.issues||[]).map(i=>route+' · '+i)),...(survey?.receiptBlock?.issues||[]));
 $('survey-changes').replaceChildren(...changes.slice(0,20).map(x=>node('li',x)));
 if(!j.world)return;
 const s=j.world.state,m=j.metrics||{};
 const lottery=j.lottery,arena=j.arena,held=s.lotto||[];
 $('activities').textContent=`52弟比大小：今日 ${s.cnt.npc||0}/52（平局不计次数）。彩票：${lottery?`第${lottery.cur}期 ${held.filter(t=>t.d===lottery.cur).length}/30注，下期开奖 ${time(lottery.next*1000)}，待兑奖 ${held.filter(t=>t.d<lottery.cur).length}注`:'等待读取期号'}。突破训练：${arena?`${arena.daily.trained}/${arena.trainDaily}`:'等待读取'}。小屋 Lv${s.tools.house}：暂停升级。`;
 const effects=Object.entries(s.b12?.effects||{}).filter(([,x])=>x.until>j.world.now).map(([slot,x])=>`${({alert:'警戒',combat:'护具',stealth:'潜行',carry:'携带'})[slot]||slot}：${x.id} 至 ${time(x.until*1000)}`);
 $('defense').textContent=(effects.join('；')||'暂无新版分槽道具')+'。旧版战力倍率已退役；按预算补充警戒，及时收取仍是主要防护。';
 const reserved=Object.values(s.b12?.vault||{}).flat().reduce((a,n)=>a+n,0),fund=j.fund;
 $('longnight').textContent=`${j.world.longNight?'长夜中，岛钟暂停':'白昼中'}；下一岛日 ${j.world.nextIsleAt?time(j.world.nextIsleAt*1000):'待核对'}。仓库预留 ${reserved} 件（已包含在库存总额中）。`;
 $('animal-life').textContent=(j.animals||[]).map((a,i)=>`第${i+1}栏：${['幼年','成长','成年','退休'][a.stage]}${a.stage<2?'，约'+a.left+'岛日成年':a.retired?'，收空后按投资开关换养':'，剩'+a.adultLeft+'岛日成年期'}`).join('；');
 $('fund').textContent=fund?`本季公库余额 ${fmt(fund.treasury.balance)}币；个人获配 ${fmt(fund.mine?.amount)}币。${fund.mine?'拨付以公库账目为准':'当前没有个人补贴分配'}。余额税估算：${fmt(Math.max(0,Math.min(j.world.coins-3000000,7000000))*.001+Math.max(0,j.world.coins-10000000)*.003)}币（按当前余额，实际08:00结算）。`:'等待读取公库账目';
 $('cargo-stock').textContent='本岛日货船：'+(j.cargo||[]).map(x=>`${x.name} ${x.price}币，剩${x.left}/${x.limit}`).join('；');
 $('processing').replaceChildren(...[...(j.plan?.processing||[]).map(p=>`加工 ${p.steps.join(' → ')}：预计增值 ${fmt(p.margin)}（含体力成本）`),...(j.plan?.reservations||[]).map(p=>`为 ${p.id} 限量留料：${Object.entries(p.keep).filter(([,n])=>n).map(([id,n])=>id+' ×'+n).join('、')}；最多等待24小时`)].map(x=>node('li',x)));
 $('visits').textContent=`已追踪 ${j.visits?.tracked||0} 座岛；列表当前可偷 ${j.visits?.available||0} 座。轮询分页，执行前再次核实；收益为估算。`;
 $('targets').replaceChildren(...(j.visits?.targets||[]).slice(0,6).map(x=>node('li',`${x.name}：${x.score?`估算净值 ${fmt(x.score.margin)}，${x.score.spots} 处`:'待观察'}；复查 ${time(x.nextAt)}`)));
 $('clock').textContent=`第${j.world.isleNo}天 · ${j.world.season} · ${j.world.weather} · ${time(j.world.now*1000)}`;
 $('metrics').replaceChildren(...[['可用币',j.world.coins,'当前余额'],['钱包净变化',m.cashNet,'含红包等外部收支'],['基建投入',m.capex,'独立计入资本支出'],['库存增量',m.inventoryDelta,'固定价格估值，未到账']].map(([name,value,note])=>{const e=node('div',name,'metric');e.append(node('b',fmt(value)),node('small',note));return e;}));
 $('assets').replaceChildren(...[`${s.en} / ${100+s.tools.house*20} 体力`,`${s.plotN} 块地`,`${s.barn.length} / ${s.barnN} 只动物`,`${s.traps.length} 个蟹笼`,`洒水器 Lv${s.tools.spr}`,`鱼竿 Lv${s.tools.rod}`,`镐子 Lv${s.tools.pick} · 矿层 ${s.mine.max}`,`官方挂机${s.auto?.on?'仍开启':'已关闭'}`].map(x=>node('span',x,'tag')));
 const grouped=new Map();for(const r of j.plan?.reasons||[])grouped.set(r,(grouped.get(r)||0)+1);
 $('plan').replaceChildren(...(grouped.size?[...grouped].map(([r,n])=>r+(n>1?' ×'+n:'')):['等待成熟、体力恢复或合适行情']).slice(0,10).map(x=>node('li',x)));
 $('investments').replaceChildren(...(j.plan?.investments||[]).map(x=>{const tr=node('tr','');tr.title=x.why;tr.append(...[x.name,fmt(x.cost),`${x.days.toFixed(1)} 天`,x.affordable?'可安排':'先积累'].map(t=>node('td',t)));return tr;}));
 $('forecast').replaceChildren(...(j.plan?.forecast||[]).map(f=>{const e=node('div','','tick');e.append(node('strong',`${time(f.at*1000)} · ${f.season} · ${f.weather}`),...f.events.map(ev=>node('div',ev.text+` ×${ev.m}`)),node('small',`果酱 ${fmt(f.prices.jam.low)}～${fmt(f.prices.jam.high)}`));return e;}));
 $('ledger').replaceChildren(...j.ledger.map(r=>{const tr=node('tr','');const text=Array.isArray(r.reason)?r.reason.join('；'):r.reason;const outcomes=r.out?.map(o=>o.ok?`${o.a}${o.earn?' +'+fmt(o.earn):''}${o.spend?' -'+fmt(o.spend):''}`:`${o.a}：${o.msg}`).join('；')||(r.training?`训练 +${r.training.xp}，支出 ${fmt(r.training.spend)}币（服务端阶梯报价）`:r.result?.outcome)||'已收到回执';tr.append(node('td',time(r.at)),node('td',text),node('td',outcomes));return tr;}));
}
async function refresh(){try{const r=await fetch('./api/status');const j=await r.json();if(!r.ok)throw Error(j.error);render(j);}catch(e){$('status').textContent='连接失败：'+e.message;}}
async function control(body){try{const r=await fetch('./api/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error);render(j);}catch(e){$('status').textContent=e.message;}}
$('toggle').onclick=()=>control({enabled:!current.enabled&&!current.autoRecovering});for(const key of ['invest','steal','arena','lottery','npc','training','cargo'])$(key).onchange=()=>control({[key]:$(key).checked});
$('rescan').onclick=()=>control({rescan:true});
refresh();setInterval(refresh,15000);
