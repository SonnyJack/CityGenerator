import { describe, expect, it } from 'vitest';
import {
  Raster,
  StageRunner,
  applyTerrainEdits,
  createDocument,
  fieldEdits,
  reseedSalt,
  sitingStage,
  societyStage,
  terrainEdits,
  terrainStage,
  townStage,
  zoneEdits,
  type TerrainInput,
} from '../src/index.js';

const NOW = '2026-09-18T00:00:00.000Z';

describe('authored views', () => {
  it('extracts typed edits from authored features and ignores malformed ones', () => {
    const doc = createDocument({ now: NOW, seed: 'a' });
    doc.authored.features.push(
      { type: 'Feature', id: 't1', geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] }, properties: { layer: 'terrainEdit', origin: 'authored', op: 'raise', radiusM: 50, amount: 20 } },
      { type: 'Feature', id: 't2', geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] }, properties: { layer: 'terrainEdit', origin: 'authored', op: 'explode' } },
      { type: 'Feature', id: 'f1', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { layer: 'fieldEdit', origin: 'authored', field: 'wealth', delta: -0.5 } },
      { type: 'Feature', id: 'z1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { layer: 'zone', origin: 'authored', kind: 'park' } },
    );
    expect(terrainEdits(doc).map((e) => e.id)).toEqual(['t1']);
    expect(fieldEdits(doc)[0]).toMatchObject({ id: 'f1', field: 'wealth', delta: -0.5, radiusM: 200 });
    expect(zoneEdits(doc)[0]).toMatchObject({ id: 'z1', ward: 'park' });
    expect(reseedSalt([{ op: 'reseed', target: 'x', salt: 'a' }, { op: 'reseed', target: 'region', salt: 'b' }], 'x')).toBe('a+b');
    expect(reseedSalt([{ op: 'reseed', target: 'y', salt: 'a' }], 'x')).toBe('');
  });
});

describe('terrain edits', () => {
  it('raise, lower, flatten and water change heights with falloff', () => {
    const r = Raster.forExtent(2000, 2000, 20);
    r.data.fill(50);
    applyTerrainEdits(r, [
      { id: 'a', op: 'raise', points: [[0, 0]], radiusM: 200, amount: 30 },
      { id: 'b', op: 'water', points: [[600, 600]], radiusM: 150, amount: -5 },
      { id: 'c', op: 'flatten', points: [[-600, -600], [-400, -600]], radiusM: 100, amount: 10 },
    ]);
    expect(r.sample(0, 0)).toBeCloseTo(80, 0);
    expect(r.sample(150, 0)).toBeGreaterThan(50);
    expect(r.sample(150, 0)).toBeLessThan(80);
    expect(r.sample(400, 0)).toBe(50);
    expect(r.sample(600, 600)).toBeLessThan(0);
    expect(r.sample(-500, -600)).toBeCloseTo(10, 0);
  });

  it('flows through the terrain stage and memo key', async () => {
    const base: TerrainInput = { seed: 'edit', extent: { widthM: 6000, heightM: 6000 }, preset: 'plains', relief: 0.3, roughness: 0.3, seaLevel: 0, rivers: { major: 0, minor: 1 }, cellSizeM: 50 };
    const runner = new StageRunner();
    const plain = await runner.run(terrainStage, base);
    const edited = await runner.run(terrainStage, { ...base, edits: [{ id: 'e', op: 'raise', points: [[0, 0]], radiusM: 300, amount: 80 }] });
    expect(edited).not.toBe(plain);
    // Erosion and diffusion run after the edit and soften the peak a little.
    const lift = edited.height.sample(0, 0) - plain.height.sample(0, 0);
    expect(lift).toBeGreaterThan(60);
    expect(lift).toBeLessThan(85);
    expect(edited.height.sample(2500, 2500)).toBeCloseTo(plain.height.sample(2500, 2500), 3);
  });
});

describe('field edits, zone overrides and reseeding', () => {
  it('paints wealth, overrides wards and changes layout with a salt', async () => {
    const runner = new StageRunner();
    const terrain = await runner.run(terrainStage, { seed: 'hooks', extent: { widthM: 10_000, heightM: 8_000 }, preset: 'plains', relief: 0.3, roughness: 0.4, seaLevel: 0, rivers: { major: 0, minor: 2 }, cellSizeM: 50 });
    const settlements = [{ id: 'town', kind: 'town' as const, population: 4000, site: { center: [0, 0] as [number, number], lock: true }, layout: { streetPattern: 'organic' as const }, features: [] }];
    const siting = await runner.run(sitingStage, { seed: 'hooks', terrain, year: 1650, settlements, policy: { count: [1, 1], kinds: {} } });
    const soc = { seed: 'hooks', terrain, sites: siting.sites, year: 1650, wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 }, density: { baseline: 0.5, gradient: 0.5, noise: 0.2 }, inequality: 0.5 };
    const plain = await runner.run(societyStage, soc);
    const painted = await runner.run(societyStage, { ...soc, edits: [{ id: 'p', field: 'wealth', points: [[0, 0]], radiusM: 400, delta: -0.6 }] });
    expect(painted.sample(0, 0).wealth).toBeLessThan(plain.sample(0, 0).wealth - 0.3);
    expect(painted.sample(3000, 3000).wealth).toBeCloseTo(plain.sample(3000, 3000).wealth, 6);

    const site = siting.sites[0]!;
    const town = await runner.run(townStage, { seed: 'hooks', site, terrain, year: 1650, blockSizeM: 80 });
    const zoned = await runner.run(townStage, { seed: 'hooks', site, terrain, year: 1650, blockSizeM: 80, zoneEdits: [{ id: 'z', ward: 'park', ring: [[-150, -150], [150, -150], [150, 150], [-150, 150], [-150, -150]] }] });
    const parksBefore = town.patches.features.filter((p) => p.properties.ward === 'park').length;
    const parksAfter = zoned.patches.features.filter((p) => p.properties.ward === 'park').length;
    expect(parksAfter).toBeGreaterThan(parksBefore);
    expect(zoned.patches.features.some((p) => p.properties.why.includes('authored zone z'))).toBe(true);

    const salted = await runner.run(townStage, { seed: 'hooks', site, terrain, year: 1650, blockSizeM: 80, salt: 'again' });
    expect(salted.patches.features.length).toBeGreaterThan(0);
    const wardsA = town.patches.features.map((p) => p.properties.ward).join(',');
    const wardsB = salted.patches.features.map((p) => p.properties.ward).join(',');
    expect(wardsA).not.toBe(wardsB);
    expect(salted.blocks[0]!.seed).toContain('again');
  });
});
