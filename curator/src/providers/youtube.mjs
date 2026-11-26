// YouTube via the official Data API v3 (free key, 10,000 units/day).
// videos.list checks 50 videos for 1 unit, so link checks are very cheap.
// Without a key we fall back to oEmbed, which needs no key at all.
import { http, isoDuration } from '../util.mjs';
import { canSpend, record, cached, rateLimit } from '../budget.mjs';

const API = 'https://www.googleapis.com/youtube/v3/';
const key = () => process.env.YOUTUBE_API_KEY || '';

async function api(endpoint, params, units, { essential = false } = {}) {
  if (!key()) return { error: 'no-key' };
  if (!canSpend('youtube', units, { essential })) return { error: 'budget' };
  await rateLimit('youtube');
  const qs = new URLSearchParams({ ...params, key: key() });
  const res = await http(API + endpoint + '?' + qs);
  record('youtube', units, endpoint);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason || '';
    return { error: res.status ? `http${res.status}${reason ? ':' + reason : ''}` : 'network', temporary: !res.status || res.status >= 500 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded' };
  }
  return { data: await res.json() };
}

// Turn a videos.list item into a check result.
export function judge(item, region = 'KW') {
  if (!item) return { ok: false, permanent: true, code: 'removed' };
  const st = item.status || {}, cd = item.contentDetails || {};
  if (st.privacyStatus === 'private') return { ok: false, permanent: true, code: 'private' };
  if (st.uploadStatus && st.uploadStatus !== 'processed') return { ok: false, permanent: st.uploadStatus === 'rejected' || st.uploadStatus === 'deleted', code: 'upload-' + st.uploadStatus };
  if (st.embeddable === false) return { ok: false, permanent: true, code: 'not-embeddable' };
  if (cd.contentRating?.ytRating === 'ytAgeRestricted') return { ok: false, permanent: true, code: 'age-restricted' };
  const rr = cd.regionRestriction || {};
  const regions = (rr.allowed || rr.blocked) ? { a: rr.allowed || [], b: rr.blocked || [] } : null;
  if (rr.blocked?.includes(region) || (rr.allowed && !rr.allowed.includes(region))) return { ok: false, permanent: true, code: 'blocked-' + region, regions };
  const live = item.snippet?.liveBroadcastContent === 'live';
  return {
    ok: true, code: 'ok', regions, live,
    duration: isoDuration(cd.duration), quality: cd.definition === 'hd' ? '720' : '480',
    title: item.snippet?.title || '', uploader: item.snippet?.channelTitle || '', channelId: item.snippet?.channelId || '',
    published: item.snippet?.publishedAt || '', description: (item.snippet?.description || '').slice(0, 300)
  };
}

// Check up to 50 ids per unit. Returns Map(id -> result).
export async function checkMany(ids, { essential = true } = {}) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await api('videos', { part: 'status,contentDetails,snippet', id: chunk.join(','), maxResults: 50 }, 1, { essential });
    if (r.error) {
      if (r.error === 'no-key') { for (const id of chunk) out.set(id, await oembed(id)); continue; }
      for (const id of chunk) out.set(id, { ok: false, permanent: false, code: r.error });
      continue;
    }
    const found = new Map((r.data.items || []).map(it => [it.id, it]));
    for (const id of chunk) out.set(id, judge(found.get(id)));
  }
  return out;
}

// Keyless fallback: tells removed (404) and embed-disabled (401/403) apart.
export async function oembed(id) {
  await rateLimit('youtube');
  const res = await http('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
  record('http', 1, 'oembed');
  if (res.ok) { const j = await res.json().catch(() => ({})); return { ok: true, code: 'ok-oembed', title: j.title || '', uploader: j.author_name || '' }; }
  if (res.status === 404 || res.status === 400) return { ok: false, permanent: true, code: 'removed' };
  if (res.status === 401 || res.status === 403) return { ok: false, permanent: true, code: 'not-embeddable' };
  return { ok: false, permanent: false, code: res.status ? 'http' + res.status : 'network' };
}

export async function channelByHandle(handle) {
  return cached('yt:handle:' + handle.toLowerCase(), 24 * 30, async () => {
    const r = await api('channels', { part: 'contentDetails,snippet', forHandle: handle.replace(/^@/, '') }, 1);
    const it = r.data?.items?.[0];
    return it ? { id: it.id, title: it.snippet.title, uploads: it.contentDetails.relatedPlaylists.uploads } : (r.error ? null : { missing: true });
  });
}

// All video ids in a playlist (1 unit per 50). Cached for a week.
export async function playlistIds(playlistId, maxItems = 2000) {
  return cached('yt:pl:' + playlistId + ':' + maxItems, 24 * 7, async () => {
    const ids = []; let pageToken = '';
    while (ids.length < maxItems) {
      const r = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, ...(pageToken && { pageToken }) }, 1);
      if (r.error) return ids.length ? ids : null;
      for (const it of r.data.items || []) ids.push(it.contentDetails.videoId);
      pageToken = r.data.nextPageToken; if (!pageToken) break;
    }
    return ids;
  });
}

// search.list costs 100 units: always cache-first (30 days), never essential.
export async function search(q, { maxResults = 50, duration = 'medium', lang } = {}) {
  return cached('yt:search:' + q + ':' + duration + ':' + (lang || ''), 24 * 30, async () => {
    const params = { part: 'id', q, type: 'video', maxResults, videoEmbeddable: 'true', regionCode: 'KW', safeSearch: 'none' };
    if (duration) params.videoDuration = duration; // short <4m, medium 4–20m, long >20m
    if (lang) params.relevanceLanguage = lang;
    const r = await api('search', params, 100);
    if (r.error) return null;
    return (r.data.items || []).map(it => it.id.videoId).filter(Boolean);
  });
}

// Playlists matching a query, with their titles and sizes (100 + 1 units, cached 30 days).
// Big fan-made "full episodes" playlists hold a whole show for the price of one search.
export async function searchPlaylists(q, { maxResults = 15, lang } = {}) {
  return cached('yt:plsearch:' + q + ':' + (lang || ''), 24 * 30, async () => {
    const params = { part: 'snippet', q, type: 'playlist', maxResults, regionCode: 'KW' };
    if (lang) params.relevanceLanguage = lang;
    const r = await api('search', params, 100);
    if (r.error) return null;
    const lists = (r.data.items || []).map(it => ({ id: it.id.playlistId, title: it.snippet?.title || '', channel: it.snippet?.channelTitle || '' })).filter(p => p.id);
    if (!lists.length) return [];
    const d = await api('playlists', { part: 'contentDetails', id: lists.map(p => p.id).join(','), maxResults: 50 }, 1);
    const size = {}; for (const it of (d.data?.items || [])) size[it.id] = it.contentDetails?.itemCount || 0;
    return lists.map(p => ({ ...p, count: size[p.id] || 0 }));
  });
}
