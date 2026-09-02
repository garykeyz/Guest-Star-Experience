import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DIAGNOSTIC_MODULES = Object.freeze([
  "Application / Runtime", "Player", "Audio", "AudioContext", "Audio Output",
  "Video", "Star Screen", "Displays", "Queue", "Requests", "Library", "YouTube",
  "Stems IA", "Spleeter", "Demucs", "Stem Cache", "Background Audio",
  "Preferences", "Bridge", "VirtualDJ", "Network/API", "Config",
  "macOS Native Host", "Other"
]);

export const HEALTH_COMPONENTS = Object.freeze([
  "Application", "Local Server", "Player", "Audio", "Audio Output", "Video",
  "Star Screen", "Queue", "Library", "Spleeter", "Demucs", "Stem Cache",
  "Background Audio", "Native Host", "Diagnostics"
]);

const SEVERITIES = new Set(["INFO", "WARNING", "ERROR", "CRITICAL", "RECOVERED"]);
const REPORT_STATES = new Set(["Nuevo", "Revisando", "Resuelto", "Ignorado"]);
const HEALTH_STATES = new Set(["OK", "WARNING", "ERROR", "RECOVERING", "IDLE", "RUNNING", "OFFLINE", "READY", "LIVE", "PRESSURE"]);
const SECRET_KEY = /authorization|password|passwd|secret|token|cookie|credential|api[-_]?key|oauth/i;
const PRIVATE_TEXT_KEY = /guest.*name|full.*name|singer|song(?:name|title)?|track(?:name|title)|video(?:name|title)|private.*text|phone|telephone|mobile/i;
const ANONYMIZED_ID_KEY = /^(?:request|track|video|youtube|guest|hotel|activity|device|installation)Id$/i;
const MEDIA_PAYLOAD_KEY = /^(?:audio|video|vocals|instrumental|stem)(?:Data|Blob|Buffer|Bytes|Base64)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<![-\w.:])(?:\+?\d(?:[\s()-]*\d){7,})(?![-\w.:])/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_VALUE = /\b(?:eyJ[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g;
const USER_PATH = /\/Users\/[^/\s]+/g;
const WINDOWS_USER_PATH = /[A-Z]:\\Users\\[^\\\s]+/gi;

function clipped(value, length = 4000) {
  return String(value ?? "").slice(0, length);
}

export function sanitizeDiagnosticText(value) {
  return clipped(value, 16000)
    .replace(BEARER, "Bearer <redacted>")
    .replace(TOKEN_VALUE, "<redacted-token>")
    .replace(EMAIL, "<redacted-email>")
    .replace(PHONE, "<redacted-phone>")
    .replace(USER_PATH, "/Users/<user>")
    .replace(WINDOWS_USER_PATH, "C:\\Users\\<user>");
}

export function sanitizeDiagnosticValue(value, depth = 0, seen = new WeakSet()) {
  if (depth > 7) return "<truncated>";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") return sanitizeDiagnosticText(value);
  if (seen.has(value)) return "<circular>";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeDiagnosticValue(entry, depth + 1, seen));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if (SECRET_KEY.test(key) || PRIVATE_TEXT_KEY.test(key) || MEDIA_PAYLOAD_KEY.test(key)) {
      result[key] = "<redacted>";
    } else if (ANONYMIZED_ID_KEY.test(key)) {
      const normalized = String(entry || "");
      result[key] = normalized
        ? createHash("sha256").update(normalized).digest("hex").slice(0, 16)
        : "";
    } else {
      result[key] = sanitizeDiagnosticValue(entry, depth + 1, seen);
    }
  }
  return result;
}

export function normalizeDiagnosticMessage(value) {
  return sanitizeDiagnosticText(value)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .replace(/0x[0-9a-f]+/gi, "<address>")
    .replace(/\s+/g, " ")
    .trim();
}

export function diagnosticFingerprint(event = {}) {
  const stackSignature = sanitizeDiagnosticText(event.stack || "")
    .split("\n")
    .slice(0, 4)
    .map((line) => line.replace(/:\d+:\d+/g, ":<line>:<column>"))
    .join("|");
  return createHash("sha256").update([
    clipped(event.module || "Other", 80),
    clipped(event.name || event.type || event.event || "Error", 100),
    normalizeDiagnosticMessage(event.message || event.summary || ""),
    sanitizeDiagnosticText(event.file || ""),
    Number.isFinite(Number(event.line)) ? String(Number(event.line)) : "",
    stackSignature
  ].join("\n")).digest("hex").slice(0, 24);
}

function reportId(now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(2, 14);
  return `GS-${stamp}-${randomUUID().slice(0, 5).toUpperCase()}`;
}

function cleanSeverity(value, fallback = "INFO") {
  const severity = String(value || "").toUpperCase();
  return SEVERITIES.has(severity) ? severity : fallback;
}

function cleanModule(value) {
  const module = clipped(value || "Other", 80);
  return DIAGNOSTIC_MODULES.includes(module) ? module : "Other";
}

function cleanLocation(value = {}) {
  const line = Number(value.line);
  const column = Number(value.column);
  return {
    file: sanitizeDiagnosticText(value.file || ""),
    line: Number.isInteger(line) && line > 0 ? line : null,
    column: Number.isInteger(column) && column > 0 ? column : null
  };
}

export function normalizeDiagnosticEvent(value = {}, defaults = {}) {
  const location = cleanLocation(value);
  const timestamp = Number.isFinite(Date.parse(String(value.timestamp || "")))
    ? new Date(value.timestamp).toISOString()
    : new Date().toISOString();
  const event = {
    eventId: clipped(value.eventId || `GSE-${randomUUID()}`, 80),
    sessionDiagnosticId: clipped(value.sessionDiagnosticId || defaults.sessionDiagnosticId || "", 100),
    timestamp,
    module: cleanModule(value.module),
    severity: cleanSeverity(value.severity),
    event: clipped(value.event || value.type || "DIAGNOSTIC_EVENT", 120),
    name: clipped(value.name || "", 160),
    message: sanitizeDiagnosticText(value.message || value.summary || ""),
    summary: sanitizeDiagnosticText(value.summary || value.message || value.event || "Evento técnico"),
    file: location.file,
    line: location.line,
    column: location.column,
    stack: sanitizeDiagnosticText(value.stack || ""),
    jobId: clipped(value.jobId || "", 100),
    engine: clipped(value.engine || "", 40),
    elapsedMs: Math.max(0, Number(value.elapsedMs) || 0),
    context: sanitizeDiagnosticValue(value.context || {})
  };
  event.fingerprint = diagnosticFingerprint(event);
  return event;
}

function initialHealthMap() {
  return Object.fromEntries(HEALTH_COMPONENTS.map((component) => [component,
    component === "Diagnostics" ? "OK" : "IDLE"
  ]));
}

function cleanHealthMap(value = {}) {
  const result = initialHealthMap();
  for (const component of HEALTH_COMPONENTS) {
    const state = String(value?.[component] || "").toUpperCase();
    if (HEALTH_STATES.has(state)) result[component] = state;
  }
  return result;
}

export function technicalReportText(report = {}) {
  const state = report.snapshot || {};
  const location = report.source || {};
  const events = Array.isArray(report.recentEvents) ? report.recentEvents : [];
  const health = report.health || state.health || {};
  const lines = [
    "GUEST STAR BUG REPORT",
    "",
    `Report ID: ${report.reportId || "—"}`,
    `Version: ${report.version || state.version || "—"}`,
    `Build: ${report.build || state.build || "—"}`,
    `macOS: ${state.system?.os || "—"}`,
    `Architecture: ${state.system?.architecture || "—"}`,
    `Severity: ${report.severity || "INFO"}`,
    `Modules: ${(report.modules || []).join(", ") || "Other"}`,
    "",
    "USER DESCRIPTION:",
    report.description || "(sin descripción)",
    "",
    "WHAT WAS HAPPENING:",
    report.userAction || "(no indicado)",
    "",
    "CURRENT STATE:",
    JSON.stringify(state.currentState || {}, null, 2),
    "",
    "AUDIO:",
    JSON.stringify(state.audio || {}, null, 2),
    "",
    "STEMS:",
    JSON.stringify(state.stems || {}, null, 2),
    "",
    "ACTIVE JOBS:",
    JSON.stringify(state.activeJobs || [], null, 2),
    "",
    `LAST ERROR: ${report.summary || report.lastError || "—"}`,
    `SOURCE: ${location.file || "—"}${location.line ? `:${location.line}${location.column ? `:${location.column}` : ""}` : ""}`,
    "",
    "STACK:",
    report.stack || "—",
    "",
    "RECENT EVENTS:",
    ...events.slice(-50).map((entry) =>
      `${entry.timestamp || ""} ${entry.event || "EVENT"} [${entry.severity || "INFO"}] ${entry.summary || entry.message || ""}`
    ),
    "",
    "HEALTH:",
    ...Object.entries(health).map(([component, status]) => `${component}: ${status}`)
  ];
  return sanitizeDiagnosticText(lines.join("\n"));
}

export class DiagnosticStore {
  constructor({ storagePath, version = "", build = "", maxEvents = 250, maxReports = 500 } = {}) {
    this.storagePath = storagePath;
    this.version = version;
    this.build = build;
    this.maxEvents = Math.max(100, Math.min(500, Number(maxEvents) || 250));
    this.maxReports = Math.max(50, Math.min(1000, Number(maxReports) || 500));
    this.sessionDiagnosticId = `GSS-${randomUUID()}`;
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.reports = [];
    this.captures = [];
    this.health = initialHealthMap();
    this.persistTimer = null;
    this.writeChain = Promise.resolve();
    this.lastFingerprintAt = new Map();
  }

  async load() {
    if (!this.storagePath) return this;
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, "utf8"));
      this.events = (Array.isArray(parsed.events) ? parsed.events : []).slice(-this.maxEvents);
      this.reports = (Array.isArray(parsed.reports) ? parsed.reports : []).slice(-this.maxReports);
      this.captures = (Array.isArray(parsed.captures) ? parsed.captures : []).slice(-20);
      this.health = cleanHealthMap(parsed.health);
    } catch {
      // First launch or a truncated diagnostic file starts with an empty buffer.
    }
    this.health.Diagnostics = "OK";
    return this;
  }

  schedulePersist() {
    if (!this.storagePath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 250);
    this.persistTimer.unref?.();
  }

  async persist() {
    if (!this.storagePath) return;
    const payload = JSON.stringify(sanitizeDiagnosticValue({
      formatVersion: 1,
      updatedAt: new Date().toISOString(),
      health: this.health,
      events: this.events.slice(-this.maxEvents),
      reports: this.reports.slice(-this.maxReports),
      captures: this.captures.slice(-20)
    }), null, 2);
    const target = this.storagePath;
    const temporary = `${target}.part`;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, `${payload}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    }).catch(() => {
      this.health.Diagnostics = "WARNING";
    });
    await this.writeChain;
  }

  setHealth(component, status) {
    if (!HEALTH_COMPONENTS.includes(component)) return false;
    const normalized = String(status || "").toUpperCase();
    if (!HEALTH_STATES.has(normalized) || this.health[component] === normalized) return false;
    this.health[component] = normalized;
    this.schedulePersist();
    return true;
  }

  record(value = {}, { createIncident = true } = {}) {
    const event = normalizeDiagnosticEvent(value, {
      sessionDiagnosticId: this.sessionDiagnosticId
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.lastFingerprintAt.set(event.fingerprint, Date.parse(event.timestamp) || Date.now());
    this.updateHealthFromEvent(event);
    if (createIncident && ["ERROR", "CRITICAL"].includes(event.severity)) {
      this.upsertAutomaticReport(event);
    }
    this.schedulePersist();
    return event;
  }

  updateHealthFromEvent(event) {
    const mapping = {
      "Application / Runtime": "Application", Player: "Player", Audio: "Audio",
      AudioContext: "Audio", "Audio Output": "Audio Output", Video: "Video",
      "Star Screen": "Star Screen", Displays: "Star Screen", Queue: "Queue",
      Library: "Library", Spleeter: "Spleeter", Demucs: "Demucs",
      "Stem Cache": "Stem Cache", "Background Audio": "Background Audio",
      "macOS Native Host": "Native Host"
    };
    const component = mapping[event.module];
    if (!component) return;
    if (event.severity === "CRITICAL" || event.severity === "ERROR") this.health[component] = "ERROR";
    else if (event.severity === "WARNING") this.health[component] = "WARNING";
    else if (event.severity === "RECOVERED") this.health[component] = "OK";
    else if (["DEMUCS_START", "SPLEETER_START"].includes(event.event)) this.health[component] = "RUNNING";
  }

  upsertAutomaticReport(event) {
    const existing = this.reports.find((report) =>
      report.fingerprint === event.fingerprint && !["Resuelto", "Ignorado"].includes(report.status)
    );
    if (existing) {
      existing.occurrenceCount += 1;
      existing.lastSeenAt = event.timestamp;
      existing.summary = event.summary;
      existing.lastError = event.message;
      existing.recentEvents = this.events.slice(-50);
      return existing;
    }
    const now = new Date(event.timestamp);
    const report = {
      reportId: reportId(now),
      fingerprint: event.fingerprint,
      automatic: true,
      createdAt: event.timestamp,
      firstSeenAt: event.timestamp,
      lastSeenAt: event.timestamp,
      occurrenceCount: 1,
      status: "Nuevo",
      deliveryStatus: "local",
      severity: event.severity,
      modules: [event.module],
      summary: event.summary,
      description: "",
      userAction: "",
      version: this.version,
      build: this.build,
      sessionDiagnosticId: this.sessionDiagnosticId,
      source: cleanLocation(event),
      stack: event.stack,
      lastError: event.message,
      snapshot: {},
      recentEvents: this.events.slice(-50),
      health: { ...this.health }
    };
    this.reports.push(report);
    if (this.reports.length > this.maxReports) this.reports.splice(0, this.reports.length - this.maxReports);
    return report;
  }

  createReport(value = {}) {
    const modules = [...new Set((Array.isArray(value.modules) ? value.modules : [])
      .map(cleanModule))].slice(0, 12);
    const sourceEvent = value.sourceEventId
      ? this.events.find((event) => event.eventId === value.sourceEventId)
      : [...this.events].reverse().find((event) => ["ERROR", "CRITICAL"].includes(event.severity));
    const fingerprint = sourceEvent?.fingerprint || diagnosticFingerprint({
      module: modules[0] || "Other",
      name: "MANUAL_REPORT",
      message: value.description || value.userAction || "silent functional issue"
    });
    const existing = value.attachExisting !== false
      ? this.reports.find((report) => report.fingerprint === fingerprint && report.status === "Nuevo")
      : null;
    if (existing) {
      existing.description = sanitizeDiagnosticText(value.description || existing.description);
      existing.userAction = sanitizeDiagnosticText(value.userAction || existing.userAction);
      existing.modules = modules.length ? modules : existing.modules;
      existing.snapshot = sanitizeDiagnosticValue(value.snapshot || existing.snapshot);
      existing.health = cleanHealthMap(value.health || existing.health);
      existing.recentEvents = this.events.slice(-80);
      existing.lastSeenAt = new Date().toISOString();
      this.schedulePersist();
      return existing;
    }
    const now = new Date();
    const report = {
      reportId: reportId(now),
      fingerprint,
      automatic: false,
      createdAt: now.toISOString(),
      firstSeenAt: sourceEvent?.timestamp || now.toISOString(),
      lastSeenAt: now.toISOString(),
      occurrenceCount: 1,
      status: "Nuevo",
      deliveryStatus: value.deliveryStatus === "queued" ? "queued" : "local",
      severity: cleanSeverity(value.severity, sourceEvent?.severity || "WARNING"),
      modules: modules.length ? modules : [sourceEvent?.module || "Other"],
      summary: sanitizeDiagnosticText(value.summary || sourceEvent?.summary || value.description || "Reporte manual"),
      description: sanitizeDiagnosticText(value.description || ""),
      userAction: sanitizeDiagnosticText(value.userAction || ""),
      version: this.version,
      build: this.build,
      sessionDiagnosticId: this.sessionDiagnosticId,
      source: cleanLocation(sourceEvent || value.source || {}),
      stack: sanitizeDiagnosticText(sourceEvent?.stack || value.stack || ""),
      lastError: sanitizeDiagnosticText(sourceEvent?.message || ""),
      snapshot: sanitizeDiagnosticValue(value.snapshot || {}),
      recentEvents: this.events.slice(-80),
      health: cleanHealthMap(value.health || this.health)
    };
    this.reports.push(report);
    if (this.reports.length > this.maxReports) this.reports.splice(0, this.reports.length - this.maxReports);
    this.schedulePersist();
    return report;
  }

  markFailure(snapshot = {}) {
    const capture = {
      captureId: `GSC-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      sessionDiagnosticId: this.sessionDiagnosticId,
      snapshot: sanitizeDiagnosticValue(snapshot),
      health: { ...this.health },
      recentEvents: this.events.slice(-80)
    };
    this.captures.push(capture);
    if (this.captures.length > 20) this.captures.shift();
    this.schedulePersist();
    return capture;
  }

  updateReport(reportIdValue, value = {}) {
    const report = this.reports.find((entry) => entry.reportId === reportIdValue);
    if (!report) return null;
    if (REPORT_STATES.has(value.status)) report.status = value.status;
    if (["local", "queued", "sent", "failed"].includes(value.deliveryStatus)) {
      report.deliveryStatus = value.deliveryStatus;
    }
    if (value.deliveryError !== undefined) {
      report.deliveryError = sanitizeDiagnosticText(value.deliveryError || "");
    }
    report.updatedAt = new Date().toISOString();
    this.schedulePersist();
    return report;
  }

  reportText(reportIdValue) {
    const report = this.reports.find((entry) => entry.reportId === reportIdValue);
    return report ? technicalReportText(report) : "";
  }

  view() {
    return sanitizeDiagnosticValue({
      ok: true,
      sessionDiagnosticId: this.sessionDiagnosticId,
      startedAt: this.startedAt,
      health: this.health,
      recentEvents: this.events.slice(-30).reverse(),
      recentErrors: this.events.filter((event) =>
        ["WARNING", "ERROR", "CRITICAL", "RECOVERED"].includes(event.severity)
      ).slice(-20).reverse(),
      reports: this.reports.slice().reverse(),
      captures: this.captures.slice().reverse()
    });
  }
}
