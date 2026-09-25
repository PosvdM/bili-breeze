/* No relay server, registration, activation, telemetry or remote configuration. */
const DEFAULTS = {enabled: true, dynamics: true, pinned: true, foldCategories: ["ad", "giveaway"], whitelist: [], enhancedList: [], foldIncidental: false, adThreshold:70, cautiousThreshold:90, autoCautious:true, autoCautionExcluded:[], ratioWindow:10, ratioThreshold:40, apiKey: "", provider: "jev", apiUrl: "", apiModel: "", apiProtocol: "openai", rulesPrompt: ""};
const API = "https://api.typesafe.ai/v1/systemone";
importScripts('prompts/classification.js', 'prompts/giveaway.js', 'prompts/request.js');
function normalizePrompt(value) {
  const text = String(value || "").trim().slice(0, PROMPT_LIMIT);
  return text === DEFAULT_PROMPT ? "" : text;
}
const cache = new Map();
const CACHE_TTL = 30 * 86400000;
const CACHE_LIMIT = 5000;
let cacheWrites = Promise.resolve();
const pending = new Map();
let historyWrites = Promise.resolve();
function safeBiliUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && /^(www|t|space)\.bilibili\.com$/.test(url.hostname) ? url.origin + url.pathname : ""; } catch { return ""; }
}
function authorRatio(history, uid, config=DEFAULTS) {
  if(!config.autoCautious||(config.autoCautionExcluded||[]).includes(String(uid))||!/^[0-9]+$/.test(String(uid||'')))return null;
  const rows=Object.values(history).filter(r=>r.authorId===String(uid)&&r.type==='dynamic'&&r.rule==='category'&&r.classificationVersion===CLASSIFICATION_VERSION&&Number.isFinite(r.prob))
    .sort((a,b)=>(b.firstSeen||0)-(a.firstSeen||0)||String(b.id).localeCompare(String(a.id))).slice(0,config.ratioWindow);
  const ads=rows.filter(r=>r.prob>=config.adThreshold/100).length;
  return rows.length===config.ratioWindow && ads/rows.length>=config.ratioThreshold/100 ? {total:rows.length,ads} : null;
}
function applyPolicy(result,raw,config,history) {
  if(result.rule)return result;
  const categories=(result.categories||[]).filter(k=>k!=='ad'&&k!=='event');
  if(result.prob>=config.adThreshold/100)categories.unshift('ad');
  if(result.event>=.7)categories.push('event');
  result.categories=[...new Set(categories)];
  const manual=(config.enhancedList||[]).some(v=>v&&typeof v==='object'?String(v.uid)===String(raw.authorId||''):typeof v==='string'&&(v.startsWith('uid:')?v.slice(4)===String(raw.authorId||''):v===String(raw.author||'').trim()));
  const savedAuto=(config.enhancedList||[]).find(v=>v&&typeof v==='object'&&String(v.uid)===String(raw.authorId||'')&&v.source==='auto');
  result.autoCautious=savedAuto?.sample||null;
  const sample=Object.values(history).filter(r=>r.authorId===String(raw.authorId||'')&&r.type==='dynamic'&&r.rule==='category'&&r.classificationVersion===CLASSIFICATION_VERSION&&Number.isFinite(r.prob)).sort((a,b)=>(b.firstSeen||0)-(a.firstSeen||0)).slice(0,config.ratioWindow);
  result.cautionStatus=!raw.authorId?'missing_uid':result.autoCautious?'active':!config.autoCautious?'disabled':sample.length<config.ratioWindow?'collecting':'inactive';
  result.cautionSample={total:sample.length,required:config.ratioWindow,ads:sample.filter(r=>r.prob>=config.adThreshold/100).length,trigger:config.ratioThreshold};
  result.enhanced=manual||!!result.autoCautious;
  result.adThreshold=(result.enhanced?Math.max(config.adThreshold,config.cautiousThreshold):config.adThreshold);
  const matched=result.categories.filter(k=>config.foldCategories.includes(k)&&(k!=='ad'||result.prob>=result.adThreshold/100)&&(k!=='giveaway'||result.giveawayType==='primary'||result.giveawayType==='incidental'&&config.foldIncidental));
  result.fold=matched.length>0;result.kind=matched[0]||result.categories[0]||'organic';
  return result;
}
async function logDetection(raw, result) {
  const author = String(raw.author || "未知 UP 主").slice(0, 80);
  const authorId = /^\d+$/.test(raw.authorId || "") ? String(raw.authorId).slice(0, 30) : "";
  const url = safeBiliUrl(raw.url);
  const identity = [raw.kind, authorId || author, raw.itemId ? String(raw.itemId).slice(0, 300) : [raw.kind === "pinned" ? url : "", sanitize(raw)]];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
  const id = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,"0")).join("");
  historyWrites = historyWrites.catch(() => {}).then(async () => {
    const {filterHistory = {}} = await chrome.storage.local.get({filterHistory: {}});
    const s = await settings();
    const old = filterHistory[id];
    filterHistory[id] = {classificationVersion:CLASSIFICATION_VERSION, id, author, authorId, url, type: raw.kind, giveawayType:result.giveawayType, prob: result.prob, kind: result.kind, categories: result.categories || [result.kind],
      action: result.fold ? "折叠" : "放行", rule: result.rule || "category", enhanced: !!result.enhanced, adThreshold:result.adThreshold, autoCautious:result.autoCautious,
      preview: String(raw.text || "").slice(0, 160), firstSeen: old?.firstSeen || Date.now(), lastSeen: Date.now()};
    const qualifies=authorRatio(filterHistory,authorId,s);
    const listed=s.enhancedList.some(v=>v&&typeof v==='object'?String(v.uid)===authorId:v==='uid:'+authorId||v===author);
    // Only API-classified items may trigger it; whitelisted authors are never auto-added.
    if(qualifies&&!listed&&!result.rule){
      s.enhancedList=[...s.enhancedList,{uid:authorId,name:author,source:'auto',addedAt:Date.now(),sample:qualifies}];
      // storage.onChanged notifies tabs with authorPolicyChanged.
      await chrome.storage.local.set({enhancedList:s.enhancedList});
    }
    applyPolicy(result,raw,s,filterHistory);
    Object.assign(filterHistory[id],{action:result.fold?'折叠':'放行',kind:result.kind,categories:result.categories||[result.kind],enhanced:!!result.enhanced,adThreshold:result.adThreshold,autoCautious:result.autoCautious,cautionStatus:result.cautionStatus,cautionSample:result.cautionSample});
    const entries = Object.values(filterHistory).sort((a,b) => b.lastSeen-a.lastSeen).slice(0,5000);
    await chrome.storage.local.set({filterHistory: Object.fromEntries(entries.map(e=>[e.id,e]))});
  });
  await historyWrites.catch(() => {});
}
let active = 0;
let revision = 0;
let cooldown = 0;
const waiting = [];
// Keys stay in trusted extension contexts, never in page/content-script storage.
const storageReady = chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});
const promptReady = storageReady.then(async () => {
  const {customPrompt = "", rulesPrompt = ""} = await chrome.storage.local.get({customPrompt: "", rulesPrompt: ""});
  if (!String(customPrompt).trim()) return;
  if (!rulesPrompt) await chrome.storage.local.set({rulesPrompt: normalizePrompt(DEFAULT_PROMPT + "\n用户补充规则（与上文冲突时以此为准）：" + String(customPrompt).trim())});
  await chrome.storage.local.remove("customPrompt");
}).catch(() => {});
const cacheReady = storageReady.then(async () => {
  const {resultCache = {}} = await chrome.storage.local.get({resultCache: {}});
  for (const [key, entry] of Object.entries(resultCache)) {
    if (validEntry(entry)) cache.set(key, entry);
  }
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}).catch(() => {});
function validEntry(entry) {
  return entry && entry.expires > Date.now() && typeof entry.result?.prob === "number" &&
    Number.isFinite(entry.result.prob) && entry.result.prob >= 0 && entry.result.prob <= 1 &&
    ["ad", "giveaway", "recruitment", "event", "organic"].includes(entry.result.kind);
}
async function cacheKey(state, s) {
  // Store only a digest, result and expiry, never the source text or API key.
  const service = s.provider === "custom" ? [s.apiUrl, s.apiProtocol, s.apiModel] : [API, "jev", "jev-latest"];
  // Rule revisions invalidate old decisions; custom rules also have separate keys.
  const parts = s.rulesPrompt ? [CLASSIFICATION_VERSION, service, state, s.rulesPrompt] : [CLASSIFICATION_VERSION, service, state];
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}
async function saveCache() {
  cacheWrites = cacheWrites.catch(() => {}).then(() => chrome.storage.local.set({resultCache: Object.fromEntries(cache)}));
  await cacheWrites.catch(() => {});
}
async function settings() {
 await storageReady;await promptReady;const s=await chrome.storage.local.get(DEFAULTS);
 for(const [key,min,max] of [['adThreshold',1,100],['cautiousThreshold',1,100],['ratioThreshold',1,100],['ratioWindow',2,100]])s[key]=Number.isFinite(Number(s[key]))?Math.min(max,Math.max(min,Math.round(Number(s[key])))):DEFAULTS[key];
 s.rulesPrompt=normalizePrompt(s.rulesPrompt);
 return s;
}
async function publicSettings() {
  const {apiKey, apiUrl, apiModel, apiProtocol, provider, ...rest} = await settings();
  // Every category needs the API, including giveaway primary/incidental checks.
  return {...rest, defaultPrompt: DEFAULT_PROMPT, configured: !!apiKey.trim()};
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !Object.keys(DEFAULTS).some(k => k in changes)) return;
  if(Object.keys(changes).every(k=>['enhancedList','autoCautionExcluded'].includes(k))){
    const change=changes.enhancedList;
    if(change){
      const before=change.oldValue||[],after=change.newValue||[];
      const ids=new Set([...before,...after].map(v=>v&&typeof v==='object'?String(v.uid):typeof v==='string'&&v.startsWith('uid:')?v.slice(4):null));
      chrome.tabs.query({}).then(tabs=>{for(const tab of tabs)for(const uid of ids)chrome.tabs.sendMessage(tab.id,uid?{type:'authorPolicyChanged',uid}:{type:'settingsChanged'}).catch(()=>{});});
    }
    return;
  }
  if (["apiKey", "provider", "apiUrl", "apiModel", "apiProtocol", "rulesPrompt"].some(k => k in changes)) {
    revision++; pending.clear();
  } else if (["enabled", "dynamics", "pinned"].some(k => k in changes)) {
    revision++; pending.clear();
  }
  cooldown = 0;
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, {type: "settingsChanged"}).catch(() => {});
  });
});
function sanitize(state) {
  if (!state || !["dynamic", "pinned"].includes(state.kind)) throw new Error("内容类型无效");
  return {platform: "bilibili", kind: state.kind,
    author: String(state.author || "").trim().slice(0, 80),
    text: String(state.text || "").slice(0, 8000),
    ...(state.originalText || state.forwardedText ? {originalText:String(state.originalText||"").slice(0,8000),forwardedText:String(state.forwardedText||"").slice(0,8000)} : {}),
    title: String(state.title || "").slice(0, 300),
    links: Array.isArray(state.links) ? state.links.slice(0, 12).map(x => String(x).slice(0, 500)) : []};
}
async function acquire() {
  if (active < 2) { active++; return; }
  if (waiting.length >= 30) throw new Error("待检测内容较多，请稍后重试");
  await new Promise(resolve => waiting.push(resolve));
}
function release() { const next = waiting.shift(); if (next) next(); else active--; }
async function callJev(state, key, config = DEFAULTS) {
  const custom = config.provider === "custom";
  let endpoint = API;
  if (custom) {
    let url;
    try { url = new URL(config.apiUrl); } catch { throw new Error("请输入完整的 HTTPS API 地址"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error("API 地址须为 HTTPS，不能包含账号、查询参数或片段");
    if (!config.apiModel?.trim()) throw new Error("请填写模型名称");
    if (!await chrome.permissions.contains({origins: [url.origin + "/*"]})) throw new Error("尚未授权接口域名，请在扩展中保存 API 设置");
    endpoint = url.href;
  }
  const openai = custom && config.apiProtocol === "openai";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const lottery = isGiveaway(state.text);
    const payload = buildClassificationRequest(state, config, lottery);
    const response = await fetch(endpoint, {
      method: "POST", credentials: "omit", redirect: "error", signal: controller.signal,
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${key}`},
      body: JSON.stringify(payload)
    });
    if (response.status === 401 || response.status === 403) throw pause("API Key 无效或权限不足，请检查设置");
    if (response.status === 429) throw pause("API 请求限流或额度不足，请稍后重试");
    if (response.status >= 500) throw pause(`API 服务暂不可用（HTTP ${response.status}）`);
    if (!response.ok) throw new Error(`API 请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    let parsed;
    if (openai) {
      try { parsed = JSON.parse(String(data?.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
      catch { throw new Error("API 返回内容不是有效 JSON，未进行标注或折叠"); }
    }
    const prob = openai ? parsed?.ad_prob : data?.answers?.is_ad?.noul;
    const recruitment = openai ? parsed?.recruitment_prob : data?.answers?.is_recruitment?.noul;
    if (![prob,recruitment].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=1)) throw new Error('API 概率格式异常，未折叠内容');
    const eventValue=openai?parsed?.event_prob:data?.answers?.is_event?.noul;
    const event=typeof eventValue==='number'&&Number.isFinite(eventValue)&&eventValue>=0&&eventValue<=1?eventValue:0;
    const categories = [];
    if(prob>=0.6) categories.push('ad');
    if(recruitment>=0.6) categories.push('recruitment');
    const primary=openai?parsed?.giveaway_primary_prob:data?.answers?.giveaway_primary?.noul;
    const incidental=openai?parsed?.giveaway_incidental_prob:data?.answers?.giveaway_incidental?.noul;
    const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
    const giveawayType=lottery&&valid(primary)&&valid(incidental) ? primary>=.8&&incidental<.8?'primary':incidental>=.8&&primary<.8?'incidental':'uncertain' : lottery?'uncertain':undefined;
    if(lottery&&giveawayType!=='uncertain')categories.push('giveaway');
    return {prob, recruitment, event, categories, giveawayType, kind:categories[0]||'organic'};
  } catch (error) {
    if (error.name === "AbortError") throw pause("API 请求超时，请检查网络后重试");
    if (error instanceof TypeError) throw pause("无法连接 API，请检查网络或代理");
    throw error;
  } finally { clearTimeout(timer); }
}
// Only service-wide failures pause all requests; a malformed single answer does not.
function pause(message) { return Object.assign(new Error(message), {pause: true}); }
function isGiveaway(text) {
  // Require an explicit lottery mechanism, not simply an opportunity or a prize.
  const t=String(text).replace(/\s+/g,'');
  if (/(?:不|没有|取消|并非|不是)抽奖/.test(t) && !/互动抽奖/.test(t)) return false;
  if (/互动抽奖/.test(t)) return true;
  return /抽奖/.test(t) && /转发|评论|关注|参与|奖品|送出|开奖/.test(t) ||
    /(?:转发|评论|关注)[\s\S]{0,60}(?:抽取|抽出|随机抽|抽[0-9一二三四五六七八九十百]+[位名人])/.test(t) ||
    /(?:抽取|抽出|随机抽)[\s\S]{0,30}(?:位|名)[\s\S]{0,30}(?:送|奖|获得)/.test(t);
}
async function detect(raw) {
  const state = sanitize(raw);
  // Capture before reading settings, so a change during the read is detected.
  const rev = revision;
  const s = await settings();
  if (!s.enabled || !(state.kind === "dynamic" ? s.dynamics : s.pinned)) throw new Error("此类检测已关闭");
  const match = list => (Array.isArray(list) ? list : []).some(value => value&&typeof value==='object' ? String(value.uid)===String(raw.authorId||'') : typeof value!=='string' ? false : value.startsWith('uid:') ? value.slice(4) === String(raw.authorId || '') : value === String(raw.author || '').trim());
  if (match(s.whitelist)) return {kind:'organic', prob:1, fold:false, rule:'whitelist'};
  const needsGiveaway=isGiveaway(state.text)&&s.foldCategories.includes('giveaway');
  if(needsGiveaway&&!s.apiKey.trim())return {kind:'organic',categories:[],prob:0,fold:false,rule:'local',giveawayType:'uncertain'};
  if (!needsGiveaway&&!s.foldCategories.some(k=>k==='ad'||k==='recruitment'||k==='event')) return {kind:'organic',categories:[],prob:0,fold:false,rule:'local'};
  if (!s.apiKey.trim()) throw new Error("请先填写 API Key");
  if (!state.text.trim()) throw new Error("没有可检测的文字");
  await cacheReady;
  const key = await cacheKey(state, s);
  if (rev !== revision) throw new Error("设置已变更，请重试");
  if (validEntry(cache.get(key))) return {...cache.get(key).result};
  cache.delete(key);
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    await acquire();
    try {
      if (rev !== revision) throw new Error("设置已变更，请重试");
      if (Date.now() < cooldown) throw Object.assign(new Error("接口暂不可用，已暂停请求一分钟"), {transient: true});
      const result = await callJev(state, s.apiKey.trim(), s);
      if (rev !== revision) throw new Error("设置已变更，请重试");
      cache.set(key, {result, expires: Date.now() + CACHE_TTL});
      for (const [k, entry] of cache) if (!validEntry(entry)) cache.delete(k);
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      await saveCache();
      return result;
    } catch (e) { if (rev === revision && e.pause) cooldown = Date.now() + 60000; throw e; }
    finally { release(); }
  })();
  pending.set(key, request);
  try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const page = /^https:\/\/(t|space|www)\.bilibili\.com\//.test(sender.url || "");
  if (sender.id !== chrome.runtime.id || (!popup && !page)) return false;
  const run = async () => {
    if (message.type === 'lookupAuthor' && popup) return lookupAuthor(message.query);
    if (message.type === 'spaceList') {
      const match=/^https:\/\/space\.bilibili\.com\/([1-9][0-9]*)(?:[/?#]|$)/.exec(sender.url||'');
      if(!match)throw new Error('请在 UP 主主页操作');
      const uid=match[1];
      // Also match legacy "uid:123" strings, as detect() does.
      const hasUid=v=>v&&typeof v==='object'?String(v.uid)===uid:v==='uid:'+uid;
      const read=async()=>{const s=await settings();return {whitelist:s.whitelist.some(hasUid),enhancedList:s.enhancedList.some(hasUid)};};
      if(message.list!==undefined){
        if(!['whitelist','enhancedList'].includes(message.list)||typeof message.add!=='boolean')throw new Error('无效的名单操作');
        historyWrites=historyWrites.catch(()=>{}).then(async()=>{
          const s=await settings(),key=message.list;
          const entries=s[key].filter(v=>!hasUid(v));
          if(message.add)entries.push({uid,name:String(message.name||'').trim().slice(0,100),source:'manual'});
          const patch={[key]:entries};
          if(key==='enhancedList')patch.autoCautionExcluded=message.add?s.autoCautionExcluded.filter(v=>v!==uid):[...new Set([...s.autoCautionExcluded,uid])];
          await chrome.storage.local.set(patch);
        });
        await historyWrites;
      }
      return read();
    }
    if (message.type === "settings") return publicSettings();
    if (message.type === "detect" && page) {
      const result = {...await detect(message.state)};
      // logDetection applies the author policy against the updated history.
      await logDetection(message.state, result);
      return result;
    }
    if (message.type === "test" && popup) {
      const s = await settings();
      if (!s.apiKey.trim()) throw new Error("请先保存 API Key");
      return callJev({platform: "bilibili", kind: "pinned", text: "补充说明：视频第三分钟口误，正确年份是2024年。"}, s.apiKey.trim(), s);
    }
    throw new Error("不支持的操作");
  };
  // retry tells the page the failure is temporary and worth checking again later.
  run().then(data => reply({ok: true, data}), e => reply({ok: false, error: e.message, retry: !!(e.pause || e.transient)}));
  return true;
});

async function lookupAuthor(query) {
  const q=String(query||'').trim().slice(0,100);
  if(!/^[1-9][0-9]{0,19}$/.test(q))throw new Error('请输入纯数字 UID');
  const uid=q;
  const {filterHistory={}}=await chrome.storage.local.get({filterHistory:{}});
  const local=Object.values(filterHistory).filter(e=>e.authorId&&(uid?e.authorId===uid:e.author===q));
  const unique=new Map(local.map(e=>[e.authorId,{uid:e.authorId,name:e.author,source:'本地记录'}]));
  try {
    const endpoint='https://api.bilibili.com/x/web-interface/card?mid='+encodeURIComponent(uid);
    const response=await fetch(endpoint,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(!response.ok||data.code!==0)throw new Error('查询受限');
    const users=[data.data?.card];
    for(const u of users){const id=String(u?.mid||'');const name=String(u?.name||u?.uname||'').replace(/<[^>]*>/g,'');if(/^\d+$/.test(id)&&name)unique.set(id,{uid:id,name,source:'B站查询'});}
    if(!unique.size)throw new Error('未找到对应用户');
    return {users:[...unique.values()].slice(0,20)};
  } catch(e) {
    if(unique.size)return {users:[...unique.values()],note:'B站查询暂不可用，显示本地已检测记录'};
    throw new Error('B站查询暂不可用或未找到用户，请稍后重试；也可先浏览该 UP 主动态，再使用本地记录解析。');
  }
}
