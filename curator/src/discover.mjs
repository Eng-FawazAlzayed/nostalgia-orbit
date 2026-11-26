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
  if (seed.year_range) { // e.g. Gulf plays first released 1990-2010 (the year in the title, not the upload date)
    const years = (westernDigits(r.title || '').match(/(?:^|\D)(19[3-9]\d|20[0-2]\d)(?!\d)/g) || []).map(y => +y.replace(/\D/g, ''));
    const [lo, hi] = seed.year_range;
    if (!years.length ? seed.year_required !== false : years.some(y => y < lo || y > hi)) { stats.rejected++; return; }
    r = { ...r, year: years[0] || r.year };
  }
  if (seed.exclude && new RegExp(seed.exclude, 'i').test(r.title || '')) { stats.rejected++; return; }
  if (seed.published_range && r.published) { // early-YouTube channels: only uploads from the era
    const y = +String(r.published).slice(0, 4), [plo, phi] = seed.published_range;
    if (y < plo || y > phi) { stats.rejected++; return; }
  }
  if (!r.live && r.duration && (r.duration < minS || r.duration > maxS)) { stats.rejected++; return; }
  if (!fill && !seed.allow_clips && looksLikeClip(r.title || '')) { stats.rejected++; return; }
  if (provider === 'youtube' && seed.authorization !== 'official' && !config.allow_unknown_youtube_uploaders) { stats.rejected++; return; }

  const shows = showsOf(seed);
  const shown = shows.length ? matchShow(seed._match_title || r.title || '', shows) : null;
  if (shows.length && !shown && !seed.series) { stats.rejected++; return; } // not one of the classic shows we want
  let name = seed.series || shown || (seed._multi ? (seriesFromTitle(r.item_title || '') || String(r.item_title || '').slice(0, 60)) : seriesFromTitle(r.title || ''));
  let pe = parseEpisode(r.title || '');
  if (!name || (!shown && !pe.episode && !seed.one_offs && !seed._multi && !fill)) {
    const g = await ai.classifyTitle(r.title || '', chId); // only if enabled and within budget
    if (g?.is_full_episode === false && !fill) { stats.rejected++; return; }
    if (g && !name) name = g.series || g.series_ar || '';
    if (g && !pe.episode && g.episode) pe = { season: g.season || 0, episode: g.episode };
  }
  if (!name) { stats.unclassified++; return; }
  const sk = chId + '|' + name; stats.bySeries ||= {};
  if ((stats.bySeries[sk] || 0) >= (seed.per_series_cap || 40)) { stats.capped = (stats.capped || 0) + 1; return; } // more next run
  stats.bySeries[sk] = (stats.bySeries[sk] || 0) + 1;
  const lang = seed.language || guessLanguage(r.title || '');
  // Bumpers and ads live in their own series, so a show never turns into ad filler.
  if (fill) name = 'Breaks · ' + name;
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
    auth_note: r.auth_note || seed.auth_note || '', uploader: r.uploader || '', duration: r.duration, quality: r.quality,
    recorded: r.recorded || null, uploaded: r.uploaded || null
  });
  applyResult(src, r, 'discover');
  stats.added++;
}

export async function discover(lib, { channel = null, maxNew = config.discover_max_new_per_run ?? 1500 } = {}) {
  const sd = seeds().channels || {};
  const stats = { added: 0, rejected: 0, unclassified: 0, seen: 0, per_channel: {} };
  const ids = Object.keys(sd).filter(id => (!channel || id === channel) && !sd[id].disabled);
  // Every channel gets a fair share of the run, so the first few can't use it all up.
  const share = channel ? maxNew : Math.max(30, Math.ceil(maxNew / Math.max(1, ids.length)));
  for (const chId of ids) {
    const s = sd[chId];
    const before = stats.added, limit = Math.min(maxNew, stats.added + share);
    log(`discover: ${chId}`);
    await discoverChannel(lib, chId, s, stats, limit);
    stats.per_channel[chId] = stats.added - before;
  }
  delete stats.bySeries;
  log(`discover: +${stats.added} new, ${stats.rejected} rejected, ${stats.unclassified} unclassified, ${stats.seen} already known`);
  return stats;
}

async function discoverChannel(lib, chId, s, stats, maxNew) {
  {
    // Spread the channel's share over its sources so one big Archive item can't fill it alone.
    const nSeeds = ['archive', 'youtube_handles', 'youtube_playlists', 'youtube_searches', 'direct'].reduce((a, k) => a + (s[k] || []).filter(x => !x.disabled).length, 0) || 1;
    const seedShare = Math.max(15, Math.ceil((maxNew - stats.added) / nSeeds));
    const cap = () => Math.min(maxNew, stats.added + seedShare);

    // 1) Internet Archive first: free, no quota, and the preferred source.
    for (const seed of (s.archive || []).filter(x => !x.disabled)) {
      if (stats.added >= maxNew) break;
      await fromArchive(lib, chId, seed, stats, cap());
    }
    // 2) YouTube channels by handle -> uploads playlist (1 unit per 50 videos)
    for (const seed of (s.youtube_handles || []).filter(x => !x.disabled)) {
      if (stats.added >= maxNew) break;
      const ch = await yt.channelByHandle(seed.handle);
      if (!ch) { log(`  handle ${seed.handle} skipped (YouTube allowance used up, retry next run)`); continue; }
      if (ch.missing) { log(`  handle ${seed.handle} not found`); continue; }
      await fromYouTubeIds(lib, chId, { authorization: 'official', ...seed }, await yt.playlistIds(ch.uploads, seed.max || 4000), stats, cap());
    }
    // 2) playlists
    for (const seed of s.youtube_playlists || []) {
      await fromYouTubeIds(lib, chId, seed, await yt.playlistIds(seed.id, seed.max || 1000), stats, cap());
    }
    // 3) searches (100 units each, cached 30 days)
    for (const seed of (s.youtube_searches || []).filter(x => !x.disabled)) {
      if (stats.added >= maxNew) break;
      if (!canSpend('youtube', 100)) { log('  search budget reached for today'); break; }
      await fromYouTubeIds(lib, chId, seed, await yt.search(seed.q, { duration: seed.duration || 'long', lang: seed.lang }), stats, cap());
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

// One Archive search: skip items already looked at, filter on the search title first (free),
// then read the item and add each playable video in it as its own episode.
async function fromArchive(lib, chId, seed, stats, maxNew) {
  const docs = (await ia.search(seed.query, seed.rows || 150)) || [];
  const seen = lib.d.ia_items ||= {};
  const shows = showsOf(seed);
  const [rlo, rhi] = seed.recorded_range || [0, 9999];
  for (const d of docs) {
    if (stats.added >= maxNew) break;
    if (seen[d.id] || lib.d.sources['archive:' + d.id]) { stats.seen++; continue; }
    if (seed.exclude && new RegExp(seed.exclude, 'i').test(d.title || '')) { stats.rejected++; continue; }
    if (d.year && (d.year < rlo || d.year > rhi)) { stats.rejected++; continue; }
    if (shows.length && !seed.series && !matchShow(d.title || '', shows) && !seed.match_files) { stats.rejected++; continue; }
    const it = await ia.inspect(d.id);
    if (!it.ok && (it.code === 'budget' || it.code === 'network')) break;
    if (!it.ok) { seen[d.id] = new Date().toISOString().slice(0, 10); stats.rejected++; continue; }
    if (it.info.recorded && (it.info.recorded < rlo || it.info.recorded > rhi)) { stats.rejected++; continue; }
    const many = it.files.length > 1;
    const capped0 = stats.capped || 0; let finished = true;
    for (const f of it.files.slice(0, seed.max_files || 300)) {
      if (stats.added >= maxNew) { finished = false; break; }
      if (lib.d.sources['archive:' + d.id + '/' + f.name]) { stats.seen++; continue; }
      const stem = f.root.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
      const title = many ? (f.title || `${it.info.item_title} ${stem}`) : (f.title || it.info.item_title);
      const r = {
        ok: true, code: 'ok', title, duration: f.length, quality: f.height ? String(f.height) : '',
        url: `https://archive.org/download/${encodeURIComponent(d.id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
        year: it.info.recorded, ...it.info
      };
      // For matching, the item title tells us the show when file names are just "ep01".
      const matchTitle = shows.length && !matchShow(title, shows) ? `${it.info.item_title} ${title}` : title;
      await addCandidate(lib, chId, { ...seed, _match_title: matchTitle, _multi: many }, 'archive', d.id + '/' + f.name, r, stats);
    }
    // Only skip this item next time once every video in it has been looked at.
    if (finished && (stats.capped || 0) === capped0) seen[d.id] = new Date().toISOString().slice(0, 10);
  }
}
