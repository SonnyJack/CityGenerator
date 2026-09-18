import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// BASE_PATH is set by the GitHub Pages workflow to "/<repo>/"; local builds serve from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1600 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
