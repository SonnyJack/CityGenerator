import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  area,
  growthFootprint,
  landSampler,
  sitingStage,
  terrainStage,
  townStage,
  type SettlementSpec,
} from '../src/index.js';

const runner = new StageRunner();
const flatP = runner.run(terrainStage, {
  seed: 'flat-fixture',
  extent: { widthM: 8_000, heightM: 6_000 },
  preset: 'plains',
  relief: 0,
  roughness: 0,
  seaLevel: 0,
  rivers: { major: 0, minor: 0 },
  cellSizeM: 40,
});
const bayP = runner.run(terrainStage, {
  seed: 'shore-fixture',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'bay',
  relief: 0.4,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 3 },
  cellSizeM: 40,
});

describe('growth footprint', () => {
  it('is a disc on a flat plain: the equivalent radius is the distance from the centre', async () => {
    const terrain = await flatP;
    const fp = growthFootprint(terrain, [0, 0], 1000);
    for (const [x, y] of [
      [300, 0],
      [0, -500],
      [400, 400],
      [-700, 200],
    ] as const) {
      const d = Math.hypot(x, y);
      expect(Math.abs(fp.radiusAt(x, y) - d)).toBeLessThan(d * 0.12 + fp.cellSizeM);
    }
    expect(fp.extent(800)).toBeGreaterThan(800 * 0.9);
    expect(fp.extent(800)).toBeLessThan(800 * 1.15);
    const ring = fp.outline(800);
    expect(ring).not.toBeNull();
    const a = area(ring!.slice(0, -1));
    expect(Math.abs(a - Math.PI * 800 * 800) / (Math.PI * 800 * 800)).toBeLessThan(0.15);
    expect(fp.steepShare(800, 0.2)).toBe(0);
  });

  it('covers the same area on a coast, on land only, spread along the shore', async () => {
    const terrain = await bayP;
    const siting = await runner.run(sitingStage, {
      seed: 'fp',
      terrain,
      year: 1890,
      settlements: [
        {
          id: 'port',
          kind: 'portTown',
          population: 14_000,
          layout: { streetPattern: 'organic' },
          features: [],
        },
      ] satisfies SettlementSpec[],
      policy: { count: [1, 1], kinds: {} },
    });
    const site = siting.sites[0]!;
    expect(site.coastal).toBe(true);
    const R = site.radiusM;
    const fp = growthFootprint(terrain, site.center, R * 1.7);
    const onLand = landSampler(terrain, { rivers: 'land' });
    // Every reached point is on land; the area within R is a disc's worth of ground.
    const step = fp.cellSizeM;
    let reached = 0;
    let wet = 0;
    let insideDisc = 0;
    const E = fp.extent(R);
    for (let y = site.center[1] - E; y <= site.center[1] + E; y += step)
      for (let x = site.center[0] - E; x <= site.center[0] + E; x += step) {
        if (fp.radiusAt(x, y) > R) continue;
        reached++;
        if (!onLand(x, y)) wet++;
        if (Math.hypot(x - site.center[0], y - site.center[1]) <= R) insideDisc++;
      }
    const areaM2 = reached * step * step;
    expect(wet / reached).toBeLessThan(0.02);
    expect(Math.abs(areaM2 - Math.PI * R * R) / (Math.PI * R * R)).toBeLessThan(0.2);
    // A port on the shore has water inside the disc, so the footprint reaches past it.
    expect(insideDisc).toBeLessThan(reached);
    expect(E).toBeGreaterThan(R);
  });

  it('shapes the town: no patch centroid over water and the town reaches past its disc', async () => {
    const terrain = await bayP;
    const siting = await runner.run(sitingStage, {
      seed: 'fp',
      terrain,
      year: 1890,
      settlements: [
        {
          id: 'port',
          kind: 'portTown',
          population: 14_000,
          layout: { streetPattern: 'organic' },
          features: [],
        },
      ] satisfies SettlementSpec[],
      policy: { count: [1, 1], kinds: {} },
    });
    const site = siting.sites[0]!;
    const town = await runner.run(townStage, { seed: 'fp', site, terrain, year: 1890, blockSizeM: 70 });
    expect(town.extentM).toBeGreaterThan(site.radiusM);
    const onLand = landSampler(terrain, { rivers: 'land' });
    for (const f of town.patches.features) {
      const ring = f.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
      const n = ring.length - 1;
      const c = ring.slice(0, n).reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
      expect(onLand(c[0], c[1])).toBe(true);
    }
    expect(town.stats.steepShare).toBeGreaterThanOrEqual(0);
    expect(town.stats.steepShare).toBeLessThan(0.5);
  });
});
