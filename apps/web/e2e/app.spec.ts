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
  // Four full regenerations (place, remove, pin, reseed) on a machine shared with the workers.
  test.setTimeout(180_000);
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

// ---------------------------------------------------------------------------
// Phase 7: naming, POIs, directory, themes and export.

type NamedStats = {
  regionName: string;
  culture: string;
  settlements: { id: string; name?: string; center: [number, number]; radiusM: number }[];
};

async function waitForRegen(page: Page, from: number) {
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    from,
    { timeout: 120_000 },
  );
}

test('the region, settlements, streets and rivers are named and labels render with the vendored glyphs', async ({
  page,
}) => {
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  expect(stats.regionName.length).toBeGreaterThan(2);
  expect(stats.culture).toBe('newEngland');
  expect(stats.settlements.length).toBeGreaterThan(0);
  for (const s of stats.settlements) expect((s.name ?? '').length).toBeGreaterThan(2);
  await expect(page.getByTestId('region-name')).toContainText(stats.regionName);

  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  const glyphRequests: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/fonts/')) glyphRequests.push(r.status());
  });
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
  const [x, y] = stats.settlements[0]!.center;
  const namesAt = async (zoom: number, layer: string) => {
    await page.evaluate(
      ([cx, cy, z]) =>
        window.__citygenMap!.jumpTo({ center: [cx! / 111319.490793, cy! / 111319.490793], zoom: z }),
      [x, y, zoom],
    );
    await page.waitForFunction(
      (l) => {
        const map = window.__citygenMap!;
        return map.areTilesLoaded() && map.queryRenderedFeatures({ layers: [l] }).length > 0;
      },
      layer,
      { timeout: 60_000 },
    );
    return page.evaluate(
      (l) =>
        window
          .__citygenMap!.queryRenderedFeatures({ layers: [l] })
          .map((f) => String(f.properties?.name ?? '')),
      layer,
    );
  };
  const settlements = await namesAt(11.5, 'label-settlements');
  expect(settlements.some((n) => n.length > 2)).toBe(true);
  const streets = await namesAt(15.5, 'label-streets');
  expect(streets.some((n) => n.length > 2)).toBe(true);
  // Rendered symbols mean the glyph PBFs were fetched from the app's own /fonts path.
  expect(glyphRequests.length).toBeGreaterThan(0);
  expect(glyphRequests.every((s) => s === 200)).toBe(true);
});

test('the directory lists named premises with addresses and searches them', async ({ page }) => {
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const first = stats.settlements[0]!;
  type Dir = { total: number; entries: { name: string; use: string; address?: string; kind: string }[] };
  const all = (await page.evaluate((id) => window.__citygen.directory(id, '', 200), first.id)) as Dir;
  expect(all.total).toBeGreaterThan(20);
  const named = all.entries.filter((e) => e.name && e.use !== 'residential');
  expect(named.length).toBeGreaterThan(3);
  expect(all.entries.filter((e) => e.address).length).toBeGreaterThan(all.entries.length / 2);
  // Searching for a word from a named entry returns that entry.
  const word = named[0]!.name.split(/\s+/).find((w) => w.length > 3)!;
  const found = (await page.evaluate(
    ([id, q]) => window.__citygen.directory(id, q!, 50),
    [first.id, word],
  )) as Dir;
  expect(found.entries.some((e) => e.name.toLowerCase().includes(word.toLowerCase()))).toBe(true);
  // The panel shows the same data.
  await page.getByRole('button', { name: 'Directory', exact: true }).click();
  await expect(page.getByTestId('directory')).toBeVisible();
  await page.getByLabel('Directory search').fill(word);
  await expect(page.getByTestId('directory-list')).toContainText(word, { ignoreCase: true });
  // The inspector reports building details at a listed premises.
  const entry = all.entries.find((e) => e.name) as { center: [number, number]; name: string } | undefined;
  if (entry) {
    const info = (await page.evaluate(([bx, by]) => window.__citygen.inspect(bx, by), entry.center)) as {
      building?: { name: string; material: string; kindLabel: string };
    };
    expect(info.building?.name).toBe(entry.name);
    expect(info.building?.material.length).toBeGreaterThan(0);
  }
});

test('switching the culture pack renames the region and its settlements', async ({ page }) => {
  await ready(page);
  const before = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const v = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(() =>
    window.__citygen.dispatch({
      type: 'spec.patch',
      ops: [{ op: 'replace', path: '/culture', value: 'japan' }],
    }),
  );
  await waitForRegen(page, v);
  const after = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  expect(after.culture).toBe('japan');
  expect(after.regionName).not.toBe(before.regionName);
  expect(after.settlements.map((s) => s.name)).not.toEqual(before.settlements.map((s) => s.name));
  await expect(page.getByTestId('region-name')).toContainText('Japan');
});

test('SVG and GeoJSON export a frame, and the player version hides GM notes', async ({ page }) => {
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const [cx, cy] = stats.settlements[0]!.center;
  const frame = { minX: cx - 300, minY: cy - 300, maxX: cx + 300, maxY: cy + 300 };
  await page.evaluate(
    ({ x, y }) =>
      window.__citygen.dispatch({
        type: 'annotation.add',
        annotation: {
          id: 'e2e-secret',
          kind: 'note',
          geometry: { type: 'Point', coordinates: [x, y] },
          text: 'CULTIST HIDEOUT',
          gmOnly: true,
        },
      }),
    { x: cx + 50, y: cy + 50 },
  );
  const req = { frame, pxPerM: 1, player: false, gridM: 1.5, pixelsPerGrid: 100, name: 'e2e' };
  const gm = await page.evaluate((r) => window.__citygen.exportSvg(r), req);
  expect(gm.startsWith('<svg')).toBe(true);
  expect(gm).toContain('class="buildings"');
  expect(gm).toContain('class="streets"');
  expect(gm).toContain('class="labels"');
  expect(gm).toContain('CULTIST HIDEOUT');
  const player = await page.evaluate((r) => window.__citygen.exportSvg({ ...r, player: true }), req);
  expect(player).not.toContain('CULTIST HIDEOUT');
  expect(player).toContain('class="buildings"');

  const geo = JSON.parse(await page.evaluate((r) => window.__citygen.exportGeoJson(r), req)) as {
    type: string;
    features: { properties: { layer: string; text?: string } }[];
  };
  expect(geo.type).toBe('FeatureCollection');
  const layers = new Set(geo.features.map((f) => f.properties.layer));
  expect(layers.has('buildings')).toBe(true);
  expect(layers.has('streets')).toBe(true);
  expect(geo.features.some((f) => f.properties.text === 'CULTIST HIDEOUT')).toBe(true);
  const geoPlayer = JSON.parse(
    await page.evaluate((r) => window.__citygen.exportGeoJson({ ...r, player: true }), req),
  ) as { features: { properties: { text?: string } }[] };
  expect(geoPlayer.features.some((f) => f.properties.text === 'CULTIST HIDEOUT')).toBe(false);
});

test('PNG and Universal VTT export a downtown frame with capped walls', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const [cx, cy] = stats.settlements[0]!.center;
  const frame = { minX: cx - 250, minY: cy - 250, maxX: cx + 250, maxY: cy + 250 };
  const req = { frame, pxPerM: 0.5, player: true, gridM: 1.5, pixelsPerGrid: 30, name: 'e2e' };

  const png = await page.evaluate((r) => window.__citygen.exportPng(r), req);
  expect(png.width).toBe(250);
  expect(png.height).toBe(250);
  expect(png.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  // Decode the image in the page and make sure it is not blank.
  const distinct = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 7) colours.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return colours.size;
  }, png.dataUrl);
  expect(distinct).toBeGreaterThan(8);

  const walls = (await page.evaluate((r) => window.__citygen.exportWalls(r), req)) as {
    segments: number[][];
    rawCount: number;
    mode: string;
  };
  expect(walls.segments.length).toBeGreaterThan(20);
  expect(walls.segments.length).toBeLessThanOrEqual(4000);

  const uvtt = await page.evaluate((r) => window.__citygen.exportUvtt(r), req);
  const scene = JSON.parse(uvtt.json) as {
    format: number;
    resolution: { map_size: { x: number; y: number }; pixels_per_grid: number };
    line_of_sight: { x: number; y: number }[][];
    image: string;
  };
  expect(scene.format).toBe(0.3);
  expect(scene.resolution.pixels_per_grid).toBe(30);
  expect(scene.line_of_sight.length).toBe(walls.segments.length);
  expect(scene.line_of_sight.length).toBeLessThanOrEqual(4000);
  expect(scene.image.length).toBeGreaterThan(1000);
});

test('the export panel opens, previews the frame size and produces a report', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByTestId('export-panel')).toBeVisible();
  await expect(page.getByTestId('export-panel')).toContainText('px');
});

// ---------------------------------------------------------------------------
// Phase 8: the assistant.

test('the assistant runs scripted tool calls through the command bus with inline undo and cost', async ({
  page,
}) => {
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats & {
    facilities: { list: { id: string; type: string; name: string }[] };
  };
  const port = stats.facilities.list.find((f) => f.type === 'port')!;
  expect(port).toBeDefined();
  await page.evaluate(
    (portId) =>
      window.__citygen.assistant.useScripted([
        {
          content: [
            { type: 'text', text: 'Setting the year and renaming the port.' },
            { type: 'tool_use', id: 'tu1', name: 'set_year', input: { year: 1890 } },
            {
              type: 'tool_use',
              id: 'tu2',
              name: 'name_features',
              input: { items: [{ id: portId, name: 'Innsmouth Wharf' }] },
            },
            {
              type: 'tool_use',
              id: 'tu3',
              name: 'annotate',
              input: { kind: 'note', x: 0, y: 0, text: 'Deep One tunnels', gmOnly: true },
            },
          ],
          usage: { inputTokens: 5000, outputTokens: 200 },
        },
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu4',
              name: 'find_features',
              input: { kind: 'facility', name: 'Innsmouth' },
            },
          ],
          usage: { inputTokens: 6000, outputTokens: 50, cacheReadTokens: 4000 },
        },
        { content: [{ type: 'text', text: 'Done: 1890, the port is now Innsmouth Wharf.' }] },
      ]),
    port.id,
  );
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.getByTestId('assistant')).toBeVisible();
  await page.getByLabel('Ask the assistant').fill('Set the year to 1890 and rename the port Innsmouth Wharf');
  await page.getByLabel('Ask the assistant').press('Enter');
  await expect(page.getByTestId('assistant-reply').last()).toContainText('Innsmouth Wharf', {
    timeout: 120_000,
  });
  await page.waitForFunction(() => window.__citygen.status() === 'idle', undefined, { timeout: 120_000 });

  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as {
    spec: { year: number };
    annotations: { text: string; gmOnly: boolean }[];
    overrides: { op: string; key?: string; value?: unknown }[];
  };
  expect(doc.spec.year).toBe(1890);
  expect(doc.annotations[0]).toMatchObject({ text: 'Deep One tunnels', gmOnly: true });
  expect(doc.overrides.some((o) => o.op === 'setProperty' && o.value === 'Innsmouth Wharf')).toBe(true);
  // The engine applied the rename and the scripted find returned it to the model.
  const after = (await page.evaluate(() => window.__citygen.stats())) as typeof stats;
  expect(after.facilities.list.find((f) => f.id === port.id)?.name).toBe('Innsmouth Wharf');
  const transcript = (await page.evaluate(() => window.__citygen.assistant.transcript())) as {
    kind: string;
    outcome?: { name: string; isError: boolean; content: { text?: string }[] };
  }[];
  const find = transcript.find((t) => t.kind === 'tool' && t.outcome?.name === 'find_features')!;
  expect(find.outcome!.isError).toBe(false);
  expect(find.outcome!.content[0]!.text).toContain('Innsmouth Wharf');
  await expect(page.getByTestId('assistant-tool')).toHaveCount(4);
  // Cost and usage are shown.
  await expect(page.getByTestId('assistant-cost')).toContainText('15000 in');
  await expect(page.getByTestId('assistant-cost')).toContainText('$0.0');
  // Inline undo on the first tool card reverts the year (and everything after it).
  await page.getByRole('button', { name: 'Undo set_year' }).click();
  await page.waitForFunction(() => window.__citygen.status() === 'idle', undefined, { timeout: 120_000 });
  const reverted = (await page.evaluate(() => window.__citygen.getDocument())) as {
    spec: { year: number };
    annotations: unknown[];
  };
  expect(reverted.spec.year).not.toBe(1890);
  expect(reverted.annotations).toHaveLength(0);
});

test('the assistant reports bad keys, network failures and refusals without crashing', async ({ page }) => {
  await ready(page);
  await page.evaluate(() =>
    window.__citygen.assistant.useScripted([
      { error: 'auth' },
      { error: 'network' },
      { content: [{ type: 'text', text: 'No.' }], stopReason: 'refusal' },
    ]),
  );
  await page.evaluate(() => window.__citygen.assistant.open(true));
  await page.getByLabel('Ask the assistant').fill('hello');
  await page.getByLabel('Ask the assistant').press('Enter');
  await expect(page.getByTestId('assistant-error')).toContainText('API key', { timeout: 60_000 });
  await page.getByLabel('Ask the assistant').fill('hello again');
  await page.getByLabel('Ask the assistant').press('Enter');
  await expect(page.getByTestId('assistant-error').nth(1)).toContainText('network', { timeout: 60_000 });
  await page.getByLabel('Ask the assistant').fill('do something declined');
  await page.getByLabel('Ask the assistant').press('Enter');
  await expect(page.getByTestId('assistant')).toContainText('declined', { timeout: 60_000 });
  await expect(page.getByLabel('Ask the assistant')).toBeEnabled();
  const doc = (await page.evaluate(() => window.__citygen.getDocument())) as { overrides: unknown[] };
  expect(doc.overrides).toHaveLength(0);
});

test('the assistant reads the engine: settlement summaries, area descriptions and snapshots', async ({
  page,
}) => {
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const city = stats.settlements[0]!;
  await page.evaluate(
    ({ id, cx, cy, webgl }) =>
      window.__citygen.assistant.useScripted([
        {
          content: [
            { type: 'tool_use', id: 'r1', name: 'get_settlement_summary', input: { id } },
            { type: 'tool_use', id: 'r2', name: 'describe_area', input: { x: cx, y: cy, radiusM: 300 } },
            ...(webgl
              ? [
                  {
                    type: 'tool_use',
                    id: 'r3',
                    name: 'render_snapshot',
                    input: { bbox: [cx - 300, cy - 300, cx + 300, cy + 300] },
                  },
                ]
              : []),
          ],
        },
        { content: [{ type: 'text', text: 'Read it.' }] },
      ]),
    { id: city.id, cx: city.center[0], cy: city.center[1], webgl: !webglMissing },
  );
  await page.evaluate(() => window.__citygen.assistant.send('Tell me about the city'));
  const transcript = (await page.evaluate(() => window.__citygen.assistant.transcript())) as {
    kind: string;
    outcome?: { name: string; isError: boolean; content: { type: string; text?: string }[] };
  }[];
  const tools = transcript.filter((t) => t.kind === 'tool').map((t) => t.outcome!);
  expect(tools.every((t) => !t.isError)).toBe(true);
  const summary = JSON.parse(tools[0]!.content[0]!.text!) as {
    name: string;
    districtList: unknown[];
    businesses: unknown[];
    premises: number;
  };
  expect(summary.name).toBe(city.name);
  expect(summary.districtList.length).toBeGreaterThan(0);
  expect(summary.premises).toBeGreaterThan(100);
  const area = JSON.parse(tools[1]!.content[0]!.text!) as {
    settlement: { id: string } | null;
    nearby: unknown[];
  };
  expect(area.settlement?.id).toBe(city.id);
  expect(area.nearby.length).toBeGreaterThan(0);
  if (!webglMissing) {
    expect(tools[2]!.content.some((c) => c.type === 'image')).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Phase 9: timeline, 3D and condition.

type Built = {
  layer: string;
  built?: number;
  demolished?: number;
  state?: string;
  __id?: string;
  block?: string;
};

test('scrubbing the year keeps what already stands and adds new growth around it', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats & { anchorYear: number };
  expect(stats.anchorYear).toBe(1925);
  const [cx, cy] = stats.settlements[0]!.center;
  const frame = { minX: cx - 350, minY: cy - 350, maxX: cx + 350, maxY: cy + 350 };
  const req = { frame, pxPerM: 1, player: false, gridM: 1.5, pixelsPerGrid: 100, name: 'scrub' };
  const buildingsAt = async (year: number) => {
    const v = await page.evaluate(() => window.__citygen.tileVersion());
    await page.evaluate((y) => window.__citygen.dispatch({ type: 'year.set', year: y }), year);
    await waitForRegen(page, v);
    const geo = JSON.parse(await page.evaluate((r) => window.__citygen.exportGeoJson(r), req)) as {
      features: { id?: string; geometry: unknown; properties: Built }[];
    };
    return new Map(
      geo.features
        .filter((f) => f.properties.layer === 'buildings')
        .map((f) => [
          String(f.id ?? f.properties.__id),
          { geometry: JSON.stringify(f.geometry), props: f.properties },
        ]),
    );
  };
  const at1890 = await buildingsAt(1890);
  const at1955 = await buildingsAt(1955);
  const patchesAt1955 = (
    JSON.parse(await page.evaluate((r) => window.__citygen.exportGeoJson(r), req)) as {
      features: { id?: string; properties: { layer: string; ward?: string; __id?: string } }[];
    }
  ).features
    .filter((f) => f.properties.layer === 'patches')
    .map((f) => ({ id: f.id ?? f.properties.__id, ward: f.properties.ward }));
  expect(at1890.size).toBeGreaterThan(50);
  expect(at1955.size).toBeGreaterThan(at1890.size * 0.9);
  // Every building standing in 1890 that has not been replaced by 1955 is still there, unchanged.
  let survivors = 0;
  // Blocks taken by a facility or rail yard between the two years lose their buildings (the land is
  // reserved), which is a change of that place, not a re-roll of the rest.
  const reserved = new Set(['port', 'industrial', 'institution', 'campus', 'cemetery', 'airfield', 'yard']);
  const reservedBlocks = new Set(
    patchesAt1955
      .filter((p) => reserved.has(String(p.ward)))
      .map((p) => String(p.id).replace('-patch-', '-b').replace('-ring-', '-r')),
  );
  for (const [id, b] of at1890) {
    expect(b.props.built).toBeLessThanOrEqual(1890);
    if ((b.props.demolished ?? Infinity) <= 1955) continue;
    if (reservedBlocks.has(String(b.props.block))) continue;
    const later = at1955.get(id);
    expect(later, `building ${id} vanished between 1890 and 1955`).toBeDefined();
    expect(later!.geometry).toBe(b.geometry);
    expect(later!.props.built).toBe(b.props.built);
    survivors++;
  }
  // The old town rebuilds heavily after its 1890 and 1955 re-zonings (most of a port's core counts as
  // central on its growth footprint and turns commercial), so only a share survives unchanged.
  expect(survivors).toBeGreaterThan(Math.max(60, at1890.size * 0.08));
  // Something was built in between, and everything shown was built by then.
  expect([...at1955.values()].some((b) => (b.props.built ?? 0) > 1890)).toBe(true);
  for (const b of at1955.values()) expect(b.props.built).toBeLessThanOrEqual(1955);
  await expect(page.getByTestId('timeline')).toContainText('as of 1925');
});

test('a flooded harbour district renders in every theme, buildings extrude in 3D and export as glTF', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ready(page);
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats & {
    facilities: { list: { type: string; center: [number, number] }[] };
  };
  const port = stats.facilities.list.find((f) => f.type === 'port') ?? {
    center: stats.settlements[0]!.center,
  };
  const [px, py] = port.center;
  // A flood in the current year around the harbour, lasting ten years.
  const v = await page.evaluate(() => window.__citygen.tileVersion());
  await page.evaluate(
    ([x, y]) =>
      window.__citygen.dispatch({
        type: 'spec.patch',
        ops: [
          {
            op: 'add',
            path: '/events/-',
            value: {
              id: 'e2e-flood',
              kind: 'flood',
              year: 1925,
              center: [x, y],
              radiusM: 600,
              magnitude: 0.8,
              levelM: 4,
              durationYears: 10,
            },
          },
        ],
      }),
    [px, py],
  );
  await waitForRegen(page, v);
  await expect(page.getByTestId('events-list')).toContainText('Flood of 1925');
  await page.evaluate(
    ([x, y]) => window.__citygenMap!.jumpTo({ center: [x! / 111319.490793, y! / 111319.490793], zoom: 14.5 }),
    [px, py],
  );
  for (const theme of ['atlas', 'ink', 'period1920s', 'sanborn', 'blueprint', 'dark', 'print']) {
    await page.getByLabel('Theme').selectOption(theme);
    await page.waitForFunction(
      () => {
        const map = window.__citygenMap!;
        return (
          map.isStyleLoaded() &&
          map.areTilesLoaded() &&
          map.queryRenderedFeatures({ layers: ['events-flood'] }).length > 0
        );
      },
      undefined,
      { timeout: 60_000 },
    );
  }
  // Buildings inside the flood are damaged.
  const damaged = JSON.parse(
    await page.evaluate(
      ([x, y]) =>
        window.__citygen.exportGeoJson({
          frame: { minX: x! - 300, minY: y! - 300, maxX: x! + 300, maxY: y! + 300 },
          pxPerM: 1,
          player: false,
          gridM: 1.5,
          pixelsPerGrid: 100,
          name: 'flood',
        }),
      [px, py],
    ),
  ) as { features: { properties: Built & { condition?: number } }[] };
  const inside = damaged.features.filter((f) => f.properties.layer === 'buildings');
  expect(inside.length).toBeGreaterThan(0);
  expect(inside.filter((f) => (f.properties.condition ?? 1) < 0.6).length).toBeGreaterThan(0);
  // 3D buildings.
  await page.getByLabel('Theme').selectOption('atlas');
  await page.getByLabel('3D buildings').check();
  await page.waitForFunction(
    () => {
      const map = window.__citygenMap!;
      return (
        map.isStyleLoaded() &&
        map.areTilesLoaded() &&
        map.queryRenderedFeatures({ layers: ['buildings-3d'] }).length > 20
      );
    },
    undefined,
    { timeout: 60_000 },
  );
  // glTF export of the harbour frame.
  const glb = await page.evaluate(
    ([x, y]) =>
      window.__citygen.exportGlb({
        frame: { minX: x! - 250, minY: y! - 250, maxX: x! + 250, maxY: y! + 250 },
        pxPerM: 1,
        player: false,
        gridM: 1.5,
        pixelsPerGrid: 100,
        name: 'harbour',
      }),
    [px, py],
  );
  expect(glb.bytes).toBeGreaterThan(10_000);
  expect(glb.meshes.map((m) => m.name)).toEqual(expect.arrayContaining(['terrain', 'building']));
  expect(glb.meshes.find((m) => m.name === 'terrain')!.triangles).toBeGreaterThan(100);
});

test('the timeline plays forward and the condition brush is available', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await page.getByLabel('Play from').fill('1900');
  await page.getByLabel('Play to').fill('1910');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(
    () =>
      (window.__citygen.getDocument() as { spec: { year: number } }).spec.year === 1910 &&
      window.__citygen.status() === 'idle',
    undefined,
    { timeout: 150_000 },
  );
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Brush' }).click();
  await expect(page.getByRole('option', { name: 'Condition ± (repair / decay)' })).toBeAttached();
});

// ---------------------------------------------------------------------------
// Phase 10: import, plugins, offline install.

test('imports OpenStreetMap data, a heightmap and a culture pack, and opens a document from a URL', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await ready(page);
  // OSM: two streets and a railway around the origin.
  const osm = `<osm><node id="1" lat="42" lon="-71"/><node id="2" lat="42.003" lon="-71"/><node id="3" lat="42.003" lon="-70.997"/>
    <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Federal Street"/></way>
    <way id="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
    <way id="3"><nd ref="1"/><nd ref="3"/><tag k="railway" v="rail"/></way></osm>`;
  const v0 = await page.evaluate(() => window.__citygen.tileVersion());
  const osmReport = await page.evaluate((text) => window.__citygen.importText('town.osm', text), osm);
  expect(osmReport.ok).toBe(true);
  expect(osmReport.message).toContain('3 features');
  await waitForRegen(page, v0);
  let doc = (await page.evaluate(() => window.__citygen.getDocument())) as {
    authored: { features: { properties: { layer: string; name?: string } }[] };
    spec: {
      customCulturePacks: { id: string }[];
      culture: string;
      terrain: { importedHeightmap?: { width: number } };
    };
  };
  expect(doc.authored.features.map((f) => f.properties.layer).sort()).toEqual(['rail', 'street', 'street']);
  expect(doc.authored.features.some((f) => f.properties.name === 'Federal Street')).toBe(true);

  // A culture pack: a copy of the built-in with a new id and a distinctive settlement grammar.
  const pack = {
    id: 'e2e-pack',
    name: 'E2E Pack',
    naming: {
      given: ['Ada', 'Bram', 'Cora', 'Dov'],
      family: ['Arkwright', 'Bessel', 'Corliss', 'Dunmore'],
      settlement: { patterns: ['Zz{family}ton'] },
      street: { patterns: ['{family}{suffix}'] },
      streetSuffix: {
        artery: [' Way'],
        road: [' Road'],
        collector: [' Street'],
        street: [' Street'],
        lane: [' Lane'],
      },
      district: { patterns: ['{family} Quarter'] },
      water: { patterns: ['{name} Water'], parts: { name: ['Grey', 'Cold', 'Long', 'Mill'] } },
      business: { patterns: ['{family} & Co'] },
      quarters: {
        core: 'Old Quarter',
        cathedral: 'Minster',
        castle: 'Keep',
        market: 'Market',
        port: 'Docks',
        industrial: 'Works',
        station: 'Station',
      },
    },
    conventions: {
      religious: ['chapel', 'meeting house', 'church'],
      civic: ['town hall', 'court'],
      materials: { preIndustrial: { timber: 3 }, industrial: { brick: 3 }, modern: { concrete: 3 } },
    },
  };
  const packReport = await page.evaluate(
    (text) => window.__citygen.importText('pack.json', text),
    JSON.stringify(pack),
  );
  expect(packReport.ok).toBe(true);
  expect(packReport.message).toContain('E2E Pack');
  await expect(page.getByLabel('Culture')).toContainText('E2E Pack');
  const v1 = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByLabel('Culture').selectOption('e2e-pack');
  await waitForRegen(page, v1);
  const named = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  expect(named.culture).toBe('e2e-pack');
  expect(named.settlements.every((s) => /^Zz/.test(s.name ?? ''))).toBe(true);

  // A heightmap: a 16 × 16 ramp from 0 to 400 m makes a ridge where the synthetic coast was.
  const w = 16;
  const rgba: number[] = [];
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgba.push(y * 16, y * 16, y * 16, 255);
  const v2 = await page.evaluate(() => window.__citygen.tileVersion());
  const hmReport = await page.evaluate(
    ([px, min, max]) =>
      window.__citygen.importHeightmap(16, 16, px as number[], min as number, max as number),
    [rgba, -100, 400],
  );
  expect(hmReport.ok).toBe(true);
  await waitForRegen(page, v2);
  const after = (await page.evaluate(() => window.__citygen.stats())) as {
    terrain: { maxM: number; minM: number };
  };
  expect(after.terrain.maxM).toBeGreaterThan(200);
  expect(after.terrain.minM).toBeLessThan(0);
  doc = (await page.evaluate(() => window.__citygen.getDocument())) as typeof doc;
  expect(doc.spec.terrain.importedHeightmap?.width).toBe(16);

  // Open from URL: a document served by the test.
  const exported = (await page.evaluate(() => window.__citygen.exportJson())) as string;
  const other = JSON.parse(exported) as { meta: { name: string }; spec: { seed: string } };
  other.meta.name = 'From a gist';
  other.spec.seed = 'gist-seed';
  await page.route('https://gist.example/raw/region.citygen.json', (route) =>
    route.fulfill({ body: JSON.stringify(other), contentType: 'application/json' }),
  );
  const urlReport = await page.evaluate(
    (u) => window.__citygen.importFromUrl(u),
    'https://gist.example/raw/region.citygen.json',
  );
  expect(urlReport.ok).toBe(true);
  await expect(page.getByLabel('Document name')).toHaveValue('From a gist');
  // The Open menu offers the same.
  await page.getByRole('button', { name: 'Open ▾' }).click();
  await page.getByLabel('Document URL').fill('https://gist.example/raw/region.citygen.json');
  await page.getByRole('button', { name: 'Open URL' }).click();
  await expect(page.getByTestId('url-report')).toContainText('Opened');
});

test('the app is installable: a web manifest and a service worker are served', async ({ page, request }) => {
  await ready(page);
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const m = (await manifest.json()) as { name: string; icons: { src: string }[]; display: string };
  expect(m.name).toBe('CityGenerator');
  expect(m.display).toBe('standalone');
  expect(m.icons.length).toBeGreaterThanOrEqual(2);
  const icon = await request.get(`/${m.icons[0]!.src}`);
  expect(icon.ok()).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain('precache');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});

test('a building opens floor plans from the inspector with rooms, doors and downloads', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  const stats = (await page.evaluate(() => window.__citygen.stats())) as NamedStats;
  const city = stats.settlements[0]!;
  const { entries } = (await page.evaluate((id) => window.__citygen.directory(id, 'hotel', 5), city.id)) as {
    entries: { id: string; center: [number, number]; floors: number; name: string }[];
  };
  const b =
    entries[0] ??
    (
      (await page.evaluate((id) => window.__citygen.directory(id, '', 1), city.id)) as typeof stats & {
        entries: { id: string; center: [number, number]; floors: number; name: string }[];
      }
    ).entries[0]!;
  // The engine's plan.
  const plan = (await page.evaluate((id) => window.__citygen.interior(id), b.id)) as {
    floors: { rooms: { name: string; connects: string[] }[]; doors: unknown[]; walls: unknown[] }[];
  };
  expect(plan.floors.length).toBeGreaterThan(0);
  expect(plan.floors[0]!.rooms.length).toBeGreaterThan(0);
  expect(plan.floors[0]!.rooms.some((r) => r.connects.includes('outside'))).toBe(true);
  expect(plan.floors[0]!.walls.length).toBeGreaterThan(3);
  // Through the inspector.
  await page.evaluate(([x, y]) => window.__citygen.inspectAt(x!, y!), b.center);
  await expect(page.getByTestId('inspector-building')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.getByTestId('interior-panel')).toBeVisible();
  await expect(page.getByTestId('interior-svg').locator('svg')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('interior-rooms')).toContainText('m²');
  const floorButtons = page
    .getByTestId('interior-panel')
    .getByRole('button', { pressed: false })
    .filter({ hasText: /floor/ });
  if ((await floorButtons.count()) > 0) {
    await floorButtons.first().click();
    await expect(page.getByTestId('interior-svg').locator('svg')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Close floor plans' }).click();
  await expect(page.getByTestId('interior-panel')).toHaveCount(0);
  // A facility part (a warehouse, hall, ward…) has plans too, from the same button.
  const facilities = (await page.evaluate(() => window.__citygen.find({ kind: 'facility', limit: 50 }))) as {
    id: string;
    name: string;
    properties: {
      parts: { id: string; kind: string; name?: string; floors: number; center: [number, number] }[];
    };
  }[];
  const part = facilities.flatMap((f) => f.properties.parts)[0];
  expect(part).toBeDefined();
  const partPlan = (await page.evaluate((id) => window.__citygen.interior(id), part!.id)) as {
    floors: { rooms: { name: string; connects: string[] }[] }[];
  };
  expect(partPlan.floors.length).toBe(part!.floors);
  expect(partPlan.floors[0]!.rooms.some((r) => r.connects.includes('outside'))).toBe(true);
  await page.evaluate(([x, y]) => window.__citygen.inspectAt(x!, y!), part!.center);
  await expect(page.getByTestId('inspector-facility')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('inspector-facility')).toContainText(part!.name ?? part!.kind);
  await page.getByRole('button', { name: 'Floor plans' }).click();
  await expect(page.getByTestId('interior-svg').locator('svg')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('interior-rooms')).toContainText('m²');
  await page.getByRole('button', { name: 'Close floor plans' }).click();
});

test('the gallery opens example regions and share links open hosted documents', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  // A hosted registry elsewhere: an index that lists a pack and a document by relative path.
  const origin = new URL(page.url()).origin;
  await page.route('https://packs.example/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/r/index.json')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Miskatonic packs',
          description: 'test registry',
          packs: [{ file: 'cannery.json', name: 'Cannery (hosted)', kind: 'featureType', author: 'tester' }],
          documents: [{ url: `${origin}/gallery/castle-town-1650.citygen.json`, name: 'Hosted castle town' }],
        }),
      });
    if (url.pathname === '/r/cannery.json') {
      const res = await page.request.get(`${origin}/plugins/cannery.json`);
      return route.fulfill({ contentType: 'application/json', body: await res.text() });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(page.getByTestId('gallery-list')).toContainText('Arkham Coast');
  await expect(page.getByTestId('plugin-list')).toContainText('Lowlands');
  await page.getByTestId('plugin-list').getByRole('button', { name: 'Import' }).first().click();
  await expect(page.getByTestId('gallery-report')).toContainText('Lowlands');
  await page.getByLabel('Registry URL').fill('https://packs.example/r/index.json');
  await page.getByRole('button', { name: 'Add registry' }).click();
  await expect(page.getByTestId('registry-packs')).toContainText('Cannery (hosted)');
  await expect(page.getByTestId('registry-packs')).toContainText('tester');
  await expect(page.getByTestId('registry-documents')).toContainText('Hosted castle town');
  await page.getByTestId('registry-packs').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('gallery-report')).toContainText('Cannery');
  expect(await page.evaluate(() => localStorage.getItem('citygen.registries'))).toContain('packs.example');
  await page.getByRole('button', { name: 'Remove registry Miskatonic packs' }).click();
  await expect(page.getByTestId('registry-packs')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('citygen.registries'))).toBe('[]');
  const v = await page.evaluate(() => window.__citygen.tileVersion());
  await page
    .getByTestId('gallery-list')
    .locator('li')
    .filter({ hasText: 'Declining fishing port' })
    .getByRole('button', { name: 'Open' })
    .click();
  await waitForRegen(page, v);
  await expect(page.getByLabel('Document name')).toHaveValue('Innsmouth');
  type PortStats = { id: string; abandonedBlocks: number; peakPopulation: number; peakYear: number };
  const readPort = async () =>
    (
      (await page.evaluate(() => window.__citygen.stats())) as { settlements: PortStats[] } | null
    )?.settlements.find((s) => s.id === 'innsmouth');
  await expect.poll(readPort, { timeout: 60_000 }).toBeTruthy();
  const port = (await readPort())!;
  expect(port.peakPopulation).toBeGreaterThan(7000);
  expect(port.peakYear).toBeLessThan(1955);
  expect(port.abandonedBlocks).toBeGreaterThan(0);
  // A share link opens the document on load.
  await page.goto('/?doc=' + encodeURIComponent('/gallery/castle-town-1650.citygen.json'));
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  await expect(page.getByLabel('Document name')).toHaveValue('Castle Town', { timeout: 60_000 });
  await page.waitForFunction(() => !window.location.search.includes('doc='));
});

test('the interface switches language and remembers the choice', async ({ page }) => {
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('button', { name: 'Galerie', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exporter…' })).toBeVisible();
  await expect(page.getByLabel('Nom du document')).toBeVisible();
  // Tool labels, table-driven labels and the status line follow.
  await expect(page.getByRole('button', { name: 'Outil Polygone' })).toBeVisible();
  await expect(page.getByTestId('status')).toContainText('Prêt');
  await page.reload();
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('button', { name: 'Galerie', exact: true })).toBeVisible();
  await page.getByLabel('Langue').selectOption('de');
  await expect(page.getByRole('button', { name: 'Galerie', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportieren…' })).toBeVisible();
  await page.getByLabel('Sprache').selectOption('en');
  await expect(page.getByRole('button', { name: 'Export…' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('citygen.locale'))).toBe('en');
});

test('utility networks follow the towns and works, hide sewers from players and switch off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await ready(page);
  type Stats = {
    settlements: { id: string; center: [number, number]; population: number }[];
    utilities: {
      waterKm: number;
      gasKm: number;
      powerKm: number;
      sewerKm: number;
      substations: number;
      pylons: number;
      outfalls: number;
      canalKm: number;
    };
  };
  const stats = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  const u = stats.utilities;
  expect(u.powerKm).toBeGreaterThan(0);
  expect(u.substations).toBeGreaterThanOrEqual(1);
  expect(u.pylons).toBeGreaterThan(0);
  expect(u.waterKm).toBeGreaterThan(0);
  expect(u.sewerKm).toBeGreaterThan(0);
  expect(u.outfalls).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('utility-stats')).toContainText('substations');
  // The GM export carries the sewers; the player export does not.
  const city = stats.settlements.reduce(
    (m, s) => (s.population > m.population ? s : m),
    stats.settlements[0]!,
  );
  const frame = {
    minX: city.center[0] - 800,
    minY: city.center[1] - 800,
    maxX: city.center[0] + 800,
    maxY: city.center[1] + 800,
  };
  const classes = async (player: boolean) => {
    const text = (await page.evaluate((req) => window.__citygen.exportGeoJson(req), {
      frame,
      player,
      layers: [],
    })) as string;
    const geo = JSON.parse(text) as { features: { properties: { layer: string; class?: string } }[] };
    return new Set(
      geo.features.filter((f) => f.properties.layer === 'utilities').map((f) => f.properties.class),
    );
  };
  const gm = await classes(false);
  expect(gm.has('sewer')).toBe(true);
  expect(gm.has('waterMain')).toBe(true);
  expect((await classes(true)).has('sewer')).toBe(false);
  // Rendered: distribution mains under the arteries at high zoom.
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  if (!webglMissing) {
    await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
    await page.evaluate(
      ([cx, cy]) =>
        window.__citygenMap!.jumpTo({ center: [cx / 111319.490793, cy / 111319.490793], zoom: 14.5 }),
      city.center,
    );
    await page.waitForFunction(
      () => {
        const map = window.__citygenMap!;
        return map.areTilesLoaded() && map.queryRenderedFeatures({ layers: ['utility-water'] }).length > 0;
      },
      undefined,
      { timeout: 60_000 },
    );
  }
  // Off: nothing left.
  const v = await page.evaluate(() => window.__citygen.tileVersion());
  await page.getByTestId('networks').getByLabel('Utilities', { exact: true }).uncheck();
  await waitForRegen(page, v);
  const off = ((await page.evaluate(() => window.__citygen.stats())) as Stats).utilities;
  expect(off.waterKm + off.powerKm + off.sewerKm + off.gasKm).toBe(0);
  await expect(page.getByTestId('utility-stats')).toHaveCount(0);
});
