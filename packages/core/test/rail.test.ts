import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  contentHash,
  populationAt,
  railServiceThreshold,
  railStage,
  sitingStage,
  terrainStage,
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
export const TEST_ERAS: EraParams[] = [
  era('e1400', 1400, false, false),
  era('e1850', 1850, true, false),
  era('e1890', 1890, true, true),
  era('e1925', 1925, true, true),
  era('e1985', 1985, true, false),
];

const runner = new StageRunner();
const hills = runner.run(terrainStage, {
  seed: 'rail-hills',
  extent: { widthM: 24_000, heightM: 18_000 },
  preset: 'hills',
  relief: 0.7,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 3 },
  cellSizeM: 50,
});
const specs: SettlementSpec[] = [
  { id: 'metro', kind: 'metropolis', population: 250_000, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'port', kind: 'portTown', population: 9_000, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'mill', kind: 'millTown', population: 3_500, layout: { streetPattern: 'mixed' }, features: [] },
  { id: 'v1', kind: 'village', population: 700, layout: { streetPattern: 'organic' }, features: [] },
  { id: 'v2', kind: 'village', population: 900, layout: { streetPattern: 'organic' }, features: [] },
];
const sitingP = hills.then((terrain) =>
  runner.run(sitingStage, {
    seed: 'rail-hills',
    terrain,
    year: 1925,
    settlements: specs,
    policy: { count: [3, 8], kinds: {} },
  }),
);
const railP = Promise.all([hills, sitingP]).then(([terrain, siting]) =>
  runner.run(railStage, {
    seed: 'rail-hills',
    terrain,
    sites: siting.sites,
    year: 1925,
    eras: TEST_ERAS,
    mainlines: 2,
    enabled: true,
  }),
);

describe('rail stage', () => {
  it('keeps every track within its ruling gradient on a hills preset', async () => {
    const rail = await railP;
    expect(rail.tracks.features.length).toBeGreaterThan(20);
    const caps = {
      mainline: 0.02,
      branch: 0.03,
      spur: 0.035,
      yard: 0.01,
      disused: 0.03,
      junction: 0.02,
      siding: 0.01,
    };
    for (const t of rail.tracks.features)
      expect(t.properties.gradient).toBeLessThanOrEqual(caps[t.properties.class] + 1e-6);
    expect(rail.stats.maxGradient).toBeLessThanOrEqual(0.035 + 1e-6);
    // Hills force engineering: some cuttings, tunnels and viaducts, but mostly surface running.
    const modes = new Set(rail.tracks.features.map((t) => t.properties.mode));
    expect(modes.has('tunnel')).toBe(true);
    expect(modes.has('viaduct')).toBe(true);
    expect(rail.portals.features.length).toBe(rail.stats.tunnels * 2);
    expect(rail.stats.minRadiusM).toBeGreaterThan(120);
    // Junction geometry: a station where two lines meet gets a crossover between the platform
    // roads; where three meet after 1900 a connecting curve is carried over on a viaduct.
    const junctions = rail.tracks.features.filter((t) => t.properties.class === 'junction');
    expect(junctions.length).toBe(rail.stats.crossovers + rail.stats.flyovers);
    expect(rail.stats.crossovers).toBeGreaterThan(0);
    for (const j of junctions) {
      expect(j.properties.lengthKm).toBeLessThan(1.6);
      expect(j.properties.opened).toBeGreaterThanOrEqual(1850);
      if (j.properties.mode === 'viaduct') expect(j.properties.opened).toBeGreaterThanOrEqual(1900);
      // A junction sits at the throat of the station it serves.
      const st = rail.stations.features.find(
        (s) => s.properties.settlement === j.properties.line.split('-')[0],
      );
      if (st) {
        const [sx, sy] = st.geometry.coordinates as [number, number];
        const near = j.geometry.coordinates.some((c) => Math.hypot(c[0]! - sx, c[1]! - sy) < 1_100);
        expect(near).toBe(true);
      }
    }
  });

  it('gives a 1925 metropolis a central station, suburban stations, a goods yard and a marshalling yard whose ladders join the line at both throats', async () => {
    const rail = await railP;
    const st = rail.stations.features;
    expect(st.some((s) => s.properties.kind === 'central' && s.properties.settlement === 'metro')).toBe(true);
    expect(
      st.filter((s) => s.properties.kind === 'suburban' && s.properties.settlement === 'metro').length,
    ).toBeGreaterThan(2);
    expect(st.some((s) => s.properties.kind === 'central' && s.properties.settlement === 'port')).toBe(true);
    expect(st.some((s) => s.properties.kind === 'halt')).toBe(true);
    const kinds = rail.structures.features.map((s) => s.properties.kind);
    expect(kinds).toContain('goodsYard');
    expect(kinds).toContain('railYard');
    expect(kinds).toContain('roundhouse');
    expect(kinds).toContain('turntable');
    expect(rail.stats.yards).toBeGreaterThanOrEqual(1);
    // Yard ladders start and end on the host line.
    const yard = rail.tracks.features.filter((t) => t.properties.class === 'yard');
    expect(yard.length).toBeGreaterThanOrEqual(4);
    const hostPts = rail.tracks.features
      .filter(
        (t) =>
          t.properties.class !== 'yard' && t.properties.class !== 'spur' && t.properties.class !== 'junction',
      )
      .flatMap((t) => t.geometry.coordinates);
    const onLine = (p: number[]) => hostPts.some((q) => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) < 30);
    for (const y of yard) {
      const c = y.geometry.coordinates;
      expect(onLine(c[0]!)).toBe(true);
      expect(onLine(c[c.length - 1]!)).toBe(true);
    }
    // Port gets a dock spur; the metropolis an industrial spur; the core goes underground.
    const port = (await sitingP).sites.find((s) => s.id === 'port')!;
    expect(rail.tracks.features.some((t) => t.properties.line === 'port-docks')).toBe(port.coastal);
    expect(rail.tracks.features.some((t) => t.properties.line === 'metro-industry')).toBe(true);
    expect(rail.tracks.features.some((t) => t.properties.mode === 'subway')).toBe(true);
    expect(rail.nuisance.length).toBeGreaterThan(10);
    expect(rail.stats.trackKm).toBeGreaterThan(50);
  });

  it('runs a dock spur to the shore of a coastal port', async () => {
    const terrain = await runner.run(terrainStage, {
      seed: 'rail-coast',
      extent: { widthM: 16_000, heightM: 12_000 },
      preset: 'coast',
      relief: 0.4,
      roughness: 0.4,
      seaLevel: 0,
      rivers: { major: 1, minor: 2 },
      cellSizeM: 40,
    });
    const siting = await runner.run(sitingStage, {
      seed: 'rail-coast',
      terrain,
      year: 1925,
      settlements: [
        {
          id: 'port',
          kind: 'portTown',
          population: 12_000,
          layout: { streetPattern: 'mixed' },
          features: [],
        },
        { id: 'inland', kind: 'town', population: 4_000, layout: { streetPattern: 'mixed' }, features: [] },
      ],
      policy: { count: [2, 2], kinds: {} },
    });
    const port = siting.sites.find((s) => s.id === 'port')!;
    expect(port.coastal).toBe(true);
    const rail = await runner.run(railStage, {
      seed: 'rail-coast',
      terrain,
      sites: siting.sites,
      year: 1925,
      eras: TEST_ERAS,
      mainlines: 1,
      enabled: true,
    });
    const docks = rail.tracks.features.filter((t) => t.properties.line === 'port-docks');
    expect(docks.length).toBeGreaterThan(0);
    const end = docks[docks.length - 1]!.geometry.coordinates.at(-1)!;
    const { height, distToSea } = terrain;
    const c = Math.round(height.col(end[0]!));
    const r = Math.round(height.row(end[1]!));
    expect(distToSea[r * height.width + c]!).toBeLessThan(400);
  });

  it('has no rail before the railway age, closes branches after 1965, and is deterministic', async () => {
    const terrain = await hills;
    const siting = await sitingP;
    const none = await runner.run(railStage, {
      seed: 'x',
      terrain,
      sites: siting.sites,
      year: 1650,
      eras: TEST_ERAS,
      mainlines: 1,
      enabled: true,
    });
    expect(none.tracks.features).toHaveLength(0);
    const off = await runner.run(railStage, {
      seed: 'x',
      terrain,
      sites: siting.sites,
      year: 1925,
      eras: TEST_ERAS,
      mainlines: 1,
      enabled: false,
    });
    expect(off.tracks.features).toHaveLength(0);
    const late = await runner.run(railStage, {
      seed: 'x',
      terrain,
      sites: siting.sites,
      year: 1985,
      eras: TEST_ERAS,
      mainlines: 1,
      enabled: true,
    });
    expect(late.tracks.features.some((t) => t.properties.class === 'disused')).toBe(true);
    expect(late.stations.features.filter((s) => s.properties.closed).length).toBeGreaterThan(0);
    // Every line carries the year it opened (not before the railway age, not after the map's
    // year); a disused line closed after it opened, once the 1965 threshold rose; a closed
    // station closed with its last line, and open stations carry no closing year.
    for (const t of late.tracks.features) {
      expect(t.properties.opened).toBeGreaterThanOrEqual(1850);
      expect(t.properties.opened).toBeLessThanOrEqual(1985);
      if (t.properties.class === 'disused') {
        expect(t.properties.closed).toBeGreaterThan(t.properties.opened);
        expect(t.properties.closed).toBeGreaterThanOrEqual(1965);
      } else expect(t.properties.closed).toBeUndefined();
    }
    const lineYears = new Map(late.tracks.features.map((t) => [t.properties.line, t.properties]));
    for (const st of late.stations.features) {
      expect(st.properties.opened).toBeGreaterThanOrEqual(1850);
      if (st.properties.closed) {
        expect(st.properties.closedYear).toBeGreaterThanOrEqual(1965);
        const line = lineYears.get(st.properties.line);
        if (line?.closed !== undefined) expect(st.properties.closedYear).toBe(line.closed);
      } else expect(st.properties.closedYear).toBeUndefined();
    }
    // The mainline through the hub opened with the railway age; a branch to a village later.
    const opened = late.tracks.features.map((t) => t.properties.opened);
    expect(Math.min(...opened)).toBe(1850);
    expect(Math.max(...opened)).toBeGreaterThan(1850);
    const early = await railP;
    const earlyByLine = new Map(early.tracks.features.map((t) => [t.properties.line, t.properties.opened]));
    for (const [line, y] of lineYears)
      if (earlyByLine.has(line)) expect(earlyByLine.get(line)).toBe(y.opened);
    expect(
      late.structures.features.some(
        (s) => s.properties.kind === 'depot' || s.properties.kind === 'intermodal',
      ),
    ).toBe(true);
    expect(late.structures.features.some((s) => s.properties.kind === 'roundhouse')).toBe(false);
    expect(railServiceThreshold(1985).active).toBeGreaterThan(railServiceThreshold(1925).active);
    // A village that only reaches the served threshold after the closures never had a train:
    // no line, disused or otherwise, and no station.
    const lateSiting = await runner.run(sitingStage, {
      seed: 'rail-hills',
      terrain,
      year: 2020,
      settlements: [
        ...specs,
        { id: 'tiny', kind: 'village', population: 600, layout: { streetPattern: 'organic' }, features: [] },
      ],
      policy: { count: [3, 8], kinds: {} },
    });
    const tiny = lateSiting.sites.find((s) => s.id === 'tiny')!;
    const railServiceEver = [...Array(31)].some(
      (_, k) => populationAt(tiny.history, 1850 + k * 5) >= railServiceThreshold(1850 + k * 5).active,
    );
    expect(railServiceEver).toBe(false);
    const modern = await runner.run(railStage, {
      seed: 'x',
      terrain,
      sites: lateSiting.sites,
      year: 2020,
      eras: TEST_ERAS,
      mainlines: 1,
      enabled: true,
    });
    expect(modern.stations.features.some((st) => st.properties.settlement === 'tiny')).toBe(false);
    expect(
      modern.tracks.features.some((t) => t.properties.from === 'tiny' || t.properties.to === 'tiny'),
    ).toBe(false);
    const a = await railP;
    const b = await new StageRunner().run(railStage, {
      seed: 'rail-hills',
      terrain,
      sites: siting.sites,
      year: 1925,
      eras: TEST_ERAS,
      mainlines: 2,
      enabled: true,
    });
    expect(contentHash({ t: b.tracks, s: b.stations, x: b.structures })).toBe(
      contentHash({ t: a.tracks, s: a.stations, x: a.structures }),
    );
  });
});
