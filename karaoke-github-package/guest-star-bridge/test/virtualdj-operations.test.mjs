import assert from 'node:assert/strict';
import test from 'node:test';
import { createVirtualDjOperations, readVdjPlayback, vdjBoolean, vdjVolume } from '../src/virtualdj-operations.mjs';

function fixture() {
  const row = { path: '/music/song.mp4', loaded: 'on', play: 'off', audible: 'off', cue: '0', played: 'no', position:0, duration:120 };
  const commands = []; const completions = [];
  let time = 1000, active = true, connected = true, version = 1, identified = true;
  const query = async (_config, script) => {
    if (!connected) throw new Error('offline');
    if (script.includes('`get_decks`')) return '1|1|0.75';
    if (script.includes('get_songlength')) return `${row.position}|${row.duration}|Test|Artist|${row.path}`;
    if (script.includes('get_text')) return [row.path, row.loaded, row.play, row.audible, row.cue, row.played, row.path].join('|');
    if (script.includes('has_cue')) return row.cue === '0' ? 'no' : 'yes';
    if (script.includes('get_filepath')) return row.path;
    throw new Error(`Unexpected query: ${script}`);
  };
  const ops = createVirtualDjOperations({ getConfig: () => ({}), enabled: () => active, query,
    now: () => time, identify: () => identified ? { id: 'request-1', version } : null,
    played: async event => { completions.push(event); }, execute: async (_config, script) => { commands.push(script); } });
  return { row, ops, commands, completions, query,
    advance: () => { time += 1000; }, disconnect: () => { connected = false; }, reconnect: () => { connected = true; },
    disable: () => { active = false; }, version: value => { version = value; }, identify: value => { identified = value; } };
}

test('parses real Network Control booleans and volume without assuming unknown is false', () => {
  for (const value of ['yes', 'on', 'true', '1']) assert.equal(vdjBoolean(value), true);
  for (const value of ['no', 'off', 'false', '0']) assert.equal(vdjBoolean(value), false);
  assert.equal(vdjBoolean('error:-2147024891'), null);
  assert.equal(vdjVolume('0.75'), .75); assert.equal(vdjVolume('75%'), .75);
  assert.equal(vdjVolume('2'), null); assert.equal(vdjVolume('false'), null);
});
test('reads only supported explicit deck state and volume', async () => {
  const f = fixture(); const queries = [];
  const snapshot = await readVdjPlayback({}, async (config, script) => {
    queries.push(script);
    return f.query(config, script);
  });
  assert.equal(snapshot.masterVolume, .75); assert.equal(snapshot.decks[0].filePath, f.row.path);
  assert.equal(snapshot.decks[0].played, false); assert.equal(snapshot.decks[0].playing, false);
  assert.match(queries[1], /get_loaded_song 'Already Played' & param_equal 1/);
});
test('unknown Played is not a completion signal', async () => {
  const f = fixture(); f.row.played = 'error:-1'; f.row.play = f.row.audible = 'on';
  await f.ops.refresh(); f.row.played = 'yes'; await f.ops.refresh(); assert.equal(f.completions.length, 0);
});
test('Played flag during early playback is not completion; natural end completes once', async () => {
  const f=fixture();await f.ops.refresh();f.row.play=f.row.audible='on';await f.ops.refresh();
  f.row.played='yes';await f.ops.refresh();assert.equal(f.completions.length,0);
  for(let i=1;i<=120;i++){f.advance();f.row.position=i/120;await f.ops.refresh();}
  f.row.play=f.row.audible='off';await f.ops.refresh();await new Promise(r=>setTimeout(r,5));
  await f.ops.refresh();assert.equal(f.completions.length,1);
});
test('load, cue, preview and silent playback cannot complete a request', async () => {
  const f = fixture(); await f.ops.refresh(); f.row.cue = '3'; f.row.play = 'on'; await f.ops.refresh();
  f.row.played = 'yes'; await f.ops.refresh(); assert.equal(f.completions.length, 0);
});
test('a pre-existing Played flag never completes a newly loaded request', async () => {
  const f = fixture(); f.row.played = 'yes'; f.row.play = f.row.audible = 'on';
  await f.ops.refresh(); await f.ops.refresh(); assert.equal(f.completions.length, 0);
});
test('manual Skip, Completed, removal and Return invalidate delayed Played for the load', async () => {
  for (const action of ['skipped', 'completed', 'removed', 'return']) {
    const f = fixture(); f.row.play = f.row.audible = 'on'; await f.ops.refresh();
    f.ops.invalidate('request-1'); f.row.played = 'yes'; await f.ops.refresh();
    assert.equal(f.completions.length, 0, action);
  }
});
test('natural-end completion uses the newest metadata CAS revision',async()=>{
  const f=fixture();f.row.play=f.row.audible='on';await f.ops.refresh();
  for(let i=1;i<=120;i++){f.advance();f.row.position=i/120;await f.ops.refresh();}
  f.version(2);f.row.play=f.row.audible='off';await f.ops.refresh();await new Promise(r=>setTimeout(r,5));
  assert.equal(f.completions.length,1);assert.equal(f.completions[0].version,2);
});
test('ambiguous/unlinked sources never complete requests', async () => {
  const f = fixture(); f.identify(false); f.row.play = f.row.audible = 'on'; await f.ops.refresh();
  f.row.played = 'yes'; await f.ops.refresh(); assert.equal(f.completions.length, 0);
});
test('reconnect reads state but does not replay commands or trust old Played', async () => {
  const f = fixture(); f.row.play = f.row.audible = 'on'; await f.ops.refresh();
  f.disconnect(); await f.ops.refresh(); assert.equal(f.ops.view().connected, false);
  f.reconnect(); f.row.played = 'yes'; await f.ops.refresh();
  assert.equal(f.completions.length, 0); assert.equal(f.commands.length, 0);
});
test('Play/Pause uses explicit verbs and reads real state rather than toggling a visual simulation', async () => {
  const f = fixture();
  await f.ops.command({ action: 'play', deck: 1, filePath: f.row.path, commandId: 'play-command-1' }); f.advance();
  await f.ops.command({ action: 'pause', deck: 1, filePath: f.row.path, commandId: 'pause-command-1' });
  assert.deepEqual(f.commands, ['deck 1 play', 'deck 1 pause']);
});
test('Restart uses the active confirmed Cue, never arbitrarily Hot Cue 1', async () => {
  const f = fixture(); f.row.cue = '7';
  await f.ops.command({ action: 'restart', deck: 1, filePath: f.row.path, commandId: 'restart-command-1' });
  assert.deepEqual(f.commands, ['deck 1 goto_cue 7']);
});
test('Restart without a reliable Cue falls back to real start', async () => {
  const f = fixture();
  await f.ops.command({ action: 'restart', deck: 1, filePath: f.row.path, commandId: 'restart-command-1' });
  assert.deepEqual(f.commands, ['deck 1 goto_start']);
});
test('Master modifies VDJ master_volume, not the Guest Star player', async () => {
  const f = fixture(); await f.ops.command({ action: 'volume', volume: .42, commandId: 'volume-command-1' });
  assert.deepEqual(f.commands, ['master_volume 42.0%']);
  await assert.rejects(f.ops.command({ action: 'volume', volume: 5, commandId: 'volume-command-2' }));
});
test('same command ID is idempotent; conflicting payload is rejected', async () => {
  const f = fixture(); const body = { action: 'play', deck: 1, filePath: f.row.path, commandId: 'play-command-1' };
  await Promise.all([f.ops.command(body), f.ops.command(body)]);
  assert.equal(f.commands.length, 1);
  await assert.rejects(f.ops.command({ ...body, action: 'pause' }));
});
test('stale deck/song and Player mode cannot execute playback commands', async () => {
  const f = fixture(); await assert.rejects(f.ops.command({ action: 'play', deck: 1, filePath: '/other.mp4', commandId: 'play-command-1' }));
  f.disable(); await assert.rejects(f.ops.command({ action: 'volume', volume: .5, commandId: 'volume-command-1' }));
  assert.equal(f.commands.length, 0);
});
test('delimiter ambiguity fails closed instead of guessing song identity', async () => {
  const f = fixture(); f.row.path = '/music/a|b.mp4'; await f.ops.refresh();
  assert.equal(f.ops.view().connected, false); assert.equal(f.completions.length, 0);
});

test('cached/internal queue rows cannot authorize an automatic deck load',async()=>{const f=fixture();await assert.rejects(f.ops.prepareHead({virtualDJItemId:'head',filePath:'/music/next.mp4'}),/Host command/);assert.equal(f.commands.length,0);});
test('removal requires physical presence observed in this connection, and never completes an unplayed row',async()=>{
  const f=fixture();await f.ops.refresh();f.ops.noteQueue(['request-1']);assert.equal(f.ops.removalOutcome('request-1'),'skipped');
  f.disconnect();await f.ops.refresh();assert.equal(f.ops.removalOutcome('request-1'),'');
  f.reconnect();await f.ops.refresh();assert.equal(f.ops.removalOutcome('request-1'),'');
});
