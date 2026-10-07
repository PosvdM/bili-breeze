const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test'};let listener,changes=[],requests=[];
// Remote files by URL; a missing entry is 404, 'down' simulates an unreachable host.
let remote={},down=new Set();
const raw='https://raw.githubusercontent.com/PosvdM/bili-breeze/main/config/',proxy='https://ghfast.top/'+raw;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,AbortSignal,setTimeout,clearTimeout,
 fetch:async()=>{throw new Error('API must not be called');},
 rulesFetch:async url=>{requests.push(url);if([...down].some(h=>url.startsWith(h)))throw new TypeError('Failed to fetch');const file=url.replace(proxy,'').replace(raw,'');return file in remote?{ok:true,status:200,text:async()=>remote[file]}:{ok:false,status:404,text:async()=>'404'};},
 chrome:{storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>{changes.push(Object.keys(v));Object.assign(store,structuredClone(v));},remove:async k=>{for(const key of [].concat(k))delete store[key];}},onChanged:{addListener(){}}},
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[]}}});
require('./helpers/background.cjs')(context);
const popup=message=>new Promise(r=>listener(message,{id:'test',url:'chrome-extension://test/popup.html'},r));
const thresholds=(o={})=>JSON.stringify({adThreshold:40,cautiousThreshold:90,ratioThreshold:40,ratioWindow:10,...o});
const bundledPrompt=fs.readFileSync('config/stable/prompt.md','utf8').trim();
(async()=>{
 await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(changes.flat(),['ruleCheck'],'startup check with unreachable hosts records the attempt only');
 assert(store.ruleCheck.error,'failure is reported');
 requests=[];
 await vm.runInContext('refreshRules()',context);
 assert.equal(requests.length,0,'failed check is not retried within the hour');

 remote={'stable/prompt.md':'远程规则','stable/thresholds.json':thresholds({adThreshold:55})};
 let r=await popup({type:'refreshRules'});
 assert.equal(r.data.defaultPrompt,'远程规则');assert.equal(r.data.adThreshold,55,'unset threshold follows the remote default');
 assert.equal(r.data.ruleStatus.files.prompt.host,'raw.githubusercontent.com');assert.equal(r.data.ruleStatus.error,'');
 assert(r.data.ruleStatus.checkedAt>0);
 requests=[];await vm.runInContext('refreshRules()',context);assert.equal(requests.length,0,'checked at most once a day');
 store.ruleCheck.checkedAt-=86400000;store.ruleCheck.attemptedAt-=86400000;await vm.runInContext('refreshRules()',context);assert.equal(requests.length,2,'checked again after a day');

 down=new Set(['https://raw.githubusercontent.com/']);remote['stable/prompt.md']='代理规则';
 r=await popup({type:'refreshRules'});
 assert.equal(r.data.defaultPrompt,'代理规则','falls back to ghfast.top');assert.equal(r.data.ruleStatus.files.prompt.host,'ghfast.top');

 down=new Set();remote['stable/thresholds.json']=thresholds({adThreshold:500});remote['stable/prompt.md']='新规则';
 r=await popup({type:'refreshRules'});
 assert.equal(r.data.defaultPrompt,'新规则','valid file updates on its own');
 assert.equal(r.data.defaultThresholds.adThreshold,55,'invalid file keeps the cached copy');assert(r.data.ruleStatus.error);
 remote['stable/prompt.md']='A'.repeat(4001);r=await popup({type:'refreshRules'});
 assert.equal(r.data.defaultPrompt,'新规则','over-long prompt rejected');

 remote={'stable/prompt.md':'正式规则','stable/thresholds.json':thresholds({adThreshold:60}),'beta/prompt.md':'内测规则'};
 r=await popup({type:'refreshRules',channel:'beta'});
 assert.equal(store.ruleChannel,'beta');
 assert.equal(r.data.defaultPrompt,'内测规则');assert.equal(r.data.ruleStatus.files.prompt.channel,'beta');
 assert.equal(r.data.defaultThresholds.adThreshold,60,'file missing from beta uses stable');assert.equal(r.data.ruleStatus.files.thresholds.channel,'stable');
 down=new Set(['https://raw.githubusercontent.com/','https://ghfast.top/']);
 r=await popup({type:'refreshRules',channel:'stable'});
 assert.equal(r.data.defaultPrompt,bundledPrompt,'beta cache ignored on stable; bundled copy used when offline');
 assert.equal(r.data.defaultThresholds.adThreshold,60,'stable cache still valid');
 assert.equal((await popup({type:'refreshRules',channel:'nightly'})).ok,false,'unknown channel rejected');

 // Overrides equal to a new default follow future defaults again.
 down=new Set();remote={'stable/prompt.md':'用户规则','stable/thresholds.json':thresholds({adThreshold:70,ratioWindow:12})};
 Object.assign(store,{adThreshold:70,ratioWindow:20,rulesPrompt:'用户规则'});
 r=await popup({type:'refreshRules'});
 assert.equal('adThreshold' in store,false);assert.equal('rulesPrompt' in store,false);assert.equal(store.ratioWindow,20,'different override kept');
 assert.equal(r.data.ratioWindow,20);
 assert.equal((await new Promise(res=>listener({type:'refreshRules'},{id:'test',url:'https://t.bilibili.com/'},res))).ok,false,'pages cannot trigger checks');
 console.log('PASS rules: bundled fallback, raw then ghfast, daily check and hourly retry, per-file validation, beta channel with stable fallback, overrides equal to defaults follow defaults');
})().catch(e=>{console.error(e);process.exit(1)});
