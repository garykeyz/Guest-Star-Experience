const $ = (selector, root = document) => root.querySelector(selector);
const MODULES = [
  'Audio', 'Player', 'Star Screen', 'Queue', 'Stems IA', 'Spleeter', 'Demucs',
  'Library', 'YouTube', 'Preferences', 'Displays', 'Bridge', 'Other'
];
const IMPORTANT_MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'play', 'playing', 'pause', 'ended', 'waiting', 'stalled', 'error'];

export function escapeDiagnosticHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function errorDetails(reason) {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack || '' };
  }
  if (reason && typeof reason === 'object') {
    let fallback = '';
    try { fallback = JSON.stringify(reason); } catch { fallback = Object.prototype.toString.call(reason); }
    return { name: String(reason.name || ''), message: String(reason.message || fallback), stack: String(reason.stack || '') };
  }
  return { name: '', message: String(reason || 'Unknown error'), stack: '' };
}

function mediaError(element) {
  if (!element?.error) return '';
  return ({ 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' })[element.error.code] || 'MEDIA_ERROR';
}

function healthIcon(status) {
  if (['OK', 'READY', 'RUNNING', 'LIVE'].includes(status)) return '✓';
  if (['WARNING', 'RECOVERING', 'PRESSURE'].includes(status)) return '⚠';
  if (['ERROR', 'OFFLINE'].includes(status)) return '✕';
  return '·';
}

export function initDiagnostics({ api, getState, getPlayerSnapshot, showNotice }) {
  const dialog = $('#diagnosticReportDialog');
  const events = [];
  const health = {};
  let state = null;
  let serverState = null;
  let pending = [];
  let flushTimer = 0;
  let reportSnapshot = null;
  let recentAutomaticEventId = '';

  function clientSnapshot() {
    const appState = getState?.() || state || {};
    const player = getPlayerSnapshot?.() || {};
    const connection = navigator.connection || {};
    return {
      timestamp: new Date().toISOString(),
      version: appState.version || '',
      build: appState.build || '',
      currentState: {
        activityRunning: appState.activity?.activityRunning === true,
        mode: appState.operatingMode?.selected || '',
        queueLength: Array.isArray(appState.requests) ? appState.requests.length : 0,
        online: navigator.onLine,
        visibility: document.visibilityState,
        effectiveConnection: connection.effectiveType || ''
      },
      audio: player.audio || {},
      stems: {
        source: ['spleeter', 'demucs', 'original'].includes(player.stems?.lockedEngine)
          ? player.stems.lockedEngine
          : 'original'
      },
      health: { ...(serverState?.health || {}), ...health },
      recentClientEvents: events.slice(-80)
    };
  }

  function queueFlush() {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), 350);
  }

  async function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0, 50);
    try {
      await api('/api/diagnostics/events', {
        method: 'POST',
        body: JSON.stringify({ events: batch, autoSend: state?.config?.diagnostics?.autoSendTechnicalErrors === true })
      });
    } catch {
      pending = [...batch, ...pending].slice(-200);
      if (navigator.onLine) window.setTimeout(() => void flush(), 5000);
    }
  }

  function record(value = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      module: value.module || 'Other',
      severity: value.severity || 'INFO',
      event: value.event || value.type || 'DIAGNOSTIC_EVENT',
      name: value.name || '',
      message: value.message || '',
      summary: value.summary || value.message || value.event || 'Evento técnico',
      file: value.file || '',
      line: Number.isInteger(Number(value.line)) ? Number(value.line) : null,
      column: Number.isInteger(Number(value.column)) ? Number(value.column) : null,
      stack: value.stack || '',
      jobId: value.jobId || '',
      engine: value.engine || '',
      elapsedMs: Number(value.elapsedMs) || 0,
      context: value.context || {}
    };
    events.push(event);
    if (events.length > 200) events.shift();
    pending.push(event);
    if (pending.length > 200) pending.shift();
    if (['ERROR', 'CRITICAL'].includes(event.severity)) recentAutomaticEventId = event.eventId || '';
    queueFlush();
    return event;
  }

  function setHealth(component, status, detail = {}) {
    health[component] = status;
    record({ module: component === 'Audio Output' ? 'Audio Output' : component, severity: status === 'ERROR' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO', event: `HEALTH_${String(component).replace(/\W+/g, '_').toUpperCase()}_${status}`, summary: `${component}: ${status}`, context: detail });
  }

  function observeMedia() {
    document.querySelectorAll('audio, video').forEach((element) => {
      if (element.dataset.diagnosticsObserved === '1') return;
      element.dataset.diagnosticsObserved = '1';
      const module = element.id === 'playerBackgroundAudio' ? 'Background Audio' : element.tagName === 'VIDEO' ? 'Video' : 'Audio';
      IMPORTANT_MEDIA_EVENTS.forEach((type) => {
        element.addEventListener(type, () => {
          const isError = type === 'error';
          record({
            module,
            severity: isError ? 'ERROR' : ['waiting', 'stalled'].includes(type) ? 'WARNING' : 'INFO',
            event: `MEDIA_${type.toUpperCase()}`,
            summary: isError ? `${element.id || element.tagName}: ${mediaError(element)}` : `${element.id || element.tagName}: ${type}`,
            context: {
              elementId: element.id || '',
              mediaError: mediaError(element),
              readyState: element.readyState,
              networkState: element.networkState,
              currentTime: Number(element.currentTime) || 0,
              duration: Number.isFinite(element.duration) ? element.duration : 0
            }
          });
        }, { passive: true });
      });
    });
  }

  function renderHealth(snapshot = reportSnapshot || clientSnapshot()) {
    const target = $('#diagnosticHealthMap');
    if (!target) return;
    const map = snapshot.health || {};
    target.innerHTML = Object.entries(map).map(([component, status]) =>
      `<div data-health-status="${escapeDiagnosticHtml(status)}"><span>${healthIcon(status)}</span><strong>${escapeDiagnosticHtml(component)}</strong><em>${escapeDiagnosticHtml(status)}</em></div>`
    ).join('') || '<p>Capturando estado…</p>';
    const details = $('#diagnosticSnapshotDetails');
    if (details) details.textContent = JSON.stringify({
      current: snapshot.currentState || {},
      audio: snapshot.audio || {},
      stems: snapshot.stems || {},
      activeJobs: snapshot.activeJobs || []
    }, null, 2);
  }

  function renderRecent() {
    const target = $('#diagnosticRecentErrors');
    if (!target) return;
    const list = serverState?.recentErrors || [];
    target.innerHTML = list.length
      ? list.slice(0, 8).map((event) => `<li><b>${escapeDiagnosticHtml(event.severity)}</b><span>${escapeDiagnosticHtml(event.summary || event.event)}</span><small>${escapeDiagnosticHtml(new Date(event.timestamp).toLocaleTimeString())}</small></li>`).join('')
      : '<li><span>No hay errores técnicos recientes.</span></li>';
  }

  async function refreshServerState() {
    try {
      serverState = await api('/api/diagnostics/state');
      renderRecent();
      return serverState;
    } catch {
      return serverState;
    }
  }

  async function markFailure() {
    const snapshot = clientSnapshot();
    try {
      const result = await api('/api/diagnostics/mark', {
        method: 'POST', body: JSON.stringify({ snapshot })
      });
      showNotice(`Diagnóstico capturado: ${result.capture?.captureId || 'guardado'}.`);
      await refreshServerState();
      return result.capture;
    } catch (error) {
      showNotice(`No se pudo guardar el diagnóstico: ${error.message}`, true);
      return null;
    }
  }

  async function openReport() {
    reportSnapshot = clientSnapshot();
    await refreshServerState();
    reportSnapshot.health = { ...(serverState?.health || {}), ...reportSnapshot.health };
    renderHealth(reportSnapshot);
    const detected = $('#diagnosticDetectedError');
    const latest = serverState?.recentErrors?.[0];
    if (detected) {
      detected.classList.toggle('hidden', !latest);
      detected.textContent = latest ? `Se detectó un evento ${latest.severity.toLowerCase()} recientemente: ${latest.summary}` : '';
      detected.dataset.eventId = latest?.eventId || recentAutomaticEventId;
    }
    if (dialog && !dialog.open) dialog.showModal();
    window.setTimeout(() => $('#diagnosticDescription')?.focus(), 30);
  }

  function selectedModules() {
    return [...document.querySelectorAll('[name="diagnosticModule"]:checked')].map((input) => input.value);
  }

  async function createReport(action) {
    const description = $('#diagnosticDescription')?.value.trim() || '';
    if (!description) {
      showNotice('Describe brevemente qué dejó de funcionar.', true);
      return null;
    }
    const payload = {
      action,
      description,
      userAction: $('#diagnosticUserAction')?.value.trim() || '',
      modules: selectedModules(),
      snapshot: reportSnapshot || clientSnapshot(),
      sourceEventId: $('#diagnosticDetectedError')?.dataset.eventId || '',
      attachExisting: $('#diagnosticAttachRecent')?.checked !== false
    };
    const result = await api('/api/diagnostics/report', {
      method: 'POST', body: JSON.stringify(payload)
    });
    reportSnapshot = payload.snapshot;
    await refreshServerState();
    return result;
  }

  async function copyReport() {
    try {
      const result = await createReport('local');
      if (!result) return;
      await navigator.clipboard.writeText(result.text || '');
      showNotice(`Reporte ${result.report.reportId} copiado y listo para pegar en Codex.`);
    } catch (error) { showNotice(error.message, true); }
  }

  async function saveReport() {
    try {
      const result = await createReport('local');
      if (!result) return;
      showNotice(`Reporte ${result.report.reportId} guardado localmente.`);
    } catch (error) { showNotice(error.message, true); }
  }

  async function sendReport() {
    try {
      const result = await createReport('send');
      if (!result) return;
      const status = result.report.deliveryStatus === 'sent' ? 'enviado' : 'guardado en la cola offline';
      showNotice(`Reporte ${status}. ID ${result.report.reportId}.`);
    } catch (error) { showNotice(error.message, true); }
  }

  async function exportDiagnostics() {
    try {
      const response = await fetch('/api/diagnostics/export');
      if (!response.ok) throw new Error('No se pudo exportar el diagnóstico.');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = response.headers.get('X-Guest-Star-Filename') || `Guest-Star-Diagnostic-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) { showNotice(error.message, true); }
  }

  async function reportPlayerHealth(payload = {}) {
    try {
      await api('/api/player/health', { method: 'POST', body: JSON.stringify(payload) });
    } catch {
      // Health telemetry is best effort and never blocks playback.
    }
  }

  function sync(nextState) {
    state = nextState;
    const preferences = state?.config?.diagnostics || {};
    const auto = $('#diagnosticAutoSend');
    const tester = $('#diagnosticTesterMode');
    if (auto && !auto.matches(':active')) auto.checked = preferences.autoSendTechnicalErrors === true;
    if (tester && !tester.matches(':active')) tester.checked = preferences.testerMode === true;
    document.body.classList.toggle('diagnostic-tester-mode', preferences.testerMode === true);
    observeMedia();
  }

  window.addEventListener('error', (event) => {
    const detail = errorDetails(event.error || event.message);
    record({ module: 'Application / Runtime', severity: 'ERROR', event: 'WINDOW_ERROR', ...detail, file: event.filename || '', line: event.lineno, column: event.colno });
  });
  window.addEventListener('unhandledrejection', (event) => {
    record({ module: 'Application / Runtime', severity: 'ERROR', event: 'UNHANDLED_REJECTION', ...errorDetails(event.reason) });
  });
  window.addEventListener('online', () => { record({ module: 'Network/API', event: 'NETWORK_ONLINE', summary: 'Conexión recuperada' }); void flush(); });
  window.addEventListener('offline', () => record({ module: 'Network/API', severity: 'WARNING', event: 'NETWORK_OFFLINE', summary: 'Sin conexión; reportes en cola local' }));
  window.addEventListener('gueststar:diagnostic', (event) => record(event.detail || {}));
  window.addEventListener('gueststar:report-problem', () => void openReport());
  window.addEventListener('gueststar:mark-diagnostic', () => {
    if (state?.config?.diagnostics?.testerMode === true) void markFailure();
  });
  document.addEventListener('keydown', (event) => {
    if (event.metaKey && event.shiftKey && event.code === 'KeyD' && state?.config?.diagnostics?.testerMode === true) {
      event.preventDefault();
      void markFailure();
    }
  });

  $('#diagnosticReportButton')?.addEventListener('click', () => void openReport());
  $('#diagnosticMarkNow')?.addEventListener('click', () => void markFailure());
  $('#diagnosticExport')?.addEventListener('click', () => void exportDiagnostics());
  $('#closeDiagnosticReport')?.addEventListener('click', () => dialog?.close());
  $('#diagnosticCopyReport')?.addEventListener('click', () => void copyReport());
  $('#diagnosticSaveReport')?.addEventListener('click', () => void saveReport());
  $('#diagnosticSendReport')?.addEventListener('click', () => void sendReport());

  return {
    record,
    setHealth,
    sync,
    openReport,
    markFailure,
    snapshot: clientSnapshot,
    reportPlayerHealth,
    refresh: refreshServerState,
    modules: MODULES
  };
}
