import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEpisode, normalize, fingerprint, looksLikeClip } from '../src/titles.mjs';
import { seriesFromTitle } from '../src/discover.mjs';
import { applyResult, isPublishable, dueSources, orphans } from '../src/maintain.mjs';
import { judge } from '../src/providers/youtube.mjs';
import { authorizationOf, bestFile } from '../src/providers/archive.mjs';
import { Library } from '../src/db.mjs';
import { compact } from '../src/build.mjs';
import { isoDuration } from '../src/util.mjs';

test('episode numbers in English, Arabic and Japanese titles', () => {
  assert.deepEqual(parseEpisode('Dexter\'s Laboratory S2E14 - Full Episode'), { season: 2, episode: 14 });
  assert.deepEqual(parseEpisode('Rugrats | Season 1 Episode 3'), { season: 1, episode: 3 });
  assert.deepEqual(parseEpisode('Gundam Wing 1x05'), { season: 1, episode: 5 });
  assert.deepEqual(parseEpisode('الكابتن ماجد الحلقة ١٢'), { season: 0, episode: 12 });
  assert.deepEqual(parseEpisode('المحقق كونان الموسم 2 الحلقة 7'), { season: 2, episode: 7 });
  assert.deepEqual(parseEpisode('ウルトラマン 第3話'), { season: 0, episode: 3 });
});

test('series names come out of messy titles', () => {
  assert.equal(seriesFromTitle('Captain Majid - Episode 12 | Arabic'), 'Captain Majid');
  assert.equal(seriesFromTitle('الكابتن ماجد الحلقة 12'), 'الكابتن ماجد');
  assert.equal(seriesFromTitle('Courage the Cowardly Dog | Full Episode | Cartoon Network'), 'Courage the Cowardly Dog');
});

test('normalising makes Arabic spellings match', () => {
  assert.equal(normalize('أفتح يا سمسم'), normalize('افتح يا سمسم'));
  assert.equal(fingerprint('s1', 1, 2, 'x', 600), fingerprint('s1', 1, 2, 'different title', 610));
  assert.ok(looksLikeClip('Best moments compilation #shorts'));
});

test('durations', () => { assert.equal(isoDuration('PT1H2M3S'), 3723); assert.equal(isoDuration('PT22M'), 1320); });

test('YouTube check rules', () => {
  assert.equal(judge(null).code, 'removed');
  assert.equal(judge({ status: { embeddable: false } }).code, 'not-embeddable');
  assert.equal(judge({ status: { embeddable: true }, contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } }).code, 'age-restricted');
  assert.equal(judge({ status: { embeddable: true }, contentDetails: { regionRestriction: { blocked: ['KW'] } } }).code, 'blocked-KW');
  const ok = judge({ status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' }, contentDetails: { duration: 'PT22M', definition: 'hd' }, snippet: { title: 'x' } });
  assert.equal(ok.ok, true); assert.equal(ok.duration, 1320);
});

test('Internet Archive rights and file choice', () => {
  assert.equal(authorizationOf({ metadata: { licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' } }).authorization, 'public_domain');
  assert.equal(authorizationOf({ metadata: { collection: ['prelinger'] } }).authorization, 'public_domain');
  assert.equal(authorizationOf({ metadata: { collection: ['some_tv_rips'] } }).authorization, 'unknown');
  assert.equal(bestFile({ files: [{ name: 'a.ogv' }, { name: 'a.mp4', format: 'h.264' }, { name: 'a.txt' }] }).name, 'a.mp4');
});

test('backoff: temporary failures retry sooner than permanent ones; dead needs two strikes', () => {
  const now = Date.UTC(2026, 10, 26);
  const s = { id: 'youtube:x', status: 'ok', reliability: 0.9, last_ok: new Date(now - 3600e3).toISOString() };
  applyResult(s, { ok: false, permanent: false, code: 'http503' }, 'batch', now);
  assert.equal(s.status, 'temp_fail');
  assert.ok(isPublishable(s, now), 'brief outage keeps the episode on air');
  const first = Date.parse(s.next_check) - now;
  applyResult(s, { ok: false, permanent: false, code: 'http503' }, 'batch', now);
  assert.ok(Date.parse(s.next_check) - now > first - 3600e3, 'backs off');
  applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now);
  assert.equal(s.status, 'suspect');
  applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now);
  assert.equal(s.status, 'dead');
  applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now);
  applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now);
  assert.equal(s.next_check, null, 'stops checking permanently dead links');
});

function lib() {
  const L = new Library({ series: {}, episodes: {}, sources: {} });
  const ser = L.upsertSeries({ title_en: 'Show', channel: 'planet-toon', tags: ['day'] });
  const e1 = L.upsertEpisode({ series: ser.id, season: 1, episode: 1, title_en: 'Show S1E1', duration: 1300 });
  const e1b = L.upsertEpisode({ series: ser.id, season: 1, episode: 1, title_en: 'Show ep 1 (archive copy)', duration: 1290 });
  assert.equal(e1.id, e1b.id, 'same episode from two providers is one entry');
  const a = L.addSource(e1.id, { provider: 'youtube', ref: 'AAA', kind: 'embed', authorization: 'official' });
  const b = L.addSource(e1.id, { provider: 'archive', ref: 'show-ep1', kind: 'file', authorization: 'public_domain', url: 'https://archive.org/download/show-ep1/a.mp4' });
  assert.equal(L.addSource(e1.id, { provider: 'youtube', ref: 'AAA' }), a, 'links are never duplicated');
  return { L, a, b, e1 };
}

test('catalog only publishes working links; episodes with none disappear', () => {
  const { L, a, b } = lib();
  const now = Date.now();
  applyResult(a, { ok: true, code: 'ok', duration: 1300 }, 'batch', now);
  let c = compact(L, [{ id: 'planet-toon' }], now);
  assert.equal(c.episodes.length, 1);
  assert.deepEqual(c.episodes[0].src.map(s => s.p), ['yt']);
  applyResult(b, { ok: true, code: 'ok', duration: 1290, url: b.url }, 'batch', now);
  c = compact(L, [{ id: 'planet-toon' }], now);
  assert.equal(c.episodes[0].src.length, 2, 'backup link included');
  for (const s of [a, b]) { s.last_ok = null; applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now); }
  assert.equal(compact(L, [{ id: 'planet-toon' }], now).episodes.length, 0);
});

test('orphans are episodes that worked before and lost every copy; due list puts them first', () => {
  const { L, a, b, e1 } = lib();
  const now = Date.now();
  applyResult(a, { ok: true, code: 'ok' }, 'batch', now - 10 * 86400e3);
  a.status = 'dead'; a.last_ok = new Date(now - 10 * 86400e3).toISOString();
  b.status = 'pending';
  assert.deepEqual(orphans(L, now).map(e => e.id), [e1.id]);
  assert.equal(dueSources(L, 10, now)[0].id, b.id);
});

test('compilations, clips and live streams are not episodes; show lists pick the series', async () => {
  const { matchShow } = await import('../src/titles.mjs');
  for (const t of ['1 Hour of Henry Danger at NIGHT 🌙😈', 'Fantastic FOOD of Ooo 🥪 Adventure Time', '🟠 LIVE', 'Classic Cartoon MARATHON Vol. 5 📺', 'Every Time Someone Falls in The Thundermans', 'تجميع حلقات الكابتن ماجد'])
    assert.ok(looksLikeClip(t), t);
  for (const t of ['Dexter\'s Laboratory | S2E14 | Full Episode', 'الكابتن ماجد الحلقة 12', 'Courage the Cowardly Dog - The Demon in the Mattress'])
    assert.ok(!looksLikeClip(t), t);
  const shows = ['Teen Titans', 'Ben 10', { name: 'الكابتن ماجد', match: ['كابتن ماجد'] }];
  assert.equal(matchShow('Teen Titans | Season 1 Episode 2 | Full Episode', shows), 'Teen Titans');
  assert.equal(matchShow('كابتن ماجد الحلقة 3', shows), 'الكابتن ماجد');
  assert.equal(matchShow('Regular Show full episode', shows), null);
});

test('Gulf plays need a 1990-2010 release year in the title', async () => {
  const { discover } = await import('../src/discover.mjs');
  assert.equal(typeof discover, 'function');
  const years = t => (t.match(/(?:^|\D)(19[3-9]\d|20[0-2]\d)(?!\d)/g) || []).map(y => +y.replace(/\D/g, ''));
  assert.deepEqual(years('مسرحية على الطاير 2004'), [2004]);
  assert.deepEqual(years('مسرحية 30 يوم حب 1973'), [1973]);
  assert.deepEqual(years('مسرحية 24 ساعة'), []);
});

test('Internet Archive: every video in an item, best playable copy, lengths, moved files', async () => {
  const { playableFiles, lengthOf } = await import('../src/providers/archive.mjs');
  assert.equal(lengthOf('00:22:10'), 1330); assert.equal(lengthOf('1342.6'), 1343); assert.equal(lengthOf('22:10'), 1330);
  const files = playableFiles({ files: [
    { name: 'ep02.avi', source: 'original', length: '1300' },
    { name: 'ep02.mp4', source: 'derivative', original: 'ep02.avi', format: 'h.264', height: '480', length: '1300.2' },
    { name: 'ep01.mkv', source: 'original' },
    { name: 'ep01.mp4', source: 'derivative', original: 'ep01.mkv', format: 'h.264 IA', height: '480', length: '00:21:40' },
    { name: 'ep03.avi', source: 'original' },             // no browser-playable copy: skipped
    { name: 'cover.jpg', source: 'original' }] });
  assert.deepEqual(files.map(f => f.name), ['ep01.mp4', 'ep02.mp4']);
  assert.equal(files[0].length, 1300);
});

test('one show on several channels without copies; mixed channel follows weights', async () => {
  const { collect } = await import('../src/build.mjs');
  const series = { a: { t: { en: "Dexter's Laboratory" }, ch: { 'toon-orbit-gold': ['prime'] } }, b: { t: { en: 'Some Modern Show' }, ch: { 'toon-orbit-gold': ['prime'] } } };
  collect(series, [{ id: 'cartoon-city', collect: [{ from: ['toon-orbit-gold'], shows: ["Dexter's Laboratory"], tags: ['cn'] }] }]);
  assert.deepEqual(series.a.ch['cartoon-city'], ['cn']);
  assert.equal(series.b.ch['cartoon-city'], undefined);
  const S = (await import('node:module')).createRequire(import.meta.url)('../../shared/schedule.js');
  const eps = []; for (let i = 0; i < 30; i++) { eps.push({ id: 'j' + i, s: 'j', ep: i + 1, d: 600, src: [{ p: 'yt', r: 'J' + i }] }); eps.push({ id: 'k' + i, s: 'k', ep: i + 1, d: 600, src: [{ p: 'yt', r: 'K' + i }] }); }
  const idx = new S.Index({ channels: [{ id: 'j', n: '1', blocks: [] }, { id: 'k', n: '2', blocks: [] }, { id: 'mix', n: '3', mix: { j: 3, k: 1 }, blocks: [{ f: '06:00', t: '06:00', g: '*all' }] }],
    series: { j: { t: { en: 'J' }, ch: { j: ['*'] } }, k: { t: { en: 'K' }, ch: { k: ['*'] } } }, episodes: eps });
  const first = idx.playlist('mix', '*all').items.slice(0, 8).map(e => e.s).join('');
  assert.equal(first.split('j').length - 1, 6, first);
});

test('debrid: file names understood, smallest compatible file wins, episodes matched to channels', async () => {
  const vm = await import('node:vm'); const fs = await import('node:fs');
  const store = {}; const ctx = { XMLHttpRequest: function () {}, setTimeout, clearTimeout, NOStore: { load: (k, d) => store[k] ?? d, save: (k, v) => { store[k] = v; } } };
  ctx.this = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../../client/debrid.js', import.meta.url), 'utf8').replace('}(this));', '}(globalThis));'), ctx);
  const D = ctx.NODebrid;
  const p = D.parse("Dexters.Laboratory.S02E14.480p.DVDRip.x264.AAC.mkv");
  assert.equal(p.show, 'dexters laboratory'); assert.equal(p.sn, 2); assert.equal(p.ep, 14); assert.equal(p.codec, 'h264'); assert.equal(p.res, 480);
  assert.equal(D.parse('Kim Possible 1x05 [720p HEVC 10bit].mkv').codec, 'hevc');
  const MB = 1048576;
  const items = [
    { pv: 'rd', r: 'L1', name: "Dexter's Laboratory S02E14 1080p BluRay x264 DTS.mkv", bytes: 1400 * MB },
    { pv: 'rd', r: 'L2', name: "Dexter's Laboratory S02E14 480p DVDRip x264 AAC.mp4", bytes: 120 * MB },
    { pv: 'torbox', r: 't:1:2', name: "Dexter's Laboratory S02E14 720p x265 10bit.mkv", bytes: 90 * MB },
    { pv: 'rd', r: 'L3', name: "Dexter's Laboratory S02E15 480p x264.mkv", bytes: 110 * MB },
    { pv: 'rd', r: 'L4', name: 'Some Unknown Show S01E01 720p x264.mkv', bytes: 200 * MB }];
  const catalog = { series: { dex: { t: { en: "Dexter's Laboratory" }, ch: { 'toon-orbit-gold': ['*'] } } }, episodes: [{ id: 'e14', s: 'dex', sn: 2, ep: 14, d: 1320, src: [] }] };
  const ov = D.match(catalog, items, { lang: 'en' });
  assert.equal(ov.extra.e14[0].r, 'L2', 'small H.264 480p beats 1080p DTS and HEVC');
  assert.ok(ov.episodes.some(e => e.s === 'dex' && e.ep === 15), 'missing episode joins the show on its channel');
  assert.ok(ov.episodes.some(e => e.s.startsWith('db-some-unknown')), 'unknown show goes to My Library');
  assert.equal(ov.stats.matched, 2);
});

test('non-shows are rejected, numbered episodes kept', async () => {
  const { notAShow } = await import('../src/titles.mjs');
  assert.ok(notAShow('Bringing Tenchi Muyo Back to Life | RetroCrush Chat Ep. 2', 'comet'));
  assert.ok(notAShow('GUNDAM Showcase - Gundam Wing Panel | SDCC 2025', 'comet'));
  assert.ok(notAShow('The Rise, Fall and Rise Again of Toonami', 'comet'));
  assert.ok(notAShow('Cyber Team In Akihabara Legendado [PT-BR] episodio 9', 'japan-2000'));
  assert.ok(notAShow('مقابلة | عبدالرحمن العقل يكشف أسرار شخصية عبسي', 'planet-toon'));
  assert.equal(notAShow('Malcolm in the Middle/Season 2/S02E06 - Convention', 'after-school'), '');
  assert.equal(notAShow('Powerpuff Girls - 05,11 - A Documentary', 'cartoon-city'), '');
  assert.equal(notAShow('Toonami - 2002-11-05 - Dragon Ball, Dragon Ball Z, He-Man', 'comet'), '');
  assert.equal(notAShow('X-Play review of Halo 2', 'gamezone'), '');
});

test('Arabic explanation and commentary videos are not shows', async () => {
  const { notAShow } = await import('../src/titles.mjs');
  for (const t of ['شرح قضية المحقق كونان الحلقة 50', 'ملخص انمي المحقق كونان', 'تحليل شخصية كونان', 'أسرار غرندايزر'])
    assert.ok(notAShow(t, 'spacetoon-zaman'), t);
  assert.equal(notAShow('المحقق كونان الحلقة 12 مدبلج', 'spacetoon-zaman'), '');
});
