import { describe, expect, it } from 'vitest';
import { StageRunner, sitingStage, terrainStage, townStage, type SettlementSpec } from '../src/index.js';

const runner = new StageRunner();
const terrainP = runner.run(terrainStage, {
  seed: 'fields-fixture',
  extent: { widthM: 10_000, heightM: 8_000 },
  preset: 'plains',
  relief: 0.3,
  roughness: 0.4,
  seaLevel: 0,
  rivers: { major: 1, minor: 2 },
  cellSizeM: 40,
});
const specs: SettlementSpec[] = [
  { id: 'market', kind: 'town', population: 4_000, layout: { streetPattern: 'organic' }, features: [] },
];

describe('the farm belt', () => {
  it('is cut into strip fields with hedges, and every holding has a lane to a road', async () => {
    const terrain = await terrainP;
    const siting = await runner.run(sitingStage, {
      seed: 'fields',
      terrain,
      year: 1780,
      settlements: specs,
      policy: { count: [1, 1], kinds: {} },
    });
    const town = await runner.run(townStage, {
      seed: 'fields',
      site: siting.sites[0]!,
      terrain,
      year: 1780,
      blockSizeM: 70,
    });
    const farms = town.patches.features.filter((f) => f.properties.ward === 'farm' && !f.properties.inner);
    expect(farms.length).toBeGreaterThan(5);
    expect(town.hedges.features.length).toBeGreaterThan(farms.length);
    for (const h of town.hedges.features) expect(h.geometry.coordinates.length).toBe(2);
    const lanes = town.streets.features.filter((f) => f.properties.class === 'lane');
    expect(lanes.length).toBeGreaterThan(0);
    // A lane ends on the road network: its last point is a vertex of a road, an artery or a lane.
    const key = (p: number[]) => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`;
    const network = new Set<string>();
    for (const f of town.streets.features)
      if (['artery', 'road', 'lane'].includes(f.properties.class))
        for (const p of f.geometry.coordinates) network.add(key(p));
    for (const l of lanes) {
      const c = l.geometry.coordinates;
      expect(network.has(key(c[c.length - 1]!))).toBe(true);
      let len = 0;
      for (let i = 1; i < c.length; i++)
        len += Math.hypot(c[i]![0]! - c[i - 1]![0]!, c[i]![1]! - c[i - 1]![1]!);
      expect(len).toBeLessThanOrEqual(600);
    }
  }, 120_000);
});
