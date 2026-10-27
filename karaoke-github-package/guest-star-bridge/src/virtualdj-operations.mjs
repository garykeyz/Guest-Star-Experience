import {assertVdjHostIntent,realVdjQueueHeadIntent} from './virtualdj-host-intent.mjs';
import { executeVdj, isVirtualDjTechnicalError, normalizeVdjPath, queryVdj } from './virtualdj.mjs';

export function vdjBoolean(value) {
  const text = String(value ?? '').trim().replace(/^"|"$/g, '').toLowerCase();
  if (['on', 'yes', 'true', '1'].includes(text)) return true;
  if (['off', 'no', 'false', '0'].includes(text)) return false;
  return null;
}

export function vdjVolume(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(text)) return null;
  const number = Number.parseFloat(text) / (text.endsWith('%') ? 100 : 1);
  return number >= 0 && number <= 1 ? number : null;
}

function textQuery(parts) {
  return 'get_text "' + parts.map(part => '`' + part + '`').join('|') + '"';
}

function splitValues(value, count) {
  const values = String(value).split('|');
  if (values.length !== count) throw new Error('VDJ returned an unreadable playback snapshot.');
  return values;
}

export async function readVdjMeter(config, query = queryVdj) {
  const values = splitValues(await query(config, textQuery(['get_vu_meter_left', 'get_vu_meter_right', 'get_vu_meter_left_peak', 'get_vu_meter_right_peak'])), 4).map(vdjVolume);
  if (values.some(v => v === null)) throw new Error('Stereo master readings unavailable.');
  return { rmsL: values[0], rmsR: values[1], peakL: values[2], peakR: values[3], source: 'virtualdj-post-master' };
}

export async function readVdjQueueSignature(config,count,query=queryVdj) {
  const parts=['file_count karaoke'];
  for(let index=0;index<Math.min(256,Math.max(0,count));index++) parts.push(`get_next_karaoke_song 'fullpath' ${index}`,`get_next_karaoke_song 'singer' ${index}`);
  const value=await query(config,textQuery(parts));
  if(isVirtualDjTechnicalError(value)) throw new Error('Queue signature unavailable.');
  return value;
}

export function completedPlayback(observation) {
  return Boolean(observation?.sawAudible && observation?.playedSeconds >= Math.min(10, observation.durationSeconds * .5) &&
    observation.durationSeconds > 0 && (1-observation.lastPosition)*observation.durationSeconds <= Math.max(2,observation.durationSeconds*.02));
}

export async function readVdjPlayback(config, query = queryVdj) {
  const header = splitValues(await query(config, textQuery(['get_decks', 'get_defaultdeck', 'master_volume'])), 3);
  const count = Number(header[0]);
  const selectedDeck = Number(header[1]);
  const masterVolume = vdjVolume(header[2]);
  if (!Number.isInteger(count) || count < 1 || count > 8 ||
      !Number.isInteger(selectedDeck) || selectedDeck < 1 || selectedDeck > count || masterVolume === null) {
    throw new Error('VDJ did not confirm its decks and master volume.');
  }
  const decks = [];
  for (let deck = 1; deck <= count; deck++) {
    const prefix = `deck ${deck} `;
    // Repeat filepath around state fields: a load during the query must not
    // associate one song's Played flag with another song. Delimiter ambiguity
    // fails closed, never completes a request.
    const values = splitValues(await query(config, textQuery([
      prefix + 'get_filepath', prefix + 'loaded', prefix + 'play', prefix + 'is_audible',
      prefix + 'get_cue',
      // The raw property is empty while false in real VirtualDJ Network
      // Control. param_equal coerces it to an explicit off/on value so a
      // trustworthy false -> true edge can be established.
      prefix + 'get_loaded_song \'Already Played\' & param_equal 1',
      prefix + 'get_filepath'
    ])), 7);
    const loaded = vdjBoolean(values[1]);
    const playing = vdjBoolean(values[2]);
    const audible = vdjBoolean(values[3]);
    if (loaded === null || playing === null || audible === null) throw new Error('VDJ did not confirm playback state.');
    const filePath = loaded && values[0] === values[6] && !isVirtualDjTechnicalError(values[0]) ? values[0].trim() : '';
    const cue = Number(values[4]);
    let telemetry = {};
    try {
      const v = splitValues(await query(config, textQuery([prefix + 'get_position', prefix + 'get_songlength', prefix + 'get_title', prefix + 'get_artist', prefix + 'get_filepath'])), 5);
      if (normalizeVdjPath(v[4]) === normalizeVdjPath(filePath)) {
        const position = vdjVolume(v[0]), durationSeconds = Number(v[1]);
        telemetry = { position, durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0, title: v[2], artist: v[3] };
        telemetry.currentTimeSeconds = (position || 0) * telemetry.durationSeconds;
      }
    } catch { /* Optional telemetry must not invalidate a valid deck snapshot. */ }
    decks.push({ ...telemetry, deck, loaded, playing, audible, filePath,
      played: filePath ? vdjBoolean(values[5]) : null,
      cue: Number.isInteger(cue) && cue > 0 && cue <= 999 ? cue : null });
  }
  return { connected: true, selectedDeck, masterVolume, decks, error: '' };
}

// Playback is ephemeral/local. No cloud heartbeat, D1 write, media engine,
// reconnect command replay or mutation is performed by reading a snapshot.
export function createVirtualDjOperations({ getConfig, enabled, changed = () => {}, identify = () => null,
  headLoaded = () => {}, played = async () => {}, terminal = async () => {}, query = queryVdj, execute = executeVdj, now = Date.now }) {
  let state = { connected: false, selectedDeck: 1, masterVolume: null, decks: [], error: '', sequence: 0 };
  let readPromise = null;
  let commandBusy = false;
  let lastCommandAt = -Infinity;
  const completedCommands = new Map();
  const observations = new Map();
  const observedQueued = new Set();
  let epoch = 0;

  function invalidate(requestId) {
    epoch++;
    for (const observation of observations.values()) {
      if (observation.requestId === requestId) observation.blocked = true;
    }
  }

  async function refresh() {
    if (!enabled()) return state;
    if (readPromise) return readPromise;
    const readEpoch = epoch;
    readPromise = (async () => {
      try {
        const next = await readVdjPlayback(getConfig(), query);
        if (!enabled() || readEpoch !== epoch) return state;
        const previous = state;
        state = { ...next, sequence: previous.sequence + 1, observedAt: new Date(now()).toISOString() };
        for (const deck of next.decks) {
          const identity = deck.filePath ? identify(deck.filePath, deck.deck) : null;
          const key = `${deck.deck}:${normalizeVdjPath(deck.filePath)}`;
          const prior = observations.get(deck.deck);
          // Request revisions also change for harmless metadata/duration
          // reconciliation. Preserve the Played baseline while the stable
          // request + deck + filepath identity is unchanged, but always carry
          // the newest revision into the final remote compare-and-set.
          const same = prior?.key === key && prior.requestId === identity?.id;
          const observation = same
            ? { ...prior, version: identity?.version }
            : { key, requestId: identity?.id || '', version: identity?.version,
                sawNotPlayed: false, sawAudible: false, blocked: false, consumed: false, playedSeconds: 0, lastPosition: 0, durationSeconds: 0, observedAt: now() };
          if (!same && prior?.requestId && !prior.blocked && !prior.consumed && completedPlayback(prior)) {
            prior.consumed = true;
            setTimeout(() => readEpoch === epoch && terminal({requestId:prior.requestId,version:prior.version,outcome:'completed',deck:deck.deck}).catch(error=>{state={...state,automaticCompletionError:error.message};changed();}),0);
          }
          if (deck.played === false) observation.sawNotPlayed = true;
          if (deck.playing && deck.audible && identity) observation.sawAudible = true;
          if (same && deck.playing && deck.audible && Number.isFinite(deck.position) && deck.position >= observation.lastPosition) {
            // Count only observed forward playback, bounded by wall time; a seek cannot manufacture play time.
            observation.playedSeconds += Math.min(Math.max(0, (now() - observation.observedAt) / 1000), Math.max(0, (deck.position - observation.lastPosition) * (deck.durationSeconds || 0)));
          }
          observation.observedAt = now();
          // A natural end can reset the playhead before the next HTTP sample.
          // Preserve the last observed forward position on that stop edge only.
          if (Number.isFinite(deck.position) && !(!deck.playing && prior?.wasPlaying && deck.position < observation.lastPosition)) observation.lastPosition = deck.position;
          observation.wasPlaying=deck.playing;
          observation.durationSeconds = deck.durationSeconds || observation.durationSeconds;
          observations.set(deck.deck, observation);
          // Already Played can be set early by VDJ. Require observed audio and a natural end near the real duration.
          if (same && identity && !deck.playing && completedPlayback(observation) && !observation.blocked && !observation.consumed && readEpoch === epoch) {
            observation.consumed = true;
            setTimeout(() => readEpoch === epoch && played({requestId:identity.id,version:identity.version,deck:deck.deck,filePath:deck.filePath}).catch(error=>{state={...state,automaticCompletionError:error.message};changed();}),0);
          }
        }
        const strip = value => JSON.stringify({...value,decks:value.decks.map(d=>({...d,position:0,currentTimeSeconds:0})),sequence:0,observedAt:''});
        if (strip(previous) !== strip(state)) changed();
      } catch (error) {
        observations.clear(); observedQueued.clear(); // reconnect must establish a new false baseline
        const notifyChange = state.connected || state.error !== error.message;
        state = { ...state, connected: false, error: error.message, sequence: state.sequence + 1 };
        if (notifyChange) changed();
      } finally { readPromise = null; }
      return state;
    })();
    return readPromise;
  }

  async function command(body) {
    if (!enabled()) throw new Error('Select Bridge mode before controlling VirtualDJ.');
    const action = String(body.action || '');
    if (!['play', 'pause', 'restart', 'volume'].includes(action)) throw new Error('Unsupported VDJ control.');
    const commandId = String(body.commandId || '');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(commandId)) throw new Error('A stable command ID is required.');
    const fingerprint = JSON.stringify([action, body.deck, body.filePath, body.volume]);
    const existing = completedCommands.get(commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Command ID was already used for a different operation.');
      return existing.promise;
    }
    if (commandBusy || (action !== 'volume' && now() - lastCommandAt < 300)) throw new Error('A VDJ command is already being processed.');
    if (completedCommands.size >= 256) completedCommands.delete(completedCommands.keys().next().value);
    commandBusy = true;
    lastCommandAt = now();
    const promise = (async () => {
      try {
        await refresh();
        if (!enabled()) throw new Error('Bridge mode changed while processing the command.');
        if (!state.connected) throw new Error('VDJ disconnected. Queue administration remains available.');
        let script;
        if (action === 'volume') {
          const volume = Number(body.volume);
          if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Master volume must be between 0 and 1.');
          script = `master_volume ${(volume * 100).toFixed(1)}%`;
        } else {
          const deck = Number(body.deck);
          const target = state.decks.find(value => value.deck === deck);
          if (!target?.loaded || !target.filePath || normalizeVdjPath(body.filePath) !== normalizeVdjPath(target.filePath)) {
            throw new Error('The target deck/song changed. Review the current VDJ state.');
          }
          if (action === 'restart') {
            const cueSet = target.cue ? vdjBoolean(await query(getConfig(), `deck ${deck} has_cue ${target.cue}`)) : false;
            const pathNow = await query(getConfig(), `deck ${deck} get_filepath`);
            if (normalizeVdjPath(pathNow) !== normalizeVdjPath(target.filePath)) throw new Error('The target song changed before Restart.');
            script = `deck ${deck} ${cueSet === true ? `goto_cue ${target.cue}` : 'goto_start'}`;
          } else script = `deck ${deck} ${action}`;
        }
        if (!enabled()) throw new Error('Bridge mode changed before sending the command.');
        await execute(getConfig(), script); // executeVdj intentionally does not retry
        await refresh();
        return { ok: true, playback: state };
      } finally { commandBusy = false; }
    })();
    completedCommands.set(commandId, { fingerprint, promise });
    // Failed/uncertain commands stay consumed: reconnect must never replay them.
    promise.catch(() => {});
    return promise;
  }
  let autoloadBusy = false;
  async function loadExistingQueueHead({valid=()=>true}={}) {
    if(!enabled() || !valid() || autoloadBusy || commandBusy)return false;
    autoloadBusy=true;
    try {
      const values=splitValues(await query(getConfig(),textQuery([
        "file_count karaoke & param_cast 'integer'", "get_next_karaoke_song 'fullpath' 0", "get_next_karaoke_song 'singer' 0",
        'deck 1 get_filepath','deck 1 play','deck 1 is_audible'
      ])),6);
      const [count,filePath,singer,loadedPath,playing,audible]=values;
      if(!/^\d+$/.test(count) || Number(count)<1 || !filePath || isVirtualDjTechnicalError(filePath) || isVirtualDjTechnicalError(singer) ||
        vdjBoolean(playing)!==false || vdjBoolean(audible)!==false ||
        normalizeVdjPath(filePath)===normalizeVdjPath(loadedPath) || !enabled() || !valid())return false;
      const guarded=realVdjQueueHeadIntent({filePath,singer,valid:()=>enabled()&&valid()});
      await execute(getConfig(),guarded.script,{hostIntent:guarded.intent});
      if(enabled() && valid())headLoaded({filePath,singer});
      return true;
    } finally {autoloadBusy=false;}
  }

  let attemptedHead = '';
  async function prepareHead(entry,hostIntent) {
    assertVdjHostIntent(hostIntent,'load');
    if (!enabled() || autoloadBusy || commandBusy || !entry?.filePath) return false;
    autoloadBusy = true;
    try {
      await refresh();
      const deck = state.decks.find(d => d.deck === 1);
      if (!state.connected || !deck || deck.playing) return false;
      if (normalizeVdjPath(deck.filePath) === normalizeVdjPath(entry.filePath)) { attemptedHead = ''; return false; }
      const key = `${entry.virtualDJItemId}:${entry.filePath}`;
      if (attemptedHead === key) return false; // uncertain writes are never replayed
      if (/["`\r\n\0]/.test(entry.filePath)) return false;
      attemptedHead = key;
      // Recheck inside VDJScript, at execution time, including stop/load races.
      await execute(getConfig(), `deck 1 play ? nothing : deck 1 load "${entry.filePath}"`,{hostIntent});
      await refresh();
      const after=state.decks.find(d=>d.deck===1);
      if(after?.playing) attemptedHead=''; // Guard declined the load; retry only after idle.
      return normalizeVdjPath(after?.filePath) === normalizeVdjPath(entry.filePath);
    } finally { autoloadBusy = false; }
  }
  function removalOutcome(id) {
    if (!state.connected || !observedQueued.has(id)) return '';
    const observation = [...observations.values()].find(o => o.requestId === id);
    if (observation?.consumed || observation?.blocked) return '';
    if (completedPlayback(observation)) return 'completed';
    if (!observation?.sawAudible) return 'skipped';
    // A row can leave Karaoke while it still plays. Wait for the actual deck.
    if (state.decks.some(d => d.playing && identify(d.filePath, d.deck)?.id === id)) return '';
    return 'skipped';
  }
  return { view: () => state, refresh, command, invalidate, prepareHead, loadExistingQueueHead, removalOutcome,
    resetContext() { epoch++; observations.clear(); observedQueued.clear(); attemptedHead=''; }, noteQueue(ids) { if(state.connected) ids.forEach(id=>observedQueued.add(id)); if(observedQueued.size>2000) observedQueued.clear(); } };
}
