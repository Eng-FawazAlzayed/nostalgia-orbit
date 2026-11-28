// arabic-toons.com as a source for the Arabic channels.
//
// The site (a Dimakids project) publishes Arabic-dubbed cartoons. Each episode page carries a
// server-signed MP4 for its Clappr player:
//   const videoSrc = "https://stream.foupix.com:8443/…/file.mp4?tkn=…&tms=…&ua=…&ips=…";
// The signature lasts about six hours and is bound to the request, so the catalogue keeps the
// EPISODE PAGE and the client extracts the MP4 when it plays (client/providers.js → resolvers.arabic).
//
// Only shows that belong to a channel's own show list are imported; nothing is invented.
const BASE = 'https://www.arabic-toons.com/';

// Verified pages on 2026-11-28. Add rows here; the importer is idempotent.
const SHOWS = [
  { ar: 'عدنان ولينا', en: 'Adnan wa Lina', year: 1975, page: '3dnan-wa-lena-1415526047-anime-streaming.html', ch: 'planet-toon' },
  { ar: 'سالي', en: 'Sally', year: 1990, page: 'sally-1405893806-anime-streaming.html', ch: 'planet-toon' },
  { ar: 'عهد الأصدقاء', en: 'Friendship Pact', year: 1975, page: '3hd-al29dqa2-1422056946-anime-streaming.html', ch: 'planet-toon' }
];

const EP_LINK = /<a href="([^"#]+\.html)#sets" title="([^"]+)"/g;
const EP_NUM = /الحلقة\s*(\d+)/;
const ARABIC_DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9 };

function western(s) {
  return String(s).replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d]).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

export function parseEpisodes(html) {
  const out = [], seen = new Set();
  let m;
  EP_LINK.lastIndex = 0;
  while ((m = EP_LINK.exec(html))) {
    const url = BASE + m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const title = m[2].trim();
    const num = EP_NUM.exec(western(title));
    out.push({ url, title, num: num ? +num[1] : null });
  }
  // numbers are not always in the title: fall back to the order on the page
  out.forEach((e, i) => { if (!e.num) e.num = i + 1; });
  out.sort((a, b) => a.num - b.num);
  return out;
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html', Referer: BASE }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}

/* Adds series/episodes/sources to the library. Safe to run again. */
export async function importArabic(lib, { log = console.log, maxPerShow = 80 } = {}) {
  let shows = 0, episodes = 0, skipped = 0;
  for (const show of SHOWS) {
    let html;
    try { html = await getText(BASE + show.page); } catch (e) { log('arabic: ' + show.ar + ' failed: ' + e.message); skipped++; continue; }
    const eps = parseEpisodes(html);
    if (!eps.length) { log('arabic: ' + show.ar + ' has no episodes on the page'); skipped++; continue; }
    const series = lib.upsertSeries({
      title_ar: show.ar, title_en: show.en, year: show.year, kind: 'series',
      language: 'ar', dub: 'ar', channel: show.ch, tags: ['*']
    });
    const sid = series.id;
    let n = 0;
    for (const e of eps.slice(0, maxPerShow)) {
      const ep = lib.upsertEpisode({
        series: sid, season: 1, episode: e.num,
        title_ar: e.title, language: 'ar', dub: 'ar', duration: 1320
      });
      const existing = lib.d.sources['arabic:' + e.url];
      if (!existing) {
        const src = lib.addSource(ep.id, {
          provider: 'arabic', ref: e.url, kind: 'page', quality: '480',
          authorization: 'unknown', status: 'ok', duration: 1320
        });
        // preferred first on these channels: it is the Arabic dub the channel actually aired
        src.reliability = 0.9; src.quality = '480';
        n++;
      } else if (existing.reliability !== 0.9) {
        existing.reliability = 0.9; existing.quality = '480';
      }
    }
    shows++; episodes += n;
    log('arabic: ' + show.ar + ' → ' + eps.length + ' episodes on the page, ' + n + ' new sources');
  }
  return { shows, episodes, skipped };
}
