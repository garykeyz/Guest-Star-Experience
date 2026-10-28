// Only server-confirmed values may be rendered as active.
export function bindDiagnosticPreferences({ controls, status, request, apply, onError = () => {} }) {
  let confirmed = { autoSendTechnicalErrors: false, testerMode: false, revision: -1 };
  let busy = false;
  function render() {
    for (const [key, input] of Object.entries(controls)) {
      if (!input) continue;
      input.checked = confirmed[key] === true;
      input.disabled = busy;
      input.setAttribute('aria-busy', String(busy));
    }
    apply({ ...confirmed });
  }
  function sync(value) {
    if (busy) return;
    if ((Number(value?.revision) || 0) < confirmed.revision) return;
    confirmed = { ...value, revision: Number(value?.revision) || 0 };
    render();
  }
  for (const [key, input] of Object.entries(controls)) {
    input?.addEventListener('change', async () => {
      if (busy) { render(); return; }
      const desired = input.checked;
      busy = true;
      render();
      status.textContent = 'Validando y guardando…';
      try {
        const result = await request({ [key]: desired });
        if (result?.ok !== true || typeof result.preferences?.[key] !== 'boolean' || result.preferences[key] !== desired) {
          throw new Error(result?.error || 'El servidor no confirmó el cambio.');
        }
        confirmed = result.preferences;
        status.textContent = desired ? 'Activado y guardado.' : 'Desactivado y guardado.';
      } catch (error) {
        status.textContent = `No se pudo cambiar: ${error.message}${error.code ? ` (${error.code})` : ''}`;
        onError(error);
      } finally {
        busy = false;
        render();
      }
    });
  }
  render();
  return { sync };
}

export async function diagnosticPreferenceRequest(patch) {
  let response;
  try {
    response = await fetch('/api/diagnostics/preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw Object.assign(new Error(['TimeoutError', 'AbortError'].includes(error.name)
      ? 'No llegó la confirmación. El estado se comprobará al reconectar.'
      : `No se pudo conectar con la aplicación: ${error.message}`), { code: error.name });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw Object.assign(new Error(data?.error || `Respuesta inválida del servidor (HTTP ${response.status}).`), { code: data?.code || `HTTP_${response.status}`, status: response.status });
  return data;
}
