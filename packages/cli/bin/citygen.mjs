#!/usr/bin/env node
/* global process, console */
import { main } from '../dist/index.js';

main(process.argv.slice(2)).catch((e) => {
  if (e?.code === 'commander.helpDisplayed' || e?.code === 'commander.version') return;
  console.error(e?.message ?? e);
  process.exit(1);
});
