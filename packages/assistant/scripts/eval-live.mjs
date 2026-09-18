#!/usr/bin/env node
/* global process, console, URL */
// Live evaluation: runs the 50 scripted requests against the Anthropic API,
// prints a pass/fail table and, with --record, rewrites eval/recordings.json.
// Usage: ANTHROPIC_API_KEY=… node scripts/eval-live.mjs [--record] [--model claude-opus-5] [--only id,id]
import { writeFileSync } from 'node:fs';
import { runLive } from '../dist/eval/live.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : undefined;
};
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set');
  process.exit(2);
}
const only = flag('--only') ? String(flag('--only')).split(',') : undefined;
const model = flag('--model') ? String(flag('--model')) : undefined;
const { results, recording } = await runLive({
  apiKey,
  ...(model ? { model } : {}),
  ...(only ? { only } : {}),
  onCase: (r) =>
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} ${r.id.padEnd(20)} ${r.tools.join(',')}${r.ok ? '' : `\n     ${r.failures.join('\n     ')}`}`,
    ),
});
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (args.includes('--record')) {
  writeFileSync(
    new URL('../eval/recordings.json', import.meta.url),
    `${JSON.stringify(recording, null, 2)}\n`,
  );
  console.log('recordings.json updated');
}
process.exit(passed === results.length ? 0 : 1);
