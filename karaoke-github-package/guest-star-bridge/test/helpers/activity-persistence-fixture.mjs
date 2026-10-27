import {createServer} from 'node:http';
import {cp,mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function activityPersistenceFixture({keep=false,remember=true,automation=false,cloudDelay=0,runtimeSource='',playing=false,autoQueueExact=false,manualVdj=false,auditWrites=false,role='superhost',startedAt='2026-10-05T18:00:00.000Z'}={}) {
  const root=await mkdtemp(join(tmpdir(),'guest-star-activity-persistence-'));
  await Promise.all(['src','public'].map(d=>cp(runtimeSource?join(runtimeSource,d):new URL('../../'+d,import.meta.url),join(root,d),{recursive:true})));
  await Promise.all(['data','library','stem-engine'].map(d=>mkdir(join(root,d))));
  await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'stem-engine/package.json'),'{}');
  const paths=['A','B','external'].map(n=>join(root,'library',n+'.wav'));
  for(const path of paths) await writeFile(path,Buffer.alloc(44));
  const started=startedAt;
  const activities={A:{hotelId:'hotel-A',venueId:'venue-A',activityId:'A',name:'Activity A',status:'finished'},B:{hotelId:'hotel-B',venueId:'venue-B',activityId:'B',name:'Activity B',status:'scheduled'}};
  const rows={A:[{id:'a-queued',singer:'Singer A',song:'A',artist:'Artist A',fileName:paths[0],status:'Agregada a VirtualDJ',durationSeconds:120,stateRevision:1},{id:'a-finished',singer:'Finished A',song:'Finished',status:'Ya cantó',stateRevision:1},{id:'a-pending',singer:'Pending A',song:'Missing A',status:'Pendiente',stateRevision:1}],B:[{id:'b-pending',singer:'Singer B',song:'Missing B',status:'Pendiente',durationSeconds:180,stateRevision:1}]};
  let selected='A',cloudFailureId='';const calls=[],commands=[];
  const physical=[{filepath:paths[0],singer:'Singer A',title:'A',artist:'Artist A',length:'2:00'},{filepath:paths[2],singer:'External',title:'External',artist:'Outside',length:'3:00'}];
  let master=.73,loadedPath=paths[0],vdjOnline=true,loseNextEnqueueResponse=false,beforeEffect=null;const cloudCommands=[],queries=[];
  let runStatus='in_progress',accepting=true;
  const payload=()=>({ok:true,codeVersion:'4.6',bridgeFeatures:{versionedMetadata:true,playedCompareAndSet:true,administrativeReorder:true},state:{activityId:selected,activityRunning:automation&&runStatus==='in_progress',activityStartedAt:selected==='A'?started:'',activityFinishedAt:automation?(runStatus==='finished'?new Date().toISOString():''):selected==='A'?'2026-10-05T20:00:00.000Z':'',activityHours:selected==='A'?2:3,transitionSeconds:30,accepting:automation?accepting:selected==='B',playbackMode:'',stateRevision:1},requests:rows[selected],session:automation?{runId:'fixture-run',hotelId:activities[selected].hotelId,venueId:activities[selected].venueId,activityId:selected,playbackSource:'bridge',status:runStatus,startsAt:started,startedAt:started,autoFinish:true,durationSeconds:7200}:null,hotel:{hotelId:activities[selected].hotelId,name:'Hotel '+selected,timezone:'America/Santo_Domingo'},venue:{venueId:activities[selected].venueId,name:'Venue '+selected},activity:activities[selected],kioskAccess:{...activities[selected],pin:selected==='A'?'111111':'222222',joinUrl:'https://request.gstarxp.com/join/fixture-'+selected},permissions:{all:true}});
  const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
  const cloud=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');calls.push({action:b.action,activityId:b.activityId,id:b.id});let result={ok:true};
    if(cloudDelay)await new Promise(r=>setTimeout(r,cloudDelay));
    if(automation&&['prepareSession','startActivityV4','finishActivityV4','toggleRequests'].includes(b.action)){if(b.action==='finishActivityV4'){runStatus='finished';accepting=false;}if(b.action==='startActivityV4')runStatus='in_progress';if(b.action==='toggleRequests')accepting=b.open===true;result=payload();}
    if(b.action==='pollBridgeCommands')result={ok:true,commands:cloudCommands.splice(0)};
    if(b.action==='selectActivity')selected=b.activityId;
    if(['activityState','selectActivity','toggleRequests'].includes(b.action))result=payload();
    if(b.action==='me')result={ok:true,user:{id:'fixture',role,displayName:'Fixture'},selection:{hotels:Object.values(activities).map(a=>({hotelId:a.hotelId,name:'Hotel '+a.activityId})),venues:Object.values(activities).map(a=>({venueId:a.venueId,hotelId:a.hotelId,name:'Venue '+a.activityId})),activities:Object.values(activities)}};
    if(b.action==='bridgeRequestUpdate'&&b.id===cloudFailureId){result={ok:false,code:'CLEAR_TEST_FAILURE'};}else if(b.action==='bridgeRequestUpdate'){const row=rows[selected].find(r=>r.id===b.id);if(row){for(const key of ['status','durationSeconds','singer','song','artist'])if(b[key]!==undefined)row[key]=b[key];row.stateRevision++;result={ok:true,request:{...row,name:row.singer}};}}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));});
  const cloudPort=await listen(cloud);
  const vdj=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const script=Buffer.concat(chunks).toString();
    if(!vdjOnline){res.statusCode=503;res.end('offline');return;}
    if(req.url==='/execute'){commands.push(script);
      if(manualVdj){
        beforeEffect?.(script);
        const add=script.match(/karaoke_add "([^"]+)"/),singer=script.match(/browsed_song "singer" "([^"]+)"/);
        if(add){physical.push({filepath:add[1],singer:singer?.[1]||'',title:'Added',artist:'',length:'2:00'});if(loseNextEnqueueResponse){loseNextEnqueueResponse=false;res.destroy();return;}}
        const load=script.match(/deck 1 load "([^"]+)"/);
        if(!load && script.includes('deck 1 load') && script.includes('get_next_karaoke_song') && !playing)loadedPath=physical[0]?.filepath||loadedPath;
        if(load && !playing && (!script.includes('get_next_karaoke_song') || physical[0]?.filepath===load[1]))loadedPath=load[1];
      }
      let match=script.match(/master_volume ([\d.]+)%/);if(match)master=+match[1]/100;if(script.includes('browser_remove')){const index=(script.match(/browser_scroll \+1/g)||[]).length;if(!script.includes('get_filepath')||physical[index]?.filepath!==loadedPath)physical.splice(index,1);}res.end('true');return;}
    queries.push(script);
    if(manualVdj&&script.includes('`file_count karaoke & param_cast')){res.end([physical.length,physical[0]?.filepath||'',physical[0]?.singer||'',loadedPath,playing?'on':'off',playing?'on':'off'].join('|'));return;}
    if(script.includes('`get_decks`'))res.end('1|1|'+master);
    else if(script.includes('get_vu_meter_left'))res.end('.11|.04|.11|.04');
    else if(script.includes('get_songlength'))res.end('0|120|A|Artist A|'+loadedPath);
    else if(script.includes('get_text'))res.end(loadedPath+'|'+(loadedPath?'on':'off')+'|'+(playing?'on':'off')+'|off|0|off|'+loadedPath);
    else if(script==='file_count karaoke')res.end(String(physical.length));
    else if(script==='get_clock')res.end('14:00');
    else if(script.includes('get_filepath'))res.end(loadedPath);
    else{const m=script.match(/^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/);res.end(m?physical[+(m[2]||0)]?.[m[1]==='fullpath'?'filepath':m[1]]||'':'off');}});
  const vdjPort=await listen(vdj);const reserve=createServer();const port=await listen(reserve);await new Promise(r=>reserve.close(r));
  const seed={activityId:'A',activityStartedAt:started,entries:[{id:'a-queued',filePath:paths[0],singer:'Singer A',song:'A',virtualDJItemId:'stable-A'}],recoveries:[{id:'a-finished',outcome:'completed',markedAt:started}],operationsState:{context:'A:'+started,reserveIds:['a-pending'],externalHistory:[{virtualDJItemId:'history-A',singer:'Historical A',song:'Past',outcome:'completed'}]}};
  await writeFile(join(root,'data/queue-state.json'),JSON.stringify(seed));
  await writeFile(join(root,'data/config.json'),JSON.stringify({configVersion:15,rememberSelection:remember,rememberedActivity:remember?undefined:null,bridgePort:port,authToken:'fixture-auth',deviceToken:'fixture-device',deviceId:'fixture-device-id',lastHotelId:'hotel-A',lastVenueId:'venue-A',lastActivityId:'A',libraryFolders:[join(root,'library')],appsScriptUrl:`http://127.0.0.1:${cloudPort}/api/bridge`,virtualDJ:{host:'127.0.0.1',port:vdjPort,timeoutMs:1000},autoQueueExact,autoLinkSafeMatches:false}));
  let child,output='';
  const start=async()=>{child=spawn(process.execPath,[join(root,'src/server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,...(auditWrites?{GUEST_STAR_VDJ_WRITE_AUDIT:join(root,'writes.jsonl')}:{})}});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);for(let i=0;i<150;i++){try{const s=await get();if(s.account?.authenticated&&s.tenant?.activity?.activityId===selected)return;}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,50));}throw Error(output);};
  const base=`http://127.0.0.1:${port}`,get=()=>fetch(base+'/api/state').then(r=>r.json());
  const post=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}};
  const close=async()=>{await stop();for(const s of [cloud,vdj]){s.closeAllConnections();await new Promise(r=>s.close(r));}if(!keep)await rm(root,{recursive:true,force:true});};
  await start();
  return {root,base,get,post,close,stop,start,calls,commands,queries,rows,physical,paths,activities,cloudCommands,setOnline:value=>{vdjOnline=value;},loseResponse:()=>{loseNextEnqueueResponse=true;},setPlayback:(path,play=false)=>{loadedPath=path;playing=play;},loaded:()=>loadedPath,setBeforeEffect:fn=>{beforeEffect=fn;},master:()=>master,setCloudFailure:id=>{cloudFailureId=id;}};
}
