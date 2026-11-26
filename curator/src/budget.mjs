// API budgets, usage tracking and caching. Everything persists in state/ so the
// nightly job never repeats work or overspends.
import path from 'node:path';
import { STATE, DATA, readJSON, writeJSON, nowIso, log } from './util.mjs';

const CFG_FILE = path.join(DATA, 'budget.json');
const USAGE_FILE = path.join(STATE, 'usage.json');
const CACHE_FILE = path.join(STATE, 'cache.json');

export const config = readJSON(CFG_FILE, {});

// ---- usage ----
const usage = readJSON(USAGE_FILE, { days: {}, months: {} });
const today = () => nowIso().slice(0, 10);
const month = () => nowIso().slice(0, 7);
function bucket(store, key) { return (store[key] ||= { youtube_units: 0, ai_usd: 0, ai_calls: 0, requests: {} }); }

export function spent(provider) {
  const d = bucket(usage.days, today()), m = bucket(usage.months, month());
  if (provider === 'youtube') return { day: d.youtube_units, month: m.youtube_units };
  if (provider === 'ai') return { day: d.ai_usd, month: m.ai_usd };
  return { day: d.requests[provider] || 0, month: m.requests[provider] || 0 };
}

export function canSpend(provider, amount, { essential = false } = {}) {
  const s = spent(provider);
  if (provider === 'youtube') {
    const cap = config.youtube_units_per_day ?? 9000;
    const reserve = essential ? 0 : (config.youtube_units_reserved_for_checks ?? 1500);
    return s.day + amount <= cap - reserve;
  }
  if (provider === 'ai') {
    if (!process.env.ANTHROPIC_API_KEY) return false;
    return s.day + amount <= (config.ai_usd_per_day ?? 0.10) && s.month + amount <= (config.ai_usd_per_month ?? 1.00);
  }
  const lim = (config.requests_per_day || {})[provider];
  return lim == null || s.day + amount <= lim;
}

export function record(provider, amount, op = '') {
  for (const b of [bucket(usage.days, today()), bucket(usage.months, month())]) {
    if (provider === 'youtube') b.youtube_units += amount;
    else if (provider === 'ai') { b.ai_usd += amount; b.ai_calls++; }
    else b.requests[provider] = (b.requests[provider] || 0) + amount;
  }
  if (op && process.env.CURATOR_VERBOSE) log('spend', provider, amount, op);
}

export function usageSummary() {
  const usdToKwd = config.usd_to_kwd ?? 0.307;
  const d = bucket(usage.days, today()), m = bucket(usage.months, month());
  return {
    today: { youtube_units: d.youtube_units, ai_usd: +d.ai_usd.toFixed(4), ai_kwd: +(d.ai_usd * usdToKwd).toFixed(4), requests: d.requests },
    month: { youtube_units: m.youtube_units, ai_usd: +m.ai_usd.toFixed(4), ai_kwd: +(m.ai_usd * usdToKwd).toFixed(4), ai_calls: m.ai_calls, requests: m.requests },
    limits: {
      youtube_units_per_day: config.youtube_units_per_day ?? 9000,
      ai_kwd_per_day: +((config.ai_usd_per_day ?? 0.10) * usdToKwd).toFixed(3),
      ai_kwd_per_month: +((config.ai_usd_per_month ?? 1.00) * usdToKwd).toFixed(3)
    },
    ai_enabled: !!process.env.ANTHROPIC_API_KEY,
    // YouTube Data API and Internet Archive are free; only AI costs money.
    estimated_cost_kwd_month: +(m.ai_usd * usdToKwd).toFixed(3),
    history: Object.entries(usage.days).slice(-30).map(([day, b]) => ({ day, youtube_units: b.youtube_units, ai_usd: +b.ai_usd.toFixed(4) }))
  };
}

// ---- persistent cache with TTL + in-run request de-duplication ----
const cache = readJSON(CACHE_FILE, {});
const inflight = new Map();
export async function cached(key, ttlHours, fn) {
  const hit = cache[key];
  if (hit && hit.exp > Date.now()) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const v = await fn();
    if (v !== undefined && v !== null) cache[key] = { v, exp: Date.now() + ttlHours * 3600e3 };
    return v;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// ---- per-provider rate limit (minimum gap between calls) ----
const lastCall = {};
export async function rateLimit(provider) {
  const gap = ((config.min_gap_ms || {})[provider]) ?? 200;
  const wait = (lastCall[provider] || 0) + gap - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall[provider] = Date.now();
}

export function persist() {
  // trim: keep 90 days of usage, drop expired cache
  const days = Object.keys(usage.days).sort();
  while (days.length > 90) delete usage.days[days.shift()];
  const n = Date.now();
  for (const k of Object.keys(cache)) if (cache[k].exp < n) delete cache[k];
  writeJSON(USAGE_FILE, usage);
  writeJSON(CACHE_FILE, cache, false);
}
