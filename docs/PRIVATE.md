# Private access

The GitHub Pages site is public. This is the private copy: the same build, served from this PC
over Tailscale, so only devices in the tailnet can reach it.

```
http://100.115.3.122:8099/
```

- Start it with `private.bat` in the repo root (or `cd public && python -m http.server 8099 --bind 100.115.3.122`).
- The PC must be on and Tailscale connected; the phone/laptop must be signed into the same tailnet.
- Rebuild first so the copy is current: `cd curator && node src/cli.mjs build`.
- Nothing is exposed to the internet: the bind address is the Tailscale interface, not 0.0.0.0.

Why this instead of sharing the public site: your Real-Debrid and TorBox keys are per-browser, so
a stranger opening Pages sees no tokens and cannot spend your account. The private URL exists so
the site itself is not public, and so nothing about your viewing habits is on a public host.

Tailnet check: `tailscale status`, or `tailscale ip -4` for the address.
