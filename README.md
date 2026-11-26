# Nostalgia Orbit

A retro satellite-receiver TV app. 25 channels of 2000–2013-era (and older) shows air on fixed schedules
on Kuwait time, like real broadcast TV. Android / Google TV, Samsung Tizen TVs (2017+), Windows and web.

## How it fits together

| Part | Where it runs | What it does |
|---|---|---|
| `client/` | on every device | Receiver UI, channel zapping, guide, CRT filter, playback, on-device fallback to backup links. Plain ES5 so 2017 Samsung TVs run it. |
| `shared/schedule.js` | on every device (and in tests) | Works out what is on any channel at any moment from the catalog. Same input, same answer on every device, so no server is needed. |
| `curator/` | GitHub Actions, nightly, free | Checks every link in cheap batches, heals broken episodes, finds new content within an API budget, publishes `catalog.json`, the dashboard and the web app to GitHub Pages. |
| `platforms/` | GitHub Actions | Wraps the client as an APK (Capacitor), a Windows installer (Tauri) and a Tizen `.wgt`. |

Apps ship with a catalog snapshot inside, so they work even if GitHub is down, and pick up the nightly
catalog when it's newer.

## Day-to-day

* **Dashboard:** `https://<you>.github.io/nostalgia-orbit/admin/`
* **Web version:** `https://<you>.github.io/nostalgia-orbit/`
* **Fix links / find more now:** Actions → nightly → Run workflow (task: nightly, check, heal or discover + channel id).
* **New app builds:** Actions → apps → Run workflow (or push a tag `v0.2.0` for a Release).
* **Budgets:** `curator/data/budget.json` (KWD shown on the dashboard). **Search sources:** `curator/data/seeds.json`.

## Secrets (Settings → Secrets and variables → Actions)

* `YOUTUBE_API_KEY` — required for full checks and discovery. Free (10,000 units/day).
* `ANTHROPIC_API_KEY` — optional; only for titles code can't classify. Capped by `budget.json`.

No keys ever go into the apps. See `docs/INSTALL.md` and `docs/LIMITATIONS.md`.
