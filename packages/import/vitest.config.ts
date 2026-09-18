import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'import', environment: 'node', include: ['test/**/*.test.ts'] },
});
