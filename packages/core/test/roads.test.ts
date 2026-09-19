import { describe, expect, it } from 'vitest';
import {
  ROAD_GRADIENT_CAP,
  StageRunner,
  roadsStage,
  sitingStage,
  terrainStage,
  type SettlementSpec,
} from '../src/index.js';

const runner = new StageRunner();
const hills = runner.run(terrainStage, {
  seed: 'road-hills',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'hills',
  relief: 0.9,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 2 },
  cellSizeM: 40,
});
const specs: SettlementSpec[] = [
  { id: 'town', kind: 'town', population: 6_000, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'v1', kind: 'village', population: 700, layout: { streetPattern: 'organic' }, features: [] },
  { id: 'v2', kind: 'village', population: 600, layout: { streetPattern: 'organic' }, features: [] },
  { id: 'v3', kind: 'hamlet', population: 150, layout: { streetPattern: 'organic' }, features: [] },
];

describe('regional roads in the hills', () => {
  it('keep their ruling gradient with cuttings, embankments and the odd tunnel', async () => {
    const terrain = await hills;
    const siting = await runner.run(sitingStage, {
      seed: 'roads',
      terrain,
      year: 1925,
      settlements: specs,
      policy: { count: [4, 4], kinds: {} },
    });
    const roads = await runner.run(roadsStage, { seed: 'roads', terrain, sites: siting.sites });
    expect(roads.roads.features.length).toBeGreaterThan(3);
    const modes = new Set(roads.roads.features.map((f) => f.properties.mode));
    expect(modes.has('surface')).toBe(true);
    expect(modes.has('cutting') || modes.has('embankment')).toBe(true);
    expect(roads.stats.cuttings + roads.stats.embankments + roads.stats.tunnels).toBeGreaterThan(0);
    for (const f of roads.roads.features) {
      expect(f.properties.gradient).toBeLessThanOrEqual(ROAD_GRADIENT_CAP + 1e-6);
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
    expect(roads.stats.maxGradient).toBeLessThanOrEqual(ROAD_GRADIENT_CAP + 1e-6);
    // Ids are unique and the runs of one link join end to end.
    const ids = roads.roads.features.map((f) => String(f.id));
    expect(new Set(ids).size).toBe(ids.length);
    const byLink = new Map<string, typeof roads.roads.features>();
    for (const f of roads.roads.features) {
      const key = String(f.id).replace(/-\d+$/, '');
      byLink.set(key, [...(byLink.get(key) ?? []), f]);
    }
    for (const parts of byLink.values())
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i - 1]!.geometry.coordinates;
        const b = parts[i]!.geometry.coordinates;
        expect(a[a.length - 1]).toEqual(b[0]);
      }
  }, 120_000);
});
