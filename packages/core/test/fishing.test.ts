import { describe, expect, it } from 'vitest';
import { StageRunner, sitingStage, terrainStage, townStage, type SettlementSpec } from '../src/index.js';

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
  { id: 'port', kind: 'portTown', population: 9_000, layout: { streetPattern: 'organic' }, features: [] },
  { id: 'fish', kind: 'fishingVillage', population: 500, layout: { streetPattern: 'organic' }, features: [] },
];

describe('the fishing quarter', () => {
  it('lines the shore of a port and takes the whole shore of a fishing village', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 'fishing',
      terrain,
      year: 1850,
      settlements: specs,
      policy: { count: [2, 2], kinds: {} },
    });
    const { height, distToSea } = terrain;
    const seaAt = (x: number, y: number) =>
      distToSea[
        Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1) * height.width +
          Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1)
      ]!;
    let quarters = 0;
    for (const site of siting.sites) {
      const town = await runner.run(townStage, {
        seed: 'fishing',
        site,
        terrain,
        year: 1850,
        blockSizeM: 60,
      });
      const fishing = town.patches.features.filter((f) => f.properties.ward === 'fishing');
      if (site.coastal) expect(fishing.length).toBeGreaterThan(0);
      for (const f of fishing) {
        const ring = f.geometry.coordinates[0]!;
        const n = ring.length - 1;
        const c = ring.slice(0, n).reduce((a, p) => [a[0] + p[0]! / n, a[1] + p[1]! / n], [0, 0]);
        expect(seaAt(c[0], c[1])).toBeLessThan(200);
        expect(f.properties.why).toContain('fishing');
      }
      quarters += fishing.length;
    }
    expect(quarters).toBeGreaterThan(0);
  }, 120_000);
});
