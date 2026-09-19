import { expect, test, type Page } from '@playwright/test';

/** World metres → page pixels via the live map. */
async function screen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([mx, my]) => {
      const map = window.__citygenMap!;
      const p = map.project([mx / 111319.490793, my / 111319.490793]);
      const r = map.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [x, y],
  );
}

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__citygen !== 'undefined');
  await page.evaluate(() => window.__citygen.newDocument('e2e'));
  await page.waitForFunction(
    () => window.__citygen.tileVersion() > 0 && window.__citygen.status() === 'idle',
  );
  const webglMissing = await page.getByText('needs WebGL').isVisible();
  test.skip(webglMissing, 'WebGL is not available in this browser build');
  await page.waitForFunction(() => window.__citygenMap?.loaded() === true, undefined, { timeout: 60_000 });
}

async function jumpTo(page: Page, x: number, y: number, zoom: number) {
  await page.evaluate(
    ([cx, cy, z]) =>
      window.__citygenMap!.jumpTo({ center: [cx! / 111319.490793, cy! / 111319.490793], zoom: z! }),
    [x, y, zoom],
  );
}

async function regenerated(page: Page, action: () => Promise<void>) {
  const before = await page.evaluate(() => window.__citygen.tileVersion());
  await action();
  await page.waitForFunction(
    (v) => window.__citygen.tileVersion() > v && window.__citygen.status() === 'idle',
    before,
    { timeout: 90_000 },
  );
}

type Doc = {
  authored: {
    features: {
      id: string;
      geometry: { type: string; coordinates: number[][] };
      properties: Record<string, unknown>;
    }[];
  };
  annotations: { id: string; kind: string; text: string; gmOnly: boolean }[];
  overrides: { op: string; target?: string }[];
  meta: { name: string };
};
const doc = (page: Page) => page.evaluate(() => window.__citygen.getDocument()) as Promise<Doc>;

async function townCenter(page: Page): Promise<[number, number]> {
  const stats = (await page.evaluate(() => window.__citygen.stats())) as {
    settlements: { center: [number, number] }[];
  };
  return stats.settlements[0]!.center;
}

test('the line tool draws a street that survives a reseed and a year change', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 15);
  await page.getByRole('button', { name: 'Line tool' }).click();
  await expect(page.getByTestId('tool-options')).toBeVisible();
  await page.getByLabel('Layer').selectOption('street');
  await page.getByLabel('Kind').selectOption('main');
  await page.getByLabel('Width (m)').fill('14');
  const a = await screen(page, cx - 300, cy - 200);
  const b = await screen(page, cx + 250, cy + 100);
  const c = await screen(page, cx + 300, cy + 350);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(1);
  const street = d.authored.features[0]!;
  expect(street.properties).toMatchObject({ layer: 'street', kind: 'main', widthM: 14, origin: 'authored' });
  expect(street.geometry.type).toBe('LineString');
  expect(street.geometry.coordinates).toHaveLength(3);
  expect(Math.abs(street.geometry.coordinates[0]![0]! - (cx - 300))).toBeLessThan(15);
  // The new feature is selected and shown in the properties panel.
  expect(await page.evaluate(() => window.__citygen.selection())).toEqual([street.id]);
  await expect(page.getByTestId('properties')).toContainText('Street');
  // It renders from the authored source.
  await page.waitForFunction(
    () => window.__citygenMap!.queryRenderedFeatures({ layers: ['authored-lines'] }).length > 0,
  );

  // Reseed the settlements and change the year: the street stays exactly as drawn.
  await regenerated(page, async () => {
    await page.getByTestId('regenerate-region').click();
  });
  await regenerated(page, async () => {
    await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1650 }));
  });
  d = await doc(page);
  expect(d.overrides.some((o) => o.op === 'reseed' && o.target === 'region')).toBe(true);
  expect(d.authored.features[0]).toEqual(street);
  await page.waitForFunction(
    () => window.__citygenMap!.queryRenderedFeatures({ layers: ['authored-lines'] }).length > 0,
  );
});

test('rectangle tool draws a building; select tool moves it; undo restores it', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 16);
  await page.keyboard.press('r');
  expect(await page.evaluate(() => window.__citygen.tool())).toBe('rectangle');
  await page.getByLabel('Layer').selectOption('building');
  await page.getByLabel('Kind').selectOption('warehouse');
  const a = await screen(page, cx - 60, cy - 40);
  const b = await screen(page, cx + 60, cy + 40);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(1);
  const building = d.authored.features[0]!;
  expect(building.properties).toMatchObject({ layer: 'building', kind: 'warehouse' });
  expect(building.geometry.type).toBe('Polygon');
  await page.waitForFunction(
    () => window.__citygenMap!.queryRenderedFeatures({ layers: ['authored-buildings'] }).length > 0,
  );

  // Generated buildings under the authored one are dropped once the engine catches up.
  await page.waitForFunction(() => window.__citygen.status() === 'idle');
  const under = await page.evaluate(([x, y]) => window.__citygen.generatedAt(x, y, 1), [cx, cy]);
  expect(under === null || (under as { layer: string }).layer !== 'buildings').toBe(true);

  // Move it with the select tool.
  await page.keyboard.press('v');
  const inside = await screen(page, cx, cy);
  const target = await screen(page, cx + 200, cy + 150);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  d = await doc(page);
  const moved = d.authored.features[0]!;
  const ring = (moved.geometry.coordinates as unknown as number[][][])[0]!;
  const mx = ring.reduce((s, p) => s + p[0]!, 0) / ring.length;
  expect(Math.abs(mx - (cx + 200))).toBeLessThan(20);
  // Properties panel: rename, rotate, undo.
  await page.getByLabel('Feature name').fill('Marsh & Sons');
  await page.getByTitle('Rotate 15° clockwise').click();
  d = await doc(page);
  expect(d.authored.features[0]!.properties.name).toBe('Marsh & Sons');
  expect(d.authored.features[0]!.geometry).not.toEqual(moved.geometry);
  await page.keyboard.press('Control+z');
  d = await doc(page);
  expect(d.authored.features[0]!.geometry).toEqual(moved.geometry);
  // Delete key removes it; the store's selection follows.
  await page.keyboard.press('Delete');
  d = await doc(page);
  expect(d.authored.features).toHaveLength(0);
  expect(await page.evaluate(() => window.__citygen.selection())).toEqual([]);
});

test('the terrain brush raises the ground and the wealth brush shifts the field', async ({ page }) => {
  test.setTimeout(120_000); // three full regenerations from the terrain up
  await ready(page);
  const [cx, cy] = await townCenter(page);
  const px = cx + 2500;
  const py = cy + 2500;
  await jumpTo(page, px, py, 13);
  type Info = { elevationM: number; wealth: number; water: string };
  const before = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), [px, py])) as Info;
  await page.keyboard.press('b');
  await page.getByLabel('Brush', { exact: true }).selectOption('raise');
  await page.getByLabel('Brush amount').fill('60');
  await page.evaluate(() => window.__citygen.setToolOptions({ brushRadiusM: 400 }));
  const a = await screen(page, px - 200, py);
  const b = await screen(page, px + 200, py);
  await regenerated(page, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  });
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(1);
  expect(d.authored.features[0]!.properties).toMatchObject({ layer: 'terrainEdit', op: 'raise', amount: 60 });
  const after = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), [px, py])) as Info;
  expect(after.elevationM - before.elevationM).toBeGreaterThan(30);

  await page.getByLabel('Brush', { exact: true }).selectOption('wealth');
  await page.getByLabel('Brush amount').fill('0.8');
  await regenerated(page, async () => {
    await page.mouse.click(a.x, a.y);
  });
  d = await doc(page);
  expect(d.authored.features).toHaveLength(2);
  expect(d.authored.features[1]!.properties).toMatchObject({ layer: 'fieldEdit', field: 'wealth' });
  const richer = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), [px - 200, py])) as Info;
  expect(richer.wealth).toBeGreaterThan(before.wealth);

  // Erase brush removes both strokes.
  await page.getByLabel('Brush', { exact: true }).selectOption('erase');
  await regenerated(page, async () => {
    await page.mouse.click(a.x, a.y);
  });
  d = await doc(page);
  expect(d.authored.features).toHaveLength(0);
});

test('annotations render as markers and edit through the properties panel', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 14);
  await page.keyboard.press('n');
  await page.getByLabel('Annotation kind').selectOption('label');
  await page.getByLabel('Annotation text').fill('Innsmouth');
  const a = await screen(page, cx, cy - 300);
  await page.mouse.click(a.x, a.y);
  await page.getByLabel('Annotation kind').selectOption('note');
  await page.getByLabel('Annotation text').fill('Deep Ones below');
  const b = await screen(page, cx + 400, cy);
  await page.mouse.click(b.x, b.y);
  await page.getByLabel('Annotation kind').selectOption('handoutFrame');
  await page.getByLabel('Annotation text').fill('Handout A');
  await page.mouse.click(a.x, a.y + 40);
  let d = await doc(page);
  expect(d.annotations.map((x) => x.kind)).toEqual(['label', 'note', 'handoutFrame']);
  expect(d.annotations[1]!.gmOnly).toBe(true);
  const markers = page.getByTestId('annotation-marker');
  await expect(markers).toHaveCount(3);
  await expect(markers.filter({ hasText: 'Innsmouth' })).toBeVisible();
  await page.waitForFunction(
    () => window.__citygenMap!.queryRenderedFeatures({ layers: ['annotation-frames'] }).length > 0,
  );

  // Click the label to select it and edit its text.
  await page.keyboard.press('v');
  await markers.filter({ hasText: 'Innsmouth' }).click();
  await expect(page.getByTestId('properties')).toContainText('Annotation · label');
  await page.getByTestId('properties').getByLabel('Annotation text').fill('Innsmouth (1928)');
  d = await doc(page);
  expect(d.annotations[0]!.text).toBe('Innsmouth (1928)');
  await expect(markers.filter({ hasText: 'Innsmouth (1928)' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  d = await doc(page);
  expect(d.annotations).toHaveLength(2);
  await expect(markers).toHaveCount(2);
});

test('a generated building can be frozen or removed and both survive a reseed', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 16);
  await page.waitForFunction(
    () => {
      const map = window.__citygenMap!;
      return map.areTilesLoaded() && map.queryRenderedFeatures({ layers: ['buildings'] }).length > 20;
    },
    undefined,
    { timeout: 60_000 },
  );
  // Find a generated building near the centre through the engine, then click it.
  const hit = (await page.evaluate(
    async ([x, y]) => {
      for (let r = 0; r < 400; r += 10) {
        for (const [dx, dy] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
          [r, r],
          [-r, -r],
        ]) {
          const h = (await window.__citygen.generatedAt(x + dx!, y + dy!, 1)) as {
            layer: string;
            geometry: { coordinates: number[][][] };
          } | null;
          if (h && h.layer === 'buildings') {
            const ring = h.geometry.coordinates[0]!;
            const n = ring.length - 1;
            return {
              x: ring.slice(0, n).reduce((s, p) => s + p[0]!, 0) / n,
              y: ring.slice(0, n).reduce((s, p) => s + p[1]!, 0) / n,
            };
          }
        }
      }
      return null;
    },
    [cx, cy],
  )) as { x: number; y: number } | null;
  expect(hit).not.toBeNull();
  await page.keyboard.press('v');
  const s = await screen(page, hit!.x, hit!.y);
  await page.mouse.click(s.x, s.y);
  await expect(page.getByTestId('properties')).toContainText('Generated building');
  await page.getByTestId('freeze').click();
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(1);
  const frozen = d.authored.features[0]!;
  expect(frozen.properties).toMatchObject({ layer: 'building', origin: 'frozen' });
  expect(typeof frozen.properties.frozenFrom).toBe('string');
  await expect(page.getByTestId('properties')).toContainText('frozen');

  // Remove another generated building.
  await page.keyboard.press('Escape');
  await page.mouse.click(s.x + 1, s.y + 1); // the frozen copy is now authored: selects it
  expect(await page.evaluate(() => window.__citygen.selection())).toEqual([frozen.id]);
  const other = (await page.evaluate(
    async ([x, y, skip]) => {
      for (let r = 30; r < 500; r += 10) {
        for (const [dx, dy] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
        ]) {
          const h = (await window.__citygen.generatedAt(x + dx!, y + dy!, 1)) as {
            layer: string;
            id: string;
          } | null;
          if (h && h.layer === 'buildings' && h.id !== skip) return { x: x + dx!, y: y + dy!, id: h.id };
        }
      }
      return null;
    },
    [hit!.x, hit!.y, frozen.properties.frozenFrom as string],
  )) as { x: number; y: number; id: string } | null;
  expect(other).not.toBeNull();
  const o = await screen(page, other!.x, other!.y);
  await page.keyboard.press('Escape');
  await page.mouse.click(o.x, o.y);
  await expect(page.getByTestId('properties')).toContainText('Generated building');
  await regenerated(page, async () => {
    await page.getByTestId('suppress').click();
  });
  d = await doc(page);
  expect(d.overrides).toContainEqual({ op: 'suppress', target: other!.id });
  const gone = await page.evaluate(([x, y]) => window.__citygen.generatedAt(x, y, 1), [other!.x, other!.y]);
  expect(gone === null || (gone as { id: string }).id !== other!.id).toBe(true);

  // A regeneration of the settlement keeps the frozen building.
  await regenerated(page, async () => {
    await page.getByTestId('regenerate-region').click();
  });
  d = await doc(page);
  expect(d.authored.features[0]).toEqual(frozen);
});

test('regenerating the region keeps the terrain and changes the layout', async ({ page }) => {
  await ready(page);
  type Stats = {
    terrain: { maxM: number; riverKm: number };
    blocks: number;
    settlements: { patches: number }[];
  };
  const before = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  await regenerated(page, async () => {
    await page.getByTestId('regenerate-region').click();
  });
  const after = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(after.terrain).toEqual(before.terrain);
  expect(after.settlements.map((s) => s.patches)).not.toEqual(before.settlements.map((s) => s.patches));
  await regenerated(page, async () => {
    await page.getByRole('button', { name: /^Reset \(1\)$/ }).click();
  });
  const reset = (await page.evaluate(() => window.__citygen.stats())) as Stats;
  expect(reset.settlements.map((s) => s.patches)).toEqual(before.settlements.map((s) => s.patches));
});

test('recent documents and the history menu', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Document name').fill('Kingsport');
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1890 }));
  await page.waitForFunction(() => window.__citygen.recent().some((r) => r.name === 'Kingsport'));
  await page.getByRole('button', { name: 'Open ▾' }).click();
  await expect(page.getByTestId('recent-list')).toContainText('Kingsport');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__citygen.newDocument('fresh'));
  await expect(page.getByLabel('Document name')).toHaveValue('Untitled region');
  await page.getByRole('button', { name: 'Open ▾' }).click();
  await page
    .getByTestId('recent-list')
    .getByRole('button', { name: /^Kingsport/ })
    .click();
  await expect(page.getByLabel('Document name')).toHaveValue('Kingsport');
  const d = await doc(page);
  expect((d as unknown as { spec: { year: number } }).spec.year).toBe(1890);

  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1920 }));
  await page.evaluate(() => window.__citygen.dispatch({ type: 'year.set', year: 1950 }));
  await page.getByRole('button', { name: /^History \(2/ }).click();
  await expect(page.getByTestId('history-list')).toContainText('Year 1950');
  await page
    .getByTestId('history-list')
    .getByRole('button', { name: /Year 1920/ })
    .click();
  const jumped = (await page.evaluate(() => window.__citygen.getDocument())) as { spec: { year: number } };
  expect(jumped.spec.year).toBe(1920);
  await expect(page.getByRole('button', { name: /^History \(1 ↷\)/ })).toBeVisible();
});

test('the lasso takes in what it encircles and the find row selects by layer and name', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 16);

  // Three buildings in a row, drawn with the rectangle tool.
  await page.keyboard.press('r');
  await page.getByLabel('Layer').selectOption('building');
  await page.getByLabel('Kind').selectOption('warehouse');
  for (const dx of [-150, 0, 150]) {
    const a = await screen(page, cx + dx - 40, cy - 30);
    const b = await screen(page, cx + dx + 40, cy + 30);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  }
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(3);
  // Name the middle one so the find row has something to match.
  await page.keyboard.press('v');
  const middle = await screen(page, cx, cy);
  await page.mouse.click(middle.x, middle.y);
  await page.getByLabel('Feature name').fill('Marsh Wharf');
  await page.getByLabel('Feature name').blur();

  // Lasso a loop around the left two buildings only.
  await page.keyboard.press('s');
  expect(await page.evaluate(() => window.__citygen.tool())).toBe('lasso');
  const loop: [number, number][] = [
    [cx - 230, cy - 120],
    [cx + 60, cy - 120],
    [cx + 60, cy + 120],
    [cx - 230, cy + 120],
  ];
  const first = await screen(page, loop[0]![0], loop[0]![1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [lx, ly] of loop.slice(1)) {
    const p = await screen(page, lx, ly);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await page.mouse.up();
  expect(await page.evaluate(() => window.__citygen.selection().length)).toBe(2);

  // The find row: every building in view, then just the named one.
  await page.getByLabel('Query layer').selectOption('building');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  expect(await page.evaluate(() => window.__citygen.selection().length)).toBe(3);
  await page.getByLabel('Query text').fill('Marsh');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  expect(await page.evaluate(() => window.__citygen.selection().length)).toBe(1);
  await expect(page.getByTestId('select-query')).toContainText('1 selected');

  // The three buildings were drawn on one line, so a fourth drawn a few metres past that line
  // is pulled onto it by the alignment guides.
  await page.keyboard.press('r');
  const ga = await screen(page, cx - 40, cy + 170);
  const gb = await screen(page, cx + 40, cy + 34);
  await page.mouse.move(ga.x, ga.y);
  await page.mouse.down();
  await page.mouse.move(gb.x, gb.y, { steps: 6 });
  await page.mouse.up();
  d = await doc(page);
  expect(d.authored.features).toHaveLength(4);
  // Alignment: the corner was dragged a few metres past the row's line and landed exactly on it.
  const ys = (d.authored.features[3]!.geometry.coordinates as unknown as number[][][])[0]!.map((p) => p[1]!);
  const rowYs = (d.authored.features[0]!.geometry.coordinates as unknown as number[][][])[0]!.map(
    (p) => p[1]!,
  );
  // The rectangle was dragged upward, so its top edge is the corner that was aligned.
  expect(Math.min(...ys)).toBeCloseTo(Math.max(...rowYs), 6);
});

test('the vegetation brush paints woods, the year brush ages a quarter, and an arrow is drawn', async ({
  page,
}) => {
  test.setTimeout(180_000); // two regenerations from the terrain up
  await ready(page);
  const [cx, cy] = await townCenter(page);
  const px = cx + 2500;
  const py = cy + 2500;
  await jumpTo(page, px, py, 13);
  type Info = { landcover: string };
  const before = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), [px, py])) as Info;

  // Paint marsh over that ground; the inspector reports the painted cover.
  await page.keyboard.press('b');
  await page.getByLabel('Brush', { exact: true }).selectOption('vegetation');
  await page.getByLabel('Cover class').selectOption('marsh');
  await page.evaluate(() => window.__citygen.setToolOptions({ brushRadiusM: 400 }));
  const a = await screen(page, px - 200, py);
  const b = await screen(page, px + 200, py);
  await regenerated(page, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  });
  let d = await doc(page);
  expect(d.authored.features[0]!.properties).toMatchObject({ layer: 'vegetation', kind: 'marsh' });
  const after = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), [px, py])) as Info;
  expect(after.landcover).toBe('marsh');
  expect(before.landcover === 'marsh').toBe(false);

  // Age a band of the town by fifty years.
  await jumpTo(page, cx, cy, 15);
  await page.getByLabel('Brush', { exact: true }).selectOption('year');
  await page.getByLabel('Brush amount').fill('-50');
  const ya = await screen(page, cx - 300, cy + 200);
  const yb = await screen(page, cx + 300, cy + 200);
  await regenerated(page, async () => {
    await page.mouse.move(ya.x, ya.y);
    await page.mouse.down();
    await page.mouse.move(yb.x, yb.y, { steps: 6 });
    await page.mouse.up();
  });
  d = await doc(page);
  expect(d.authored.features[1]!.properties).toMatchObject({ layer: 'fieldEdit', field: 'year', delta: -50 });

  // Drag an arrow annotation; it lands in the document with both ends.
  await page.keyboard.press('n');
  await page.getByLabel('Annotation kind').selectOption('arrow');
  await page.getByLabel('Annotation text').fill('the way in');
  const aa = await screen(page, cx - 200, cy - 200);
  const ab = await screen(page, cx + 100, cy - 60);
  await page.mouse.move(aa.x, aa.y);
  await page.mouse.down();
  await page.mouse.move(ab.x, ab.y, { steps: 6 });
  await page.mouse.up();
  d = await doc(page);
  const arrow = d.annotations.find((x) => x.kind === 'arrow')!;
  expect(arrow.text).toBe('the way in');
  // The map draws the shaft and a head of its own.
  await page.waitForFunction(
    () =>
      window.__citygenMap!.querySourceFeatures('annotations').some((f) => f.properties.kind === 'arrowhead'),
    undefined,
    { timeout: 15_000 },
  );
});

test('the drawn-layers panel locks a layer, fades it and changes the draw order', async ({ page }) => {
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 16);

  // A street and a building over it.
  await page.keyboard.press('l');
  await page.getByLabel('Layer').selectOption('street');
  const la = await screen(page, cx - 200, cy);
  const lb = await screen(page, cx + 200, cy);
  await page.mouse.click(la.x, la.y);
  await page.mouse.click(lb.x, lb.y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('r');
  await page.getByLabel('Layer').selectOption('building');
  const ba = await screen(page, cx - 60, cy - 40);
  const bb = await screen(page, cx + 60, cy + 40);
  await page.mouse.move(ba.x, ba.y);
  await page.mouse.down();
  await page.mouse.move(bb.x, bb.y, { steps: 4 });
  await page.mouse.up();
  let d = await doc(page);
  expect(d.authored.features).toHaveLength(2);

  // With the select tool, clicking the building selects it.
  await page.keyboard.press('v');
  const inside = await screen(page, cx, cy - 20);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForFunction(() => window.__citygen.selection().length === 1, undefined, {
    timeout: 10_000,
  });

  // Lock the buildings: the same click selects nothing.
  await page.getByRole('button', { name: 'Drawn layers' }).click();
  await page.getByLabel('Lock Building').check();
  const inside2 = await screen(page, cx - 40, cy + 25);
  await page.mouse.click(inside2.x, inside2.y);
  await page.waitForFunction(() => window.__citygen.selection().length === 0, undefined, {
    timeout: 10_000,
  });
  await page.getByLabel('Lock Building').uncheck();
  const inside3 = await screen(page, cx + 40, cy - 25);
  await page.mouse.click(inside3.x, inside3.y);
  await page.waitForFunction(() => window.__citygen.selection().length === 1, undefined, {
    timeout: 10_000,
  });

  // Fade the streets: the style carries the opacity the panel asked for.
  await page.getByLabel('Street opacity').fill('30');
  await page.waitForFunction(() => {
    const layer = window.__citygenMap!.getStyle().layers.find((l) => l.id === 'authored-lines');
    return JSON.stringify(layer?.paint ?? {}).includes('0.3');
  });

  // Draw the buildings under the streets: the style layers change places.
  const before = await page.evaluate(() => {
    const ids = window.__citygenMap!.getStyle().layers.map((l) => l.id);
    return ids.indexOf('authored-buildings') > ids.indexOf('authored-lines');
  });
  expect(before).toBe(true);
  // Buildings start above the tram, the railway and the streets: three steps down clears them.
  await page.getByLabel('Draw Building below').click();
  await page.getByLabel('Draw Building below').click();
  await page.getByLabel('Draw Building below').click();
  await page.waitForFunction(() => {
    const ids = window.__citygenMap!.getStyle().layers.map((l) => l.id);
    return ids.indexOf('authored-buildings') < ids.indexOf('authored-lines');
  });
  // The document itself is untouched: this is how the map is drawn, not what the region is.
  d = await doc(page);
  expect(d.authored.features).toHaveLength(2);
});

test('the facility tool draws a works on the ground it was given', async ({ page }) => {
  test.setTimeout(180_000); // a regeneration from the facilities up
  await ready(page);
  const [cx, cy] = await townCenter(page);
  await jumpTo(page, cx, cy, 14);
  await page.keyboard.press('f');
  expect(await page.evaluate(() => window.__citygen.tool())).toBe('facility');
  await page.getByLabel('Facility type').selectOption('industry.gasworks');
  await page.getByLabel('Facility size').selectOption('medium');

  // Drag the ground for it, a little out from the centre.
  const a = await screen(page, cx + 400, cy + 250);
  const b = await screen(page, cx + 800, cy + 430);
  await regenerated(page, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  });

  // The request is in the document, pinned to the drawn footprint.
  type Doc2 = {
    spec: {
      features: { id: string; type: string }[];
      settlements: { features: { id: string; type: string }[] }[];
    };
    overrides: { op: string; target?: string; lengthM?: number; widthM?: number }[];
  };
  const d = (await page.evaluate(() => window.__citygen.getDocument())) as unknown as Doc2;
  const asked = [...d.spec.features, ...d.spec.settlements.flatMap((s) => s.features)].find(
    (f) => f.type === 'industry.gasworks',
  )!;
  expect(asked).toBeDefined();
  const pin = d.overrides.find((o) => o.op === 'pin' && o.target === asked.id)!;
  expect(pin.lengthM).toBeGreaterThan(300);
  expect(pin.widthM).toBeGreaterThan(100);

  // The engine placed it where it was drawn, at that size.
  type Stats = {
    facilities: { list: { id: string; type: string; center: [number, number] }[]; failures: unknown[] };
  };
  const stats = (await page.evaluate(() => window.__citygen.stats())) as unknown as Stats;
  const placed = stats.facilities.list.find((f) => f.id === asked.id)!;
  expect(placed).toBeDefined();
  expect(Math.abs(placed.center[0] - (cx + 600))).toBeLessThan(40);
  expect(Math.abs(placed.center[1] - (cy + 340))).toBeLessThan(40);
  const info = (await page.evaluate(([x, y]) => window.__citygen.inspect(x, y), placed.center)) as {
    facility?: { id: string; lengthM: number; pinned: boolean };
  };
  expect(info.facility?.id).toBe(asked.id);
  expect(info.facility?.pinned).toBe(true);
  expect(Math.abs((info.facility?.lengthM ?? 0) - (pin.lengthM ?? 0))).toBeLessThan(1);
});
