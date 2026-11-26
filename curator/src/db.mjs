// The content database: one JSON file in git, so every change is reviewable
// and the nightly job's edits show up as a normal diff.
//
// library.json = { series: {id: Series}, episodes: {id: Episode}, sources: {id: Source} }
// Source ids are "<provider>:<ref>", which makes duplicates impossible.
import path from 'node:path';
import { DATA, readJSON, writeJSON, nowIso, hash } from './util.mjs';
import { fingerprint, normalize } from './titles.mjs';

const FILE = path.join(DATA, 'library.json');

export function open() {
  const lib = readJSON(FILE, null) || { version: 1, series: {}, episodes: {}, sources: {} };
  lib.series ||= {}; lib.episodes ||= {}; lib.sources ||= {};
  return new Library(lib);
}

export class Library {
  constructor(data) {
    this.d = data;
    this.byFingerprint = new Map();
    for (const e of Object.values(data.episodes)) this.byFingerprint.set(e.fingerprint, e.id);
  }
  save() { this.d.updated = nowIso(); writeJSON(FILE, this.d); }

  seriesId(title, year) { return 's-' + hash(normalize(title) + '|' + (year || '')); }

  upsertSeries({ title_en, title_ar, title_ja, year, kind, language, dub, subs, channel, tags, fill, tvmaze }) {
    const id = this.seriesId(title_en || title_ar || title_ja, year);
    const s = this.d.series[id] ||= {
      id, titles: { en: title_en || '', ar: title_ar || '', ja: title_ja || '' }, year: year || null,
      kind: kind || 'series', language: language || '', dub: dub || '', subs: subs || '', channels: {}, created: nowIso()
    };
    for (const k of ['en', 'ar', 'ja']) { const v = { en: title_en, ar: title_ar, ja: title_ja }[k]; if (v && !s.titles[k]) s.titles[k] = v; }
    if (channel) {
      const cur = new Set(s.channels[channel] || []);
      for (const t of tags || ['*']) cur.add(t);
      s.channels[channel] = [...cur];
    }
    if (fill) s.fill = true;
    if (tvmaze && !s.tvmaze) s.tvmaze = tvmaze;
    return s;
  }

  // Returns the existing episode when the fingerprint matches (cross-provider de-dupe).
  upsertEpisode({ series, season, episode, title_en, title_ar, title_ja, year, language, dub, subs, duration, quality }) {
    const fp = fingerprint(series, season, episode, title_en || title_ar || title_ja || '', duration);
    const existing = this.byFingerprint.get(fp);
    if (existing) {
      const e = this.d.episodes[existing];
      if (!e.duration && duration) e.duration = duration;
      return e;
    }
    const id = 'e-' + hash(fp);
    const e = this.d.episodes[id] = {
      id, series, season: season || 0, episode: episode || 0,
      titles: { en: title_en || '', ar: title_ar || '', ja: title_ja || '' },
      year: year || null, language: language || '', dub: dub || '', subs: subs || '',
      duration: duration || 0, quality: quality || '', fingerprint: fp, created: nowIso()
    };
    this.byFingerprint.set(fp, id);
    return e;
  }

  addSource(episodeId, src) {
    const id = `${src.provider}:${src.ref}`;
    const existing = this.d.sources[id];
    if (existing) return existing; // never duplicate a link
    return this.d.sources[id] = {
      id, episode: episodeId, provider: src.provider, ref: src.ref, url: src.url || '', kind: src.kind,
      authorization: src.authorization || 'unknown', auth_note: src.auth_note || '', uploader: src.uploader || '',
      quality: src.quality || '', duration: src.duration || 0, offset: src.offset || 0,
      embeddable: src.embeddable ?? null, seekable: src.seekable ?? true,
      regions: src.regions || null, status: src.status || 'pending', reliability: 0.5,
      ...(src.provider === 'archive' ? { archive_id: src.ref.split('/')[0], file: src.ref.split('/').slice(1).join('/') || null,
        recorded: src.recorded || null, uploaded: src.uploaded || null } : {}),
      fail_count: 0, last_ok: null, last_try: null, next_check: null, last_error: '', history: [], created: nowIso()
    };
  }

  sourcesOf(episodeId) { return Object.values(this.d.sources).filter(s => s.episode === episodeId); }
}
