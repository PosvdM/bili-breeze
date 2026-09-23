const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('https://space.bilibili.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="bili-dyn-home--left" style="position:fixed;top:40px;width:180px"><div>全部</div><div>视频</div></div><h1 class="h-name">测试UP</h1><main style="height:3000px"></main>'}));
 await page.goto('https://space.bilibili.com/123/dynamic');
 await page.evaluate(()=>{window.saved={whitelist:false,enhancedList:false};window.messages=[];window.chrome={runtime:{onMessage:{addListener:f=>window.onMessage=f},sendMessage:async m=>{window.messages.push(m);if(m.type==='settings')return {ok:true,data:{enabled:false}};if(m.list)window.saved[m.list]=m.add;return {ok:true,data:window.saved};}}};});
 await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
 const add=page.getByRole('button',{name:'加入白名单',exact:true});await add.click();await page.getByRole('button',{name:'已加白名单',exact:true}).waitFor();
 await page.getByRole('button',{name:'谨慎过滤',exact:true}).click();await page.getByRole('button',{name:'已启用谨慎过滤'}).waitFor();
 assert.equal(await page.evaluate(()=>window.messages.find(m=>m.list).name),'测试UP');
 const before=await page.locator('bili-breeze-ui').boundingBox();await page.evaluate(()=>scrollTo(0,1000));const after=await page.locator('bili-breeze-ui').boundingBox();assert.equal(before.y,after.y);
 await page.getByRole('button',{name:'已加白名单',exact:true}).click();await add.waitFor();
 await page.evaluate(()=>history.pushState({},'', '/456/dynamic'));await page.waitForTimeout(2400);assert.equal(await page.locator('bili-breeze-ui').count(),1);
 await browser.close();console.log('PASS space buttons: no API required, add/remove, author name, fixed sidebar, route dedup');
})().catch(e=>{console.error(e);process.exit(1)});

