import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BIOME,
  LANDCOVER,
  Raster,
  StageRunner,
  WATER,
  computeFlow,
  contentHash,
  distanceTo,
  fillDepressions,
  landcoverStage,
  terrainStage,
  type TerrainInput,
} from '../src/index.js';

describe('hydrology', () => {
  it('fills a bowl to its spill level and marks it as a lake', () => {
    const r = Raster.forExtent(2000, 2000, 100);
    // A dome sloping down to the edges, with a pit in the middle whose rim is at ~65 m.
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) r.set(col, row, 80 - Math.hypot(r.x(col), r.y(row)) / 20);
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) if (Math.hypot(r.x(col), r.y(row)) < 300) r.set(col, row, 30);
    const { filled, lake } = fillDepressions(r, 0);
    const centre = r.index(Math.floor(r.width / 2), Math.floor(r.height / 2));
    expect(filled.data[centre]!).toBeGreaterThan(50);
    expect(filled.data[centre]!).toBeLessThan(67);
    expect(lake[centre]).toBe(1);
    expect(lake[0]).toBe(0);
  });

  it('routes flow downhill and accumulates', () => {
    const r = Raster.forExtent(1000, 300, 100);
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) r.set(col, row, r.x(col) / 10 + 100);
    const { filled } = fillDepressions(r, 0);
    const flow = computeFlow(filled, 0);
    // Everything drains west; the west edge column collects the most.
    const westMid = r.index(0, 2);
    const eastMid = r.index(r.width - 1, 2);
    expect(flow.accumulation[westMid]!).toBeGreaterThan(flow.accumulation[eastMid]!);
    expect(flow.downstream[eastMid]!).toBe(r.index(r.width - 2, 2));
  });

  it('computes a chamfer distance transform', () => {
    const mask = new Uint8Array(25);
    mask[12] = 1; // centre of a 5x5
    const d = distanceTo(mask, 5, 5, 10);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(10);
    expect(d[18]).toBeCloseTo(Math.SQRT2 * 10, 5);
    expect(d[0]).toBeCloseTo(2 * Math.SQRT2 * 10, 5);
  });
});

const fixture: TerrainInput = {
  seed: 'terrain-fixture',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'bay',
  relief: 0.5,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 3 },
  cellSizeM: 100,
};

describe('terrain stage', () => {
  it('generates a coherent bay with sea, rivers and contours', async () => {
    const runner = new StageRunner();
    const out = await runner.run(terrainStage, fixture);
    expect(out.stats.cells).toBe(121 * 91);
    expect(out.stats.landFraction).toBeGreaterThan(0.3);
    expect(out.stats.landFraction).toBeLessThan(0.95);
    expect(out.seaPolygons.features.length).toBeGreaterThan(0);
    expect(out.rivers.length).toBeGreaterThan(0);
    // Every river ends in the sea, a lake, a junction or the edge, and flows downhill.
    for (const r of out.rivers) {
      const [x0, y0] = r.points[0]!;
      const [x1, y1] = r.points[r.points.length - 1]!;
      expect(out.filled.sample(x0, y0)).toBeGreaterThanOrEqual(out.filled.sample(x1, y1) - 1);
      expect(r.widthM).toBeGreaterThan(2);
    }
    expect(out.rivers.some((r) => r.endsIn === 'sea')).toBe(true);
    expect(out.contours.features.length).toBeGreaterThan(5);
    for (const c of out.contours.features) expect(c.properties.elevation % out.contourIntervalM).toBe(0);
    // Sea cells are below sea level; bathymetry deepens away from the coast.
    let deepest = 0;
    for (let i = 0; i < out.water.length; i++) {
      if (out.water[i] === WATER.sea) {
        expect(out.height.data[i]!).toBeLessThan(out.seaLevel);
        deepest = Math.min(deepest, out.height.data[i]!);
      }
    }
    expect(deepest).toBeLessThan(-10);
  });

  it('is memoised by parameters and deterministic (golden hash)', async () => {
    const runner = new StageRunner();
    const a = await runner.run(terrainStage, fixture);
    const b = await runner.run(terrainStage, { ...fixture });
    expect(b).toBe(a);
    const c = await new StageRunner().run(terrainStage, fixture);
    expect(contentHash(c.height.data)).toBe(contentHash(a.height.data));
    expect(contentHash({ w: c.water, r: c.riverLines, k: c.contours })).toBe(TERRAIN_GOLDEN);
  });

  it('classifies land cover with sensible fractions', async () => {
    const runner = new StageRunner();
    const terrain = await runner.run(terrainStage, fixture);
    const lc = await runner.run(landcoverStage, { terrain, biome: DEFAULT_BIOME, seed: fixture.seed });
    expect(lc.classes.length).toBe(terrain.water.length);
    let lakeCells = 0;
    for (let i = 0; i < lc.classes.length; i++) {
      if (terrain.water[i] === WATER.sea || terrain.water[i] === WATER.lake)
        expect(lc.classes[i]).toBe(LANDCOVER.water);
      if (terrain.water[i] === WATER.lake) lakeCells++;
    }
    expect(lakeCells / lc.classes.length).toBeLessThan(0.05);
    expect(lc.fractions.water).toBeCloseTo(1 - terrain.stats.landFraction + lakeCells / lc.classes.length, 6);
    expect(lc.fractions.forest + lc.fractions.farmland + lc.fractions.open).toBeGreaterThan(0.3);
    expect(lc.polygons.features.length).toBeGreaterThan(3);
    // Same terrain object => memoised; the landcover key depends on the terrain key.
    const again = await runner.run(landcoverStage, { terrain, biome: DEFAULT_BIOME, seed: fixture.seed });
    expect(again).toBe(lc);
  });

  it('accepts an imported heightmap', async () => {
    const data = new Float32Array(16 * 16);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) data[r * 16 + c] = c * 10 - 40; // west below sea
    const out = await new StageRunner().run(terrainStage, {
      ...fixture,
      seed: 'imported',
      imported: { width: 16, height: 16, data, minM: -40, maxM: 110 },
    });
    expect(out.stats.landFraction).toBeGreaterThan(0.5);
    expect(out.stats.landFraction).toBeLessThan(0.85);
    expect(out.seaPolygons.features.length).toBe(1);
  });
});

const TERRAIN_GOLDEN = '85bdec1dcf07e7a128834bdf0dad229a';
