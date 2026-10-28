import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const testerRoles = ['tester', 'developer', 'superhost'];
const reportRoles = ['host', ...testerRoles];
export function diagnosticError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

// A fresh backend identity is required; cached role flags never grant access.
export async function diagnosticServiceRequest(config, action, extra = {}, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!config.authToken || !config.deviceToken || !config.deviceId) {
    throw diagnosticError('Inicia sesión en Guest Star.', 'UNAUTHORIZED', 401);
  }
  let response;
  try {
    response = await fetchImpl(config.appsScriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...extra, action, authToken: config.authToken, deviceToken: config.deviceToken }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw diagnosticError(
      ['TimeoutError', 'AbortError'].includes(error.name) ? 'El servicio no respondió a tiempo.' : `No se pudo conectar con Guest Star: ${error.message}`,
      ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK_ERROR', 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const code = data?.code || `HTTP_${response.status}`;
    const reason = data?.error || ({
      UNAUTHORIZED: 'La sesión expiró. Inicia sesión de nuevo.',
      FORBIDDEN: 'Tu cuenta no tiene permiso.',
      DEVICE_REVOKED: 'El Superhost revocó este Mac.',
      D1_ACTION_NOT_IMPLEMENTED: 'El backend de Guest Star no implementa el envío de reportes técnicos (D1_ACTION_NOT_IMPLEMENTED).'
    })[code] || code || 'El servicio no confirmó la sesión.';
    throw diagnosticError(reason, code, response.status === 401 || code === 'UNAUTHORIZED' ? 401 : response.status === 403 || ['FORBIDDEN', 'DEVICE_REVOKED'].includes(code) ? 403 : 502);
  }
  return data;
}

export async function verifyDiagnosticIdentity(config, tester = false, options) {
  const data = await diagnosticServiceRequest(config, 'me', {}, options);
  if (!(tester ? testerRoles : reportRoles).includes(data.user?.role)) {
    throw diagnosticError(tester ? 'Tu rol no tiene permiso para el Modo Tester.' : 'Tu rol no puede enviar reportes técnicos.', 'FORBIDDEN', 403);
  }
  return data.user;
}

export async function createDiagnosticPreferences({ path, initial = {}, getConfig, verify = verifyDiagnosticIdentity }) {
  let saved = {
    autoSendTechnicalErrors: initial.autoSendTechnicalErrors === true,
    autoSendDeliveryConfirmed: false,
    testerMode: initial.testerMode === true,
    revision: 0
  };
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    saved = {
      autoSendTechnicalErrors: value.autoSendTechnicalErrors === true,
      autoSendDeliveryConfirmed: value.autoSendDeliveryConfirmed === true,
      testerMode: value.testerMode === true,
      revision: Number(value.revision) || 0
    };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let busy = false;
  const view = () => ({
      autoSendTechnicalErrors: saved.autoSendTechnicalErrors === true && saved.autoSendDeliveryConfirmed === true,
      testerMode: saved.testerMode === true,
      revision: saved.revision
    });
  return {
    view,
    async update(patch) {
      if (busy) throw diagnosticError('Hay otra validación en curso. Espera a que termine.', 'BUSY', 409);
      if (!patch || Object.keys(patch).length !== 1 || !['testerMode', 'autoSendTechnicalErrors'].includes(Object.keys(patch)[0]) || typeof Object.values(patch)[0] !== 'boolean') {
        throw diagnosticError('Configuración de diagnóstico inválida.', 'INVALID_PREFERENCE');
      }
      busy = true;
      try {
        const [key, value] = Object.entries(patch)[0];
        const session = getConfig();
        if (value) {
          await verify(session, key === 'testerMode');
          const current = getConfig();
          if (current.authToken !== session.authToken || current.deviceToken !== session.deviceToken || current.deviceId !== session.deviceId) {
            throw diagnosticError('La sesión cambió durante la validación. Vuelve a intentarlo.', 'SESSION_CHANGED', 401);
          }
        }
        const next = {
          ...saved,
          [key]: value,
          ...(key === 'autoSendTechnicalErrors' ? { autoSendDeliveryConfirmed: value } : {}),
          revision: saved.revision + 1
        };
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        saved = next;
        return view();
      } finally { busy = false; }
    }
  };
}
