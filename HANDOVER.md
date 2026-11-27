# Nostalgia Orbit: project handover

Written 2026-11-27 for the next agent team. Read this file top to bottom before touching code. It explains what the
product is, the owner's rules, how every part works, how to build, run and ship it, where it stands, and what to do next.

Numbers in this file come from the repo as of commit `e060af4` (nightly catalog update, 2026-11-27). Re-check them on
the dashboard before quoting them to anyone.

---

## 1. Quick facts

| What | Where |
|---|---|
| Owner | Fazeen (GitHub `engfawazalzayed-lgtm`; repo owner account `Eng-FawazAlzayed`) |
| Repo (public) | https://github.com/eng-fawazalzayed/nostalgia-orbit, default branch `main` |
| Web app (GitHub Pages) | https://eng-fawazalzayed.github.io/nostalgia-orbit/ |
| Control room / admin dashboard | https://eng-fawazalzayed.github.io/nostalgia-orbit/admin/ |
| App builds (APK, Windows, Tizen) | Repo → Actions → **apps** → latest run → Artifacts |
| Phase 1 plan + clickable mockup | https://claude.ai/artifact/EZfLFxZZaGC3G6HM1jUX3Q (copy: `nostalgia-orbit.html` in project files) |
| Time zone that drives everything | Kuwait, `Asia/Kuwait`, UTC+3, no DST |
| Running cost today | 0 KWD (YouTube Data API free tier, Internet Archive free, AI helper off) |
| Tests | `cd curator && node --test test/*.test.mjs`: 29 tests, all pass |

---

## 2. The vision

A **retro satellite-receiver TV app**. You turn it on and it feels like zapping a 2000s satellite box on a CRT TV in
Kuwait. Every channel is a live, scheduled broadcast, not an on-demand catalog. The shows are old cartoons and
2000–2013 TV (Cartoon Network, Nickelodeon, Disney Channel, Toonami, Spacetoon, MBC3, Kuwait TV, Kuwaiti and Gulf
plays, G4/TechTV, Japanese TV, early internet), streamed from free sources such as YouTube and the Internet Archive.

The experience it must deliver:

- **Receiver look and feel.** A blue now/next info banner, a front-panel channel number display, a channel list on OK, a
  full EPG ("TV GUIDE · KUWAIT"), a short black "tuning" moment on every zap, and an optional CRT filter (off, light, heavy).
- **Live TV, not on-demand.** Each channel has a fixed schedule on Kuwait time. Tuning in mid-show seeks to the current
  minute. Every device shows the same thing at the same moment.
- **Period breaks.** Between episodes the channel plays its own period bumpers and ads (short clips only).
- **Runs on old hardware.** Samsung Tizen TVs from 2017–2019 are the hardest target, then low-end Google TV sticks,
  Android phones and tablets, Windows, and a web fallback.

---

## 3. Fazeen's rules (non-negotiable unless Fazeen changes them)

These came from Fazeen across the planning thread. Later rules override earlier ones, and they are listed here in final form.

**Architecture**
1. **No mini PC, no home server, no VPS, no always-on backend.** Fazeen rejected this explicitly.
2. **Free GitHub is the backend.** It hosts the link catalog (GitHub Pages) and runs the maintenance job (GitHub Actions),
   so every device syncs to the same catalog. It must stay free, which means the repo stays **public**.
3. **Apps are self-sufficient.** Each app bundles a catalog snapshot, computes the schedule **on the device** on Kuwait
   time, and keeps working if GitHub is unreachable. It picks up the newer catalog from Pages when there is one.
4. **No keys in the apps.** The YouTube and AI keys live only as GitHub Actions secrets. Personal-service tokens
   (Real-Debrid, TorBox, Jellyfin, Plex) live only on the device that uses them.

**Content**
5. Any free online source is fine, including fan uploads. Official copies are not required, and the most reliable
   copy wins. Never fabricate links. Only links that passed a real check go on air.
6. **Only full episodes, shows, plays and broadcast recordings.** No clips, no compilations of moments, no anime
   openings or endings, no podcasts, panels, reviews, reaction or explainer videos (including Arabic شرح، تحليل، ملخص),
   no documentaries except gaming ones, no other-language dubs where the channel is meant to be English or Arabic.
7. The only short videos allowed are **period bumpers, ads and idents** for that channel, played between episodes.
8. **Gulf plays (028)** only if the play was originally released 1990–2010, judged by a year in the title, not the upload date.
9. **Excluded entirely:** public-domain cinema, black-and-white TV and cartoons, 1930s shorts, NASA films, radio,
   generic educational or nature content. Nothing dated before 1950 or after 2013.
10. Each channel airs only shows on its own show lists (`seeds.json` → `channel_only`).
11. The YouTube player must show **only the video**: no title bar, logo, controls, pause icon or captions.

**Naming and lineup**
12. Use **plain, real channel names** (CARTOON NETWORK, NICKELODEON, MBC3 CLASSIC…). No code names. Arabic names in the
    Arabic menu. Fazeen chose this on 2026-11-26, which replaced the earlier "original branding" idea.
13. A channel with fewer than 12 episodes to air is hidden until it has more.

**Cost**
14. API efficiency matters. Use deterministic code for everything it can do. AI is only for titles code can't classify,
    is off by default, and has daily and monthly caps shown in KWD. Never run a full AI rescan unless Fazeen asks.

**Real-Debrid / TorBox**
15. These are optional and paid. **Fazeen changed this rule on 2026-11-28**: CARTOON NETWORK (002), NICKELODEON (006)
    and DISNEY CHANNEL (007) take their episode sources from a Stremio add-on in front of his own debrid accounts
    (Torrentio with a Real-Debrid and/or TorBox key) instead of YouTube and the Internet Archive. Every other channel
    keeps free sources.
    - The app is an **add-on client**, not a debrid client: it calls `manifest.json` and
      `/stream/series/<tt>:<season>:<episode>.json`, then plays the returned `url`. No provider API tokens in the repo,
      no torrent code, no indexer, no server.
    - **Cached only.** A stream plays only when the add-on returns a resolved `url`. Entries with just an `infoHash`
      would make the account download the torrent, so they are listed and never played.
    - Add-on URLs hold the API key. They live on the device (localStorage, or an ignored `secrets.local.js`) and are
      never committed, published or logged.
    - Fallback to free sources stays on unless Fazeen turns it off, so a channel never goes dark.
    - Reference implementation: `pilot/index.html`, published at `/pilot/` by `curator/src/build.mjs`.

**Working style**
- Fazeen writes casually and often by voice, in several quick messages. Expect lineup and content changes on the fly.
- Fazeen likes Claude for Chrome prompts for any browser setup step they have to do themselves (GitHub, Google Cloud).
- Proceed on ordinary development tasks without asking. Ask Fazeen only for credentials, paid subscriptions, signing
  certificates or account access.

---

## 4. Architecture

```
                 ┌──────────────────────── GitHub (free, public repo) ────────────────────────┐
                 │                                                                             │
  seeds.json ──► │  Actions: nightly.yml (daily 08:20 UTC = 11:20 Kuwait, or manual)          │
  channels.json  │    curator/ (Node 22, zero deps)                                            │
                 │      check  → batch link checks with backoff                                 │
                 │      heal   → switch to alternates, search replacements for orphans          │
                 │      discover → YouTube Data API + Internet Archive, within budget            │
                 │      probe  → ffprobe Archive codecs (H.264 only is published)               │
                 │      build  → catalog.json + stats.json + web app + admin dashboard          │
                 │    commits curator/data/library.json + curator/state/* back to main          │
                 │    deploys public/ to GitHub Pages                                           │
                 │                                                                             │
                 │  Actions: apps.yml (manual or tag v*)                                        │
                 │    bundle (client + shared/schedule.js + catalog snapshot)                  │
                 │      → Android APK (Capacitor) → Windows NSIS installer (Tauri 2)            │
                 │      → Tizen unsigned .wgt     → GitHub Release on tags                      │
                 └───────────────┬────────────────────────────────────────────────────────────┘
                                 │  https://<owner>.github.io/nostalgia-orbit/catalog.json
                                 ▼
     Devices: Tizen TV · Android / Google TV · Windows · browser
       client/ (ES5, no framework) + shared/schedule.js (same engine on every device)
       - bundled snapshot first, then a newer catalog from Pages if available
       - computes "what's on now" locally from the catalog and the Kuwait clock
       - plays YouTube (IFrame API), Archive MP4, HLS, and optional personal libraries
       - on-device fallback: backup copy → next episode; remembers failed links with backoff
```

### Repo map

| Path | What it is |
|---|---|
| `shared/schedule.js` | **Schedule engine.** ES5 UMD (`NOSched`), used by the client, the curator and the tests. Deterministic. |
| `client/index.html`, `style.css` | Receiver UI shell. Flexbox only, no CSS variables or grid (Chromium 47). |
| `client/app.js` | Client logic: catalog load and update, tuning, banner, channel list, EPG, Setup menu, remote keys, favourites, follow (My Shows), EN/AR menus. |
| `client/providers.js` | Playback. One `<video>` and one YouTube player at a time. YouTube chrome hidden, captions off, black cover until real playback. Jellyfin/Emby import, Plex, WebDAV. |
| `client/debrid.js` | Real-Debrid and TorBox: device-code sign-in or pasted token, library scan, file picking, fresh links just before air. |
| `curator/src/cli.mjs` | Entry point: `nightly`, `check [all]`, `heal`, `discover [channelId]`, `probe`, `build`. |
| `curator/src/db.mjs` | Opens and saves `library.json`. Source id = `<provider>:<ref>`, so duplicates are impossible. |
| `curator/src/maintain.mjs` | Self-healing: due-source batches, exponential backoff, temporary vs dead, orphans, replacement search. |
| `curator/src/discover.mjs` | Incremental discovery from `seeds.json`: handles, searches, per-show playlist searches, Archive queries. |
| `curator/src/titles.mjs` | Deterministic title parsing: series, season/episode, language, dub, clip and non-show detection, show matching. |
| `curator/src/build.mjs` | Publish filters (`keepEpisode`), compact catalog, `collect` (shows shared across channels), stats, writes `public/` and `dist/bundle/`. |
| `curator/src/budget.mjs` | Daily and monthly budgets (the YouTube day follows Pacific midnight), persistent cache, rate limits, usage tracking. |
| `curator/src/ai.mjs` | Optional Anthropic title classifier. Off unless `ANTHROPIC_API_KEY` is set. Cached forever. |
| `curator/src/probe.mjs` | ffprobe one file per Archive item. Non-H.264 isn't published. |
| `curator/src/providers/` | `youtube.mjs` (Data API v3 + oEmbed fallback), `archive.mjs` (search, metadata, best file), `direct.mjs` (MP4/HLS check). |
| `curator/data/channels.json` | **Lineup**: id, number `n`, `name`, `ar`, `work` (description), colour, theme, `blocks` (schedule), `collect`, `mix`. |
| `curator/data/seeds.json` | **Discovery config**: per-channel seeds, `show_lists`, `show_years`, `series_require`, `channel_only`, `channel_exclude`. |
| `curator/data/budget.json` | API limits, KWD rate, batch sizes, `allow_unknown_youtube_uploaders`. |
| `curator/data/library.json` | **The content database** (about 9.5 MB). Edited by the nightly job and committed. |
| `curator/state/` | `cache.json` (search/metadata cache), `usage.json` (API use), `runs.json` (last 60 runs). |
| `curator/dashboard/index.html` | Admin dashboard, published at `/admin/`, reads `stats.json`. |
| `curator/test/` | `curator.test.mjs` (16), `schedule.test.mjs` (13). |
| `platforms/android/` | Capacitor 6 config, `patch-manifest.sh` (Android TV leanback launcher, banner, cleartext). |
| `platforms/windows/src-tauri/` | Tauri 2 app (Rust). Uses WebView2. |
| `platforms/tizen/` | `config.xml` (required_version 3.0, tv-samsung profile, remote key privileges), `build-wgt.sh`. |
| `docs/INSTALL.md`, `docs/LIMITATIONS.md` | Install steps per platform; honest list of limits. |
| `assets/` | Logo SVG, 512 icon, 320×180 Android TV banner. |

**Important naming quirk:** channel **ids** are old code names that predate the plain names, for example
`toon-orbit-gold` = CARTOON NETWORK and `najma-3` = MBC3 CLASSIC. Ids are keys in the library, seeds, client storage
and favourites. **Don't rename ids.** Change only `name` / `ar` in `channels.json`. The full mapping is in section 7.

---

## 5. Data model

`curator/data/library.json` = `{ version, series, episodes, sources, updated, ia_items, ia_codec }`

- **Series** `{ id, titles:{en,ar,ja}, year, kind: series|interstitial|play, language, dub, subs, channels:{ <channelId>: [tags] }, fill? }`.
  `channels` maps each channel to the block tags (`morning`, `afterschool`, `prime`, `overnight`, `*`…) the series can air in.
  `fill: true` marks bumpers and ads (interstitials).
- **Episode** `{ id, series, season, episode, titles, year, language, dub, subs, duration (s), quality, fingerprint, created }`.
  `fingerprint` dedupes the same episode found through different providers.
- **Source** `{ id: "<provider>:<ref>", episode, provider: youtube|archive|direct, ref, url, kind: embed|mp4|hls,
  authorization: official|licensed|public-domain|cc|unknown, uploader, quality, duration, offset, embeddable, seekable,
  regions:{a:[allowed], b:[blocked]}, status: ok|failing|dead|pending, reliability 0–1, fail_count, last_ok, last_try,
  next_check, last_error, history[] }`.

Published `catalog.json` is a compact form: `{ v, generated, channels, series, episodes:[{id, s, t, d, sn, ep, src:[{p:'yt'|'ia', r, k, a, rel, q, reg}]}], shows }`.
Only sources that pass `isPublishable` and episodes that pass `keepEpisode` are included.

Current size (2026-11-27): library has 729 series, 5,336 episodes and 5,888 sources (1,958 YouTube, 3,930 Archive),
with 5,887 working and 1 dead. Published: **4,008 episodes in 459 series on 25 visible channels**, and 213 episodes have
alternate copies.

---

## 6. How the pieces work

### 6.1 Schedule engine (`shared/schedule.js`)
- The broadcast day starts at **06:00 Kuwait**. Day numbers count from the anchor `2026-01-01 06:00 Kuwait` (03:00 UTC).
- Each channel's `blocks` = `[{ f:"HH:MM", t:"HH:MM", g:<tag>, days?:[0-6], months?:[1-12], label?, mode? }]`.
  A block limited to certain days or months beats the everyday block it overlaps (month 2 > day 1 > none). That's how
  Friday Cartoon Night, Halloween (October), Christmas (December), summer marathons and 2005/2008/2010 flashbacks work.
- `Index.day(channel, dayIdx)` lays out a day deterministically (seeded shuffles and episode order), fits shorter
  episodes into the end of a block so there are no empty "Coming up" gaps, and inserts breaks from the channel's `fill` series.
- `Index.at(channel, nowMs)` returns the current item and its **offset**, so the player seeks to the right minute.
- Modes: Classic (planned order), Random (shuffle with no repeat until the whole list has played, about 7 days),
  Sequential (channel 100 **My Shows**: followed shows in order, progress saved on the device). Channel 108 **Random
  Nostalgia** uses `mix` weights over channels 101–107.
- `pickSources` orders an episode's copies by device capability, failures remembered on this device, region (KW) and reliability.

### 6.2 Client (`client/`)
- Start: load the bundled `window.NO_CATALOG` (apps) or the saved copy, then `checkUpdate()` fetches `catalog.json` from
  Pages. On the web it checks on every visit; in the apps, at most every 6 hours, or from Setup → "Check for channel updates".
- Storage is `localStorage` with prefix `no.`, wrapped in try/catch because some TVs throw.
- Keys: CH▲▼ / PgUp/PgDn / ▲▼ zap; digits jump to a channel; OK opens the channel list; GUIDE or G opens the EPG; INFO or I
  shows the banner; PRE-CH goes to the previous channel; RED or C cycles the CRT filter; GREEN or F adds a favourite in
  the list; YELLOW or Y follows a show; BLUE or S opens Setup; N toggles names; F11 is fullscreen; BACK closes menus or
  exits on Tizen. Touch: ⚙ gear bottom-right, or press and hold.
- Tizen remote keys are registered through `tizen.tvinputdevice.registerKey`. Low-performance mode is on by default on Tizen.
- Playback failure path: retry → refresh (debrid) → next copy → skip to the next item. The bad source is remembered with backoff.

### 6.3 Nightly curator (`curator/`, run by `nightly.yml`)
1. **Tests** run first, and a failing test stops the job.
2. **check**: sources whose `next_check` is due, in batches of `check_batch_size`. YouTube `videos.list` checks 50 ids
   for 1 unit and looks at existence, embeddable, age restriction, Kuwait region and duration. Without a key it uses
   oEmbed. Archive checks use metadata. Backoff grows on success, and failures are classed as temporary or dead.
3. **heal**: episodes with no working copy (orphans) try their alternates, then a capped replacement search (20 per run).
4. **discover**: works through `seeds.json` per channel, with the new-episode cap spread fairly across channels. Searches
   cost 100 units each and are cached for 30 days. Playlist listing is 1 unit per 50 videos. Channels 101–107 search the
   Archive first, then YouTube.
5. **probe**: ffprobe on up to 200 Archive items per run.
6. **build / publish**: applies the current rules in `keepEpisode`, so a rule change cleans the published catalog at
   once, without waiting for re-discovery. Then it writes `public/` and `dist/bundle/`.
7. Commits `library.json` and `state/` to `main` (with a rebase-and-retry loop), then deploys Pages. The deploy is
   retried once, because GitHub sometimes says "No artifacts named github-pages".

Manual runs: Actions → nightly → Run workflow → `task` = `nightly | check | heal | discover | probe | build`,
optional `channel` = channel id for discover. `check` with channel `all` re-tests every link.

**Budgets** (`budget.json`): 9,000 YouTube units a day, with 1,500 reserved for checks. AI is capped at $0.10 a day and
$1 a month (shown in KWD at 0.307). Discovery used about 7,500 units on each of the last two days, so the free quota is
the real limit on how fast channels grow.

### 6.4 Optional personal providers (all on-device, off by default)
- **Real-Debrid**: device-code sign-in (uses the open-source client id) or a token from real-debrid.com/apitoken.
  **TorBox**: device flow or an API key from torbox.app/settings. Scan reads only existing files. File picking prefers
  480–720p H.264/AAC MP4 inside size targets (11 min: 40–100 MB; 22 min: 80–220 MB; 45 min: 200–450 MB; movies: 400–900 MB).
  HEVC, AV1 and 10-bit files are skipped unless a toggle is on. Matched files attach to the show's channel, and your own
  copy plays first. Unmatched files go to **channel 099 My Library**. Real-Debrid's media-info endpoint isn't called per
  file, which keeps under its limit of 250 requests a minute.
- **Jellyfin / Emby** import, **Plex**, **WebDAV**: URLs and tokens are entered in Setup and stay on the device.
- In the browser these may be blocked by CORS, so the Android or Windows app is the better place to use them.

---

## 7. Channel lineup and coverage (published, 2026-11-27)

The id is the internal key and the name is what the user sees. Hours are total published runtime.

| # | Name | id | Series | Episodes | Hours | Notes |
|---|---|---|---|---|---|---|
| 002 | CARTOON NETWORK | `toon-orbit-gold` | 20 | 521 | 199 | Themed blocks, e.g. Friday Cartoon Night |
| 004 | BOOMERANG | `rebound` | 8 | 36 | 16 | Thin |
| 006 | NICKELODEON | `orange-couch` | 14 | 296 | 126 | Sitcom Night on Thursdays |
| 007 | DISNEY CHANNEL | `magic-hour` | 21 | 287 | 147 | Original Movie Night on Fridays |
| 009 | JETIX / FOX KIDS | `zap-kids` | 15 | 120 | 63 | Power Rangers, Digimon, Fox Kids |
| 013 | TOONAMI | `comet` | 7 | 287 | 323 | Broadcast recordings + RetroCrush and others |
| 016 | JAPANESE TV | `tokyo-tube` | 26 | 154 | 66 | Tokusatsu, Japanese TV |
| 020 | SPACETOON CLASSIC | `planet-toon` | 11 | 106 | 37 | Fan uploads; no official handle found |
| 021 | SPACE POWER | `power-orbit` | 53 | 109 | 18 | Thin; Grendizer trivia excluded |
| 023 | MBC3 CLASSIC | `najma-3` | 50 | 88 | 8.5 | Very thin (short episodes) |
| 025 | KUWAIT TV | `dirati-tv` | 3 | 84 | 44 | |
| 027 | KUWAITI PLAYS | `masrah-kuwait` | 86 | 184 | 372 | Prime-time and weekend blocks |
| 028 | GULF PLAYS | `khaleej-stage` | 72 | 79 | 50 | 1990–2010 release-year rule |
| 029 | RAMADAN CLASSICS | `ramadan-nights` | – | 0 | – | **Hidden** (nothing passes the filters) |
| 030 | ADULT SWIM | `night-owl` | – | 16 in library | – | **Hidden** (under 12) |
| 039 | G4 | `player-2` | 4 | 185 | 121 | Split from TechTV at Fazeen's request |
| 041 | CLASSIC YOUTUBE | `rewind-web` | 12 | 17 | 2 | Very thin |
| 042 | TECHTV | `byte-shop` | 2 | 394 | 250 | Mostly Computer Chronicles and Screen Savers |
| 047 | MTV CLASSIC | `old-mtv` | 3 | 25 | 18 | Archive broadcasts |
| 101 | GAMING SHOWS | `gamezone` | 11 | 242 | 173 | |
| 102 | INTERNET 2006 | `internet-2006` | 7 | 302 | 91 | |
| 103 | JAPAN 2000 | `japan-2000` | 20 | 344 | 242 | Flagship; Archive-first (Game Center CX, Gaki…) |
| 104 | CARTOONS 2000s | `cartoon-city` | 34 | 839 | 355 | Collects CN/Nick/Disney/Jetix shows |
| 105 | سبيستون زمان | `spacetoon-zaman` | 115 | 403 | 110 | Arabic dubs |
| 106 | الكويت زمان | `kuwait-zaman` | 171 | 377 | 538 | Kuwaiti/Gulf TV, theatre, Ramadan |
| 107 | TEEN SITCOMS | `after-school` | 6 | 231 | 89 | Was only Malcolm in the Middle; broadening |
| 108 | RANDOM NOSTALGIA | `random-nostalgia` | mix | – | – | Weighted mix of 101–107 (built on the device) |
| 099 | MY LIBRARY | client only | | | | Unmatched Real-Debrid/TorBox/Jellyfin files |
| 100 | MY SHOWS | client only | | | | Followed shows, in order |

Removed by Fazeen: Vault 33, Field Trip, Sitcom Lane, Game Show Gold, Magic Hour's 1928 shorts, 040 Free Live TV,
048 Football Highlights, and the Music Videos channel (now MTV Classic).

---

## 8. Build, run, deploy

### Local development
```bash
git clone https://github.com/eng-fawazalzayed/nostalgia-orbit && cd nostalgia-orbit
cd curator && node --test test/*.test.mjs     # Node 22+, no npm install needed
node src/cli.mjs build                         # writes ../public (web + catalog + /admin) and ../dist/bundle
cd ../public && python3 -m http.server 8080    # open http://localhost:8080 (catalog.json loads relative)
```
`discover`, `check` and `heal` need network access to YouTube and archive.org, and the YouTube work needs `YOUTUBE_API_KEY`.
The default Claude cloud workspace **blocks youtube.com and archive.org**, so run network work through the GitHub
Actions nightly job. An environment called "Nostalgia Orbit (content sources)" that allows those hosts was created,
but it is optional.

### Secrets (repo → Settings → Secrets and variables → Actions)
- `YOUTUBE_API_KEY`: **set and working.** Google Cloud project "nostalgia-orbit", restricted to YouTube Data API v3, no billing.
- `ANTHROPIC_API_KEY`: not set (AI helper off). Optional.
- Pages source = **GitHub Actions**. Workflow permissions = **Read and write**.

### Workflows
- `nightly.yml`: cron `20 8 * * *` (08:20 UTC = 11:20 Kuwait, just after YouTube's quota resets at midnight Pacific),
  plus manual dispatch. 120-minute timeout, concurrency group `nightly`.
- `apps.yml`: manual dispatch, or push a tag `v*` to also create a GitHub Release with the files.
  - **Android**: Capacitor 6 → `gradlew assembleDebug` → `NostalgiaOrbit.apk` (about 3.4 MB). It is a **debug-signed** APK.
  - **Windows**: Tauri 2 → NSIS `.exe` installer (about 2.9 MB). Unsigned, so SmartScreen will warn.
  - **Tizen**: `build-wgt.sh` → `NostalgiaOrbit-unsigned.wgt` (about 0.25 MB).

### Tizen signing and install (not done yet; needs Fazeen's Samsung account and TV)
1. Install **Tizen Studio** with "TV Extensions" and "Samsung Certificate Extension".
2. On the TV: Apps → press `1 2 3 4 5` → Developer mode ON → enter the PC's IP → restart the TV.
3. Tizen Studio → Device Manager → Scan → connect to the TV.
4. Certificate Manager → New → **Samsung** certificate → TV → sign in with a free Samsung account. The TV's DUID is
   added to the distributor certificate.
5. Sign and install:
   ```
   unzip NostalgiaOrbit-unsigned.wgt -d nostalgia
   tizen package -t wgt -s <certificate-profile> -- nostalgia
   tizen install -n nostalgia/NostalgiaOrbit.wgt -t <tv-name>
   ```
6. Developer-mode installs can expire on some models, so re-run step 5 if the app disappears. Never commit `author.p12`,
   `distributor.xml` or any `.p12` (they're already in `.gitignore`).
7. **Fallback if embedded YouTube refuses to play in the packaged app:** switch to a "hosted" build by changing
   `<content src>` in `platforms/tizen/config.xml` to the Pages URL.

### Installing on other devices
See `docs/INSTALL.md`. Android: sideload the APK (allow unknown apps; on Google TV use Downloader or Send Files to TV).
Windows: run the installer. Web: open the Pages URL, click once so sound can play, and hard-refresh after deploys.

---

## 9. Status: what's done

- Phase 1 research, plan, receiver mockup and logo (the artifact above).
- Public repo, Pages, the nightly job, the apps job, the YouTube key: all live.
- Schedule engine with Kuwait time, tune-in offset, themed and seasonal blocks, marathons, gap filling, breaks,
  Classic/Random/Sequential modes, and Random Nostalgia mix.
- Receiver client: banner, list, EPG, Setup (scrollable, with gear and long-press for touch), CRT levels,
  low-performance mode, EN/AR menus, favourites, follow and My Shows, digit entry, Samsung remote keys.
- YouTube player shows only the video: chrome pushed off-screen, captions forced off, black cover until it really plays.
- Archive playback: picks the right file per episode, 30-second start allowance plus one retry (fixed Japan 2000 "NO SIGNAL").
- Self-healing: batch checks, backoff, dead vs temporary, alternates, orphan replacement search, on-device failure memory.
- Content quality filters: channel-only show lists, real-episode rules, non-show and commentary rejection, adult
  filter, 1950–2013 window, Gulf-play year rule, codec probe, period-only breaks.
- Per-show YouTube full-episode playlist discovery.
- Real-Debrid/TorBox library integration (client-side), plus Jellyfin/Emby/Plex/WebDAV.
- Dashboard: totals, coverage by channel, decade and language, broken and pending sources, API use in KWD, runs, maintenance hints.
- A full debug pass on 2026-11-26: 4,912 links tested (4,911 OK), every channel zapped in a headless browser with 0
  errors, and a week of schedules with no overlaps.

---

## 10. Known issues and open items (most important first)

1. **Never tested on a real Samsung TV.** The `.wgt` is unsigned, and signing needs Fazeen's Samsung account and the
   TV's DUID. Whether embedded YouTube plays inside a packaged Tizen 3.0 app is the biggest unknown. AVPlay (Samsung's
   native player) isn't used yet. `build-wgt.sh` mentions `docs/TIZEN.md`, which doesn't exist; the steps are in `docs/INSTALL.md`.
2. **No agent has watched video on a real device.** The cloud workspace can't reach github.io, youtube.com or
   archive.org, so playback was verified through API checks and headless zapping only. Ask Fazeen for device reports.
3. **Some modern or clip content still leaks into published channels.** Examples in the current catalog: "Iyanu | FULL
   EPISODE" (a 2024 show) and "Every Alien Introduced in Ben 10: Alien Force" (a compilation) under the official
   "Cartoon Network" series. Stats show 324 episodes tagged 2020s and 2,859 with no year. Tighten `keepEpisode` for
   official brand uploads (require a listed classic show name and no year above 2013), and add a test.
4. **Thin channels:** Boomerang (16 h), Space Power (18 h), MBC3 Classic (8.5 h), Classic YouTube (2 h) and MTV Classic
   (18 h). Ramadan Classics and Adult Swim are hidden. Spacetoon, Disney XD, Cartoon Network Arabic and Digimon have no
   official YouTube handle that resolves, so they rely on fan uploads. Comet/anime was thin before RetroCrush.
5. **YouTube quota is the bottleneck.** About 360 queued searches need roughly 5 days of the free allowance. Prefer
   playlist listing (1 unit per 50) over search (100 units). Don't add a second key without asking Fazeen.
6. **Scheduled nightly timing:** the 2026-11-27 scheduled run started at 18:17 UTC instead of 08:20 UTC. GitHub delays
   cron under load. Watch a few days; if it keeps starting late, add a second cron as a backup. The run is safe to repeat.
7. **Real-Debrid scan result never reported.** Fazeen connected Real-Debrid but never sent the scan message. TorBox's
   response field names are guessed (its docs give empty schemas), so verify against a real response if a scan finds 0.
8. **Android APK is debug-signed** and the Windows installer is unsigned. That's fine for sideloading, but a release
   keystore is needed for updates without uninstalling. Store it only as an Actions secret, and ask Fazeen first.
9. **Not synced across devices:** favourites, settings, follows, remembered failures and personal-provider tokens stay
   on each device. Syncing them was deferred because it needs a login.
10. **4:3 cropping:** pushing the YouTube chrome off-screen trims a thin strip from 4:3 shows.
11. The CRT filter is an overlay, not a pixel shader, because browsers can't read pixels from a YouTube iframe.
12. Stale project files: `NostalgiaOrbit-unsigned.wgt` and `src-backup/nostalgia-orbit-src.tar.gz` in the project files
    date from 2026-11-26 16:21, **before any content existed**. Use the Actions artifacts and the repo instead.
13. `.gitignore` still lists `server/.env` and `server/var/` from the abandoned mini-PC design. They're harmless and can be removed.

---

## 11. Suggested next steps

1. **Tizen on Fazeen's TV.** Walk Fazeen through certificate creation (ideally as a Claude for Chrome prompt plus Tizen
   Studio steps), sign, install, and test zapping with YouTube and Archive. If YouTube fails, try the hosted variant,
   then add an AVPlay path for MP4/HLS in `client/providers.js`. Write `docs/TIZEN.md`.
2. **Close the content leaks** in issue 3, with tests in `curator/test/curator.test.mjs`. Rebuild; there's no need to
   rediscover, because `build` re-applies the rules.
3. **Fill the thin channels** through `seeds.json`: more `youtube_playlist_searches` and Archive queries for MBC3,
   Space Power, Boomerang, Adult Swim, Ramadan (fawazeer, Ramadan series from 1990–2010) and Classic YouTube. Then run
   `discover <channelId>`.
4. **Verify the Real-Debrid scan** with Fazeen. Offer the two promised extras: a daily automatic rescan, and a "gaps"
   list in Setup showing missing shows and episodes for CN, NICK and DSNY.
5. **Release signing** for Android (and optionally Windows), then tag `v0.2.0` to publish a Release.
6. Optional: favourites sync (a gist or repo file needs a token on each device, so discuss it with Fazeen first).

---

## 12. Gotchas for agents

- **Dispatching a workflow seconds after a push can run the previous commit.** Wait until `main`'s SHA shows your
  commit before you run nightly or apps.
- The nightly job commits to `main` too. Pull before you push, and expect `library.json` conflicts. The job resolves its
  own conflicts with `-X theirs`.
- Pages deploys sometimes fail with "No artifacts named github-pages". There's already one retry; re-run if both fail.
- After a deploy, users must hard-refresh the web app. The web client checks for a new catalog on every visit.
- Client code must stay **ES5 + flexbox**: no `let`/`const`, arrow functions, template strings, `fetch`, CSS variables,
  grid or `gap`. Chromium 47 on 2017 Tizen will break silently.
- Only **one** video element and **one** YouTube player at a time, for low-memory TVs. Don't preload a second player.
- `library.json` is large (about 9.5 MB). Edit it with scripts, never by hand. Keep the diffs reviewable.
- Changing publish rules only needs `build` (or the `build` task), not a new discovery run.
- Never put keys or tokens in the repo, the client or logs. Tokens stay on the device. Public repo = public catalog.
- Use plain channel names in anything user-facing. Don't call the app an official Disney/Nick/CN service.

---

## 13. Project files (shared folder `/mnt/project-files/nostalgia-orbit/`)

| File | What |
|---|---|
| `HANDOVER.md` | This document |
| `nostalgia-orbit.html` | Phase 1 plan and interactive receiver mockup |
| `nostalgia-orbit-logo.svg` | App logo (orbiting TV), the same as `assets/logo.svg` |
| `NostalgiaOrbit-unsigned.wgt` | **Stale** early Tizen build (no content). Use Actions artifacts. |
| `src-backup/nostalgia-orbit-src.tar.gz` | **Stale** pre-GitHub source backup. The repo is the source of truth. |
