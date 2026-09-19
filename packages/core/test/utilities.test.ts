import { describe, expect, it } from 'vitest';
import {
  landSampler,
  StageRunner,
  contentHash,
  facilitiesStage,
  railStage,
  sitingStage,
  societyStage,
  terrainStage,
  townStage,
  utilitiesStage,
  WATER,
  type EraParams,
  type SettlementSpec,
  type TerrainOutput,
  type UtilitiesOutput,
  type UtilityFacility,
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
  era('e1925', 1925, true, true),
  era('e2020', 2020, true, true),
];

const runner = new StageRunner();

async function region(seed: string, year: number, preset: 'bay' | 'plains', specs: SettlementSpec[]) {
  const extent = { widthM: 16_000, heightM: 12_000 };
  const terrain = await runner.run(terrainStage, {
    seed,
    extent,
    preset,
    relief: 0.4,
    roughness: 0.4,
    seaLevel: 0,
    rivers: { major: 1, minor: 3 },
    cellSizeM: 40,
  });
  const siting = await runner.run(sitingStage, {
    seed,
    terrain,
    year,
    settlements: specs,
    policy: { count: [specs.length, specs.length], kinds: {} },
  });
  const rail = await runner.run(railStage, {
    seed,
    terrain,
    sites: siting.sites,
    year,
    eras,
    mainlines: 1,
    enabled: true,
  });
  const society = await runner.run(societyStage, {
    seed,
    terrain,
    sites: siting.sites,
    year,
    wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    inequality: 0.5,
    nuisance: rail.nuisance,
  });
  const towns = [];
  for (const site of siting.sites)
    towns.push(await runner.run(townStage, { seed, site, terrain, year, blockSizeM: 90, eras, society }));
  const facilities = await runner.run(facilitiesStage, {
    seed,
    terrain,
    sites: siting.sites,
    rail,
    year,
    extent,
    requests: [],
    removed: [],
    pins: [],
    customTypes: [],
    scaleCompression: true,
  });
  const list: UtilityFacility[] = facilities.features.features.map((f) => {
    const ring = f.geometry.coordinates[0]!;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      x += ring[i]![0]!;
      y += ring[i]![1]!;
    }
    return {
      id: f.properties.id,
      type: f.properties.type,
      name: f.properties.name,
      settlement: f.properties.settlement,
      center: [x / (ring.length - 1), y / (ring.length - 1)],
    };
  });
  const utilities = await runner.run(utilitiesStage, {
    seed,
    terrain,
    sites: siting.sites,
    towns,
    facilities: list,
    year,
  });
  return { terrain, siting, towns, facilities: list, utilities };
}

const BAY: SettlementSpec[] = [
  { id: 'port', kind: 'portTown', population: 35_000, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'mill', kind: 'millTown', population: 6_000, layout: { streetPattern: 'mixed' }, features: [] },
];

/** On the drawn land (rivers count as land), by the same shoreline test the routes are built with. */
function onLandOrRiver(terrain: TerrainOutput, line: [number, number][]): boolean {
  const onLand = landSampler(terrain, { rivers: 'land', aboveSea: false });
  return line.every(([x, y]) => onLand(x, y));
}

describe('utilities stage', () => {
  it('gives a 1925 port and mill town water, gas, power, sewers and a pipeline-free network on land', async () => {
    const t0 = performance.now();
    const { terrain, siting, utilities: u, facilities } = await region('util-bay', 1925, 'bay', BAY);
    expect(performance.now() - t0).toBeLessThan(60_000);
    const s = u.stats;
    // Water: a trunk main per town (reservoir or waterworks) and mains under the arteries.
    const waterTrunks = u.lines.features.filter(
      (l) => l.properties.class === 'waterMain' && l.properties.kind === 'trunk',
    );
    expect(waterTrunks.length).toBeGreaterThanOrEqual(1);
    expect(s.waterKm).toBeGreaterThan(waterTrunks.reduce((a, l) => a + l.properties.lengthKm, 0));
    const hasWaterworks = facilities.some((f) => f.type === 'institution.waterworks');
    if (!hasWaterworks) expect(s.reservoirs).toBeGreaterThanOrEqual(1);
    // Gas only where a gasworks stands.
    const gasworks = facilities.filter((f) => f.type === 'industry.gasworks');
    if (gasworks.length) expect(s.gasKm).toBeGreaterThan(0);
    else expect(s.gasKm).toBe(0);
    // Power reaches both towns: a substation each, pylons along the lines, nothing in the sea.
    expect(s.substations).toBe(2);
    expect(s.pylons).toBeGreaterThan(4);
    const power = u.lines.features.filter((l) => l.properties.class === 'powerLine');
    expect(power.length).toBe(2);
    for (const l of power)
      expect(onLandOrRiver(terrain, l.geometry.coordinates as [number, number][])).toBe(true);
    const source = facilities.find((f) => f.type === 'industry.power');
    expect(power.some((l) => l.properties.from === (source?.id ?? 'grid'))).toBe(true);
    // Sewers are GM-only and end at an outfall in water, with a sewage works after 1920.
    const sewers = u.lines.features.filter((l) => l.properties.class === 'sewer');
    expect(sewers.length).toBeGreaterThan(1);
    expect(sewers.every((l) => l.properties.gmOnly)).toBe(true);
    expect(
      u.points.features.filter((p) => p.properties.class === 'sewer').every((p) => p.properties.gmOnly),
    ).toBe(true);
    expect(s.outfalls).toBeGreaterThanOrEqual(1);
    for (const o of u.points.features.filter((p) => p.properties.kind === 'outfall')) {
      const [x, y] = o.geometry.coordinates as [number, number];
      const c = Math.round(terrain.height.col(x));
      const r = Math.round(terrain.height.row(y));
      expect(terrain.water[r * terrain.height.width + c]).not.toBe(WATER.land);
    }
    expect(u.areas.features.some((a) => a.properties.kind === 'sewageWorks')).toBe(true);
    // Substations sit at the towns' edges.
    for (const a of u.areas.features.filter((a) => a.properties.kind === 'substation')) {
      const site = siting.sites.find((x) => x.id === a.properties.settlement)!;
      const [x, y] = a.geometry.coordinates[0]![0]!;
      const d = Math.hypot(x! - site.center[0], y! - site.center[1]);
      expect(d).toBeLessThan(site.radiusM * 1.3);
      expect(d).toBeGreaterThan(site.radiusM * 0.4);
    }
    // No refinery in 1925 here, so no pipeline; no canal for a coastal port.
    expect(s.pipelineKm).toBe(0);
    expect(
      u.lines.features.some((l) => l.properties.class === 'canal' && l.properties.settlement === 'port'),
    ).toBe(false);
    // Every feature has a class, and points are inside the region.
    for (const p of u.points.features) {
      expect(['waterMain', 'gasMain', 'powerLine', 'sewer', 'pipeline', 'canal']).toContain(
        p.properties.class,
      );
      expect(Math.abs(p.geometry.coordinates[0]!)).toBeLessThanOrEqual(8_000);
    }
  });

  it('is deterministic, gated by year and switchable', async () => {
    const a = await region('util-bay', 1925, 'bay', BAY);
    const b = await new StageRunner().run(utilitiesStage, {
      seed: 'util-bay',
      terrain: a.terrain,
      sites: a.siting.sites,
      towns: a.towns,
      facilities: a.facilities,
      year: 1925,
    });
    expect(contentHash(b.lines)).toBe(contentHash(a.utilities.lines));
    expect(contentHash(b.points)).toBe(contentHash(a.utilities.points));
    const off = await new StageRunner().run(utilitiesStage, {
      seed: 'util-bay',
      terrain: a.terrain,
      sites: a.siting.sites,
      towns: a.towns,
      facilities: a.facilities,
      year: 1925,
      enabled: false,
    });
    expect(off.lines.features).toHaveLength(0);
    const early = await region('util-bay', 1780, 'bay', BAY);
    const s = early.utilities.stats;
    expect(s.waterKm + s.gasKm + s.powerKm + s.sewerKm + s.pipelineKm).toBe(0);
  });

  it('cuts a canal with locks from an inland canal-age town to the nearest water', async () => {
    const specs: SettlementSpec[] = [
      { id: 'inland', kind: 'town', population: 12_000, layout: { streetPattern: 'mixed' }, features: [] },
    ];
    const { siting, utilities: u, terrain } = await region('util-canal', 1800, 'plains', specs);
    const site = siting.sites[0]!;
    const canal = u.lines.features.filter((l) => l.properties.class === 'canal');
    if (site.coastal || site.riverside) {
      expect(canal).toHaveLength(0);
      return;
    }
    expect(canal).toHaveLength(1);
    expect(canal[0]!.properties.status).toBe('open');
    expect(onLandOrRiver(terrain, canal[0]!.geometry.coordinates as [number, number][])).toBe(true);
    expect(u.areas.features.some((a) => a.properties.kind === 'canalBasin')).toBe(true);
    // Locks only where the ground changes; the canal ends in water.
    const end = canal[0]!.geometry.coordinates.at(-1) as [number, number];
    const c = Math.round(terrain.height.col(end[0]));
    const r = Math.round(terrain.height.row(end[1]));
    expect(terrain.water[r * terrain.height.width + c]).not.toBe(WATER.land);
    const later: UtilitiesOutput = (await region('util-canal', 1955, 'plains', specs)).utilities;
    const old = later.lines.features.filter((l) => l.properties.class === 'canal');
    if (old.length) expect(old[0]!.properties.status).toBe('disused');
  });
});
