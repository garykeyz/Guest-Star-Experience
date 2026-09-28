// Queue presentation only: never receives media elements or transport commands.
export function reorderPlayerQueue(values, id, beforeId = null) {
  const order = [...new Set(values.map(String).filter(Boolean))];
  const source = String(id);
  if (!order.includes(source) || beforeId === source ||
      (beforeId !== null && !order.includes(String(beforeId)))) return { order, moved: false };
  const next = order.filter(value => value !== source);
  next.splice(beforeId === null ? next.length : next.indexOf(String(beforeId)), 0, source);
  return { order: next, moved: next.some((value, index) => value !== order[index]) };
}

export function queueStemLabel(stem) {
  if (!stem) return '';
  if (stem.ready || stem.status === 'ready') return stem.improving ? 'IA lista · mejora HQ' : 'IA lista';
  if (stem.status === 'failed') return 'IA no disponible';
  return `${Math.max(0, Math.min(100, Math.round(Number(stem.progress) || 0)))}% · IA preparando`;
}

export function attachPlayerQueueUI(list, { reorder, move, closeOptions }) {
  const doc = list.ownerDocument;
  const win = doc.defaultView;
  const options = doc.createElement('div');
  options.id = 'playerQueueOptions';
  options.className = 'player-queue-options';
  const nativePopover = typeof options.showPopover === 'function';
  if (nativePopover) options.setAttribute('popover', 'auto');
  options.setAttribute('role', 'dialog');
  options.setAttribute('aria-label', 'Opciones del turno');
  options.hidden = true;
  doc.body.append(options);
  const status = doc.createElement('div');
  status.className = 'player-queue-announcement';
  status.setAttribute('role', 'status');
  doc.body.append(status);
  let drag = null;
  let frame = 0;
  let anchorId = '';
  let optionsOpen = false;
  let suppressClick = false;

  const rows = () => [...list.querySelectorAll('[data-player-row]')];
  function dismissOptions() {
    const id = anchorId;
    closeOptions();
    rows().find(row => row.dataset.playerRow === id)?.querySelector('[data-player-expand]')?.focus({ preventScroll: true });
  }
  function positionOptions() {
    const row = rows().find(row => row.dataset.playerRow === anchorId);
    if (!row || !optionsOpen) return;
    const rect = row.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    const safe = Math.max(8, parseFloat(win.getComputedStyle(doc.documentElement).paddingLeft) || 0);
    const gap = 6;
    const viewportWidth = win.visualViewport?.width || win.innerWidth;
    const viewportHeight = win.visualViewport?.height || win.innerHeight;
    if (rect.bottom <= Math.max(bounds.top, safe) || rect.top >= Math.min(bounds.bottom, viewportHeight - safe)) { closeOptions(); return; }
    options.style.width = `${Math.min(bounds.width, viewportWidth - safe * 2)}px`;
    options.style.maxHeight = '';
    const desiredHeight = options.offsetHeight;
    const below = viewportHeight - safe - rect.bottom - gap;
    const above = rect.top - safe - gap;
    const openAbove = below < desiredHeight && above > below;
    const available = Math.max(0, openAbove ? above : below);
    options.style.maxHeight = `${Math.max(0, Math.min(desiredHeight, available))}px`;
    options.style.left = `${Math.max(safe, Math.min(rect.left, viewportWidth - options.offsetWidth - safe))}px`;
    options.style.top = `${openAbove ? Math.max(safe, rect.top - gap - options.offsetHeight) : Math.min(viewportHeight - safe - options.offsetHeight, rect.bottom + gap)}px`;
  }

  function paintDrag() {
    if (!drag?.started) return;
    const bounds = list.getBoundingClientRect();
    const candidates = rows().filter(row => row.dataset.playerRow !== drag.id);
    const target = candidates.find(row => drag.y < row.getBoundingClientRect().top + row.offsetHeight / 2);
    drag.beforeId = target?.dataset.playerRow ?? null;
    const last = candidates.at(-1);
    const top = target ? target.getBoundingClientRect().top : last ? last.getBoundingClientRect().bottom : bounds.top;
    drag.indicator.style.cssText = `left:${bounds.left + 5}px;top:${Math.max(bounds.top, Math.min(top, bounds.bottom)) - 1}px;width:${bounds.width - 10}px`;
    drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px,${drag.y - drag.offsetY}px)`;
    rows().forEach(row => row.classList.toggle('is-dragging', row.dataset.playerRow === drag.id));
  }

  function scrollDrag() {
    if (!drag?.started) return;
    const bounds = list.getBoundingClientRect();
    const delta = drag.y < bounds.top + 32 ? -8 : drag.y > bounds.bottom - 32 ? 8 : 0;
    if (delta) list.scrollTop += delta;
    paintDrag();
    frame = win.requestAnimationFrame(scrollDrag);
  }

  function finish(commit = false) {
    if (!drag) return;
    const ended = drag;
    drag = null;
    win.cancelAnimationFrame(frame);
    if (list.hasPointerCapture(ended.pointerId)) list.releasePointerCapture(ended.pointerId);
    ended.ghost?.remove();
    ended.indicator?.remove();
    rows().forEach(row => row.classList.remove('is-dragging'));
    if (ended.started) {
      suppressClick = true;
      win.setTimeout(() => { suppressClick = false; }, 0);
      const bounds = list.getBoundingClientRect();
      if (commit && ended.x >= bounds.left && ended.x <= bounds.right && ended.y >= bounds.top && ended.y <= bounds.bottom) {
        const positions = new Map(rows().map(row => [row.dataset.playerRow, row.getBoundingClientRect().top]));
        reorder(ended.id, ended.beforeId);
        if (!win.matchMedia('(prefers-reduced-motion: reduce)').matches) rows().forEach(row => {
          const previous = positions.get(row.dataset.playerRow);
          if (previous !== undefined) row.animate([
            { transform: `translateY(${previous - row.getBoundingClientRect().top}px)` },
            { transform: 'translateY(0)' }
          ], { duration: 180, easing: 'ease-out' });
        });
        status.textContent = 'Orden de la fila actualizado';
      }
      rows().find(row => row.dataset.playerRow === ended.id)?.querySelector('[data-player-drag]')?.focus({ preventScroll: true });
    }
  }

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-player-drag]');
    if (!handle || event.button !== 0 || !event.isPrimary) return;
    const row = handle.closest('[data-player-row]');
    const rect = row.getBoundingClientRect();
    drag = { id: row.dataset.playerRow, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    list.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5) {
      const row = rows().find(row => row.dataset.playerRow === drag.id);
      if (!row) { finish(); return; }
      closeOptions();
      drag.started = true;
      drag.ghost = row.cloneNode(true);
      drag.ghost.querySelector('.player-queue-details')?.remove();
      drag.ghost.classList.add('player-queue-drag-preview');
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.inert = true;
      drag.ghost.style.width = `${row.getBoundingClientRect().width}px`;
      drag.indicator = doc.createElement('div');
      drag.indicator.className = 'player-queue-drop-indicator';
      doc.body.append(drag.ghost, drag.indicator);
      frame = win.requestAnimationFrame(scrollDrag);
    }
    paintDrag();
  });
  list.addEventListener('pointerup', event => { if (event.pointerId === drag?.pointerId) finish(true); });
  list.addEventListener('pointercancel', () => finish());
  list.addEventListener('lostpointercapture', () => finish());
  win.addEventListener('blur', () => finish());
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(); }
    else if (event.key === 'Escape' && optionsOpen) { event.preventDefault(); dismissOptions(); }
  });
  list.addEventListener('keydown', event => {
    const handle = event.target.closest('[data-player-drag]');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const id = handle.dataset.playerDrag;
    move(id, event.key === 'ArrowUp' ? -1 : 1);
    rows().find(row => row.dataset.playerRow === id)?.querySelector('[data-player-drag]')?.focus({ preventScroll: true });
    status.textContent = 'Orden de la fila actualizado';
  });
  list.addEventListener('click', event => {
    if (suppressClick || event.target.closest('[data-player-drag]')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  options.addEventListener('click', event => { if (event.target.closest('[data-player-options-close]')) dismissOptions(); });
  options.addEventListener('toggle', event => {
    if (event.target === options && event.newState === 'closed' && anchorId) { optionsOpen = false; dismissOptions(); }
  });
  doc.addEventListener('click', event => {
    if (!nativePopover && optionsOpen && !options.contains(event.target) && !event.target.closest('[data-player-expand]')) dismissOptions();
  });
  doc.addEventListener('scroll', positionOptions, true);
  win.addEventListener('resize', positionOptions);

  return {
    options,
    refresh() {
      const row = list.querySelector('.player-queue-row.expanded');
      if (row && !list.getClientRects().length) { closeOptions(); return; }
      if (!row) {
        anchorId = '';
        if (nativePopover && optionsOpen) options.hidePopover();
        optionsOpen = false;
        options.hidden = true;
      } else {
        anchorId = row.dataset.playerRow;
        const focused = options.contains(doc.activeElement) ? [...doc.activeElement.attributes].filter(attr => attr.name.startsWith('data-player-')) : [];
        const details = row.querySelector('.player-queue-details');
        details.classList.remove('hidden');
        options.replaceChildren(details);
        const close = doc.createElement('button');
        close.type = 'button'; close.textContent = 'Cerrar ×'; close.dataset.playerOptionsClose = '';
        close.className = 'player-queue-options-close';
        options.prepend(close);
        options.hidden = false;
        if (!optionsOpen) {
          if (nativePopover) options.showPopover();
          optionsOpen = true;
          close.focus({ preventScroll: true });
        }
        positionOptions();
        if (focused.length) [...options.querySelectorAll('button')].find(button => focused.every(attr => button.getAttribute(attr.name) === attr.value))?.focus({ preventScroll: true });
      }
      if (drag && !rows().some(row => row.dataset.playerRow === drag.id)) finish();
      paintDrag();
    }
  };
}
