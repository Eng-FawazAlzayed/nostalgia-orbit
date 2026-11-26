# Known limitations (honest list)

**Playback**
* YouTube videos play only in YouTube's own embedded player, with its ads. Videos whose owners disabled embedding, age-restricted videos and videos blocked in Kuwait are skipped automatically.
* Seeking to "the current minute" works for YouTube, MP4 files and Archive videos. Live streams start at live.
* The CRT filter is an overlay (scanlines, glow, curved corners). Browsers don't let apps read the pixels of an embedded YouTube video, so a true pixel shader isn't possible on YouTube sources.
* YouTube usually needs 1–2 seconds to start. The receiver-style black "tuning" screen covers part of it; slow connections will still buffer sometimes.

**Samsung Tizen**
* 2017 TVs run Chromium 47: the client is written for that (ES5, flexbox only, no CSS variables).
* YouTube inside a packaged Tizen app is the riskiest part: some TVs refuse embedded YouTube from an app that isn't served over https. If that happens on your TV, the fallback is to install the "hosted" variant that loads the web version from GitHub Pages (a one-line change in `platforms/tizen/config.xml`: `<content src="https://<you>.github.io/nostalgia-orbit/"/>`). Archive videos and HLS streams play natively either way.
* Installing requires your own Samsung certificate tied to your TV (free, see INSTALL.md). Store distribution would need Samsung's review.
* AVPlay (Samsung's native player) isn't used yet: HTML5 video covers MP4 and HLS on these TVs. It's the next step if a specific stream type fails.

**Content**
* Only links that passed a check go on air. Channels with little verified content show "NO SIGNAL" or station idents in empty slots rather than fake listings.
* Kuwaiti/Gulf plays, old Kuwaiti cartoons and Space Power content are mostly fan uploads; they are published as "unknown" authorization and ranked below official copies. Removing them is one setting (`allow_unknown_youtube_uploaders` in `budget.json`).
* G4's own YouTube library was deleted by NBCUniversal; Player 2 uses other gaming sources.
* Without the YouTube API key the nightly job can only check existing YouTube links (via oEmbed) and can't discover new YouTube content.

**Sync**
* All devices share the same channels, catalog and schedule. Favourites, settings and remembered broken links stay on each device.
* Jellyfin/Emby imports, Plex/WebDAV and Real-Debrid/TorBox tokens are stored on the device that uses them, never in GitHub.

## Real-Debrid and TorBox (optional, paid)

- Sign in from **Setup → Real-Debrid: sign in** or **TorBox: sign in**. The TV shows a short code; enter it on your phone at the address shown. You can also paste a token. The token is stored only on that device and is sent only to the provider's own API.
- The app only reads files that are **already in your account**. It never adds torrents, never searches torrent sites and does not treat "available on a debrid service" as permission to watch.
- File choice prefers small H.264/AAC MP4 at 480p–720p within the size targets (11 min: 40–100 MB, 22 min: 80–220 MB, 45 min: 200–450 MB, movies: 400–900 MB). HEVC, AV1 and 10-bit files are skipped unless you turn on "This device plays HEVC/10-bit files". Up to two alternatives are kept per episode.
- Codec, resolution, audio and language come from file names. Real-Debrid's media-info endpoint is not called for every file, to stay within its 250 requests/minute limit. Exact length is learned the first time a file plays; until then the show's usual length is used.
- Links are made fresh just before each programme (the next one is prepared a minute early). A failed link is refreshed once, then the next copy is tried, then the channel moves on.
- Browser web views must be allowed to call the provider APIs (CORS). If a scan fails with "network" on one device, try the Android or Windows app.
- TorBox's documentation doesn't publish the field names of its file list or device-login responses; the app accepts the common names. If a TorBox scan finds nothing, tell me and I'll adjust it against a real response.
