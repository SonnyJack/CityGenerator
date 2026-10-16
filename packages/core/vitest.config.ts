import { defineConfig } from 'vitest/config';
// The stage tests generate real terrain and towns: a few seconds each here, and more than twice
// that on a shared CI runner, so the 5 s default is too tight (as in the engine and CLI packages).
export default defineConfig({
  test: { name: 'core', environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
