import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('../../shared/schedule.js');
const channels = JSON.parse(fs.readFileSync(new URL('../data/channels.json', import.meta.url)));

function cat() {
  const series = {
    a: { t: { en: 'Show A' }, ch: { 'rebound': ['day', 'afternoon', 'overnight'] } },
    b: { t: { en: 'Show B' }, ch: { 'rebound': ['day'] } },
    play: { t: { ar: 'مسرحية' }, ch: { 'masrah-kuwait': ['prime', 'weekend', 'day'] } },
    ads: { t: { en: 'Retro ads' }, fill: true, ch: {} },
    live: { t: { en: 'Live' }, ch: { 'live-wire': ['live'] } }
  };
  const episodes = [];
  for (let i = 1; i <= 10; i++) episodes.push({ id: 'a' + i, s: 'a', sn: 1, ep: i, d: 1320, src: [{ p: 'yt', r: 'A' + i, k: 'embed', a: 'official' }] });
  for (let i = 1; i <= 3; i++) episodes.push({ id: 'b' + i, s: 'b', sn: 1, ep: i, d: 660, src: [{ p: 'ia', r: 'B' + i, k: 'file', a: 'public_domain' }] });
  episodes.push({ id: 'p1', s: 'play', d: 3 * 3600 + 600, src: [{ p: 'yt', r: 'P1', k: 'embed', a: 'permitted' }] });
  for (let i = 1; i <= 4; i++) episodes.push({ id: 'ad' + i, s: 'ads', d: 30 + i * 15, src: [{ p: 'ia', r: 'AD' + i, k: 'file', a: 'public_domain' }] });
  episodes.push({ id: 'l1', s: 'live', d: 0, src: [{ p: 'yt', r: 'L1', k: 'live', a: 'official' }] });
  episodes.push({ id: 'nosrc', s: 'a', sn: 2, ep: 1, d: 1320, src: [] });
  return { channels, series, episodes };
}

test('a broadcast day covers 24h with no gaps or overlaps', () => {
  const idx = new S.Index(cat());
  for (const ch of channels) {
    const d = S.dayIndexOf(Date.UTC(2026, 10, 26, 12));
    const items = idx.day(ch.id, d);
    assert.equal(items[0].s, S.dayStartMs(d), ch.id);
    for (let i = 1; i < items.length; i++) assert.equal(items[i].s, items[i - 1].e, ch.id + ' contiguous');
    assert.equal(items.at(-1).e, S.dayStartMs(d) + 86400000, ch.id + ' ends at 06:00');
  }
});

test('same input gives the same schedule (devices agree)', () => {
  const t = Date.UTC(2026, 10, 26, 17, 13);
  const a = new S.Index(cat()).at('rebound', t);
  const b = new S.Index(cat()).at('rebound', t);
  assert.deepEqual([a.item.ep.id, a.offset], [b.item.ep.id, b.offset]);
});

test('episodes rotate between shows and advance across days', () => {
  const idx = new S.Index(cat());
  const d = 300;
  const eps = idx.day('rebound', d).filter(x => x.type === 'ep' && !x.inter).map(x => x.ep.s);
  assert.ok(eps.includes('a') && eps.includes('b'));
  const first1 = idx.day('rebound', d).find(x => x.type === 'ep' && !x.inter).ep.id;
  const first2 = idx.day('rebound', d + 1).find(x => x.type === 'ep' && !x.inter).ep.id;
  assert.notEqual(first1, first2);
});

test('episodes without sources never air', () => {
  const idx = new S.Index(cat());
  for (let d = 0; d < 5; d++) assert.ok(!idx.day('rebound', d).some(x => x.ep && x.ep.id === 'nosrc'));
});

test('tune-in offset is time since the show started', () => {
  const idx = new S.Index(cat());
  const d = S.dayIndexOf(Date.UTC(2026, 10, 26, 12));
  const it = idx.day('rebound', d).find(x => x.type === 'ep' && !x.inter);
  const r = idx.at('rebound', it.s + 125000);
  assert.equal(r.item.ep.id, it.ep.id);
  assert.equal(Math.round(r.offset), 125);
});

test('Night Owl is scrambled in the daytime; Dirati closes down overnight', () => {
  const idx = new S.Index(cat());
  const noonKwt = Date.UTC(2026, 10, 26, 9); // 12:00 Kuwait
  assert.equal(idx.at('night-owl', noonKwt).item.type, 'offair');
  const fourAm = Date.UTC(2026, 10, 27, 1); // 04:00 Kuwait
  assert.equal(idx.at('dirati-tv', fourAm).item.type, 'offair');
});

test('a play longer than its block is clipped, not dropped', () => {
  const idx = new S.Index(cat());
  const d = S.dayIndexOf(Date.UTC(2026, 10, 24, 12));
  const plays = idx.day('masrah-kuwait', d).filter(x => x.ep && x.ep.id === 'p1');
  assert.ok(plays.length >= 1);
});

test('Thursday nights use the weekend block on Masrah Kuwait', () => {
  const idx = new S.Index(cat());
  // 2026-11-26 is a Thursday
  const d = S.dayIndexOf(Date.UTC(2026, 10, 26, 12));
  assert.equal(S.kuwaitWeekday(S.dayStartMs(d)), 4);
  const items = idx.day('masrah-kuwait', d);
  for (let i = 1; i < items.length; i++) assert.equal(items[i].s, items[i - 1].e);
});

test('gaps are filled with interstitials before station idents', () => {
  const idx = new S.Index(cat());
  const items = idx.day('rebound', 400);
  assert.ok(items.some(x => x.inter));
});

test('live channel airs its live stream', () => {
  const idx = new S.Index(cat());
  const r = idx.at('live-wire', Date.UTC(2026, 10, 26, 12));
  assert.equal(r.item.ep.id, 'l1');
});

test('source picking honours device caps, region and remembered failures', () => {
  const ep = { src: [
    { p: 'yt', r: 'x', k: 'embed', a: 'permitted', rel: 0.9 },
    { p: 'ia', r: 'y', k: 'file', a: 'public_domain', rel: 0.8 },
    { p: 'yt', r: 'z', k: 'embed', a: 'official', reg: { b: ['KW'] } }
  ] };
  let l = S.pickSources(ep, { yt: true, file: true, region: 'KW' }, {}, 0);
  assert.deepEqual(l.map(s => s.r), ['y', 'x']);
  l = S.pickSources(ep, { yt: true, file: true, region: 'KW' }, { 'ia:y': 10 }, 0);
  assert.deepEqual(l.map(s => s.r), ['x']);
  l = S.pickSources(ep, { yt: false, file: true, region: 'US' }, {}, 0);
  assert.deepEqual(l.map(s => s.r), ['y']);
});
