/*
 * Nostalgia Orbit client. ES5, no framework, one video player at a time.
 * Works on Samsung Tizen 2017+ (Chromium 47), Android/Google TV WebView,
 * Windows WebView2 and desktop browsers.
 */
(function () {
  'use strict';
  var VERSION = '0.1.0';
  var S = window.NOSched, P = window.NOPlayer;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };

  /* ---------------- storage (can throw on some TVs; never fatal) ---------------- */
  function load(k, d) { try { var v = localStorage.getItem('no.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('no.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var defaults = {
    crt: 'light', lowperf: P.env.tizen, lang: 'en', names: 'ours', lastCh: null, prevCh: null, favs: [],
    catalogUrl: window.NO_CATALOG_URL || '', jfUrl: '', jfToken: '', embyUrl: '', embyToken: '',
    plexUrl: '', plexToken: '', davUrl: '', rdToken: '', torboxToken: '', rdAuth: null,
    modes: {}, breaks: 'auto', hevc: false, follow: [], seqPos: {}, seqTurn: 0, dog: true
  };
  var cfg = load('settings', {});
  for (var dk in defaults) { if (defaults.hasOwnProperty(dk) && !(dk in cfg)) { cfg[dk] = defaults[dk]; } }
  window.NOConfig = function () { return cfg; };
  window.NOStore = { load: load, save: save };
  window.NOSetConfig = function (k, v) { cfg[k] = v; saveCfg(); };
  function saveCfg() { save('settings', cfg); }

  /* ---------------- catalog: bundled snapshot, cached update, nightly online copy ---------------- */
  var catalog = window.NO_CATALOG || { channels: [], series: {}, episodes: [] };
  var cached = load('catalog', null);
  if (cached && cached.generated && (!catalog.generated || cached.generated > catalog.generated)) { catalog = cached; }
  var local = load('library', null); // media the user imported from their own Jellyfin/Emby
  var idx;
  // My Shows (channel 100): the shows you follow, in order, carrying on where you left off.
  var MY_SHOWS = { id: 'my-shows', n: '100', name: 'MY SHOWS', ar: 'برامجي', work: 'Shows I follow, in order', theme: 'vhs', seq: true, blocks: [] };
  function buildIndex() {
    var c = { generated: catalog.generated, channels: [], series: {}, episodes: catalog.episodes };
    var k, i;
    for (k in catalog.series) { if (catalog.series.hasOwnProperty(k)) { c.series[k] = catalog.series[k]; } }
    // ad-break length from Setup overrides each channel's own
    var br = cfg.breaks === 'off' ? 0 : (cfg.breaks === 'auto' ? null : +cfg.breaks);
    for (i = 0; i < catalog.channels.length; i++) {
      var ch = catalog.channels[i];
      if (br !== null) { var cc = {}; for (k in ch) { if (ch.hasOwnProperty(k)) { cc[k] = ch[k]; } } cc.break_s = br; ch = cc; }
      c.channels.push(ch);
    }
    var overlays = [local, load('debridOverlay', null)], hasLib = false;
    for (i = 0; i < overlays.length; i++) {
      var ov = overlays[i]; if (!ov) { continue; }
      if (ov.extra) { // your own copies of episodes already on the channels: offered first
        var eps = [];
        for (var j = 0; j < c.episodes.length; j++) {
          var e = c.episodes[j], x = ov.extra[e.id];
          if (x) { var ne = {}; for (k in e) { if (e.hasOwnProperty(k)) { ne[k] = e[k]; } } ne.src = x.concat(e.src || []); e = ne; }
          eps.push(e);
        }
        c.episodes = eps;
      }
      if (ov.episodes && ov.episodes.length) { c.episodes = c.episodes.concat(ov.episodes); }
      for (k in ov.series || {}) { if (ov.series.hasOwnProperty(k)) { c.series[k] = ov.series[k]; hasLib = true; } }
    }
    if (hasLib) { c.channels.push((local && local.channel) || (load('debridOverlay', {}) || {}).channel); }
    c.channels.push(MY_SHOWS);
    idx = new S.Index(c, { modes: cfg.modes });
  }
  buildIndex();

  function fetchJSON(url, cb, timeout) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = timeout || 15000;
    x.onload = function () { if (x.status >= 200 && x.status < 300) { try { return cb(null, JSON.parse(x.responseText)); } catch (e) { return cb(e); } } cb(new Error('http ' + x.status)); };
    x.onerror = x.ontimeout = function () { cb(new Error('network')); };
    x.send();
  }
  function checkUpdate(force) {
    if (!cfg.catalogUrl) { return; }
    var last = load('catalogChecked', 0);
    if (!force && now() - last < (window.NO_CATALOG ? 6 * 3600000 : 60000)) { return; } // the web copy has no bundled catalog: check on every visit
    save('catalogChecked', now());
    fetchJSON(cfg.catalogUrl + (cfg.catalogUrl.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(now() / 60000), function (err, c) {
      if (err || !c || !c.episodes) { if (force) { toast(T('updateFail')); } return; }
      if (c.generated && c.generated <= (catalog.generated || '')) { if (force) { toast(T('upToDate')); } return; }
      catalog = c;
      if (window.NODebrid) { NODebrid.rematch(catalog, { hevc: cfg.hevc, lang: cfg.lang === 'ar' ? 'ar' : 'en' }); }
      if (!save('catalog', c)) { try { localStorage.removeItem('no.catalog'); } catch (e) {} }
      var keep = channels()[chIdx] && channels()[chIdx].id;
      buildIndex();
      chIdx = Math.max(0, findChannel(keep));
      toast(T('updated'));
      if (!playingSrc) { tune(chIdx, true); }
    }, 30000);
  }

  /* ---------------- words (English / Arabic menus) ---------------- */
  var WORDS = {
    en: { now: 'NOW', next: 'NEXT', all: 'ALL CHANNELS', favs: 'FAVOURITES', guide: 'TV GUIDE · KUWAIT', setup: 'SETUP', noSignal: 'NO SIGNAL', nextAt: 'Next', offair: 'Off air', scrambled: 'SCRAMBLED', ident: 'Coming up', updated: 'Channel list updated', upToDate: 'Already up to date', updateFail: 'Could not reach the update', favOn: 'Added to favourites', favOff: 'Removed from favourites', retry: 'Trying another copy…', followHint: 'Press YELLOW (or Y) on any show to follow it here', followed: 'Following this show', unfollowed: 'Stopped following', signIn: 'On your phone, open', enterCode: 'and enter' },
    ar: { now: 'الآن', next: 'التالي', all: 'كل القنوات', favs: 'المفضلة', guide: 'دليل البرامج · الكويت', setup: 'الإعدادات', noSignal: 'لا توجد إشارة', nextAt: 'التالي', offair: 'خارج البث', scrambled: 'مشفّرة', ident: 'بعد قليل', updated: 'تم تحديث القنوات', upToDate: 'القائمة محدّثة', updateFail: 'تعذّر التحديث', favOn: 'أضيفت للمفضلة', favOff: 'أزيلت من المفضلة', retry: 'نجرب نسخة أخرى…', followHint: 'اضغط الزر الأصفر على أي برنامج لمتابعته هنا', followed: 'تمت متابعة البرنامج', unfollowed: 'أُلغيت المتابعة', signIn: 'من هاتفك افتح', enterCode: 'وأدخل الرمز' }
  };
  function T(k) { return (WORDS[cfg.lang] || WORDS.en)[k] || k; }
  function chName(c) { return cfg.names === 'working' ? (c.work || c.name) : (cfg.lang === 'ar' && c.ar ? c.ar : c.name); }
  function epTitle(item) {
    if (!item) { return ''; }
    if (item.type === 'offair') { return item.label || T('offair'); }
    if (item.type === 'filler') { return T('ident'); }
    var ser = (idx.catalog.series || {})[item.ep.s];
    return S.title(item.ep, ser, cfg.lang);
  }

  /* ---------------- failure memory (on-device self-healing) ---------------- */
  var failed = load('failed', {}), failCount = load('failCount', {});
  function markFailed(src, permanent) {
    var key = S.sourceKey(src), n = (failCount[key] || 0) + 1;
    failCount[key] = n;
    // temporary: 10 min, 20, 40 … up to a day. permanent: skip for 30 days, the nightly check decides for good.
    failed[key] = now() + (permanent ? 30 * 86400000 : Math.min(86400000, 600000 * Math.pow(2, n - 1)));
    save('failed', failed); save('failCount', failCount);
  }
  function markOk(src) {
    var key = S.sourceKey(src);
    if (failCount[key]) { delete failCount[key]; delete failed[key]; save('failed', failed); save('failCount', failCount); }
  }

  /* ---------------- channels ---------------- */
  function channels() { return idx.channelList; }
  function findChannel(id) { var l = channels(); for (var i = 0; i < l.length; i++) { if (l[i].id === id) { return i; } } return -1; }
  var chIdx = Math.max(0, findChannel(cfg.lastCh));

  /* ---------------- UI helpers ---------------- */
  var bannerTimer, toastTimer, boundaryTimer, tuneToken = 0;
  function show(el, on) { el.className = el.className.replace(/\s*hidden/g, '') + (on ? '' : ' hidden'); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; show(t, true); clearTimeout(toastTimer); toastTimer = setTimeout(function () { show(t, false); }, 2500); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function applyLook() {
    var cls = ['crt-' + cfg.crt];
    if (cfg.lowperf) { cls.push('lowperf'); } else { cls.push('anim'); }
    if (cfg.lang === 'ar') { cls.push('rtl'); }
    document.body.className = cls.join(' ');
    $('ver').textContent = VERSION;
  }

  function renderBanner() {
    var c = channels()[chIdx]; if (!c) { return; }
    var r = idx.at(c.id, now());
    $('bNum').textContent = c.n;
    $('bName').textContent = chName(c);
    $('bAlt').textContent = r && r.item.lbl ? '★ ' + r.item.lbl : (cfg.names === 'working' ? c.name : (c.work || '')); // themed block, e.g. Friday Cartoon Night
    $('bNow').textContent = r ? epTitle(r.item) : T('noSignal');
    $('bNow').setAttribute('dir', 'auto');
    $('bNowT').textContent = r ? S.kuwaitClock(r.item.s) + '–' + S.kuwaitClock(r.item.e) : '';
    $('bNext').textContent = r && r.next ? epTitle(r.next) : '';
    $('bNext').setAttribute('dir', 'auto');
    $('bNextT').textContent = r && r.next ? S.kuwaitClock(r.next.s) : '';
    $('bBar').style.width = r ? Math.min(100, Math.max(1, (now() - r.item.s) / (r.item.e - r.item.s) * 100)) + '%' : '0';
    $('bClock').textContent = S.kuwaitClock(now());
    $('bSrc').textContent = playingSrc ? ({ rd: 'REAL-DEBRID', torbox: 'TORBOX', ia: 'ARCHIVE', yt: 'YT' }[playingSrc.p] || playingSrc.p.toUpperCase()) + (playingSrc.q ? ' · ' + playingSrc.q + 'p' : '') + (playingSrc.mb ? ' · ' + playingSrc.mb + ' MB' : '') : '';
    document.querySelector('.now-lbl').textContent = T('now');
    document.querySelector('.next-lbl').textContent = T('next');
  }
  function flashBanner(ms) {
    renderBanner(); show($('banner'), true);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { if (mode === 'tv') { show($('banner'), false); } }, ms || 4500);
  }
  function showCard(name, sub, bars) {
    show($('bars'), !!bars);
    show($('card'), !bars);
    $('cardName').textContent = name; $('cardSub').textContent = sub || '';
  }
  function hideCard() { show($('card'), false); show($('bars'), false); }

  /* ---------------- tuning ---------------- */
  var playingSrc = null;
  function tune(i, quiet) {
    var list = channels(); if (!list.length) { showCard('NOSTALGIA ORBIT', T('noSignal')); return; }
    if (i !== chIdx) { cfg.prevCh = list[chIdx] && list[chIdx].id; }
    chIdx = (i + list.length) % list.length;
    var c = list[chIdx];
    cfg.lastCh = c.id; saveCfg();
    look(c);
    var my = ++tuneToken;
    P.stop(); playingSrc = null;
    show($('black'), true);
    hideCard();
    if (!quiet) { flashBanner(); }
    clearTimeout(boundaryTimer); clearTimeout(prefetchTimer); clearInterval(seqTimer);
    if (c.seq) { playSeq(c, my); return; }
    var r = idx.at(c.id, now());
    if (!r) { show($('black'), false); showCard(chName(c), T('noSignal')); return; }
    // retune at the next programme boundary: automatic episode transitions
    boundaryTimer = setTimeout(function () { if (my === tuneToken) { tune(chIdx, true); if (mode === 'tv') { flashBanner(3000); } } }, Math.max(1000, r.item.e - now() + 200));
    if (r.item.type === 'offair') {
      show($('black'), false);
      if (c.id === 'night-owl') { showCard(T('scrambled'), chName(c) + ' · 21:00'); } else { showCard('', '', true); }
      return;
    }
    if (r.item.type === 'filler') { show($('black'), false); identCard(c, r); return; }
    var srcs = S.pickSources(r.item.ep, P.caps(), failed, now());
    var begun = false;
    var begin = function () {
      if (begun || my !== tuneToken) { return; }
      begun = true;
      if (!srcs.length) { show($('black'), false); showCard(chName(c), T('noSignal')); return; }
      trySource(my, c, r.item, srcs, 0);
    };
    if (window.NOAddons && !r.item.inter && r.item.ep && window.NOAddons.wants(c.id)) {
      // 002/006/007: a cached debrid stream wins; the catalogue copies stay as the fallback.
      var guard = setTimeout(begin, 7000);
      window.NOAddons.resolve(catalog, r.item.ep, function (src) {
        clearTimeout(guard);
        if (src) { srcs.unshift(src); }
        begin();
      });
    } else {
      begin();
    }
    // get the next programme's link ready a minute before it starts (one video buffers at a time)
    if (r.next && r.next.type === 'ep') {
      prefetchTimer = setTimeout(function () {
        if (my !== tuneToken) { return; }
        var ns = S.pickSources(r.next.ep, P.caps(), failed, now()); if (ns.length) { P.prefetch(ns[0]); }
      }, Math.max(0, r.item.e - now() - 60000));
    }
  }

  /* ---------------- My Shows: sequential mode ---------------- */
  var seqTimer, prefetchTimer;
  function seqNext() { // next episode of the next followed show, round-robin
    var f = cfg.follow || [];
    for (var tries = 0; tries < f.length; tries++) {
      var sid = f[(cfg.seqTurn + tries) % f.length], list = idx.episodesBySeries[sid] || [], pos = cfg.seqPos[sid] || { i: 0, off: 0 };
      if (list.length) { return { sid: sid, ep: list[pos.i % list.length], pos: pos, turn: (cfg.seqTurn + tries) % f.length }; }
    }
    return null;
  }
  function playSeq(c, my) {
    var n = seqNext();
    if (!n) { show($('black'), false); showCard(chName(c), T('followHint')); return; }
    var item = { type: 'ep', s: now() - n.pos.off * 1000, e: now() + (n.ep.d - n.pos.off) * 1000, ep: n.ep };
    trySource(my, c, item, S.pickSources(n.ep, P.caps(), failed, now()), 0, function ended() {
      cfg.seqPos[n.sid] = { i: n.pos.i + 1, off: 0 }; cfg.seqTurn = (n.turn + 1) % Math.max(1, cfg.follow.length); saveCfg();
      if (my === tuneToken) { tune(chIdx, true); }
    });
    seqTimer = setInterval(function () { // remember where you are, every 15 s
      if (my !== tuneToken) { clearInterval(seqTimer); return; }
      cfg.seqPos[n.sid] = { i: n.pos.i, off: Math.floor(P.position()) }; saveCfg();
    }, 15000);
  }
  function followCurrent() {
    var c = channels()[chIdx]; if (!c || c.seq) { return; }
    var r = idx.at(c.id, now()); if (!r || !r.item.ep || r.item.inter) { return; }
    var sid = r.item.ep.s, i = cfg.follow.indexOf(sid);
    if (i >= 0) { cfg.follow.splice(i, 1); toast(T('unfollowed')); } else { cfg.follow.push(sid); toast(T('followed') + ' · 100'); }
    saveCfg();
  }
  // Each channel's own look: ident card style and a small corner logo, like a real station.
  function look(c) {
    $('tv').className = c.theme ? 'th-' + c.theme : '';
    var d = $('dog'); d.textContent = c.dog || chName(c); d.setAttribute('dir', 'auto');
    show(d, cfg.dog !== false && !!c.theme);
  }
  function identCard(c, r) {
    var nx = r.next && r.next.type === 'ep' ? epTitle(r.next) + ' · ' + S.kuwaitClock(r.next.s) : '';
    showCard(chName(c), nx ? T('nextAt') + ': ' + nx : '');
  }
  // Watch history on this device: play counts and last played, per episode.
  var plays = load('plays', {}), playsDirty = false;
  function notePlay(ep) {
    if (!ep || !ep.id) { return; }
    var p = plays[ep.id] || { n: 0, last: 0 }; p.n++; p.last = now(); plays[ep.id] = p;
    if (!playsDirty) { playsDirty = true; setTimeout(function () { playsDirty = false; save('plays', plays); }, 30000); }
  }
  // Each copy is tried in turn; your own Real-Debrid/TorBox copy gets a second try with a fresh link.
  function trySource(my, c, item, srcs, k, onDone, refreshed) {
    if (my !== tuneToken) { return; }
    if (k >= srcs.length) { // every copy failed
      P.stop(); show($('black'), false);
      if (onDone) { return onDone(); } // My Shows: skip to the next episode
      showCard(chName(c), T('noSignal'));
      return;
    }
    var src = srcs[k];
    var offset = item.live ? 0 : (now() - item.s) / 1000;
    if (k > 0 && !refreshed) { toast(T('retry')); }
    P.play(src, offset, {
      fresh: !!refreshed,
      onPlaying: function () { if (my !== tuneToken) { return; } playingSrc = src; markOk(src); show($('black'), false); hideCard(); if (!item.inter) { notePlay(item.ep); } },
      onError: function (code, permanent) {
        if (!refreshed && !permanent && (code === 'timeout' || src.p === 'rd' || src.p === 'torbox')) { return trySource(my, c, item, srcs, k, onDone, true); } // one more try
        if (code !== 'timeout') { markFailed(src, permanent); } // a slow start isn't a broken link
        trySource(my, c, item, srcs, k + 1, onDone);
      },
      onEnded: function () { // copy shorter than its slot: ident until the next programme
        if (my !== tuneToken) { return; }
        if (onDone) { return onDone(); }
        P.stop(); identCard(c, idx.at(c.id, now()) || { next: null });
      }
    });
  }

  /* ---------------- channel list ---------------- */
  var mode = 'tv', listSel = 0, listFavs = false;
  function listChannels() {
    var all = channels(); if (!listFavs) { return all; }
    var out = []; for (var i = 0; i < all.length; i++) { if (cfg.favs.indexOf(all[i].id) >= 0) { out.push(all[i]); } }
    return out;
  }
  function renderList() {
    var l = listChannels(), html = '', start = Math.max(0, Math.min(listSel - 6, l.length - 13));
    $('listTitle').textContent = listFavs ? T('favs') : T('all');
    $('listCount').textContent = l.length;
    for (var i = start; i < Math.min(l.length, start + 13); i++) {
      html += '<div class="row' + (i === listSel ? ' sel' : '') + '" data-i="' + i + '"><b>' + esc(l[i].n) + '</b><span class="nm" dir="auto">' + esc(chName(l[i])) + '</span>' +
        (cfg.favs.indexOf(l[i].id) >= 0 ? '<span class="tag">★</span>' : '') + (l[i].id === 'night-owl' ? '<span class="tag">🔒</span>' : '') + '</div>';
    }
    $('listItems').innerHTML = html;
  }
  function openList() {
    mode = 'list'; listFavs = false;
    listSel = Math.max(0, listChannels().indexOf(channels()[chIdx]));
    renderList(); show($('list'), true); show($('banner'), true); renderBanner();
  }

  /* ---------------- programme guide (EPG) ---------------- */
  var epgSel = 0, epgStart = 0, SLOT = 1800000, SPAN = 4 * SLOT;
  function renderEpg() {
    var list = channels(), from = epgStart, to = from + SPAN, i, j;
    var head = '<div class="e-ch">' + S.kuwaitClock(now()) + '</div><div class="e-cells">';
    for (j = 0; j < 4; j++) { head += '<div class="e-tick" style="left:' + (j * 25) + '%">' + S.kuwaitClock(from + j * SLOT) + '</div>'; }
    $('epgHead').innerHTML = head + '</div>';
    var start = Math.max(0, Math.min(epgSel - 5, list.length - 11)), html = '';
    for (i = start; i < Math.min(list.length, start + 11); i++) {
      var items = idx.range(list[i].id, from, to), cells = '';
      for (j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.inter) { continue; }
        var l = Math.max(0, (it.s - from) / SPAN * 100), r = Math.min(100, (it.e - from) / SPAN * 100);
        if (r - l < 3) { continue; }
        var isNow = it.s <= now() && it.e > now();
        cells += '<div class="e-cell' + (isNow ? ' now' : '') + '" dir="auto" style="left:' + l + '%;width:' + (r - l) + '%">' + esc(epTitle(it)) + '</div>';
      }
      html += '<div class="e-row' + (i === epgSel ? ' sel' : '') + '" data-i="' + i + '"><div class="e-ch"><b>' + esc(list[i].n) + '</b>' + esc(chName(list[i])) + '</div><div class="e-cells">' + cells + '</div></div>';
    }
    $('epgBody').innerHTML = html;
    var d = new Date(now() + 3 * 3600000);
    $('epgTitle').textContent = T('guide');
    $('epgDate').textContent = d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
  }
  function openEpg() {
    mode = 'epg'; epgSel = chIdx; epgStart = Math.floor(now() / SLOT) * SLOT;
    show($('banner'), false); show($('list'), false);
    renderEpg(); show($('epg'), true);
  }

  /* ---------------- setup ---------------- */
  var setupSel = 0, editing = null;
  var SETUP = [
    { k: 'crt', label: 'CRT filter', opts: ['off', 'light', 'heavy'] },
    { k: 'lowperf', label: 'Low-performance mode', opts: [false, true] },
    { k: 'lang', label: 'Menu language', opts: ['en', 'ar'] },
    { k: 'names', label: 'Channel names', opts: ['ours', 'working'] },
    { k: 'update', label: 'Check for channel updates', act: function () { checkUpdate(true); } },
    { k: 'catalogUrl', label: 'Update address', text: true },
    { k: 'jfUrl', label: 'Jellyfin address', text: true }, { k: 'jfToken', label: 'Jellyfin API key', text: true, secret: true },
    { k: 'jfImport', label: 'Import my Jellyfin library', act: function () { importLibrary('jf'); } },
    { k: 'embyUrl', label: 'Emby address', text: true }, { k: 'embyToken', label: 'Emby API key', text: true, secret: true },
    { k: 'embyImport', label: 'Import my Emby library', act: function () { importLibrary('emby'); } },
    { k: 'plexUrl', label: 'Plex address', text: true }, { k: 'plexToken', label: 'Plex token', text: true, secret: true },
    { k: 'davUrl', label: 'WebDAV share address', text: true },
    { k: 'modeHere', label: 'This channel: order', info: function () { var c = channels()[chIdx]; return c ? String((cfg.modes[c.id] || c.mode || 'classic')).toUpperCase() : '—'; },
      act: function () { var c = channels()[chIdx]; if (!c || c.seq || c.mix) { return; } cfg.modes[c.id] = (cfg.modes[c.id] || c.mode || 'classic') === 'random' ? 'classic' : 'random'; saveCfg(); buildIndex(); tune(chIdx, true); } },
    { k: 'breaks', label: 'Ad breaks between shows', opts: ['auto', 'off', '30', '60', '120'], after: function () { buildIndex(); } },
    { k: 'dog', label: 'Channel logo in the corner', opts: [true, false], after: function () { var c = channels()[chIdx]; if (c) { look(c); } } },
    { k: 'rdLogin', label: 'Real-Debrid: sign in (optional, paid)', act: function () { debridLogin('rd'); }, info2: function () { return cfg.rdToken || (cfg.rdAuth && cfg.rdAuth.refresh) ? 'CONNECTED' : ''; } },
    { k: 'rdToken', label: 'Real-Debrid token (or paste one)', text: true, secret: true },
    { k: 'tbLogin', label: 'TorBox: sign in (optional, paid)', act: function () { debridLogin('tb'); }, info2: function () { return cfg.torboxToken ? 'CONNECTED' : ''; } },
    { k: 'torboxToken', label: 'TorBox API key (or paste one)', text: true, secret: true },
    { k: 'debridAddons', label: 'Debrid streams on 002/006/007', opts: [true, false], after: function () { tune(chIdx, true); } },
    { k: 'hevc', label: 'This device plays HEVC/10-bit files', opts: [false, true] },
    { k: 'dbScan', label: 'Scan my Real-Debrid / TorBox files', act: function () { debridScan(); } },
    { k: 'dbForget', label: 'Disconnect Real-Debrid / TorBox', act: function () { cfg.rdToken = ''; cfg.rdAuth = null; cfg.torboxToken = ''; saveCfg(); save('debridOverlay', null); save('debridFiles', null); buildIndex(); toast('OK'); } },
    { k: 'clearFails', label: 'Forget broken links on this device', act: function () { failed = {}; failCount = {}; save('failed', failed); save('failCount', failCount); toast('OK'); } },
    { k: 'about', label: 'Catalog', info: function () { return (catalog.generated || 'bundled').slice(0, 10) + ' · ' + (catalog.episodes || []).length + ' episodes'; } }
  ];
  function setupVal(it) {
    if (it.info) { return it.info(); }
    if (it.act) { return (it.info2 && it.info2()) || '▶'; }
    var v = cfg[it.k];
    if (it.text) { return v ? (it.secret ? '••••••' : v) : '—'; }
    return v === true ? 'ON' : v === false ? 'OFF' : String(v).toUpperCase();
  }
  function renderSetup() {
    var html = '', box = $('setupItems'), keep = box.scrollTop;
    $('setupTitle').textContent = T('setup');
    for (var i = 0; i < SETUP.length; i++) {
      html += '<div class="row' + (i === setupSel ? ' sel' : '') + '" data-i="' + i + '"><span class="nm">' + esc(SETUP[i].label) + '</span><span class="val">' + esc(setupVal(SETUP[i])) + '</span></div>';
    }
    box.innerHTML = html; box.scrollTop = keep;
    // all rows are drawn so touch users can scroll; keep the remote's selection in view
    var row = box.children[setupSel];
    if (row && (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)) {
      box.scrollTop = row.offsetTop - box.clientHeight / 2;
    }
  }
  /* ---------------- Real-Debrid / TorBox ---------------- */
  function debridLogin(which) {
    if (!window.NODebrid) { return; }
    closeAll();
    NODebrid.login(which, function (url, code) {
      showCard(code, T('signIn') + ' ' + url.replace(/^https?:\/\//, '') + ' ' + T('enterCode'));
    }, function (err) {
      hideCard();
      if (err) { toast('Sign-in failed: ' + err.message); } else { toast('Connected. Scanning your files…'); debridScan(); }
    });
  }
  function debridScan() {
    if (!window.NODebrid) { return; }
    toast('Reading your Real-Debrid / TorBox files…');
    NODebrid.scan(catalog, { hevc: cfg.hevc, lang: cfg.lang === 'ar' ? 'ar' : 'en' }, function (err, ov, warn) {
      if (err) { toast('Library scan failed: ' + err.message); return; }
      buildIndex();
      var st = ov.stats;
      toast(st.chosen + ' episodes from your library · ' + st.matched + ' on the channels · ' + st.library + ' on 099' + (warn && warn.length ? ' · ' + warn[0] : ''));
    });
  }
  function openSetup() { mode = 'setup'; show($('list'), false); show($('banner'), false); renderSetup(); show($('setup'), true); }
  function changeSetup(dir) {
    var it = SETUP[setupSel];
    if (it.act) { it.act(); renderSetup(); return; }
    if (it.text) { editText(it); return; }
    if (it.opts) {
      var p = it.opts.indexOf(cfg[it.k]); cfg[it.k] = it.opts[(p + (dir || 1) + it.opts.length) % it.opts.length];
      saveCfg(); applyLook(); if (it.after) { it.after(); } renderSetup();
    }
  }
  function editText(it) { // on-screen keyboards (Tizen IME, Android TV) open on a focused input
    var inp = document.createElement('input');
    inp.type = it.secret ? 'password' : 'text';
    inp.value = cfg[it.k] || '';
    inp.style.cssText = 'position:absolute;left:22vw;right:22vw;top:45vh;font-size:3vh;padding:1vh;z-index:30';
    document.body.appendChild(inp);
    editing = inp; inp.focus();
    inp.onkeydown = function (e) {
      if (e.keyCode === 13 || e.keyCode === 65376) { cfg[it.k] = inp.value.trim(); saveCfg(); done(); }
      else if (e.keyCode === 27 || e.keyCode === 10009 || e.keyCode === 65385) { done(); }
      e.stopPropagation();
    };
    function done() { if (inp.parentNode) { inp.parentNode.removeChild(inp); } editing = null; renderSetup(); }
  }

  /* Import a personal Jellyfin/Emby library as channel 099 "MY LIBRARY". Stays on this device. */
  function importLibrary(kind) {
    var base = kind === 'jf' ? cfg.jfUrl : cfg.embyUrl, key = kind === 'jf' ? cfg.jfToken : cfg.embyToken;
    if (!base || !key) { toast('Set the address and API key first'); return; }
    var url = base.replace(/\/$/, '') + (kind === 'emby' ? '/emby' : '') +
      '/Items?Recursive=true&IncludeItemTypes=Episode,Movie&Fields=RunTimeTicks,ProductionYear&Limit=3000&api_key=' + encodeURIComponent(key);
    toast('Importing…');
    fetchJSON(url, function (err, j) {
      if (err || !j || !j.Items) { toast('Import failed: ' + (err ? err.message : 'no items')); return; }
      var lib = { channel: { id: 'my-library', n: '099', name: 'MY LIBRARY', ar: 'مكتبتي', work: 'My library', blocks: [{ f: '06:00', t: '06:00', g: '*all' }] }, series: {}, episodes: [] };
      for (var i = 0; i < j.Items.length; i++) {
        var it = j.Items[i], sid = 'lib-' + (it.SeriesId || it.Id), d = Math.round((it.RunTimeTicks || 0) / 1e7);
        if (!d) { continue; }
        if (!lib.series[sid]) { lib.series[sid] = { t: { en: it.SeriesName || it.Name }, y: it.ProductionYear, ch: { 'my-library': ['*'] } }; }
        lib.episodes.push({ id: 'lib-' + it.Id, s: sid, sn: it.ParentIndexNumber || 0, ep: it.IndexNumber || 0, t: { en: it.Name }, d: d, src: [{ p: kind, r: it.Id, k: 'file', a: 'user_owned' }] });
      }
      local = lib; save('library', lib); buildIndex();
      toast('Imported ' + lib.episodes.length + ' videos to channel 099');
    }, 60000);
  }

  /* ---------------- input: Samsung remote, Android TV D-pad, keyboard, touch ---------------- */
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009, ESC: 27, BKSP: 8, CHUP: 427, CHDN: 428, PGUP: 33, PGDN: 34,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457, GUIDE: 458, PRECH: 10190, DPAD_CENTER: 23 };
  if (window.tizen && tizen.tvinputdevice) {
    var want = ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info', 'Guide', 'PreviousChannel',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (var w = 0; w < want.length; w++) { try { tizen.tvinputdevice.registerKey(want[w]); } catch (e) {} }
  }
  var digitBuf = '', digitTimer;
  function digit(d) {
    digitBuf = (digitBuf + d).slice(-3);
    var el = $('digits'); el.textContent = (digitBuf + '---').slice(0, 3); show(el, true);
    clearTimeout(digitTimer);
    digitTimer = setTimeout(function () {
      show(el, false);
      var n = ('00' + digitBuf).slice(-3), l = channels();
      digitBuf = '';
      for (var i = 0; i < l.length; i++) { if (l[i].n === n) { tune(i); return; } }
      toast(T('noSignal') + ' ' + n);
    }, 1500);
  }
  function back() {
    if (mode !== 'tv') { closeAll(); return true; }
    if (P.env.tizen && window.tizen) { try { tizen.application.getCurrentApplication().exit(); } catch (e) {} }
    return false;
  }
  function closeAll() { mode = 'tv'; show($('list'), false); show($('epg'), false); show($('setup'), false); show($('banner'), false); }

  document.addEventListener('keydown', function (e) {
    if (editing) { return; }
    var k = e.keyCode, handled = true;
    if (k >= 48 && k <= 57 && mode === 'tv') { digit(k - 48); e.preventDefault(); return; }
    if (k === 122) { toggleFullscreen(); e.preventDefault(); return; } // F11 on Windows / desktop
    if (k === K.BACK || k === K.ESC || k === K.BKSP) { if (!back()) { handled = false; } }
    else if (k === K.CHUP || k === K.PGUP) { closeAll(); tune(chIdx + 1); }
    else if (k === K.CHDN || k === K.PGDN) { closeAll(); tune(chIdx - 1); }
    else if (k === K.GUIDE || k === 71) { if (mode === 'epg') { closeAll(); } else { openEpg(); } }
    else if (k === K.INFO || k === 73) { flashBanner(6000); }
    else if (k === K.PRECH) { var p = findChannel(cfg.prevCh); if (p >= 0) { tune(p); } }
    else if (k === K.RED || k === 67) { cfg.crt = { off: 'light', light: 'heavy', heavy: 'off' }[cfg.crt]; saveCfg(); applyLook(); toast('CRT ' + cfg.crt.toUpperCase()); }
    else if (k === K.YELLOW || k === 89) { followCurrent(); }
    else if (k === 78) { cfg.names = cfg.names === 'ours' ? 'working' : 'ours'; saveCfg(); renderBanner(); if (mode === 'list') { renderList(); } }
    else if (k === K.BLUE || k === 83) { if (mode === 'setup') { closeAll(); } else { openSetup(); } }
    else if (mode === 'tv') {
      if (k === K.UP) { tune(chIdx + 1); }
      else if (k === K.DOWN) { tune(chIdx - 1); }
      else if (k === K.OK || k === K.DPAD_CENTER) { openList(); }
      else if (k === K.LEFT || k === K.RIGHT) { flashBanner(); }
      else { handled = false; }
    } else if (mode === 'list') {
      var l = listChannels();
      if (k === K.UP) { listSel = Math.max(0, listSel - 1); renderList(); }
      else if (k === K.DOWN) { listSel = Math.min(l.length - 1, listSel + 1); renderList(); }
      else if (k === K.LEFT || k === K.RIGHT) { listFavs = !listFavs; listSel = 0; renderList(); }
      else if (k === K.GREEN || k === 70) { toggleFav(l[listSel]); renderList(); }
      else if (k === K.OK || k === K.DPAD_CENTER) { if (l[listSel]) { var ti = channels().indexOf(l[listSel]); closeAll(); tune(ti); } }
      else { handled = false; }
    } else if (mode === 'epg') {
      if (k === K.UP) { epgSel = Math.max(0, epgSel - 1); renderEpg(); }
      else if (k === K.DOWN) { epgSel = Math.min(channels().length - 1, epgSel + 1); renderEpg(); }
      else if (k === K.LEFT) { epgStart = Math.max(Math.floor(now() / SLOT) * SLOT, epgStart - SLOT); renderEpg(); }
      else if (k === K.RIGHT) { epgStart += SLOT; renderEpg(); }
      else if (k === K.OK || k === K.DPAD_CENTER) { var s = epgSel; closeAll(); tune(s); }
      else { handled = false; }
    } else if (mode === 'setup') {
      if (k === K.UP) { setupSel = Math.max(0, setupSel - 1); renderSetup(); }
      else if (k === K.DOWN) { setupSel = Math.min(SETUP.length - 1, setupSel + 1); renderSetup(); }
      else if (k === K.LEFT) { changeSetup(-1); }
      else if (k === K.RIGHT || k === K.OK || k === K.DPAD_CENTER) { changeSetup(1); }
      else { handled = false; }
    } else { handled = false; }
    if (handled) { e.preventDefault(); }
  });
  function toggleFullscreen() {
    var tw = window.__TAURI__ && window.__TAURI__.window;
    if (tw && tw.getCurrentWindow) {
      var w = tw.getCurrentWindow();
      w.isFullscreen().then(function (f) { w.setFullscreen(!f); });
      return;
    }
    var d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
    else if (el.requestFullscreen || el.webkitRequestFullscreen) { (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
  }
  function toggleFav(c) {
    if (!c) { return; }
    var p = cfg.favs.indexOf(c.id);
    if (p >= 0) { cfg.favs.splice(p, 1); toast(T('favOff')); } else { cfg.favs.push(c.id); toast(T('favOn')); }
    saveCfg();
  }

  // touch and mouse: swipe to zap, tap for info, tap rows in overlays
  var touchY = null, touchT = 0;
  $('tv').addEventListener('touchstart', function (e) { touchY = e.touches[0].clientY; touchT = now(); }, false);
  $('tv').addEventListener('touchend', function (e) {
    if (touchY === null || mode !== 'tv') { return; }
    var dy = e.changedTouches[0].clientY - touchY; touchY = null;
    if (Math.abs(dy) > 60) { tune(chIdx + (dy < 0 ? 1 : -1)); }
    else if (now() - touchT > 700) { openSetup(); }      // press and hold: Setup (phones and tablets have no S key)
    else if (now() - touchT < 400) { flashBanner(); }
  }, false);
  // a small gear for mouse and touch users
  var gear = document.createElement('div'); gear.id = 'gear'; gear.textContent = '\u2699'; gear.title = 'Setup';
  gear.onclick = function (e) { e.stopPropagation(); if (mode === 'setup') { closeAll(); } else { openSetup(); } };
  document.body.appendChild(gear);
  $('tv').addEventListener('dblclick', function () { if (mode === 'tv') { openList(); } });
  function rowClick(container, fn) {
    container.addEventListener('click', function (e) {
      var el = e.target; while (el && el !== container && !el.getAttribute('data-i')) { el = el.parentNode; }
      if (el && el !== container) { fn(parseInt(el.getAttribute('data-i'), 10)); }
    });
  }
  rowClick($('listItems'), function (i) { var c = listChannels()[i]; closeAll(); tune(channels().indexOf(c)); });
  rowClick($('epgBody'), function (i) { closeAll(); tune(i); });
  rowClick($('setupItems'), function (i) { setupSel = i; changeSetup(1); });

  // keep the clock and banner honest without polling the network
  setInterval(function () { if (!$('banner').className.match(/hidden/)) { renderBanner(); } if (mode === 'epg') { renderEpg(); } }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tune(chIdx, true); checkUpdate(false); } });

  // Android back button (Capacitor shell)
  var cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (cap && cap.addListener) { cap.addListener('backButton', function () { if (!back()) { cap.exitApp(); } }); }

  applyLook();
  tune(chIdx);
  // web version ships without a bundled catalog: fetch it right away
  if (!(catalog.episodes && catalog.episodes.length)) { checkUpdate(true); } else { setTimeout(function () { checkUpdate(false); }, 5000); }
}());
