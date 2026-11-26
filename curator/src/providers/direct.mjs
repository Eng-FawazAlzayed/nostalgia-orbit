// Direct MP4 files and HLS streams (free-to-air broadcasters, official live feeds).
// Playable means: the server answers, and the bytes look like video / a playlist.
import { http } from '../util.mjs';
import { record, rateLimit } from '../budget.mjs';

export async function check(url, kind) {
  await rateLimit('http');
  const res = await http(url, { headers: kind === 'hls' || kind === 'live' ? {} : { range: 'bytes=0-2047' } }, { timeout: 15000 });
  record('http', 1);
  if (!res.ok && res.status !== 206) {
    const perm = res.status === 404 || res.status === 410 || res.status === 451;
    return { ok: false, permanent: perm, code: res.status ? 'http' + res.status : 'network' };
  }
  const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
  if (kind === 'hls' || kind === 'live' || /\.m3u8/.test(url)) {
    const text = await res.text();
    if (!text.startsWith('#EXTM3U')) return { ok: false, permanent: false, code: 'not-hls' };
    return { ok: true, code: 'ok', live: !/#EXT-X-ENDLIST/.test(text) };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const isMp4 = buf.length > 8 && String.fromCharCode(...buf.slice(4, 8)) === 'ftyp';
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45;
  if (!isMp4 && !isWebm && !ct.startsWith('video/')) return { ok: false, permanent: false, code: 'not-video' };
  return { ok: true, code: 'ok' };
}
