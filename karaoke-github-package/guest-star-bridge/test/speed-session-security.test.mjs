import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await readFile(resolve(root, "src/server.mjs"), "utf8");
const config = await readFile(resolve(root, "src/config.mjs"), "utf8");
const superhost = await readFile(resolve(root, "public/superhost.js"), "utf8");
const app = await readFile(resolve(root, "public/app.js"), "utf8");
const index = await readFile(resolve(root, "public/index.html"), "utf8");

test("la selección responde antes de ejecutar la sincronización completa", () => {
  const body = server.slice(
    server.indexOf('pathname === "/api/auth/selection"'),
    server.indexOf('pathname === "/api/config"')
  );
  const realtime = server.slice(
    server.indexOf("let cloudLoopRunning"),
    server.indexOf("server.listen")
  );
  assert.match(body, /const data = await selectBridgeActivity\(config, selection\)/);
  assert.match(body, /applyActivityState\(data\)/);
  assert.match(body, /json\(response, 200, stateView\(\)\)/);
  assert.match(body, /restartCloudRealtime\(\)/);
  assert.ok(body.indexOf("json(response") < body.indexOf("restartCloudRealtime()"));
  assert.doesNotMatch(body, /syncNow\(\)/);
  assert.match(realtime, /socket\.addEventListener\("message"/);
  assert.match(realtime, /refreshCloudAfterSignal/);
  assert.doesNotMatch(realtime, /requestLoop|setInterval\s*\(/);
});

test("la sesión revocable queda disponible aunque Keychain no responda", () => {
  assert.match(config, /authToken: keychain\.authToken \|\| config\.authToken/);
  assert.match(config, /deviceToken: keychain\.deviceToken \|\| config\.deviceToken/);
  assert.doesNotMatch(config, /stored\.authToken = ""/);
  assert.match(server, /\{ storeSecrets: true \}/);
});

test("el Superhost administra credenciales permanentes sin revelar hashes", () => {
  assert.match(superhost, /setHostPassword/);
  assert.match(superhost, /type="password"/);
  assert.match(superhost, /data-show-password/);
  assert.match(superhost, /passwordUpdatedAt/);
  assert.doesNotMatch(superhost, /temporaryPassword/);
  assert.match(app, /changePasswordButton/);
});

test("los ocho idiomas se configuran por actividad", () => {
  assert.match(superhost, /updateActivityLanguages/);
  for (const code of ["es", "en", "fr", "it", "de", "ru", "pt", "hi"]) {
    assert.match(superhost, new RegExp(`language_\\$\\{code\\}|\\["${code}"`));
  }
  assert.match(app, /activityLanguageSettings/);
});

test("cada acción del menú More tiene un control único y un manejador real", () => {
  const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "the Bridge HTML must not contain duplicate element ids");
  for (const id of ["archiveQueue", "viewPrevious", "previewGuestPage", "menuLogout"]) {
    assert.equal(ids.includes(id), true, `${id} must exist in the More menu`);
    assert.match(app, new RegExp(`\\$\\("#${id}"\\)\\.addEventListener`));
  }
  assert.match(app, /superhostPanel\.openTab\("operation"\)/);
  assert.match(app, /await openExternal\(url\)/);
});
