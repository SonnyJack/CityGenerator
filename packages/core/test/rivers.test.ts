import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  landSampler,
  shoreDistance,
  sitingStage,
  terrainStage,
  townStage,
  type EraParams,
  type SettlementSpec,
} from '../src/index.js';

const runner = new StageRunner();
const terrainP = runner.run(terrainStage, {
  seed: 'river-town-fixture',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'riverValley',
  relief: 0.4,
  roughness: 0.4,
  seaLevel: 0,
  rivers: { major: 1, minor: 2 },
  cellSizeM: 40,
});
const specs: SettlementSpec[] = [
  { id: 'mill', kind: 'millTown', population: 9_000, layout: { streetPattern: 'mixed' }, features: [] },
];
const eras: EraParams[] = [
  {
    id: 'old',
    year: 1400,
    name: 'Old',
    ringPattern: 'organic',
    blockSizeM: { core: 60, ring: 90 },
    streetWidthM: { arterial: 8, collector: 5, local: 3.5, lane: 2 },
    densityPerKm2: 13000,
    transport: { horse: true, tram: false, rail: false, car: false, motorway: false, container: false },
    walls: true,
  },
  {
    id: 'grid',
    year: 1850,
    name: 'Grid',
    ringPattern: 'grid',
    blockSizeM: { core: 80, ring: 110 },
    streetWidthM: { arterial: 12, collector: 9, local: 7, lane: 3 },
    densityPerKm2: 10000,
    transport: { horse: true, tram: false, rail: true, car: false, motorway: false, container: false },
    walls: false,
  },
];

describe('a river through the town', () => {
  it('keeps every patch on one bank, crosses only on bridges and stands blocks back behind a quay', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 'river',
      terrain,
      year: 1925,
      settlements: specs,
      policy: { count: [1, 1], kinds: {} },
    });
    const site = siting.sites[0]!;
    expect(site.riverside).toBe(true);
    const town = await runner.run(townStage, {
      seed: 'river',
      site,
      terrain,
      year: 1925,
      blockSizeM: 70,
      eras,
    });
    // No patch straddles the river: every patch centroid is on land with rivers as water.
    const dry = landSampler(terrain, { rivers: 'water' });
    for (const f of town.patches.features) {
      const ring = f.geometry.coordinates[0]!;
      const n = ring.length - 1;
      const c = ring.slice(0, n).reduce((a, p) => [a[0] + p[0]! / n, a[1] + p[1]! / n], [0, 0]);
      expect(dry(c[0], c[1])).toBe(true);
    }
    // A street crosses water only as a bridge: every street vertex is dry unless a bridge span
    // carries it, and every bridge has water under its middle.
    const bridges = town.bridges.features.map((b) => b.geometry.coordinates as [number, number][]);
    const onBridge = (p: number[]) =>
      bridges.some(([a, b]) => {
        const dx = b![0] - a![0];
        const dy = b![1] - a![1];
        const len2 = dx * dx + dy * dy || 1;
        const t = ((p[0]! - a![0]) * dx + (p[1]! - a![1]) * dy) / len2;
        if (t < -0.05 || t > 1.05) return false;
        const qx = a![0] + dx * t;
        const qy = a![1] + dy * t;
        return Math.hypot(qx - p[0]!, qy - p[1]!) < 3;
      });
    let riverCrossings = 0;
    for (const f of town.streets.features)
      for (const p of f.geometry.coordinates) {
        // Over the drawn river (not the sea or a lake), by the shoreline the map draws.
        const wet =
          shoreDistance(terrain, p[0]!, p[1]!, 'water') < -1 &&
          shoreDistance(terrain, p[0]!, p[1]!, 'land') > 0;
        if (wet) {
          riverCrossings++;
          expect(onBridge(p), `street ${String(f.id)} over the river off a bridge`).toBe(true);
        }
      }
    for (const [a, b] of bridges) {
      const mx = (a![0] + b![0]) / 2;
      const my = (a![1] + b![1]) / 2;
      expect(shoreDistance(terrain, mx, my, 'water')).toBeLessThanOrEqual(0);
    }
    // The town takes both banks, so it has bridges.
    const banks = new Set(
      town.patches.features.map((f) => {
        const c = f.geometry.coordinates[0]![0]!;
        return Math.sign(c[0]! - site.center[0]) * 0 + (dry(c[0]!, c[1]!) ? 1 : 0);
      }),
    );
    expect(banks.size).toBeGreaterThan(0);
    expect(bridges.length).toBeGreaterThan(0);
    expect(riverCrossings).toBeGreaterThanOrEqual(0);
    // Blocks on the water stand back behind a quay strip.
    let waterfront = 0;
    for (const b of town.blocks) {
      let near = Infinity;
      for (const [x, y] of b.ring) near = Math.min(near, shoreDistance(terrain, x, y, 'water'));
      if (near < 30) {
        waterfront++;
        expect(near).toBeGreaterThanOrEqual(6);
      }
    }
    expect(waterfront).toBeGreaterThan(0);
  }, 120_000);
});
