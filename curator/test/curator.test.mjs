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
  const ser = L.upsertSeries({ title_en: 'Show', channel: 'rebound', tags: ['day'] });
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
  let c = compact(L, [{ id: 'rebound' }], now);
  assert.equal(c.episodes.length, 1);
  assert.deepEqual(c.episodes[0].src.map(s => s.p), ['yt']);
  applyResult(b, { ok: true, code: 'ok', duration: 1290, url: b.url }, 'batch', now);
  c = compact(L, [{ id: 'rebound' }], now);
  assert.equal(c.episodes[0].src.length, 2, 'backup link included');
  for (const s of [a, b]) { s.last_ok = null; applyResult(s, { ok: false, permanent: true, code: 'removed' }, 'batch', now); }
  assert.equal(compact(L, [{ id: 'rebound' }], now).episodes.length, 0);
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
