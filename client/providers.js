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
    torbox: function (s, cb) { // s.r = "torrentId:fileId" of a torrent in YOUR TorBox account
      var c = cfg(); if (!c.torboxToken) { return cb(new Error('torbox-not-set')); }
      var p = s.r.split(':');
      cb(null, 'https://api.torbox.app/v1/api/torrents/requestdl?token=' + encodeURIComponent(c.torboxToken) +
        '&torrent_id=' + p[0] + '&file_id=' + p[1] + '&redirect=true');
    },
    rd: function (s, cb) { // s.r = hoster link you are entitled to; Real-Debrid unrestricts it
      var c = cfg(); if (!c.rdToken) { return cb(new Error('realdebrid-not-set')); }
      var x = new XMLHttpRequest();
      x.open('POST', 'https://api.real-debrid.com/rest/1.0/unrestrict/link');
      x.setRequestHeader('Authorization', 'Bearer ' + c.rdToken);
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.timeout = 10000;
      x.onload = function () {
        try { var j = JSON.parse(x.responseText); if (j.download) { return cb(null, j.download); } } catch (e) {}
        cb(new Error('rd' + x.status));
      };
      x.onerror = x.ontimeout = function () { cb(new Error('rd-net')); };
      x.send('link=' + encodeURIComponent(s.r));
    }
  };

  /* ---------- the single player ---------- */
  var current = null; // {kind, token}
  var token = 0;
  var startTimer = null;

  function stopAll() {
    token++;
    clearTimeout(startTimer);
    if (hlsInst) { try { hlsInst.destroy(); } catch (e) {} hlsInst = null; }
    try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) {}
    vid.onplaying = vid.onerror = vid.onloadedmetadata = null;
    if (yt.ready && yt.player) { try { yt.player.stopVideo(); } catch (e) {} }
    yt.handlers = null; clearTimeout(ytKick); cover(false);
    document.getElementById('yt-host').style.visibility = 'hidden';
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
    // nothing playing within 12 s counts as a temporary failure
    startTimer = setTimeout(function () { onError('timeout', false); }, 12000);
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

    var resolve = resolvers[s.p] || resolvers.mp4;
    resolve(s, function (err, url) {
      if (my !== token) { return; }
      if (err) { return onError(err.message, true); }
      vid.style.visibility = 'visible';
      vid.muted = !!h.muted;
      var seekTo = (s.k === 'live') ? 0 : offset + (s.o || 0);
      vid.onloadedmetadata = function () {
        if (seekTo > 1 && isFinite(vid.duration) && seekTo < vid.duration) { try { vid.currentTime = seekTo; } catch (e) {} }
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

  root.NOPlayer = { play: play, stop: stopAll, env: env, caps: caps, resolvers: resolvers };
}(this));
