import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DiagnosticStore,
  diagnosticFingerprint,
  normalizeDiagnosticEvent,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
  technicalReportText
} from "../src/diagnostics.mjs";

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function cancelScheduledPersist(store) {
  if (store.persistTimer) clearTimeout(store.persistTimer);
  store.persistTimer = null;
}

test("sanitiza credenciales, datos personales y rutas de usuario", () => {
  const raw = [
    "Bearer abc.def.ghi",
    "ghp_123456789012345678901234",
    "john.doe@example.com",
    "+1 (809) 555-1212",
    "/Users/garykeys/Music/secret.mp4",
    "C:\\Users\\Gary\\Music\\secret.mp4"
  ].join(" | ");
  const clean = sanitizeDiagnosticText(raw);

  assert.match(clean, /Bearer <redacted>/);
  assert.match(clean, /<redacted-token>/);
  assert.match(clean, /<redacted-email>/);
  assert.match(clean, /<redacted-phone>/);
  assert.match(clean, /\/Users\/<user>\/Music/);
  assert.match(clean, /C:\\Users\\<user>\\Music/);
  for (const secret of ["abc.def.ghi", "john.doe@example.com", "garykeys", "555-1212"]) {
    assert.equal(clean.includes(secret), false);
  }
  assert.equal(sanitizeDiagnosticText("http://127.0.0.1:8787/api/state"), "http://127.0.0.1:8787/api/state");
  assert.equal(sanitizeDiagnosticText("GS-260901201530-1F85E"), "GS-260901201530-1F85E");
});

test("sanitiza estructuras anidadas, claves sensibles y referencias circulares", () => {
  const value = {
    authorization: "Bearer private-token",
    password: "super-secret",
    nested: {
      apiKey: "AIza123456789012345678901234567890",
      file: "/Users/garykeys/Music/song.mp4",
      email: "host@example.com",
      guestName: "Private Guest",
      songTitle: "Private Song",
      requestId: "request-visible-nowhere",
      audioBlob: "pretend-media-payload"
    }
  };
  value.self = value;

  const clean = sanitizeDiagnosticValue(value);

  assert.equal(clean.authorization, "<redacted>");
  assert.equal(clean.password, "<redacted>");
  assert.equal(clean.nested.apiKey, "<redacted>");
  assert.equal(clean.nested.file, "/Users/<user>/Music/song.mp4");
  assert.equal(clean.nested.email, "<redacted-email>");
  assert.equal(clean.nested.guestName, "<redacted>");
  assert.equal(clean.nested.songTitle, "<redacted>");
  assert.match(clean.nested.requestId, /^[a-f0-9]{16}$/);
  assert.notEqual(clean.nested.requestId, "request-visible-nowhere");
  assert.equal(clean.nested.audioBlob, "<redacted>");
  assert.equal(clean.self, "<circular>");
  assert.equal(sanitizeDiagnosticValue({ sessionDiagnosticId: "GSS-public-id" }).sessionDiagnosticId, "GSS-public-id");
});

test("normaliza eventos a módulos, severidades, ubicación y contexto seguros", () => {
  const event = normalizeDiagnosticEvent({
    module: "Not a real module",
    severity: "unexpected",
    event: "PLAYER_FAILURE",
    message: "Falló para host@example.com en /Users/garykeys/Music/song.mp4",
    file: "/Users/garykeys/app.js",
    line: -2,
    column: "4",
    context: { accessToken: "private", attempts: 3 }
  }, { sessionDiagnosticId: "session-1" });

  assert.equal(event.module, "Other");
  assert.equal(event.severity, "INFO");
  assert.equal(event.sessionDiagnosticId, "session-1");
  assert.equal(event.line, null);
  assert.equal(event.column, 4);
  assert.equal(event.context.accessToken, "<redacted>");
  assert.equal(event.message.includes("host@example.com"), false);
  assert.equal(event.file, "/Users/<user>/app.js");
  assert.match(event.fingerprint, /^[a-f0-9]{24}$/);
});

test("la huella agrupa el mismo fallo aunque cambien IDs, contadores y líneas del stack", () => {
  const first = diagnosticFingerprint({
    module: "Player",
    name: "MediaError",
    message: "Request 12345 failed at address 0xabc123",
    file: "/Users/garykeys/app.js",
    stack: "MediaError: failed\n    at play (/Users/garykeys/app.js:120:9)"
  });
  const second = diagnosticFingerprint({
    module: "Player",
    name: "MediaError",
    message: "Request 98765 failed at address 0xdef456",
    file: "/Users/garykeys/app.js",
    stack: "MediaError: failed\n    at play (/Users/garykeys/app.js:450:27)"
  });

  assert.equal(first, second);
});

test("deduplica incidentes abiertos y abre uno nuevo después de resolver", () => {
  const store = new DiagnosticStore({ version: "4.4.1", build: "test" });
  const first = store.record({
    module: "Player",
    severity: "ERROR",
    event: "MEDIA_ERROR",
    name: "MediaError",
    message: "Request 12345 failed",
    summary: "No se pudo reproducir",
    file: "/Users/garykeys/app.js",
    line: 120,
    stack: "MediaError\n at play (/Users/garykeys/app.js:120:4)"
  });
  store.record({
    module: "Player",
    severity: "ERROR",
    event: "MEDIA_ERROR",
    name: "MediaError",
    message: "Request 98765 failed",
    summary: "No se pudo reproducir",
    file: "/Users/garykeys/app.js",
    line: 120,
    stack: "MediaError\n at play (/Users/garykeys/app.js:500:8)"
  });

  assert.equal(store.reports.length, 1);
  assert.equal(store.reports[0].occurrenceCount, 2);
  assert.equal(store.reports[0].fingerprint, first.fingerprint);
  assert.equal(store.health.Player, "ERROR");

  store.updateReport(store.reports[0].reportId, { status: "Resuelto" });
  store.record({
    module: "Player",
    severity: "ERROR",
    event: "MEDIA_ERROR",
    name: "MediaError",
    message: "Request 54321 failed",
    summary: "No se pudo reproducir",
    file: "/Users/garykeys/app.js",
    line: 120,
    stack: "MediaError\n at play (/Users/garykeys/app.js:700:2)"
  });

  assert.equal(store.reports.length, 2);
  assert.equal(store.reports[0].status, "Resuelto");
  assert.equal(store.reports[1].status, "Nuevo");
});

test("mantiene un ring buffer acotado y actualiza salud con errores y recuperaciones", () => {
  const store = new DiagnosticStore({ maxEvents: 100 });
  for (let index = 0; index < 105; index += 1) {
    store.record({
      eventId: `event-${index}`,
      module: "Audio",
      severity: "INFO",
      event: "AUDIO_TICK",
      message: `tick ${index}`
    }, { createIncident: false });
  }

  assert.equal(store.events.length, 100);
  assert.equal(store.events[0].eventId, "event-5");
  assert.equal(store.events.at(-1).eventId, "event-104");
  assert.equal(store.setHealth("Audio", "invalid"), false);
  store.record({ module: "Audio", severity: "ERROR", event: "AUDIO_ERROR" });
  assert.equal(store.health.Audio, "ERROR");
  store.record({ module: "Audio", severity: "RECOVERED", event: "AUDIO_RECOVERED" });
  assert.equal(store.health.Audio, "OK");
});

test("persiste eventos, reportes, fallos y salud sin conservar secretos", async (t) => {
  const root = await temporaryDirectory(t, "guest-star-diagnostics-");
  const storagePath = join(root, "diagnostics.json");
  const store = new DiagnosticStore({
    storagePath,
    version: "4.4.1",
    build: "diagnostic-test"
  });
  const source = store.record({
    eventId: "source-error",
    module: "Spleeter",
    severity: "ERROR",
    event: "SPLEETER_ERROR",
    message: "Bearer private-token failed for host@example.com",
    file: "/Users/garykeys/Guest Star/server.mjs",
    stack: "Error: ghp_123456789012345678901234",
    context: {
      password: "do-not-store",
      sourcePath: "/Users/garykeys/Music/song.mp4"
    }
  });
  store.setHealth("Local Server", "OK");
  const report = store.createReport({
    attachExisting: false,
    sourceEventId: source.eventId,
    modules: ["Spleeter", "Stem Cache"],
    severity: "CRITICAL",
    summary: "Separación fallida",
    description: "Contactar a host@example.com",
    userAction: "Abrí /Users/garykeys/Music/song.mp4",
    snapshot: {
      currentState: { scene: "karaoke" },
      audio: { output: "USB" },
      stems: { engine: "spleeter" },
      activeJobs: [{ id: "job-1" }],
      apiToken: "never-persist-this"
    }
  });
  store.markFailure({
    reason: "falló /Users/garykeys/Music/song.mp4",
    authorization: "Bearer another-private-token"
  });
  store.updateReport(report.reportId, {
    status: "Revisando",
    deliveryStatus: "failed",
    deliveryError: "host@example.com está offline"
  });
  cancelScheduledPersist(store);
  await store.persist();

  const raw = await readFile(storagePath, "utf8");
  for (const secret of [
    "private-token",
    "another-private-token",
    "do-not-store",
    "never-persist-this",
    "host@example.com",
    "garykeys"
  ]) {
    assert.equal(raw.includes(secret), false);
  }
  assert.doesNotThrow(() => JSON.parse(raw));

  const restored = await new DiagnosticStore({ storagePath }).load();
  assert.equal(restored.events.length, 1);
  assert.equal(restored.reports.length, 2);
  assert.equal(restored.captures.length, 1);
  assert.equal(restored.health["Local Server"], "OK");
  assert.equal(restored.health.Spleeter, "ERROR");
  assert.equal(restored.health.Diagnostics, "OK");
  assert.equal(restored.reports.some((entry) => entry.status === "Revisando"), true);
});

test("genera un reporte técnico reutilizable con estado, eventos y salud sanitizados", () => {
  const report = technicalReportText({
    reportId: "GS-TEST-1",
    version: "4.4.1",
    build: "test",
    severity: "ERROR",
    modules: ["Audio", "Player"],
    description: "Falló para host@example.com",
    userAction: "Reproduciendo /Users/garykeys/Music/song.mp4",
    summary: "Salida desconectada",
    source: { file: "/Users/garykeys/app.js", line: 20, column: 4 },
    stack: "Bearer secret-token",
    snapshot: {
      system: { os: "macOS", architecture: "arm64" },
      currentState: { scene: "karaoke" },
      audio: { output: "USB" },
      stems: { source: "spleeter" },
      activeJobs: [{ id: "stem-1" }]
    },
    recentEvents: [{
      timestamp: "2026-08-01T20:00:00.000Z",
      event: "AUDIO_OUTPUT_LOST",
      severity: "ERROR",
      summary: "Salida perdida"
    }],
    health: { Audio: "ERROR", Player: "RECOVERING" }
  });

  assert.match(report, /^GUEST STAR BUG REPORT/);
  assert.match(report, /CURRENT STATE:/);
  assert.match(report, /AUDIO:/);
  assert.match(report, /STEMS:/);
  assert.match(report, /ACTIVE JOBS:/);
  assert.match(report, /RECENT EVENTS:/);
  assert.match(report, /Audio: ERROR/);
  assert.equal(report.includes("host@example.com"), false);
  assert.equal(report.includes("garykeys"), false);
  assert.equal(report.includes("secret-token"), false);
});
