import {DurableObject} from 'cloudflare:workers';
import {GameRoom} from './durable-object.mjs';
/** Cloudflare lifecycle facade; the same authoritative room is exercised in storage tests. */
export class GuestStarGames extends DurableObject {
 constructor(state,env){super(state,env);this.room=new GameRoom(state,env);}
 fetch(request){return this.room.fetch(request);}
 alarm(){return this.room.alarm();}
 webSocketMessage(socket,message){return this.room.webSocketMessage(socket,message);}
 webSocketClose(socket,code,reason){return this.room.webSocketClose(socket,code,reason);}
 webSocketError(socket){return this.room.webSocketError(socket);}
}
