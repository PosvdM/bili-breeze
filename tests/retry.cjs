const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.clock.install();
 await page.route('https://t.bilibili.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="bili-dyn-item" id="paused"><div class="bili-dyn-item__body">冷却中的动态</div></div><div class="bili-dyn-item" id="broken"><div class="bili-dyn-item__body">格式异常的动态</div></div>'}));
 await page.goto('https://t.bilibili.com/');
 await page.evaluate(()=>{
  window.calls={};window.recovered=false;
  window.chrome={runtime:{onMessage:{addListener(){}},async sendMessage(m){
   if(m.type==='settings')return {ok:true,data:{enabled:true,dynamics:true,pinned:true,configured:true}};
   calls[m.state.text]=(calls[m.state.text]||0)+1;
   if(m.state.text==='格式异常的动态')return {ok:false,error:'API 概率格式异常，未折叠内容',retry:false};
   return recovered?{ok:true,data:{prob:.9,kind:'ad',fold:true}}:{ok:false,error:'接口暂不可用，已暂停请求一分钟',retry:true};
  }}};
 });
 await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
 const count=text=>page.evaluate(t=>calls[t]||0,text);
 await page.clock.runFor(3000);
 assert.equal(await count('冷却中的动态'),1);assert.equal(await count('格式异常的动态'),1);
 await page.evaluate(()=>{recovered=true;});
 await page.clock.runFor(30000);
 assert.equal(await count('冷却中的动态'),1,'no retry during cooldown');
 await page.clock.runFor(35000);
 assert.equal(await count('冷却中的动态'),2,'temporary failure retried after cooldown');
 assert.equal(await page.locator('#paused').evaluate(e=>e.style.display),'none');
 assert.match(await page.locator('bili-breeze-ui').first().locator('.box').innerText(),/广告.*90%/);
 assert.equal(await count('格式异常的动态'),1,'permanent failure waits for manual retry');
 console.log('PASS retry: temporary failures rechecked after cooldown, permanent failures left for manual retry');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
