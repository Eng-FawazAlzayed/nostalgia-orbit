// Supabase Edge Function: "gateway"
//
// Two jobs, both of which the browser cannot do on its own:
//
//  1. ?what=at&page=<arabic-toons episode page>
//     arabic-toons.com sends no CORS headers and X-Frame-Options: SAMEORIGIN, so a web page can
//     neither fetch it nor embed it. This function fetches the page server-side and returns the
//     signed MP4 URL for the player.
//
//  2. ?what=stream&tt=tt0123456&s=1&e=2
//     Asks Torrentio for the episode using the Real-Debrid / TorBox keys kept in this project's
//     secrets, and returns only the cached ([RD+]/[TB+]) streams. The keys never reach a browser,
//     so family devices get the streams without being able to read or copy the tokens.
//
// Deploy: see supabase/README.md. Secrets: RD_TOKEN, TB_TOKEN, GATEWAY_KEY (a passphrase you pick).
//
// Nothing here is cached or logged; it is a pass-through for a request the browser made anyway.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const AT_BASE = 'https://www.arabic-toons.com/';
const TI = 'https://torrentio.strem.fun';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function isCached(name: string) {
  return /\[(RD|TB|PM|AD|DL|ED|OC|PU|HW)\+\]/i.test(name || '');
}

function isErrorStream(s: { name?: string; title?: string; url?: string }) {
  return /error|invalid/i.test((s.name || '') + ' ' + (s.title || '')) || /failed_access/.test(s.url || '');
}

async function arabicToons(page: string) {
  if (!/^https:\/\/www\.arabic-toons\.com\/[A-Za-z0-9._\-]+\.html$/.test(page)) {
    return json({ error: 'bad page url' }, 400);
  }
  const res = await fetch(page, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html',
      Referer: AT_BASE
    }
  });
  if (!res.ok) return json({ error: 'upstream ' + res.status }, 502);
  const html = await res.text();
  const m = /videoSrc\s*=\s*"([^"]+)"/.exec(html);
  if (!m) return json({ error: 'no source on page' }, 404);
  return json({ url: m[1].replace(/&amp;/g, '&') });
}

async function streams(tt: string, s: string, e: string) {
  if (!/^tt\d{5,9}$/.test(tt) || !/^\d{1,3}$/.test(s) || !/^\d{1,4}$/.test(e)) {
    return json({ error: 'bad id' }, 400);
  }
  const addons: { tag: string; url: string }[] = [];
  const rd = Deno.env.get('RD_TOKEN');
  const tb = Deno.env.get('TB_TOKEN');
  if (rd) addons.push({ tag: 'RD', url: TI + '/realdebrid=' + encodeURIComponent(rd) });
  if (tb) addons.push({ tag: 'TB', url: TI + '/torbox=' + encodeURIComponent(tb) });
  if (!addons.length) return json({ error: 'no tokens configured' }, 500);

  const lists = await Promise.all(addons.map(async (a) => {
    try {
      const r = await fetch(a.url + '/stream/series/' + tt + ':' + s + ':' + e + '.json', {
        headers: { Accept: 'application/json' }
      });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.streams || []).map((x: Record<string, unknown>) => ({ ...x, tag: a.tag }));
    } catch {
      return [];
    }
  }));

  const all = lists.flat().filter((x: Record<string, string>) =>
    isCached(x.name) && x.url && !isErrorStream(x));
  all.sort((a: Record<string, string>, b: Record<string, string>) => {
    const ha = /h\.?26[45]|hevc|x265/i.test(a.title || '') ? 1 : 0;
    const hb = /h\.?26[45]|hevc|x265/i.test(b.title || '') ? 1 : 0;
    return ha - hb;
  });
  return json({
    count: all.length,
    streams: all.slice(0, 12).map((x: Record<string, string>) => ({
      tag: x.tag, url: x.url, name: x.name, title: x.title,
      k: /\.m3u8(\?|$)/.test(x.url) ? 'hls' : 'file'
    }))
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const u = new URL(req.url);

  const key = Deno.env.get('GATEWAY_KEY');
  if (key && u.searchParams.get('key') !== key) return json({ error: 'forbidden' }, 403);

  const what = u.searchParams.get('what');
  try {
    if (what === 'at') return await arabicToons(u.searchParams.get('page') || '');
    if (what === 'stream') {
      return await streams(u.searchParams.get('tt') || '', u.searchParams.get('s') || '', u.searchParams.get('e') || '');
    }
    if (what === 'ping') return json({ ok: true, ru: !!Deno.env.get('RD_TOKEN'), tb: !!Deno.env.get('TB_TOKEN') });
    return json({ error: 'unknown what' }, 400);
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
