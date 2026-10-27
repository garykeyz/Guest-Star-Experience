import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const controller=source.slice(source.indexOf('async function controlActivity(action)'),source.indexOf('\nfunction option(',source.indexOf('async function controlActivity(action)')));
function harness(mode,prepareSession,api){
 const notices=[],applied=[];
 const context=vm.createContext({state:{operatingMode:{selected:mode},tenant:{session:null},activity:{}},activityBusy:false,mountedMode:mode,bridgePendingAccepting:null,bridgePendingLifecycle:null,prepareSession,api,updateStatus(){},showNotice(...args){notices.push(args);},applyState(value){applied.push(value);},openPlaybackModeDialog(){throw Error('Unexpected mode dialog');},confirmAction:async()=>true});
 vm.runInContext(controller,context);
 return {context,notices,applied,run:()=>context.controlActivity('open')};
}
for(const mode of ['bridge','player']){
 test(`${mode}: confirmed schedule exits with success without opening activity`,async()=>{
  let calls=0;const h=harness(mode,async()=>({scheduleSaved:true,message:'Programación guardada.'}),async()=>{calls++;});await h.run();assert.equal(calls,0);assert.deepEqual(h.notices,[['Programación guardada.']]);assert.equal(h.context.activityBusy,false);assert.equal(h.applied.length,0);
 });
 test(`${mode}: free confirmation calls open once and applies confirmed state`,async()=>{
  let calls=0;const confirmed={activity:{accepting:true}};
  const h=harness(mode,async(state,{submitFree})=>({sessionPrepared:true,confirmed:await submitFree({sessionMode:'free'}),message:'Sesión libre preparada correctamente.'}),async(path,options)=>{calls++;assert.equal(path,'/api/activity/open');assert.equal(JSON.parse(options.body).sessionMode,'free');return confirmed;});await h.run();assert.equal(calls,1);assert.deepEqual(h.applied,[confirmed]);assert.deepEqual(h.notices,[['Sesión libre preparada correctamente.']]);assert.equal(h.context.activityBusy,false);
 });
 test(`${mode}: pending free confirmation produces no premature success`,async()=>{
  let release;const waiting=new Promise(r=>release=r);
  const h=harness(mode,async(state,{submitFree})=>({sessionPrepared:true,confirmed:await submitFree({sessionMode:'free'}),message:'OK'}),()=>waiting);const run=h.run();await Promise.resolve();assert.equal(h.notices.length,0);assert.equal(h.context.activityBusy,true);release({activity:{}});await run;assert.deepEqual(h.notices,[['OK']]);assert.equal(h.context.activityBusy,false);
 });
 test(`${mode}: failed free confirmation does not report success`,async()=>{
  const h=harness(mode,async(state,{submitFree})=>{try{await submitFree({sessionMode:'free'});}catch{}return null;},async()=>{throw Error('Storage unavailable');});await h.run();assert.equal(h.notices.length,0);assert.equal(h.applied.length,0);assert.equal(h.context.activityBusy,false);
 });
 test(`${mode}: cancelling preparation releases controls`,async()=>{
  const h=harness(mode,async()=>null,()=>{throw Error('Unexpected request');});await h.run();assert.equal(h.notices.length,0);assert.equal(h.context.activityBusy,false);
 });
}
for(const mode of ['bridge','player']){
 test(`${mode}: platform free mode waits for confirmation and updates shared state`,async()=>{
  let release,calls=0;const waiting=new Promise(r=>release=r);const confirmed={activity:{activityRunning:true}};
  const h=harness(mode,()=>{throw Error('Unexpected schedule dialog');},(path)=>{calls++;assert.equal(path,'/api/activity/open');return waiting;});h.context.state.entryContext={sessionType:'free'};const running=h.run();await Promise.resolve();assert.equal(h.notices.length,0);release(confirmed);await running;assert.equal(calls,1);assert.deepEqual(h.applied,[confirmed]);assert.deepEqual(h.notices,[['Sesión libre iniciada.']]);assert.equal(h.context.activityBusy,false);
 });
 test(`${mode}: platform free mode failure reports error without success`,async()=>{
  const h=harness(mode,()=>{throw Error('Unexpected schedule dialog');},async()=>{throw Error('No se pudo guardar');});h.context.state.entryContext={sessionType:'free'};await h.run();assert.deepEqual(h.notices,[['No se pudo guardar',true]]);assert.equal(h.applied.length,0);assert.equal(h.context.activityBusy,false);
 });
}
