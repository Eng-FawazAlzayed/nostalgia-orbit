// Optional AI helper, used ONLY when deterministic parsing can't tell which
// show/episode a title is. Off unless ANTHROPIC_API_KEY is set, always inside
// the daily/monthly budget, results cached forever. Everything else works without it.
import { http } from './util.mjs';
import { canSpend, record, cached } from './budget.mjs';

const CHEAP = 'claude-haiku-5-5';
// rough price guard: ~1.2k tokens in/out per call on the cheap model
const EST_USD_PER_CALL = 0.004;

export function enabled() { return !!process.env.ANTHROPIC_API_KEY; }

export async function classifyTitle(title, hint = '') {
  if (!enabled()) return null;
  return cached('ai:title:' + title, 24 * 3650, async () => {
    if (!canSpend('ai', EST_USD_PER_CALL)) return null; // budget reached: skip, never block the job
    const body = {
      model: CHEAP, max_tokens: 150,
      messages: [{ role: 'user', content:
        `A video is titled: "${title}". Channel context: ${hint || 'retro TV'}.\n` +
        'Reply with only JSON: {"series": English show name or "", "series_ar": Arabic name or "", "season": number or 0, "episode": number or 0, "is_full_episode": true/false}' }]
    };
    const res = await http('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    }, { timeout: 30000, retries: 0 });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const u = j?.usage || {};
    // Haiku-class pricing guard (USD per million tokens); conservative.
    record('ai', ((u.input_tokens || 0) * 1 + (u.output_tokens || 0) * 5) / 1e6 || EST_USD_PER_CALL, 'classify');
    try { return JSON.parse(String(j.content?.[0]?.text || '').replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { return null; }
  });
}
