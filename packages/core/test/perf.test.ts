import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  roadsStage,
  sitingStage,
  societyStage,
  terrainStage,
  townStage,
  type EraParams,
} from '../src/index.js';

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

describe('performance: 40 km region with a city and ten villages', () => {
  it('runs the eager stages within budget', async () => {
    const runner = new StageRunner();
    const t0 = performance.now();
    const terrain = await runner.run(terrainStage, {
      seed: 'perf',
      extent: { widthM: 40_000, heightM: 40_000 },
      preset: 'coast',
      relief: 0.5,
      roughness: 0.5,
      seaLevel: 0,
      rivers: { major: 1, minor: 3 },
    });
    const tTerrain = performance.now();
    const settlements = [
      {
        id: 'city',
        kind: 'city' as const,
        population: 60_000,
        layout: { streetPattern: 'mixed' as const },
        features: [],
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `v${i}`,
        kind: 'village' as const,
        population: 300 + i * 60,
        layout: { streetPattern: 'organic' as const },
        features: [],
      })),
    ];
    const siting = await runner.run(sitingStage, {
      seed: 'perf',
      terrain,
      year: 1925,
      settlements,
      policy: { count: [1, 1], kinds: {} },
    });
    const society = await runner.run(societyStage, {
      seed: 'perf',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    });
    const tSociety = performance.now();
    let blocks = 0;
    for (const site of siting.sites) {
      const town = await runner.run(townStage, {
        seed: 'perf',
        site,
        terrain,
        year: 1925,
        blockSizeM: 100,
        eras,
        society,
      });
      blocks += town.blocks.length;
    }
    const tTowns = performance.now();
    const roads = await runner.run(roadsStage, { seed: 'perf', terrain, sites: siting.sites });
    const tRoads = performance.now();
    const total = tRoads - t0;
    process.stdout.write(
      `PERF sites ${siting.sites.length} blocks ${blocks} terrain ${(tTerrain - t0).toFixed(0)}ms society ${(tSociety - tTerrain).toFixed(0)}ms towns ${(tTowns - tSociety).toFixed(0)}ms roads ${(tRoads - tTowns).toFixed(0)}ms total ${total.toFixed(0)}ms roadKm ${roads.stats.roadKm.toFixed(0)}\n`,
    );
    expect(siting.sites.length).toBeGreaterThanOrEqual(9);
    expect(total).toBeLessThan(12_000);
  }, 120_000);
});
