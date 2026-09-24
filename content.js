(() => {
  "use strict";
  let config = null;
  let epoch = 0;
  let busy = 0;
  let scheduled = false;
  let route = location.href;
  const records = new Map();
  const observers = new Map();
  const UI = "bili-breeze-ui";
  const VIDEO = () => location.hostname === "www.bilibili.com" && /^\/(video\/|bangumi\/play\/)/.test(location.pathname);
  function deepAll(root, selector) {
    const found = [...root.querySelectorAll(selector)];
    if (root.shadowRoot) found.push(...deepAll(root.shadowRoot, selector));
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot && node.tagName !== UI.toUpperCase()) found.push(...deepAll(node.shadowRoot, selector));
    }
    return found;
  }
  function contentText(node, excluded = null) {
    if(node===excluded)return "";
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === UI.toUpperCase() || /^(STYLE|SCRIPT|BUTTON)$/.test(node.tagName))) return "";
    if (node.tagName === "IMG") return node.getAttribute("alt") || "";
    return [...(node.shadowRoot || node).childNodes].map(child=>contentText(child,excluded)).join(" ").replace(/\s+/g, " ").trim();
  }
  function pinned(root) {
    // Require a badge, never interpret the first/hottest comment as pinned.
    return deepAll(root, '.top, .top-tag, .reply-top, .is-top, .stick, [class*="top-tag"], [class*="pin"], #top, #top-tag, #tag, .tag, span').some(el => {
      const badge = el.matches('.top, .top-tag, .reply-top, .is-top, .stick, [class*="top-tag"], [class*="pin"], #top, #top-tag');
      let ancestor = el;
      while (ancestor && ancestor !== root) {
        if (ancestor.matches?.(".sub-reply-container, .reply-box, bili-comment-replies-renderer")) return false;
        if (!badge && ancestor.matches?.("bili-rich-text, .reply-content, .text")) return false;
        ancestor = ancestor.parentElement || ancestor.getRootNode()?.host;
      }
      const text = (el.textContent || "").trim();
      return /^(置顶|UP主置顶|Pinned)$/i.test(text) && !el.hidden && getComputedStyle(el).display !== "none";
    });
  }
  function links(root) {
    return deepAll(root, "a[href]").map(a => a.href).filter(h => /^https?:/.test(h)).slice(0, 12);
  }
  function candidate(el, kind, body) {
    if (!body) return null;
    const text = contentText(body).slice(0, 8000);
    if (!text) return null;
    const forwarded=kind==='dynamic'?body.querySelector('.bili-dyn-content__orig, .bili-dyn-content__orig__wrap, .bili-dyn-item__orig, .opus-module-content__forward'):null;
    const textParts=forwarded?{originalText:contentText(body,forwarded).slice(0,8000),forwardedText:contentText(forwarded).slice(0,8000)}:{};
    const authorNode = kind === "dynamic"
      ? el.querySelector('.bili-dyn-title__text, .bili-dyn-item__header .bili-dyn-title, .opus-module-author__name')
      : document.querySelector('.up-info-container .up-name, .up-info--right .username, .up-detail .up-name');
    const author = authorNode?.textContent?.trim() || "未知 UP 主";
    const authorLink = (authorNode?.closest('a[href]') || authorNode?.querySelector('a[href]') ||
      (kind === "dynamic" ? el.querySelector('.bili-dyn-item__header a[href*="space.bilibili.com"]') : document.querySelector('.up-info-container a[href*="space.bilibili.com"], .up-info--right a[href*="space.bilibili.com"]')))?.href || "";
    // Space pages may render author names as text without profile links.
    const spaceOwner=kind==='dynamic'&&location.hostname==='space.bilibili.com' ? location.pathname.match(/^\/(\d+)\/dynamic\/?$/)?.[1] : '';
    const authorId = authorLink.match(/space\.bilibili\.com\/(\d+)/)?.[1] || spaceOwner || '';
    // Never use a link from the forwarded body as this dynamic's identity.
    const outerLink=kind==='dynamic'?[...el.querySelectorAll('a.bili-dyn-item__time, .bili-dyn-item__time a, a[href*="/opus/"], a[href*="t.bilibili.com/"]')].find(a=>!body.contains(a)):null;
    const permalink=kind==='dynamic'?outerLink?.href:location.href;
    return {el, state: {kind, text, ...textParts, author, authorId, url: permalink || location.href,
      itemId: kind === "dynamic" ? el.getAttribute('data-did') || el.getAttribute('data-id') || permalink || "" : el.getAttribute('data-rpid') || "",
      title: kind === "pinned" ? document.querySelector("h1.video-title, h1")?.textContent?.trim() || "" : "", links: links(body)}};
  }
  function collect() {
    const items = [];
    if (config.dynamics) {
      for (const el of document.querySelectorAll(".bili-dyn-item")) {
        const c = candidate(el, "dynamic", el.querySelector(".bili-dyn-item__body, .bili-dyn-content"));
        if (c) items.push(c);
      }
      if (location.pathname.startsWith("/opus/") && !items.length) {
        const el = document.querySelector(".opus-detail");
        const c = el && candidate(el, "dynamic", el.querySelector(".opus-module-content"));
        if (c) items.push(c);
      }
    }
    if (config.pinned && VIDEO()) {
      for (const el of deepAll(document, "bili-comment-thread-renderer")) {
        const main = deepAll(el, "bili-comment-renderer")[0];
        if (!main || !pinned(main)) continue;
        const body = deepAll(main, "bili-rich-text")[0];
        const c = candidate(el, "pinned", body);
        if (c) items.push(c);
      }
      for (const el of document.querySelectorAll(".reply-item, .list-item.reply-wrap")) {
        if (!pinned(el)) continue;
        const c = candidate(el, "pinned", el.querySelector(".root-reply-container .reply-content, .reply-content, .con > .text"));
        if (c) items.push(c);
      }
    }
    return items;
  }
  function restore(el, rec) {
    rec.animation?.cancel();
    rec.animation = null;
    if (rec.hidden) {
      if (rec.display) el.style.setProperty("display", rec.display, rec.priority);
      else el.style.removeProperty("display");
      rec.hidden = false;
    }
  }
  function toggleFold(el, rec, hide, animate = true) {
    // Measure the current animation frame before cancelling: rapid toggles stay smooth.
    const from = el.getBoundingClientRect().height;
    const opacity = getComputedStyle(el).opacity;
    rec.animation?.cancel();
    rec.animation = null;
    if (rec.display) el.style.setProperty("display", rec.display, rec.priority);
    else el.style.removeProperty("display");
    const fullHeight = el.getBoundingClientRect().height;
    rec.hidden = hide;
    const finish = () => {
      if (hide) el.style.setProperty("display", "none", "important");
      rec.animation = null;
    };
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    const animation = el.animate([
      {height: `${from}px`, opacity: from ? opacity : 0, overflow: "hidden", minHeight: "0"},
      {height: `${hide ? 0 : fullHeight}px`, opacity: hide ? 0 : 1, overflow: "hidden", minHeight: "0"}
    ], {duration: 220, easing: "cubic-bezier(.2,.7,.2,1)"});
    rec.animation = animation;
    animation.onfinish = () => { if (rec.animation === animation) finish(); };
  }
  function remove(el, rec) { restore(el, rec); rec.ui?.remove(); records.delete(el); }
  function panel(el, rec, message, fold = false, retry = false) {
    rec.ui?.remove();
    restore(el, rec);
    const host = document.createElement(UI);
    const root = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = ":host{display:block;margin:6px 0;font:12px/1.5 system-ui;color:#69727c}.box{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 10px;max-width:100%;box-sizing:border-box;padding:4px 8px;background:rgba(100,110,120,.06);border-radius:6px}button{cursor:pointer;border:0;padding:2px 4px;background:transparent;color:inherit;font:inherit;border-radius:4px;transition:background .15s,color .15s}button:hover{background:rgba(100,110,120,.12);color:#35424f}button:focus-visible{outline:2px solid #6993a5;outline-offset:2px}@media(prefers-color-scheme:dark){:host{color:#969da5}.box{background:rgba(160,170,180,.055)}button:hover{background:rgba(160,170,180,.12);color:#ccd2d9}}@media(prefers-reduced-motion:reduce){button{transition:none}}";
    const box = document.createElement("div"); box.className = "box";
    const label = document.createElement("span"); label.textContent = message;
    host.title = message;
    box.append(label); root.append(style, box);
    if (fold) {
      el.before(host);
    } else {
      // Keep the label with its own content, immediately above its actions.
      const container = el.shadowRoot || el;
      const actions = container.querySelector('.bili-dyn-item__footer, .bili-dyn-item__action, .reply-info, .info, #footer, #actions');
      if (actions) actions.before(host);
      else container.append(host);
    }
    rec.ui = host;
    if (fold || retry) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = retry ? "重试" : "展开内容";
      box.append(button);
      if (fold) { toggleFold(el, rec, true, false); button.setAttribute("aria-expanded", "false"); }
      button.addEventListener("click", () => {
        if (retry) { remove(el, rec); schedule(); return; }
        const hide = !rec.hidden;
        toggleFold(el, rec, hide);
        button.textContent = hide ? "展开内容" : "收起";
        button.setAttribute("aria-expanded", String(!hide));
      });
    }
  }
  function nearViewport(el) {
    const rect = el.getBoundingClientRect();
    // Pre-detect already rendered cards up to three screens ahead, without fetching pages.
    return rect.width > 0 && rect.height > 0 && rect.bottom >= -innerHeight && rect.top <= innerHeight * 4;
  }
  function foldLabel(state, data) {
    const names = {ad: "广告", giveaway: "抽奖", recruitment: "招聘", event:"活动宣传", organic: "普通内容"};
    const confidence = data.kind === "ad" && Number.isFinite(data.prob) ? ` · ${Math.round(data.prob * 100)}%` : "";
    return `${state.author} · ${data.kind==="giveaway"&&data.giveawayType==="incidental"?"附带抽奖":names[data.kind]}${confidence}`;
  }
  async function process(c) {
    const key = JSON.stringify(c.state);
    const old = records.get(c.el);
    // Temporary failures (cooldown, network) are checked again once the pause ends.
    if (old?.key === key && !(old.retryAt && Date.now() >= old.retryAt)) return;
    if (old) remove(c.el, old);
    if (busy >= 2 || !nearViewport(c.el)) return;
    const rec = {key, state:c.state, display: c.el.style.getPropertyValue("display"), priority: c.el.style.getPropertyPriority("display"), hidden: false};
    records.set(c.el, rec);
    const version = epoch;
    busy++;
    try {
      const result = await chrome.runtime.sendMessage({type: "detect", state: c.state});
      if (version !== epoch || records.get(c.el) !== rec || !c.el.isConnected) return;
      // The periodic scan checks identity while requests run; recheck before painting as well.
      const fresh = collect().find(item => item.el === c.el);
      if (!fresh || JSON.stringify(fresh.state) !== key) { remove(c.el, rec); return; }
      if (!result?.ok) {
        if (result?.retry) rec.retryAt = Date.now() + 60000;
        panel(c.el, rec, result?.error || "检测失败", false, true); return;
      }
      rec.result=result.data;
      if (result.data.fold) panel(c.el, rec, foldLabel(c.state, result.data), true);
    } catch { if (version === epoch && records.get(c.el) === rec) panel(c.el, rec, "扩展连接已断开，请刷新页面", false, false); }
    finally { busy--; schedule(); }
  }
  function observeRoots() {
    for (const [root, observer] of observers) {
      if (root !== document && !root.host.isConnected) { observer.disconnect(); observers.delete(root); }
    }
    function visit(root) {
      if (!observers.has(root)) {
        const observer = new MutationObserver(schedule);
        observer.observe(root, {childList: true, subtree: true, characterData: true});
        observers.set(root, observer);
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot && el.tagName !== UI.toUpperCase()) visit(el.shadowRoot);
    }
    visit(document);
  }
  function reset() { epoch++; for (const [el, rec] of records) remove(el, rec); }
  let spaceControl=null,spaceUid='';
  function spaceButtons(){
    const uid=location.hostname==='space.bilibili.com'?location.pathname.match(/^\/([1-9][0-9]*)(?:\/|$)/)?.[1]:null;
    if(!uid){spaceControl?.remove();spaceControl=null;spaceUid='';return;}
    if(spaceControl?.isConnected&&spaceUid===uid)return;
    spaceControl?.remove();spaceControl=null;spaceUid=uid;
    let rail=document.querySelector('.bili-dyn-home--left, .space-dynamic__left, .dynamic-container__left');
    if(!rail){
      const video=[...document.querySelectorAll('button,a,div,span')].find(el=>el.children.length===0&&el.textContent.trim()==='视频'&&el.getBoundingClientRect().width>0);
      for(let el=video?.parentElement,depth=0;el&&depth<4;el=el.parentElement,depth++){
        const text=el.textContent.replace(/\s/g,'');const box=el.getBoundingClientRect();
        if(text==='全部视频'&&box.width>=80&&box.width<=300){rail=el;break;}
      }
    }
    if(!rail)return;
    const host=document.createElement(UI);spaceControl=host;
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>:host{display:block;margin:16px 0}section{display:flex;flex-direction:column;gap:8px}button{font:14px system-ui;cursor:pointer;border:1px solid #8794a655;border-radius:8px;padding:9px 12px;background:#252c36;color:#dfe9f5}button[aria-pressed=true]{background:#164b60;border-color:#219cc3;color:#a5eaff}button:disabled{opacity:.6;cursor:wait}p{font:12px system-ui;color:#8ea8bb;margin:6px 0}</style><section><button data-list="whitelist" aria-pressed="false">加入白名单</button><button data-list="enhancedList" aria-pressed="false">谨慎过滤</button></section><p role="status"></p>`;
    rail.append(host);
    const buttons=[...root.querySelectorAll('button')],status=root.querySelector('p');
    function paint(data){for(const b of buttons){const active=!!data[b.dataset.list];b.setAttribute('aria-pressed',String(active));b.textContent=b.dataset.list==='whitelist'?(active?'已加白名单':'加入白名单'):(active?'已启用谨慎过滤':'谨慎过滤');b.title=active?'点击移除':b.dataset.list==='whitelist'?'始终显示这位 UP 主的内容':'使用谨慎模式的广告阈值';}}
    host.sync=async()=>{const r=await chrome.runtime.sendMessage({type:'spaceList'});if(r?.ok&&spaceUid===uid)paint(r.data);};
    for(const b of buttons)b.onclick=async()=>{
      for(const item of buttons)item.disabled=true;
      try{
        const name=document.querySelector('.h-name, #h-name, .up-name, .nickname, .bili-dyn-title__text')?.textContent.trim()||'';
        const r=await chrome.runtime.sendMessage({type:'spaceList',list:b.dataset.list,add:b.getAttribute('aria-pressed')!=='true',name});
        if(!r?.ok)throw Error(r?.error||'保存失败，请重试');
        if(spaceUid===uid){paint(r.data);status.textContent=r.data.whitelist&&r.data.enhancedList?'已在两个名单中，白名单优先。':'已保存';}
      }catch(e){status.textContent=e.message;}finally{for(const item of buttons)item.disabled=false;}
    };
    host.sync().catch(()=>{status.textContent='暂时无法读取名单';});
  }
  function scan() {
    scheduled = false;
    spaceButtons();
    if (!config) return;
    if (route !== location.href) { route = location.href; reset(); }
    for (const [el, rec] of records) if (!el.isConnected) remove(el, rec);
    if (!config.enabled || !config.configured || document.hidden) return;
    observeRoots();
    const candidates = collect();
    const elements = new Set(candidates.map(c => c.el));
    for (const [el, rec] of records) if (!elements.has(el)) remove(el, rec);
    for (const c of candidates) process(c);
  }
  function schedule() { if (!scheduled) { scheduled = true; setTimeout(scan, 250); } }
  async function refresh() {
    const result = await chrome.runtime.sendMessage({type: "settings"});
    if (result?.ok) { reset(); config = result.data; schedule(); }
  }
  async function updateAuthor(uid){
    for(const [el,rec] of records){
      if(String(rec.state?.authorId)!==String(uid)||!rec.result||rec.policyChecking)continue;
      rec.policyChecking=true;
      try{
        const response=await chrome.runtime.sendMessage({type:'detect',state:rec.state});
        if(records.get(el)!==rec||!response?.ok)continue;
        const wasFold=rec.result.fold;rec.result=response.data;
        if(wasFold&&!response.data.fold){restore(el,rec);rec.ui?.remove();rec.ui=null;}
        else if(!wasFold&&response.data.fold)panel(el,rec,foldLabel(rec.state,response.data),true);
      }finally{rec.policyChecking=false;}
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if(message.type==='authorPolicyChanged'){spaceControl?.sync?.().catch(()=>{});updateAuthor(message.uid).catch(()=>{});}
    else if(message.type==='settingsChanged'){spaceControl?.sync?.().catch(()=>{});refresh().catch(()=>{});}
  });
  addEventListener("scroll", schedule, {passive: true});
  addEventListener("resize", schedule, {passive: true});
  document.addEventListener("visibilitychange", schedule);
  // Also catches shadow roots attached after their host has already been inserted.
  setInterval(schedule, 2000);
  refresh().catch(() => {});
})();
