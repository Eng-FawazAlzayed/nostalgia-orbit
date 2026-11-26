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

// Words that mark clips, trailers, compilations and live streams we don't want as "episodes".
const CLIP_EN = /\b(clips?|trailer|teaser|promo|shorts?|reaction|review of|tiktok|best moments|moments|top \d+|compilations?|marathon|mashup|supercut|recap|best of|every time|funniest|scariest|creepiest|craziest|trivia|live|livestream|vol\.?\s*\d+|\d+\s*(?:hours?|hrs?|minutes?|mins?)\s+of|hour of|non-?stop|back to back|behind the scenes|sneak peek|music video|lyric video|unboxing|asmr|challenge|podcast|scene|scenes)\b/i;
const CLIP_OTHER = /#shorts|تجميع|مقاطع|مقطع|لحظات|اعلان|إعلان|بث مباشر|مباشر|ساعة كاملة|ساعات|まとめ|切り抜き|予告|ライブ配信|生配信/;
const EMOJI = /\p{Extended_Pictographic}/u;
export function looksLikeClip(title) {
  const t = title || '';
  if (CLIP_EN.test(t) || CLIP_OTHER.test(t)) return true;
  // Official channels decorate clip and compilation titles with emoji; real episode uploads rarely do.
  return EMOJI.test(t) && !parseEpisode(t).episode && !/full episode|الحلقة|حلقة/i.test(t);
}

// Find which known show a title belongs to. shows: ["Dexter's Laboratory", {"name": "Captain Majid", "match": ["كابتن ماجد"]}]
export function matchShow(title, shows) {
  const t = ' ' + normalize(title) + ' ';
  let best = null, bestLen = 0;
  for (const sh of shows || []) {
    const name = typeof sh === 'string' ? sh : sh.name;
    const alts = [name].concat(typeof sh === 'string' ? [] : sh.match || []);
    for (const a of alts) {
      const n = normalize(a);
      if (n && n.length > bestLen && t.includes(' ' + n + ' ')) { best = name; bestLen = n.length; }
    }
  }
  return best;
}

// Things that are not a TV show at all: podcasts, panels, interviews, reviews, documentaries about
// a show, game footage, fan edits, openings. Applied to every seed (even allow_clips ones such as
// Toonami broadcast tapes). Gaming and internet channels air review and gameplay shows, so they
// only drop the most obvious non-shows.
const NOT_SHOW = /\b(podcasts?|chat ep|panel|interviews?|documentary|retrospective|rise,? (?:and )?fall|history of|the story of|explained|analysis|video essay|reviews?|reaction|reacts?|gameplay|let'?s play|playthrough|walkthrough|play to watch|trailers?|teaser|unboxing|showcase|sdcc|comic-?con|convention|ranking|ranked|tier list|top \d+|special program|making of|behind the scenes|commentary|discussion|q ?& ?a|soundtrack|ost|openings?|endings?|intros?|outros?|amv|fan ?made|fan ?dub|parody|abridged|ytp|cosplay|vtuber|stream)\b|بودكاست|مقابلة|ردة فعل|مراجعة|وثائقي|برومو|تريلر|افتتاحية|شارة|تتر|対談|インタビュー|実況|レビュー|ラジオ/i;
const NOT_SHOW_LIGHT = /\b(podcasts?|chat ep|reaction|reacts?|tier list|ranking|ranked|amv|ytp|vtuber)\b|بودكاست|ردة فعل/i;
const LIGHT_CHANNELS = new Set(['gamezone', 'player-2', 'byte-shop', 'internet-2006', 'rewind-web']);
// Other-language dubs on English and Arabic channels (Arabic dubs are wanted, so they are not listed).
const FOREIGN_DUB = /\b(german dub|deutsch|brasil|brazil|dublado|legendado|latino|español|espanol|castellano|french dub|français|vf|italiano|portugu[eê]s|polski|русский|türkçe)\b/i;

export function notAShow(title, channelId) {
  const t = title || '';
  // A numbered episode whose own title happens to be "Convention" or "A Documentary" is still an episode.
  const numbered = /\bS\d+\s*E\d+|\b\d{1,2},\d{1,2}\b|\bepisode \d+|\bep\.? ?\d+/i.test(t);
  if ((LIGHT_CHANNELS.has(channelId) || numbered ? NOT_SHOW_LIGHT : NOT_SHOW).test(t)) return 'not a show';
  if (FOREIGN_DUB.test(t)) return 'other language';
  return '';
}
