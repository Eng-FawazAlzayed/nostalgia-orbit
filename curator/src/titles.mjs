// Deterministic title parsing: series name, season/episode numbers, language hints.
// No AI needed for the common cases.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function westernDigits(s) {
  return String(s || '').replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));
}

export function hasArabic(s) { return /[؀-ۿ]/.test(s || ''); }
export function hasJapanese(s) { return /[぀-ヿ一-龯]/.test(s || ''); }

export function normalize(s) {
  return westernDigits(s).toLowerCase()
    .replace(/[ً-ْـ]/g, '')          // Arabic diacritics and tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\b(full episodes?|official|hd|hq|1080p|720p|480p|remastered|4k)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

const PATTERNS = [
  /\bS(?:eason)?\s*(\d{1,2})\s*[,\-–:|]?\s*E(?:p(?:isode)?)?\.?\s*(\d{1,4})\b/i, // S1E2, Season 1 Episode 2
  /\b(\d{1,2})x(\d{1,3})\b/,                                                  // 1x02
];
const EP_ONLY = [
  /\bEp(?:isode)?\.?\s*#?\s*(\d{1,4})\b/i,
  /الحلقة\s*(?:رقم\s*)?(\d{1,4})/,           // Arabic "episode"
  /حلقة\s*(\d{1,4})/,
  /第\s*(\d{1,4})\s*[話回]/,                    // Japanese "episode N"
  /#\s*(\d{1,4})\b/
];
const SEASON_ONLY = [/\bSeason\s*(\d{1,2})\b/i, /الموسم\s*(?:ال)?(\d{1,2})/, /الجزء\s*(\d{1,2})/];

export function parseEpisode(title) {
  const t = westernDigits(title);
  for (const re of PATTERNS) { const m = re.exec(t); if (m) return { season: +m[1], episode: +m[2] }; }
  let season = 0, episode = 0;
  for (const re of SEASON_ONLY) { const m = re.exec(t); if (m) { season = +m[1]; break; } }
  for (const re of EP_ONLY) { const m = re.exec(t); if (m) { episode = +m[1]; break; } }
  return { season, episode };
}

export function guessLanguage(title, description = '') {
  const s = title + ' ' + description;
  if (hasArabic(title)) return 'ar';
  if (hasJapanese(title)) return 'ja';
  if (/\b(arabic|عربي)\b/i.test(s)) return 'ar';
  return 'en';
}
export function isDub(title) { return /مدبلج|dubbed|\bdub\b/i.test(title); }

// One identity per real-world episode, so the same episode from YouTube and
// the Internet Archive becomes one episode with two sources.
export function fingerprint(seriesId, season, episode, title, duration) {
  if (episode) return `${seriesId}|s${season || 0}e${episode}`;
  const bucket = Math.round((duration || 0) / 60);
  return `${seriesId}|t:${normalize(title).slice(0, 60)}|${bucket}`;
}

// Words that mark clips, trailers and compilations we don't want as "episodes".
export function looksLikeClip(title) {
  return /\b(clip|trailer|teaser|promo|shorts?|reaction|review of|tiktok|#shorts|best moments|top \d+)\b/i.test(title);
}
