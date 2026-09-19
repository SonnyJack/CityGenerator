import { describe, expect, it } from 'vitest';
import {
  StageRunner,
  contentHash,
  customFeatureType,
  customFeatureTypeSchema,
  defaultRequests,
  defaultsWithYears,
  BROWNFIELD_YEARS,
  facilitiesStage,
  featureTypeMap,
  frameRing,
  pointInRing,
  railStage,
  sitingStage,
  terrainStage,
  townStage,
  societyStage,
  FEATURE_TYPES,
  Rng,
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
  era('e1925', 1925, true, true),
  era('e2020', 2020, true, true),
];

const runner = new StageRunner();
async function bay(seed: string, year: number) {
  const terrain = await runner.run(terrainStage, {
    seed,
    extent: { widthM: 16_000, heightM: 12_000 },
    preset: 'bay',
    relief: 0.4,
    roughness: 0.4,
    seaLevel: 0,
    rivers: { major: 1, minor: 3 },
    cellSizeM: 40,
  });
  const specs: SettlementSpec[] = [
    { id: 'port', kind: 'portTown', population: 35_000, layout: { streetPattern: 'mixed' }, features: [] },
    { id: 'mill', kind: 'millTown', population: 3_000, layout: { streetPattern: 'mixed' }, features: [] },
  ];
  const siting = await runner.run(sitingStage, {
    seed,
    terrain,
    year,
    settlements: specs,
    policy: { count: [2, 2], kinds: {} },
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
  const facilities = await runner.run(facilitiesStage, {
    seed,
    terrain,
    sites: siting.sites,
    rail,
    year,
    extent: { widthM: 16_000, heightM: 12_000 },
    requests: [],
    removed: [],
    pins: [],
    customTypes: [],
    scaleCompression: true,
  });
  return { terrain, siting, rail, facilities };
}

describe('placement engine', () => {
  it('places a break-bulk port with rail on the quay, a yard behind it, gasworks and warehouses at a 1925 bay port on most seeds', async () => {
    let hits = 0;
    const seeds = ['bay-1', 'bay-2', 'bay-3', 'bay-4', 'bay-5'];
    for (const seed of seeds) {
      const { facilities, rail } = await bay(seed, 1925);
      const port = facilities.features.features.find(
        (f) => f.properties.type === 'port' && f.properties.settlement === 'port',
      );
      if (!port) continue;
      const parts = facilities.parts.features.filter((p) => p.properties.feature === port.properties.id);
      const kinds = new Set(parts.map((p) => p.properties.kind));
      const gas = facilities.features.features.some((f) => f.properties.type === 'industry.gasworks');
      const yard = rail.structures.features.some(
        (s) => s.properties.kind === 'goodsYard' || s.properties.kind === 'railYard',
      );
      const quaySiding = parts.some((p) => p.properties.kind === 'track');
      if (kinds.has('quay') && kinds.has('shed') && kinds.has('crane') && quaySiding && gas && yard) hits++;
      // The port is compressed and reports both scales.
      expect(port.properties.compression).toBeLessThan(1);
      expect(port.properties.realLengthM).toBeGreaterThan(port.properties.lengthM);
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('replaces the quay with a container terminal in 2020 and keeps every facility on its own land', async () => {
    const { facilities } = await bay('bay-1', 2020);
    const port = facilities.features.features.find((f) => f.properties.type === 'port')!;
    const kinds = new Set(
      facilities.parts.features
        .filter((p) => p.properties.feature === port.properties.id)
        .map((p) => p.properties.kind),
    );
    expect(kinds.has('containerYard')).toBe(true);
    expect(kinds.has('berth')).toBe(true);
    expect(kinds.has('breakwater')).toBe(true);
    expect(facilities.features.features.some((f) => f.properties.type === 'industry.logistics')).toBe(true);
    expect(facilities.features.features.some((f) => f.properties.type === 'industry.gasworks')).toBe(false);
    // No two footprints overlap (centre of one inside another).
    const rings = facilities.features.features.map((f) =>
      f.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]),
    );
    for (let i = 0; i < rings.length; i++)
      for (let j = 0; j < rings.length; j++) {
        if (i === j) continue;
        const c = facilities.features.features[i]!;
        const cx = c.properties ? rings[i]!.reduce((a, p) => a + p[0], 0) / rings[i]!.length : 0;
        const cy = rings[i]!.reduce((a, p) => a + p[1], 0) / rings[i]!.length;
        const inside = (x: number, y: number, ring: [number, number][]) => {
          let ok = false;
          for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
            const [xi, yi] = ring[k]!;
            const [xj, yj] = ring[l]!;
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
          }
          return ok;
        };
        expect(inside(cx, cy, rings[j]!)).toBe(false);
      }
    expect(facilities.stats.placed).toBeGreaterThan(5);
  }, 120_000);

  it('connects rail-served facilities with spurs, towns reserve the land, and it is deterministic', async () => {
    const { terrain, siting, rail, facilities } = await bay('bay-2', 1925);
    expect(facilities.spurs.features.length).toBeGreaterThan(0);
    expect(facilities.roads.features.length).toBeGreaterThan(0);
    // Spurs reach the works; inside the grounds they run on as private sidings along the sheds.
    for (const s of facilities.spurs.features) expect(['spur', 'siding']).toContain(s.properties.class);
    const sidings = facilities.spurs.features.filter((s) => s.properties.class === 'siding');
    expect(sidings.length).toBeGreaterThan(0);
    for (const s of sidings) {
      const owner = s.properties.from;
      const works = facilities.features.features.find((f) => f.properties.id === owner)!;
      expect(works.properties.category === 'industry' || works.properties.category === 'transport').toBe(
        true,
      );
      // A siding lies inside its works and is shorter than the works is long.
      const ring = works.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
      for (const c of s.geometry.coordinates) expect(pointInRing(c[0]!, c[1]!, ring)).toBe(true);
      expect(s.properties.lengthKm * 1000).toBeLessThan(works.properties.lengthM);
      expect(s.properties.opened).toBeGreaterThanOrEqual(1830);
    }
    const site = siting.sites.find((s) => s.id === 'port')!;
    const society = await runner.run(societyStage, {
      seed: 'bay-2',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
      nuisance: [...rail.nuisance, ...facilities.nuisance],
    });
    const town = await runner.run(townStage, {
      seed: 'bay-2',
      site,
      terrain,
      year: 1925,
      blockSizeM: 90,
      eras,
      society,
      reserved: facilities.reserved,
    });
    const reservedPatches = town.patches.features.filter((p) =>
      ['port', 'industrial', 'institution', 'campus', 'cemetery', 'airfield'].includes(p.properties.ward),
    );
    expect(reservedPatches.length).toBeGreaterThan(0);
    for (const p of reservedPatches) expect(p.properties.why).toContain('land taken by');
    // Reserved patches have no blocks.
    const reservedIds = new Set(reservedPatches.map((p) => p.id));
    for (const b of town.blocks)
      expect(reservedIds.has(`${site.id}-patch-${b.id.split('-b')[1]}`)).toBe(false);
    const again = await new StageRunner().run(facilitiesStage, {
      seed: 'bay-2',
      terrain,
      sites: siting.sites,
      rail,
      year: 1925,
      extent: { widthM: 16_000, heightM: 12_000 },
      requests: [],
      removed: [],
      pins: [],
      customTypes: [],
      scaleCompression: true,
    });
    expect(contentHash({ f: again.features, p: again.parts })).toBe(
      contentHash({ f: facilities.features, p: facilities.parts }),
    );
  }, 120_000);

  it('honours pins and removals, reports failures, and accepts custom feature types', async () => {
    const { terrain, siting, rail } = await bay('bay-3', 1925);
    const port = siting.sites.find((s) => s.id === 'port')!;
    const custom = customFeatureTypeSchema.parse({
      id: 'custom.cannery',
      name: 'Cannery',
      footprintM: [80, 50],
      orientation: 'alignRadial',
      placement: { maxSlope: 0.1 },
      parts: [
        { shape: 'rect', kind: 'building', u: 0, v: 0, lengthM: 50, widthM: 30, floors: 2, name: 'Cannery' },
        { shape: 'point', kind: 'chimney', u: 30, v: 0 },
      ],
    });
    const out = await runner.run(facilitiesStage, {
      seed: 'bay-3',
      terrain,
      sites: siting.sites,
      rail,
      year: 1925,
      extent: { widthM: 16_000, heightM: 12_000 },
      requests: [
        { id: 'cannery', type: 'custom.cannery', size: 'medium', settlement: 'port' },
        { id: 'too-early', type: 'harbour.marina', size: 'medium', settlement: 'port' },
        { id: 'nowhere', type: 'industry.mill', size: 'medium', settlement: 'port' },
      ],
      removed: ['port:institution.cemetery'],
      pins: [
        {
          target: 'port:institution.hospital',
          x: port.center[0] + 900,
          y: port.center[1] + 400,
          rotation: 0.3,
        },
      ],
      customTypes: [custom],
      scaleCompression: true,
    });
    expect(out.features.features.some((f) => f.properties.type === 'custom.cannery')).toBe(true);
    // An explicit request opens with its type, no earlier than its host's founding, and never in the future.
    const cannery = out.features.features.find((f) => f.properties.type === 'custom.cannery')!;
    expect(cannery.properties.opened).toBe(Math.max(customFeatureType(custom).years[0], port.founded));
    expect(cannery.properties.opened).toBeLessThanOrEqual(1925);
    expect(cannery.properties.closed).toBeUndefined();
    expect(
      out.parts.features.some((p) => p.properties.feature === 'cannery' && p.properties.kind === 'chimney'),
    ).toBe(true);
    expect(out.features.features.some((f) => f.properties.id === 'port:institution.cemetery')).toBe(false);
    expect(out.features.features.some((f) => f.properties.id === 'mill:institution.cemetery')).toBe(true);
    const hospital = out.features.features.find((f) => f.properties.id === 'port:institution.hospital')!;
    expect(hospital.properties.pinned).toBe(true);
    const ring = frameRing({
      center: [port.center[0] + 900, port.center[1] + 400],
      axis: [Math.cos(0.3), Math.sin(0.3)],
      lengthM: hospital.properties.lengthM,
      widthM: hospital.properties.widthM,
    });
    expect(hospital.geometry.coordinates[0]![0]![0]).toBeCloseTo(ring[0]![0], 3);
    expect(out.failures.some((f) => f.id === 'too-early' && /not built in 1925/.test(f.reason))).toBe(true);
    expect(out.failures.every((f) => f.reason.length > 10)).toBe(true);
    expect(customFeatureType(custom).footprint('large', { population: 0, year: 1925 })[0]).toBeCloseTo(128);
  }, 120_000);

  it('fills the free ground of a works or a port with sheds that stay inside and off the other parts', async () => {
    const { facilities } = await bay('bay-fill', 1925);
    const sheds = facilities.parts.features.filter((p) => p.properties.kind === 'shed' && p.properties.name);
    expect(sheds.length).toBeGreaterThan(0);
    const fills = sheds.filter((p) =>
      ['store', 'shed', 'workshop', 'office'].includes(String(p.properties.name)),
    );
    expect(fills.length).toBeGreaterThan(0);
    for (const shed of fills) {
      const owner = facilities.features.features.find((f) => f.properties.id === shed.properties.feature)!;
      const ring = owner.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
      const corners = (shed.geometry as { coordinates: number[][][] }).coordinates[0]!;
      for (const c of corners.slice(0, 4)) expect(pointInRing(c[0]!, c[1]!, ring)).toBe(true);
      // Its centre is not inside any other polygon part of the same facility.
      const cx = corners.slice(0, 4).reduce((a, c) => a + c[0]! / 4, 0);
      const cy = corners.slice(0, 4).reduce((a, c) => a + c[1]! / 4, 0);
      for (const other of facilities.parts.features) {
        if (other === shed || other.properties.feature !== shed.properties.feature) continue;
        if (other.geometry.type !== 'Polygon') continue;
        const r = other.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]);
        expect(pointInRing(cx, cy, r)).toBe(false);
      }
    }
  });

  it("dates each default from its host's growth and keeps a closed works as a brownfield for forty years", async () => {
    const { facilities: f1985, siting } = await bay('bay-years', 1985);
    const byId = new Map(f1985.features.features.map((f) => [f.properties.id, f.properties]));
    const port = siting.sites.find((s) => s.id === 'port')!;
    // The gasworks type ended in 1970: at 1985 it is still on the map, closed in its last year,
    // drawn with the parts of that year, and its land still reserved.
    const gas = byId.get('port:industry.gasworks')!;
    expect(gas.closed).toBe(1970);
    expect(gas.opened).toBeGreaterThanOrEqual(1815);
    expect(gas.opened).toBeLessThan(1970);
    expect(f1985.reserved.some((r) => r.id === 'port:industry.gasworks')).toBe(true);
    expect(f1985.parts.features.some((p) => p.properties.feature === 'port:industry.gasworks')).toBe(true);
    // Open facilities carry no closing year, and open no earlier than their host or their type.
    for (const [id, p] of byId) {
      expect(p.opened).toBeGreaterThanOrEqual(port.founded);
      expect(p.opened).toBeLessThanOrEqual(1985);
      const t = FEATURE_TYPES.find((x) => x.id === p.type)!;
      expect(p.opened).toBeGreaterThanOrEqual(t.years[0]);
      if (p.closed === undefined) expect(id).not.toContain('gasworks');
      else expect(p.closed).toBeLessThanOrEqual(t.years[1]);
    }
    // A modern default opened when the town's growth first asked for it, well after the type's first year.
    const logistics = byId.get('port:industry.logistics')!;
    expect(logistics.opened).toBeGreaterThanOrEqual(1965);
    // The replay is on an absolute grid: the same host at a later year gives the same opening years.
    const years = defaultsWithYears(port, 2020, featureTypeMap([]));
    const gas2020 = years.find((r) => r.id === 'port:industry.gasworks');
    expect(gas2020).toBeUndefined();
    for (const r of years) {
      const was = byId.get(r.id);
      if (was && was.closed === undefined) expect(r.opened).toBe(was.opened);
    }
    expect(years.find((r) => r.id === 'port:institution.asylum')?.closed).toBe(1990);
    expect(BROWNFIELD_YEARS).toBe(40);
  });

  it('defaults follow kind, size and year; every built-in type lays out parts inside its footprint', () => {
    const site = {
      id: 'x',
      kind: 'portTown',
      population: 40_000,
      center: [0, 0] as [number, number],
      radiusM: 1000,
      founded: 1250,
      spec: {
        id: 'x',
        kind: 'portTown',
        population: 40_000,
        layout: { streetPattern: 'mixed' },
        features: [],
      },
      coastal: true,
      riverside: true,
    } as const;
    const d1925 = defaultRequests(site as never, 1925).map((r) => r.type);
    expect(d1925).toContain('port');
    expect(d1925).toContain('industry.gasworks');
    expect(d1925).toContain('institution.hospital');
    const d1500 = defaultRequests(site as never, 1500).map((r) => r.type);
    expect(d1500).not.toContain('industry.gasworks');
    expect(d1500).toContain('industry.mill');
    const d2020 = defaultRequests(site as never, 2020).map((r) => r.type);
    expect(d2020).toContain('industry.logistics');
    expect(d2020).not.toContain('industry.gasworks');
    for (const t of FEATURE_TYPES) {
      for (const year of [t.years[0], Math.min(t.years[1], 2020)]) {
        const [L, W] = t.footprint('medium', { population: 50_000, year });
        const parts = t.layout({
          size: 'medium',
          year,
          lengthM: L,
          widthM: W,
          compression: 1,
          rng: new Rng(`layout/${t.id}`),
          host: null,
          front: 'sea',
        });
        expect(parts.length, t.id).toBeGreaterThan(0);
        for (const p of parts) {
          if (p.shape === 'rect' || p.shape === 'circle' || p.shape === 'point') {
            expect(Math.abs(p.u), `${t.id} ${p.kind}`).toBeLessThanOrEqual(L / 2 + 60);
            expect(Math.abs(p.v), `${t.id} ${p.kind}`).toBeLessThanOrEqual(W / 2 + 200);
          }
        }
      }
    }
  });
});
