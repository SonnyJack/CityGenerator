import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_GOLDEN_HASH } from '@citygen/core';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  // Start every test from a known document; the autosave from a previous test must not leak in.
  await page.evaluate(() => window.__citygen.newDocument('e2e'));
  await page.waitForFunction(
    () => window.__citygen.tileVersion() > 0 && window.__citygen.status() === 'idle',
  );
}

test('loads the editor and runs the engine worker', async ({ page }) => {
  await ready(page);
  await expect(page.getByText('CityGenerator')).toBeVisible();
  await expect(page.getByTestId('status')).toContainText('Ready');
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as { spec: { seed: string } };
  expect(doc.spec.seed).toBe('e2e');
});

test('generation is deterministic across engines (golden hash)', async ({ page }) => {
  await ready(page);
  const hash = await page.evaluate(() => window.__citygen.fixtureHash());
  expect(hash).toBe(FIXTURE_GOLDEN_HASH);
});

test('documents round-trip through export and import', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Document name').fill('Round trip');
  await page.evaluate(() =>
    window.__citygen.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id: 'e2e-street',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-500, -500],
              [500, 500],
            ],
          },
          properties: { layer: 'street', origin: 'authored', kind: 'local' },
        },
      ],
    }),
  );
  const exported = await page.evaluate(() => window.__citygen.exportJson());
  const before = JSON.parse(exported);
  expect(before.meta.name).toBe('Round trip');
  expect(before.authored.features).toHaveLength(1);

  await page.evaluate(() => window.__citygen.newDocument('other'));
  await page.evaluate((text) => window.__citygen.importJson(text), exported);
  const after = await page.evaluate(() => window.__citygen.exportJson());
  expect(after).toBe(exported);
  await expect(page.getByLabel('Document name')).toHaveValue('Round trip');
});

test('undo and redo work through the toolbar', async ({ page }) => {
  await ready(page);
  const year = page.getByLabel('Year');
  await year.fill('1890');
  await expect(year).toHaveValue('1890');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(year).toHaveValue('1925');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(year).toHaveValue('1890');
});

test('autosave restores the document after reload', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Document name').fill('Persisted');
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  await expect(page.getByLabel('Document name')).toHaveValue('Persisted');
});

test('the tile pipeline renders the region on the map', async ({ page }) => {
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 30_000 });
  const counts = await page.evaluate(() => {
    const map = window.__citygenMap!;
    return {
      outline: map.queryRenderedFeatures({ layers: ['region-outline'] }).length,
      contours: map.queryRenderedFeatures({ layers: ['contours-major'] }).length,
    };
  });
  expect(counts.outline).toBeGreaterThan(0);
  expect(counts.contours).toBeGreaterThan(0);
});

test('terrain generates, reacts to parameters, and reports stats', async ({ page }) => {
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as {
    terrain: { cells: number; landFraction: number; riverKm: number };
    totalMs: number;
  };
  expect(stats.terrain.cells).toBeGreaterThan(100_000);
  expect(stats.terrain.landFraction).toBeGreaterThan(0.2);
  const before = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByLabel('Terrain preset').selectOption('archipelago');
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    before,
  );
  const after = (await page.evaluate(() => window.__citygen.stats())) as {
    terrain: { landFraction: number };
  };
  expect(after.terrain.landFraction).toBeLessThan(stats.terrain.landFraction);
  await expect(page.getByTestId('terrain-stats')).toContainText('Rivers');
});

test('themes switch and the variations strip renders six previews', async ({ page }) => {
  await ready(page);
  await page.waitForFunction(() => window.__citygen.thumbnails() === 6, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('variations').locator('canvas')).toHaveCount(6);
  await page.getByLabel('Theme').selectOption('ink');
  await expect(page.getByLabel('Theme')).toHaveValue('ink');
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as { ui?: { theme: string } };
  expect(doc.ui?.theme).toBe('ink');
  // Picking a variation changes the seed.
  await page.getByTestId('variations').locator('button').first().click();
  const doc2 = (await page.evaluate(() => window.__citygen.getDocument())) as { spec: { seed: string } };
  expect(doc2.spec.seed).toBe('e2e-1');
});

test('the map renders terrain layers with hillshade from DEM tiles', async ({ page }) => {
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => window.__citygenMap?.areTilesLoaded() === true, undefined, {
    timeout: 60_000,
  });
  const counts = await page.evaluate(() => {
    const map = window.__citygenMap!;
    return {
      water: map.queryRenderedFeatures({ layers: ['water-fill'] }).length,
      landcover: map.queryRenderedFeatures({
        layers: ['landcover-forest', 'landcover-open', 'landcover-farmland'],
      }).length,
      dem: map.getSource('citygen-dem') !== undefined,
      hillshade: map.getLayer('hillshade') !== undefined,
    };
  });
  expect(counts.water).toBeGreaterThan(0);
  expect(counts.landcover).toBeGreaterThan(0);
  expect(counts.dem).toBe(true);
  expect(counts.hillshade).toBe(true);
});
