// Presentation only. Existing buttons/labels/handlers are never replaced.
// Native title supplies the delayed hover tooltip, including real shortcut hints.
export function attachAdaptiveButtonLabels(doc = document) {
  const observers = [];
  const rules = [
    ['#playerPlay','play'], ['#playerRestart','restart'], ['#playerReturn','return'],
    ['#playerSkip','skip'], ['#playerComplete','complete'], ['#playerRemove','remove'],
    ['#playerMute','volume'], ['#playerShare','share'], ['#playerScan','library'],
    ['#playerSync','sync'], ['#playerSettings','settings'], ['#playerOpenStarScreen','display'],
    ['#playerTempoReset','reset'],
    ['#playerBackgroundTempoReset','reset'], ['#playerKeyReset','reset'],
    ['#playerEqReset','reset'], ['#playerKeyReanalyze','analyze'],
    ['#playerBackgroundToggle','play'], ['#playerBackgroundNext','next'],
    ['#playerLibraryBrowse','folder'], ['#playerBackgroundPlaySelected','play'],
    ['#playerTempoDown','decrease'], ['#playerTempoUp','increase'],
    ['#playerKeyDown','decrease'], ['#playerKeyUp','increase'],
    ['#playerBackgroundTempoDown','decrease'], ['#playerBackgroundTempoUp','increase'],
    ['#preferencesButton','settings']
  ];
  for (const [selector, fallbackIcon] of rules) {
    const button = doc.querySelector(selector);
    if (!button) continue;
    const originalName = button.getAttribute('aria-label');
    button.classList.add('console-icon');
    const sync = () => {
      const walker = doc.createTreeWalker(button, doc.defaultView.NodeFilter.SHOW_TEXT);
      const parts = []; let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement.closest('kbd, output, #playerHistoryBadge')) parts.push(node.textContent);
      }
      const rawText = originalName || parts.join(' ').trim();
      const text = rawText.replace(/^[\s▶⏸⏮↩↷✓×🔊🔇🔗📚↻⚙▣▥⏭📁−+]+/u, '').trim();
      if (!text) return;
      let icon = fallbackIcon;
      const normalized = rawText.toLocaleLowerCase();
      if (['playerPlay','playerBackgroundToggle'].includes(button.id) && /pause|paus|detener/.test(normalized)) icon = 'pause';
      if (button.id === 'playerMute' && /silenc|mute/.test(normalized)) icon = 'volume-off';
      button.dataset.adaptiveIcon = icon;
      if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
      const shortcut = button.querySelector('kbd')?.textContent.trim();
      const title = shortcut ? `${text} · ${shortcut}` : text;
      if (button.title !== title) button.title = title;
    };
    sync();
    const observer = new doc.defaultView.MutationObserver(sync);
    observer.observe(button, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-action'] });
    observers.push(observer);
  }
  const status = doc.getElementById('playerRequestsToggleLabel');
  const toggle = doc.getElementById('playerRequestsToggle');
  if (status && toggle) {
    const sync = () => {
      // Read the rendered status, not backend/activity state; do not set checked.
      const prefix = [...toggle.closest('label').childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
      const text = `${prefix} ${status.textContent.trim()}`;
      toggle.setAttribute('aria-label', text); toggle.closest('label').title = text;
    };
    sync();
    const observer = new doc.defaultView.MutationObserver(sync);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    observers.push(observer);
  }
  doc.querySelectorAll('#playerSummaryInline [data-summary-item]').forEach((item) => {
    const value = item.querySelector('strong');
    const detail = item.querySelector('p');
    if (!value || !detail) return;
    const sync = () => {
      const valueText = value.textContent.trim();
      const detailText = detail.textContent.trim();
      item.title = detailText ? `${valueText} · ${detailText}` : valueText;
      if (detail.id === 'playerCoverageDetail') detail.dataset.compactValue = detailText.match(/\d+%/)?.[0] || '';
    };
    sync();
    const observer = new doc.defaultView.MutationObserver(sync);
    observer.observe(item, { childList: true, characterData: true, subtree: true });
    observers.push(observer);
  });
  // The existing queue creates its popover after startup. Observe only its labels,
  // not queue data/state; the temporary body observer watches direct children.
  const attachOptions = () => {
    const options = doc.getElementById('playerQueueOptions');
    if (!options) return false;
    const sync = () => options.querySelectorAll('button[title]').forEach(button => {
      if (button.getAttribute('aria-label') !== button.title) button.setAttribute('aria-label', button.title);
    });
    sync();
    const observer = new doc.defaultView.MutationObserver(sync);
    observer.observe(options, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    observers.push(observer); return true;
  };
  if (!attachOptions()) {
    const observer = new doc.defaultView.MutationObserver(() => { if (attachOptions()) observer.disconnect(); });
    observer.observe(doc.body, { childList: true }); observers.push(observer);
  }
  return () => observers.forEach(observer => observer.disconnect());
}
if (typeof document !== 'undefined') attachAdaptiveButtonLabels();
