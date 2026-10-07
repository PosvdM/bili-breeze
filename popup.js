const $ = id => document.getElementById(id);
const behavior = ['enabled','dynamics','pinned','foldIncidental','autoCautious'];
// Defaults come from the background's rule configuration (config/<channel>/ in the repository).
let defaultPrompt='';
let ruleDefaults={};
const RULE_LIMITS={adThreshold:[1,100],cautiousThreshold:[1,100],ratioThreshold:[1,100],ratioWindow:[2,100]};
const percentKeys=['adThreshold','cautiousThreshold','ratioThreshold'];
const ruleInput=key=>$(key==='ratioWindow'?'ratioWindow':key+'Number');
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
  renderRules(response.data);
  $('extensionVersion').textContent=chrome.runtime.getManifest?.().version||'';
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
function renderRules(data){
 ruleDefaults={...data.defaultThresholds};
 for(const key of Object.keys(RULE_LIMITS)){
  ruleInput(key).value=data[key]??ruleDefaults[key];
  if(percentKeys.includes(key))$(key+'Range').value=ruleInput(key).value;
  markDefault(key);
 }
 defaultPrompt=data.defaultPrompt||'';
 $('rulesPrompt').value=data.rulesPrompt||defaultPrompt;
 markPromptDefault();
 if(data.ruleStatus)renderRuleStatus(data.ruleStatus);
}
// Magenta marks a value that follows the default; the reset button shows the default on hover.
function markDefault(key){
 const value=Number(ruleInput(key).value),isDefault=value===ruleDefaults[key],unit=key==='ratioWindow'?' 条':'%';
 if(percentKeys.includes(key)){
  const range=$(key+'Range');
  range.classList.toggle('is-default',isDefault);
  range.style.setProperty('--fill',(Number(range.value)-1)/99*100+'%');
 } else ruleInput(key).classList.toggle('is-default',isDefault);
 const reset=document.querySelector(`.reset-default[data-key="${key}"]`);
 reset.setAttribute('aria-disabled',String(isDefault));
 reset.title=(isDefault?'正在使用默认值 ':'恢复默认值 ')+ruleDefaults[key]+unit;
}
function markPromptDefault(){
 const isDefault=$('rulesPrompt').value.trim()===defaultPrompt;
 $('rulesPrompt').classList.toggle('is-default',isDefault);
 $('resetPrompt').setAttribute('aria-disabled',String(isDefault));
}
// Stored only while it differs from the default, so the value follows later default changes.
async function saveRule(key,source){
 const [min,max]=RULE_LIMITS[key],raw=Number(source.value);
 const value=source.value.trim()!==''&&Number.isFinite(raw)?Math.min(max,Math.max(min,Math.round(raw))):ruleDefaults[key];
 ruleInput(key).value=value;
 if(percentKeys.includes(key))$(key+'Range').value=value;
 markDefault(key);
 try{
  if(value===ruleDefaults[key])await chrome.storage.local.remove(key);else await chrome.storage.local.set({[key]:value});
  $('status').textContent=value===ruleDefaults[key]?'已使用默认值':'已自动保存';
 }catch{$('status').textContent='保存失败，请重试';}
}
for(const key of Object.keys(RULE_LIMITS)){
 const input=ruleInput(key);
 if(percentKeys.includes(key)){
  const range=$(key+'Range');
  range.addEventListener('input',()=>{input.value=range.value;markDefault(key);});
  range.addEventListener('change',()=>saveRule(key,range));
  input.addEventListener('input',()=>{if(input.value!==''&&input.validity.valid){range.value=input.value;markDefault(key);}});
 }
 input.addEventListener('change',()=>saveRule(key,input));
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
 document.querySelector(`.reset-default[data-key="${key}"]`).addEventListener('click',e=>{
  if(e.currentTarget.getAttribute('aria-disabled')==='true')return;
  ruleInput(key).value=ruleDefaults[key];saveRule(key,ruleInput(key));
 });
}
async function savePrompt(text){
 const value=text.trim().slice(0,4000),stored=value===defaultPrompt?'':value;
 $('rulesPrompt').value=stored||defaultPrompt;
 markPromptDefault();
 try{await chrome.storage.local.set({rulesPrompt:stored});$('status').textContent=stored?'已自动保存':'已使用默认 Prompt';}catch{$('status').textContent='保存失败，请重试';}
}
$('rulesPrompt').addEventListener('input',markPromptDefault);
$('rulesPrompt').addEventListener('change',()=>savePrompt($('rulesPrompt').value));
$('resetPrompt').addEventListener('click',()=>{if($('resetPrompt').getAttribute('aria-disabled')!=='true')savePrompt('');});

function renderRuleStatus(status){
 $('ruleChannel').value=status.channel;
 const label=file=>file.host?file.host+(status.channel==='beta'?(file.channel==='beta'?'（内测）':'（正式）'):''):'内置';
 const prompt=label(status.files.prompt),thresholds=label(status.files.thresholds);
 $('ruleSource').textContent=prompt===thresholds?prompt:`Prompt：${prompt}；阈值：${thresholds}`;
 $('ruleChecked').textContent=status.checkedAt?new Date(status.checkedAt).toLocaleString('zh-CN',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未更新';
 $('ruleError').textContent=status.error||'';
}
async function refreshRules(message){
 $('refreshRules').disabled=$('ruleChannel').disabled=true;$('status').textContent='正在更新规则…';
 try{
  const response=await chrome.runtime.sendMessage({type:'refreshRules',...message});
  if(!response?.ok)throw new Error(response?.error||'更新失败');
  renderRules(response.data);
  $('status').textContent=response.data.ruleStatus.error?'规则更新失败':'规则已更新';
 }catch(e){$('status').textContent=e.message;}
 finally{$('refreshRules').disabled=$('ruleChannel').disabled=false;}
}
$('refreshRules').addEventListener('click',()=>refreshRules({}));
$('ruleChannel').addEventListener('change',()=>refreshRules({channel:$('ruleChannel').value}));

chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.enhancedList||changes.whitelist))renderLists().catch(()=>{});});
