import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  gridOrientation,
  gradientBetween,
  sitingStage,
  STEPS_GRADIENT,
  terrainStage,
  townStage,
  type EraParams,
  type SettlementSpec,
  type TerrainInput,
} from '../src/index.js';

/** Imported heights from a function of the world position (row-major, south row first). */
function imported(widthM: number, heightM: number, cell: number, f: (x: number, y: number) => number) {
  const width = Math.ceil(widthM / cell) + 1;
  const height = Math.ceil(heightM / cell) + 1;
  const data = new Float32Array(width * height);
  let minM = Infinity;
  let maxM = -Infinity;
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const v = f(-widthM / 2 + c * cell, -heightM / 2 + r * cell);
      data[r * width + c] = v;
      minM = Math.min(minM, v);
      maxM = Math.max(maxM, v);
    }
  return { width, height, data, minM, maxM };
}

const base = (seed: string, f: (x: number, y: number) => number): TerrainInput => ({
  seed,
  extent: { widthM: 6_000, heightM: 4_000 },
  preset: 'plains',
  relief: 0,
  roughness: 0,
  seaLevel: 0,
  rivers: { major: 0, minor: 0 },
  cellSizeM: 40,
  imported: imported(6_000, 4_000, 40, f),
});

const runner = new StageRunner();
/** Angle difference modulo a quarter turn. */
const quarterDiff = (a: number, b: number) => {
  const q = Math.PI / 2;
  let d = (((a - b) % q) + q) % q;
  if (d > q / 2) d = q - d;
  return d;
};

describe('grid orientation', () => {
  it('runs along the contours on a slope', async () => {
    // A plane rising towards the direction 30°: the contours run at 120° ≡ 30° modulo a quarter turn.
    const dir = Math.PI / 6;
    const terrain = await runner.run(
      terrainStage,
      base('slope-fixture', (x, y) => 20 + (x * Math.cos(dir) + y * Math.sin(dir)) * 0.08),
    );
    const samples: [number, number][] = [];
    for (let y = -800; y <= 800; y += 80) for (let x = -800; x <= 800; x += 80) samples.push([x, y]);
    const o = gridOrientation(terrain, samples, 0.7);
    expect(o.aligned).toBe(true);
    expect(o.sloped).toBe(true);
    expect(quarterDiff(o.theta, dir)).toBeLessThan(0.06);
  });

  it('runs along the shore on flat land by the sea, and keeps the fallback inland', async () => {
    // Flat land north-east of a straight shore at 30°, sea beyond it.
    const dir = Math.PI / 6;
    const terrain = await runner.run(
      terrainStage,
      base('shore-fixture', (x, y) =>
        x * Math.cos(dir + Math.PI / 2) + y * Math.sin(dir + Math.PI / 2) > 0 ? 6 : -6,
      ),
    );
    const near: [number, number][] = [];
    const far: [number, number][] = [];
    for (let t = -900; t <= 900; t += 60)
      for (let d = 80; d <= 400; d += 40) {
        const nx = Math.cos(dir + Math.PI / 2);
        const ny = Math.sin(dir + Math.PI / 2);
        near.push([t * Math.cos(dir) + d * nx, t * Math.sin(dir) + d * ny]);
        far.push([t * Math.cos(dir) + (d + 1200) * nx, t * Math.sin(dir) + (d + 1200) * ny]);
      }
    const shore = gridOrientation(terrain, near, 0.7);
    expect(shore.aligned).toBe(true);
    expect(shore.sloped).toBe(false);
    expect(quarterDiff(shore.theta, dir)).toBeLessThan(0.08);
    const inland = gridOrientation(terrain, far, 0.7);
    expect(inland.aligned).toBe(false);
    expect(inland.theta).toBe(0.7);
  });
});

describe('stepped lanes', () => {
  it('turns the steepest minor streets of a hill town into steps', async () => {
    const terrain = await runner.run(terrainStage, {
      seed: 'steps-fixture',
      extent: { widthM: 8_000, heightM: 6_000 },
      preset: 'hills',
      relief: 0.9,
      roughness: 0.6,
      seaLevel: 0,
      rivers: { major: 1, minor: 2 },
      cellSizeM: 40,
    });
    const specs: SettlementSpec[] = [
      { id: 'hill', kind: 'town', population: 9_000, layout: { streetPattern: 'mixed' }, features: [] },
    ];
    const siting = await runner.run(sitingStage, {
      seed: 'steps',
      terrain,
      year: 1925,
      settlements: specs,
      policy: { count: [1, 1], kinds: {} },
    });
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
    const town = await runner.run(townStage, {
      seed: 'steps',
      site: siting.sites[0]!,
      terrain,
      year: 1925,
      blockSizeM: 70,
      eras,
    });
    const steps = town.streets.features.filter((f) => f.properties.class === 'steps');
    expect(steps.length).toBeGreaterThan(0);
    for (const f of steps) {
      const c = f.geometry.coordinates;
      const a: [number, number] = [c[0]![0]!, c[0]![1]!];
      const b: [number, number] = [c[c.length - 1]![0]!, c[c.length - 1]![1]!];
      expect(gradientBetween(terrain.height, a, b)).toBeGreaterThan(STEPS_GRADIENT);
    }
    // Driven streets stay under the limit, or are collectors and arteries that climb regardless.
    for (const f of town.streets.features) {
      if (f.properties.class !== 'street') continue;
      const c = f.geometry.coordinates;
      const a: [number, number] = [c[0]![0]!, c[0]![1]!];
      const b: [number, number] = [c[c.length - 1]![0]!, c[c.length - 1]![1]!];
      expect(gradientBetween(terrain.height, a, b)).toBeLessThanOrEqual(STEPS_GRADIENT + 1e-9);
    }
  });
});
