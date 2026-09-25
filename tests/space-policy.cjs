const {chromium}=require('playwright'),vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1000,height:1000}});
 let listener,onChanged;let calls=0;const store={apiKey:'test',foldCategories:['ad']};
 const ctx=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
 fetch:async()=>{calls++;return {ok:true,json:async()=>({answers:{is_ad:{noul:.83},is_event:{noul:0},is_recruitment:{noul:0}}})};},
 chrome:{storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>{const changes=Object.fromEntries(Object.keys(v).map(k=>[k,{oldValue:structuredClone(store[k]),newValue:structuredClone(v[k])}]));Object.assign(store,structuredClone(v));onChanged?.(changes,'local');}},onChanged:{addListener(f){onChanged=f;}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,message)=>{await page.evaluate(m=>window.onMessage(m),message);}}}});
 require('./helpers/background.cjs')(ctx);
 await page.exposeFunction('sendToBackground',message=>new Promise(resolve=>listener(message,{id:'test',url:page.url()},resolve)));
 await page.route('https://space.bilibili.com/**',r=>r.fulfill({contentType:'text/html',body:'<main id="mount"></main>'}));
 await page.goto('https://space.bilibili.com/25876945/dynamic');
 await page.evaluate(()=>{
  window.chrome={runtime:{sendMessage:window.sendToBackground,onMessage:{addListener:f=>window.onMessage=f}}};
  document.querySelector('#mount').innerHTML=Array.from({length:12},(_,i)=>`<div class="bili-dyn-item" style="min-height:50px"><div class="bili-dyn-item__header"><span class="bili-dyn-title__text">极客湾</span></div><div class="bili-dyn-item__body">动态${i}<div class="bili-dyn-content__orig"><a href="https://t.bilibili.com/111">共同转发原文</a></div></div></div>`).join('');
 });
 await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
 await page.waitForFunction(()=>document.querySelectorAll('bili-breeze-ui').length===0 && document.querySelectorAll('.bili-dyn-item').length===12,{},{timeout:20000});
 // Wait for backend samples as absence of labels can also mean initial loading.
 const deadline=Date.now()+20000;
 while(Object.keys(store.filterHistory||{}).length<12&&Date.now()<deadline)await page.waitForTimeout(200);
 await page.waitForFunction(()=>document.querySelectorAll('bili-breeze-ui').length===0);
 assert.equal(Object.keys(store.filterHistory).length,12,'forward links must not merge separate dynamics');
 assert(Object.values(store.filterHistory).every(r=>r.authorId==='25876945'),'space UID fallback');
 assert(Object.values(store.filterHistory).some(r=>r.autoCautious&&r.adThreshold===90),'automatic cautious activated');
 assert.equal(await page.locator('.bili-dyn-item').evaluateAll(es=>es.filter(e=>getComputedStyle(e).display==='none').length),0,'83% cards restored below 90%');
 assert.equal(calls,12,'policy refresh reuses cached results');
 assert.equal(store.enhancedList.length,1);assert.equal(store.enhancedList[0].source,'auto');
 await page.evaluate(()=>{
  window.flickers=0;const cards=[...document.querySelectorAll('.bili-dyn-item')];
  const observer=new MutationObserver(ms=>{for(const m of ms)if(m.attributeName==='style')window.flickers++;});
  for(const c of cards)observer.observe(c,{attributes:true,attributeFilter:['style']});
  for(let i=0;i<6;i++){window.dispatchEvent(new Event('scroll'));window.onMessage({type:'authorPolicyChanged',uid:'25876945'});}
 });
 await page.waitForTimeout(2500);
 assert.equal(await page.evaluate(()=>window.flickers),0,'saved caution must not re-hide/re-show visible cards');
 assert.equal(calls,12);
 await page.reload();
 await page.evaluate(()=>{window.chrome={runtime:{sendMessage:window.sendToBackground,onMessage:{addListener:f=>window.onMessage=f}}};document.querySelector('#mount').innerHTML='<div class="bili-dyn-item"><div class="bili-dyn-item__header"><span class="bili-dyn-title__text">极客湾</span></div><div class="bili-dyn-item__body">新动态，广告占比已变化</div></div>';});
 await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('bili-breeze-ui').count(),0,'saved caution survives page reload');

 await browser.close();console.log('PASS integrated space feed: no author links, shared forwarded link, 12 unique samples, auto cautious restores 83% items, no duplicate API calls');
})().catch(e=>{console.error(e);process.exit(1)});
