import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'features', environment: 'node', include: ['test/**/*.test.ts'] },
});
