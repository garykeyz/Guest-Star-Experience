import { basename } from 'node:path';
import { normalizeText } from './matcher.mjs';

// A read-only projection of the existing scan index, not a second library.
// No filesystem access, probing, scanning, or playback commands belong here.
export function queryIndexedLibrary(files, describe, query = '', {
  offset = 0, limit = 60, includeAll = false, sort = 'title', language = ''
} = {}) {
  const needles = normalizeText(query).split(' ').filter(Boolean);
  if (!needles.length && !includeAll) {
    return { tracks: [], total: files.length, offset: 0, hasMore: files.length > 0, deferred: true, languages: [] };
  }
  const rows = files.map(describe);
  const languages = [...new Set(rows.map(row => row.language).filter(Boolean))].sort();
  const matches = rows.filter((row, index) => {
    const text = normalizeText([row.song, row.artist, row.channel, row.provider, row.language, basename(files[index])].join(' '));
    return (!language || (language === 'unknown' ? !row.language : row.language === language)) && needles.every(needle => text.includes(needle));
  });
  const key = { title: 'song', artist: 'artist', language: 'language' }[sort] || 'song';
  matches.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), 'es', { sensitivity: 'base', numeric: true })
    || String(a.song || a.name).localeCompare(String(b.song || b.name), 'es', { sensitivity: 'base', numeric: true })
    || a.id.localeCompare(b.id));
  const tracks = matches.slice(offset, offset + limit);
  return { tracks, total: matches.length, offset, hasMore: offset + tracks.length < matches.length, deferred: false, languages };
}
