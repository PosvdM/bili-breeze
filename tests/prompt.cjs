const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',foldCategories:['ad','giveaway']};let listener,calls=0,lastPayload;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async(url,init)=>{calls++;lastPayload=JSON.parse(init.body);return {ok:true,json:async()=>store.provider==='custom'?{choices:[{message:{content:'{"ad_prob":0.9,"recruitment_prob":0}'}}]}:{answers:{is_ad:{noul:.9},is_recruitment:{noul:0},giveaway_primary:{noul:.95},giveaway_incidental:{noul:0}}}};},
chrome:{permissions:{contains:async()=>true},storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v))},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
vm.runInContext(fs.readFileSync('background.js','utf8'),context);
const send=text=>new Promise(r=>listener({type:'detect',state:{kind:'dynamic',text,author:'UP',authorId:'1'}},{id:'test',url:'https://t.bilibili.com/'},r));
(async()=>{
 const state={platform:'bilibili',kind:'dynamic',text:'x',title:'',links:[]};
 context.state=state;
 const legacy=require('node:crypto').createHash('sha256').update(JSON.stringify(['events-v5',['https://api.typesafe.ai/v1/systemone','jev','jev-latest'],state])).digest('hex');
 assert.equal(await vm.runInContext("cacheKey(state,{provider:'jev',customPrompt:''})",context),legacy,'empty prompt keeps existing cache keys');
 assert.notEqual(await vm.runInContext("cacheKey(state,{provider:'jev',customPrompt:'规则'})",context),legacy);

 await send('新品上市');
 assert(!JSON.stringify(lastPayload).includes('用户补充规则'),'no custom block without a prompt');
 store.customPrompt='  游戏官方号宣传新活动也算广告  ';
 const r=await send('新品上市');assert.equal(r.ok,true);assert.equal(calls,2,'changed prompt classifies again');
 for(const q of Object.values(lastPayload.questions))assert(q.instructions.includes('用户补充规则（与上文冲突时以此为准，不改变输出格式）：游戏官方号宣传新活动也算广告'),'every question gets the prompt');
 await send('新品上市');assert.equal(calls,2,'same prompt reuses cache');
 await send('互动抽奖 转发抽1人送耳机');
 assert(lastPayload.questions.giveaway_primary.instructions.includes('游戏官方号宣传新活动也算广告'),'giveaway questions get the prompt');

 store.customPrompt='A'.repeat(3000);await send('长提示词');
 assert(!lastPayload.questions.is_ad.instructions.includes('A'.repeat(2001)),'prompt capped at 2000 characters');

 Object.assign(store,{provider:'custom',apiProtocol:'openai',apiUrl:'https://example.test/v1/chat/completions',apiModel:'m',customPrompt:'自家周边也算广告'});
 await send('周边开售');
 const system=lastPayload.messages[0].content;
 assert(system.includes('自家周边也算广告'));
 assert(system.indexOf('自家周边也算广告')<system.indexOf('只输出JSON'),'output format stays last');
 console.log('PASS custom prompt: all questions and both APIs, output format last, cache key compatibility, re-classify on change, 2000-char cap');
})().catch(e=>{console.error(e);process.exit(1)});
