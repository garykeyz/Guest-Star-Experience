import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNNY_MESSAGES, GUEST_LANGUAGE_CODES, GUEST_UI_COPY, PLAN_B_COPY, STAR_SCREEN_COPY, deterministicFunnyMessage } from '../public/shared/guest-locales.js';
import { PLAN_B_COUNTS, PLAN_B_SONGS, rememberSuggested, selectPlanBSongs } from '../public/shared/plan-b.js';
import { ROTATION_CATALOGS, isKnownRotationSong } from '../src/random-rotation.mjs';

test('all guest-facing shared catalogs cover the same eight stable language IDs', () => {
  assert.deepEqual(GUEST_LANGUAGE_CODES,["es","en","fr","it","de","ru","pt","hi"]);
  for(const code of GUEST_LANGUAGE_CODES){
    assert.ok(GUEST_UI_COPY[code]);
    assert.ok(PLAN_B_COPY[code]);
    assert.ok(STAR_SCREEN_COPY[code]);
    for(const context of ['waitingSinger','preparingSong','nextSinger','requestIdle','kioskIdle','countdown','activityStarting','betweenSongs','planB']){
      assert.ok(FUNNY_MESSAGES[code][context].length>0,`${code}.${context}`);
    }
    assert.ok(PLAN_B_COUNTS[code]>=10,`${code} Plan B count`);
  }
  assert.equal(PLAN_B_SONGS.length,100);
});

test('Plan B is local, filter-ready and avoids immediate repeats when fresh songs exist', () => {
  const first=selectPlanBSongs({language:'hi',limit:6,random:()=>0.42});
  const recent=rememberSuggested([],first);
  const second=selectPlanBSongs({language:'hi',recentIds:recent,limit:4,random:()=>0.42});
  assert.equal(first.length,6);
  assert.equal(second.length,4);
  assert.equal(second.some(item=>recent.includes(item.id)),false);
  const exhausted=rememberSuggested(recent,second);
  const third=selectPlanBSongs({language:'hi',recentIds:exhausted,limit:4,random:()=>0.42});
  assert.equal(third.some(item=>second.map(song=>song.id).includes(item.id)),false);
  assert.ok(selectPlanBSongs({language:'en',filters:{energy:'high',difficulty:'medium'},limit:3}).every(item=>item.energy==='high'&&item.difficulty==='medium'));
});

test('Host Plan B derives its existing rotations from the same logical song metadata catalog', () => {
  assert.equal(ROTATION_CATALOGS.spanish.length,PLAN_B_COUNTS.es);
  assert.equal(ROTATION_CATALOGS.english.length,PLAN_B_COUNTS.en);
  const hindi=PLAN_B_SONGS.find(item=>item.language==='hi');
  assert.ok(hindi);
  assert.equal(isKnownRotationSong({song:hindi.title,artist:hindi.artist,language:'हिन्दी'}),true);
});

test('the selected funny message is deterministic for Preview and Star Screen payload parity', () => {
  const first=deterministicFunnyMessage('hi','nextSinger','activity|request');
  const preview=deterministicFunnyMessage('hi','nextSinger','activity|request');
  assert.equal(preview,first);
  assert.ok(FUNNY_MESSAGES.hi.nextSinger.includes(first));
});
