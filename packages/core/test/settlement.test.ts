import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  area,
  contentHash,
  generateBlock,
  pointInRing,
  roadsStage,
  sitingStage,
  terrainStage,
  townStage,
  WATER,
  type TerrainInput,
  type SettlementSpec,
} from '../src/index.js';

const terrainFixture: TerrainInput = {
  seed: 'town-fixture',
  extent: { widthM: 16_000, heightM: 12_000 },
  preset: 'bay',
  relief: 0.4,
  roughness: 0.4,
  seaLevel: 0,
  rivers: { major: 1, minor: 3 },
  cellSizeM: 40,
};

const runner = new StageRunner();
const terrainP = runner.run(terrainStage, terrainFixture);

const specs: SettlementSpec[] = [
  { id: 'arkham', kind: 'city', population: 12_000, layout: { streetPattern: 'organic' }, features: [] },
  {
    id: 'innsmouth',
    kind: 'fishingVillage',
    population: 500,
    layout: { streetPattern: 'organic' },
    features: [],
  },
  { id: 'dunwich', kind: 'village', population: 300, layout: { streetPattern: 'organic' }, features: [] },
];

describe('settlement siting', () => {
  it('places explicit settlements on land with separation and coastal preference', async () => {
    const terrain = await terrainP;
    const out = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    expect(out.sites.map((s) => s.id).sort()).toEqual(['arkham', 'dunwich', 'innsmouth']);
    for (const s of out.sites) {
      const col = Math.round(terrain.height.col(s.center[0]));
      const row = Math.round(terrain.height.row(s.center[1]));
      expect(terrain.water[row * terrain.height.width + col]).not.toBe(WATER.sea);
      expect(s.radiusM).toBeGreaterThan(80);
    }
    const inns = out.sites.find((s) => s.id === 'innsmouth')!;
    expect(inns.coastal).toBe(true);
    for (let i = 0; i < out.sites.length; i++)
      for (let j = i + 1; j < out.sites.length; j++) {
        const a = out.sites[i]!;
        const b = out.sites[j]!;
        expect(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1])).toBeGreaterThan(
          a.radiusM + b.radiusM,
        );
      }
  });

  it('synthesises settlements from the policy and honours pinned sites', async () => {
    const terrain = await terrainP;
    const out = await runner.run(sitingStage, {
      seed: 'p',
      terrain,
      year: 1925,
      settlements: [],
      policy: { count: [4, 4], kinds: {} },
    });
    expect(out.sites.length).toBeGreaterThanOrEqual(3);
    expect(out.sites[0]!.population).toBeGreaterThanOrEqual(out.sites[1]!.population);
    const pinned = await runner.run(sitingStage, {
      seed: 'p',
      terrain,
      year: 1925,
      settlements: [
        {
          id: 'x',
          kind: 'town',
          population: 4000,
          site: { center: [1234, -567], lock: true },
          layout: { streetPattern: 'mixed' },
          features: [],
        },
      ],
      policy: { count: [1, 1], kinds: {} },
    });
    expect(pinned.sites[0]!.center).toEqual([1234, -567]);
  });
});

describe('town stage', () => {
  it('builds a walled medieval city with plaza, wards, streets and blocks', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const site = siting.sites.find((s) => s.id === 'arkham')!;
    const t0 = performance.now();
    const town = await runner.run(townStage, { seed: 's', site, terrain, year: 1650, blockSizeM: 90 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(4000);
    expect(town.stats.inner).toBeGreaterThan(20);
    expect(town.stats.walled).toBe(true);
    expect(town.walls.features).toHaveLength(1);
    const gates = town.gates.features.filter((g) => g.properties.kind === 'gate');
    expect(gates.length).toBeGreaterThanOrEqual(2);
    const wards = new Set(town.patches.features.map((p) => p.properties.ward));
    expect(wards.has('plaza')).toBe(true);
    expect(wards.has('craftsmen')).toBe(true);
    expect(wards.has('farm')).toBe(true);
    expect(town.streets.features.some((s) => s.properties.class === 'artery')).toBe(true);
    expect(town.streets.features.some((s) => s.properties.class === 'road')).toBe(true);
    // Every block lies inside its patch and on land.
    for (const b of town.blocks) {
      expect(b.ring.length).toBeGreaterThanOrEqual(3);
      expect(b.areaM2).toBeGreaterThan(50);
      const c = b.ring.reduce(
        (acc, p) => [acc[0] + p[0] / b.ring.length, acc[1] + p[1] / b.ring.length],
        [0, 0],
      );
      const col = Math.round(terrain.height.col(c[0]));
      const row = Math.round(terrain.height.row(c[1]));
      expect(terrain.water[row * terrain.height.width + col]).not.toBe(WATER.sea);
    }
    // Patches touching the sea are clipped: no patch vertex lies in the sea.
    for (const p of town.patches.features) {
      for (const [x, y] of p.geometry.coordinates[0]!) {
        expect(terrain.height.sample(x!, y!)).toBeGreaterThanOrEqual(terrain.seaLevel - 3);
      }
    }
  });

  it('is deterministic (golden hash) and memoised', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const site = siting.sites.find((s) => s.id === 'arkham')!;
    const a = await runner.run(townStage, { seed: 's', site, terrain, year: 1650, blockSizeM: 90 });
    const b = await runner.run(townStage, { seed: 's', site, terrain, year: 1650, blockSizeM: 90 });
    expect(b).toBe(a);
    const c = await new StageRunner().run(townStage, {
      seed: 's',
      site,
      terrain,
      year: 1650,
      blockSizeM: 90,
    });
    expect(
      contentHash({ p: c.patches, s: c.streets, w: c.walls, g: c.gates, b: c.blocks.map((x) => x.ring) }),
    ).toBe(TOWN_GOLDEN);
  });

  it('handles a tiny village without walls', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const site = siting.sites.find((s) => s.id === 'dunwich')!;
    const town = await runner.run(townStage, { seed: 's', site, terrain, year: 1650, blockSizeM: 70 });
    expect(town.stats.walled).toBe(false);
    expect(town.blocks.length).toBeGreaterThan(2);
  });
});

describe('blocks', () => {
  it('subdivides blocks into lots with buildings inside them', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const site = siting.sites.find((s) => s.id === 'arkham')!;
    const town = await runner.run(townStage, { seed: 's', site, terrain, year: 1650, blockSizeM: 90 });
    let buildings = 0;
    let lots = 0;
    const t0 = performance.now();
    for (const block of town.blocks) {
      const model = generateBlock(block, 1650);
      lots += model.parcels.length;
      buildings += model.buildings.length;
      let lotArea = 0;
      for (const p of model.parcels) lotArea += p.properties.areaM2;
      if (block.ward !== 'castle' && block.ward !== 'cathedral' && block.ward !== 'park') {
        expect(lotArea).toBeGreaterThan(block.areaM2 * 0.9);
        expect(lotArea).toBeLessThan(block.areaM2 * 1.1);
      }
      for (const b of model.buildings) {
        const ring = b.geometry.coordinates[0]!.slice(0, -1) as [number, number][];
        expect(b.properties.floors).toBeGreaterThanOrEqual(1);
        const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [
          0, 0,
        ] as [number, number]);
        expect(pointInRing(c[0], c[1], block.ring)).toBe(true);
        expect(area(ring)).toBeLessThanOrEqual(b.properties.areaM2 + 1e-6);
      }
      const again = generateBlock(block, 1650);
      expect(again).toEqual(model);
    }
    const ms = performance.now() - t0;
    expect(buildings).toBeGreaterThan(300);
    expect(lots).toBeGreaterThan(buildings);
    expect(ms / town.blocks.length).toBeLessThan(20);
  });
});

describe('roads', () => {
  it('connects settlements over land with bridges at rivers', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const t0 = performance.now();
    const roads = await runner.run(roadsStage, { seed: 's', terrain, sites: siting.sites });
    expect(performance.now() - t0).toBeLessThan(6000);
    expect(roads.stats.links).toBeGreaterThanOrEqual(2);
    expect(roads.roads.features.length).toBeGreaterThanOrEqual(2);
    for (const r of roads.roads.features) {
      for (const [x, y] of r.geometry.coordinates) {
        const col = Math.round(terrain.height.col(x!));
        const row = Math.round(terrain.height.row(y!));
        expect(terrain.water[row * terrain.height.width + col]).not.toBe(WATER.sea);
      }
    }
  });
});

const TOWN_GOLDEN = '8390ac7aa9dbc88a1711e66a4f419d04';
