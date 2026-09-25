const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',foldCategories:['ad','giveaway']};let listener,calls=0,ad=.9,recruitment=0;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async()=>{calls++;return {ok:true,json:async()=>({answers:{is_ad:{noul:ad},is_recruitment:{noul:recruitment},giveaway_primary:{noul:.95},giveaway_incidental:{noul:.02}}})};},chrome:{storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v))},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
require('./helpers/background.cjs')(context);
const send=text=>new Promise(r=>listener({type:'detect',state:{kind:'dynamic',text,author:'喜欢的UP',authorId:'123'}},{id:'test',url:'https://t.bilibili.com/'},r));
(async()=>{
 const yes=['互动抽奖好运来','转发+评论+关注 本月抽1人送手表','本月抽奖，奖品手表，评论参与','从评论中随机抽取三名朋友送出奖品'];
 const no=['穿上 Storm Crew 拍一张合影，就有机会被选入运载火箭上太空','有奖征集！搞卫生还能搞得有什么说法？','不抽奖，这次聊聊抽奖骗局','游戏抽卡体验','岗位招聘，期待你的加入'];
 for(const t of yes)assert.equal(vm.runInContext(`isGiveaway(${JSON.stringify(t)})`,context),true,t);
 for(const t of no)assert.equal(vm.runInContext(`isGiveaway(${JSON.stringify(t)})`,context),false,t);
 assert.equal((await send(yes[0])).data.giveawayType,'primary');assert.equal(calls,1);
 assert.equal((await send(no[0])).data.kind,'ad','model cannot invent giveaway');
 ad=.8;recruitment=.9;const mixed=await send('混合');assert.equal(JSON.stringify(mixed.data.categories),JSON.stringify(['ad','recruitment']));
 const before=calls;store.foldCategories=['recruitment'];assert.equal((await send('混合')).data.kind,'recruitment');assert.equal(calls,before);
 store.foldCategories=['ad'];store.enhancedList=['uid:123'];
 assert.equal((await send('混合')).data.fold,false,'enhanced author below 90% stays visible');assert.equal(calls,before,'enhanced gate uses cache');
 store.enhancedList=[{uid:'123',name:'改名前的名字'}];assert.equal((await send('混合')).data.fold,false,'UID enhanced rule survives rename');
 ad=.9;recruitment=0;assert.equal((await send('高置信广告')).data.fold,true,'90% boundary folds');
 const after=calls;store.whitelist=['uid:123'];assert.equal((await send('互动抽奖')).data.fold,false);assert.equal(calls,after);
 store.whitelist=[{uid:'123',name:'改名前的名字'}];assert.equal((await send('互动抽奖')).data.fold,false,'UID whitelist survives rename');
 store.whitelist=[];store.apiKey='';
 store.foldCategories=['giveaway'];assert.equal((await send(yes[0])).data.fold,false);assert.equal((await send(no[0])).data.fold,false);assert.equal(calls,after);
 console.log('PASS hybrid rules: lottery examples and exclusions, model lottery scope, independent categories, cache, lists');
})().catch(e=>{console.error(e);process.exit(1)});
