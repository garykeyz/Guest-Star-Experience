export function normalizeBrandImageUrl(value) {
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

