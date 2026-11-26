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

// "1342.5", "22:10" or "00:22:10" -> seconds
export function lengthOf(v) {
  if (v == null) return 0;
  const t = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t));
  const p = t.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return Math.round(p.reduce((a, x) => a * 60 + x, 0));
}

const VIDEO = /\.(mp4|m4v|webm|ogv|mkv|avi|mpe?g|mov|wmv|flv|ts|vob)$/i;
const PLAYABLE = /\.(mp4|m4v)$/i; // H.264 MP4 plays everywhere, Tizen 2017 included
const score = f => (PLAYABLE.test(f.name) ? 1000 : /\.webm$/i.test(f.name) ? 100 : 0) + (/h\.?264|mpeg4/i.test(f.format || '') ? 200 : 0) +
  (f.source === 'derivative' ? 20 : 0) - Math.abs((+f.height || 480) - 480) / 10 - (f.private === 'true' ? 1e6 : 0);

// Every separate video in an item (a season upload holds many episodes), each mapped to its
// best browser-playable copy: the original if it is an H.264 MP4, otherwise Archive's MP4 derivative.
export function playableFiles(meta) {
  const files = (meta?.files || []).filter(f => VIDEO.test(f.name) && f.private !== 'true' && !/\.(sample|trailer)\./i.test(f.name));
  const groups = new Map();
  for (const f of files) {
    const root = f.source === 'derivative' && f.original && VIDEO.test(f.original) ? f.original : f.name;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(f);
  }
  const out = [];
  for (const [root, list] of groups) {
    const best = list.filter(f => PLAYABLE.test(f.name) || /\.webm$/i.test(f.name)).sort((a, b) => score(b) - score(a))[0];
    if (!best) continue; // e.g. an AVI with no MP4 derivative: older TVs can't play it
    const orig = list.find(f => f.name === root) || best;
    out.push({ name: best.name, root, title: orig.title || best.title || '', length: lengthOf(best.length || orig.length),
      height: +best.height || +orig.height || 0, width: +best.width || 0, format: best.format || '', size: +best.size || 0 });
  }
  return out.sort((a, b) => a.root.localeCompare(b.root, 'en', { numeric: true }));
}

// The single best file (kept for older callers and tests).
export function bestFile(meta) {
  const f = (meta?.files || []).filter(f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name)).sort((a, b) => score(b) - score(a));
  return f[0] || null;
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

const dl = (id, name) => `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;
const yearOf = v => { const m = String(v || '').match(/(19[3-9]\d|20[0-3]\d)/); return m ? +m[1] : null; };

function itemInfo(id, meta) {
  const m = meta.metadata || {};
  const auth = authorizationOf(meta);
  return {
    item_title: [].concat(m.title || id)[0],
    recorded: yearOf(m.date) || yearOf(m.year) || null,          // when it was made or aired
    uploaded: String(m.publicdate || m.addeddate || '').slice(0, 10) || null, // when it reached the Archive
    authorization: auth.authorization, auth_note: auth.note, uploader: 'Internet Archive',
    language: [].concat(m.language || [])[0] || '', subjects: [].concat(m.subject || []).join('; ').slice(0, 300)
  };
}

// Whole item: every playable video in it.
const seenThisRun = new Map();
export async function inspect(id) {
  if (seenThisRun.has(id)) return seenThisRun.get(id);
  const out = await inspectNow(id);
  if (out.ok || !['budget', 'network'].includes(out.code)) seenThisRun.set(id, out);
  return out;
}
async function inspectNow(id) {
  const r = await metadata(id);
  if (r.error) return { ok: false, permanent: !r.temporary, code: r.error };
  const meta = r.data;
  if (meta.is_dark || meta.metadata?.access_restricted_item === 'true') return { ok: false, permanent: true, code: 'restricted' };
  const files = playableFiles(meta);
  if (!files.length) return { ok: false, permanent: true, code: 'no-playable-file' };
  return { ok: true, info: itemInfo(id, meta), files };
}

// ref is "identifier" (older entries) or "identifier/filename". If the file was renamed or
// re-derived, the same original's new MP4 (or a lone remaining video) is picked up instead.
export async function check(ref) {
  const slash = ref.indexOf('/');
  const id = slash < 0 ? ref : ref.slice(0, slash), want = slash < 0 ? '' : ref.slice(slash + 1);
  const it = await inspect(id);
  if (!it.ok) return it;
  let f = want ? it.files.find(x => x.name === want) : it.files[0];
  let moved = false;
  if (!f && want) {
    const stem = want.replace(/\.[^.]+$/, '').replace(/\.(ia|h264|512kb|mp4)$/i, '').toLowerCase();
    f = it.files.find(x => x.root.replace(/\.[^.]+$/, '').toLowerCase() === stem || x.name.toLowerCase().startsWith(stem)) || (it.files.length === 1 ? it.files[0] : null);
    if (!f) return { ok: false, permanent: true, code: 'file-gone' };
    moved = true;
  }
  return {
    ok: true, code: moved ? 'ok-moved' : 'ok', file: f.name, ref: id + '/' + f.name, url: dl(id, f.name),
    duration: f.length, quality: f.height ? String(f.height) : '', title: f.title || it.info.item_title,
    year: it.info.recorded, ...it.info
  };
}

// Free full-text search, paged so we go past the first page. Cached for two weeks.
export async function search(query, rows = 200) {
  return cached('ia:search2:' + query + ':' + rows, 24 * 14, async () => {
    const out = [], per = Math.min(rows, 500);
    for (let page = 1; out.length < rows; page++) {
      await rateLimit('archive');
      const qs = new URLSearchParams({ q: `(${query}) AND mediatype:movies`, output: 'json', rows: String(per), page: String(page) });
      for (const f of ['identifier', 'title', 'date', 'year', 'collection', 'publicdate']) qs.append('fl[]', f);
      qs.append('sort[]', 'downloads desc');
      const res = await http('https://archive.org/advancedsearch.php?' + qs, {}, { timeout: 30000 });
      record('archive', 1);
      if (!res.ok) return out.length ? out : null;
      const j = await res.json().catch(() => null);
      const docs = j?.response?.docs || [];
      for (const d of docs) out.push({ id: d.identifier, title: [].concat(d.title || d.identifier)[0], year: yearOf(d.date) || yearOf(d.year) });
      if (docs.length < per || out.length >= (j?.response?.numFound || 0)) break;
    }
    return out.slice(0, rows);
  });
}
