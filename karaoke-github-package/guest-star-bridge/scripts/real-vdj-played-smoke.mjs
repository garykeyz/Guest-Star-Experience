import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import {
  executeVdj,
  insertKaraokeEntry,
  listKaraokeEntries,
  normalizeVdjPath,
  queryVdj,
  removeKaraokeEntry
} from '../src/virtualdj.mjs';
import { readVdjPlayback } from '../src/virtualdj-operations.mjs';

if (process.env.GUEST_STAR_RUN_REAL_VDJ_PLAYED !== '1') {
  throw new Error('Set GUEST_STAR_RUN_REAL_VDJ_PLAYED=1 to run this test against the open VirtualDJ instance.');
}

const execFileAsync = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = server => new Promise(resolve => {
  server.closeAllConnections?.();
  server.close(resolve);
});

async function waitFor(description, operation, predicate, attempts = 80, interval = 125) {
  let value;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      value = await operation();
      lastError = null;
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${description}: ${lastError?.message || JSON.stringify(value)}`);
}

async function createWaveFile(filePath, words) {
  const aiffPath = `${filePath}.aiff`;
  const longFixture = Array.from({ length: 40 }, () => words).join(' ');
  await execFileAsync('/usr/bin/say', ['-r', '90', '-o', aiffPath, longFixture]);
  await execFileAsync('/usr/bin/afconvert', [aiffPath, filePath, '-f', 'WAVE', '-d', 'LEI16@44100']);
  await rm(aiffPath, { force: true });
}

const installedConfigPath = join(homedir(), 'Library', 'Application Support', 'Guest Star', 'bridge', 'data', 'config.json');
const installedConfig = JSON.parse(await readFile(installedConfigPath, 'utf8'));
const virtualDJ = installedConfig.virtualDJ;
assert.ok(virtualDJ?.host && virtualDJ?.port, 'The installed Guest Star configuration must contain VirtualDJ Network Control settings.');

const initialPlayback = await readVdjPlayback(virtualDJ);
assert.ok(initialPlayback.connected, 'VirtualDJ must be connected.');
assert.ok(initialPlayback.decks.every(deck => !deck.playing && !deck.audible), 'Refusing to interrupt an active VirtualDJ deck.');
const initialQueue = await listKaraokeEntries(virtualDJ);
const initialQueueIdentity = initialQueue.map(entry => [normalizeVdjPath(entry.filePath), entry.singer]);

const root = await mkdtemp(join(tmpdir(), 'guest-star-real-vdj-played-'));
const token = Date.now().toString(36).toUpperCase();
const paths = [join(root, 'library', `GS Played ${token} A.wav`), join(root, 'library', `GS Played ${token} B.wav`)];
const singers = [`GS-PLAYED-${token}-A`, `GS-PLAYED-${token}-B`];
const requestIds = [`real-played-${token.toLowerCase()}-a`, `real-played-${token.toLowerCase()}-b`];
const rows = paths.map((filePath, index) => ({
  id: requestIds[index],
  singer: singers[index],
  song: `Played verification ${index + 1}`,
  artist: 'Guest Star Test',
  sourceType: 'public_request',
  status: 'Agregada a VirtualDJ',
  fileName: basename(filePath),
  stateRevision: 1,
  queuePosition: index + 1,
  durationSeconds: 5,
  timestamp: new Date(Date.now() + index).toISOString()
}));
const remoteCalls = [];
let cloud;
let child;
let eventController;
let serverOutput = '';
let bridgeBase = '';

try {
  await Promise.all([
    cp(new URL('../src', import.meta.url), join(root, 'src'), { recursive: true }),
    cp(new URL('../public', import.meta.url), join(root, 'public'), { recursive: true }),
    mkdir(join(root, 'data')),
    mkdir(join(root, 'stem-engine')),
    mkdir(join(root, 'library'))
  ]);
  await Promise.all([
    writeFile(join(root, 'package.json'), '{"type":"module"}'),
    writeFile(join(root, 'stem-engine', 'package.json'), '{}'),
    createWaveFile(paths[0], 'Guest Star played verification one.'),
    createWaveFile(paths[1], 'Guest Star played verification two.')
  ]);

  cloud = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    remoteCalls.push({ action: body.action, id: body.id || '', status: body.status || '', eventOrigin: body.eventOrigin || '' });
    let result = { ok: true, user: { role: 'superhost' }, commands: [] };
    if (body.action === 'activityState') {
      result = {
        ok: true,
        codeVersion: '4.2.0',
        bridgeFeatures: { versionedMetadata: true, playedCompareAndSet: true, administrativeReorder: true },
        state: {
          activityId: 'real-vdj-played-smoke', activityRunning: true,
          activityStartedAt: new Date().toISOString(), playbackMode: 'bridge', lastSource: 'bridge'
        },
        requests: rows
      };
    }
    if (body.action === 'bridgeRequestUpdate') {
      const item = rows.find(row => row.id === body.id);
      if (!item) result = { ok: false, code: 'REQUEST_NOT_FOUND' };
      else if (body.expectedRevision !== undefined && Number(body.expectedRevision) !== item.stateRevision) {
        result = { ok: false, code: 'REQUEST_REVISION_CONFLICT' };
      } else {
        if (body.status !== undefined) item.status = body.status;
        item.stateRevision += 1;
        result = { ok: true, request: { ...item, name: item.singer } };
      }
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(result));
  });
  const cloudPort = await listen(cloud);
  const reserve = createServer();
  const bridgePort = await listen(reserve);
  await closeServer(reserve);

  await writeFile(join(root, 'data', 'config.json'), JSON.stringify({
    configVersion: 15,
    bridgePort,
    authToken: 'real-vdj-smoke-auth',
    deviceToken: 'real-vdj-smoke-device',
    deviceId: 'real-vdj-smoke-device-id',
    lastHotelId: 'real-vdj-smoke-hotel',
    lastVenueId: 'real-vdj-smoke-venue',
    lastActivityId: 'real-vdj-played-smoke',
    libraryFolders: [join(root, 'library')],
    appsScriptUrl: `http://127.0.0.1:${cloudPort}/api/bridge`,
    virtualDJ,
    autoQueueExact: false,
    scanIntervalSeconds: 3600
  }));

  await insertKaraokeEntry(virtualDJ, { filePath: paths[0], singer: singers[0], song: rows[0].song, artist: rows[0].artist }, initialQueue.length);
  await insertKaraokeEntry(virtualDJ, { filePath: paths[1], singer: singers[1], song: rows[1].song, artist: rows[1].artist }, initialQueue.length + 1);

  child = spawn(process.execPath, [join(root, 'src', 'server.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  bridgeBase = `http://127.0.0.1:${bridgePort}`;
  const getState = () => fetch(`${bridgeBase}/api/state`).then(response => response.json());
  const post = async (path, body) => {
    const response = await fetch(`${bridgeBase}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };

  let state = await waitFor('the isolated Bridge and two linked requests', getState, value =>
    value.operatingMode?.selected === 'bridge' && requestIds.every(id =>
      value.virtualDJ?.entries?.some(entry => entry.linkedRequestId === id)));
  assert.equal(state.requests.length, 2, serverOutput);

  eventController = new AbortController();
  const events = await fetch(`${bridgeBase}/api/events`, { signal: eventController.signal });
  assert.equal(events.status, 200);

  await executeVdj(virtualDJ, `deck 1 load "${paths[0]}"`);
  await waitFor('the first real file to load', () => readVdjPlayback(virtualDJ), value =>
    normalizeVdjPath(value.decks?.[0]?.filePath) === normalizeVdjPath(paths[0]));
  await executeVdj(virtualDJ, `deck 1 loaded_song 'Already Played' 0`);
  await waitFor('the first real false Played property', () => readVdjPlayback(virtualDJ), value =>
    value.decks?.[0]?.played === false && normalizeVdjPath(value.decks[0].filePath) === normalizeVdjPath(paths[0]));
  await waitFor('the Bridge false Played baseline', getState, value => {
    const deck = value.virtualDJ?.playback?.decks?.[0];
    return deck?.played === false && normalizeVdjPath(deck.filePath) === normalizeVdjPath(paths[0]);
  });
  state = await getState();
  assert.equal(state.requests.find(item => item.id === requestIds[0]).outcome, '', 'Load with Played=false must not complete the request.');
  await executeVdj(virtualDJ, 'deck 1 play');
  try {
    state = await waitFor('real VDJ Played/X to complete the linked Guest Star request', getState, value => {
      const deck = value.virtualDJ?.playback?.decks?.[0];
      return deck?.playing === true && deck?.audible === true && deck?.played === true &&
        value.requests.find(item => item.id === requestIds[0])?.outcome === 'completed';
    });
  } catch (error) {
    throw new Error(`${error.message}\nRemote calls: ${JSON.stringify(remoteCalls)}`);
  }
  assert.equal(rows[0].status, 'Ya cantó');
  assert.equal(state.virtualDJ.playback.decks[0].played, true);
  const automaticWrites = () => remoteCalls.filter(call =>
    call.action === 'bridgeRequestUpdate' && call.id === requestIds[0] && call.status === 'Ya cantó' && call.eventOrigin === 'VDJ_EVENT');
  assert.equal(automaticWrites().length, 1, 'The real Played edge must write Completed exactly once.');
  await executeVdj(virtualDJ, 'deck 1 pause');
  await waitFor('real VDJ Pause after completion', getState, value => value.virtualDJ?.playback?.decks?.[0]?.playing === false);
  await executeVdj(virtualDJ, `deck 1 loaded_song 'Already Played' 1`);
  await delay(1500);
  assert.equal(automaticWrites().length, 1, 'Repeated Played observations must be idempotent.');

  await executeVdj(virtualDJ, `deck 1 load "${paths[1]}"`);
  await waitFor('the second real file to load', () => readVdjPlayback(virtualDJ), value =>
    normalizeVdjPath(value.decks?.[0]?.filePath) === normalizeVdjPath(paths[1]));
  await executeVdj(virtualDJ, `deck 1 loaded_song 'Already Played' 0`);
  await waitFor('the second real false Played property', () => readVdjPlayback(virtualDJ), value =>
    value.decks?.[0]?.played === false && normalizeVdjPath(value.decks[0].filePath) === normalizeVdjPath(paths[1]));
  await waitFor('the second Bridge false Played baseline', getState, value => {
    const deck = value.virtualDJ?.playback?.decks?.[0];
    return deck?.played === false && normalizeVdjPath(deck.filePath) === normalizeVdjPath(paths[1]);
  });
  const skipped = await post(`/api/requests/${encodeURIComponent(requestIds[1])}/outcome`, {
    outcome: 'skipped', commandId: `real-skip-${token.toLowerCase()}`
  });
  assert.equal(skipped.body.ok, true, JSON.stringify(skipped));
  assert.equal(rows[1].status, 'Saltado');
  await executeVdj(virtualDJ, 'deck 1 play');
  state = await waitFor('real Played/X after manual Skip', getState, value => {
    const deck = value.virtualDJ?.playback?.decks?.[0];
    return deck?.playing === true && deck?.played === true;
  });
  assert.equal(state.requests.find(item => item.id === requestIds[1]).outcome, 'skipped', 'Manual Skip must win over a later Played event.');
  assert.equal(remoteCalls.filter(call => call.id === requestIds[1] && call.status === 'Ya cantó').length, 0);
  await executeVdj(virtualDJ, 'deck 1 pause');
  assert.ok(!remoteCalls.some(call => call.action === 'playerRuntimeUpdate'), 'Bridge playback must not write Player telemetry.');
  assert.doesNotMatch(serverOutput, /ReferenceError|SyntaxError|TypeError/);

  console.log(JSON.stringify({
    ok: true,
    realVirtualDJ: true,
    playedCompleted: requestIds[0],
    automaticCompletedWrites: automaticWrites().length,
    manualSkipPreserved: requestIds[1],
    cloudPlaybackPolls: 0,
    initialQueueRows: initialQueue.length
  }));
} finally {
  eventController?.abort();
  if (child?.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  if (cloud) await closeServer(cloud);
  try { await executeVdj(virtualDJ, `deck 1 pause & deck 1 loaded_song 'Already Played' 0 & deck 1 unload`); } catch {}
  for (let index = 0; index < paths.length; index++) {
    try {
      await removeKaraokeEntry(virtualDJ, { filePath: paths[index], singer: singers[index], song: rows[index].song, artist: rows[index].artist });
    } catch {}
  }
  const finalQueue = await listKaraokeEntries(virtualDJ);
  assert.deepEqual(finalQueue.map(entry => [normalizeVdjPath(entry.filePath), entry.singer]), initialQueueIdentity,
    'The real VirtualDJ queue must be restored exactly after the smoke test.');
  await rm(root, { recursive: true, force: true });
}
