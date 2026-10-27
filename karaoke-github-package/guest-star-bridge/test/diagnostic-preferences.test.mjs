import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagnosticPreferences, diagnosticServiceRequest, verifyDiagnosticIdentity } from '../src/diagnostic-preferences.mjs';
import { bindDiagnosticPreferences } from '../public/diagnostic-preferences.js';
import { DiagnosticStore } from '../src/diagnostics.mjs';
const session = { authToken: 'test-only', deviceToken: 'test-device', deviceId: 'test-id', appsScriptUrl: 'http://localhost' };

for (const role of ['host', 'tester', 'developer', 'superhost', 'guest']) {
  test(`validación real del contrato de rol: ${role}`, async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, user: { role } }));
    if (role === 'guest') await assert.rejects(verifyDiagnosticIdentity(session, false, { fetchImpl }), { code: 'FORBIDDEN' });
    else assert.equal((await verifyDiagnosticIdentity(session, false, { fetchImpl })).role, role);
    if (['host', 'guest'].includes(role)) await assert.rejects(verifyDiagnosticIdentity(session, true, { fetchImpl }), { code: 'FORBIDDEN' });
    else assert.equal((await verifyDiagnosticIdentity(session, true, { fetchImpl })).role, role);
  });
}
test('sesión ausente, expirada, HTTP 403, backend inválido, desconexión y timeout conservan causa', async () => {
  await assert.rejects(verifyDiagnosticIdentity({}), { code: 'UNAUTHORIZED' });
  for (const [status, data, code] of [[401, { ok: false, code: 'UNAUTHORIZED', error: 'expired-exact' }, 'UNAUTHORIZED'], [403, { error: 'denied-exact' }, 'HTTP_403'], [200, {}, 'HTTP_200']]) {
    await assert.rejects(verifyDiagnosticIdentity(session, false, { fetchImpl: async () => new Response(JSON.stringify(data), { status }) }), error => error.code === code && (!data.error || error.message === data.error));
  }
  await assert.rejects(verifyDiagnosticIdentity(session, false, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), { code: 'NETWORK_ERROR' });
  await assert.rejects(verifyDiagnosticIdentity(session, false, { fetchImpl: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } }), { code: 'TIMEOUT' });
});

test('una entrega no implementada conserva el código exacto del backend', async () => {
  await assert.rejects(
    diagnosticServiceRequest(session, 'submitDiagnosticReport', {}, {
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: 'D1_ACTION_NOT_IMPLEMENTED' }))
    }),
    (error) => error.code === 'D1_ACTION_NOT_IMPLEMENTED' && /D1_ACTION_NOT_IMPLEMENTED/.test(error.message)
  );
});
test('persistencia, reinicio, fallo sin mutación, desactivación offline y carrera de sesión', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'prefs.json');
  let config = { ...session }; let reject = false; let changeSession = false;
  const verify = async () => {
    if (reject) throw new Error('expired-exact');
    if (changeSession) config = { ...config, authToken: 'other-session' };
  };
  const store = await createDiagnosticPreferences({ path, getConfig: () => config, verify });
  for (const key of ['autoSendTechnicalErrors', 'testerMode']) {
    await store.update({ [key]: true }); assert.equal(store.view()[key], true);
    const reopened = await createDiagnosticPreferences({ path, getConfig: () => config, verify });
    assert.equal(reopened.view()[key], true);
    reject = true;
    await store.update({ [key]: false }); assert.equal(store.view()[key], false);
    await assert.rejects(store.update({ [key]: true }), /expired-exact/);
    assert.equal(store.view()[key], false); reject = false;
  }
  changeSession = true;
  await assert.rejects(store.update({ testerMode: true }), { code: 'SESSION_CHANGED' });
  assert.equal(store.view().testerMode, false);
});
function input() { return { checked: false, disabled: false, setAttribute() {}, addEventListener(type, fn) { this.change = fn; } }; }
test('tick espera confirmación, ignora SSE anterior, muestra fallo persistente y se restaura', async () => {
  const controls = { autoSendTechnicalErrors: input(), testerMode: input() }; const status = {};
  let resolve; let reject; let applied;
  const controller = bindDiagnosticPreferences({ controls, status, apply: value => { applied = value; }, request: () => new Promise((a, b) => { resolve = a; reject = b; }) });
  controller.sync({ autoSendTechnicalErrors: false, testerMode: false, revision: 0 });
  for (const key of Object.keys(controls)) {
    controls[key].checked = true; const pending = controls[key].change();
    assert.equal(controls[key].checked, false); assert.equal(controls[key].disabled, true);
    controller.sync({ testerMode: false, autoSendTechnicalErrors: false, revision: 0 });
    assert.match(status.textContent, /Validando/);
    resolve({ ok: true, preferences: { ...applied, [key]: true, revision: applied.revision + 1 } }); await pending;
    assert.equal(controls[key].checked, true); assert.equal(controls[key].disabled, false);
    controller.sync({ testerMode: false, autoSendTechnicalErrors: false, revision: 0 });
    assert.equal(controls[key].checked, true);
    controls[key].checked = false; const failed = controls[key].change(); reject(Object.assign(new Error('exact failure'), { code: 'FORBIDDEN' })); await failed;
    assert.equal(controls[key].checked, true); assert.match(status.textContent, /exact failure.*FORBIDDEN/);
    controller.sync(applied); assert.match(status.textContent, /exact failure/);
    controls[key].checked = false; const off = controls[key].change(); resolve({ ok: true, preferences: { ...applied, [key]: false, revision: applied.revision + 1 } }); await off;
    assert.equal(controls[key].checked, false);
  }
});
test('un evento compartido conserva severity en recentErrors; ciclos reales siguen saneados', () => {
  const store = new DiagnosticStore({ version: 'test' });
  store.record({ severity: 'ERROR', module: 'Preferences', event: 'TEST_ERROR', message: 'test' });
  const view = store.view();
  assert.equal(view.recentErrors[0].severity, 'ERROR');
  clearTimeout(store.persistTimer);
});

test('normaliza timestamps inválidos y conserva el valor original para diagnóstico', () => {
  const store = new DiagnosticStore({ version: 'test' });
  const event = store.record({ timestamp: 'not-a-date', severity: 'WARNING', event: 'LEGACY_TIME' });
  assert.equal(Number.isFinite(Date.parse(event.timestamp)), true);
  assert.equal(event.context.originalInvalidTimestamp, 'not-a-date');
  clearTimeout(store.persistTimer);
});

test('guardado concurrente y fallo de disco no confirman un estado falso', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-write-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let complete;
  const store = await createDiagnosticPreferences({ path: join(dir, 'prefs.json'), getConfig: () => session, verify: () => new Promise(resolve => { complete = resolve; }) });
  const first = store.update({ testerMode: true });
  await assert.rejects(store.update({ autoSendTechnicalErrors: true }), { code: 'BUSY' });
  assert.equal(store.view().testerMode, false);
  complete(); await first;
  const blocked = await createDiagnosticPreferences({ path: join(dir, 'missing', 'prefs.json'), getConfig: () => session, verify: async () => {} });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'missing'), 'blocks directory creation');
  await assert.rejects(blocked.update({ testerMode: true }));
  assert.equal(blocked.view().testerMode, false);
});
