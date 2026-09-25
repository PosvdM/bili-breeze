const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const store = {apiKey:'test-only'};
let calls = 0;
function boot() {
  let listener;
  const sandbox = {crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
    fetch:async()=>{calls++;return {ok:true,json:async()=>({answers:{is_ad:{noul:.9},is_recruitment:{noul:0}}})};},
    chrome:{storage:{local:{setAccessLevel:async()=>{},get:async defaults=>({...defaults,...structuredClone(store)}),set:async values=>Object.assign(store,structuredClone(values))},onChanged:{addListener(){}}},
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(fn){listener=fn;}}},tabs:{query:async()=>[]}}};
  require('./helpers/background.cjs')(sandbox);
  return text=>new Promise(resolve=>listener({type:'detect',state:{kind:'dynamic',text,author:'测试UP',authorId:'123',url:'https://t.bilibili.com/12345'}}, {id:'test',url:'https://t.bilibili.com/'},resolve));
}
(async()=>{
  assert((await boot()('广告示例')).ok);assert.equal(calls,1);
  assert((await boot()('广告示例')).ok);assert.equal(calls,1,'worker restart uses disk cache');assert.equal(Object.keys(store.filterHistory).length,1,'repeat does not increase count');assert.equal(Object.values(store.filterHistory)[0].author,'测试UP');assert.equal(Object.values(store.filterHistory)[0].action,'折叠');
  store.apiKey='new-key';store.threshold=.4;store.mode='fold';
  assert((await boot()('广告示例')).ok);assert.equal(calls,1,'key/display changes keep cached result');
  assert(!JSON.stringify(store.resultCache).includes('广告示例'));
  assert((await boot()('广告内容变更')).ok);assert.equal(calls,2);
  for(const entry of Object.values(store.resultCache))entry.expires=1;
  assert((await boot()('广告示例')).ok);assert.equal(calls,3,'expired entry rechecked');
  console.log('PASS: persistent cache across worker restarts, key/display changes, content changes, expiry, no stored source text');
})().catch(e=>{console.error(e);process.exit(1);});
