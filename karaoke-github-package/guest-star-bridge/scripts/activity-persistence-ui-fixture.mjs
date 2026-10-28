import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {activityPersistenceFixture} from '../test/helpers/activity-persistence-fixture.mjs';
const fixture=await activityPersistenceFixture({keep:true,remember:process.env.GS_UI_NO_REMEMBER!=='1'});
const instrumentation=`<script>
(()=>{
 const timers=new Map(),listeners=new Map(),rafs=new Set();
 const si=window.setInterval.bind(window),ci=window.clearInterval.bind(window),st=window.setTimeout.bind(window),ct=window.clearTimeout.bind(window),raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
 const origin=()=>new Error().stack.split('\\n').find(l=>/app\\.js|bridge-operations|stereo-meter|player-beta|operations-dashboard/.test(l))||'other';
 window.setInterval=(fn,delay,...args)=>{const id=si(fn,delay,...args);timers.set(id,{kind:'interval',origin:origin()});return id;};
 window.clearInterval=id=>{timers.delete(id);ci(id);};
 window.setTimeout=(fn,delay,...args)=>{const id=st(()=>{timers.delete(id);fn(...args);},delay);timers.set(id,{kind:'timeout',origin:origin()});return id;};
 window.clearTimeout=id=>{timers.delete(id);ct(id);};
 window.requestAnimationFrame=fn=>{const id=raf(t=>{rafs.delete(id);fn(t);});rafs.add(id);return id;};window.cancelAnimationFrame=id=>{rafs.delete(id);caf(id);};
 for(const target of [window,document]){const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);target.addEventListener=(type,fn,options)=>{const key=(target===window?'window:':'document:')+type;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);return add(type,fn,options);};target.removeEventListener=(type,fn,options)=>{listeners.get((target===window?'window:':'document:')+type)?.delete(fn);return remove(type,fn,options);};}
 const es=window.EventSource;let sources=0;window.EventSource=class extends es{constructor(...a){super(...a);sources++;}close(){sources--;super.close();}};
 si(()=>{let out=document.getElementById('runtimeDiagnostics');if(!out){out=document.createElement('output');out.id='runtimeDiagnostics';out.hidden=true;document.body.append(out);}out.textContent=JSON.stringify({timers:[...timers.values()],listeners:Object.fromEntries([...listeners].map(([k,v])=>[k,v.size])),rafCount:rafs.size,sse:sources,dashboards:document.querySelectorAll('#operationsDock').length,meters:document.querySelectorAll('.stereo-meter').length});},200);
})();</script>`;
const proxy=createServer(async(req,res)=>{try{const headers={...req.headers,host:new URL(fixture.base).host};delete headers.origin;const init={method:req.method,headers};if(!['GET','HEAD'].includes(req.method)){const chunks=[];for await(const c of req)chunks.push(c);init.body=Buffer.concat(chunks);}
const upstream=await fetch(fixture.base+req.url,init);res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('Content-Type')||'text/plain');
if(['/','/operate'].includes(new URL(req.url,'http://localhost').pathname)){let html=await upstream.text();html=html.replace('<head>','<head>'+instrumentation);res.end(html);return;}
if(req.url==='/api/events'){res.setHeader('Cache-Control','no-cache');const reader=upstream.body.getReader();req.on('close',()=>reader.cancel());while(true){const {done,value}=await reader.read();if(done)break;res.write(value);}res.end();return;}
res.end(Buffer.from(await upstream.arrayBuffer()));}catch(e){res.end(String(e));}});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+proxy.address().port;
const record={url,base:fixture.base,root:fixture.root};console.log(JSON.stringify(record));
if(process.env.GS_UI_FIXTURE_RECORD)await writeFile(process.env.GS_UI_FIXTURE_RECORD,JSON.stringify(record));
process.on('SIGTERM',async()=>{proxy.closeAllConnections();proxy.close();await fixture.close();process.exit();});
