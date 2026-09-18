import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  WATER,
  sitingStage,
  societyStage,
  terrainStage,
  eraAt,
  eraInterpolated,
  type EraParams,
} from '../src/index.js';

const eras: EraParams[] = [
  {
    id: 'a',
    year: 1400,
    name: 'a',
    ringPattern: 'organic',
    blockSizeM: { core: 60, ring: 90 },
    streetWidthM: { arterial: 8, collector: 5, local: 3, lane: 2 },
    densityPerKm2: 13000,
    transport: { horse: true, tram: false, rail: false, car: false, motorway: false, container: false },
    walls: true,
  },
  {
    id: 'b',
    year: 1900,
    name: 'b',
    ringPattern: 'grid',
    blockSizeM: { core: 100, ring: 150 },
    streetWidthM: { arterial: 18, collector: 12, local: 9, lane: 4 },
    densityPerKm2: 9000,
    transport: { horse: true, tram: true, rail: true, car: false, motorway: false, container: false },
    walls: false,
  },
];

describe('era lookup', () => {
  it('picks the nearest earlier era and interpolates numbers', () => {
    expect(eraAt(eras, 1650).id).toBe('a');
    expect(eraAt(eras, 1950).id).toBe('b');
    const mid = eraInterpolated(eras, 1650);
    expect(mid.densityPerKm2).toBeCloseTo(11000, 0);
    expect(mid.ringPattern).toBe('organic');
  });
});

describe('society fields', () => {
  it('produces coherent wealth and density gradients', async () => {
    const runner = new StageRunner();
    const terrain = await runner.run(terrainStage, {
      seed: 'society',
      extent: { widthM: 14_000, heightM: 10_000 },
      preset: 'coast',
      relief: 0.5,
      roughness: 0.5,
      seaLevel: 0,
      rivers: { major: 1, minor: 2 },
      cellSizeM: 50,
    });
    const siting = await runner.run(sitingStage, {
      seed: 'society',
      terrain,
      year: 1925,
      settlements: [
        { id: 'city', kind: 'city', population: 20000, layout: { streetPattern: 'mixed' }, features: [] },
        { id: 'v', kind: 'village', population: 400, layout: { streetPattern: 'mixed' }, features: [] },
      ],
      policy: { count: [1, 1], kinds: {} },
    });
    const society = await runner.run(societyStage, {
      seed: 'society',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    });
    const city = siting.sites[0]!;
    const atCentre = society.sample(city.center[0], city.center[1]);
    const far = society.sample(city.center[0] + city.radiusM * 6, city.center[1] + city.radiusM * 6);
    expect(atCentre.density).toBeGreaterThan(far.density);
    expect(['high', 'core', 'medium']).toContain(atCentre.densityClass);
    // Fields are in [0,1] on land and zero on the sea.
    let seaZero = true;
    let min = 1;
    let max = 0;
    const { width } = society.raster;
    const step = Math.round(society.raster.cellSizeM / terrain.height.cellSizeM);
    for (let i = 0; i < society.wealth.length; i++) {
      const col = i % width;
      const row = (i / width) | 0;
      const fi =
        Math.min(row * step, terrain.height.height - 1) * terrain.height.width +
        Math.min(col * step, terrain.height.width - 1);
      if (terrain.water[fi] === WATER.sea) {
        if (society.wealth[i] !== 0) seaZero = false;
        continue;
      }
      min = Math.min(min, society.wealth[i]!);
      max = Math.max(max, society.wealth[i]!);
    }
    expect(seaZero).toBe(true);
    expect(max - min).toBeGreaterThan(0.3);
    expect(society.wealthPolygons.features.length).toBeGreaterThan(3);
    expect(society.densityPolygons.features.length).toBeGreaterThan(3);
    // Higher inequality spreads the classes further.
    const unequal = await runner.run(societyStage, {
      seed: 'society',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 1,
    });
    const spread = (f: Float32Array) => {
      let lo = 1,
        hi = 0;
      for (const v of f)
        if (v > 0) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      return hi - lo;
    };
    expect(spread(unequal.wealth)).toBeGreaterThanOrEqual(spread(society.wealth));
  });
});
