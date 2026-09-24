const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const store={apiKey:'test',filterHistory:{}};let listener,onChanged,calls=0,notifications=[],prob=.8,event=0;
const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,URL,AbortController,setTimeout,clearTimeout,
fetch:async()=>{calls++;return {ok:true,json:async()=>({answers:{is_ad:{noul:prob},is_event:{noul:event},is_recruitment:{noul:0}}})};},chrome:{storage:{local:{setAccessLevel:async()=>{},get:async d=>({...d,...structuredClone(store)}),set:async v=>{const changes=Object.fromEntries(Object.keys(v).map(k=>[k,{oldValue:structuredClone(store[k]),newValue:structuredClone(v[k])}]));Object.assign(store,structuredClone(v));onChanged?.(changes,'local');}},onChanged:{addListener(f){onChanged=f;}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(f){listener=f;}}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,msg)=>notifications.push(msg)}}});
vm.runInContext(fs.readFileSync('background.js','utf8'),context);
const seed=(n,ads)=>Object.fromEntries(Array.from({length:n},(_,i)=>['seed'+i,{id:'seed'+i,authorId:'123',type:'dynamic',classificationVersion:'events-v5',prob:i<ads?.8:.1,kind:i<ads?'ad':'organic',categories:[i<ads?'ad':'organic'],rule:'category',firstSeen:i+1,lastSeen:Date.now()}]));
const send=(itemId,text=itemId)=>new Promise(r=>listener({type:'detect',state:{kind:'dynamic',itemId,text,author:'测试UP',authorId:'123'}},{id:'test',url:'https://t.bilibili.com/'},r));
(async()=>{
 context.sample=seed(9,9);assert.equal(vm.runInContext("authorRatio(sample,'123')",context),null);
 context.sample=seed(10,3);assert.equal(vm.runInContext("authorRatio(sample,'123')",context),null);
 context.sample=seed(10,4);assert.equal(vm.runInContext("authorRatio(sample,'123').ads",context),4);
 context.sample=seed(14,4);assert.equal(vm.runInContext("authorRatio(sample,'123')",context),null,'uses latest ten only');
 store.filterHistory=seed(9,3);
 let r=await send('tenth');assert.equal(r.data.enhanced,true);assert.equal(r.data.fold,false);assert.equal(r.data.rule,undefined);
 await new Promise(r=>setTimeout(r));assert.equal(JSON.stringify(notifications),JSON.stringify([{type:'authorPolicyChanged',uid:'123'}]),'auto caution notifies tabs once');
 const before=calls;await send('tenth');assert.equal(calls,before);assert.equal(Object.keys(store.filterHistory).length,10,'duplicate does not fill window');
 prob=.96;r=await send('high');assert.equal(r.data.fold,true,'high confidence still folds, never exempt');assert.equal(calls,before+1);
 store.cautiousThreshold=99;assert.equal((await send('high')).data.fold,false);assert.equal(calls,before+1,'threshold uses cache');
 store.autoCautious=false;assert.equal((await send('tenth')).data.fold,false,'saved list survives automatic switch off');assert.equal(store.enhancedList[0].source,'auto');
 store.adThreshold=85;assert.equal((await send('tenth')).data.fold,false);
 store.adThreshold=70;prob=.1;event=.9;store.foldCategories=['event'];r=await send('meetup');assert.equal(r.data.kind,'event');assert.equal(r.data.fold,true);
 store.foldCategories=['ad'];assert.equal((await send('meetup')).data.fold,false,'event not automatically ad');
 store.autoCautious=true;store.filterHistory=seed(9,4);prob=.1;for(let i=0;i<10;i++)await send('organic'+i);assert.equal((await send('organic9')).data.enhanced,true,'saved caution stays when latest window clears');
 store.enhancedList=[{uid:'123',name:'old'}];assert.equal((await send('organic9')).data.enhanced,true,'manual caution remains');
 store.enhancedList=[];store.autoCautionExcluded=['123'];store.filterHistory=seed(10,10);assert.equal((await send('removed')).data.enhanced,false,'removed entry not re-added');
 store.autoCautionExcluded=[];store.whitelist=[{uid:'123'}];store.filterHistory=seed(10,10);
 assert.equal((await send('whitelisted')).data.rule,'whitelist');assert.deepEqual(store.enhancedList,[],'whitelisted author not auto-added');
 console.log('PASS persistent caution: automatic saved entry, continued filtering, no exit on ratio drop, removal exclusion, cache');
})().catch(e=>{console.error(e);process.exit(1)});
