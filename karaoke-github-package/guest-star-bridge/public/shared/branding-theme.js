/** Existing Superhost branding -> shared visual tokens, for web and native surfaces. */
export function brandingTheme(branding = {}) {
  const read = (key, fallback) => /^#[\da-f]{6}$/i.test(String(branding[key] || '').trim()) ? String(branding[key]).trim() : fallback;
  const primary = read('primaryColor', '#ffffff');
  const secondary = read('secondaryColor', '#000000');
  const accent = read('accentColor', '#ffffff');
  const on = (hex) => {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    const luminance = .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#000000' : '#ffffff';
  };
  return { '--gs-primary': primary, '--gs-secondary': secondary, '--gs-accent': accent,
    '--gs-primary-ink': on(primary) === '#ffffff' ? '#ffffff' : primary, '--gs-secondary-ink': on(secondary) === '#ffffff' ? '#ffffff' : secondary, '--gs-accent-ink': on(accent) === '#ffffff' ? '#ffffff' : accent,
    '--gs-on-primary': on(primary), '--gs-on-secondary': on(secondary), '--gs-on-accent': on(accent),
    '--gs-background': '#1b1b1b', '--gs-surface': 'rgb(255 255 255 / .06)', '--gs-text': '#ffffff',
    '--p': primary, '--v': secondary, '--b': accent,
    '--star-primary': primary, '--star-secondary': secondary, '--star-accent': accent };
}
export function applyBrandingTheme(element, branding) {
  for (const [key, value] of Object.entries(brandingTheme(branding))) element.style.setProperty(key, value);
}
/** Keep failed or absent logos out of the layout; both slots have equal safe areas. */
export function renderBrandLogos(container, urls, normalize = value => value) {
  const signature = JSON.stringify(urls);
  if (container.dataset.brandLogos === signature) return;
  container.dataset.brandLogos = signature;
  container.replaceChildren();
  const updateFallback = () => { const fallback = container.nextElementSibling; if (fallback?.id?.endsWith('Fallback')) fallback.classList.toggle('hidden', !container.hidden); };
  for (const [index, url] of urls.entries()) {
    if (!url) continue;
    const image = document.createElement('img');
    image.alt = index === 0 ? 'Logo del hotel' : 'Logo del equipo';
    image.referrerPolicy = 'no-referrer'; image.hidden = true;
    image.addEventListener('load', () => { if(image.parentElement!==container)return; image.hidden = false; container.hidden = false; updateFallback(); });
    image.addEventListener('error', () => { if(image.parentElement!==container)return; image.remove(); container.hidden = !container.querySelector('img:not([hidden])'); updateFallback(); });
    image.src = normalize(String(url)); container.append(image);
  }
  container.hidden = true; updateFallback();
}
