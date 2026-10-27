import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeVdjPath } from './virtualdj.mjs';
import { brandingTheme } from '../public/shared/branding-theme.js';

const text = (value, max = 180) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const publicRow = (request = {}, fallback = {}) => ({
  singerName: text(request.singer || fallback.singer || 'Guest'),
  displaySongTitle: text(request.song || fallback.song || fallback.title || 'Karaoke'),
  displayArtist: text(request.artist || fallback.artist),
  publicMessage: text(request.comment, 280),
  language: text(request.languageCode || request.language, 30),
  metadataSource: request.id ? 'guest-star' : 'virtualdj'
});

// No spread of tenant/request/config records across the public boundary.
// IDs, canonical paths, room/email/phone/guestIdentity, credentials never leave.
export function projectVdjDisplay({ tenant = {}, activity = {}, mode = '', requests = [], entries = [], playback = {}, queued = [], finalizing = false, identify = () => null } = {}) {
  const branding = tenant.branding || {};
  const tokens = brandingTheme(branding);
  const bridge = mode === 'bridge';
  const byId = new Map(requests.filter(r => !r.outcome && !r.cleared && !['Ya cantó','Saltado','Eliminada'].includes(r.status)).map(r => [r.id,r]));
  const deck = bridge && playback.connected ? playback.decks?.find(d => d.loaded && d.playing) : null;
  let current = null;
  if (deck) {
    const identity = identify(deck.filePath);
    const request = byId.get(identity?.id);
    current = publicRow(request, deck);
  }
  const next = bridge ? entries.filter(e => {
    const r = requests.find(r => r.id === e.linkedRequestId);
    return !r?.outcome && !r?.cleared && !(deck && normalizeVdjPath(e.filePath) === normalizeVdjPath(deck.filePath));
  }).slice(0,5).map(e => publicRow(byId.get(e.linkedRequestId),e)) : [];
  const hasActivity = Boolean(activity.activityId && tenant.activity?.activityId === activity.activityId);
  const finished = hasActivity && Boolean(activity.activityFinishedAt && !activity.activityRunning);
  let state = !hasActivity ? 'NO ACTIVITY' : finalizing ? 'FINALIZING ACTIVITY' : finished ? 'ACTIVITY FINISHED' : current ? 'NOW SINGING' : !activity.activityRunning ? (activity.accepting ? 'REQUESTS OPEN' : 'ACTIVITY READY') : next.length ? 'BETWEEN SONGS' : activity.accepting ? 'WAITING FOR SINGER' : 'REQUESTS CLOSED';
  const access = tenant.kioskAccess;
  const scopedAccess = hasActivity && access?.status === 'active' && access.activityId === activity.activityId && access.hotelId === tenant.hotel?.hotelId && access.venueId === tenant.venue?.venueId;
  const requestUrl = scopedAccess ? safeUrl(access.joinUrl) : '';
  return {
    schemaVersion: 1, state, enabled: bridge, connected: playback.connected === true,
    activityName: hasActivity ? text(tenant.activity.name) : '',
    hotelName: text(tenant.hotel?.name), teamName: text(branding.teamDisplayName),
    requestsOpen: hasActivity && !finished && activity.accepting === true,
    theme: { primary: tokens['--gs-primary'], secondary: tokens['--gs-secondary'], accent: tokens['--gs-accent'] },
    logoUrl: branding.showHotelLogo === false ? '' : safeUrl(branding.hotelLogoUrl),
    teamLogoUrl: branding.showTeamIdentity === false ? '' : safeUrl(branding.teamLogoUrl),
    pin: scopedAccess && /^\d{6}$/.test(String(access.pin)) ? String(access.pin) : '',
    requestUrl, current: !finished && hasActivity ? current : null,
    next: !finished && hasActivity ? next : [],
    finalMessage: finished ? text(tenant.finalExperience?.message || branding.activityEndingMessage,280) : '',
  };
}

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && b===168) || (a===100 && b>=64 && b<=127));
  }
  // IPv6 literals/mapped addresses are intentionally unsupported for logo hosts.
  return false;
}
async function logoUrl(value) {
  let u = new URL(value);
  if (['drive.google.com','drive.usercontent.google.com','docs.google.com'].includes(u.hostname)) {
    const id = u.pathname.match(/\/(?:file\/)?d\/([\w-]{10,})/)?.[1] || u.searchParams.get('id');
    if (id && /^[\w-]{10,}$/.test(id)) u = new URL(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1000`);
  }
  return u;
}
export function createVdjOverlayHttp(getDisplay) {
  const cache = new Map();
  async function image(source) {
    const existing = cache.get(source);
    if (existing && Date.now()-existing.at < (existing.data ? 3600000 : 60000)) return existing;
    if (existing?.promise) return existing.promise;
    const promise = (async () => {
      try {
        let url = await logoUrl(source);
        let result;
        for (let i=0;i<4;i++) {
          if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port!=='443')) throw Error('Unsupported logo URL');
          const addresses = await lookup(url.hostname,{family:4,all:true});
          if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('Non-public logo host');
          result = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(4000)});
          if (result.status >= 300 && result.status < 400 && result.headers.get('location')) { await result.body?.cancel(); url=new URL(result.headers.get('location'),url); continue; }
          break;
        }
        const type = result.headers.get('content-type')?.split(';')[0];
        if (!result.ok || !['image/png','image/jpeg','image/webp'].includes(type)) throw Error('Unsupported logo');
        const chunks=[]; let size=0;
        for await (const chunk of result.body) { size+=chunk.length; if(size>2*1024*1024) throw Error('Logo too large'); chunks.push(chunk); }
        return {data:Buffer.concat(chunks),type,at:Date.now()};
      } catch { return {data:null,at:Date.now()}; }
    })();
    cache.set(source,{promise});
    const value = await promise;
    cache.set(source,value);
    while(cache.size>4) cache.delete(cache.keys().next().value);
    return value;
  }
  return async function(request,response,url) {
    if (!url.pathname.startsWith('/api/vdj/')) return false;
    const host = String(request.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) { response.writeHead(403);response.end();return true; }
    response.setHeader('Cache-Control','no-cache'); response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Cross-Origin-Resource-Policy','same-origin');
    if (request.method !== 'GET') { response.writeHead(405,{Allow:'GET'});response.end();return true; }
    const display = getDisplay();
    if (url.pathname === '/api/vdj/state') {
      const {logoUrl:hotel,teamLogoUrl:team,...data} = display;
      data.logo = hotel ? `/api/vdj/logo/hotel?v=${createHash('sha256').update(hotel).digest('hex').slice(0,16)}` : '';
      data.teamLogo = team ? `/api/vdj/logo/team?v=${createHash('sha256').update(team).digest('hex').slice(0,16)}` : '';
      const body = JSON.stringify(data);
      const etag = '"'+createHash('sha256').update(body).digest('hex')+'"';
      response.setHeader('ETag',etag);
      if(request.headers['if-none-match']===etag) {response.writeHead(304);response.end();}
      else {response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});response.end(body);}
      return true;
    }
    if (['/api/vdj/logo/hotel','/api/vdj/logo/team'].includes(url.pathname)) {
      const source = url.pathname.endsWith('/hotel') ? display.logoUrl : display.teamLogoUrl;
      const value = source ? await image(source) : null;
      if(value?.data) {response.writeHead(200,{'Content-Type':value.type});response.end(value.data);}
      else {response.writeHead(404);response.end();}
      return true;
    }
    response.writeHead(404);response.end();return true;
  };
}
