// Merge duplicate shows inside a channel.
//
// The archive importers name a series after its folder, so the same show can arrive twice
// ("سالي" from two collections, "عدنان" vs "عدنان ولينا"). Identical titles are merged: the
// series with more episodes wins, the other one's episodes and sources move across, and the
// empty series is dropped. Bumper/fill series are left alone — those are separate clips.
//
// node src/cli.mjs dedupe            → report only
// node src/cli.mjs dedupe --apply    → merge and save
import { nowIso } from './util.mjs';

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')     // harakat and tatweel
    .replace(/[إأآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FFa-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function dedupe(lib, { apply = false, log = console.log } = {}) {
  const d = lib.d;
  const groups = new Map();
  for (const [sid, s] of Object.entries(d.series)) {
    if (s.fill) continue;
    const t = s.titles || {};
    const key = norm(t.ar || t.en || '');
    if (!key || key.length < 3) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sid);
  }

  const epsOf = (sid) => Object.values(d.episodes).filter((e) => e.series === sid);
  let merged = 0, moved = 0;
  const report = [];

  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => epsOf(b).length - epsOf(a).length);
    const keep = ids[0];
    for (const loser of ids.slice(1)) {
      const keepEps = epsOf(keep);
      const taken = new Set(keepEps.map((e) => `${e.season || 0}:${e.episode || 0}`));
      let nextFree = Math.max(0, ...keepEps.map((e) => e.episode || 0)) + 1;
      for (const e of epsOf(loser)) {
        let sn = e.season || 0, ep = e.episode || 0;
        if (taken.has(`${sn}:${ep}`)) { ep = nextFree++; }
        taken.add(`${sn}:${ep}`);
        e.series = keep; e.season = sn; e.episode = ep;
        moved++;
      }
      // keep the channel memberships of both
      const a = d.series[keep].channels || {}, b = d.series[loser].channels || {};
      for (const ch of Object.keys(b)) {
        const have = new Set(a[ch] || []);
        for (const tag of b[ch] || []) have.add(tag);
        a[ch] = [...have];
      }
      d.series[keep].channels = a;
      delete d.series[loser];
      merged++;
      report.push(`${d.series[keep].titles.ar || d.series[keep].titles.en || keep} ← ${d.series[keep].titles.ar || loser}`);
      log('dedupe: merged “' + key + '” (' + epsOf(keep).length + ' episodes now)');
    }
  }

  if (apply) {
    // episodes whose series vanished (shouldn't happen, but be safe)
    for (const [id, e] of Object.entries(d.episodes)) if (!d.series[e.series]) delete d.episodes[id];
    d.updated = nowIso();
    lib.save();
  }
  log('dedupe: ' + merged + ' duplicate shows merged, ' + moved + ' episodes moved' + (apply ? ' (saved)' : ' (dry run)'));
  return { merged, moved, report };
}
