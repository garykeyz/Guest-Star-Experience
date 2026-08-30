import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);
const RETIRED_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";

test("Request, Host and Bridge operate only on D1 and never on Apps Script", async () => {
  const routePaths = [
    "app/api/karaoke/route.ts",
    "app/api/host/route.ts",
    "app/api/bridge/route.ts"
  ];

  for (const path of routePaths) {
    const source = await readFile(resolve(PACKAGE_ROOT, path), "utf8");
    assert.ok(!source.includes(RETIRED_APPS_SCRIPT_URL), `${path} must not use the retired deployment`);
    assert.doesNotMatch(source, /KARAOKE_APPS_SCRIPT_URL|callAppsScript|scheduleD1Backup|appendOutbox/);
    assert.match(source, /D1_SERVICE_UNAVAILABLE|d1-only/);
  }

  const wrangler = JSON.parse(
    await readFile(resolve(PACKAGE_ROOT, "wrangler.jsonc"), "utf8")
  );
  assert.equal(wrangler.vars?.KARAOKE_APPS_SCRIPT_URL, undefined,
    "Cloudflare must not expose an Apps Script destination to the live Worker");

  const bridgeCloudClient = await readFile(
    resolve(PACKAGE_ROOT, "guest-star-bridge/src/apps-script.mjs"), "utf8"
  );
  const bridgeServer = await readFile(
    resolve(PACKAGE_ROOT, "guest-star-bridge/src/server.mjs"), "utf8"
  );
  assert.match(bridgeCloudClient, /legacy Google Sheets\/PIN backend is disabled/);
  assert.doesNotMatch(bridgeCloudClient, /pin:\s*config\.hostPin/);
  assert.match(bridgeServer, /config\.appsScriptUrl && hasV4Session\(config\)/,
    "the beta must require a revocable D1 session instead of accepting a legacy PIN");
});
