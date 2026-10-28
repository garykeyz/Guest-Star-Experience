import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { queryIndexedLibrary } from '../src/local-library-view.mjs';

const rows = [
  { id: 'a', song: 'Ángel', artist: 'Zeta', language: 'Spanish', channel: 'Canal limpio', durationSeconds: 187 },
  { id: 'b', song: 'Brisa', artist: 'Ana', language: 'English' },
  { id: 'c', song: 'Cielo', artist: 'Luis' }
];
const files = ['/karaoke/raw_001.mp4', '/karaoke/raw_002.mp4', '/karaoke/raw_003.mp4'];
const describe = file => rows[files.indexOf(file)];
test('biblioteca vacía y un archivo, sin acceder al disco', () => {
  assert.deepEqual(queryIndexedLibrary([], describe, '', { includeAll: true }).tracks, []);
  const one = queryIndexedLibrary(files.slice(0, 1), describe, '', { includeAll: true });
  assert.equal(one.tracks[0].song, 'Ángel'); assert.equal(one.hasMore, false);
});
test('metadata limpia, archivo, canal, acentos y tokens comparten búsqueda', () => {
  for (const query of ['angel zeta', 'canal limpio', 'raw 001']) {
    const result = queryIndexedLibrary(files, describe, query);
    assert.deepEqual(result.tracks, [rows[0]]);
    assert.equal(result.tracks[0].durationSeconds, 187);
  }
});
test('orden por título, artista e idioma; filtros conocidos/desconocidos', () => {
  const all = options => queryIndexedLibrary(files, describe, '', { includeAll: true, ...options });
  assert.deepEqual(all({}).tracks.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(all({ sort: 'artist' }).tracks.map(x => x.id), ['b', 'c', 'a']);
  assert.deepEqual(all({ sort: 'language' }).tracks.map(x => x.id), ['c', 'b', 'a']);
  assert.deepEqual(all({ language: 'Spanish' }).tracks, [rows[0]]);
  assert.deepEqual(all({ language: 'unknown' }).tracks, [rows[2]]);
  assert.deepEqual(all({ language: 'French' }).tracks, []);
  assert.deepEqual(all({ language: 'Spanish' }).languages, ['English', 'Spanish']);
});
test('muchos archivos: paginación estable, sin mutar índice ni objetos', () => {
  const paths = Array.from({ length: 10003 }, (_, i) => `/indexed/${i}.mp4`);
  const original = [...paths];
  const metadata = Object.freeze({ artist: 'Artista' });
  const project = path => ({ ...metadata, id: path, song: 'Título ' + path.split('/').pop() });
  const ids = [];
  for (let offset = 0; offset < paths.length; offset += 100) {
    const page = queryIndexedLibrary(paths, project, '', { includeAll: true, offset, limit: 100 });
    assert.equal(page.total, 10003); ids.push(...page.tracks.map(x => x.id));
    assert.equal(page.hasMore, offset + page.tracks.length < paths.length);
  }
  assert.equal(new Set(ids).size, paths.length); assert.deepEqual(paths, original);
});
test('abrir/cerrar/buscar no contiene transporte ni escaneo; asignación existente es solo fila', () => {
  const source = readFileSync(new URL('../public/player-beta.js', import.meta.url), 'utf8');
  const library = source.slice(source.indexOf('  async function searchLibrary('), source.indexOf('  function closeDirectSearch('));
  assert.doesNotMatch(library, /loadRequest|setScene|currentId\s*=|scheduleRuntimeSave|audioCommand|\/scan|\.pause\(|\.play\(/);
  const assignment = source.slice(source.indexOf('  async function assignSinger('), source.indexOf('  function recordAudio('));
  assert.match(assignment, /\/api\/player\/local-requests/);
  assert.doesNotMatch(assignment, /loadRequest|setScene|currentId\s*=|\.pause\(|\.play\(/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="playerLibraryBrowse"/);
  assert.doesNotMatch(html, /data-player-drawer-panel="library"/);
});
