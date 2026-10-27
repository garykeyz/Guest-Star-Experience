import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return server.address().port; }

test('HTTP aislado: dos controles, sesión, permisos, entrega, reinicio y desconexión', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'guest-star-controls-http-'));
  let role = 'tester'; let expired = false; let delivered = []; let refuseDelivery = false;
  const remote = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    if (expired) { res.writeHead(401); res.end(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', error: 'SESSION_EXPIRED_TEST' })); return; }
    let result = { ok: true };
    if (data.action === 'me') result = { ok: true, user: { role, userId: 'test-user' }, selection: { hotels: [], venues: [], activities: [] } };
    if (data.action === 'submitDiagnosticReport') {
      if (refuseDelivery) result = { ok: false, error: 'DELIVERY_DENIED_TEST' };
      else { delivered.push(data.report); result = { ok: true, reportId: data.report.reportId }; }
    }
    res.end(JSON.stringify(result));
  });
  const remotePort = await listen(remote);
  const reservation = createServer(); const port = await listen(reservation); await new Promise(r => reservation.close(r));
  await cp(resolve('src'), join(root, 'src'), { recursive: true });
  await cp(resolve('public'), join(root, 'public'), { recursive: true });
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'data/config.json'), JSON.stringify({ configVersion: 14, bridgePort: port, authToken: 'test-auth', deviceToken: 'test-device', deviceId: 'test-id', rememberLogin: true, secretsInKeychain: false, appsScriptUrl: `http://127.0.0.1:${remotePort}`, autoQueueExact: false, libraryFolders: [], diagnostics: { autoSendTechnicalErrors: false, testerMode: false } }));
  let child; let stderr = '';
  async function start() {
    child = spawn(process.execPath, ['src/server.mjs'], { cwd: root, env: { ...process.env, GUEST_STAR_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => { stderr += data; });
    for (let i = 0; i < 100; i++) {
      try { const value = await call('/api/state'); if (value.data.account?.authenticated) return; } catch {}
      if (child.exitCode !== null) throw new Error(stderr);
      await delay(50);
    }
    throw new Error(`Server did not start: ${stderr}`);
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; } }
  t.after(async () => { await stop(); remote.closeAllConnections(); await new Promise(r => remote.close(r)); await rm(root, { recursive: true, force: true }); });
  async function call(path, body, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const prefs = patch => call('/api/diagnostics/preferences', patch);
  await start();
  for (const key of ['autoSendTechnicalErrors', 'testerMode']) {
    assert.equal((await prefs({ [key]: true })).data.preferences[key], true);
    await delay(2200);
    assert.equal((await prefs()).data.preferences[key], true);
    assert.equal((await prefs({ [key]: false })).data.preferences[key], false);
  }
  await prefs({ testerMode: true });
  assert.equal((await call('/api/diagnostics/mark', {})).status, 200);
  assert.equal((await call('/api/diagnostics/export')).status, 200);
  assert.notEqual((await call('/api/superhost/state')).status, 200);
  await prefs({ autoSendTechnicalErrors: true });
  await call('/api/diagnostics/events', { autoSend: true, events: [{ severity: 'ERROR', module: 'Preferences', event: 'CONTROL_AUDIT_TEST', message: 'Isolated test only' }] });
  for (let i = 0; i < 60 && !delivered.some((report) => report.automatic === true); i++) await delay(50);
  // The test explicitly enabled this option twice: one probe per accepted activation.
  assert.equal(delivered.filter((report) => report.deliveryProbe === true).length, 2);
  assert.equal(delivered.filter((report) => report.automatic === true).length, 1);
  assert.equal((await call('/api/diagnostics/state')).data.recentErrors[0].severity, 'ERROR');
  await stop(); await start();
  assert.equal((await prefs()).data.preferences.testerMode, true);
  assert.equal((await prefs()).data.preferences.autoSendTechnicalErrors, true);
  expired = true;
  assert.equal((await call('/api/diagnostics/mark', {})).status, 401);
  assert.equal((await prefs()).data.preferences.testerMode, false);
  assert.match((await prefs()).data.preferences.error, /SESSION_EXPIRED_TEST/);
  await prefs({ testerMode: false });
  const denied = await prefs({ testerMode: true });
  assert.equal(denied.status, 401); assert.match(denied.data.error, /SESSION_EXPIRED_TEST/);
  assert.equal(denied.data.preferences.testerMode, false);
  expired = false;
  for (role of ['host', 'guest']) {
    assert.equal((await prefs({ testerMode: true })).status, 403);
    assert.equal((await call('/api/diagnostics/mark', {})).status, 403);
  }
  for (role of ['tester', 'developer', 'superhost']) {
    assert.equal((await prefs({ testerMode: true })).status, 200);
    assert.equal((await call('/api/diagnostics/mark', {})).status, 200);
    assert.equal((await prefs({ testerMode: false })).status, 200);
  }
  // A delivery-capability rejection keeps the option off with its exact reason.
  await prefs({ autoSendTechnicalErrors: false });
  refuseDelivery = true;
  const capabilityRejected = await prefs({ autoSendTechnicalErrors: true });
  assert.equal(capabilityRejected.status, 502);
  assert.match(capabilityRejected.data.error, /DELIVERY_DENIED_TEST/);
  assert.equal(capabilityRejected.data.preferences.autoSendTechnicalErrors, false);
  // A report delivery rejection remains queued with its exact reason.
  const report = await call('/api/diagnostics/report', { action: 'send', description: 'Delivery failure test', attachExisting: false });
  assert.equal(report.data.report.deliveryStatus, 'queued');
  assert.match(report.data.report.deliveryError, /DELIVERY_DENIED_TEST/);
  remote.closeAllConnections(); await new Promise(r => remote.close(r));
  const offline = await prefs({ autoSendTechnicalErrors: true });
  assert.equal(offline.status, 503); assert.equal(offline.data.code, 'NETWORK_ERROR');
  assert.equal(offline.data.preferences.autoSendTechnicalErrors, false);
  assert.equal((await prefs({ testerMode: false })).status, 200);
  assert.doesNotMatch(stderr, /TypeError|ReferenceError|SyntaxError|unhandled/i);
});
