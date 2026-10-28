import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { reorderPlayerQueue, queueStemLabel } from '../public/player-queue-ui.js';
import { choosePlayerQueueOrder, playerQueueOrderSignature } from '../public/player-beta.js';
import { queueFunction } from './helpers/player-queue-fixture.mjs';

test('cinco turnos: mover #5 a #1, #1 a #4 y conservar los demás en orden', () => {
  const first = reorderPlayerQueue(['1','2','3','4','5'], '5', '1');
  assert.deepEqual(first.order, ['5','1','2','3','4']);
  assert.deepEqual(reorderPlayerQueue(first.order, '5', '4').order, ['1','2','3','5','4']);
});
test('movimientos repetidos conservan cada ID, incluso con títulos repetidos', () => {
  const items = ['1','2','3','4','5'].map(id => ({ id, song:'Same', metadata:{id} }));
  let order = items.map(item => item.id);
  for (let i=0;i<100;i++) order = reorderPlayerQueue(order, order.at(-1), order[0]).order;
  assert.deepEqual(order, items.map(item => item.id));
  assert.equal(new Set(order).size, 5);
  assert.deepEqual(order.map(id => items.find(item => item.id===id)), items);
});
test('drops obsoletos, sobre sí mismo y duplicados no pierden IDs', () => {
  assert.deepEqual(reorderPlayerQueue(['1','2','3'], '1', 'missing'), {order:['1','2','3'],moved:false});
  assert.deepEqual(reorderPlayerQueue(['1','2','3'], 'missing', null), {order:['1','2','3'],moved:false});
  assert.equal(reorderPlayerQueue(['1','2','3'], '2', '2').moved, false);
  assert.deepEqual(reorderPlayerQueue(['1','1','2','3'], '1', null).order, ['2','3','1']);
});
test('el acuse remoto no revierte el orden mientras espera persistencia', () => {
  const order = reorderPlayerQueue(['1','2','3','4','5'], '5', '1').order;
  const pendingSignature = playerQueueOrderSignature(order);
  assert.deepEqual(choosePlayerQueueOrder({remoteOrder:['1','2','3','4','5'],localOrder:order,pendingSignature}).order, order);
  assert.equal(choosePlayerQueueOrder({remoteOrder:order,localOrder:order,pendingSignature}).acknowledgedPending, true);
});
test('reordenar con pista activa y stems preparando no llama al transporte', async () => {
  const requests = ['1','2','3','4','5'].map(id => ({id, song:'Same', stem:id==='4'?{status:'processing',progress:10}:null}));
  const saved = [], calls = [];
  const context = vm.createContext({ order:requests.map(item=>item.id), currentId:'2',
    queue: () => requests, reorderPlayerQueue, saveOrder: options => saved.push({...options}),
    renderQueue: () => calls.push('render'), publish: () => calls.push('publish') });
  vm.runInContext(queueFunction('reorderQueueItem'),context);
  context.reorderQueueItem('5','1');
  assert.deepEqual(Array.from(context.order), ['5','1','2','3','4']);
  assert.equal(context.currentId,'2');
  assert.deepEqual(saved,[{remote:true,queueOnly:true}]);
  assert.deepEqual(calls,['render','publish']);
  assert.equal(requests[3].stem.progress,10);
});
test('el endpoint existente recibe solamente queueOrder y serializa cambios en vuelo', async () => {
  const payloads=[];
  let release;
  const context=vm.createContext({order:['5','1','2','3','4'],queueOrderSaveInFlight:false,queueOrderSavePending:true,playerPreparationReady:()=>true,
    api:async (url,options)=>{ assert.equal(url,'/api/player/runtime'); payloads.push(JSON.parse(options.body)); if(payloads.length===1) await new Promise(resolve=>{release=resolve;}); }});
  vm.runInContext(queueFunction('persistQueueOrder'),context);
  const saving=context.persistQueueOrder();
  context.order=['1','2','3','5','4']; context.queueOrderSavePending=true;
  await context.persistQueueOrder();
  release(); await saving;
  assert.deepEqual(payloads,[{queueOrder:['5','1','2','3','4']},{queueOrder:['1','2','3','5','4']}]);
  assert.equal(context.queueOrderSaveInFlight,false);
});
test('stems se representan en una sola etiqueta compacta para todos sus estados', () => {
  assert.equal(queueStemLabel({status:'processing',progress:10}),'10% · IA preparando');
  assert.equal(queueStemLabel({status:'ready'}),'IA lista');
  assert.equal(queueStemLabel({ready:true,improving:true}),'IA lista · mejora HQ');
  assert.equal(queueStemLabel({status:'failed'}),'IA no disponible');
  assert.equal(queueStemLabel({status:'queued',progress:200}),'100% · IA preparando');
});
test('si falla la entrega, conserva el orden y reintenta sin enviar playback', async () => {
  const timers=[];
  const context=vm.createContext({order:['5','1','2','3','4'],queueOrderSaveInFlight:false,queueOrderSavePending:true,queueOrderSaveTimer:0,
    playerPreparationReady:()=>true,api:async()=>{throw new Error('offline');},
    window:{clearTimeout(){},setTimeout(callback,delay){timers.push({callback,delay});return 1;}}});
  vm.runInContext(queueFunction('persistQueueOrder'),context);
  await context.persistQueueOrder();
  assert.deepEqual(Array.from(context.order),['5','1','2','3','4']);
  assert.equal(context.queueOrderSavePending,true);
  assert.equal(context.queueOrderSaveInFlight,false);
  assert.equal(timers[0].delay,2000);
  const received=[];
  context.api=async(url,options)=>received.push(JSON.parse(options.body));
  await timers[0].callback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(received,[{queueOrder:['5','1','2','3','4']}]);
  assert.equal(context.queueOrderSavePending,false);
});
