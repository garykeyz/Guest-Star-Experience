export function reconcileLocalAvailability(previous = new Map(), entries = []) {
  const next = new Map();
  const becameMissing = [];

  for (const entry of entries) {
    const id = String(entry?.id || "");
    if (!id) continue;
    const available = Boolean(entry.available);
    if (previous.get(id) === true && !available) becameMissing.push(id);
    next.set(id, available);
  }

  return { next, becameMissing };
}
