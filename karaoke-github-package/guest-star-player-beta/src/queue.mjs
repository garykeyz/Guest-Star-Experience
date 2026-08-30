export const TRACK_STATUS = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
});

export function createTrack({ name, file, singer = '', source = 'local' }) {
  if (!name || !file) throw new Error('Una pista local necesita nombre y archivo.');
  return {
    id: crypto.randomUUID(),
    name,
    singer: singer.trim(),
    source,
    status: TRACK_STATUS.READY,
    addedAt: new Date().toISOString(),
    file,
  };
}

export function transitionTrack(queue, trackId, status) {
  if (!Object.values(TRACK_STATUS).includes(status)) throw new Error('Estado inválido.');
  return queue.map((track) => track.id === trackId ? { ...track, status } : track);
}

export function nextReadyTrack(queue) {
  return queue.find((track) => track.status === TRACK_STATUS.READY) ?? null;
}

export function removeTrack(queue, trackId) {
  return queue.filter((track) => track.id !== trackId);
}
