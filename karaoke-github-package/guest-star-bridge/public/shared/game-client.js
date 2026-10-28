/** Authenticated HTTP acknowledgments + lightweight websocket invalidations. */
export function createGameClient({credentials=()=>({}),onChange=()=>{},onConnection=()=>{},endpoint='/api/games',fetcher=fetch}){
 let closed=false,socket=null,retry=0,timer=0,heartbeat=0,fallback=0,connected=false,lastPong=0;
 async function request(body){const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...credentials()})});const data=await response.json();if(!response.ok||data.ok!==true)throw Error(data.code || 'GAME_ENGINE_UNAVAILABLE');return data;}
 async function connect(){if(closed)return;try{const ticket=await request({action:'ticket'});if(closed)return;const ws=new WebSocket(ticket.websocketUrl);socket=ws;
 ws.onopen=()=>{retry=0;connected=true;lastPong=Date.now();onConnection(true);clearInterval(fallback);fallback=0;heartbeat=setInterval(()=>{if(Date.now()-lastPong>45000){ws.close();return;}if(ws.readyState===1)ws.send('ping');},20000);onChange();};
 ws.onmessage=event=>{if(event.data==='pong'){lastPong=Date.now();return;}try{const data=JSON.parse(event.data);if(data.protocol===1&&data.type==='game.changed')onChange(data);}catch{}};
 ws.onclose=()=>{if(socket!==ws)return;connected=false;onConnection(false);clearInterval(heartbeat);if(closed)return;schedule();};ws.onerror=()=>ws.close();
 }catch{onConnection(false);schedule();}}
 function schedule(){if(closed)return;if(!fallback)fallback=setInterval(()=>onChange(),10000);clearTimeout(timer);timer=setTimeout(connect,Math.min(15000,1000*2**Math.min(retry++,4)));}
 const focus=()=>{if(!closed)onChange();};
 return {request,command(game,type,payload={},id=crypto.randomUUID()){return request({action:'command',command:{protocol:1,id,type,gameId:game.id,roundId:game.round?.id,expectedRevision:game.revision,payload}});},start(){closed=false;window.addEventListener('focus',focus);void connect();},close(){closed=true;clearTimeout(timer);clearInterval(heartbeat);clearInterval(fallback);socket?.close();window.removeEventListener('focus',focus);},get connected(){return connected;}};
}
