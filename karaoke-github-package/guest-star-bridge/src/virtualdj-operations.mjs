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
    decks.push({ deck, loaded, playing, audible, filePath,
      played: filePath ? vdjBoolean(values[5]) : null,
      cue: Number.isInteger(cue) && cue > 0 && cue <= 999 ? cue : null });
  }
  return { connected: true, selectedDeck, masterVolume, decks, error: '' };
}

// Playback is ephemeral/local. No cloud heartbeat, D1 write, media engine,
// reconnect command replay or mutation is performed by reading a snapshot.
export function createVirtualDjOperations({ getConfig, enabled, changed = () => {}, identify = () => null,
  played = async () => {}, query = queryVdj, execute = executeVdj, now = Date.now }) {
  let state = { connected: false, selectedDeck: 1, masterVolume: null, decks: [], error: '', sequence: 0 };
  let readPromise = null;
  let commandBusy = false;
  let lastCommandAt = -Infinity;
  const completedCommands = new Map();
  const observations = new Map();
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
                sawNotPlayed: false, sawAudible: false, blocked: false, consumed: false };
          if (deck.played === false) observation.sawNotPlayed = true;
          if (deck.playing && deck.audible && identity) observation.sawAudible = true;
          observations.set(deck.deck, observation);
          // Explicit Played edge only. A pre-existing Played flag, preview,
          // load, cue, seek, disappearance or time threshold is not completion.
          if (same && identity && deck.played === true && observation.sawNotPlayed &&
              observation.sawAudible && !observation.blocked && !observation.consumed && readEpoch === epoch) {
            observation.consumed = true;
            try {
              await played({ requestId: identity.id, version: identity.version, deck: deck.deck, filePath: deck.filePath });
            } catch (error) {
              state = { ...state, automaticCompletionError: error.message };
            }
          }
        }
        const strip = value => JSON.stringify({ ...value, sequence: 0, observedAt: '' });
        if (strip(previous) !== strip(state)) changed();
      } catch (error) {
        observations.clear(); // reconnect must establish a new false baseline
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
  return { view: () => state, refresh, command, invalidate };
}
