import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  contentHash,
  railStage,
  sitingStage,
  societyStage,
  terrainStage,
  townStage,
  tramStage,
  type EraParams,
  type SettlementSpec,
} from '../src/index.js';

const era = (id: string, year: number, rail: boolean, tram: boolean): EraParams => ({
  id,
  year,
  name: id,
  ringPattern: year < 1780 ? 'organic' : year < 1890 ? 'grid' : 'streetcar',
  blockSizeM: { core: 80, ring: 120 },
  streetWidthM: { arterial: 14, collector: 10, local: 8, lane: 3.5 },
  densityPerKm2: 10000,
  transport: {
    horse: year < 1925,
    tram,
    rail,
    car: year >= 1925,
    motorway: year >= 1955,
    container: year >= 1985,
  },
  walls: year < 1780,
});
const eras: EraParams[] = [
  era('e1400', 1400, false, false),
  era('e1850', 1850, true, false),
  era('e1890', 1890, true, true),
  era('e1925', 1925, true, true),
  era('e1985', 1985, true, false),
];

const runner = new StageRunner();
const specs: SettlementSpec[] = [
  { id: 'metro', kind: 'metropolis', population: 120_000, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'town', kind: 'town', population: 4_000, layout: { streetPattern: 'mixed' }, features: [] },
];
async function build(year: number) {
  const terrain = await runner.run(terrainStage, {
    seed: 'tram',
    extent: { widthM: 18_000, heightM: 14_000 },
    preset: 'plains',
    relief: 0.3,
    roughness: 0.4,
    seaLevel: 0,
    rivers: { major: 1, minor: 2 },
    cellSizeM: 50,
  });
  const siting = await runner.run(sitingStage, {
    seed: 'tram',
    terrain,
    year,
    settlements: specs,
    policy: { count: [2, 2], kinds: {} },
  });
  const rail = await runner.run(railStage, {
    seed: 'tram',
    terrain,
    sites: siting.sites,
    year,
    eras,
    mainlines: 1,
    enabled: true,
  });
  const society = await runner.run(societyStage, {
    seed: 'tram',
    terrain,
    sites: siting.sites,
    year,
    wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    inequality: 0.5,
    nuisance: rail.nuisance,
  });
  const site = siting.sites.find((s) => s.id === 'metro')!;
  const town = await runner.run(townStage, {
    seed: 'tram',
    site,
    terrain,
    year,
    blockSizeM: 90,
    eras,
    society,
  });
  return { terrain, siting, rail, society, site, town };
}

describe('tram stage', () => {
  it('gives a 1925 metropolis a tram network with stops, a depot and crossings with the railway', async () => {
    const { rail, site, town } = await build(1925);
    const t0 = performance.now();
    const tram = await runner.run(tramStage, { seed: 'tram', site, town, year: 1925, eras, rail });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(tram.stats.lines).toBeGreaterThanOrEqual(2);
    expect(tram.stats.tramKm).toBeGreaterThan(3);
    expect(tram.stats.stops).toBeGreaterThan(tram.stats.lines * 2);
    expect(tram.structures.features.some((s) => s.properties.kind === 'tramDepot')).toBe(true);
    // Lines start at the central station's street node and end in the outer town.
    const central = rail.stations.features.find(
      (s) => s.properties.settlement === 'metro' && s.properties.kind === 'central',
    )!;
    for (const l of tram.lines.features) {
      const c = l.geometry.coordinates;
      expect(
        Math.hypot(
          c[0]![0]! - central.geometry.coordinates[0]!,
          c[0]![1]! - central.geometry.coordinates[1]!,
        ),
      ).toBeLessThan(400);
      const end = c[c.length - 1]!;
      expect(Math.hypot(end[0]! - site.center[0], end[1]! - site.center[1])).toBeGreaterThan(
        site.radiusM * 0.4,
      );
      // Every tram segment lies on a town street.
      const streetPts = new Set(
        town.streets.features.flatMap((s) =>
          s.geometry.coordinates.map((p) => `${Math.round(p[0]! * 10)},${Math.round(p[1]! * 10)}`),
        ),
      );
      for (const p of c)
        expect(streetPts.has(`${Math.round(p[0]! * 10)},${Math.round(p[1]! * 10)}`)).toBe(true);
    }
    // The railway through a big town meets its streets somewhere.
    expect(tram.stats.crossings).toBeGreaterThan(0);
    const kinds = new Set(tram.crossings.features.map((c) => c.properties.kind));
    expect([...kinds].every((k) => ['levelCrossing', 'railBridge', 'railUnderpass'].includes(k))).toBe(true);
    const again = await new StageRunner().run(tramStage, {
      seed: 'tram',
      site,
      town,
      year: 1925,
      eras,
      rail,
    });
    expect(contentHash(again.lines)).toBe(contentHash(tram.lines));
  }, 60_000);

  it('has no trams in 1985 (the era profile dropped them) but still reports crossings', async () => {
    const { rail, site, town } = await build(1985);
    const tram = await runner.run(tramStage, { seed: 'tram', site, town, year: 1985, eras, rail });
    expect(tram.stats.lines).toBe(0);
    expect(tram.stats.crossings).toBeGreaterThan(0);
  }, 60_000);
});
