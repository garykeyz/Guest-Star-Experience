import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
class Element {
  children=[]; events={}; textContent='';
  classList={remove(){},add(){}};
  append(...children){this.children.push(...children);}
  addEventListener(name,fn){this.events[name]=fn;}
  set innerHTML(value){this.children=[];} get innerHTML(){return '';}
}
const timings=[];
test('YouTube pages cycle through 24 cached candidates, six visible, no network calls',()=>{
 const context=vm.createContext({document:{createElement:()=>new Element()},youtubePageOffsets:new Map(),duration:()=>'',copyYoutubeOption(){},openExternal(){},linkLocalFile(){},button:(label,css,handler)=>{const e=new Element();e.textContent=label;e.events.click=handler;return e;}});
 vm.runInContext(section('function renderYoutube(','function renderYoutubeForItem(')+'\nglobalThis.renderYoutube=renderYoutube;',context);
 const items=Array.from({length:24},(_,index)=>({title:`Video ${index}`,url:`https://youtu.be/${index}`,resultType:'karaoke'}));const panel=new Element();
 context.renderYoutube(panel,items,'request');
 for(let page=0;page<5;page++){
  const list=panel.children[2];assert.equal(list.children.length,6);assert.equal(list.children[0].children[0].children[1].textContent,`Video ${(page%4)*6}`);
  const start=performance.now();panel.children[3].events.click();timings.push(performance.now()-start);
 }
 context.renderYoutube(panel,items.slice(0,6),'request');assert.equal(panel.children.length,3,'no unnecessary pagination control');
});
test('Bridge request UI changes before a delayed network response; rejection rolls back',async()=>{
 let rejectFetch,resolveFetch,renders=0;
 const pending=new Promise((resolve,reject)=>{resolveFetch=resolve;rejectFetch=reject;});
 const state={operatingMode:{selected:'bridge'},requests:[{id:'request',outcome:'',queued:true,localState:'queued'}]};
 const context=vm.createContext({state,bridgeOptimisticRequests:new Map(),fetch:()=>pending,renderRequests:()=>renders++,renderVdjQueue(){},updateTimeDashboard(){}});
 vm.runInContext(section('async function api(','function showNotice(')+'\nglobalThis.api=api;',context);
 const start=performance.now();const operation=context.api('/api/requests/request/outcome',{method:'POST',body:JSON.stringify({outcome:'completed'})});
 timings.push(performance.now()-start);assert.equal(state.requests[0].outcome,'completed');assert.equal(renders,1);
 rejectFetch(new Error('Network failed'));await assert.rejects(operation,/Network failed/);assert.equal(state.requests[0].outcome,'');assert.equal(state.requests[0].queued,true);
});
test('copy confirms the clipboard before remote persistence finishes',async()=>{
 const notices=[],calls=[];let finishSave;
 const context=vm.createContext({navigator:{clipboard:{writeText:async url=>calls.push(url)}},api:()=>new Promise(resolve=>finishSave=resolve),showNotice:message=>notices.push(message)});
 vm.runInContext(section('async function copyYoutubeOption(','function renderYoutube(')+'\nglobalThis.copyYoutubeOption=copyYoutubeOption;',context);
 const operation=context.copyYoutubeOption('request','https://youtu.be/123');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);assert.deepEqual(notices,['Copiado']);finishSave({});await operation;
});
test('all local render/optimistic updates measured below 100ms in the isolated fixture',()=>{
 assert.ok(timings.length>=6);assert.ok(Math.max(...timings)<100,JSON.stringify(timings));
 console.log(JSON.stringify({localFeedbackMs:timings,maxMs:Math.max(...timings)}));
});

test('resuming a validated running Bridge opens locally without waiting for selection or YouTube',async()=>{
 const calls=[],locations=[];
 const context=vm.createContext({entryInitialized:false,state:{account:{authenticated:true,user:{}},operatingMode:{selected:'bridge'},activity:{activityRunning:true}},entryChoice:null,entryContextId:()=> 'activity',api:async url=>calls.push(url),location:{replace:url=>locations.push(url)}});
 vm.runInContext(section('function enterSelectedContext()','const diagnostics =')+'\nglobalThis.initializeEntry=initializeEntry;',context);
 await context.initializeEntry();assert.deepEqual(calls,[],'a validated running context redirects without repeating mode selection');assert.deepEqual(locations,['/operate?mode=bridge&context=activity']);
});

test('passive matching links files without inserting historically sent requests',async()=>{
 const server=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(!server.includes('async function autoQueueExactMatches('),'automatic physical insertion was removed');
 const start=server.indexOf('async function autoLinkSafeMatches()');const end=server.indexOf('async function findYoutube(',start);const sent=[],links=new Map();let saved=0;
 const context=vm.createContext({requests:[{id:'mapped'},{id:'remote',status:'Agregada a VirtualDJ'}],effectiveRequestOutcome:()=>'',requestFileLinks:links,libraryFiles:[],matchesForRequest:()=>[{autoLinkEligible:true,filePath:'/test/song.mp4'}],youtubeCache:new Map(),persistQueuedEntries:async()=>saved++,queueRequest:async id=>sent.push(id)});
 vm.runInContext(server.slice(start,end)+'\nglobalThis.autoLinkSafeMatches=autoLinkSafeMatches;',context);await context.autoLinkSafeMatches();assert.deepEqual(sent,[]);assert.equal(links.size,2);assert.equal(saved,1);
});
