// Arabic cartoons from the Internet Archive: MBC3 and Spacetoon collections.
//
// Why this source: archive.org serves the files with `Access-Control-Allow-Origin: *` and plain
// MP4, so the browser can play them directly — unlike most Arabic cartoon sites, which block
// CORS and framing and need a proxy.
//
// The items below are uploader collections with a `<collection>/<show>/<NNN>.mp4` layout, which is
// exactly a series/episode structure. Nothing is invented: the show name is the folder name and the
// episode number is the file name.
const ITEMS = [
  { id: 'www.arabp-2p.com-mbc-3', ch: 'najma-3', max: 300 },
  { id: 'www.arabp-2p.com-mbc-3-part-2', ch: 'najma-3', max: 420 },
  { id: 'www.arabp-2p.net-space-toon-part-6', ch: 'planet-toon', max: 200 },
  { id: 'www.arabp-2p.net-space-toon-part-4', ch: 'planet-toon', max: 200 },
  // broadcast recordings: bumpers, idents and period ads (short clips, used as channel fill)
  { id: 'sbys-ton-daaayat-mnoaa-2006-1', ch: 'planet-toon', fill: true, maxShort: 120 }
];

const VIDEO = /\.(mp4|mkv|webm|m4v|avi)$/i;
const DERIVED = /\.ia\.mp4$/i; // archive.org's generated copy: the original is better

function urlFor(id, name) {
  return 'https://archive.org/download/' + id + '/' + name.split('/').map(encodeURIComponent).join('/');
}
function arabicNumber(s) {
  const m = /الحلقة\s*(\d{1,4})/.exec(s);
  return m ? +m[1] : null;
}
async function meta(id) {
  const res = await fetch('https://archive.org/metadata/' + id, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('metadata ' + res.status);
  return res.json();
}

export async function importArchiveArabic(lib, { log = console.log } = {}) {
  let shows = 0, eps = 0, skipped = 0;
  for (const item of ITEMS) {
    let m;
    try { m = await meta(item.id); } catch (e) { log('archive-arabic: ' + item.id + ' failed: ' + e.message); skipped++; continue; }
    const files = (m.files || []).filter(f => VIDEO.test(f.name) && !DERIVED.test(f.name));
    const buckets = new Map(); // folder -> [{name, len}]
    for (const f of files) {
      const parts = f.name.split('/');
      const base = parts.pop();
      const len = parseFloat(f.length || '0') || 0;
      const folder = parts.length ? parts[parts.length - 1] : '';
      if (item.fill && (len > 600 || len < 5)) continue;       // bumpers only
      if (!item.fill && len && len < 240) continue;            // a 4-minute "episode" is not one
      if (!buckets.has(folder)) buckets.set(folder, []);
      buckets.get(folder).push({ name: f.name, base, len, size: +(f.size || 0) });
    }
    let taken = 0;
    for (const [folder, list] of buckets) {
      if (!folder && !item.fill) continue;   // fill series may live in the item root
      list.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
      const title = (folder || 'سبيستون').replace(/\s+/g, ' ').trim();
      const series = lib.upsertSeries({
        title_ar: title, year: null, kind: item.fill ? 'interstitial' : 'series',
        language: 'ar', dub: 'ar', channel: item.ch, tags: ['*'], fill: item.fill ? true : undefined
      });
      for (let i = 0; i < list.length && taken < (item.max || 999); i++, taken++) {
        const f = list[i];
        const num = parseInt((f.base.match(/^(\d{1,4})/) || [])[1], 10) || arabicNumber(f.base) || i + 1;
        const ep = lib.upsertEpisode({
          series: series.id, season: 1, episode: num,
          title_ar: title + ' — الحلقة ' + num, language: 'ar', dub: 'ar',
          duration: Math.round(f.len) || (item.fill ? 45 : 1320)
        });
        const ref = item.id + '/' + f.name;
        if (!lib.d.sources['archive:' + ref]) {
          const src = lib.addSource(ep.id, {
            provider: 'archive', ref, url: urlFor(item.id, f.name), kind: 'file',
            quality: '480', authorization: 'unknown', status: 'ok',
            duration: Math.round(f.len) || 0
          });
          src.archive_id = item.id; src.file = f.name;
          src.reliability = item.fill ? 0.7 : 0.8;
          eps++;
        }
      }
      shows++;
    }
    log('archive-arabic: ' + item.id + ' → ' + files.length + ' files, ' + taken + ' used');
  }
  return { shows, episodes: eps, skipped };
}
