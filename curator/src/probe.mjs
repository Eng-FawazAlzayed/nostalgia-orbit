// Check which video codec Internet Archive files really use. Browsers and TVs only play
// H.264 reliably; an HEVC or MPEG-4 Part 2 file shows NO SIGNAL. One file per Archive item
// is probed with ffprobe (it reads only the header over HTTP), and the result applies to
// every file in that item.
import { execFile } from 'node:child_process';
import { log } from './util.mjs';

function ffprobe(url) {
  return new Promise(res => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt', '-of', 'json', '-rw_timeout', '20000000', url],
      { timeout: 45000 }, (err, out) => {
        if (err) return res({ error: String(err.message || err).slice(0, 120) });
        try { const s = JSON.parse(out).streams?.[0] || {}; res({ codec: s.codec_name || '', profile: s.profile || '', pix: s.pix_fmt || '' }); }
        catch { res({ error: 'parse' }); }
      });
  });
}

export async function probe(lib, { max = 800 } = {}) {
  const codecs = lib.d.ia_codec ||= {};
  const byItem = new Map();
  for (const s of Object.values(lib.d.sources)) {
    if (s.provider !== 'archive' || !s.archive_id || !s.url || s.status !== 'ok') continue;
    if (!byItem.has(s.archive_id)) byItem.set(s.archive_id, s.url);
  }
  let n = 0; const tally = {};
  for (const [id, url] of byItem) {
    if (codecs[id] && !codecs[id].error) continue;
    if (n++ >= max) break;
    const r = await ffprobe(url);
    codecs[id] = { ...r, at: new Date().toISOString().slice(0, 10) };
    const k = r.error ? 'error' : r.codec + (r.pix && r.pix !== 'yuv420p' ? '/' + r.pix : '');
    tally[k] = (tally[k] || 0) + 1;
  }
  log('probe: ' + JSON.stringify(tally));
  return { probed: n, tally };
}

// Plays on browsers, phones and 2017 Samsung TVs: H.264 in 8-bit 4:2:0.
export function playableCodec(c) {
  if (!c || c.error) return true; // unknown: give it the benefit of the doubt
  return c.codec === 'h264' && (!c.pix || c.pix === 'yuv420p' || c.pix === 'yuvj420p') && !/high 10|high 4:2:2|high 4:4:4/i.test(c.profile || '');
}
