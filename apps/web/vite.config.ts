import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow to "/<repo>/"; local builds serve from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    // Installable and usable offline: the app shell, worker, fonts and icons are precached.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/**/*.pbf', 'fonts/LICENSE-OpenSans.txt'],
      manifest: {
        name: 'CityGenerator',
        short_name: 'CityGen',
        description: 'Procedural generator and editor for metropolitan-scale tabletop maps',
        theme_color: '#f2efe6',
        background_color: '#f2efe6',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,pbf,png,svg,txt}'],
        maximumFileSizeToCacheInBytes: 8_000_000,
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1600 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
