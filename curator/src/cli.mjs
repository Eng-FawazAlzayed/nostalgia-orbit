#!/usr/bin/env node
// Usage:
//   node src/cli.mjs nightly            check due links -> heal -> discover a little -> publish
//   node src/cli.mjs check              only the batch link check
//   node src/cli.mjs heal               re-check alternatives, then search replacements
//   node src/cli.mjs discover [channel] find new content (all channels or one)
//   node src/cli.mjs probe              check Archive files' video codec (needs ffprobe)
//   node src/cli.mjs build              publish catalog, stats, web app and bundle
import { open } from './db.mjs';
import { runChecks, heal } from './maintain.mjs';
import { discover } from './discover.mjs';
import { publish } from './build.mjs';
import { probe } from './probe.mjs';
import { importArabic } from './arabic.mjs';
import { persist } from './budget.mjs';
import { log, nowIso, writeJSON, readJSON, STATE } from './util.mjs';
import path from 'node:path';

const [cmd = 'nightly', arg] = process.argv.slice(2);
const runFile = path.join(STATE, 'runs.json');

async function main() {
  const lib = open();
  const run = { cmd, arg: arg || null, started: nowIso() };
  try {
    if (cmd === 'check' || cmd === 'nightly') run.check = await runChecks(lib, { all: cmd === 'check' && arg === 'all' });
    if (cmd === 'heal' || cmd === 'nightly') run.heal = await heal(lib);
    if (cmd === 'discover' || cmd === 'nightly') run.discover = await discover(lib, { channel: arg || null, maxNew: cmd === 'nightly' ? 1500 : undefined });
    if (cmd === 'arabic') run.arabic = await importArabic(lib, { log: (m) => log(m) });
    if (cmd === 'probe' || cmd === 'nightly') run.probe = await probe(lib, { max: cmd === 'probe' ? 800 : 200 });
    lib.save();
    run.finished = nowIso();
    const runs = readJSON(runFile, []);
    runs.unshift(run); writeJSON(runFile, runs.slice(0, 60));
    if (['build', 'nightly', 'discover', 'heal', 'check', 'probe'].includes(cmd)) {
      publish(lib, { last_run: run, recent_runs: runs.slice(0, 10), next_run: 'daily at 11:20 Kuwait time' });
    }
  } finally {
    persist();
  }
  log('done', JSON.stringify(run));
}
main().catch(e => { console.error(e); persist(); process.exit(1); });
