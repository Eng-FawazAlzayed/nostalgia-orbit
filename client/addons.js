/*
 * Stremio add-on streams as a channel source (ES5).
 *
 * For CARTOON NETWORK (002), NICKELODEON (006) and DISNEY CHANNEL (007) the episode is
 * resolved through a Stremio add-on — Torrentio configured with the owner's own Real-Debrid
 * and/or TorBox key — and played from the debrid link instead of YouTube / Internet Archive.
 *
 * Rules:
 *  - cached only: Torrentio marks cached streams "[RD+]"/"[TB+]". "[RD download]" entries would
 *    make the account download the torrent, so they are never played.
 *  - the key never leaves this device: it comes from Setup (the same fields debrid.js uses) and
 *    is only sent to the add-on host as part of the add-on URL.
 *  - anything that cannot be resolved falls back to the catalogue's free source, so a channel
 *    never goes dark.
 */
(function (root) {
  'use strict';

  var CINEMETA = 'https://v3-cinemeta.strem.io';
  var TI = 'https://torrentio.strem.fun';
  var DEBRID_CHANNELS = { 'toon-orbit-gold': 1, 'orange-couch': 1, 'magic-hour': 1 };
  var BUCKETS = /^(cartoon network|nickelodeon|disney channel|nicktoons|disney|cn|nick)$/i;
  var STOPW = { the: 1, a: 1, an: 1, of: 1, and: 1, to: 1, in: 1, boy: 1, girl: 1, mr: 1, mrs: 1 };

  var RESOLVED = {};   /* episodeId -> {url, exp} */
  var VIDEOS = {};     /* imdbId -> videos[] */

  function store() { return root.NOStore || { load: function () { return null; }, save: function () {} }; }
  function cfg() { return root.NOConfig ? root.NOConfig() : {}; }
  function xhr(method, url, opt, cb) {
    if (root.NODebrid && root.NODebrid.xhr) { return root.NODebrid.xhr(method, url, opt || {}, cb); }
    cb(new Error('no-xhr'));
  }
  function key(k, dflt) { return store().load(k, dflt); }
  function put(k, v) { store().save(k, v); }

  function wants(channelId) {
    if (cfg().debridAddons === false) { return false; }
    return !!DEBRID_CHANNELS[channelId];
  }

  /* ---------- titles ---------- */
  function cleanName(raw) {
    var t = String(raw || '');
    t = t.replace(/^\s*watch\s+/i, ' ');
    t = t.split('|')[0].split(' - ')[0];
    t = t.replace(/\b(full\s+episode|full|episode|ep\.?|premiere|finale)\b:?/gi, ' ');
    t = t.replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ');
    t = t.replace(/\b(1080p|720p|480p|2160p|4k|hd|web-?dl|h\.?264|hevc|x265|aac)\b/gi, ' ');
    t = t.replace(/[\u201c\u201d"']/g, '').replace(/\(.*?\)/g, ' ');
    return t.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  function normWords(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOPW[w]; });
  }
  function overlap(a, b) {
    var A = normWords(a), B = normWords(b), i, j, n = 0;
    for (i = 0; i < A.length; i++) { for (j = 0; j < B.length; j++) { if (A[i] === B[j]) { n++; } } }
    return n;
  }
  function badMatch(title, matchName) {
    if (BUCKETS.test(String(title || '').trim())) { return 'brand bucket'; }
    if (!matchName) { return 'no name'; }
    return overlap(title, matchName) ? '' : 'no word overlap';
  }

  /* ---------- imdb ---------- */
  function searchImdb(q, cb) {
    var cache = key('addonImdb', {}) || {};
    if (cache[q]) { return cb(cache[q]); }
    xhr('GET', CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json',
      { timeout: 8000 }, function (err, j) {
        if (err || !j) { return cb(null); }
        var m = (j.metas || [])[0];
        if (!m || !m.id) { return cb(null); }
        if (badMatch(q, m.name)) { return cb('reject:' + m.name); }
        cache[q] = m.id; put('addonImdb', cache); cb(m.id);
      });
  }
  function imdbFor(catalog, ep, cb) {
    var s = (catalog.series || {})[ep.s] || {};
    var st = (s.t && s.t.en) || '';
    if (!BUCKETS.test(st)) {
      return searchImdb(st, function (tt) {
        if (tt && tt.indexOf('reject:') !== 0) { return cb(tt); }
        searchImdb(cleanName((ep.t && ep.t.en) || ''), cb);
      });
    }
    /* uploader bucket: the episode title names the actual show */
    searchImdb(cleanName((ep.t && ep.t.en) || ''), cb);
  }

  /* ---------- season / episode ---------- */
  function numFor(catalog, ep, tt, cb) {
    if (ep.sn != null && ep.ep != null) { return cb(ep.sn, ep.ep, 'catalog'); }
    var t = (ep.t && ep.t.en) || '', m;
    m = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/.exec(t);
    if (m) { return cb(+m[1], +m[2], 'title'); }
    m = /[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,3})/i.exec(t);
    if (m) { return cb(+m[1], +m[2], 'title'); }
    m = /(\d{1,2})x(\d{1,3})/.exec(t);
    if (m) { return cb(+m[1], +m[2], 'title'); }
    if (!tt) { return cb(null, null, 'none'); }
    var cache = key('addonNum', {}) || {}, ck = tt + '|' + t;
    if (cache[ck]) { return cb(cache[ck].sn, cache[ck].ep, 'episode list'); }
    if (VIDEOS[tt]) { return matchVideos(VIDEOS[tt]); }
    xhr('GET', CINEMETA + '/meta/series/' + tt + '.json', { timeout: 8000 }, function (err, j) {
      if (err || !j || !j.meta) { return cb(null, null, 'none'); }
      VIDEOS[tt] = j.meta.videos || [];
      matchVideos(VIDEOS[tt]);
    });
    function matchVideos(videos) {
      var Q = cleanName(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      var best = null, score = 0, i;
      for (i = 0; i < videos.length; i++) {
        var N = String(videos[i].name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!N || !Q) { continue; }
        var sc = N === Q ? 1 : (N.indexOf(Q) >= 0 || Q.indexOf(N) >= 0) ? 0.9 : 0;
        if (!sc) {
          var A = Q.split(' '), B = N.split(' '), hit = 0, a;
          for (a = 0; a < A.length; a++) { if (B.indexOf(A[a]) >= 0) { hit++; } }
          sc = (hit / A.length) * 0.8;
        }
        if (sc > score) { score = sc; best = videos[i]; }
      }
      if (score < 0.75 || !best) { return cb(null, null, 'none'); }
      cache[ck] = { sn: best.season, ep: best.number }; put('addonNum', cache);
      cb(best.season, best.number, 'episode list');
    }
  }

  /* ---------- streams ---------- */
  function isCached(s) { return /\[(RD|TB|PM|AD|DL|ED|OC|PU|HW)\+\]/i.test(s.name || ''); }
  function isError(s) {
    return /error|invalid/i.test((s.name || '') + ' ' + (s.title || '')) || /failed_access/.test(s.url || '');
  }
  function sizeOf(t) {
    var m = /([\d.]+)\s*(GB|GiB|MB|MiB)/i.exec(t || '');
    return m ? parseFloat(m[1]) * (/G/i.test(m[2]) ? 1024 : 1) : 0;
  }
  function rank(a, b) {
    var ha = /h\.?26[45]|hevc|x265/i.test(a.title || '') ? 1 : 0;
    var hb = /h\.?26[45]|hevc|x265/i.test(b.title || '') ? 1 : 0;
    return (ha - hb) || (sizeOf(b.title) - sizeOf(a.title));
  }

  function addonUrls(cb) {
    var out = [], left = 2, done = false;
    (root.NODebrid ? root.NODebrid.rdToken : function (c) { c(new Error('no')); })(function (err, t) {
      if (!err && t) { out.push({ tag: 'RD', url: TI + '/realdebrid=' + encodeURIComponent(t) }); }
      step();
    });
    (root.NODebrid ? root.NODebrid.tbToken : function (c) { c(new Error('no')); })(function (err, t) {
      if (!err && t) { out.push({ tag: 'TB', url: TI + '/torbox=' + encodeURIComponent(t) }); }
      step();
    });
    function step() { if (--left <= 0 && !done) { done = true; cb(out); } }
  }

  /*
   * resolve(catalog, episode, cb) -> cb(source|null)
   * source looks like a catalogue source: {p:'mp4', u:url, k:'file'|'hls', ...}
   */
  function resolve(catalog, ep, cb) {
    if (!ep) { return cb(null); }
    var hit = RESOLVED[ep.id];
    if (hit && hit.exp > Date.now()) { return cb(hit.src); }

    addonUrls(function (addons) {
      if (!addons.length) { return cb(null); }
      imdbFor(catalog, ep, function (tt) {
        if (!tt || tt.indexOf('reject:') === 0) { return cb(null); }
        numFor(catalog, ep, tt, function (sn, en) {
          if (sn == null || en == null) { return cb(null); }
          var all = [], left = addons.length;
          for (var i = 0; i < addons.length; i++) {
            (function (a) {
              xhr('GET', a.url + '/stream/series/' + tt + ':' + sn + ':' + en + '.json', { timeout: 9000 },
                function (err, j) {
                  if (!err && j && j.streams) {
                    for (var k = 0; k < j.streams.length; k++) { j.streams[k]._tag = a.tag; all.push(j.streams[k]); }
                  }
                  if (--left === 0) { pick(); }
                });
            })(addons[i]);
          }
          function pick() {
            var best = null, i;
            for (i = 0; i < all.length; i++) {
              if (isCached(all[i]) && all[i].url && !isError(all[i])) {
                if (!best || rank(all[i], best) < 0) { best = all[i]; }
              }
            }
            if (!best) { return cb(null); }
            var src = {
              p: 'mp4', u: best.url, k: /\.m3u8(\?|$)/.test(best.url) ? 'hls' : 'file',
              q: (/1080/.test(best.title) ? '1080' : /720/.test(best.title) ? '720' : '480'),
              a: 'debrid', rel: 1, r: (best._tag + ':' + (best.infoHash || best.url)).slice(0, 120),
              addonTag: best._tag
            };
            RESOLVED[ep.id] = { src: src, exp: Date.now() + 8 * 60000 };
            cb(src);
          }
        });
      });
    });
  }

  root.NOAddons = { resolve: resolve, wants: wants, channels: DEBRID_CHANNELS };
}(this));
