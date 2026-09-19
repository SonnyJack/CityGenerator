import { describe, expect, it } from 'vitest';
import {
  contentHash,
  generateBlock,
  peakUntil,
  populationAt,
  radiusAt,
  sitingStage,
  societyStage,
  StageRunner,
  terrainStage,
  townStage,
  yearForRadius,
  type EraParams,
  type SettlementSpec,
  type TerrainInput,
} from '../src/index.js';

const terrainFixture: TerrainInput = {
  seed: 'timeline-fixture',
  extent: { widthM: 14_000, heightM: 10_000 },
  preset: 'bay',
  relief: 0.35,
  roughness: 0.4,
  seaLevel: 0,
  rivers: { major: 1, minor: 2 },
  cellSizeM: 40,
};

const era = (id: string, year: number, ringPattern: EraParams['ringPattern'], ring: number): EraParams => ({
  id,
  year,
  name: id,
  ringPattern,
  blockSizeM: { core: 90, ring },
  streetWidthM: { arterial: 14, collector: 10, local: 7, lane: 4 },
  densityPerKm2: 8000,
  transport: {
    horse: year < 1900,
    tram: year >= 1890 && year < 1955,
    rail: year >= 1850,
    car: year >= 1925,
    motorway: year >= 1955,
    container: year >= 1985,
  },
  walls: year < 1700,
});
const eras: EraParams[] = [
  era('medieval', 1100, 'organic', 90),
  era('renaissance', 1650, 'organic', 90),
  era('georgian', 1780, 'grid', 110),
  era('victorian', 1850, 'grid', 100),
  era('gaslight', 1890, 'streetcar', 100),
  era('classic', 1925, 'streetcar', 110),
  era('postwar', 1955, 'suburban', 130),
  era('late', 1985, 'culDeSac', 150),
];

const runner = new StageRunner();
const terrainP = runner.run(terrainStage, terrainFixture);

async function townAt(
  year: number,
  specs: SettlementSpec[],
  anchorYear = 1925,
  seed = 't',
  yearEdits?: { id: string; field: 'year'; points: [number, number][]; radiusM: number; delta: number }[],
) {
  const terrain = await terrainP;
  const siting = await runner.run(sitingStage, {
    seed,
    terrain,
    year,
    anchorYear,
    settlements: specs,
    policy: { count: [1, 1], kinds: {} },
  });
  const site = siting.sites[0]!;
  // Zoning uses a society fixed at the anchor year so it does not drift with the slider.
  const anchorSite = (
    await runner.run(sitingStage, {
      seed,
      terrain,
      year: anchorYear,
      anchorYear,
      settlements: specs,
      policy: { count: [1, 1], kinds: {} },
    })
  ).sites[0]!;
  const society = await runner.run(societyStage, {
    seed,
    terrain,
    sites: [anchorSite],
    year: anchorYear,
    wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
    inequality: 0.5,
  });
  const town = await runner.run(townStage, {
    seed,
    site,
    terrain,
    year,
    blockSizeM: 90,
    eras,
    society,
    ...(yearEdits ? { yearEdits } : {}),
  });
  return { site, town };
}

const city: SettlementSpec[] = [
  {
    id: 'arkham',
    kind: 'city',
    population: 20_000,
    founded: 1300,
    layout: { streetPattern: 'mixed' },
    features: [],
  },
];

describe('the year brush', () => {
  it('moves the built year of the ground it passes, and leaves the rest alone', async () => {
    const plain = await townAt(1925, city);
    const centre = plain.site.center;
    // A stroke across a band north of the centre, making that quarter fifty years older.
    const stroke = {
      id: 'year-1',
      field: 'year' as const,
      points: [
        [centre[0] - 400, centre[1] + 300],
        [centre[0] + 400, centre[1] + 300],
      ] as [number, number][],
      radiusM: 250,
      delta: -50,
    };
    const edited = await townAt(1925, city, 1925, 't', [stroke]);
    const before = new Map(plain.town.blocks.map((b) => [b.id, b.builtYear]));
    let moved = 0;
    let untouched = 0;
    for (const b of edited.town.blocks) {
      const was = before.get(b.id);
      if (was === undefined) continue;
      const c = [
        b.ring.reduce((a, p) => a + p[0], 0) / b.ring.length,
        b.ring.reduce((a, p) => a + p[1], 0) / b.ring.length,
      ];
      const near =
        Math.abs(c[1]! - (centre[1] + 300)) < 120 && c[0]! > centre[0] - 400 && c[0]! < centre[0] + 400;
      if (near && b.builtYear !== was) {
        moved++;
        // Earlier, never before the town was founded.
        expect(b.builtYear).toBeLessThan(was!);
        expect(b.builtYear).toBeGreaterThanOrEqual(1300);
      }
      const far = Math.hypot(c[0]! - centre[0], c[1]! - (centre[1] + 300)) > 700;
      if (far) {
        expect(b.builtYear).toBe(was);
        untouched++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(untouched).toBeGreaterThan(0);
  });
});

describe('settlement history', () => {
  const h = { founded: 1300, anchorYear: 1925, anchorPopulation: 20_000 };
  it('anchors the population curve and grows the radius monotonically', () => {
    expect(populationAt(h, 1925)).toBe(20_000);
    expect(populationAt(h, 1300)).toBeLessThan(2000);
    expect(populationAt(h, 1780)).toBeLessThan(populationAt(h, 1850));
    expect(populationAt(h, 2020)).toBeGreaterThan(20_000);
    let prev = 0;
    for (let y = 1300; y <= 2100; y += 25) {
      const r = radiusAt(h, y);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(yearForRadius(h, radiusAt(h, 1850), 1300, 1925)).toBeLessThanOrEqual(1850);
  });
  it('interpolates explicit growth points and tracks the peak through a decline', () => {
    const decline = { ...h, anchorPopulation: 1500, points: [{ year: 1900, population: 5000 }] };
    expect(populationAt(decline, 1900)).toBe(5000);
    expect(populationAt(decline, 1925)).toBe(1500);
    expect(populationAt(decline, 1912)).toBeGreaterThan(1500);
    expect(populationAt(decline, 1912)).toBeLessThan(5000);
    expect(peakUntil(decline, 1925)).toEqual({ population: 5000, year: 1900 });
    // Towns do not shrink: the radius holds at the peak.
    expect(radiusAt(decline, 1925)).toBeGreaterThanOrEqual(radiusAt(decline, 1900));
  });
});

describe('one seed, one history', () => {
  it('grows without re-rolling what already stands from 1850 to 2020', async () => {
    const years = [1850, 1890, 1925, 1955, 2020];
    const towns = await Promise.all(years.map((y) => townAt(y, city)));
    const hashRing = (b: { ring: [number, number][] }) => contentHash(b.ring);
    for (let i = 1; i < towns.length; i++) {
      const before = towns[i - 1]!.town;
      const after = towns[i]!.town;
      expect(after.blocks.length).toBeGreaterThan(before.blocks.length);
      const afterById = new Map(after.blocks.map((b) => [b.id, b]));
      // Every earlier block is still there, with the same outline and the same built year.
      for (const b of before.blocks) {
        const later = afterById.get(b.id);
        expect(later, `${b.id} vanished between ${years[i - 1]} and ${years[i]}`).toBeDefined();
        expect(hashRing(later!), `${b.id} changed shape between ${years[i - 1]} and ${years[i]}`).toBe(
          hashRing(b),
        );
        expect(later!.builtYear).toBe(b.builtYear);
        expect(later!.originalWard).toBe(b.originalWard);
      }
      // Streets likewise: nothing built disappears, nothing moves.
      const streetsAfter = new Map(
        after.streets.features.map((f) => [String(f.id), contentHash(f.geometry)]),
      );
      for (const f of before.streets.features) {
        if (f.properties.class === 'road') continue; // rural roads give way to the rings
        const id = String(f.id);
        // The ring road moves out to the newest ring; ring arteries lengthen; everything else stays put.
        if (f.properties.class === 'motorway') continue;
        const laterHash = streetsAfter.get(id);
        expect(laterHash, `street ${id} lost`).toBeDefined();
        if (id.includes('-artery-artery-')) continue;
        expect(laterHash, `street ${id} moved`).toBe(contentHash(f.geometry));
      }
    }
    // Buildings: a core block generated at two years keeps the buildings that stand at both.
    const core = towns[2]!.town.blocks.find((b) => b.id.includes('-b') && (b.transitions?.length ?? 0) > 0)!;
    expect(core).toBeDefined();
    const at1925 = generateBlock(core, 1925);
    const core2020 = towns[4]!.town.blocks.find((b) => b.id === core.id)!;
    const at2020 = generateBlock(core2020, 2020);
    const survivors = at1925.buildings.filter((b) => (b.properties.demolished ?? Infinity) > 2020);
    expect(survivors.length).toBeGreaterThan(0);
    const later = new Map(at2020.buildings.map((b) => [String(b.id), b]));
    for (const b of survivors) {
      const l = later.get(String(b.id))!;
      expect(l).toBeDefined();
      expect(contentHash(l.geometry)).toBe(contentHash(b.geometry));
      expect(l.properties.built).toBe(b.properties.built);
    }
    // And some lots were rebuilt in the new zoning after 1925.
    const rebuilt = at2020.buildings.filter((b) => (b.properties.built ?? 0) > 1925);
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const b of at2020.buildings) expect(b.properties.built).toBeLessThanOrEqual(2020);
    // Nothing shows before it is built: a young block has empty lots early on.
    const young = towns[4]!.town.blocks
      .filter((b) => (b.builtYear ?? 0) >= 1985)
      .sort((a, b) => a.builtYear! - b.builtYear!)[0]!;
    expect(young).toBeDefined();
    const early = generateBlock(young, young.builtYear!).buildings.length;
    const late = generateBlock(young, young.builtYear! + 40).buildings.length;
    expect(late).toBeGreaterThan(early);
  });

  it('keeps the old town fixed while it fills in during the organic centuries', async () => {
    const a = (await townAt(1400, city)).town;
    const b = (await townAt(1650, city)).town;
    const c = (await townAt(1780, city)).town;
    expect(a.blocks.length).toBeLessThan(b.blocks.length);
    expect(b.blocks.length).toBeLessThanOrEqual(c.blocks.length);
    const cById = new Map(c.blocks.map((x) => [x.id, contentHash(x.ring)]));
    for (const x of [...a.blocks, ...b.blocks]) expect(cById.get(x.id)).toBe(contentHash(x.ring));
    expect(a.stats.coreEndYear).toBe(1780);
    expect(
      a.patches.features.filter((p) => p.properties.inner && p.properties.ward === 'farm').length,
    ).toBeGreaterThan(0);
  });

  it('empties the outskirts first when a town declines, and ruins follow', async () => {
    const decline: SettlementSpec[] = [
      {
        id: 'innsmouth',
        kind: 'portTown',
        population: 1500,
        founded: 1640,
        growth: [{ year: 1890, population: 6000 }],
        layout: { streetPattern: 'mixed' },
        features: [],
      },
    ];
    const peak = (await townAt(1890, decline)).town;
    const now = (await townAt(1925, decline)).town;
    expect(peak.stats.abandonedBlocks).toBe(0);
    expect(now.stats.abandonedBlocks).toBeGreaterThan(0);
    expect(now.stats.population).toBe(1500);
    expect(now.stats.peakPopulation).toBe(6000);
    const dist = (b: { ring: [number, number][] }) => {
      const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]);
      return Math.hypot(c[0] - now.center[0], c[1] - now.center[1]);
    };
    const abandoned = now.blocks.filter((b) => b.abandonedYear);
    const kept = now.blocks.filter((b) => !b.abandonedYear);
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean(abandoned.map(dist))).toBeGreaterThan(mean(kept.map(dist)));
    for (const b of abandoned) expect(b.abandonedYear).toBeGreaterThanOrEqual(1890);
    const later = (await townAt(1960, decline)).town;
    const ruinBlock = later.blocks.find((b) => b.abandonedYear && b.abandonedYear <= 1915)!;
    const model = generateBlock(ruinBlock, 1960);
    expect(model.buildings.length).toBeGreaterThan(0);
    for (const b of model.buildings) {
      expect(b.properties.condition).toBeLessThan(0.15);
      expect(['ruin', 'derelict']).toContain(b.properties.state);
      expect(b.properties.abandoned).toBe(ruinBlock.abandonedYear);
    }
    expect(now.patches.features.some((p) => p.properties.abandoned)).toBe(true);
  });

  it('fires burn and rebuild, storms damage and heal, floods only reach low ground', async () => {
    const { site } = await townAt(1925, city);
    const terrain = await terrainP;
    const fire = {
      id: 'f',
      kind: 'fire' as const,
      year: 1900,
      center: site.center,
      radiusM: 400,
      magnitude: 1,
      durationYears: 1,
    };
    const run = (year: number, events: (typeof fire)[]) =>
      runner.run(townStage, { seed: 't', site, terrain, year, blockSizeM: 90, eras, events });
    const before = await run(1899, [fire]);
    const after = await run(1903, [fire]);
    const burnt = after.blocks.filter((b) => b.disasters?.some((d) => d.kind === 'fire'));
    expect(burnt.length).toBeGreaterThan(3);
    const block = burnt
      .map((b) => ({
        b,
        n: generateBlock(
          before.blocks.find((x) => x.id === b.id)!,
          1899,
        ).buildings.length,
      }))
      .sort((a, b) => b.n - a.n)[0]!.b;
    const same = before.blocks.find((b) => b.id === block.id)!;
    const standingBefore = generateBlock(same, 1899).buildings.length;
    expect(standingBefore).toBeGreaterThan(2);
    const burning = await run(1900, [fire]);
    const standingAfter = generateBlock(
      burning.blocks.find((b) => b.id === block.id)!,
      1900,
    ).buildings.length;
    expect(standingAfter).toBe(0);
    const rebuilt = generateBlock(block, 1930).buildings;
    expect(rebuilt.length).toBeGreaterThanOrEqual(standingBefore - 1);
    expect(rebuilt.filter((b) => (b.properties.built ?? 0) > 1900).length).toBeGreaterThan(0);

    // A gas explosion takes its lots like a small fire; a power cut leaves the lots untouched.
    const blast = { ...fire, id: 'g', kind: 'explosion' as const, radiusM: 120 };
    const blasted = (await run(1900, [blast])).blocks.filter((b) =>
      b.disasters?.some((d) => d.kind === 'explosion'),
    );
    expect(blasted.length).toBeGreaterThan(0);
    expect(blasted.length).toBeLessThan(burnt.length);
    expect(
      blasted.some(
        (b) =>
          generateBlock(b, 1900).buildings.length === 0 &&
          generateBlock(
            before.blocks.find((x) => x.id === b.id)!,
            1899,
          ).buildings.length > 0,
      ),
    ).toBe(true);
    const cut = { ...fire, id: 'p', kind: 'blackout' as const };
    const dark = (await run(1900, [cut])).blocks.find((b) =>
      b.disasters?.some((d) => d.kind === 'blackout'),
    )!;
    const lit = (await run(1900, [])).blocks.find((b) => b.id === dark.id)!;
    expect(generateBlock(dark, 1900).buildings.length).toBe(generateBlock(lit, 1900).buildings.length);

    const storm = { ...fire, id: 's', kind: 'storm' as const, magnitude: 0.8 };
    const hit = (await run(1901, [storm])).blocks.find((b) => b.disasters?.some((d) => d.kind === 'storm'))!;
    const calm = (await run(1901, [])).blocks.find((b) => b.id === hit.id)!;
    const c = (m: ReturnType<typeof generateBlock>) =>
      m.buildings.reduce((a, b) => a + (b.properties.condition ?? 0), 0) / m.buildings.length;
    expect(c(generateBlock(hit, 1901))).toBeLessThan(c(generateBlock(calm, 1901)) - 0.2);
    const healed = (await run(1940, [storm])).blocks.find((b) => b.id === hit.id)!;
    const untouched = (await run(1940, [])).blocks.find((b) => b.id === hit.id)!;
    expect(Math.abs(c(generateBlock(healed, 1940)) - c(generateBlock(untouched, 1940)))).toBeLessThan(0.02);

    const lowest = Math.min(...before.blocks.map((b) => b.elevationM));
    const flood = {
      ...fire,
      id: 'w',
      kind: 'flood' as const,
      magnitude: 0.6,
      levelM: lowest + 1.5,
      radiusM: 5000,
    };
    const flooded = (await run(1901, [flood])).blocks;
    const wet = flooded.filter((b) => b.disasters?.some((d) => d.kind === 'flood'));
    expect(wet.length).toBeGreaterThan(0);
    expect(wet.length).toBeLessThan(flooded.length);
    for (const b of wet) expect(b.elevationM).toBeLessThanOrEqual(lowest + 1.5);
  });

  it('condition strokes raise or lower buildings under them', async () => {
    const { town } = await townAt(1925, city);
    const block = town.blocks.find((b) => b.id.includes('-b'))!;
    const base = generateBlock(block, 1925);
    const c = block.ring.reduce(
      (a, p) => [a[0] + p[0] / block.ring.length, a[1] + p[1] / block.ring.length],
      [0, 0],
    ) as [number, number];
    const worse = generateBlock(block, 1925, {
      conditionEdits: [{ points: [c], radiusM: 400, delta: -0.5 }],
    });
    const better = generateBlock(block, 1925, {
      conditionEdits: [{ points: [c], radiusM: 400, delta: 0.5 }],
    });
    const mean = (m: typeof base) =>
      m.buildings.reduce((a, b) => a + (b.properties.condition ?? 0), 0) / m.buildings.length;
    expect(mean(worse)).toBeLessThan(mean(base) - 0.2);
    expect(mean(better)).toBeGreaterThan(mean(base) + 0.1);
    for (const b of base.buildings)
      expect(['sound', 'worn', 'derelict', 'ruin']).toContain(b.properties.state);
  });
});
