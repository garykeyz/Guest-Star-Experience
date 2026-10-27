import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {projectVdjDisplay,createVdjOverlayHttp} from '../src/vdj-overlay.mjs';
const request={id:'request-opaque',singer:'Ana',song:'Título del huésped',artist:'Artista del huésped',comment:'Hello',email:'private@example.test',phone:'123',room:'901',guestIdentity:'secret',status:'En cola'};
const fixture=()=>({mode:'bridge',activity:{activityId:'a',activityRunning:true,accepting:true},tenant:{activity:{activityId:'a',name:'Karaoke Night'},hotel:{hotelId:'h',name:'Hotel'},venue:{venueId:'v'},branding:{primaryColor:'#ff2d95',secondaryColor:'#8b3dff',accentColor:'#00c8ff',hotelLogoUrl:'https://example.test/logo.png'},kioskAccess:{activityId:'a',hotelId:'h',venueId:'v',status:'active',pin:'123456',joinUrl:'https://request.example/join/public'}},requests:[request],entries:[{linkedRequestId:request.id,filePath:'/music/filename.mp4',singer:'Wrong',song:'filename'}],playback:{connected:true,decks:[{loaded:true,playing:true,filePath:'/music/filename.mp4',title:'Filename title',artist:'Filename artist'}]},identify:()=>({id:request.id})});
test('Guest metadata wins and public projection strips private data / paths / IDs',()=>{
 const state=projectVdjDisplay(fixture());assert.equal(state.state,'NOW SINGING');assert.equal(state.current.displaySongTitle,request.song);assert.equal(state.current.singerName,'Ana');assert.equal(state.next.length,0);
 const json=JSON.stringify(state);for(const privateValue of ['private@example','901','secret','request-opaque','/music'])assert.ok(!json.includes(privateValue));
});
test('manual or ambiguous track uses official VDJ metadata, never guest misattribution',()=>{
 const f=fixture();f.identify=()=>null;assert.equal(projectVdjDisplay(f).current.displaySongTitle,'Filename title');assert.equal(projectVdjDisplay(f).current.metadataSource,'virtualdj');
});
test('reorder, remove, completed, activity/hotel/branding/QR scope changes use existing records',()=>{
 const f=fixture();f.playback.decks=[];f.requests.push({...request,id:'r2',singer:'Ben'});f.entries=[{linkedRequestId:'r2'},{linkedRequestId:request.id}];assert.deepEqual(projectVdjDisplay(f).next.map(r=>r.singerName),['Ben','Ana']);
 f.requests[0]={...request,outcome:'skipped'};assert.equal(projectVdjDisplay(f).next.length,1);
 f.tenant.hotel.hotelId='h2';assert.equal(projectVdjDisplay(f).pin,'');assert.equal(projectVdjDisplay(f).requestUrl,'');
 f.tenant.branding.primaryColor='#123456';assert.equal(projectVdjDisplay(f).theme.primary,'#123456');
 f.tenant.kioskAccess.pin='111111';f.tenant.kioskAccess.hotelId='h2';assert.equal(projectVdjDisplay(f).pin,'111111');
 f.activity.activityId='other';assert.equal(projectVdjDisplay(f).state,'NO ACTIVITY');assert.deepEqual(projectVdjDisplay(f).next,[]);
});
test('every lifecycle state and Player isolation',()=>{
 const f=fixture();f.playback.decks=[];
 assert.equal(projectVdjDisplay({...f,finalizing:true}).state,'FINALIZING ACTIVITY');
 assert.equal(projectVdjDisplay({...f,activity:{...f.activity,activityRunning:false,activityFinishedAt:'now'}}).state,'ACTIVITY FINISHED');
 assert.equal(projectVdjDisplay({...f,activity:{...f.activity,activityRunning:false,accepting:false}}).state,'ACTIVITY READY');
 assert.equal(projectVdjDisplay({...f,activity:{...f.activity,activityRunning:false}}).state,'REQUESTS OPEN');
 assert.equal(projectVdjDisplay(f).state,'BETWEEN SONGS');f.entries=[];
 assert.equal(projectVdjDisplay(f).state,'WAITING FOR SINGER');f.activity.accepting=false;
 assert.equal(projectVdjDisplay(f).state,'REQUESTS CLOSED');assert.equal(projectVdjDisplay({...f,mode:'player'}).enabled,false);
});
test('read-only HTTP, loopback Host, ETag, public data, no arbitrary logo URLs',async()=>{
 const handler=createVdjOverlayHttp(()=>projectVdjDisplay(fixture()));const server=createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://127.0.0.1')))res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 try {
  const r=await fetch(url+'/api/vdj/state');assert.equal(r.status,200);const s=await r.json();assert.ok(!s.logoUrl);assert.ok(s.logo.startsWith('/api/vdj/logo/hotel'));
  assert.equal((await fetch(url+'/api/vdj/state',{headers:{'If-None-Match':r.headers.get('etag')}})).status,304);
  assert.equal((await fetch(url+'/api/vdj/state',{method:'POST'})).status,405);
  const badHost=await new Promise(resolve=>{const req=httpRequest(url+'/api/vdj/state',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.end();});assert.equal(badHost,403);
  assert.equal((await fetch(url+'/api/vdj/logo?url=http://localhost')).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
