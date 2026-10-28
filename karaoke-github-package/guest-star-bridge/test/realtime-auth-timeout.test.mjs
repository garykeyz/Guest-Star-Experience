import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { WebSocketServer } from 'ws';

test('authentication timeout closes the actual Node WebSocket without terminating the bridge', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const body = source.match(/cloudRealtimeAuthTimer = setTimeout\(\(\) => \{([\s\S]*?)\n    \}, 10_000\);/)[1];
  const server = new WebSocketServer({ port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const peerPromise = new Promise(resolve => server.once('connection', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const peer = await peerPromise;
  const closed = new Promise(resolve => peer.once('close', code => resolve(code)));
  const context = vm.createContext({ cloudRealtimeAuthTimer: {}, cloudRealtimeReady: false, cloudRealtimeSocket: socket, socket });
  assert.doesNotThrow(() => vm.runInContext(body, context));
  assert.equal(await closed, 4008);
  assert.equal(context.cloudRealtimeAuthTimer, null);
  await new Promise(resolve => server.close(resolve));
});
