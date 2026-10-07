const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',foldCategories:['ad','giveaway']};let listener,calls=0,lastPayload;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async(url,init)=>{calls++;lastPayload=JSON.parse(init.body);return {ok:true,json:async()=>store.provider==='custom'?{choices:[{message:{content:'{"ad_prob":0.9,"recruitment_prob":0}'}}]}:{answers:{is_ad:{noul:.9},is_recruitment:{noul:0},giveaway_primary:{noul:.95},giveaway_incidental:{noul:0}}}};},
chrome:{permissions:{contains:async()=>true},storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v)),remove:async k=>{for(const key of [].concat(k))delete store[key];}},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
require('./helpers/background.cjs')(context);
const call=(message,url='https://t.bilibili.com/')=>new Promise(r=>listener(message,{id:'test',url},r));
const send=text=>call({type:'detect',state:{kind:'dynamic',text,author:'UP',authorId:'1'}});
(async()=>{
 const builtin=fs.readFileSync('config/stable/prompt.md','utf8').trim();
 assert(builtin.includes('广告只输出一个概率，不细分类型。'));
 assert(builtin.includes('周边带货') && builtin.includes('第三方品牌合作'));
 assert(builtin.includes('抽奖主次：') && builtin.includes('两个概率都低于 0.8'),'giveaway rules are part of the single prompt');
 assert(builtin.length < 4000);
 const settings=await call({type:'settings'},'chrome-extension://test/popup.html');
 assert.equal(settings.data.defaultPrompt,builtin,'popup receives the bundled prompt');
 assert.deepEqual({...settings.data.defaultThresholds},JSON.parse(fs.readFileSync('config/stable/thresholds.json','utf8')),'popup receives the bundled defaults');
 assert.equal(settings.data.adThreshold,40,'unset threshold follows the default');
 assert.equal(settings.data.ratioWindow,10);
 assert.equal(settings.data.ruleStatus.files.prompt.host,'','bundled rules when GitHub is unreachable');
 assert.equal('prompt' in settings.data,false,'effective prompt stays in the background');

 await send('新品上市');
 assert.equal(lastPayload.questions.is_ad.instructions,builtin+'\n返回广告概率。','default prompt used for every question');
 store.rulesPrompt='  '+builtin+'  ';await send('新品上市');
 assert.equal(calls,1,'saving the default text counts as default and reuses cache');

 store.rulesPrompt='只判断是否为品牌商单。';
 await send('新品上市');assert.equal(calls,2,'edited prompt classifies again');
 assert.equal(lastPayload.questions.is_ad.instructions,'只判断是否为品牌商单。\n返回广告概率。','edited prompt replaces the default rules');
 assert.equal(lastPayload.questions.is_event.instructions,'只判断是否为品牌商单。\n返回活动宣传概率。');
 await send('新品上市');assert.equal(calls,2,'same prompt reuses cache');
 await send('互动抽奖 转发抽1人送耳机');
 assert.equal(lastPayload.questions.giveaway_primary.instructions,'只判断是否为品牌商单。\n按抽奖主次规则，返回主要抽奖的置信度。','giveaway questions use the same prompt');

 store.rulesPrompt='A'.repeat(5000);await send('长提示词');
 assert.equal(lastPayload.questions.is_ad.instructions,'A'.repeat(4000)+'\n返回广告概率。','prompt capped at 4000 characters');

 Object.assign(store,{provider:'custom',apiProtocol:'openai',apiUrl:'https://example.test/v1/chat/completions',apiModel:'m',rulesPrompt:'自家周边也算广告。'});
 await send('周边开售');
 assert(lastPayload.messages[0].content.startsWith('自家周边也算广告。\n\n只输出 JSON'),'OpenAI system prompt is the edited rules plus the fixed output format');
 assert.equal(JSON.parse(lastPayload.messages[1].content).author,'UP','OpenAI receives author context');
 await send('互动抽奖 评论抽1人送游戏');
 assert.equal(lastPayload.messages[0].content,'自家周边也算广告。\n\n只输出 JSON，包含 ad_prob, recruitment_prob, event_prob, giveaway_primary_prob, giveaway_incidental_prob，各值均为 0 到 1 的数字。');

 Object.assign(store,{provider:'jev',rulesPrompt:''});
 const official={kind:'dynamic',author:'游戏科学',authorId:'123',text:'《黑神话：钟馗》首支预告'};
 await call({type:'detect',state:official});
 assert.equal(lastPayload.state.author,'游戏科学','Jev receives author context');
 assert.equal(lastPayload.state.authorId,undefined,'UID remains local');
 const before=calls;
 await call({type:'detect',state:official});assert.equal(calls,before,'same author and text use cache');
 await call({type:'detect',state:{...official,author:'其他发布者'}});
 assert.equal(calls,before+1,'same text from another author is reclassified');
 context.raw={kind:'dynamic',text:'x',author:'  '+ '名'.repeat(100)+'  '};
 assert.equal(vm.runInContext('sanitize(raw).author.length',context),80,'author name is bounded');

 // A new default prompt from the repository invalidates cached results and auto-caution samples.
 const oldVersion=(await vm.runInContext('settings()',context)).rulesVersion;
 store.remoteRules={prompt:{value:builtin+'\n新规则。',host:'raw.githubusercontent.com',channel:'stable'}};
 const s=await vm.runInContext('settings()',context);
 assert.notEqual(s.rulesVersion,oldVersion);
 await call({type:'detect',state:official});assert.equal(calls,before+2,'new default prompt classifies again');
 assert(lastPayload.questions.is_ad.instructions.startsWith(builtin+'\n新规则。'));
 context.oldHistory={old:{authorId:'1',type:'dynamic',rule:'category',classificationVersion:oldVersion,prob:.99}};
 context.cfg={...s,ratioWindow:1};
 assert.equal(vm.runInContext("authorRatio(oldHistory,'1',cfg)",context),null,'old-rule decisions excluded from cautious-mode samples');
 console.log('PASS editable prompt: single prompt with giveaway rules, bundled defaults, author context, edit replaces rules, default text counts as default, output format fixed, 4000-char cap, new default invalidates cache and samples');
})().catch(e=>{console.error(e);process.exit(1)});
