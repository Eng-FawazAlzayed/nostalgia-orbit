/*
 * Real-Debrid and TorBox: your own cloud library as an extra source for the channels.
 * ES5 for 2017 Samsung TVs. Runs entirely on the device: the token is stored on this
 * device only (never sent anywhere except the provider's own API), nothing goes
 * through GitHub or any server of ours.
 *
 * What it does:
 *  - TV-friendly sign-in (device code shown on screen) or a pasted API token
 *  - reads the files already in YOUR account (it never adds torrents or searches for any)
 *  - recognises show / season / episode, resolution, codec, audio, language and subtitles
 *    from file names, and keeps the smallest file that will play well on this device
 *  - attaches those files to matching shows on the channels, or to channel 099 if unknown
 */
(function (root) {
  'use strict';

  var RD = 'https://api.real-debrid.com';
  var RD_CLIENT = 'X245A4XAIBGVM'; // Real-Debrid's published client id for open-source apps (device flow)
  var TB = 'https://api.torbox.app/v1/api';
  var VIDEO = /\.(mp4|m4v|mkv|webm|avi|ts|mov|wmv)$/i;

  function store() { return root.NOStore || { load: function () { return null; }, save: function () {} }; }
  function cfg() { return root.NOConfig ? root.NOConfig() : {}; }
  function setCfg(k, v) { if (root.NOSetConfig) { root.NOSetConfig(k, v); } }

  function xhr(method, url, opt, cb) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.timeout = opt.timeout || 20000;
    var h = opt.headers || {};
    for (var k in h) { if (h.hasOwnProperty(k)) { x.setRequestHeader(k, h[k]); } }
    x.onload = function () {
      var j = null; try { j = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) {}
      if (x.status >= 200 && x.status < 300) { return cb(null, j, x.status); }
      var err = new Error((j && (j.error || j.detail)) || ('http ' + x.status)); err.status = x.status; err.body = j; cb(err, j, x.status);
    };
    x.onerror = x.ontimeout = function () { var e = new Error('network'); e.status = 0; cb(e); };
    x.send(opt.body || null);
  }
  function form(o) { var a = [], k; for (k in o) { if (o.hasOwnProperty(k)) { a.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); } } return a.join('&'); }

  /* ---------------- sign-in ---------------- */

  // Real-Debrid access token: a pasted private token, or the device-flow token (refreshed when it expires).
  function rdToken(cb) {
    var c = cfg();
    if (c.rdToken) { return cb(null, c.rdToken); }
    var a = c.rdAuth;
    if (!a || !a.refresh) { return cb(new Error('realdebrid-not-set')); }
    if (a.access && a.exp > Date.now() + 60000) { return cb(null, a.access); }
    xhr('POST', RD + '/oauth/v2/token', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: a.cid, client_secret: a.csec, code: a.refresh, grant_type: 'http://oauth.net/grant_type/device/1.0' }) },
    function (err, j) {
      if (err || !j || !j.access_token) { return cb(err || new Error('realdebrid-refresh')); }
      a.access = j.access_token; a.refresh = j.refresh_token || a.refresh; a.exp = Date.now() + (j.expires_in || 3600) * 1000;
      setCfg('rdAuth', a); cb(null, a.access);
    });
  }
  function tbToken(cb) { var t = cfg().torboxToken; return t ? cb(null, t) : cb(new Error('torbox-not-set')); }

  var polling = null;
  function stopLogin() { if (polling) { clearTimeout(polling); polling = null; } }

  // onCode(url, code) shows the code on screen; done(err) when signed in, failed or timed out.
  function login(provider, onCode, done) {
    stopLogin();
    if (provider === 'rd') {
      xhr('GET', RD + '/oauth/v2/device/code?client_id=' + RD_CLIENT + '&new_credentials=yes', {}, function (err, j) {
        if (err || !j || !j.device_code) { return done(err || new Error('realdebrid-device')); }
        onCode(j.verification_url || 'https://real-debrid.com/device', j.user_code);
        var until = Date.now() + (j.expires_in || 600) * 1000, every = Math.max(5, j.interval || 5) * 1000;
        (function poll() {
          if (Date.now() > until) { return done(new Error('code expired')); }
          polling = setTimeout(function () {
            xhr('GET', RD + '/oauth/v2/device/credentials?client_id=' + RD_CLIENT + '&code=' + encodeURIComponent(j.device_code), {}, function (e2, cr) {
              if (e2 || !cr || !cr.client_secret) { return poll(); } // not approved yet
              xhr('POST', RD + '/oauth/v2/token', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ client_id: cr.client_id, client_secret: cr.client_secret, code: j.device_code, grant_type: 'http://oauth.net/grant_type/device/1.0' }) },
              function (e3, tk) {
                if (e3 || !tk || !tk.access_token) { return done(e3 || new Error('realdebrid-token')); }
                setCfg('rdAuth', { cid: cr.client_id, csec: cr.client_secret, access: tk.access_token, refresh: tk.refresh_token, exp: Date.now() + (tk.expires_in || 3600) * 1000 });
                done(null);
              });
            });
          }, every);
        }());
      });
      return;
    }
    // TorBox device flow: the result is your API key, kept on this device.
    xhr('GET', TB + '/user/auth/device/start?app=NostalgiaOrbit', {}, function (err, j) {
      var d = j && (j.data || j);
      if (err || !d || !d.device_code) { return done(err || new Error('torbox-device')); }
      onCode(d.friendly_verification_url || d.verification_url || 'https://torbox.app/device', d.code || d.user_code);
      var until = Date.now() + 600000, every = Math.max(5, d.interval || 5) * 1000;
      (function poll() {
        if (Date.now() > until) { return done(new Error('code expired')); }
        polling = setTimeout(function () {
          xhr('POST', TB + '/user/auth/device/token', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code: d.device_code }) }, function (e2, t) {
            var v = t && t.data;
            var key = typeof v === 'string' ? v : v && (v.token || v.api_key || v.access_token || v.apikey);
            if (key) { setCfg('torboxToken', key); return done(null); }
            var code = (t && (t.error || t.detail)) || (e2 && e2.message) || '';
            if (/ITEM_NOT_FOUND/.test(code)) { return done(new Error('code expired')); }
            poll(); // DEVICE_CODE_NOT_USED: keep waiting
          });
        }, every);
      }());
    });
  }

  /* ---------------- reading your library ---------------- */

  function rdList(cb) {
    rdToken(function (err, tok) {
      if (err) { return cb(err); }
      var H = { Authorization: 'Bearer ' + tok }, all = [], page = 1;
      (function next() {
        xhr('GET', RD + '/rest/1.0/torrents?limit=500&page=' + page, { headers: H }, function (e, list, st) {
          if (e && st !== 204) { return cb(e); }
          list = list || [];
          for (var i = 0; i < list.length; i++) { if (list[i].status === 'downloaded') { all.push(list[i]); } }
          if (list.length === 500 && page < 10) { page++; return next(); }
          // torrent details, gently (Real-Debrid allows 250 requests a minute)
          var out = [], k = 0;
          (function info() {
            if (k >= all.length || k >= 400) { return cb(null, out); }
            var t = all[k++];
            xhr('GET', RD + '/rest/1.0/torrents/info/' + t.id, { headers: H }, function (e2, d) {
              if (!e2 && d && d.files) {
                var sel = [], subs = {}, i2, f;
                for (i2 = 0; i2 < d.files.length; i2++) {
                  f = d.files[i2];
                  if (/\.(srt|ass|ssa|vtt|sub)$/i.test(f.path)) { subs[stem(f.path)] = 1; subs._any = 1; }
                  if (f.selected) { sel.push(f); }
                }
                sel.sort(function (a, b) { return a.id - b.id; });
                // Real-Debrid lists one link per selected file, in file order; the link's file name
                // is checked again when it is unrestricted, so a wrong pairing never plays.
                for (i2 = 0; i2 < sel.length && i2 < (d.links || []).length; i2++) {
                  f = sel[i2];
                  if (!VIDEO.test(f.path) || /sample/i.test(f.path)) { continue; }
                  out.push({ pv: 'rd', r: d.links[i2], name: base(f.path), folder: d.filename || '', bytes: f.bytes, subs: !!(subs[stem(f.path)] || subs._any) });
                }
              }
              setTimeout(info, 260);
            });
          }());
        });
      }());
    });
  }

  function tbList(cb) {
    tbToken(function (err, tok) {
      if (err) { return cb(err); }
      var H = { Authorization: 'Bearer ' + tok }, out = [];
      var kinds = [['torrents', 't'], ['usenet', 'u'], ['webdl', 'w']], ki = 0;
      (function nextKind() {
        if (ki >= kinds.length) { return cb(null, out); }
        var kind = kinds[ki++], offset = 0;
        (function page() {
          xhr('GET', TB + '/' + kind[0] + '/mylist?bypass_cache=true&limit=1000&offset=' + offset, { headers: H, timeout: 30000 }, function (e, j) {
            if (e) { if (kind[1] === 't') { return cb(e); } return nextKind(); }
            var list = (j && j.data) || [];
            for (var i = 0; i < list.length; i++) {
              var t = list[i], files = t.files || [], subs = false, i2, f, nm;
              if (t.download_finished === false || t.download_present === false) { continue; }
              for (i2 = 0; i2 < files.length; i2++) { if (/\.(srt|ass|ssa|vtt)$/i.test(files[i2].name || files[i2].short_name || '')) { subs = true; } }
              for (i2 = 0; i2 < files.length; i2++) {
                f = files[i2]; nm = f.short_name || base(f.name || '');
                if (!VIDEO.test(nm) || /sample/i.test(nm)) { continue; }
                out.push({ pv: 'torbox', r: kind[1] + ':' + t.id + ':' + f.id, name: nm, folder: t.name || '', bytes: f.size || 0, subs: subs });
              }
            }
            if (list.length === 1000) { offset += 1000; return page(); }
            nextKind();
          });
        }());
      }());
    });
  }

  /* ---------------- understanding file names ---------------- */

  function base(p) { return String(p).replace(/^.*[\/\\]/, ''); }
  function stem(p) { return base(p).replace(/\.[^.]+$/, '').toLowerCase(); }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '')
      .replace(/[^a-z0-9؀-ۿ぀-ヿ一-鿿]+/g, ' ').replace(/^the /, '').replace(/\s+/g, ' ').replace(/^\s|\s$/g, '');
  }

  // "Dexters.Laboratory.S02E14.480p.DVDRip.x264-AAC.mkv" ->
  // { show: "dexters laboratory", sn: 2, ep: 14, res: 480, codec: "h264", audio: "aac", ... }
  function parse(name, folder) {
    var n = base(name), m, show = '', sn = 0, ep = 0, i;
    var t = n.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ');
    var pats = [/^(.*?)\bS(\d{1,2})\s?E(\d{1,3})/i, /^(.*?)\b(\d{1,2})x(\d{2,3})\b/i, /^(.*?)\bSeason\s?(\d{1,2})\s?Episode\s?(\d{1,3})/i, /^(.*?)\bEp(?:isode)?\s?(\d{1,3})\b/i];
    for (i = 0; i < pats.length; i++) {
      m = t.match(pats[i]);
      if (m) { show = m[1]; if (m.length > 3) { sn = +m[2]; ep = +m[3]; } else { ep = +m[2]; } break; }
    }
    if (!show) { // no episode number: a movie or a special
      show = t.replace(/\b(19|20)\d\d\b.*$/, '').replace(/\b(480p|720p|1080p|2160p|dvdrip|webrip|web-dl|bluray|x264|x265|hevc).*$/i, '');
    }
    if (!norm(show) && folder) { show = String(folder).replace(/[._]+/g, ' ').replace(/\bS\d{1,2}.*$/i, '').replace(/\bSeason.*$/i, ''); }
    show = show.replace(/\b(19|20)\d\d\b/g, ' ').replace(/[\[\(].*?[\]\)]/g, ' ');
    var L = n.toLowerCase();
    var res = (m = L.match(/(2160|1080|720|576|480|360)p/)) ? +m[1] : (/\b(dvdrip|sdtv|tvrip|vhsrip|480)\b/.test(L) ? 480 : 0);
    var codec = /x265|h\.?265|hevc/.test(L) ? 'hevc' : /\bav1\b/.test(L) ? 'av1' : /xvid|divx/.test(L) ? 'mpeg4' : /x264|h\.?264|avc/.test(L) ? 'h264' : '';
    var audio = /\b(truehd|atmos)\b/.test(L) ? 'truehd' : /\bdts/.test(L) ? 'dts' : /e-?ac-?3|ddp|dd\+/.test(L) ? 'eac3' : /\bac-?3|\bdd[\s.]?[25]/.test(L) ? 'ac3' : /\baac/.test(L) ? 'aac' : /\bopus/.test(L) ? 'opus' : '';
    var lang = /\b(arabic|arab|ara)\b/.test(L) ? 'ar' : /\b(japanese|jpn|jap)\b/.test(L) ? 'ja' : /\b(multi|dual)\b/.test(L) ? 'multi' : 'en';
    var ext = (n.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
    return { show: norm(show), sn: sn, ep: ep, res: res, codec: codec, tenbit: /10.?bit|hi10/.test(L), audio: audio, lang: lang, ext: ext, subs: /\bsub(s|bed)?\b/.test(L) };
  }

  // Flexible size targets (MB) by programme length, from your spec.
  function band(sec) {
    var min = sec / 60;
    if (min <= 14) { return [40, 100]; }
    if (min <= 32) { return [80, 220]; }
    if (min <= 60) { return [200, 450]; }
    return [400, 900];
  }
  // Higher is better. Incompatible files score far below zero and are only used as a last resort.
  function score(p, bytes, sec, opt) {
    var mb = bytes / 1048576, b = band(sec || 1320), s = 0;
    if (p.codec === 'h264' || (!p.codec && (p.ext === 'mp4' || p.ext === 'm4v'))) { s += 100; }
    if (p.codec === 'hevc' || p.codec === 'av1' || p.tenbit) { s += opt.hevc ? 40 : -1000; }
    if (p.codec === 'mpeg4' || p.ext === 'avi' || p.ext === 'wmv') { s -= 1000; }
    s += p.ext === 'mp4' || p.ext === 'm4v' ? 30 : p.ext === 'mkv' ? 10 : 0;
    s += p.res === 480 || p.res === 576 ? 40 : p.res === 720 ? 35 : p.res === 360 ? 10 : p.res === 1080 ? 5 : p.res === 2160 ? -300 : 15;
    if (mb >= b[0] && mb <= b[1]) { s += 50; }
    else if (mb < b[0] * 0.5) { s -= 40; }                 // so small it is probably smeared or cut
    else if (mb > b[1]) { s -= Math.min(80, 20 * (mb / b[1])); } // bigger than it needs to be
    s += p.audio === 'aac' ? 15 : p.audio === 'opus' ? 5 : p.audio === 'truehd' || p.audio === 'dts' ? -60 : p.audio === 'eac3' || p.audio === 'ac3' ? (opt.ac3 ? 0 : -25) : 0;
    if (p.lang === opt.lang || p.lang === 'multi') { s += 10; }
    if (p.subs) { s += 2; }
    return s;
  }

  /* ---------------- matching to the channels ---------------- */

  // Returns an overlay for the schedule: extra sources for episodes already on the channels,
  // new episodes for shows that are on the channels, and channel 099 for everything else.
  function match(catalog, items, opt) {
    opt = opt || {};
    var dur = store().load('debridDur', {}) || {};
    var byName = {}, sid, s, t, k, i;
    for (sid in catalog.series) {
      if (!catalog.series.hasOwnProperty(sid)) { continue; }
      s = catalog.series[sid]; if (s.fill) { continue; }
      t = s.t || {};
      for (k in t) { if (t.hasOwnProperty(k) && norm(t[k])) { byName[norm(t[k])] = byName[norm(t[k])] || sid; } }
    }
    var typical = {}, epKey = {}, e;
    for (i = 0; i < catalog.episodes.length; i++) {
      e = catalog.episodes[i];
      (typical[e.s] = typical[e.s] || []).push(e.d);
      if (e.ep) { epKey[e.s + '|' + (e.sn || 0) + '|' + e.ep] = e.id; if (!e.sn) { epKey[e.s + '|1|' + e.ep] = epKey[e.s + '|1|' + e.ep] || e.id; } }
    }
    function median(a) { if (!a || !a.length) { return 0; } a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
    function findSeries(show) {
      if (byName[show]) { return byName[show]; }
      for (var nm in byName) { if (byName.hasOwnProperty(nm) && nm.length >= 5 && (show.indexOf(nm) === 0 || nm.indexOf(show) === 0) && Math.abs(nm.length - show.length) <= 12) { return byName[nm]; } }
      return null;
    }
    var groups = {}, stats = { files: items.length, matched: 0, library: 0, incompatible: 0, bytes: 0, chosen: 0, subs: 0 };
    for (i = 0; i < items.length; i++) {
      var it = items[i], p = parse(it.name, it.folder);
      if (!p.show) { continue; }
      var found = findSeries(p.show);
      var gid = (found || ('db-' + p.show)) + '|' + p.sn + '|' + (p.ep || ('x' + norm(it.name)));
      var sec = dur[it.r] || (found && median(typical[found])) || 1320;
      var sc = score(p, it.bytes, sec, opt);
      if (sc < -500) { stats.incompatible++; }
      (groups[gid] = groups[gid] || { sid: found, p: p, files: [] }).files.push({ it: it, p: p, sc: sc, sec: sec });
    }
    var overlay = { extra: {}, series: {}, episodes: [], stats: stats, channel: { id: 'my-library', n: '099', name: 'MY LIBRARY', ar: 'مكتبتي', work: 'My library', blocks: [{ f: '06:00', t: '06:00', g: '*all' }] } };
    for (var g in groups) {
      if (!groups.hasOwnProperty(g)) { continue; }
      var G = groups[g];
      G.files.sort(function (a, b) { return b.sc - a.sc || a.it.bytes - b.it.bytes; });
      var top = G.files.slice(0, 3); // best file first, two alternatives if it fails
      var src = [];
      for (k = 0; k < top.length; k++) {
        src.push({ p: top[k].it.pv, r: top[k].it.r, k: 'file', a: 'user_owned', rel: top[k].sc > 0 ? 0.95 : 0.3, q: top[k].p.res ? String(top[k].p.res) : '',
          mb: Math.round(top[k].it.bytes / 1048576), n: top[k].it.name, lang: top[k].p.lang, subs: top[k].it.subs || top[k].p.subs || undefined });
      }
      stats.chosen++; stats.bytes += top[0].it.bytes; if (src[0].subs) { stats.subs++; }
      var existing = G.sid && G.p.ep ? (epKey[G.sid + '|' + (G.p.sn || 0) + '|' + G.p.ep] || epKey[G.sid + '|1|' + G.p.ep]) : null;
      if (existing) { overlay.extra[existing] = src; stats.matched++; continue; }
      var sidOut = G.sid;
      if (!sidOut) {
        sidOut = 'db-' + G.p.show.replace(/\s/g, '-');
        if (!overlay.series[sidOut]) { overlay.series[sidOut] = { t: { en: titleCase(G.p.show) }, ch: { 'my-library': ['*'] } }; }
        stats.library++;
      } else { stats.matched++; }
      overlay.episodes.push({ id: 'db-' + hash(g), s: sidOut, sn: G.p.sn || undefined, ep: G.p.ep || undefined,
        t: { en: titleCase(G.p.show) + (G.p.ep ? ' ' + (G.p.sn ? 'S' + G.p.sn + 'E' : 'E') + G.p.ep : '') }, d: top[0].sec, src: src });
    }
    return overlay;
  }
  function titleCase(s) { return String(s).replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function hash(s) { var h = 2166136261, i; for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h.toString(36); }

  // Read every connected account, match, and keep the result on this device.
  function scan(catalog, opt, done) {
    var c = cfg(), jobs = [], items = [], errors = [];
    if (c.rdToken || (c.rdAuth && c.rdAuth.refresh)) { jobs.push(rdList); }
    if (c.torboxToken) { jobs.push(tbList); }
    if (!jobs.length) { return done(new Error('Connect Real-Debrid or TorBox first')); }
    var left = jobs.length;
    for (var i = 0; i < jobs.length; i++) {
      jobs[i](function (err, list) {
        if (err) { errors.push(err.message); } else { items = items.concat(list); }
        if (--left) { return; }
        if (!items.length && errors.length) { return done(new Error(errors.join('; '))); }
        store().save('debridFiles', { at: Date.now(), items: items });
        var ov = match(catalog, items, opt);
        store().save('debridOverlay', ov);
        done(null, ov, errors);
      });
    }
  }
  // Re-match the saved file list (after a channel update) without calling the providers again.
  function rematch(catalog, opt) {
    var f = store().load('debridFiles', null);
    if (!f || !f.items || !f.items.length) { return null; }
    var ov = match(catalog, f.items, opt); store().save('debridOverlay', ov); return ov;
  }
  function rememberDuration(r, sec) {
    if (!r || !(sec > 30)) { return; }
    var d = store().load('debridDur', {}) || {};
    if (Math.abs((d[r] || 0) - sec) < 5) { return; }
    d[r] = Math.round(sec); store().save('debridDur', d);
  }

  root.NODebrid = { login: login, stopLogin: stopLogin, scan: scan, rematch: rematch, match: match, parse: parse, score: score,
    rdToken: rdToken, tbToken: tbToken, rememberDuration: rememberDuration, xhr: xhr, form: form };
}(this));
