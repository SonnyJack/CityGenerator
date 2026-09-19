import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  generateBlock,
  landSampler,
  ringOnLand,
  roadsStage,
  shoreDistance,
  sitingStage,
  smoothOnLand,
  terrainStage,
  townStage,
  WATER,
  type SettlementSpec,
} from '../src/index.js';

const runner = new StageRunner();
const terrainP = runner.run(terrainStage, {
  seed: 'shore-fixture',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'bay',
  relief: 0.4,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 3 },
  cellSizeM: 40,
});
const specs: SettlementSpec[] = [
  { id: 'port', kind: 'portTown', population: 14_000, layout: { streetPattern: 'organic' }, features: [] },
  { id: 'fish', kind: 'fishingVillage', population: 600, layout: { streetPattern: 'organic' }, features: [] },
];

describe('the drawn shoreline as the land test', () => {
  it('puts the shore half a cell from water cell centres, where the drawn contour runs', async () => {
    const terrain = await terrainP;
    const { height, water } = terrain;
    const cell = height.cellSizeM;
    let checked = 0;
    for (let r = 1; r < height.height - 1 && checked < 200; r++)
      for (let c = 1; c < height.width - 1 && checked < 200; c++) {
        const i = r * height.width + c;
        const j = i + 1;
        if (water[i] !== WATER.sea || water[j] !== WATER.land) continue;
        // Distance grows from 0 at the sea cell centre to a cell at the land cell centre.
        const seaSide = shoreDistance(terrain, height.x(c) + cell * 0.25, height.y(r));
        const midpoint = shoreDistance(terrain, height.x(c) + cell * 0.5, height.y(r));
        const landSide = shoreDistance(terrain, height.x(c) + cell * 0.75, height.y(r));
        expect(seaSide).toBeLessThan(0);
        expect(Math.abs(midpoint)).toBeLessThan(cell * 0.3);
        expect(landSide).toBeGreaterThan(0);
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
    // A setback shrinks the land.
    const strict = landSampler(terrain, { setbackM: 30 });
    const loose = landSampler(terrain, { setbackM: 0 });
    let onlyLoose = 0;
    for (let r = 0; r < height.height; r += 3)
      for (let c = 0; c < height.width; c += 3) {
        const x = height.x(c);
        const y = height.y(r);
        if (strict(x, y)) expect(loose(x, y)).toBe(true);
        else if (loose(x, y)) onlyLoose++;
      }
    expect(onlyLoose).toBeGreaterThan(0);
  });

  it('keeps every generated building off the water and roads on land after smoothing', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 'shore',
      terrain,
      year: 1890,
      settlements: specs,
      policy: { count: [2, 2], kinds: {} },
    });
    const buildable = landSampler(terrain, { setbackM: 2, rivers: 'water' });
    let buildings = 0;
    for (const site of siting.sites) {
      const town = await runner.run(townStage, { seed: 'shore', site, terrain, year: 1890, blockSizeM: 80 });
      expect(town.blocks.length).toBeGreaterThan(0);
      for (const block of town.blocks) {
        const model = generateBlock(block, 1890, { buildable });
        for (const b of model.buildings) {
          buildings++;
          const ring = b.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
          expect(ringOnLand(ring, buildable)).toBe(true);
        }
      }
      // Patches touch the drawn shoreline at most, never cross it.
      const onLand = landSampler(terrain, { rivers: 'land' });
      for (const p of town.patches.features) {
        const ring = p.geometry.coordinates[0]!;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          cx += ring[i]![0]!;
          cy += ring[i]![1]!;
        }
        expect(onLand(cx / (ring.length - 1), cy / (ring.length - 1))).toBe(true);
      }
    }
    expect(buildings).toBeGreaterThan(50);
    const roads = await runner.run(roadsStage, { seed: 'shore', terrain, sites: siting.sites });
    const roadLand = landSampler(terrain, { rivers: 'land', aboveSea: false });
    for (const r of roads.roads.features) {
      const pts = r.geometry.coordinates as [number, number][];
      for (let i = 1; i < pts.length - 1; i++) expect(roadLand(pts[i]![0], pts[i]![1])).toBe(true);
      for (let i = 1; i < pts.length; i++) {
        const mid: [number, number] = [(pts[i]![0] + pts[i - 1]![0]) / 2, (pts[i]![1] + pts[i - 1]![1]) / 2];
        expect(roadLand(mid[0], mid[1])).toBe(true);
      }
    }
  });

  it('smoothOnLand snaps a corner-cutting curve back onto the routed path', () => {
    // An L-shaped path around a square lake in the corner it cuts.
    const raw: [number, number][] = [];
    for (let i = 0; i <= 10; i++) raw.push([i * 10, 0]);
    for (let i = 1; i <= 10; i++) raw.push([100, i * 10]);
    const lake = (x: number, y: number) => x > 55 && x < 100 && y > 0 && y < 45;
    const onLand = (x: number, y: number) => !lake(x, y);
    const smoothed = smoothOnLand(raw, onLand, { iterations: 3, tolerance: 1 });
    expect(smoothed[0]).toEqual([0, 0]);
    expect(smoothed[smoothed.length - 1]).toEqual([100, 100]);
    for (let i = 1; i < smoothed.length; i++) {
      const a = smoothed[i - 1]!;
      const b = smoothed[i]!;
      expect(onLand(b[0], b[1])).toBe(true);
      expect(onLand((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBe(true);
    }
  });
});
