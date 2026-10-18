import { expect, test as base } from '@playwright/test';

/**
 * Every test watches for its page crashing: a browser that kills the page's web process (under
 * memory pressure, say) otherwise surfaces only as "Target page, context or browser has been
 * closed" on whatever the test was doing at the time.
 */
export const test = base.extend<{ crashWatch: void }>({
  crashWatch: [
    async ({ page }, use) => {
      let crashed = false;
      page.on('crash', () => (crashed = true));
      await use();
      if (crashed) throw new Error('The page crashed: the browser killed its web process');
    },
    { auto: true },
  ],
});

export { expect };
