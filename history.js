const $=id=>document.getElementById(id);
let records=[],limit=100;
function node(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function ad(r){return (r.categories || [r.kind]).some(k=>['ad','hard_ad','soft_ad','lead_gen'].includes(k));}
function render(){
 $('summary').replaceChildren();
 for(const [label,value] of [['已检测',records.length],['识别为广告',records.filter(ad).length],['折叠',records.filter(r=>r.action==='折叠').length]]){const el=node('div',label);el.append(node('strong',String(value)));$('summary').append(el);}
 const authors=new Map();
 for(const r of records){const key=r.authorId||r.author;const a=authors.get(key)||{name:r.author,total:0,ads:0};a.total++;a.ads+=Number(ad(r));authors.set(key,a);}
 $('ranking').replaceChildren();
 const ranking=[...authors.values()].filter(a=>a.ads).sort((a,b)=>b.ads-a.ads||b.total-a.total).slice(0,50);
 for(const a of ranking){const tr=node('tr','');for(const value of [a.name,a.total,a.ads,Math.round(a.ads/a.total*100)+'%'])tr.append(node('td',String(value)));$('ranking').append(tr);}
 if(!ranking.length){const tr=node('tr','');const td=node('td','暂无广告记录');td.colSpan=4;tr.append(td);$('ranking').append(tr);}
 const q=$('search').value.trim().toLowerCase(),scope=$('scope').value;
 const filtered=records.filter(r=>(scope==='all'||scope==='filtered'&&r.action==='折叠'||scope==='giveaway'&&(r.categories||[r.kind]).includes('giveaway')||scope==='event'&&(r.categories||[r.kind]).includes('event')||scope==='recruitment'&&(r.categories||[r.kind]).includes('recruitment')||ad(r)&&(scope==='ads'||r.type===scope))&&(!q||(r.author+' '+r.preview).toLowerCase().includes(q)));
 $('logs').replaceChildren();
 for(const r of filtered.slice(0,limit)){
  const el=node('article','','entry');el.append(node('b',r.author+' · '+({ad:'广告',giveaway:'抽奖',recruitment:'招聘',event:'活动宣传',organic:'普通内容'}[r.kind]||'其他')+' · '+r.action));
  if(r.giveawayType==='incidental')el.append(node('p','附带抽奖','meta'));
  if(r.giveawayType==='uncertain')el.append(node('p','抽奖类型不确定，保留显示','meta'));
  if(r.cautionStatus==='missing_uid')el.append(node('p','未获取 UP 主 UID，暂不能计算自动谨慎模式。','meta'));
  if(r.cautionStatus==='collecting')el.append(node('p',`正在积累动态：${r.cautionSample.total} / ${r.cautionSample.required} 条`,'meta'));
  if(r.cautionStatus==='inactive')el.append(node('p',`最近 ${r.cautionSample.total} 条中 ${r.cautionSample.ads} 条广告，未达到 ${r.cautionSample.trigger}%`,'meta'));
  if(r.autoCautious)el.append(node('p',`自动加入名单时：${r.autoCautious.total} 条中 ${r.autoCautious.ads} 条广告`,'meta'));
  if(r.enhanced)el.append(node('p','谨慎模式 · 广告置信度 '+Math.round(r.prob*100)+'% · 折叠门槛 '+(r.adThreshold??90)+'%','meta'));
  el.append(node('p',r.preview));el.append(node('p',(r.type==='pinned'?'视频置顶评论':'动态')+' · 最近检测 '+new Date(r.lastSeen).toLocaleString(),'meta'));
  try{const u=new URL(r.url);if(u.protocol==='https:'&&/^(www|t|space)\.bilibili\.com$/.test(u.hostname)){const a=node('a','查看来源');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';el.append(a);}}catch{}
  $('logs').append(el);
 }
 if(!filtered.length)$('logs').append(node('p','暂无匹配记录','muted'));
 $('more').hidden=filtered.length<=limit;
}
async function load(){const {filterHistory={}}=await chrome.storage.local.get({filterHistory:{}});records=Object.values(filterHistory).sort((a,b)=>b.lastSeen-a.lastSeen);render();}
$('search').addEventListener('input',()=>{limit=100;render();});$('scope').addEventListener('change',()=>{limit=100;render();});$('more').addEventListener('click',()=>{limit+=100;render();});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.filterHistory)load();});
load().catch(()=>{$('logs').textContent='日志读取失败，请重新打开此页';});
