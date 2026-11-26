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
