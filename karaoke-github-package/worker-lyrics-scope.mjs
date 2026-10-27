import {handleSharedLyrics} from './lib/guest-star/shared-lyrics.mjs';
// Add only three lyric actions around the exact existing production Worker.
// Its own "me" handler performs every credential/permission check unchanged.
export function createLyricsWorker(base){return {async fetch(request,env,ctx){
 const url=new URL(request.url);if(url.pathname!=='/api/bridge'||request.method!=='POST')return base.fetch(request,env,ctx);
 const raw=await request.clone().text();if(raw.length>350000)return base.fetch(request,env,ctx);let body;try{body=JSON.parse(raw);}catch{return base.fetch(request,env,ctx);}
 if(!['lyricsLookup','lyricsPublish','lyricsReview'].includes(body.action))return base.fetch(request,env,ctx);
 const verified=await base.fetch(new Request(request.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'me',authToken:body.authToken,deviceToken:body.deviceToken})}),env,ctx);
 let identity;try{identity=await verified.json();}catch{return Response.json({ok:false,code:'UNAUTHORIZED'},{status:401});}
 if(!identity.ok||!identity.user?.userId)return Response.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 try{return Response.json(await handleSharedLyrics(env.GUEST_STAR_DB,body.action,body,identity.user.userId),{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({ok:false,code:'LYRICS_OPERATION_FAILED',error:error.message},{status:400,headers:{'Cache-Control':'no-store'}});}
 }};}
