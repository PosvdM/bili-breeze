const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('background.js','utf8');
const store = {};
let allow=true, expectedUrl="https://api.typesafe.ai/v1/systemone", expectedModel="jev-latest", protocol="jev";
let handler, change, fetchCount=0, responseProb=.91, status=200, live=0, peak=0;
const context = vm.createContext({console,crypto:require("node:crypto").webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,Map,Date,Number,Error,TypeError,
  fetch:async (url, options)=>{
    assert.equal(url,expectedUrl);
    assert.equal(options.headers.Authorization,'Bearer own-test-key');
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.equal(body.model,expectedModel); if(protocol==='openai') assert.equal(body.messages[1].role,'user');
    fetchCount++;live++;peak=Math.max(peak,live);await new Promise(r=>setTimeout(r,15));live--;
    return {ok:status===200,status,json:async()=>protocol==='openai'?{choices:[{message:{content:JSON.stringify({ad_prob:responseProb,recruitment_prob:0})}}]}:({answers:{is_ad:{noul:responseProb},is_recruitment:{noul:0}}})};
  },
  chrome:{permissions:{contains:async()=>allow},storage:{local:{set:async values=>Object.assign(store,JSON.parse(JSON.stringify(values))),setAccessLevel:async arg=>assert.equal(arg.accessLevel,'TRUSTED_CONTEXTS'),get:async defaults=>({...defaults,...store})},onChanged:{addListener(fn){change=fn;}}},
    tabs:{query:async()=>[],sendMessage:async()=>{}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(fn){handler=fn;}}}}
});
vm.runInContext(source,context);
const sender = {id:'test',url:'https://www.bilibili.com/video/test/'};
function send(message, from=sender){return new Promise(resolve=>{if(!handler(message,from,resolve))resolve(null);});}
function set(values){Object.assign(store,values);change(values,'local');}
const state = text=>({kind:'pinned',text,title:'背景'});
(async()=>{
  assert.equal((await send({type:'settings'})).data.configured,false,'no key: pages stay untouched');
  assert.equal((await send({type:'detect',state:state('test')})).ok,false);assert.equal(fetchCount,0);
  set({apiKey:'own-test-key'});
  const pub = await send({type:'settings'});assert.equal(pub.data.apiKey,undefined);assert.equal(pub.data.configured,true);
  const r=await Promise.all(Array.from({length:5},()=>send({type:'detect',state:state('duplicate')})));
  assert(r.every(x=>x.ok));assert.equal(fetchCount,1);
  await send({type:'detect',state:state('duplicate')});assert.equal(fetchCount,1);
  await Promise.all(Array.from({length:7},(_,i)=>send({type:'detect',state:state('item'+i)})));
  assert.equal(peak,2);
  assert.equal(await send({type:'detect',state:state('evil')},{id:'test',url:'https://evil.example/'}),null);
  set({foldCategories:['ad']});responseProb='invalid';protocol='jev';
  assert.equal((await send({type:'detect',state:state('invalid')})).ok,false);
  responseProb=.91;
  assert.equal((await send({type:'detect',state:state('after-invalid')})).ok,true,'malformed answer does not pause requests');
  status=503;
  assert.equal((await send({type:'detect',state:state('unavailable')})).ok,false);
  const count=fetchCount;
  await send({type:'detect',state:state('cooldown')});assert.equal(fetchCount,count);
  set({whitelist:[null,{uid:'1'}]});status=200;
  assert.equal((await send({type:'detect',state:state('null-entry')})).ok,true,'null list entry does not break matching');
  set({foldCategories:['ad']});status=401;
  assert.match((await send({type:'detect',state:state('auth')})).error,/Key/);
  set({enabled:false});status=200;
  assert.equal((await send({type:'detect',state:state('disabled')})).ok,false);
  assert.equal(fetchCount,count+2);
  set({enabled:true,provider:'custom',apiUrl:'https://custom.test/v1/chat/completions',apiModel:'my-model',apiProtocol:'openai'});
  expectedUrl='https://custom.test/v1/chat/completions';expectedModel='my-model';protocol='openai';
  let custom=await send({type:'detect',state:state('custom')});assert.equal(custom.ok,true);assert.equal(custom.data.kind,'ad');
  set({apiUrl:'https://custom.test/v1/systemone',apiProtocol:'jev'});expectedUrl='https://custom.test/v1/systemone';protocol='jev';
  assert.equal((await send({type:'detect',state:state('jev-custom')})).ok,true);
  set({apiUrl:'http://custom.test/v1/systemone'});const noFetch=fetchCount;
  assert.equal((await send({type:'detect',state:state('http-reject')})).ok,false);assert.equal(fetchCount,noFetch);
  set({apiUrl:'https://custom.test/v1/systemone'});allow=false;
  assert.equal((await send({type:'detect',state:state('permission-reject')})).ok,false);assert.equal(fetchCount,noFetch);
  console.log('PASS: custom OpenAI/Jev protocols, endpoint/model selection, HTTPS and permission checks');
  console.log('PASS: no-key no-network, direct endpoint, no cookies/redirects, secret exclusion, caller validation, dedup/cache, concurrency, malformed result, cooldown, 401, disabled');
})().catch(e=>{console.error(e);process.exit(1)});

