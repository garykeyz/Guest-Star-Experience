import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
function health({now=100000,lastMessage=100000,lastRead=100000,generation=1,ready=true}={}){
 const calls={ping:0,close:0,reconnect:0,fallback:0,refresh:0,timers:[]};
 const socket={readyState:1,send:()=>calls.ping++,close:()=>calls.close++};
 const state=vm.createContext({Date:{now:()=>now},cloudRealtimeGeneration:1,cloudRealtimeEligible:()=>true,cloudRealtimeHealthTimer:null,cloudRealtimeSocket:socket,cloudRealtimeReady:ready,cloudRealtimeLastMessageAt:lastMessage,cloudRealtimeLastReconcileAt:lastRead,cloudRealtimeAuthTimer:null,cloudDelivery:{reconnects:0},console:{warn:()=>{}},
  setTimeout:(fn,delay)=>{calls.timers.push({fn,delay});return{unref(){}};},clearTimeout:()=>{},scheduleCloudReconnect:()=>calls.reconnect++,scheduleCloudFallback:()=>calls.fallback++,refreshCloudAfterSignal:async()=>calls.refresh++});
 vm.runInContext(source.slice(source.indexOf('function scheduleCloudHealth('),source.indexOf('function connectCloudRealtime(')),state);
 state.scheduleCloudHealth(generation);return {calls,state,tick:()=>calls.timers.shift()?.fn()};
}
test('healthy heartbeat uses only the socket and owns one timer',()=>{
 const h=health();h.state.scheduleCloudHealth(1);assert.equal(h.calls.timers.length,1);assert.equal(h.calls.timers[0].delay,20000);h.tick();assert.equal(h.calls.ping,1);assert.equal(h.calls.refresh,0);assert.equal(h.calls.timers.length,1);
});
test('a silent socket is detached even if close never emits an event',()=>{
 const h=health({lastMessage:0});h.tick();assert.equal(h.state.cloudRealtimeSocket,null);assert.equal(h.state.cloudRealtimeReady,false);assert.equal(h.calls.close,1);assert.equal(h.calls.reconnect,1);assert.equal(h.calls.fallback,1);
});
test('durable reconciliation runs even while valid pongs keep the socket healthy',()=>{
 const h=health({lastRead:0});h.tick();assert.equal(h.calls.refresh,1);assert.equal(h.calls.ping,1);assert.equal(h.calls.reconnect,0);
});
test('retired generations cannot refresh, ping, reconnect or create another timer',()=>{
 const h=health();h.state.cloudRealtimeGeneration++;h.tick();assert.equal(h.calls.ping+h.calls.refresh+h.calls.reconnect,0);assert.equal(h.calls.timers.length,0);
});
