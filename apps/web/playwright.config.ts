import { defineConfig, devices } from '@playwright/test';

const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Many tests wait on a full regeneration, and the map draws WebGL in software: with two tests
  // at a time, or on a hosted runner at about half a workstation's speed, 30 s is too tight.
  // Tests that need more still say so.
  timeout: 90_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // The app's offline service worker would sit between the page and the network, and only Chromium
  // lets a test intercept what passes through one: with it blocked, a mocked host answers in every
  // browser. (The installable-app test fetches the worker's script; it does not need it running.)
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry', serviceWorkers: 'block' },
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumPath ? { executablePath: chromiumPath } : {}),
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
