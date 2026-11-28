// Publish: compact catalog for the apps, stats for the dashboard, and the web
// version of the app. Only verified working sources are published.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, OUT, ROOT, readJSON, writeJSON, nowIso, log } from './util.mjs';
import { isPublishable } from './maintain.mjs';
import { usageSummary } from './budget.mjs';
import { playableCodec } from './probe.mjs';
import { matchShow, notAShow, looksLikeClip, westernDigits } from './titles.mjs';
import { seriesRequire } from './discover.mjs';

const P = { youtube: 'yt', archive: 'ia', arabic: 'arabic' };

// Leave out anything already in the library that today's rules reject, so a rule change
// cleans the published catalog right away:
//  - podcasts, panels, reviews and other non-shows; other-language dubs; adult content
//  - anything dated before 1950 (public-domain era) or after 2013 (outside the nostalgia years)
//  - on channels with "channel_only" in seeds.json, shows that are not on that channel's lists
//  - on brand series such as "Cartoon Network" or "Toonami" (official channels and broadcast
//    tapes), uploads that are neither a recording of the channel nor one of its classic shows
const ADULT = /\b(hentai|naked|nude|nsfw|stripper|strip ?club|slutty|sexy|sexual|s\.e\.x|porn|xxx|bondage|fetish|shadman|onlyfans|patreon)\b/i;
const TAPE = /commercials?|broadcast|recording|recorded|\bvhs\b|\btape\b|\bwoc\b|airing|bumpers?|\bblock\b|midnight run|marathon|tv-?rip|full episodes? with/i;
let SEEDS = null, LISTS = null, ALL_SHOWS = null;
function seeds() {
  if (!SEEDS) { SEEDS = readJSON(path.join(DATA, 'seeds.json'), {}); LISTS = SEEDS.show_lists || {}; ALL_SHOWS = [].concat(...Object.values(LISTS)); }
  return SEEDS;
}
function showsFor(ch) { const only = (seeds().channel_only || {})[ch]; return only ? [].concat(...only.map(k => LISTS[k] || [])) : null; }
export function allowedChannels(lib, ser) {
  const chs = Object.keys(ser.channels || {});
  if (ser.fill) return chs;
  const name = ser.titles.en || ser.titles.ar || ser.titles.ja || '';
  return chs.filter(ch => { const L = showsFor(ch); return !L || seriesRequire(name) || matchShow(name, L) || matchShow(ser.titles.ar || '', L); });
}
const EP_MARK = /full episode|\bS\d+\s*E\d+|\bepisode \d+|\bep\.? ?\d+|\b\d{1,2},\d{2}\b|full movie|complete series|full series|الحلقة|حلقة|الحلقه|第\s*\d+\s*話|\/\d{1,3}\b|#\d+/i;
const LIGHT = ['internet-2006', 'rewind-web', 'gamezone', 'player-2', 'byte-shop'];
const PLAYS = ['masrah-kuwait', 'khaleej-stage', 'kuwait-zaman'];
let OFFICIAL = null;
function isOfficial(lib, id) {
  if (!OFFICIAL || OFFICIAL.lib !== lib) {
    OFFICIAL = { lib, set: new Set(Object.values(lib.d.sources).filter(s => s.provider === 'youtube' && s.authorization === 'official').map(s => s.episode)) };
  }
  return OFFICIAL.set.has(id);
}
export function keepEpisode(lib, e) {
  const ser = lib.d.series[e.series];
  if (!ser) return true;
  const title = e.titles.en || e.titles.ar || e.titles.ja || '';
  if (ser.fill) { // period breaks only: no idents made after 2013, no theme songs
    const ys = (westernDigits(title).match(/(?:^|\D)(20[0-2]\d)(?!\d)/g) || []).map(y => +y.replace(/\D/g, ''));
    // short period bumpers and ads only: no modern 8-minute official compilations, no credits
    if ((e.duration || 0) > 240 || isOfficial(lib, e.id)) return false;
    return !ys.some(y => y > 2013) && !/شارة|opening|intro song|theme song|credits|closing|end card/i.test(title);
  }
  const chs = allowedChannels(lib, ser);
  if (!chs.length) return false;
  const EX = seeds().channel_exclude || {};
  if (chs.every(ch => notAShow(title, ch) || (EX[ch] && new RegExp(EX[ch], 'i').test(title)))) return false;
  if (ADULT.test(title)) return false;
  const years = (westernDigits(title).match(/(?:^|\D)(19\d\d|20[0-2]\d)(?!\d)/g) || []).map(y => +y.replace(/\D/g, ''));
  if (years.some(y => y < 1950)) return false;
  if (years.some(y => y > 2013) && !chs.some(ch => ['internet-2006', 'rewind-web'].includes(ch))) return false;
  // A real episode says so in its title, or at least runs like one. Official channels now
  // mostly post compilations, so their uploads must be marked as a full episode.
  const tape = TAPE.test(title);
  if (!tape && !chs.some(ch => LIGHT.includes(ch) || PLAYS.includes(ch))) {
    const marked = EP_MARK.test(title);
    if (isOfficial(lib, e.id) && !marked) return false;
    // today's official channel uploads ("… | Nick", "… | Cartoon Network") are mostly new shorts:
    // only ones that say "full episode" count
    if (isOfficial(lib, e.id) && /\|\s*(nick|nickelodeon|cartoon network|disney|adult swim|@?wb ?kids)\b/i.test(title) && !/full episode/i.test(title)) return false;
    if (!marked && (e.duration || 0) < 18 * 60) return false;
  }
  const name = ser.titles.en || '';
  const req = seriesRequire(name);
  if (req) {
    const L = [].concat(...chs.map(ch => showsFor(ch) || [])); seeds();
    const known = matchShow(title, L.length ? L : ALL_SHOWS);
    if (!(req.test(title) && TAPE.test(title)) && !known) return false;
    if (!TAPE.test(title) && looksLikeClip(title)) return false;
  }
  return true;
}

export function compact(lib, channels, now = Date.now()) {
  const srcByEp = new Map();
  for (const s of Object.values(lib.d.sources)) {
    if (!isPublishable(s, now)) continue;
    if (s.provider === 'archive' && !playableCodec((lib.d.ia_codec || {})[s.archive_id])) continue; // HEVC etc.: NO SIGNAL on most screens
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
    if (!keepEpisode(lib, e)) continue;
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
    const ch = {}; for (const c of allowedChannels(lib, s)) ch[c] = s.channels[c];
    series[id] = { t, y: s.year || undefined, ch, fill: s.fill || undefined };
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
  // A channel with a handful of episodes would loop them all day, so it waits for at least 12.
  const perCh = {};
  for (const e of episodes) { const sr = series[e.s]; if (sr && !sr.fill) for (const c of Object.keys(sr.ch || {})) perCh[c] = (perCh[c] || 0) + 1; }
  channels = channels.filter(c => c.mix || (perCh[c.id] || 0) >= 12);
  // Which channel each listed show belongs on, so your own Real-Debrid/TorBox copy of a show
  // nobody has found online yet still airs on the right channel instead of 099.
  const shows = {};
  for (const [ch, keys] of Object.entries(seeds().channel_only || {})) {
    if (!channels.some(c => c.id === ch)) continue;
    for (const sh of [].concat(...keys.map(k => LISTS[k] || []))) {
      for (const n of [].concat(typeof sh === 'string' ? sh : [sh.name, ...(sh.match || [])])) {
        if (!/[a-z\u0600-\u06ff]{3}/i.test(n) || /^(g4|mtv|disney channel|nickelodeon|cartoon network|toonami|tv|quiz)$/i.test(n)) continue;
        const list = shows[n] ||= []; if (!list.includes(ch)) list.push(ch);
      }
    }
  }
  return { v: 1, generated: nowIso(), channels, series, episodes, shows };
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
