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
  societyStage,
  type EraParams,
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

describe('modern town with growth rings', () => {
  it('adds grid rings with modern zones around the old core in 1925', async () => {
    const terrain = await terrainP;
    const eras: EraParams[] = [
      {
        id: 'e1400',
        year: 1400,
        name: 'Late medieval',
        ringPattern: 'organic',
        blockSizeM: { core: 60, ring: 90 },
        streetWidthM: { arterial: 8, collector: 5, local: 3.5, lane: 2 },
        densityPerKm2: 13000,
        transport: { horse: true, tram: false, rail: false, car: false, motorway: false, container: false },
        walls: true,
      },
      {
        id: 'e1780',
        year: 1780,
        name: 'Georgian',
        ringPattern: 'grid',
        blockSizeM: { core: 80, ring: 120 },
        streetWidthM: { arterial: 12, collector: 9, local: 7, lane: 3 },
        densityPerKm2: 11000,
        transport: { horse: true, tram: false, rail: false, car: false, motorway: false, container: false },
        walls: false,
      },
      {
        id: 'e1890',
        year: 1890,
        name: 'Gaslight',
        ringPattern: 'streetcar',
        blockSizeM: { core: 90, ring: 140 },
        streetWidthM: { arterial: 18, collector: 12, local: 9, lane: 4 },
        densityPerKm2: 10000,
        transport: { horse: true, tram: true, rail: true, car: false, motorway: false, container: false },
        walls: false,
      },
      {
        id: 'e1925',
        year: 1925,
        name: 'Classic',
        ringPattern: 'streetcar',
        blockSizeM: { core: 100, ring: 160 },
        streetWidthM: { arterial: 20, collector: 14, local: 10, lane: 4 },
        densityPerKm2: 7000,
        transport: { horse: false, tram: true, rail: true, car: true, motorway: false, container: false },
        walls: false,
      },
    ];
    const siting = await runner.run(sitingStage, {
      seed: 'm',
      terrain,
      year: 1925,
      settlements: specs,
      policy: { count: [3, 8], kinds: {} },
    });
    const society = await runner.run(societyStage, {
      seed: 'm',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    });
    const site = siting.sites.find((s) => s.id === 'arkham')!;
    const t0 = performance.now();
    const town = await runner.run(townStage, {
      seed: 'm',
      site,
      terrain,
      year: 1925,
      blockSizeM: 90,
      eras,
      society,
    });
    expect(performance.now() - t0).toBeLessThan(6000);
    expect(town.stats.rings).toBeGreaterThanOrEqual(1);
    expect(town.stats.coreRadiusM).toBeLessThan(site.radiusM);
    expect(town.stats.walled).toBe(false);
    const wards = new Set(town.patches.features.map((p) => p.properties.ward));
    expect(wards.has('cbd')).toBe(true);
    expect(
      [...wards].some((w) =>
        ['rowhouse', 'tenement', 'streetcarSuburb', 'gardenSuburb', 'retailStrip', 'warehouse'].includes(w),
      ),
    ).toBe(true);
    const ringPatches = town.patches.features.filter((p) => p.properties.ring > 0);
    expect(ringPatches.length).toBeGreaterThan(20);
    for (const p of ringPatches) {
      expect(p.properties.why.length).toBeGreaterThan(5);
      const c = p.geometry.coordinates[0]!;
      const cx = c.reduce((a, q) => a + q[0]!, 0) / c.length;
      const cy = c.reduce((a, q) => a + q[1]!, 0) / c.length;
      expect(Math.hypot(cx - site.center[0], cy - site.center[1])).toBeGreaterThan(
        town.stats.coreRadiusM * 0.8,
      );
    }
    expect(town.streets.features.some((s) => s.properties.class === 'collector')).toBe(true);
    expect(town.blocks.length).toBeGreaterThan(town.stats.inner);
    // Ring blocks generate buildings too.
    const ringBlock = town.blocks.find((b) => b.id.includes('-r'))!;
    const model = generateBlock(ringBlock, 1925);
    expect(model.buildings.length).toBeGreaterThan(0);
    const again = await new StageRunner().run(townStage, {
      seed: 'm',
      site,
      terrain,
      year: 1925,
      blockSizeM: 90,
      eras,
      society,
    });
    expect(contentHash({ p: again.patches, s: again.streets })).toBe(MODERN_GOLDEN);
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

const TOWN_GOLDEN = 'ff1366004d93e22a9e8b04b52bac7ca4';
const MODERN_GOLDEN = 'bd68da70b05355d8bd411b24df180589';
