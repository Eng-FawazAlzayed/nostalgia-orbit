/*
 * Nostalgia Orbit schedule engine.
 * Plain ES5 on purpose: it runs unchanged on 2017 Samsung TVs (Chromium 47),
 * Android WebViews, desktop and in Node for the catalog tools and tests.
 *
 * Every device computes the same schedule from the same catalog, so there is
 * no server. The broadcast day starts at 06:00 Kuwait time (UTC+3, no DST).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.NOSched = factory(); }
}(this, function () {
  'use strict';

  var HOUR = 3600000, DAY = 86400000;
  var KWT_OFFSET = 3 * HOUR;
  // 2026-01-01 06:00 Kuwait == 03:00 UTC. All day numbers count from here.
  var ANCHOR = Date.UTC(2026, 0, 1, 3, 0, 0);
  var DAY_START_MIN = 6 * 60;

  function hm(str) { // "HH:MM" (HH may be up to 30) -> minutes after midnight
    var p = String(str).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
  }
  function dayIndexOf(ms) { return Math.floor((ms - ANCHOR) / DAY); }
  function dayStartMs(dayIdx) { return ANCHOR + dayIdx * DAY; }
  // block time "HH:MM" -> ms offset from the 06:00 start of the broadcast day
  function blockOffset(str) {
    var m = hm(str) - DAY_START_MIN;
    if (m < 0) { m += 1440; }
    return m * 60000;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function kuwaitClock(ms) {
    var d = new Date(ms + KWT_OFFSET);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function kuwaitWeekday(ms) { return new Date(ms + KWT_OFFSET).getUTCDay(); } // 0 = Sunday

  function cmpEp(a, b) {
    return (a.sn || 0) - (b.sn || 0) || (a.ep || 0) - (b.ep || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  function Index(catalog) {
    this.catalog = catalog;
    this.channels = {};
    this.channelList = [];
    this.episodesBySeries = {};
    this.playlists = {};
    this.pool = [];   // shared pool (the "_interstitials" seeds), only for channels with global_fill
    this.pools = {};  // each channel's own bumpers, idents and period ads
    this.dayCache = {};
    this.dayCacheKeys = [];
    var i, c, e;
    var chans = catalog.channels || [];
    for (i = 0; i < chans.length; i++) {
      c = chans[i];
      this.channels[c.id] = c;
      this.channelList.push(c);
    }
    this.channelList.sort(function (a, b) { return parseInt(a.n, 10) - parseInt(b.n, 10); });
    var eps = catalog.episodes || [];
    for (i = 0; i < eps.length; i++) {
      e = eps[i];
      if (!e.src || !e.src.length) { continue; }
      if (!this.episodesBySeries[e.s]) { this.episodesBySeries[e.s] = []; }
      this.episodesBySeries[e.s].push(e);
    }
    var ser = catalog.series || {};
    for (var fs in ser) {
      if (ser.hasOwnProperty(fs) && ser[fs].fill && this.episodesBySeries[fs]) {
        for (i = 0; i < this.episodesBySeries[fs].length; i++) {
          e = this.episodesBySeries[fs][i];
          if (!(e.d > 0 && e.d <= 600)) { continue; }
          var owners = ser[fs].ch || {};
          if (typeof owners === 'string') { var o1 = {}; o1[owners] = 1; owners = o1; }
          for (var oc in owners) {
            if (!owners.hasOwnProperty(oc)) { continue; }
            if (oc === '_interstitials') { this.pool.push(e); }
            else { (this.pools[oc] = this.pools[oc] || []).push(e); }
          }
        }
      }
    }
    var byId = function (a, b) { return a.id < b.id ? -1 : 1; };
    this.pool.sort(byId);
    for (var pc in this.pools) { if (this.pools.hasOwnProperty(pc)) { this.pools[pc].sort(byId); } }
    for (var s in this.episodesBySeries) {
      if (this.episodesBySeries.hasOwnProperty(s)) { this.episodesBySeries[s].sort(cmpEp); }
    }
  }

  // Episodes for one channel block tag, mixed like real TV: one episode of each
  // show in turn, each show in episode order.
  Index.prototype.playlist = function (channelId, tag) {
    var key = channelId + '|' + tag;
    if (this.playlists[key]) { return this.playlists[key]; }
    var series = this.catalog.series || {};
    var ids = [], sid, tags, lists = [], i, j, longest = 0, out = [], live = [];
    var chan = this.channels[channelId] || {};
    if (chan.mix) { return (this.playlists[key] = this.mixPlaylist(chan.mix)); }
    for (sid in series) {
      if (!series.hasOwnProperty(sid) || series[sid].fill) { continue; } // bumpers and ads only go in breaks
      tags = series[sid].ch && series[sid].ch[channelId];
      if (!tags) { continue; }
      if (tag === '*all' || tags.indexOf(tag) >= 0 || tags.indexOf('*') >= 0 || tags.indexOf('*all') >= 0) { ids.push(sid); }
    }
    ids.sort();
    for (i = 0; i < ids.length; i++) {
      var list = this.episodesBySeries[ids[i]] || [];
      var vod = [];
      for (j = 0; j < list.length; j++) {
        if (list[j].d > 0) { vod.push(list[j]); } else { live.push(list[j]); }
      }
      if (vod.length) { lists.push(vod); if (vod.length > longest) { longest = vod.length; } }
    }
    for (j = 0; j < longest; j++) {
      for (i = 0; i < lists.length; i++) {
        // shorter shows loop so they keep appearing in rotation
        out.push(lists[i][j % lists[i].length]);
      }
    }
    var total = 0;
    var starts = [];
    for (i = 0; i < out.length; i++) { starts.push(total); total += out[i].d * 1000; }
    var pl = { items: out, starts: starts, total: total, live: live };
    this.playlists[key] = pl;
    return pl;
  };

  // How many ms of a given tag have aired on this channel before (day, block)?
  // Used so each day picks up the rotation where the previous day stopped.
  // A mixed channel (e.g. 108 Random Nostalgia): everything from other channels, picked by
  // weight with smooth weighted round-robin so it is deterministic and never clumps.
  Index.prototype.mixPlaylist = function (mix) {
    var subs = [], cid, i, total = 0, out = [], live = [];
    for (cid in mix) {
      if (!mix.hasOwnProperty(cid) || !(mix[cid] > 0) || !this.channels[cid] || this.channels[cid].mix) { continue; }
      var p = this.playlist(cid, '*all');
      if (p.items.length) { subs.push({ items: p.items, w: +mix[cid], cur: 0, k: 0 }); total += +mix[cid]; }
      for (i = 0; i < p.live.length; i++) { live.push(p.live[i]); }
    }
    var n = 0, seen = {}, cap = 0;
    for (i = 0; i < subs.length; i++) { cap += subs[i].items.length; }
    cap = Math.min(cap, 4000);
    while (subs.length && n < cap) {
      var best = null;
      for (i = 0; i < subs.length; i++) { subs[i].cur += subs[i].w; if (!best || subs[i].cur > best.cur) { best = subs[i]; } }
      best.cur -= total;
      var it = best.items[best.k % best.items.length]; best.k++;
      if (seen[it.id] && best.k > best.items.length) { continue; } // a show that's on two source channels: once is enough
      seen[it.id] = 1; out.push(it); n++;
    }
    var starts = [], t = 0;
    for (i = 0; i < out.length; i++) { starts.push(t); t += out[i].d * 1000; }
    return { items: out, starts: starts, total: t, live: live };
  };

  function tagLengths(channel, tag) {
    var perDay = 0, before = [], i, b, len;
    for (i = 0; i < channel.blocks.length; i++) {
      b = channel.blocks[i];
      len = blockOffset(b.t) - blockOffset(b.f);
      if (len <= 0) { len += DAY; }
      before.push(perDay);
      if (b.g === tag) { perDay += len; }
    }
    return { perDay: perDay, before: before };
  }

  Index.prototype.day = function (channelId, dayIdx) {
    var key = channelId + '|' + dayIdx;
    if (this.dayCache[key]) { return this.dayCache[key]; }
    var ch = this.channels[channelId];
    if (!ch) { return []; }
    var base = dayStartMs(dayIdx);
    var items = [];
    var wd = kuwaitWeekday(base);
    var blocks = (ch.blocks || []).filter(function (b) {
      return !b.days || b.days.indexOf(wd) >= 0; // e.g. Thursday-night specials
    }).sort(function (a, b) { return blockOffset(a.f) - blockOffset(b.f); });
    var cursor = base, i, j, self = this;
    // Gaps get the channel's own bumpers and period commercials, then a station ident.
    var pool = this.pools[channelId] || (ch.global_fill ? this.pool : []);
    var BREAK = (ch.break_s || 75) * 1000;
    // A short break of the channel's own bumpers and period ads after each episode.
    function brk(s0, e0) {
      var t0 = s0, n = pool.length, g = 0, k0;
      if (!n || e0 - s0 < 5000) { return s0; }
      k0 = Math.floor(s0 / 1000) % n;
      while (g++ < n) {
        var it = pool[(k0 + g) % n];
        if (t0 + it.d * 1000 > e0) { continue; }
        items.push({ type: 'ep', s: t0, e: t0 + it.d * 1000, ep: it, inter: true });
        t0 += it.d * 1000;
        if (e0 - t0 < 5000) { break; }
      }
      return t0;
    }
    function gap(s0, e0) {
      var t0 = s0, n = pool.length, g = 0;
      if (n && e0 - s0 >= 15000) {
        var k0 = Math.floor(s0 / 60000) % n;
        while (g++ < n) {
          var it = pool[(k0 + g) % n];
          if (t0 + it.d * 1000 > e0) { continue; }
          items.push({ type: 'ep', s: t0, e: t0 + it.d * 1000, ep: it, inter: true });
          t0 += it.d * 1000;
          if (e0 - t0 < 15000) { break; }
        }
      }
      if (t0 < e0) { items.push({ type: 'filler', s: t0, e: e0 }); }
    }
    var tagSeen = {};
    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var bs = base + blockOffset(b.f);
      var be = base + blockOffset(b.t);
      if (be <= bs) { be += DAY; }
      if (be > base + DAY) { be = base + DAY; }
      if (bs > cursor) { gap(cursor, bs); }
      if (b.off) {
        items.push({ type: 'offair', s: bs, e: be, label: b.label || '' });
        cursor = be;
        continue;
      }
      var pl = this.playlist(channelId, b.g);
      if (!pl.total && !pl.live.length && b.g !== '*all') { pl = this.playlist(channelId, '*all'); } // nothing tagged for this block yet
      var len = be - bs;
      var tl = tagLengths(ch, b.g);
      var priorToday = tagSeen[b.g] || 0;
      tagSeen[b.g] = priorToday + len;
      var t = bs;
      if (pl.total > 0) {
        var pos = (dayIdx * tl.perDay + priorToday) % pl.total;
        if (pos < 0) { pos += pl.total; }
        // start at the first whole episode at or after pos (never mid-episode)
        var k = 0;
        while (k < pl.starts.length && pl.starts[k] < pos) { k++; }
        if (k >= pl.items.length) { k = 0; }
        var placed = 0, guard = 0;
        while (guard++ < 2000) {
          var ep = pl.items[k];
          var d = ep.d * 1000;
          if (t + d > be) {
            if (placed === 0) { // one long item (a play) overruns: clip it to the block
              items.push({ type: 'ep', s: t, e: be, ep: ep, clipped: true });
              t = be;
            }
            break;
          }
          items.push({ type: 'ep', s: t, e: t + d, ep: ep });
          t += d; placed++;
          t = brk(t, Math.min(be, t + BREAK));
          k = (k + 1) % pl.items.length;
        }
      } else if (pl.live.length) {
        var lv = pl.live[((dayIdx % pl.live.length) + pl.live.length) % pl.live.length];
        items.push({ type: 'ep', s: bs, e: be, ep: lv, live: true });
        t = be;
      }
      if (t < be) { gap(t, be); }
      cursor = be;
    }
    if (cursor < base + DAY) { gap(cursor, base + DAY); }
    // keep a small cache: TVs have little memory
    this.dayCache[key] = items;
    this.dayCacheKeys.push(key);
    if (this.dayCacheKeys.length > 60) { delete this.dayCache[this.dayCacheKeys.shift()]; }
    return items;
  };

  Index.prototype.at = function (channelId, nowMs) {
    var d = dayIndexOf(nowMs);
    var items = this.day(channelId, d);
    var lo = 0, hi = items.length - 1, mid;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (items[mid].e <= nowMs) { lo = mid + 1; }
      else if (items[mid].s > nowMs) { hi = mid - 1; }
      else { break; }
    }
    var cur = items[mid];
    if (!cur) { return null; }
    var next = items[mid + 1];
    if (!next) { next = this.day(channelId, d + 1)[0]; }
    return { item: cur, offset: Math.max(0, (nowMs - cur.s) / 1000), next: next };
  };

  // Items overlapping [fromMs, toMs) for the guide.
  Index.prototype.range = function (channelId, fromMs, toMs) {
    var out = [], d = dayIndexOf(fromMs), last = dayIndexOf(toMs - 1), i, items;
    for (; d <= last; d++) {
      items = this.day(channelId, d);
      for (i = 0; i < items.length; i++) {
        if (items[i].e > fromMs && items[i].s < toMs) { out.push(items[i]); }
      }
    }
    return out;
  };

  /*
   * Order an episode's sources for this device.
   * caps: { yt: bool, hls: bool, file: bool, region: 'KW' }
   * failed: { "<provider>:<ref>": untilMs } remembered locally after errors
   */
  var AUTH_RANK = { official: 5, public_domain: 5, licensed: 4, user_owned: 4, permitted: 3, unknown: 1 };
  function sourceKey(s) { return s.p + ':' + s.r; }
  function pickSources(ep, caps, failed, nowMs) {
    var list = [], i, s, ok;
    failed = failed || {};
    for (i = 0; i < (ep.src || []).length; i++) {
      s = ep.src[i];
      ok = true;
      if (s.k === 'embed' && s.p === 'yt' && !caps.yt) { ok = false; }
      if ((s.k === 'hls' || s.k === 'live') && !caps.hls && s.p !== 'yt') { ok = false; }
      if (s.k === 'file' && !caps.file) { ok = false; }
      if (s.reg && caps.region) {
        if (s.reg.b && s.reg.b.indexOf(caps.region) >= 0) { ok = false; }
        if (s.reg.a && s.reg.a.length && s.reg.a.indexOf(caps.region) < 0) { ok = false; }
      }
      if (failed[sourceKey(s)] && failed[sourceKey(s)] > nowMs) { ok = false; }
      if (ok) { list.push(s); }
    }
    list.sort(function (a, b) {
      // Any free source is fine: the copy that plays most reliably wins, then the sharper one.
      // Who uploaded it only breaks ties.
      return (Math.round((b.rel || 0.5) * 10) - Math.round((a.rel || 0.5) * 10)) ||
        ((parseInt(b.q, 10) || 0) - (parseInt(a.q, 10) || 0)) ||
        ((AUTH_RANK[b.a] || 0) - (AUTH_RANK[a.a] || 0));
    });
    return list;
  }

  function title(ep, series, lang) {
    var t = (ep && ep.t) || {};
    var st = (series && series.t) || {};
    var name = (lang === 'ar' ? (st.ar || st.en) : (st.en || st.ar)) || '';
    var et = lang === 'ar' ? (t.ar || t.en) : (t.en || t.ar);
    if (ep && ep.ep && !et) { return name + ' · ' + (ep.sn ? 'S' + ep.sn + ' ' : '') + 'E' + ep.ep; }
    return et && et !== name ? name + ' · ' + et : name;
  }

  return {
    Index: Index,
    pickSources: pickSources,
    sourceKey: sourceKey,
    kuwaitClock: kuwaitClock,
    kuwaitWeekday: kuwaitWeekday,
    dayIndexOf: dayIndexOf,
    dayStartMs: dayStartMs,
    title: title,
    ANCHOR: ANCHOR
  };
}));
