export function automaticStarScreenDisplay(displays = [], configuredDisplayId = '') {
  const normalized = (Array.isArray(displays) ? displays : []).map((display) => ({
    ...display,
    id: String(display?.displayId || display?.uuid || '')
  })).filter((display) => display.id);
  const configured = String(configuredDisplayId || '');
  const saved = normalized.find((display) => display.id === configured);
  if (saved) return { displayId: saved.id, automatic: false, external: saved.primary !== true };
  const external = normalized.find((display) => display.primary !== true);
  return external
    ? { displayId: external.id, automatic: true, external: true }
    : { displayId: '', automatic: true, external: false };
}
