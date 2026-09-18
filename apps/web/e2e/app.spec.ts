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
  await page.getByLabel('Document name').fill('Renamed');
  await expect(page.getByLabel('Document name')).toHaveValue('Renamed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Document name')).not.toHaveValue('Renamed');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByLabel('Document name')).toHaveValue('Renamed');
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

test('settlements are generated automatically and can be added explicitly', async ({ page }) => {
  await ready(page);
  const auto = (await page.evaluate(() => window.__citygen.stats())) as {
    settlements: { id: string; blocks: number }[];
    blocks: number;
    roads: { roadKm: number };
  };
  expect(auto.settlements.length).toBeGreaterThanOrEqual(1);
  expect(auto.blocks).toBeGreaterThan(10);
  const before = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByRole('button', { name: '+ Add settlement' }).click();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    before,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('settlement-row')).toHaveCount(1);
  const explicit = (await page.evaluate(() => window.__citygen.stats())) as {
    settlements: { id: string; kind: string; walled: boolean }[];
  };
  expect(explicit.settlements).toHaveLength(1);
  expect(explicit.settlements[0]!.kind).toBe('city');
  await page.getByLabel('Kind of settlement-1').selectOption('village');
  await page.waitForFunction(() => window.__citygen.status() === 'idle');
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as {
    spec: { settlements: { kind: string; population: number }[] };
  };
  expect(doc.spec.settlements[0]!.kind).toBe('village');
});

test('buildings appear when zooming into a town', async ({ page }) => {
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  // The initial fit-to-region runs on the map's load event; wait for it so the jump is not undone.
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
  const stats = (await page.evaluate(() => window.__citygen.stats())) as {
    settlements: { center: [number, number] }[];
  };
  const [x, y] = stats.settlements[0]!.center;
  await page.evaluate(
    ([cx, cy]) => window.__citygenMap!.jumpTo({ center: [cx / 111319.490793, cy / 111319.490793], zoom: 15 }),
    [x, y],
  );
  // Lazy block tiles are requested after the jump; poll until buildings are on screen.
  await page.waitForFunction(
    () => {
      const map = window.__citygenMap!;
      return map.areTilesLoaded() && map.queryRenderedFeatures({ layers: ['buildings'] }).length > 20;
    },
    undefined,
    { timeout: 60_000 },
  );
  const counts = await page.evaluate(() => {
    const map = window.__citygenMap!;
    return {
      buildings: map.queryRenderedFeatures({ layers: ['buildings'] }).length,
      streets: map.queryRenderedFeatures({ layers: ['streets'] }).length,
      patches: map.queryRenderedFeatures({ layers: ['patches'] }).length,
    };
  });
  expect(counts.buildings).toBeGreaterThan(20);
  expect(counts.streets).toBeGreaterThan(5);
  expect(counts.patches).toBeGreaterThan(3);
});

test('the year changes the era, growth rings and walls', async ({ page }) => {
  await ready(page);
  type Stats = { era: { name: string }; settlements: { rings: number; walled: boolean }[] };
  const before = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1650 }));
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    before,
    { timeout: 90_000 },
  );
  const medieval = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(medieval.era.name).toBe('Early modern');
  expect(medieval.settlements.every((s) => s.rings === 0)).toBe(true);
  const v2 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1985 }));
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v2,
    { timeout: 90_000 },
  );
  const modern = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(modern.era.name).toBe('Late modern');
  expect(modern.settlements.some((s) => s.rings > 0)).toBe(true);
  await expect(page.getByTestId('terrain-stats')).toContainText('Late modern');
});

test('society overlays toggle with a legend and the inspector explains a zone', async ({ page }) => {
  await ready(page);
  await page.getByLabel('wealth overlay').check();
  await expect(page.getByTestId('legend-wealth')).toContainText('affluent');
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as {
    ui?: { layers: Record<string, boolean> };
  };
  expect(doc.ui?.layers.wealth).toBe(true);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as {
    settlements: { center: [number, number]; radiusM: number }[];
  };
  const [x, y] = stats.settlements[0]!.center;
  const info = (await page.evaluate(([px, py]) => window.__citygen.inspect(px, py), [x, y])) as {
    settlement?: { id: string };
    patch?: { ward: string; why: string };
    wealthClass: string;
    elevationM: number;
  };
  expect(info.settlement).toBeDefined();
  expect(info.patch).toBeDefined();
  expect(info.patch!.why.length).toBeGreaterThan(3);
  expect(['slum', 'poor', 'modest', 'comfortable', 'affluent', 'elite']).toContain(info.wealthClass);
});

test('railways, stations and trams render and respond to the network settings', async ({ page }) => {
  await ready(page);
  type Stats = { rail: { trackKm: number; stations: number; tramLines: number; maxGradient: number } };
  const stats = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(stats.rail.trackKm).toBeGreaterThan(5);
  expect(stats.rail.stations).toBeGreaterThan(0);
  expect(stats.rail.maxGradient).toBeLessThanOrEqual(0.0351);
  await expect(page.getByTestId('rail-stats')).toContainText('km of track');
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  if (!webglMissing) {
    await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const map = window.__citygenMap!;
        return map.areTilesLoaded() && map.queryRenderedFeatures({ layers: ['rail-track'] }).length > 0;
      },
      undefined,
      { timeout: 60_000 },
    );
    const counts = await page.evaluate(() => {
      const map = window.__citygenMap!;
      return {
        rail: map.queryRenderedFeatures({ layers: ['rail-track'] }).length,
        stations: map.queryRenderedFeatures({ layers: ['stations'] }).length,
      };
    });
    expect(counts.rail).toBeGreaterThan(0);
    expect(counts.stations).toBeGreaterThan(0);
  }
  // Before the railway age there is no rail; switching the network off removes it too.
  const v1 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1780 }));
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v1,
    { timeout: 90_000 },
  );
  expect(((await page.evaluate(() => window.__citygen.stats())) as Stats).rail.trackKm).toBe(0);
  const v2 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1925 }));
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v2,
    { timeout: 90_000 },
  );
  const v3 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByLabel('Railways', { exact: true }).uncheck();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v3,
    { timeout: 90_000 },
  );
  expect(((await page.evaluate(() => window.__citygen.stats())) as Stats).rail.trackKm).toBe(0);
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as {
    spec: { networks: { rail: { enabled: boolean } } };
  };
  expect(doc.spec.networks.rail.enabled).toBe(false);
});

test('facilities are placed, rendered, inspectable, removable and pinnable', async ({ page }) => {
  await ready(page);
  type Stats = {
    facilities: {
      placed: number;
      list: {
        id: string;
        type: string;
        name: string;
        settlement: string | null;
        center: [number, number];
        pinned: boolean;
      }[];
      failures: { reason: string }[];
      wasteland: { overall: number };
    };
  };
  const stats = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(stats.facilities.placed).toBeGreaterThan(2);
  const port = stats.facilities.list.find((f) => f.type === 'port');
  expect(port).toBeDefined();
  expect(stats.facilities.wasteland.overall).toBeLessThan(0.5);
  await expect(page.getByTestId('facility-stats')).toContainText('placed');
  const info = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), port!.center)) as {
    facility?: { id: string; name: string; realLengthM: number; lengthM: number };
  };
  expect(info.facility?.id).toBe(port!.id);
  expect(info.facility!.realLengthM).toBeGreaterThan(info.facility!.lengthM);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  if (!webglMissing) {
    await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(
      ([cx, cy]) =>
        window.__citygenMap!.jumpTo({ center: [cx / 111319.490793, cy / 111319.490793], zoom: 15 }),
      port!.center,
    );
    await page.waitForFunction(
      () => {
        const map = window.__citygenMap!;
        return (
          map.areTilesLoaded() && map.queryRenderedFeatures({ layers: ['facility-buildings'] }).length > 0
        );
      },
      undefined,
      { timeout: 60_000 },
    );
    const parts = await page.evaluate(
      () =>
        window.__citygenMap!.queryRenderedFeatures({ layers: ['facility-surfaces', 'facility-points'] })
          .length,
    );
    expect(parts).toBeGreaterThan(0);
  }
  // Remove the port through the dock; it disappears and the override is recorded.
  const v1 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByRole('button', { name: `Remove ${port!.name} at ${port!.settlement}` }).click();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v1,
    { timeout: 90_000 },
  );
  const after = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(after.facilities.list.some((f) => f.id === port!.id)).toBe(false);
  // Restore, then pin another facility where it stands and regenerate: it stays put.
  const v2 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByRole('button', { name: 'Restore removed and unpin' }).click();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v2,
    { timeout: 90_000 },
  );
  const restored = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  const target = restored.facilities.list.find((f) => f.type === 'institution.cemetery')!;
  expect(target).toBeDefined();
  const v3 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(
    (t) =>
      window.__citygen.dispatch({
        type: 'override.add',
        override: { op: 'pin', target: t.id, x: t.center[0], y: t.center[1], rotation: 0 },
      }),
    target,
  );
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v3,
    { timeout: 90_000 },
  );
  const v4 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByTestId('regenerate-region').click();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    v4,
    { timeout: 90_000 },
  );
  const pinned = ((await page.evaluate(() => window.__citygen.stats())) as Stats).facilities.list.find(
    (f) => f.id === target.id,
  );
  expect(pinned?.pinned).toBe(true);
  expect(Math.abs(pinned!.center[0] - target.center[0])).toBeLessThan(2);
});
