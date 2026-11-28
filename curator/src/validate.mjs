// Validation report: what the catalogue actually contains, per channel and per era.
// node src/cli.mjs validate  → prints a summary and writes public/validation.json
import path from 'node:path';
import { compact } from './build.mjs';
import { readJSON, writeJSON, DATA } from './util.mjs';

export function validate(lib, log = console.log) {
  const channels = readJSON(new URL('../data/channels.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), []);
  const cat = compact(lib, channels);
  const byId = {};
  for (const ch of cat.channels) byId[ch.id] = { name: ch.name, n: ch.n, from: ch.from || null, shows: 0, episodes: 0, arabic: 0 };
  for (const e of cat.episodes) {
    const ser = cat.series[e.s];
    if (!ser) continue;
    for (const ch of Object.keys(ser.ch || {})) {
      const row = byId[ch];
      if (!row) continue;
      row.episodes++;
      if (e.src.some((s) => s.p === 'ia' || s.p === 'arabic')) row.arabic++;
    }
  }
  for (const sid of Object.keys(cat.series)) {
    for (const ch of Object.keys(cat.series[sid].ch || {})) {
      if (byId[ch]) byId[ch].shows++;
    }
  }
  const providers = {};
  let arabicTitles = 0, englishTitles = 0, bothTitles = 0, noTitle = 0, withYear = 0;
  for (const e of cat.episodes) for (const s of e.src) providers[s.p] = (providers[s.p] || 0) + 1;
  for (const s of Object.values(cat.series)) {
    const t = s.t || {};
    if (t.ar && t.en) bothTitles++; else if (t.ar) arabicTitles++; else if (t.en) englishTitles++; else noTitle++;
    if (s.y) withYear++;
  }
  const eras = {};
  for (const y of [2000, 2004, 2008, 2010, 2013]) {
    const chs = cat.channels.filter((ch) => !((ch.from && y < ch.from) || (ch.to && y > ch.to)));
    const eps = cat.episodes.filter((e) => !e.y || e.y <= y);
    const future = cat.episodes.filter((e) => e.y && e.y > y).length;
    eras[y] = { channels: chs.length, episodes: eps.length, futureDatedDropped: future };
  }
  const report = {
    generated: cat.generated,
    totals: { channels: cat.channels.length, series: Object.keys(cat.series).length, episodes: cat.episodes.length, sources: Object.values(providers).reduce((a, b) => a + b, 0) },
    providers,
    titles: { arabicOnly: arabicTitles, englishOnly: englishTitles, both: bothTitles, none: noTitle, seriesWithYear: withYear },
    perChannel: byId,
    eras
  };
  writeJSON(path.join(DATA, '..', '..', 'public', 'validation.json'), report, false);
  log('validation: ' + report.totals.episodes + ' episodes, ' + report.totals.series + ' shows, ' + report.totals.channels + ' channels');
  log('  sources: ' + JSON.stringify(providers));
  log('  titles: ' + JSON.stringify(report.titles));
  log('  eras: ' + JSON.stringify(eras));
  return report;
}
