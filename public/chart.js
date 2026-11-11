const chartIds=id=>document.getElementById(id);
const money=n=>n==null?'无观测':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:0})+' 币';
const clockLabel=at=>new Date(at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const dateLabel=at=>new Date(at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'});
const svgNode=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const chartMetrics={operating:'经营结余',income:'经营收入',expenses:'日常支出',capex:'基建投入',capitalRecovery:'退休动物回收款',cashNet:'自动化净现金流',external:'红包、补偿与补贴',saleTax:'售卖税（已从收入扣除）',balanceTax:'余额税（已计支出）',refund:'旧道具补偿',subsidy:'公库补贴',inventoryDelta:'库存估值变化（未到账）'};
let financeData=null,chosenPeriod=null,loadingFinance=false;
function showPeriod(row){
 chosenPeriod=row.at;
 const status=row.open?'进行中':row.partial?'接管首段，不足半小时':'已结束';
 chartIds('chart-detail').textContent=`${dateLabel(row.at)} ${clockLabel(row.at)}–${clockLabel(row.end)} · ${status}。税后经营收入 ${money(row.income)}，日常支出 ${money(row.expenses)}，经营结余 ${money(row.operating)}；基建 ${money(row.capex)}，退休动物回收 ${money(row.capitalRecovery)}，自动化净现金流 ${money(row.cashNet)}；红包、补偿与补贴 ${money(row.external)}；售卖税 ${money(row.saleTax)}（已从收入扣除），余额税 ${money(row.balanceTax)}（已计支出）；库存估值变化 ${money(row.inventoryDelta)}${row.inventoryDelta!=null&&row.inventoryPartial?'（仅部分时段有观测）':''}。`;
}
function drawFinance(){
 if(!financeData)return;
 const key=chartIds('chart-metric').value,rows=financeData.rows,values=rows.map(r=>r[key]).filter(v=>Number.isFinite(v));
 const min=Math.min(0,...values),max=Math.max(0,...values),step=10**Math.floor(Math.log10(Math.max(1,max-min)));
 const low=Math.floor(min/step)*step,high=Math.max(low+step,Math.ceil(max/step)*step);
 const width=Math.max(720,rows.length*32+110),height=310,left=74,right=20,top=24,bottom=62,plotHeight=height-top-bottom;
 const y=v=>top+(high-v)/(high-low)*plotHeight,zero=y(0),slot=(width-left-right)/Math.max(1,rows.length);
 const svg=svgNode('svg',{width,height,viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':chartMetrics[key]+'，北京时间每半小时一柱'});
 svg.append(svgNode('title',{},chartMetrics[key]+'（币）'));
 for(let k=0;k<=4;k++){
  const value=low+(high-low)*k/4,yy=y(value);
  svg.append(svgNode('line',{x1:left,x2:width-right,y1:yy,y2:yy,stroke:'#e3e9de'}),svgNode('text',{x:left-9,y:yy+4,'text-anchor':'end',fill:'#6b7a70','font-size':11},Math.abs(value)>=10000?(value/10000).toLocaleString('zh-CN',{maximumFractionDigits:1})+'万':Math.round(value).toLocaleString('zh-CN')));
 }
 svg.append(svgNode('text',{x:12,y:14,fill:'#6b7a70','font-size':11},'币'),svgNode('line',{x1:left,x2:width-right,y1:zero,y2:zero,stroke:'#8ba394'}));
 rows.forEach((row,i)=>{
  const x=left+i*slot+slot*.18,v=row[key],valid=Number.isFinite(v),barWidth=Math.min(48,slot*.64);
  const color=key==='external'?'#8a68a3':key==='inventoryDelta'?'#618e9b':v<0?'#bc684e':key==='capex'||key==='expenses'?'#bc8a48':'#287459';
  const group=svgNode('g',{tabindex:0,role:'button','aria-label':`${dateLabel(row.at)} ${clockLabel(row.at)}，${chartMetrics[key]} ${money(v)}`});
  if(valid){const h=Math.max(v===0?1:2,Math.abs(y(v)-zero));group.append(svgNode('rect',{x,y:v>=0?zero-h:zero,width:barWidth,height:h,rx:2,fill:color,opacity:row.open?.6:1,...(key==='inventoryDelta'&&row.inventoryPartial?{stroke:'#173e35','stroke-dasharray':'3 3'}:{})}));}
  else group.append(svgNode('circle',{cx:x+barWidth/2,cy:zero,r:3,fill:'#adb6aa'}));
  group.append(svgNode('title',{},`${dateLabel(row.at)} ${clockLabel(row.at)}–${clockLabel(row.end)}\n${chartMetrics[key]}：${money(v)}${row.open?'\n当前半小时尚未结束':''}`));
  group.addEventListener('click',()=>showPeriod(row));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showPeriod(row);}});svg.append(group);
  const every=rows.length>48?4:rows.length>24?2:1;
  if(i%every===0||i===rows.length-1){svg.append(svgNode('text',{x:x+barWidth/2,y:height-35,'text-anchor':'middle',fill:'#6b7a70','font-size':11},clockLabel(row.at)));if(i===0||dateLabel(row.at)!==dateLabel(rows[i-1]?.at))svg.append(svgNode('text',{x:x+barWidth/2,y:height-17,'text-anchor':'middle',fill:'#6b7a70','font-size':10},dateLabel(row.at)));}
 });
 chartIds('income-chart').replaceChildren(svg);
 chartIds('chart-note').textContent=key==='inventoryDelta'?'库存按接入时固定价格估值，不计入到账收益。灰点表示没有历史观测，虚线柱表示仅有部分时段观测。':'北京时间每半小时一柱；浅色柱为进行中。点击柱子查看明细。所有收支只统计已确认回执，红包单列。';
 const totals=financeData.totals;
 chartIds('chart-summary').textContent=`接管以来：经营结余 ${money(totals.operating)}；自动化净现金流 ${money(totals.cashNet)}；红包、补偿与补贴 ${money(totals.external)}。${financeData.fundCoverage?.possibleGaps?' 公库历史仅返回最近20条，存在可能漏采时段。':''}`;
 if(rows.length)showPeriod(rows.find(r=>r.at===chosenPeriod)||rows.at(-1));
}
async function refreshFinance(){
 if(loadingFinance)return;loadingFinance=true;
 try{const r=await fetch('./api/finance?hours='+chartIds('chart-range').value);const j=await r.json();if(!r.ok)throw Error(j.error||'读取失败');financeData=j;drawFinance();}
 catch(e){chartIds('chart-note').textContent='收益图读取失败：'+e.message;}
 finally{loadingFinance=false;}
}
chartIds('chart-metric').onchange=drawFinance;chartIds('chart-range').onchange=refreshFinance;
refreshFinance();setInterval(refreshFinance,15000);
