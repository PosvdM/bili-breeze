const $ = id => document.getElementById(id);
const behavior = ['enabled','dynamics','pinned','foldIncidental','autoCautious'];
let defaultPrompt='';
// Filled from the background; used when a percentage input is invalid.
let thresholdDefaults={adThreshold:40,cautiousThreshold:90,ratioThreshold:40};
function updateFields() {
  const custom = $('provider').value === 'custom';
  $('customFields').hidden = !custom;
  $('endpointNote').textContent = custom ? '使用自定义 API' : '直连 api.typesafe.ai · jev-latest';
}
async function load() {
  const response = await chrome.runtime.sendMessage({type:'settings'});
  if (!response?.ok) throw new Error(response?.error || '无法读取设置');
  for (const id of behavior) {
    if ($(id).type === 'checkbox') $(id).checked = response.data[id];
    else $(id).value = String(response.data[id]);
  }
  const s = await chrome.storage.local.get({apiKey:'',provider:'jev',apiUrl:'',apiModel:'',apiProtocol:'openai'});
  for (const id of Object.keys(s)) if ($(id)) $(id).value = s[id];
  for (const kind of ['ad','giveaway','recruitment','event']) $('fold_'+kind).checked = (response.data.foldCategories || ['ad','giveaway']).includes(kind);
  thresholdDefaults={...thresholdDefaults,...response.data.defaultThresholds};
  for(const key of Object.keys(thresholdDefaults)){
    $(key+'Range').value=$(key+'Number').value=response.data[key]??thresholdDefaults[key];
  }
  $('ratioWindow').value=response.data.ratioWindow??10;
  defaultPrompt=response.data.defaultPrompt||'';
  $('rulesPrompt').value=response.data.rulesPrompt||defaultPrompt;
  await renderLists();
  updateFields();
  $('status').textContent = s.apiKey ? '已配置 API' : '请先设置 API';
}
// Persist each behavior change immediately, independently of unsaved API edits.
for (const id of behavior) $(id).addEventListener('change', () => {
  const value = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  chrome.storage.local.set({[id]:value}).then(()=>{$('status').textContent='已自动保存';}).catch(()=>{$('status').textContent='保存失败，请重试';});
});
$('provider').addEventListener('change', updateFields);
async function saveApi() {
  const s = {};
  for (const id of ['apiKey','provider','apiUrl','apiModel','apiProtocol']) s[id] = $(id).value.trim();
  if (s.provider === 'custom') {
    let url;
    try { url = new URL(s.apiUrl); } catch { throw new Error('请输入完整的 HTTPS API 地址'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 地址须为 HTTPS，不能包含账号、查询参数或片段');
    if (!s.apiModel) throw new Error('请填写模型名称');
    // Keep permissions.request in the user gesture, before any other await.
    if (!await chrome.permissions.request({origins:[url.origin+'/*']})) throw new Error('请允许访问该 API 地址后再保存');
    s.apiUrl = url.href;
  }
  await chrome.storage.local.set(s);
}
$('settings').addEventListener('submit', async e => {
  e.preventDefault();
  try { await saveApi(); $('status').textContent='已保存'; }
  catch(e) { $('status').textContent=e.message; }
});
$('test').addEventListener('click', async () => {
  $('test').disabled=true; $('status').textContent='正在测试 API…';
  try {
    await saveApi();
    const response=await chrome.runtime.sendMessage({type:'test'});
    $('status').textContent=response?.ok ? '连接正常，已返回有效识别结果' : response?.error || '测试失败';
  } catch(e) { $('status').textContent=e.message; }
  finally { $('test').disabled=false; }
});
$('clear').addEventListener('click',async()=>{
  try { await chrome.storage.local.set({apiKey:''}); $('apiKey').value=''; $('status').textContent='密钥已删除'; }
  catch { $('status').textContent='移除失败，请重试'; }
});
load().catch(e=>{$('status').textContent=e.message;});

for(const kind of ['ad','giveaway','recruitment','event']) $('fold_'+kind).addEventListener('change',()=>chrome.storage.local.set({foldCategories:['ad','giveaway','recruitment','event'].filter(k=>$('fold_'+k).checked)}));

async function saveIdentity(id,uid,name){
 const data=await chrome.storage.local.get({[id]:[]});
 const previous=data[id].find(e=>e && typeof e==='object' && e.uid===uid);
 const remaining=data[id].filter(e=>e && typeof e==='object'?e.uid!==uid:!['uid:'+uid,uid].includes(e));
 await chrome.storage.local.set({[id]:[...remaining,{...previous,uid,name:name||previous?.name||''}].slice(-500)});
}
async function resolveName(id,uid){
 try{
  const response=await chrome.runtime.sendMessage({type:'lookupAuthor',query:uid});
  const user=response?.ok && response.data.users.find(u=>u.uid===uid);
  if(!user?.name)throw new Error('暂时无法解析');
  // Do not resurrect an entry that was removed while its name was loading.
  const current=await chrome.storage.local.get({[id]:[]});
  if(!current[id].some(e=>e?.uid===uid))return;
  await saveIdentity(id,uid,user.name);
  $(id+'Status').textContent='已添加：'+user.name;
 }catch{ $(id+'Status').textContent='已添加 UID，名字获取失败，可重试。'; }
 await renderLists();
}
async function renderLists(){
 const lists=await chrome.storage.local.get({whitelist:[],enhancedList:[]});
 for(const id of ['whitelist','enhancedList']){
  $(id).replaceChildren();
  for(const entry of lists[id]){
   // Skip null or malformed entries instead of failing the whole list.
   if(!entry||typeof entry!=='object'&&typeof entry!=='string')continue;
   const row=document.createElement('div');row.className='author-entry';
   const text=document.createElement('span');text.textContent=typeof entry==='object'?(entry.name||'暂未获取名字'):entry+'（按名字匹配）';text.title=text.textContent;row.append(text);
   if(typeof entry==='object'){
    const uid=document.createElement('small');uid.textContent='UID '+entry.uid+(entry.source==='auto'?' · 自动添加':'');row.append(uid);
    const retry=document.createElement('button');retry.type='button';retry.textContent=entry.name?'刷新名字':'获取名字';retry.onclick=async()=>{retry.disabled=true;await resolveName(id,entry.uid);};row.append(retry);
   }
   const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.onclick=async()=>{const current=await chrome.storage.local.get({[id]:[],autoCautionExcluded:[]});const extra=id==='enhancedList'&&entry?.uid?{autoCautionExcluded:[...new Set([...current.autoCautionExcluded,entry.uid])]}:{};await chrome.storage.local.set({...extra,[id]:current[id].filter(e=>typeof entry==='object'?e?.uid!==entry.uid:e!==entry)});await renderLists();};row.append(remove);$(id).append(row);
  }
 }
}
for(const id of ['whitelist','enhancedList']){
 $(id+'Add').addEventListener('click',async()=>{
  const uid=$(id+'Query').value.trim();
  if(!/^[1-9][0-9]{0,19}$/.test(uid)){$(id+'Status').textContent='请输入纯数字 UID，不支持名字。';return;}
  $(id+'Add').disabled=true;
  try{
   await saveIdentity(id,uid,'');$(id+'Query').value='';await renderLists();
   $(id+'Status').textContent='已添加，正在获取名字…';await resolveName(id,uid);
  }catch(e){$(id+'Status').textContent='保存失败：'+e.message;}finally{$(id+'Add').disabled=false;}
 });
 $(id+'Query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!$(id+'Add').disabled)$(id+'Add').click();}});
}

const tabKeys=['filter','lists','api'];
function selectTab(key,focus=false){
 for(const item of tabKeys){
  const selected=item===key,button=$('tab-'+item);
  button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  $('panel-'+item).hidden=!selected;
 }
 if(focus)$('tab-'+key).focus();
}
for(const [index,key] of tabKeys.entries()){
 $('tab-'+key).addEventListener('click',()=>selectTab(key));
 $('tab-'+key).addEventListener('keydown',e=>{
  let next;
  if(e.key==='ArrowRight')next=(index+1)%3;
  if(e.key==='ArrowLeft')next=(index+2)%3;
  if(e.key==='Home')next=0;
  if(e.key==='End')next=2;
  if(next!==undefined){e.preventDefault();selectTab(tabKeys[next],true);}
 });
}

$('openRules').onclick=()=>{$('filterOverview').hidden=true;$('filterRules').hidden=false;};
$('backRules').onclick=()=>{$('filterOverview').hidden=false;$('filterRules').hidden=true;};
for(const key of ['adThreshold','cautiousThreshold','ratioThreshold']){
 const range=$(key+'Range'),number=$(key+'Number');
 range.addEventListener('input',()=>{number.value=range.value;});
 async function savePercent(source){
  const raw=Number(source.value),value=source.value.trim()!==''&&Number.isFinite(raw)?Math.min(100,Math.max(1,Math.round(raw))):thresholdDefaults[key];
  range.value=number.value=value;await chrome.storage.local.set({[key]:value});$('status').textContent='已自动保存';
 }
 range.addEventListener('change',()=>savePercent(range).catch(()=>{$('status').textContent='保存失败';}));
 number.addEventListener('input',()=>{if(number.value!==''&&number.validity.valid)range.value=number.value;});
 number.addEventListener('change',()=>savePercent(number).catch(()=>{$('status').textContent='保存失败';}));
 number.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();number.blur();}});
}
$('ratioWindow').addEventListener('change',async()=>{const value=Math.min(100,Math.max(2,Math.round(Number($('ratioWindow').value)||10)));$('ratioWindow').value=value;await chrome.storage.local.set({ratioWindow:value});$('status').textContent='已自动保存';});
// Stored empty while it equals the built-in prompt, so the default can change in updates.
async function savePrompt(text,done){
 const value=text.trim().slice(0,4000),stored=value===defaultPrompt?'':value;
 $('rulesPrompt').value=stored||defaultPrompt;
 try{await chrome.storage.local.set({rulesPrompt:stored});$('status').textContent=stored?done:'已使用内置 Prompt';}catch{$('status').textContent='保存失败，请重试';}
}
$('rulesPrompt').addEventListener('change',()=>savePrompt($('rulesPrompt').value,'已自动保存'));
$('resetPrompt').addEventListener('click',()=>savePrompt('','已使用内置 Prompt'));
$('ratioWindow').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('ratioWindow').blur();}});

chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.enhancedList||changes.whitelist))renderLists().catch(()=>{});});
