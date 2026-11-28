# Supabase gateway (optional)

One small function that does the two things a web page cannot do on its own:

1. **arabic-toons.com** sends `X-Frame-Options: SAMEORIGIN` and no CORS headers, so the site cannot
   read or embed it. The gateway fetches the episode page server-side and returns the signed MP4.
2. **Debrid tokens** can live here instead of in every browser. The gateway asks Torrentio with the
   keys stored as Supabase secrets and returns only the cached streams, so a phone or a cousin's
   laptop can watch without ever seeing the Real-Debrid token or the TorBox key.

## Deploy (10 minutes, free plan is fine)

1. Create a project at <https://supabase.com> (or reuse the one you have). Note the **project ref**
   (the `xxxx` in `https://xxxx.supabase.co`).
2. Dashboard → **Edge Functions** → *New function* → name it `gateway` → paste the contents of
   `supabase/functions/gateway/index.ts` → **Deploy**.
   (Or with the CLI: `npx supabase link --project-ref <ref>` then
   `npx supabase functions deploy gateway`.)
3. Dashboard → **Edge Functions → Secrets** and add:
   - `RD_TOKEN` — your Real-Debrid private token
   - `TB_TOKEN` — your TorBox API key
   - `GATEWAY_KEY` — any long random string you choose; this is the passphrase the app sends
4. Test it:

   ```
   curl "https://<ref>.supabase.co/functions/v1/gateway?what=ping&key=<GATEWAY_KEY>"
   # {"ok":true,"ru":true,"tb":true}

   curl "https://<ref>.supabase.co/functions/v1/gateway?what=stream&tt=tt0220880&s=2&e=1&key=<GATEWAY_KEY>"
   # {"count":11,"streams":[{"tag":"RD","url":"https://torrentio…","k":"file",…}]}

   curl "https://<ref>.supabase.co/functions/v1/gateway?what=at&page=https://www.arabic-toons.com/3dnan-wa-lena-1415526047-20885.html&key=<GATEWAY_KEY>"
   # {"url":"https://stream.foupix.com:8443/…mp4?tkn=…"}
   ```
5. In the app: **Setup → Debrid gateway URL** = `https://<ref>.supabase.co/functions/v1/gateway`,
   **Gateway passphrase** = your `GATEWAY_KEY`. Leave both empty to use the old per-device tokens.

## What this does and does not protect

- The debrid tokens stay in Supabase secrets; the browser only ever holds the passphrase.
- Anyone who has the function URL **and** the passphrase can use your accounts — treat it like a
  password, and rotate `GATEWAY_KEY` if it leaks.
- Sharing one Real-Debrid or TorBox account with several people is against both services' terms and
  their IP checks can lock the account. Each person having their own token in their own browser is
  the safe path; the gateway is convenient for family, not risk-free.
- The function is a pass-through: it stores nothing and logs nothing.
