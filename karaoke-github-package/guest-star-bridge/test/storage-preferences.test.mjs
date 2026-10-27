import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStoragePreferences } from "../public/storage-preferences.js";
import { translateBridgeText } from "../public/bridge-i18n.js";

function fixture(request) {
  class Element {
    children = []; attributes = {}; dataset = {}; events = {}; textContent = "";
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(key, handler) { this.events[key] = handler; }
  }
  const elements = Object.fromEntries(["Total", "List", "Status", "Refresh"].map((id) => [id, new Element()]));
  const root = { querySelector: (selector) => elements[selector.replace("#preferencesStorage", "")], createElement: () => new Element() };
  const dialog = { open: true };
  let language = "es";
  const notices = [];
  const controller = createStoragePreferences({ root, request, dialog, i18n: { getLanguage: () => language }, notify: (...args) => notices.push(args) });
  return { controller, elements, dialog, notices, setLanguage: (value) => { language = value; } };
}
const data = { complete: true, totalBytes: 3_420_000_000, locations: [{ id: "safe-id", kind: "stems", libraryName: "Library <b>", bytes: 3_420_000_000, files: 3, exists: true, displayPath: "~/Library/.guest-star-stems", path: "/test/Library/.guest-star-stems" }] };

test("storage UI: calculating, actual values, path tooltip and language without scanning again", async () => {
  let complete;
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise((resolve) => { complete = resolve; }); });
  const pending = f.controller.refresh();
  assert.equal(f.elements.Total.textContent, "Calculando…");
  assert.equal(f.elements.List.attributes["aria-busy"], "true");
  complete(data); await pending;
  assert.equal(f.elements.Total.textContent, "3,4 GB utilizados");
  const row = f.elements.List.children[0];
  assert.equal(row.children[0].children[0].textContent, "Voz guía IA · Library <b>");
  assert.equal(row.children[0].children[1].title, "/test/Library/.guest-star-stems");
  f.setLanguage("en"); f.controller.renderLanguage();
  assert.equal(f.elements.Total.textContent, "3.4 GB used");
  assert.equal(calls, 1);
});

test("storage UI: unavailable and partial results never show a misleading total", async () => {
  const f = fixture(async () => ({ ...data, complete: false, locations: [{ ...data.locations[0], error: "EACCES", bytes: null }] }));
  await f.controller.refresh();
  assert.equal(f.elements.Total.textContent, "—");
  assert.match(f.elements.Status.textContent, /incompleto/);
  assert.equal(f.elements.List.children[0].children[1].children[0].textContent, "—");
});

test("storage UI: existing state transitions refresh once; clocks/progress and closed dialog do not poll", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return data; });
  const state = (status, progress = 0) => ({ config: { libraryFolders: ["/test"] }, stemEngine: { jobs: [{ id: "song", engines: { demucs: { status, progress } } }] } });
  f.controller.observeState(state("processing"));
  f.controller.observeState(state("processing", 50));
  assert.equal(calls, 0);
  f.controller.observeState(state("ready", 100));
  f.controller.changed(); f.controller.changed();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(calls, 1);
  f.dialog.open = false;
  f.controller.observeState(state("failed"));
  f.controller.changed();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(calls, 1);
});

test("storage UI: Finder sends only the location ID and reports absent folder fallback", async () => {
  let sent;
  const f = fixture(async (path, options) => {
    if (path.endsWith("usage")) return data;
    sent = { path, options }; return { ok: true, exact: false };
  });
  await f.controller.refresh();
  const button = f.elements.List.children[0].children[2].children[0];
  f.elements.List.events.click({ target: { closest: () => button } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(sent.options.body), { id: "safe-id" });
  assert.equal(sent.path, "/api/storage/reveal");
  assert.equal(button.disabled, false);
  assert.match(f.notices[0][0], /carpeta contenedora/);
});

test("storage UI: translation and direct compact Preferences surface", async () => {
  assert.equal(translateBridgeText("CACHE & STORAGE", "es"), "CACHÉ Y ALMACENAMIENTO");
  assert.equal(translateBridgeText("Song storage", "es"), "Caché de canciones");
  const host = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const section = host.slice(host.indexOf('class="preferences-section preferences-storage"'), host.indexOf('class="preferences-section preferences-background-sources"'));
  assert.match(section, /preferencesStorageRefresh/);
  assert.match(section, /<svg/);
  assert.doesNotMatch(section, /📁|💾|🗂️|Borrar|Delete/);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /void storagePreferences\.refresh\(\)/);
  assert.match(app, /nativeAudioLoad.*nativeAudioStop/);
});
