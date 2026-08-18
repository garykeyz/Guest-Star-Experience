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

test("la selección responde antes de ejecutar la sincronización completa", () => {
  const body = server.slice(
    server.indexOf('pathname === "/api/auth/selection"'),
    server.indexOf('pathname === "/api/config"')
  );
  assert.match(body, /json\(response, 200, stateView\(\)\)/);
  assert.match(body, /void syncNow\(\)\.catch/);
  assert.ok(body.indexOf("json(response") < body.indexOf("void syncNow()"));
  assert.doesNotMatch(body, /await syncNow\(\)/);
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

test("Español e English se configuran por actividad", () => {
  assert.match(superhost, /updateActivityLanguages/);
  assert.match(superhost, /languageEs/);
  assert.match(superhost, /languageEn/);
  assert.match(app, /activityLanguageSettings/);
});
