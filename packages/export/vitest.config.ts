import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'export', environment: 'node', include: ['test/**/*.test.ts'] },
});
