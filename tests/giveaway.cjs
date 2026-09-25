const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',foldCategories:['giveaway']};let listener,calls=0,primary=.05,incidental=.95,ad=.1,lastPayload;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async(url,init)=>{calls++;lastPayload=JSON.parse(init.body);return {ok:true,json:async()=>store.provider==='custom'?{choices:[{message:{content:JSON.stringify({ad_prob:ad,recruitment_prob:0,giveaway_primary_prob:primary,giveaway_incidental_prob:incidental})}}]}:{answers:{is_ad:{noul:ad},is_recruitment:{noul:0},giveaway_primary:{noul:primary},giveaway_incidental:{noul:incidental}}}};},chrome:{permissions:{contains:async()=>true},storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v))},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
require('./helpers/background.cjs')(context);
const send=(text,extra={})=>new Promise(r=>listener({type:'detect',state:{kind:'dynamic',text,...extra}},{id:'test',url:'https://t.bilibili.com/'},r));
(async()=>{
 const news='游戏入围金摇杆年度提名，投票通道开启。互动抽奖 转发关注抽1人送耳机';
 let r=await send(news,{originalText:'游戏入围年度提名，感谢支持',forwardedText:'投票通道开启。互动抽奖 转发关注抽1人送耳机'});
 assert.equal(r.data.giveawayType,'incidental');assert.equal(r.data.fold,false);assert(lastPayload.questions.giveaway_primary);assert.equal(lastPayload.state.originalText,'游戏入围年度提名，感谢支持');
 store.foldIncidental=true;r=await send(news,{originalText:'游戏入围年度提名，感谢支持',forwardedText:'投票通道开启。互动抽奖 转发关注抽1人送耳机'});assert.equal(r.data.fold,true);assert.equal(calls,1,'toggle reuses cache');
 store.foldCategories=[];assert.equal((await send(news)).data.fold,false,'parent giveaway switch wins');
 store.foldCategories=['giveaway'];store.foldIncidental=false;primary=.95;incidental=.02;
 assert.equal((await send('互动抽奖，奖品耳机，转发参与')).data.fold,true);
 primary=.5;incidental=.5;store.foldIncidental=true;assert.equal((await send('互动抽奖，不明确')).data.fold,false);
 primary=.9;incidental=.9;assert.equal((await send('互动抽奖，冲突')).data.fold,false);
 primary=undefined;incidental=undefined;assert.equal((await send('互动抽奖，字段缺失')).data.fold,false);
 ad=.9;store.foldCategories=['ad','giveaway'];assert.equal((await send('互动抽奖，明确广告')).data.kind,'ad');
 store.provider='custom';store.apiProtocol='openai';store.apiUrl='https://example.test/v1/chat/completions';store.apiModel='test';primary=.1;incidental=.95;ad=.1;store.foldIncidental=false;
 assert.equal((await send(news)).data.giveawayType,'incidental');assert(lastPayload.messages[0].content.includes('giveaway_incidental_prob'));
 const before=calls;store.apiKey='';assert.equal((await send('互动抽奖 无Key')).data.fold,false);assert.equal(calls,before);
 console.log('PASS giveaway: primary/incidental/uncertain/conflict/missing fields, independent ads, both APIs, separated text, toggle cache, no-key pass');
})().catch(e=>{console.error(e);process.exit(1)});
