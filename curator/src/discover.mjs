// Incremental discovery from data/seeds.json. Only NEW links are looked at;
// everything is verified before it can reach the published catalog.
import path from 'node:path';
import { DATA, readJSON, log } from './util.mjs';
import * as yt from './providers/youtube.mjs';
import * as ia from './providers/archive.mjs';
import * as direct from './providers/direct.mjs';
import { applyResult } from './maintain.mjs';
import { config, canSpend } from './budget.mjs';
import { parseEpisode, guessLanguage, isDub, looksLikeClip, matchShow, hasArabic, hasJapanese, westernDigits } from './titles.mjs';
import * as ai from './ai.mjs';

export const seeds = () => readJSON(path.join(DATA, 'seeds.json'), { channels: {} });

// A seed's show list: inline "shows", or a shared list named by "shows_ref" (see show_lists in seeds.json).
function showsOf(seed) {
  const lists = seeds().show_lists || {};
  return [].concat(seed.shows || [], ...[].concat(seed.shows_ref || []).map(k => lists[k] || []));
}

// "Captain Majid - Episode 12 | Arabic" -> "Captain Majid"
export function seriesFromTitle(title) {
  let t = westernDigits(title)
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .split(/\s[|•–—-]\s|\s*\|\s*|:\s|الحلقة|حلقة|\bS\d+\s*E\d+|\bseason\b|\bepisode\b|\bep\.?\s*\d|第\s*\d/i)[0];
  t = t.replace(/\b(full episodes?|official|hd|cartoon network|nickelodeon|wb kids)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= 60 ? t : '';
}

async function addCandidate(lib, chId, seed, provider, ref, r, stats) {
  const fill = !!seed.fill;
  const minS = (seed.min_minutes ?? (fill ? 0.25 : 5)) * 60, maxS = (seed.max_minutes ?? (fill ? 10 : 240)) * 60;
  if (!r.ok) { stats.rejected++; return; }
  if (r.live && !seed.allow_live) { stats.rejected++; return; }
  if (seed.exclude && new RegExp(seed.exclude, 'i').test(r.title || '')) { stats.rejected++; return; }
  if (!r.live && r.duration && (r.duration < minS || r.duration > maxS)) { stats.rejected++; return; }
  if (!fill && !seed.allow_clips && looksLikeClip(r.title || '')) { stats.rejected++; return; }
  if (provider === 'archive' && r.authorization === 'unknown') { stats.rejected++; return; } // no reuse rights shown
  if (provider === 'youtube' && seed.authorization !== 'official' && !config.allow_unknown_youtube_uploaders) { stats.rejected++; return; }

  const shows = showsOf(seed);
  const shown = shows.length ? matchShow(r.title || '', shows) : null;
  if (shows.length && !shown && !seed.series) { stats.rejected++; return; } // not one of the classic shows we want
  let name = seed.series || shown || seriesFromTitle(r.title || '');
  let pe = parseEpisode(r.title || '');
  if (!name || (!shown && !pe.episode && !seed.one_offs && !fill)) {
    const g = await ai.classifyTitle(r.title || '', chId); // only if enabled and within budget
    if (g?.is_full_episode === false && !fill) { stats.rejected++; return; }
    if (g && !name) name = g.series || g.series_ar || '';
    if (g && !pe.episode && g.episode) pe = { season: g.season || 0, episode: g.episode };
  }
  if (!name) { stats.unclassified++; return; }
  const lang = seed.language || guessLanguage(r.title || '');
  const ser = lib.upsertSeries({
    title_en: hasArabic(name) || hasJapanese(name) ? (seed.series_en || '') : name,
    title_ar: hasArabic(name) ? name : (seed.series_ar || ''), title_ja: hasJapanese(name) ? name : '',
    year: seed.year, kind: fill ? 'interstitial' : (seed.kind || 'series'), language: lang,
    dub: isDub(r.title || '') ? 'ar' : '', channel: chId, tags: seed.tags, fill
  });
  if (!ser.titles.en && !ser.titles.ar && !ser.titles.ja) ser.titles.en = name;
  const ep = lib.upsertEpisode({
    series: ser.id, season: pe.season, episode: pe.episode,
    title_en: hasArabic(r.title) ? '' : r.title, title_ar: hasArabic(r.title) ? r.title : '',
    year: r.year || seed.year, language: lang, dub: ser.dub, duration: r.duration, quality: r.quality
  });
  const src = lib.addSource(ep.id, {
    provider, ref, url: r.url, kind: provider === 'youtube' ? (r.live ? 'live' : 'embed') : (seed.kind_override || (r.live ? 'live' : (provider === 'direct' ? (/\.m3u8/.test(ref) ? 'hls' : 'file') : 'file'))),
    authorization: provider === 'archive' ? r.authorization : (seed.authorization || 'unknown'),
    auth_note: r.auth_note || seed.auth_note || '', uploader: r.uploader || '', duration: r.duration, quality: r.quality
  });
  applyResult(src, r, 'discover');
  stats.added++;
}

export async function discover(lib, { channel = null, maxNew = config.discover_max_new_per_run ?? 1500 } = {}) {
  const sd = seeds().channels || {};
  const stats = { added: 0, rejected: 0, unclassified: 0, seen: 0, per_channel: {} };
  const ids = Object.keys(sd).filter(id => !channel || id === channel);
  // Every channel gets a fair share of the run, so the first few can't use it all up.
  const share = channel ? maxNew : Math.max(30, Math.ceil(maxNew / Math.max(1, ids.length)));
  for (const chId of ids) {
    const s = sd[chId];
    const before = stats.added, limit = Math.min(maxNew, stats.added + share);
    log(`discover: ${chId}`);
    await discoverChannel(lib, chId, s, stats, limit);
    stats.per_channel[chId] = stats.added - before;
  }
  log(`discover: +${stats.added} new, ${stats.rejected} rejected, ${stats.unclassified} unclassified, ${stats.seen} already known`);
  return stats;
}

async function discoverChannel(lib, chId, s, stats, maxNew) {
  {

    // 1) official channels by handle -> uploads playlist (1 unit per 50 videos)
    for (const seed of s.youtube_handles || []) {
      if (stats.added >= maxNew) break;
      const ch = await yt.channelByHandle(seed.handle);
      if (!ch || ch.missing) { log(`  handle ${seed.handle} not found`); continue; }
      await fromYouTubeIds(lib, chId, { authorization: 'official', ...seed }, await yt.playlistIds(ch.uploads, seed.max || 4000), stats, maxNew);
    }
    // 2) playlists
    for (const seed of s.youtube_playlists || []) {
      await fromYouTubeIds(lib, chId, seed, await yt.playlistIds(seed.id, seed.max || 1000), stats, maxNew);
    }
    // 3) searches (100 units each, cached 30 days)
    for (const seed of s.youtube_searches || []) {
      if (stats.added >= maxNew) break;
      if (!canSpend('youtube', 100)) { log('  search budget reached for today'); break; }
      await fromYouTubeIds(lib, chId, seed, await yt.search(seed.q, { duration: seed.duration || 'long', lang: seed.lang }), stats, maxNew);
    }
    // 4) Internet Archive (free)
    for (const seed of s.archive || []) {
      const docs = (await ia.search(seed.query, seed.rows || 150)) || [];
      for (const d of docs) {
        if (stats.added >= maxNew) break;
        if (lib.d.sources['archive:' + d.id]) { stats.seen++; continue; }
        const r = await ia.check(d.id);
        await addCandidate(lib, chId, seed, 'archive', d.id, r, stats);
      }
    }
    // 5) direct live streams / files listed by hand
    for (const seed of s.direct || []) {
      if (lib.d.sources['direct:' + seed.url]) { stats.seen++; continue; }
      const r = await direct.check(seed.url, seed.kind);
      await addCandidate(lib, chId, { ...seed, series: seed.name, one_offs: true, allow_live: true, max_minutes: 1e6 }, 'direct', seed.url, { ...r, title: seed.name, duration: r.live ? 0 : seed.duration || 0 }, stats);
    }
  }
}

async function fromYouTubeIds(lib, chId, seed, ids, stats, maxNew) {
  if (!ids) return;
  const fresh = ids.filter(id => { const known = !!lib.d.sources['youtube:' + id]; if (known) stats.seen++; return !known; });
  if (!fresh.length) return;
  const res = await yt.checkMany(fresh, { essential: false });
  for (const [id, r] of res) {
    if (stats.added >= maxNew) break;
    if (seed.title_filter && !(new RegExp(seed.title_filter, 'i')).test(r.title || '')) { stats.rejected++; continue; }
    if (seed.uploader_filter && !(new RegExp(seed.uploader_filter, 'i')).test(r.uploader || '')) { stats.rejected++; continue; }
    await addCandidate(lib, chId, seed, 'youtube', id, r, stats);
  }
}
