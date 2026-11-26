// Small shared helpers for the curator. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const STATE = path.join(ROOT, 'state');
export const OUT = path.resolve(ROOT, '..', 'public');

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJSON(file, value, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0));
  fs.renameSync(tmp, file); // atomic replace so a crash never leaves half a file
}
export const nowIso = () => new Date().toISOString();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stable small hash (FNV-1a) for ids and deterministic jitter.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// "PT1H2M3S" -> 3723
export function isoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

// fetch with timeout and a tiny retry for network blips (not for 4xx).
export async function http(url, opts = {}, { timeout = 15000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'user-agent': 'NostalgiaOrbitCurator/0.1', ...(opts.headers || {}) } });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      if (attempt >= retries) return { ok: false, status: 0, networkError: String(e && e.message || e), json: async () => null, text: async () => '' };
      await sleep(800 * (attempt + 1));
    }
  }
}
