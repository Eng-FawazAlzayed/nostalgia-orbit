// Internet Archive: free, no key. Only items whose licence or collection says
// they may be reused are accepted (public domain, Creative Commons, Prelinger).
import { http } from '../util.mjs';
import { record, cached, rateLimit, canSpend } from '../budget.mjs';

const PD_COLLECTIONS = new Set(['prelinger', 'publicdomain', 'animationandcartoons', 'classic_cartoons', 'feature_films', 'nasa', 'ephemera', 'pdpics', 'opensource_movies', 'computerchronicles', 'tvarchive_pd']);

export function authorizationOf(meta) {
  const m = meta?.metadata || {};
  const lic = String(m.licenseurl || '').toLowerCase();
  const cols = [].concat(m.collection || []).map(String);
  if (lic.includes('publicdomain') || lic.includes('/zero/')) return { authorization: 'public_domain', note: lic };
  if (lic.includes('creativecommons.org/licenses/')) return { authorization: 'licensed', note: lic };
  const pd = cols.find(c => PD_COLLECTIONS.has(c));
  if (pd) return { authorization: 'public_domain', note: 'collection:' + pd };
  return { authorization: 'unknown', note: '' };
}

// Pick the best browser-playable file: MP4 (h.264) first, then WebM/OGV as last resort.
export function bestFile(meta) {
  const files = (meta?.files || []).filter(f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name));
  const score = f => (/\.mp4$|\.m4v$/i.test(f.name) ? 1000 : 0) + (/h\.?264|mpeg4/i.test(f.format || '') ? 200 : 0) +
    (f.source === 'derivative' ? 50 : 0) - Math.abs((+f.height || 480) - 480) / 10;
  files.sort((a, b) => score(b) - score(a));
  return files[0] || null;
}

export async function metadata(id) {
  if (!canSpend('archive', 1)) return { error: 'budget' };
  await rateLimit('archive');
  const res = await http('https://archive.org/metadata/' + encodeURIComponent(id), {}, { timeout: 20000 });
  record('archive', 1);
  if (!res.ok) return { error: res.status ? 'http' + res.status : 'network', temporary: !res.status || res.status >= 500 };
  const j = await res.json().catch(() => null);
  if (!j || !j.metadata) return { error: 'removed', temporary: false };
  return { data: j };
}

export async function check(id) {
  const r = await metadata(id);
  if (r.error) return { ok: false, permanent: !r.temporary, code: r.error };
  const meta = r.data;
  if (meta.is_dark || meta.metadata?.access_restricted_item === 'true') return { ok: false, permanent: true, code: 'restricted' };
  const f = bestFile(meta);
  if (!f) return { ok: false, permanent: true, code: 'no-playable-file' };
  const auth = authorizationOf(meta);
  return {
    ok: true, code: 'ok', file: f.name, url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`,
    duration: Math.round(parseFloat(f.length) || 0), quality: f.height ? String(f.height) : '',
    title: [].concat(meta.metadata.title || id)[0], year: parseInt(meta.metadata.year || meta.metadata.date, 10) || null,
    authorization: auth.authorization, auth_note: auth.note, uploader: 'Internet Archive', language: [].concat(meta.metadata.language || [])[0] || ''
  };
}

// Free full-text search. Cached for two weeks.
export async function search(query, rows = 200) {
  return cached('ia:search:' + query + ':' + rows, 24 * 14, async () => {
    await rateLimit('archive');
    const qs = new URLSearchParams({ q: `(${query}) AND mediatype:movies`, output: 'json', rows: String(rows), 'fl[]': 'identifier' });
    qs.append('fl[]', 'title'); qs.append('sort[]', 'downloads desc');
    const res = await http('https://archive.org/advancedsearch.php?' + qs, {}, { timeout: 30000 });
    record('archive', 1);
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return (j?.response?.docs || []).map(d => ({ id: d.identifier, title: [].concat(d.title || d.identifier)[0] }));
  });
}
