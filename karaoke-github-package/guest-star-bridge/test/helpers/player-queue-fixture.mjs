import { readFileSync } from 'node:fs';
export const playerSource = readFileSync(new URL('../../public/player-beta.js', import.meta.url), 'utf8');
export function queueFunction(name) {
  const marker = `function ${name}(`;
  const start = playerSource.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name}`);
  const end = playerSource.indexOf('\n  }', start);
  return (playerSource.slice(start - 6, start) === 'async ' ? 'async ' : '') + playerSource.slice(start, end + 4);
}
export function queueFixtureModule() {
  return `
import { attachPlayerQueueUI, reorderPlayerQueue, queueStemLabel } from '/player-queue-ui.js';
import { movePlayerQueueOrder, playerQueueOrderSignature } from '/player-beta.js';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const activeRequest = item => !item.outcome;
const guest = item => item.singer;
const clockTime = value => value.toLocaleTimeString();
const formatDuration = value => String(value);
const state = { activity: { transitionSeconds: 15 }, stemEngine: { available: true }, requests: ['Perry','John','Maria','Alex','Ana'].map((singer,i) => ({ id: String(i+1), singer, song: 'Canción '+(i+1), artist: 'Artista', localAvailable: true, metadata: { preserve: i }, comment: 'Dedicatoria '.repeat(40), youtube: [{ title:'Karaoke', url:'https://example.com', channel:'Test' }], stem: i===3 ? {status:'processing',progress:10,phase:'Separando'} : i===1 ? {ready:true,status:'ready'} : null })) };
let currentId = '2', order = ['1','2','3','4','5'], queueVisibility = {}, pendingOrderSignature = '', pendingVisibilitySignature = '';
let queueOrderSaveTimer = 0, queueOrderSaveInFlight = false, queueOrderSavePending = false;
const expandedRequestIds = new Set(), openYoutubeIds = new Set();
const requestsById = () => new Map(state.requests.map(item => [item.id,item]));
const activePlaybackLocked = () => true;
const playerPreparationReady = () => true;
const visibleOnStarScreen = item => queueVisibility[item.id] !== false;
const storageKey = () => 'test-queue', visibilityStorageKey = () => 'test-visibility';
const media = $('#playing'), instrumentalAudio = media, vocalsAudio = media;
const forbidden = name => { window.forbiddenCalls.push(name); throw new Error('Forbidden: '+name); };
const loadRequest = () => forbidden('loadRequest'), setScene = () => forbidden('setScene'), scheduleRuntimeSave = () => forbidden('playback save');
const diagnostics = null;
const publish = () => { window.publishedOrder = [...order]; };
const api = async (url, options) => { window.savedPayloads.push(JSON.parse(options.body)); await new Promise(resolve => setTimeout(resolve,30)); return {ok:true}; };
window.forbiddenCalls = []; window.savedPayloads = [];
${['visibilitySignature','saveOrder','scheduleQueueOrderSave','persistQueueOrder','queue','stemAction','youtubeDropdown','renderQueue','moveQueueItem','reorderQueueItem','handleQueueClick'].map(queueFunction).join('\n')}
const queueUI = attachPlayerQueueUI($('#playerQueue'), { reorder: reorderQueueItem, move: moveQueueItem, closeOptions: () => { expandedRequestIds.clear(); renderQueue(); } });
$('#playerQueue').addEventListener('click',handleQueueClick);
queueUI.options.addEventListener('click',handleQueueClick);
queueUI.options.addEventListener('toggle',event => { const details=event.target.closest?.('[data-player-youtube-details]'); if(details) details.open ? openYoutubeIds.add(details.dataset.playerYoutubeDetails) : openYoutubeIds.delete(details.dataset.playerYoutubeDetails); }, true);
window.fixture = { renderQueue, state, getOrder: () => [...order], getCurrentId: () => currentId, getItems: () => queue(), reorderQueueItem, persistQueueOrder };
renderQueue();
`;
}
