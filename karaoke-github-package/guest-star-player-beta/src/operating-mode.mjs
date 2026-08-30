export const OPERATING_MODE = Object.freeze({ PLAYER: 'player', BRIDGE: 'bridge' });

export const MODE_INFO = Object.freeze({
  [OPERATING_MODE.PLAYER]: Object.freeze({ productName: 'Guest Star Player', externalPlayer: false, description: 'Reproducción interna de archivos locales.' }),
  [OPERATING_MODE.BRIDGE]: Object.freeze({ productName: 'Guest Star Bridge', externalPlayer: true, description: 'Integración externa con VirtualDJ.' }),
});

export function resolveOperatingMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!MODE_INFO[mode]) throw new Error(`Modo Guest Star inválido: ${mode || 'vacío'}`);
  return MODE_INFO[mode];
}
