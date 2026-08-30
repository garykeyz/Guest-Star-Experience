import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, nextReadyTrack, TRACK_STATUS, transitionTrack } from '../src/queue.mjs';

test('una pista completada nunca vuelve a la cola lista por una actualización', () => {
  const track = createTrack({ name: 'Mi canción', file: new Blob(['x']) });
  const completed = transitionTrack([track], track.id, TRACK_STATUS.COMPLETED);
  assert.equal(nextReadyTrack(completed), null);
  assert.equal(completed[0].status, TRACK_STATUS.COMPLETED);
});

test('la siguiente pista conserva el orden de entrada', () => {
  const first = createTrack({ name: 'Primera', file: new Blob(['1']) });
  const second = createTrack({ name: 'Segunda', file: new Blob(['2']) });
  assert.equal(nextReadyTrack([first, second]).id, first.id);
});
