// One compact notification at a time; actionable feedback is never overwritten.
export function createQueueToast(host, { duration = 6500, timers = window } = {}) {
  let active = null, timer;
  const pending = [];
  const next = () => {
    timers.clearTimeout(timer);
    active = pending.shift() || null;
    host.replaceChildren();
    host.classList.toggle('hidden', !active);
    if (!active) return;
    const message = document.createElement('span');
    message.textContent = active.message;
    message.title = active.message;
    host.classList.toggle('error', active.error);
    host.append(message);
    if (active.action) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = active.action.label || 'Deshacer';
      action.addEventListener('click', async () => {
        action.disabled = true;
        timers.clearTimeout(timer);
        try { await active.action.run(); }
        catch (error) { pending.push({ message: error.message, error: true }); }
        finally { next(); }
      });
      host.append(action);
    }
    timer = timers.setTimeout(next, duration);
  };
  // Pause expiry while the operator is reading or using the action.
  const pause = () => timers.clearTimeout(timer);
  const resume = () => { if (active && !host.matches(':hover') && !host.contains(document.activeElement)) timer = timers.setTimeout(next, duration); };
  host.addEventListener('mouseenter', pause);
  host.addEventListener('mouseleave', resume);
  host.addEventListener('focusin', pause);
  host.addEventListener('focusout', resume);
  return (message, error = false, action = null) => {
    const item = { message: String(message), error, action };
    if (active?.action) {
      // Keep every Undo, but coalesce routine progress feedback.
      if (!action && !error) {
        const index = pending.findIndex(entry => !entry.action && !entry.error);
        if (index >= 0) pending.splice(index, 1);
      }
      pending.push(item);
    } else {
      pending.push(item);
      next();
    }
  };
}
