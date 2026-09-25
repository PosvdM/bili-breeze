const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let listener,fail=false,lastUrl='',response={code:0,data:{card:{mid:123,name:'UP主'}}};
const store={filterHistory:{}};
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,AbortSignal,setTimeout,clearTimeout,
fetch:async url=>{lastUrl=url;if(fail)throw Error('blocked');return {ok:true,json:async()=>response};},chrome:{storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>Object.assign(store,structuredClone(v))},onChanged:{addListener(){}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
require('./helpers/background.cjs')(context);
const send=(query,url='chrome-extension://test/popup.html')=>new Promise(r=>listener({type:'lookupAuthor',query},{id:'test',url},r));
(async()=>{
 assert.equal((await send('123')).data.users[0].name,'UP主');assert(lastUrl.endsWith('mid=123'));
 assert.equal((await send('名字')).ok,false);
 assert.equal((await send('123','https://t.bilibili.com/')).ok,false);
 fail=true;assert.equal((await send('不存在')).ok,false);
 store.filterHistory={one:{authorId:'123',author:'本地名字'}};
 assert.equal((await send('123')).data.users[0].name,'本地名字');

 const space=(m,url='https://space.bilibili.com/123/dynamic')=>new Promise(r=>listener({type:'spaceList',...m},{id:'test',url},r));
 assert.equal((await space({list:'whitelist',add:true,name:'UP主',uid:'999'})).data.whitelist,true);
 assert.equal(store.whitelist[0].uid,'123','use sender UID, never supplied UID');
 assert.equal((await space({list:'enhancedList',add:true,name:'UP主'})).data.enhancedList,true);
 assert.equal((await space({list:'enhancedList',add:false})).data.enhancedList,false);
 assert(store.autoCautionExcluded.includes('123'));
 assert.equal((await space({list:'apiKey',add:true})).ok,false);
 assert.equal((await space({},'https://t.bilibili.com/')).ok,false);
 console.log('PASS identity: UID name lookup, non-UID rejection, restricted callers, network failure/local fallback');
})().catch(e=>{console.error(e);process.exit(1)});
