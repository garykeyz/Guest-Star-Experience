import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);
const CANONICAL_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxpUugPQJ1N3yb8uezB6fpd84CELAKtbuB2maE3HberOBGo5ObABGtN3ZfCI3UvKbLkzg/exec";
const RETIRED_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";

test("web, Host and Bridge proxy use the Superhost Apps Script deployment", async () => {
  const routePaths = [
    "app/api/karaoke/route.ts",
    "app/api/host/route.ts",
    "app/api/bridge/route.ts"
  ];

  for (const path of routePaths) {
    const source = await readFile(resolve(PACKAGE_ROOT, path), "utf8");
    assert.ok(!source.includes(RETIRED_APPS_SCRIPT_URL), `${path} must not use the retired deployment`);
    if (path === "app/api/karaoke/route.ts") {
      assert.match(source, /process\.env\.KARAOKE_APPS_SCRIPT_URL/);
      assert.ok(source.includes(CANONICAL_APPS_SCRIPT_URL), `${path} must use the canonical deployment`);
    } else {
      assert.match(source, /from "@\/lib\/guest-star\/upstream"/);
    }
  }

  const upstream = await readFile(resolve(PACKAGE_ROOT, "lib/guest-star/upstream.ts"), "utf8");
  assert.match(upstream, /process\.env\.KARAOKE_APPS_SCRIPT_URL/);
  assert.ok(upstream.includes(CANONICAL_APPS_SCRIPT_URL));
  assert.ok(!upstream.includes(RETIRED_APPS_SCRIPT_URL));

  const wrangler = JSON.parse(
    await readFile(resolve(PACKAGE_ROOT, "wrangler.jsonc"), "utf8")
  );
  assert.equal(
    wrangler.vars?.KARAOKE_APPS_SCRIPT_URL,
    CANONICAL_APPS_SCRIPT_URL,
    "Cloudflare must pin the same Apps Script deployment as every route"
  );
});
