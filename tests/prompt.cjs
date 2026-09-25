const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',foldCategories:['ad','giveaway']};let listener,calls=0,lastPayload;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async(url,init)=>{calls++;lastPayload=JSON.parse(init.body);return {ok:true,json:async()=>store.provider==='custom'?{choices:[{message:{content:'{"ad_prob":0.9,"recruitment_prob":0}'}}]}:{answers:{is_ad:{noul:.9},is_recruitment:{noul:0},giveaway_primary:{noul:.95},giveaway_incidental:{noul:0}}}};},
chrome:{permissions:{contains:async()=>true},storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v)),remove:async k=>{delete store[k];}},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
vm.runInContext(fs.readFileSync('background.js','utf8'),context);
const call=(message,url='https://t.bilibili.com/')=>new Promise(r=>listener(message,{id:'test',url},r));
const send=text=>call({type:'detect',state:{kind:'dynamic',text,author:'UP',authorId:'1'}});
(async()=>{
 const builtin=vm.runInContext('DEFAULT_PROMPT',context);
 assert(builtin.startsWith('判断 B 站内容的广告概率')&&builtin.includes('新增活动宣传类别'),'built-in rules include events');
 const settings=await call({type:'settings'},'chrome-extension://test/popup.html');
 assert.equal(settings.data.defaultPrompt,builtin,'popup receives the built-in prompt');

 const state={platform:'bilibili',kind:'dynamic',text:'x',title:'',links:[]};context.state=state;
 const legacy=require('node:crypto').createHash('sha256').update(JSON.stringify(['events-v5',['https://api.typesafe.ai/v1/systemone','jev','jev-latest'],state])).digest('hex');
 assert.equal(await vm.runInContext("cacheKey(state,{provider:'jev',rulesPrompt:''})",context),legacy,'built-in prompt keeps existing cache keys');

 await send('新品上市');
 assert.equal(lastPayload.questions.is_ad.instructions,builtin+' 返回广告概率。','built-in prompt unchanged by default');
 store.rulesPrompt='  '+builtin+'  ';await send('新品上市');
 assert.equal(calls,1,'saving the built-in text counts as built-in and reuses cache');

 store.rulesPrompt='只判断是否为品牌商单。';
 await send('新品上市');assert.equal(calls,2,'edited prompt classifies again');
 assert.equal(lastPayload.questions.is_ad.instructions,'只判断是否为品牌商单。 返回广告概率。','edited prompt replaces the built-in rules');
 assert.equal(lastPayload.questions.is_event.instructions,'只判断是否为品牌商单。 返回活动宣传概率。');
 await send('新品上市');assert.equal(calls,2,'same prompt reuses cache');
 await send('互动抽奖 转发抽1人送耳机');
 assert(lastPayload.questions.giveaway_primary.instructions.startsWith('仅判断输入内容中的抽奖主次'),'giveaway rules stay built in');
 assert(!lastPayload.questions.giveaway_primary.instructions.includes('品牌商单'));

 store.rulesPrompt='A'.repeat(5000);await send('长提示词');
 assert.equal(lastPayload.questions.is_ad.instructions,'A'.repeat(4000)+' 返回广告概率。','prompt capped at 4000 characters');

 Object.assign(store,{provider:'custom',apiProtocol:'openai',apiUrl:'https://example.test/v1/chat/completions',apiModel:'m',rulesPrompt:'自家周边也算广告。'});
 await send('周边开售');
 const system=lastPayload.messages[0].content;
 assert(system.startsWith('自家周边也算广告。只输出JSON'),'OpenAI system prompt is the edited rules plus the fixed output format');

 // 1.0.3 stored an extra prompt appended to the built-in rules; keep that meaning.
 const old={apiKey:'test',customPrompt:' 游戏官方号宣传新活动也算广告 '};let migrated;
 const ctx2=vm.createContext({...context,chrome:{...context.chrome,storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(old)}),set:async v=>Object.assign(old,structuredClone(v)),remove:async k=>{delete old[k];}},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>p,onMessage:{addListener(f){migrated=f;}}}}});
 vm.runInContext(fs.readFileSync('background.js','utf8'),ctx2);
 await new Promise(r=>migrated({type:'settings'},{id:'test',url:'popup.html'},r));
 assert.equal(old.rulesPrompt,builtin+'\n用户补充规则（与上文冲突时以此为准）：游戏官方号宣传新活动也算广告','1.0.3 extra prompt migrated');
 assert.equal('customPrompt' in old,false,'old key removed');
 console.log('PASS editable prompt: built-in default and cache keys, edit replaces rules, reset by built-in text, giveaway rules fixed, output format fixed, 4000-char cap, 1.0.3 migration');
})().catch(e=>{console.error(e);process.exit(1)});
