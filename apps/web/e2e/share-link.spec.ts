import { expect, test } from './fixtures';

test('a share link opens its document even when the autosave restore is slow', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  await page.getByLabel('Document name').fill('Saved Before');
  await page.getByLabel('Document name').press('Enter');
  // The autosave has landed once the document is in the recent list.
  await page.waitForFunction(() => window.__citygen.recent().some((r) => r.name === 'Saved Before'));
  // From the next load on, every IndexedDB open answers 3 s late, as on a slow browser: the restore
  // of 'Saved Before' then finishes after the shared document has been fetched.
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
      const req = open(...args);
      let onsuccess: ((e: Event) => void) | null = null;
      Object.defineProperty(req, 'onsuccess', { set: (f) => (onsuccess = f), get: () => onsuccess });
      req.addEventListener('success', (e) => setTimeout(() => onsuccess?.call(req, e), 3000));
      return req;
    }) as typeof indexedDB.open;
  });
  await page.goto('/?doc=' + encodeURIComponent('/gallery/castle-town-1650.citygen.json'));
  // The parameter goes once the shared document has been opened.
  await page.waitForFunction(() => !window.location.search.includes('doc='), null, { timeout: 60_000 });
  await expect(page.getByLabel('Document name')).toHaveValue('Castle Town');
});
