# Debrid pilot (web)

The channel grid from the catalogue, played as live television: each channel's schedule is
computed on the device by `../shared/schedule.js`, exactly like the real client.

For **CARTOON NETWORK (002)**, **NICKELODEON (006)** and **DISNEY CHANNEL (007)** the episode
source is a Stremio add-on stream (Torrentio configured with a Real-Debrid or TorBox key)
instead of YouTube / Internet Archive. Every other channel keeps its free sources.

- Cached-only: a stream is played only when the add-on returns a resolved `url`. Streams that
  carry just an `infoHash` would make the debrid account download the torrent, so they are shown
  but never played.
- Fallback: when nothing is cached the channel plays its free source, so it never goes dark.
  Turn that off with the FALLBACK button.
- Add-on URLs contain API keys. They live in this browser's localStorage, or in an ignored
  `secrets.local.js` next to this file (`window.NO_ADDONS = { rd: "", tb: "" }`). Never in git.

Published at `/pilot/` by `curator/src/build.mjs`.
