// Publish: compact catalog for the apps, stats for the dashboard, and the web
// version of the app. Only verified working sources are published.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, OUT, ROOT, readJSON, writeJSON, nowIso, log } from './util.mjs';
import { isPublishable } from './maintain.mjs';
import { usageSummary } from './budget.mjs';
import { matchShow } from './titles.mjs';

const P = { youtube: 'yt', archive: 'ia' };

export function compact(lib, channels, now = Date.now()) {
  const srcByEp = new Map();
  for (const s of Object.values(lib.d.sources)) {
    if (!isPublishable(s, now)) continue;
    const p = P[s.provider] || (s.kind === 'hls' || s.kind === 'live' ? 'hls' : 'mp4');
    const c = { p, r: s.ref, k: s.kind, a: s.authorization, rel: s.reliability };
    if (s.url && p !== 'yt') c.u = s.url;
    if (s.quality) c.q = s.quality;
    if (s.offset) c.o = s.offset;
    if (s.regions && (s.regions.a?.length || s.regions.b?.length)) c.reg = s.regions;
    (srcByEp.get(s.episode) || srcByEp.set(s.episode, []).get(s.episode)).push(c);
  }
  const episodes = [], usedSeries = new Set();
  for (const e of Object.values(lib.d.episodes)) {
    const src = srcByEp.get(e.id);
    if (!src) continue;
    const live = src.some(s => s.k === 'live');
    const d = live ? 0 : e.duration || Math.max(...Object.values(lib.d.sources).filter(s => s.episode === e.id).map(s => s.duration || 0));
    if (!live && !d) continue; // can't schedule something of unknown length
    const t = {}; if (e.titles.en) t.en = e.titles.en; if (e.titles.ar) t.ar = e.titles.ar; if (e.titles.ja) t.ja = e.titles.ja;
    episodes.push({ id: e.id, s: e.series, sn: e.season || undefined, ep: e.episode || undefined, t, d, src });
    usedSeries.add(e.series);
  }
  const series = {};
  for (const id of usedSeries) {
    const s = lib.d.series[id];
    const t = {}; for (const k of ['en', 'ar', 'ja']) if (s.titles[k]) t[k] = s.titles[k];
    series[id] = { t, y: s.year || undefined, ch: { ...s.channels }, fill: s.fill || undefined };
  }
  // Original run years (e.g. [2002, 2007]) for flashback nights, from show_years in seeds.json.
  const years = readJSON(path.join(DATA, 'seeds.json'), {}).show_years || {};
  const yNames = Object.keys(years);
  for (const s of Object.values(series)) {
    if (s.y || s.fill) continue;
    const hit = matchShow(s.t.en || '', yNames) || matchShow(s.t.ar || '', yNames);
    if (hit) s.y = years[hit];
  }
  collect(series, channels);
  return { v: 1, generated: nowIso(), channels, series, episodes };
}

// One show, many channels: a channel with "collect" also airs matching shows that were
// found for other channels (e.g. 104 Cartoon City takes Dexter's Lab from 002), without
// copying any records.
export function collect(series, channels) {
  const lists = readJSON(path.join(DATA, 'seeds.json'), {}).show_lists || {};
  for (const c of channels) {
    for (const g of [].concat(c.collect || [])) {
    const from = g.from === '*' ? null : new Set(g.from || []);
    const shows = [].concat(g.shows || [], ...[].concat(g.shows_ref || []).map(k => lists[k] || []));
    const notFrom = new Set(g.not_from || []);
    for (const s of Object.values(series)) {
      if (s.fill && !g.fill) continue;
      const owners = Object.keys(s.ch).filter(k => k !== c.id && !notFrom.has(k));
      if (!owners.length || (from && !owners.some(k => from.has(k)))) continue;
      if (!s.fill && shows.length && !(matchShow(s.t.en || '', shows) || matchShow(s.t.ar || '', shows) || matchShow(s.t.ja || '', shows))) continue;
      const cur = new Set(s.ch[c.id] || []); for (const t of g.tags || ['*all']) cur.add(t); s.ch[c.id] = [...cur];
    }
    }
  }
}

export function stats(lib, catalog, extra = {}) {
  const now = Date.now();
  const srcs = Object.values(lib.d.sources);
  const by = k => srcs.filter(s => s.status === k).length;
  const altEps = new Map();
  for (const s of srcs) if (isPublishable(s, now)) altEps.set(s.episode, (altEps.get(s.episode) || 0) + 1);
  const perChannel = catalog.channels.map(c => {
    const sids = Object.keys(catalog.series).filter(id => catalog.series[id].ch?.[c.id]);
    const eps = catalog.episodes.filter(e => sids.includes(e.s));
    return { id: c.id, n: c.n, name: c.name, work: c.work, series: sids.length, episodes: eps.length, hours: +(eps.reduce((a, e) => a + (e.d || 0), 0) / 3600).toFixed(1), live: eps.filter(e => !e.d).length };
  });
  const decade = {}, language = {};
  for (const e of Object.values(lib.d.episodes)) {
    if (!altEps.has(e.id)) continue;
    const y = e.year || lib.d.series[e.series]?.year;
    const k = y ? Math.floor(y / 10) * 10 + 's' : 'unknown'; decade[k] = (decade[k] || 0) + 1;
    const l = e.language || lib.d.series[e.series]?.language || 'unknown'; language[l] = (language[l] || 0) + 1;
  }
  return {
    generated: catalog.generated,
    totals: {
      channels: catalog.channels.length, series: Object.keys(catalog.series).length, episodes: catalog.episodes.length,
      sources_working: by('ok'), sources_broken: by('dead') + by('not_embeddable') + by('blocked_region'),
      sources_failing: by('temp_fail') + by('suspect'), sources_pending: by('pending'),
      episodes_with_alternatives: [...altEps.values()].filter(n => n > 1).length,
      library_episodes: Object.keys(lib.d.episodes).length
    },
    status_breakdown: Object.fromEntries(['ok', 'temp_fail', 'suspect', 'dead', 'not_embeddable', 'blocked_region', 'pending'].map(k => [k, by(k)])),
    channels: perChannel,
    gaps: perChannel.filter(c => c.hours < 24 && !c.live).map(c => ({ id: c.id, name: c.name, hours: c.hours })),
    decades: decade, languages: language,
    usage: usageSummary(),
    upcoming: srcs.filter(s => s.next_check).sort((a, b) => a.next_check.localeCompare(b.next_check)).slice(0, 1).map(s => s.next_check)[0] || null,
    ...extra
  };
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

// Writes public/ (served by GitHub Pages) and the bundled snapshot for app builds.
export function publish(lib, extra = {}) {
  const channels = readJSON(path.join(DATA, 'channels.json'), []);
  const catalog = compact(lib, channels);
  const st = stats(lib, catalog, extra);
  const clientDir = path.resolve(ROOT, '..', 'client');
  const shared = path.resolve(ROOT, '..', 'shared', 'schedule.js');
  fs.mkdirSync(OUT, { recursive: true });
  writeJSON(path.join(OUT, 'catalog.json'), catalog, false);
  writeJSON(path.join(OUT, 'stats.json'), st);
  // web app: same client, loads catalog.json on first start
  copyDir(clientDir, OUT);
  fs.copyFileSync(shared, path.join(OUT, 'schedule.js'));
  const pagesUrl = process.env.PAGES_URL || '';
  fs.writeFileSync(path.join(OUT, 'catalog.js'), `window.NO_CATALOG_URL=${JSON.stringify(pagesUrl ? pagesUrl + '/catalog.json' : 'catalog.json')};window.NO_CATALOG=null;\n`);
  copyDir(path.join(ROOT, 'dashboard'), path.join(OUT, 'admin'));
  // bundled snapshot for APK / Windows / Tizen builds
  const bundle = path.resolve(ROOT, '..', 'dist', 'bundle');
  copyDir(clientDir, bundle);
  fs.copyFileSync(shared, path.join(bundle, 'schedule.js'));
  fs.writeFileSync(path.join(bundle, 'catalog.js'),
    `window.NO_CATALOG_URL=${JSON.stringify(pagesUrl ? pagesUrl + '/catalog.json' : '')};\nwindow.NO_CATALOG=${JSON.stringify(catalog)};\n`);
  log(`published ${catalog.episodes.length} episodes in ${Object.keys(catalog.series).length} series across ${channels.length} channels`);
  return st;
}
