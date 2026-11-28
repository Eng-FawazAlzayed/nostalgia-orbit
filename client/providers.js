/*
 * Playback for Nostalgia Orbit. ES5 for 2017 Samsung TVs.
 * Only ONE video element and ONE YouTube player exist at a time, so low-end
 * TVs and Google TV sticks don't run out of memory.
 */
(function (root) {
  'use strict';

  var ua = navigator.userAgent || '';
  var env = {
    tizen: /Tizen/i.test(ua) || typeof root.tizen !== 'undefined',
    android: /Android/i.test(ua),
    nativeHls: false
  };
  var vid = document.getElementById('vid');
  try { env.nativeHls = !!(vid && vid.canPlayType('application/vnd.apple.mpegurl')); } catch (e) {}
  if (env.tizen) { env.nativeHls = true; } // Tizen's media pipeline plays HLS in <video>

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('load ' + src)); };
    document.head.appendChild(s);
  }

  /* ---------- YouTube (official embedded player only) ---------- */
  var yt = { player: null, ready: false, loading: false, queue: [], handlers: null };
  function ytEnsure(cb) {
    if (yt.ready) { return cb(null); }
    yt.queue.push(cb);
    if (yt.loading) { return; }
    yt.loading = true;
    root.onYouTubeIframeAPIReady = function () {
      var origin = location.protocol.indexOf('http') === 0 ? location.origin : 'https://localhost';
      yt.player = new root.YT.Player('yt', {
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, cc_load_policy: 0, origin: origin },
        events: {
          onReady: function () { yt.ready = true; var q = yt.queue; yt.queue = []; for (var i = 0; i < q.length; i++) { q[i](null); } },
          onStateChange: function (e) { if (yt.handlers) { yt.handlers.state(e.data); } },
          onError: function (e) { if (yt.handlers) { yt.handlers.error('yt' + e.data); } }
        }
      });
    };
    loadScript('https://www.youtube.com/iframe_api', function (err) {
      if (err) { yt.loading = false; var q = yt.queue; yt.queue = []; for (var i = 0; i < q.length; i++) { q[i](err); } }
    });
  }

  /*
   * Only the picture: a black cover hides YouTube's big play/pause button and loading
   * screen whenever the video isn't actually playing, a paused or stalled video is
   * restarted, and captions are switched off every time playback starts.
   */
  var ytCover = null, ytKick = null, ytStarted = false, wantSound = true;
  function cover(on) {
    ytCover = ytCover || document.getElementById('yt-cover');
    if (ytCover) { ytCover.style.display = on ? 'block' : 'none'; }
  }
  function noCaptions() {
    var p = yt.player;
    try { p.unloadModule('captions'); } catch (e) {}
    try { p.unloadModule('cc'); } catch (e2) {}
    try { p.setOption('captions', 'track', {}); } catch (e3) {}
  }
  function ytState(st) {
    clearTimeout(ytKick);
    if (st === 1) { ytStarted = true; cover(false); noCaptions(); return; }
    if (st === 3 && ytStarted) { return; } // a short buffer mid-show: keep the picture
    cover(true);
    if (st === 2 || st === 5 || st === -1) {
      // paused, cued or stuck before starting (often autoplay with sound refused): start it,
      // muted if we have to; sound comes back on the next key press or tap.
      ytKick = setTimeout(function () {
        try {
          if (yt.player.getPlayerState() !== 1) {
            if (st === -1 || st === 5) { yt.player.mute(); }
            yt.player.playVideo();
          }
        } catch (e) {}
      }, st === 2 ? 300 : 1500);
    }
  }
  function unlockSound() {
    if (!wantSound) { return; }
    try { if (yt.player && yt.player.isMuted && yt.player.isMuted()) { yt.player.unMute(); yt.player.setVolume(100); } } catch (e) {}
    try { if (vid && vid.muted) { vid.muted = false; } } catch (e2) {}
  }
  if (document.addEventListener) {
    document.addEventListener('keydown', unlockSound, true);
    document.addEventListener('click', unlockSound, true);
    document.addEventListener('touchend', unlockSound, true);
  }

  /* ---------- hls.js only where HLS isn't native (desktop WebView2) ---------- */
  var hlsLib = null, hlsInst = null;
  function hlsEnsure(cb) {
    if (hlsLib || root.Hls) { hlsLib = root.Hls; return cb(null); }
    loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.light.min.js', function (err) {
      hlsLib = root.Hls || null; cb(err || (hlsLib ? null : new Error('hls')));
    });
  }

  /* ---------- optional providers: turn a catalog source into a playable URL ---------- */
  function cfg() { return root.NOConfig ? root.NOConfig() : {}; }
  var resolvers = {
    // arabic-toons.com: the page carries a signed MP4 for its Clappr player.
    // Native HTTP (Capacitor) can read it; a web page cannot: the site sends no CORS headers and X-Frame-Options: SAMEORIGIN,
    arabic: function (s, cb) {
      var page = s.r;
      function done(txt) {
        var m = /videoSrc\s*=\s*"([^"]+)"/.exec(txt || '');
        if (!m) { var e = new Error('arabic-nosrc'); e.permanent = false; return cb(e); }
        cb(null, m[1].replace(/&amp;/g, '&'));
      }
      var cap = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.CapacitorHttp;
      if (cap) {
        cap.get({ url: page, headers: { Referer: 'https://www.arabic-toons.com/', Accept: 'text/html' } })
          .then(function (r) { done(typeof r.data === 'string' ? r.data : (r.data && r.data.data)); })
          .catch(function () { var e = new Error('arabic-net'); e.permanent = false;  cb(e); });
        return;
      }
      var x = new XMLHttpRequest();
      x.open('GET', page, true); x.timeout = 9000;
      x.onload = function () { if (x.status >= 200 && x.status < 300) { done(x.responseText); } else { var e = new Error('arabic-http'); e.permanent = false;  cb(e); } };
      x.onerror = x.ontimeout = function () { var e = new Error('arabic-app-only'); e.permanent = false;  cb(e); };
      x.send();
    },
    ia: function (s, cb) { cb(null, s.u || ('https://archive.org/download/' + s.r)); },
    mp4: function (s, cb) { cb(null, s.u || s.r); },
    hls: function (s, cb) { cb(null, s.u || s.r); },
    jf: function (s, cb) { // Jellyfin, item id in s.r
      var c = cfg(); if (!c.jfUrl || !c.jfToken) { return cb(new Error('jellyfin-not-set')); }
      cb(null, c.jfUrl.replace(/\/$/, '') + '/Videos/' + s.r + '/stream?static=true&api_key=' + encodeURIComponent(c.jfToken));
    },
    emby: function (s, cb) {
      var c = cfg(); if (!c.embyUrl || !c.embyToken) { return cb(new Error('emby-not-set')); }
      cb(null, c.embyUrl.replace(/\/$/, '') + '/emby/Videos/' + s.r + '/stream?static=true&api_key=' + encodeURIComponent(c.embyToken));
    },
    plex: function (s, cb) { // s.r = part key, e.g. /library/parts/123/456/file.mkv
      var c = cfg(); if (!c.plexUrl || !c.plexToken) { return cb(new Error('plex-not-set')); }
      cb(null, c.plexUrl.replace(/\/$/, '') + s.r + (s.r.indexOf('?') < 0 ? '?' : '&') + 'X-Plex-Token=' + encodeURIComponent(c.plexToken));
    },
    dav: function (s, cb) { // public or token-in-URL WebDAV shares only
      var c = cfg(); if (!c.davUrl) { return cb(new Error('webdav-not-set')); }
      cb(null, c.davUrl.replace(/\/$/, '') + '/' + s.r.replace(/^\//, ''));
    },
    // TorBox: s.r = "t:torrentId:fileId" (u: usenet, w: web download; old "torrentId:fileId" still works).
    // The redirect link is a permalink, generated fresh for every play.
    torbox: function (s, cb) {
      var D = root.NODebrid; if (!D) { return cb(new Error('torbox-not-set')); }
      D.tbToken(function (err, tok) {
        if (err) { return cb(err); }
        var p = s.r.split(':'); if (p.length === 2) { p.unshift('t'); }
        var kind = { t: ['torrents', 'torrent_id'], u: ['usenet', 'usenet_id'], w: ['webdl', 'web_id'] }[p[0]] || ['torrents', 'torrent_id'];
        cb(null, 'https://api.torbox.app/v1/api/' + kind[0] + '/requestdl?token=' + encodeURIComponent(tok) + '&' + kind[1] + '=' + p[1] + '&file_id=' + p[2] + '&redirect=true');
      });
    },
    // Real-Debrid: s.r = the hoster link from YOUR torrent; unrestricted fresh before playing.
    // If the file name that comes back isn't the one we matched, it isn't played.
    rd: function (s, cb) {
      var D = root.NODebrid; if (!D) { return cb(new Error('realdebrid-not-set')); }
      D.rdToken(function (err, tok) {
        if (err) { return cb(err); }
        D.xhr('POST', 'https://api.real-debrid.com/rest/1.0/unrestrict/link', { timeout: 12000,
          headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/x-www-form-urlencoded' }, body: D.form({ link: s.r }) },
        function (e2, j) {
          if (e2 || !j || !j.download) { var er = new Error('rd-' + (e2 ? e2.status : 'nolink')); er.permanent = e2 && (e2.status === 404 || e2.status === 451); return cb(er); }
          if (s.n && j.filename && j.filename !== s.n) { var mm = new Error('rd-mismatch'); mm.permanent = true; return cb(mm); }
          cb(null, j.download);
        });
      });
    }
  };

  // Playback links made just before a programme starts are kept a few minutes,
  // so the next episode can be prepared while this one plays.
  var resolved = {};
  function resolveSrc(s, force, cb) {
    var key = s.p + ':' + s.r, hit = resolved[key];
    if (!force && hit && hit.exp > Date.now()) { return cb(null, hit.url); }
    (resolvers[s.p] || resolvers.mp4)(s, function (err, url) {
      if (!err && url && (s.p === 'rd' || s.p === 'torbox')) { resolved[key] = { url: url, exp: Date.now() + 10 * 60000 }; }
      cb(err, url);
    });
  }
  function prefetch(s) { if (s && (s.p === 'rd' || s.p === 'torbox')) { resolveSrc(s, false, function () {}); } }
  function position() {
    try { if (current && current.kind === 'yt' && yt.player) { return yt.player.getCurrentTime() || 0; } } catch (e) {}
    return vid && !isNaN(vid.currentTime) ? vid.currentTime : 0;
  }

  /* ---------- the single player ---------- */
  var current = null; // {kind, token}
  var token = 0;
  var startTimer = null;

  // arabic-toons on a web page: no CORS, so show their own player in a frame.
  function framePlay(url, onPlaying) {
    var pic = document.getElementById('pic');
    var f = document.getElementById('at-frame');
    if (!f) { f = document.createElement('iframe'); f.id = 'at-frame';
      f.setAttribute('allow', 'autoplay; fullscreen'); f.setAttribute('scrolling', 'no');
      pic.appendChild(f); }
    vid.style.visibility = 'hidden';
    document.getElementById('yt-host').style.visibility = 'hidden';
    f.style.display = 'block';
    if (f.src !== url) { f.src = url; }
    current = { kind: 'frame' };
    if (onPlaying) { onPlaying(); }
  }

  function stopAll() {
    token++;
    clearTimeout(startTimer);
    if (hlsInst) { try { hlsInst.destroy(); } catch (e) {} hlsInst = null; }
    try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) {}
    vid.onplaying = vid.onerror = vid.onloadedmetadata = null;
    if (yt.ready && yt.player) { try { yt.player.stopVideo(); } catch (e) {} }
    yt.handlers = null; clearTimeout(ytKick); cover(false);
    document.getElementById('yt-host').style.visibility = 'hidden';
    var af = document.getElementById('at-frame');
    if (af) { af.style.display = 'none'; af.src = 'about:blank'; }
    vid.style.visibility = 'hidden';
    current = null;
  }

  /*
   * play(source, offsetSeconds, {onPlaying, onError, onEnded, muted})
   * onError(code, permanent) -> caller marks the source and tries the next one.
   */
  function play(s, offset, h) {
    stopAll();
    var my = token;
    function guard(fn) { return function (a, b) { if (my === token && fn) { fn(a, b); } }; }
    var onPlaying = guard(h.onPlaying), onError = guard(h.onError), onEnded = guard(h.onEnded);
    // nothing playing in time counts as a temporary failure. Joining an hour-long Internet
    // Archive file halfway through needs a long seek on a slow server, so files get 30 s.
    startTimer = setTimeout(function () { onError('timeout', false); }, s.p === 'yt' ? 12000 : 30000);
    var playing = function () { clearTimeout(startTimer); onPlaying(); };

    if (s.p === 'yt') {
      document.getElementById('yt-host').style.visibility = 'visible';
      ytEnsure(function (err) {
        if (my !== token) { return; }
        if (err) { return onError('yt-api', false); }
        yt.handlers = {
          state: function (st) {
            if (my !== token) { return; }
            ytState(st);
            if (st === 1) { playing(); } else if (st === 0) { onEnded(); }
          },
          error: function (code) {
            if (my !== token) { return; }
            // 100 removed/private, 101/150/153 embedding refused: permanent. 2/5: temporary.
            onError(code, code === 'yt100' || code === 'yt101' || code === 'yt150' || code === 'yt153');
          }
        };
        ytStarted = false; cover(true); wantSound = !h.muted;
        var opts = { videoId: s.r };
        if (s.k !== 'live' && offset > 1) { opts.startSeconds = Math.floor(offset + (s.o || 0)); }
        try { yt.player.loadVideoById(opts); if (h.muted) { yt.player.mute(); } else { yt.player.unMute(); } }
        catch (e) { onError('yt-call', false); }
      });
      current = { kind: 'yt' };
      return;
    }

    resolveSrc(s, !!h.fresh, function (err, url) {
      if (my !== token) { return; }
      if (err && err.iframe) { return framePlay(err.iframe, onPlaying); }
      if (err) { return onError(err.message, err.permanent !== false && !/net|rd-0|rd-5|rd-429|timeout/.test(err.message)); }
      vid.style.visibility = 'visible';
      vid.muted = !!h.muted;
      var seekTo = (s.k === 'live') ? 0 : offset + (s.o || 0);
      vid.onloadedmetadata = function () {
        if (seekTo > 1 && isFinite(vid.duration) && seekTo < vid.duration) { try { vid.currentTime = seekTo; } catch (e) {} }
        if ((s.p === 'rd' || s.p === 'torbox') && root.NODebrid && isFinite(vid.duration)) { root.NODebrid.rememberDuration(s.r, vid.duration); }
        var p = vid.play(); if (p && p.catch) { p.catch(function () {}); }
      };
      vid.onplaying = playing;
      vid.onended = onEnded;
      vid.onerror = function () {
        var c = vid.error ? vid.error.code : 0; // 4 = format/src not supported or gone
        onError('media' + c, c === 4);
      };
      var isHls = s.k === 'hls' || s.k === 'live' || /\.m3u8(\?|$)/.test(url);
      if (isHls && !env.nativeHls) {
        hlsEnsure(function (e2) {
          if (my !== token) { return; }
          if (e2 || !hlsLib.isSupported()) { return onError('hls-unsupported', true); }
          hlsInst = new hlsLib({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 20, backBufferLength: 10 });
          hlsInst.on(hlsLib.Events.ERROR, function (ev, data) { if (data && data.fatal) { onError('hls-' + data.type, false); } });
          hlsInst.loadSource(url);
          hlsInst.attachMedia(vid);
        });
      } else {
        vid.src = url;
        try { vid.load(); } catch (e3) {}
      }
      current = { kind: isHls ? 'hls' : 'file' };
    });
  }

  function caps() { return { yt: true, hls: true, file: true, region: 'KW' }; }

  root.NOPlayer = { play: play, stop: stopAll, env: env, caps: caps, resolvers: resolvers, prefetch: prefetch, position: position };
}(this));
