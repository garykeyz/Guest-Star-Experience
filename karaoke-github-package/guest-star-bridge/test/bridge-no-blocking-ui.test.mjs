import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const operations = await readFile(new URL('../public/bridge-operations.js', import.meta.url), 'utf8');

test('routine Bridge operations contain no blocking browser popup', () => {
  assert.doesNotMatch(app, /window\.(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(operations, /(?:window\.)?(?:alert|confirm|prompt)\s*\(/);

  const queueOperations = app.slice(
    app.indexOf('async function queue(id, filePath)'),
    app.indexOf('async function queueSuggestion(item, singerMode)')
  );
  assert.doesNotMatch(queueOperations.replace(/function chooseMissingOutcome\(\) \{[\s\S]*?\n\}\n/, ''), /confirmAction\s*\(|\.showModal\s*\(/);
  assert.match(queueOperations, /action:\s*\{\s*label:\s*"Deshacer"/);
  assert.match(queueOperations, /runAction\s*\(/);
  const runAction = app.slice(app.indexOf('async function runAction('), app.indexOf('function timeAgo('));
  assert.match(runAction, /showNotice\(/);
});
