import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const limit = source.indexOf(end, offset);
  assert.ok(limit > offset, end);
  return source.slice(offset, limit);
}

test('an invalidation received during an older sync fetches again before resolving', async () => {
  let calls = 0, release;
  const oldRead = new Promise(resolve => { release = resolve; });
  const state = vm.createContext({activitySelectionBusy:false,clearOperationsBusy:false,syncOperation:null,syncAgain:false,
    performSyncNow:async()=>{calls++;if(calls===1)await oldRead;}});
  vm.runInContext(section('function syncNow() {','async function performSyncNow()'), state);
  const first = state.syncNow();
  const second = state.syncNow();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2, 'a newer invalidation cannot be satisfied by an older response');
  assert.equal(state.syncOperation, null);
});

test('request invalidation while clear holds the lock survives until a scheduled retry', async () => {
  let reads = 0, retries = 0;
  const state = vm.createContext({activitySelectionBusy:false,clearOperationsBusy:true,
    cloudRealtimePendingSync:false,cloudRealtimePendingCommands:false,cloudRealtimeGeneration:1,
    cloudRealtimeRefresh:null,cloudRealtimeRefreshGeneration:-1,cloudRealtimeReady:true,
    cloudRealtimeFallbackAttempt:0,sheetError:'',syncAgain:false,
    syncNow:async()=>{if(!state.clearOperationsBusy)reads++;},bridgeCloudLoop:async()=>{},
    terminalRealtimeError:()=>false,scheduleCloudFallback:()=>{retries++;}});
  vm.runInContext(section('function queueCloudRefresh(', 'function scheduleCloudFallback('), state);
  await state.refreshCloudAfterSignal('public.request.created');
  assert.equal(reads, 0);
  assert.equal(state.cloudRealtimePendingSync, true, 'the busy operation must not consume the only event');
  assert.equal(retries, 1);
  state.clearOperationsBusy=false;
  await state.refreshCloudAfterSignal('public.request.created');
  assert.equal(reads, 1);
  assert.equal(state.cloudRealtimePendingSync, false);
});

test('clear always releases its lock even when final persistence fails', async () => {
  const handler = section("pathname === '/api/operations/clear'", "pathname === '/api/virtualdj/control'");
  const start = handler.lastIndexOf('} finally {');
  const end = handler.indexOf('\n    });',start);
  // Execute the actual finalizer; emulate a full disk or a denied write.
  const finalizer = handler.slice(start + '} finally {'.length, end).replace(/}\s*$/, '');
  const state = vm.createContext({clearOperationsBusy:true,persistQueuedEntries:async()=>{throw new Error('disk full');}});
  await assert.rejects(vm.runInContext('(async()=>{'+finalizer+'})()',state),/disk full/);
  assert.equal(state.clearOperationsBusy,false);
});

test('burst invalidations coalesce into one trailing read and a lock stops draining', async () => {
  let calls=0, release;
  const pending=new Promise(resolve=>{release=resolve;});
  const state=vm.createContext({activitySelectionBusy:false,clearOperationsBusy:false,syncOperation:null,syncAgain:false,
    performSyncNow:async()=>{calls++;await pending;}});
  vm.runInContext(section('function syncNow() {','async function performSyncNow()'),state);
  const first=state.syncNow();
  for(let i=0;i<100;i++)state.syncNow();
  release();await first;
  assert.equal(calls,2);
  calls=0;state.clearOperationsBusy=true;
  await state.syncNow();assert.equal(calls,0);
});

test('commands deferred by an activity lock are retained and an obsolete generation does not retry', async () => {
  let commands=0,retries=0;
  const state=vm.createContext({activitySelectionBusy:true,clearOperationsBusy:false,
    cloudRealtimePendingSync:false,cloudRealtimePendingCommands:false,cloudRealtimeGeneration:1,
    cloudRealtimeRefresh:null,cloudRealtimeRefreshGeneration:-1,cloudRealtimeReady:true,
    cloudRealtimeFallbackAttempt:0,sheetError:'',syncNow:async()=>{},bridgeCloudLoop:async()=>{commands++;},
    terminalRealtimeError:()=>false,scheduleCloudFallback:()=>{retries++;}});
  vm.runInContext(section('function queueCloudRefresh(', 'function scheduleCloudFallback('),state);
  await state.refreshCloudAfterSignal('bridge.command.queued');
  assert.equal(commands,0);assert.equal(state.cloudRealtimePendingCommands,true);assert.equal(retries,1);
  state.activitySelectionBusy=false;
  await state.refreshCloudAfterSignal('bridge.command.queued');assert.equal(commands,1);
  state.syncNow=async()=>{state.cloudRealtimeGeneration++;};
  await state.refreshCloudAfterSignal('public.request.created');assert.equal(retries,1);
});
