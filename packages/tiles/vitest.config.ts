import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'tiles', environment: 'node', include: ['test/**/*.test.ts'] } });
