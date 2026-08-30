import { setLocalQrImage } from './qr-ui.js';

const $ = (selector) => document.querySelector(selector);
const channel = new BroadcastChannel('guest-star-player');
const video = $('#starScreenMedia');
const preview = new URLSearchParams(location.search).get('preview') === '1';
let lastState = null;
let lastSequence = -1;
let lastPublishedAt = 0;
let videoCleanupTimer = 0;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function guest(item) {
  return [item?.singer, item?.guestAlias].filter(Boolean).join(' ') || 'Próximo cantante';
}

function normalizeBrandImageUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (!['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase())) return source;
    const match = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})(?:\/|$)/);
    const id = match?.[1] || url.searchParams.get('id') || '';
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return source;
    const thumbnail = new URL('https://drive.google.com/thumbnail');
    thumbnail.searchParams.set('id', id); thumbnail.searchParams.set('sz', 'w1000');
    const resourceKey = url.searchParams.get('resourcekey');
    if (resourceKey) thumbnail.searchParams.set('resourcekey', resourceKey);
    return thumbnail.toString();
  } catch { return source; }
}

function expectedPlaybackTime(next) {
  const base = Math.max(0, Number(next?.currentTime) || 0);
  if (!next?.playing) return base;
  const publishedAt = Math.max(0, Number(next?.publishedAt) || 0);
  const elapsed = publishedAt ? Math.max(0, (Date.now() - publishedAt) / 1000) : 0;
  const duration = Math.max(0, Number(next?.duration) || 0);
  return duration ? Math.min(duration, base + elapsed) : base + elapsed;
}

function syncVideo(next) {
  const karaokeMode = next?.displayMode === 'karaoke';
  const hasVideo = Boolean(next?.now?.isVideo && next?.mediaUrl);
  const shouldShowVideo = Boolean(karaokeMode && hasVideo);
  const fadeMs = Math.max(250, Number(next?.scene?.fadeMs) || 760);
  window.clearTimeout(videoCleanupTimer);
  document.body.classList.toggle('star-screen-karaoke-active', karaokeMode);
  document.body.classList.toggle('star-screen-video-active', shouldShowVideo);
  if (!hasVideo) {
    video.pause();
    videoCleanupTimer = window.setTimeout(() => {
      if (lastState?.displayMode === 'karaoke' || lastState?.now?.isVideo) return;
      video.removeAttribute('src'); video.load();
    }, fadeMs + 120);
    return;
  }
  const expected = new URL(next.mediaUrl, location.origin).href;
  if (video.src !== expected) {
    video.src = next.mediaUrl;
    video.load();
  }
  const align = () => {
    if (!lastState || new URL(lastState.mediaUrl || '/', location.origin).href !== expected) return;
    const target = expectedPlaybackTime(lastState);
    const drift = target - (video.currentTime || 0);
    if (Math.abs(drift) > 0.35) {
      video.currentTime = target;
      video.playbackRate = 1;
    } else if (Math.abs(drift) > 0.045) {
      video.playbackRate = Math.max(0.97, Math.min(1.03, 1 + drift * 0.12));
    } else {
      video.playbackRate = 1;
    }
    if (shouldShowVideo && lastState.playing) {
      if (video.paused) video.play().catch(() => {});
    } else {
      video.playbackRate = 1;
      if (!video.paused) video.pause();
    }
  };
  if (video.readyState >= 1) align();
}

function render(next) {
  if (!next || next.type === 'request-state') return;
  const publishedAt = Math.max(0, Number(next.publishedAt) || 0);
  const sequence = Math.max(0, Number(next.sequence) || 0);
  if (publishedAt && publishedAt < lastPublishedAt) return;
  if (publishedAt && publishedAt === lastPublishedAt && sequence <= lastSequence) return;
  if (!publishedAt && lastPublishedAt && sequence <= lastSequence) return;
  if (publishedAt) lastPublishedAt = publishedAt;
  lastSequence = sequence;
  lastState = next;
  $('#starScreenHotel').textContent = next.hotelName || 'Guest Star';
  $('#starScreenActivity').textContent = next.activityName || 'Karaoke Night';
  const logo = $('#starScreenLogo'), fallback = $('#starScreenFallback');
  fallback.textContent = (next.hotelName || 'GS').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const logoUrl = normalizeBrandImageUrl(next.logoUrl);
  if (!logo.dataset.brandEvents) {
    logo.dataset.brandEvents = '1';
    logo.addEventListener('load', () => { logo.classList.remove('hidden'); fallback.classList.add('hidden'); });
    logo.addEventListener('error', () => { logo.classList.add('hidden'); fallback.classList.remove('hidden'); });
  }
  if (!logoUrl) { logo.classList.add('hidden'); fallback.classList.remove('hidden'); logo.removeAttribute('src'); logo.dataset.brandUrl = ''; }
  else if (logo.dataset.brandUrl !== logoUrl) { logo.dataset.brandUrl = logoUrl; logo.classList.add('hidden'); fallback.classList.remove('hidden'); logo.src = logoUrl; }
  const qr = $('#starScreenQr');
  try {
    if (next.publicUrl && qr.dataset.qrText !== next.publicUrl) setLocalQrImage(qr, next.publicUrl, 600);
    else if (!next.publicUrl) { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
  } catch { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
  document.body.classList.toggle('star-screen-no-qr', !next.publicUrl || !qr.src);

  const queue = next.queue || [];
  const upcoming = queue;
  $('#starScreenQueueCount').textContent = String(queue.length);
  $('#starScreenQueue').innerHTML = queue.length
    ? queue.slice(0, 5).map((item, index) => `<li><b>${String(index + 1).padStart(2, '0')}</b><div><strong>${escapeHtml(guest(item))}</strong><small>${escapeHtml(item.song)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ''}</small></div><span>EN FILA</span></li>`).join('')
    : '<li class="empty"><div><strong>¡Sé el primero en cantar!</strong><small>Escanea el QR para solicitar una canción.</small></div></li>';
  const background = next.background?.track || null;
  $('#starScreenNowSong').textContent = background?.song || 'Música de fondo';
  $('#starScreenNowSinger').textContent = background?.artist || 'Ambientación del hotel';
  $('#starScreenNextSinger').textContent = upcoming[0] ? guest(upcoming[0]) : 'Esperando solicitudes';
  $('#starScreenStatus').textContent = next.displayMode === 'karaoke' ? 'KARAOKE EN VIVO' : next.background?.playing ? 'MÚSICA AMBIENTAL' : 'STAR SCREEN';
  document.body.classList.toggle('star-screen-playing', Boolean(next.background?.playing));
  syncVideo(next);
}

if (preview) {
  document.body.classList.add('star-screen-preview');
  $('#starScreenFullscreen').hidden = true;
}
channel.addEventListener('message', (event) => render(event.data));
try { render(JSON.parse(localStorage.getItem('guest-star:player-state') || 'null')); } catch { /* Waiting for Player. */ }
channel.postMessage({ type: 'request-state' });
video.addEventListener('loadedmetadata', () => { if (lastState) syncVideo(lastState); });
window.setInterval(() => { if (lastState?.playing && !document.hidden) syncVideo(lastState); }, 200);
$('#starScreenFullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
