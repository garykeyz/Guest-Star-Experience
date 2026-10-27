import { readFileSync } from 'node:fs';
import { queueFunction, playerSource } from './player-queue-fixture.mjs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
export function libraryFixtureHtml() {
  const search = html.slice(html.indexOf('          <div class="player-direct-search">'), html.indexOf('          <div class="player-operation-actions">'));
  const panel = html.slice(html.indexOf('        <section class="player-library-card hidden"'), html.indexOf('        <div class="player-layout">'));
  const dialogStart = html.indexOf('      <dialog id="playerAssignSingerDialog"');
  const dialog = html.slice(dialogStart, html.indexOf('</dialog>', dialogStart) + 9);
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/player-beta.css"><style>body.player-mode .player-workspace{height:auto;overflow:visible;display:block}#playerLocalLibrary{height:500px!important}#start{margin:12px}</style></head><body class="player-mode"><main><div id="playerWorkspace" class="player-workspace">${search}${panel}<audio id="playing" src="/playing.wav" loop></audio><button class="button primary" id="start">Iniciar audio A de prueba</button><p id="audit"></p>${dialog}</div></main><script type="module" src="/fixture.js"></script></body></html>`;
}
export function libraryFixtureModule() {
  const start = playerSource.indexOf("  $('#playerDirectSearch').addEventListener('input'");
  const end = playerSource.indexOf("  $('#playerAssignSingerForm').addEventListener", start);
  return `
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let libraryLoaded = false, libraryTracks = [], libraryOffset = 0, libraryHasMore = false, libraryBrowseAll = false;
let libraryGeneration = 0, librarySearchTimer = 0, libraryOpened = false, libraryScanAt = '', libraryRequestKey = '', libraryLoading = false;
let pendingTrack = null;
let directSearchTimer = 0, directSearchGeneration = 0;
let directSearchTracks = [];
const assignDialog = $('#playerAssignSingerDialog');
const state = {library: {lastScanAt: 'original-scan'}, requests: []};
const playerPreparationReady = () => true, playerReady = () => true;
const sync = next => { state.requests = next.requests; };
const showNotice = message => { $('#audit').textContent = message; };
window.reads = 0; window.writes = []; window.forbidden = []; window.currentId = 'A';
window.delay = 0; window.fail = false; window.size = 127;
const api = async (url, options) => {
  if (options) window.writes.push({url, body: JSON.parse(options.body)}); else window.reads++;
  const requestDelay = window.delay;
  const response = await fetch(url + (options ? '' : (url.includes('?') ? '&' : '?') + 'size=' + window.size), options);
  const data = await response.json();
  if (requestDelay) await new Promise(resolve => setTimeout(resolve, requestDelay));
  if (window.fail) throw new Error('Error de prueba');
  return data;
};
${playerSource.slice(playerSource.indexOf('function formatDuration('), playerSource.indexOf('\n}', playerSource.indexOf('function formatDuration(')) + 2)}
${['searchLibrary','openLocalLibrary','closeLocalLibrary','closeDirectSearch','renderDirectSearch','runDirectSearch','openSingerAssignment','assignSinger'].map(queueFunction).join('\n')}
${playerSource.slice(start, end)}
$('#playerAssignSingerForm').addEventListener('submit', event => void assignSinger(event));
const close = () => { pendingTrack = null; assignDialog.close(); };
$('#playerAssignSingerCancel').addEventListener('click', close);
$('#playerAssignSingerClose').addEventListener('click', close);
$('#start').addEventListener('click', async () => {
  const audio = $('#playing'); await audio.play();
  window.initialPlayback = {src: audio.currentSrc, time: audio.currentTime};
  for (const name of ['pause','play','load']) audio[name] = () => { window.forbidden.push(name); throw new Error(name); };
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(audio, 'currentTime', {get: () => descriptor.get.call(audio), set: () => { window.forbidden.push('seek'); throw new Error('seek'); }});
});
window.fixture = {searchLibrary, openLocalLibrary, closeLocalLibrary, state};
`;
}
