// Self-healing maintenance: cheap deterministic link checks in batches,
// exponential backoff, temporary vs permanent failures, and replacement search
// only for episodes that have run out of working copies.
import { nowIso, log, hash } from './util.mjs';
import * as yt from './providers/youtube.mjs';
import * as ia from './providers/archive.mjs';
import * as direct from './providers/direct.mjs';
import { config, canSpend } from './budget.mjs';
import { parseEpisode, normalize } from './titles.mjs';

const H = 3600e3, D = 24 * H;
const at = ms => new Date(ms).toISOString();

export function isPublishable(s, now = Date.now()) {
  if (s.status === 'ok') return true;
  // a brief outage shouldn't pull an episode off the air
  return s.status === 'temp_fail' && s.last_ok && now - Date.parse(s.last_ok) < 3 * D;
}

export function applyResult(s, r, origin = 'batch', now = Date.now()) {
  s.last_try = at(now);
  s.history = [{ at: s.last_try, ok: !!r.ok, code: r.code, origin }, ...(s.history || [])].slice(0, 5);
  const jitter = (parseInt(hash(s.id), 36) % 360) * 60e3; // spreads checks out deterministically
  if (r.ok) {
    s.status = 'ok';
    s.last_ok = s.last_try; s.fail_count = 0; s.last_error = '';
    s.reliability = +(0.8 * (s.reliability ?? 0.5) + 0.2).toFixed(3);
    if (r.duration) s.duration = r.duration;
    if (r.quality) s.quality = r.quality;
    if (r.regions !== undefined) s.regions = r.regions;
    if (r.url) s.url = r.url;
    if (r.live) s.kind = 'live';
    s.embeddable = true;
    const days = s.kind === 'live' ? 1 : s.authorization === 'official' || s.authorization === 'public_domain' ? 14 : 7;
    s.next_check = at(now + days * D + jitter);
    return s;
  }
  s.fail_count = (s.fail_count || 0) + 1;
  s.last_error = r.code;
  s.reliability = +((s.reliability ?? 0.5) * 0.8).toFixed(3);
  if (r.permanent) {
    if (String(r.code).startsWith('blocked-')) { s.status = 'blocked_region'; s.regions = r.regions || s.regions; s.next_check = at(now + 30 * D + jitter); }
    else if (r.code === 'not-embeddable' || r.code === 'age-restricted') { s.status = 'not_embeddable'; s.next_check = at(now + 30 * D + jitter); }
    else if (s.status === 'suspect' || s.status === 'dead') {
      // confirmed twice: dead. Re-try a dead link at most twice more, a month apart, then never.
      s.status = 'dead';
      s.dead_checks = (s.dead_checks || 0) + 1;
      s.next_check = s.dead_checks >= 3 ? null : at(now + 30 * D + jitter);
    } else { s.status = 'suspect'; s.next_check = at(now + 1 * D); } // one bad answer could be a glitch
  } else {
    s.status = 'temp_fail';
    s.next_check = at(now + Math.min(7 * D, H * 2 ** (s.fail_count - 1)) + (jitter % H));
  }
  return s;
}

// Which sources to check this run, most useful first.
export function dueSources(lib, limit, now = Date.now()) {
  const working = new Map();
  for (const s of Object.values(lib.d.sources)) if (isPublishable(s, now)) working.set(s.episode, (working.get(s.episode) || 0) + 1);
  return Object.values(lib.d.sources)
    .filter(s => s.status === 'pending' || (s.next_check && Date.parse(s.next_check) <= now))
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) ||
      (working.get(a.episode) || 0) - (working.get(b.episode) || 0) ||
      String(a.last_try || '').localeCompare(String(b.last_try || '')))
    .slice(0, limit);
}

export async function checkSources(list, origin = 'batch') {
  const counts = { ok: 0, fail: 0 };
  const ytList = list.filter(s => s.provider === 'youtube');
  if (ytList.length) {
    const res = await yt.checkMany(ytList.map(s => s.ref), { essential: true });
    for (const s of ytList) { const r = res.get(s.ref); if (r.code === 'budget') continue; applyResult(s, r, origin); r.ok ? counts.ok++ : counts.fail++; }
  }
  for (const s of list.filter(s => s.provider !== 'youtube')) {
    const r = s.provider === 'archive' ? await ia.check(s.ref) : await direct.check(s.url || s.ref, s.kind);
    if (r.code === 'budget') continue;
    applyResult(s, r, origin);
    r.ok ? counts.ok++ : counts.fail++;
  }
  return counts;
}

export async function runChecks(lib, { all = false } = {}) {
  // "all": check every link now, not only the ones due (a full health check)
  const list = all ? dueSources(lib, 1e6, Date.now() + 400 * 86400e3) : dueSources(lib, config.check_batch_size ?? 4000);
  log(`checking ${list.length} due sources`);
  const c = await checkSources(list);
  log(`checks: ${c.ok} ok, ${c.fail} failed`);
  return { checked: list.length, ...c };
}

// Episodes that once worked but have no working copy now.
export function orphans(lib, now = Date.now()) {
  const byEp = new Map();
  for (const s of Object.values(lib.d.sources)) {
    const e = byEp.get(s.episode) || { ok: 0, ever: false };
    if (isPublishable(s, now)) e.ok++;
    if (s.last_ok) e.ever = true;
    byEp.set(s.episode, e);
  }
  return [...byEp].filter(([, v]) => v.ok === 0 && v.ever).map(([id]) => lib.d.episodes[id]).filter(Boolean);
}

// Step 1: re-check every alternative now. Step 2: only if still nothing, search.
export async function heal(lib, { maxSearches = 20 } = {}) {
  const lost = orphans(lib);
  if (!lost.length) return { orphans: 0, replaced: 0 };
  log(`${lost.length} episodes have no working copy`);
  const alts = lost.flatMap(e => lib.sourcesOf(e.id).filter(s => s.next_check !== null && s.status !== 'dead'));
  await checkSources(alts, 'heal');
  let replaced = 0, searches = 0;
  for (const e of orphans(lib)) {
    if (searches >= maxSearches || !canSpend('youtube', 100)) break;
    const ser = lib.d.series[e.series];
    if (!ser) continue;
    const name = ser.titles.en || ser.titles.ar || ser.titles.ja;
    const q = e.episode ? `${name} ${e.season ? `season ${e.season} ` : ''}episode ${e.episode}` : `${name} ${e.titles.en || e.titles.ar || ''}`;
    searches++;
    const ids = await yt.search(q, { maxResults: 15, duration: e.duration > 1200 ? 'long' : 'medium' });
    if (!ids?.length) continue;
    const res = await yt.checkMany(ids.filter(id => !lib.d.sources['youtube:' + id]), { essential: false });
    for (const [id, r] of res) {
      if (!r.ok) continue;
      const pe = parseEpisode(r.title);
      const sameShow = normalize(r.title).includes(normalize(name).split(' ').slice(0, 3).join(' '));
      const sameEp = e.episode ? pe.episode === e.episode && (!e.season || !pe.season || pe.season === e.season) : true;
      const closeLength = !e.duration || !r.duration || Math.abs(r.duration - e.duration) < Math.max(120, e.duration * 0.15);
      if (sameShow && sameEp && closeLength) {
        const s = lib.addSource(e.id, { provider: 'youtube', ref: id, kind: r.live ? 'live' : 'embed', authorization: 'unknown', uploader: r.uploader, duration: r.duration, quality: r.quality });
        applyResult(s, r, 'replacement');
        replaced++;
        break;
      }
    }
  }
  log(`healing: ${replaced} replacements found with ${searches} searches`);
  return { orphans: lost.length, replaced, searches, at: nowIso() };
}
