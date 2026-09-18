import { describe, expect, it } from 'vitest';
import {
  CULTURE_PACKS,
  NameGenerator,
  Rng,
  StageRunner,
  contentHash,
  culturePack,
  culturePackById,
  generateBlock,
  regionNamesStage,
  sitingStage,
  societyStage,
  terrainStage,
  townNamesStage,
  townStage,
  amenityFor,
  type SettlementSpec,
} from '../src/index.js';
import { eraParams } from '../../features/src/index.js';

const runner = new StageRunner();
async function fixture() {
  const terrain = await runner.run(terrainStage, {
    seed: 'names',
    extent: { widthM: 14_000, heightM: 10_000 },
    preset: 'riverValley',
    relief: 0.4,
    roughness: 0.4,
    seaLevel: 0,
    rivers: { major: 1, minor: 2 },
    cellSizeM: 40,
  });
  const specs: SettlementSpec[] = [
    { id: 'city', kind: 'city', population: 40_000, layout: { streetPattern: 'mixed' }, features: [] },
    { id: 'village', kind: 'village', population: 600, layout: { streetPattern: 'organic' }, features: [] },
  ];
  const siting = await runner.run(sitingStage, {
    seed: 'names',
    terrain,
    year: 1925,
    settlements: specs,
    policy: { count: [2, 2], kinds: {} },
  });
  return { terrain, siting };
}

describe('culture packs and naming', () => {
  it('ships eight valid packs with the conventions the design asks for', () => {
    expect(CULTURE_PACKS.map((p) => p.id).sort()).toEqual([
      'china',
      'egyptLevant',
      'england',
      'france',
      'germanyCentralEurope',
      'iberia',
      'japan',
      'newEngland',
    ]);
    for (const p of CULTURE_PACKS) {
      expect(p.naming.given.length).toBeGreaterThanOrEqual(20);
      expect(p.naming.family.length).toBeGreaterThanOrEqual(24);
      expect(p.conventions.religious.length).toBeGreaterThan(2);
    }
    expect(culturePackById('egyptLevant')!.colonial?.culture).toBe('england');
  });

  it('generates unique, deterministic names of every kind', () => {
    const make = () => new NameGenerator(culturePack('england'), 'seed-1', 1925, culturePackById);
    const a = make();
    const b = make();
    const streets = new Set<string>();
    for (let i = 0; i < 120; i++)
      streets.add(a.street(`${i}`, i % 3 === 0 ? 'artery' : i % 3 === 1 ? 'street' : 'lane'));
    expect(streets.size).toBe(120);
    expect(a.settlement('x')).toBe(b.settlement('x'));
    for (let i = 0; i < 5; i++)
      expect(b.street(`${i}`, i % 3 === 0 ? 'artery' : i % 3 === 1 ? 'street' : 'lane')).toBe(
        [...streets][i],
      );
    expect(a.water('r1')).toMatch(/River|Brook|Beck|Water/);
    expect(a.business('b1', 'Bakery').length).toBeGreaterThan(3);
    const person = a.person('p1');
    expect(person.given.length).toBeGreaterThan(1);
    // A colonial overlay mixes a share of English names into Cairo after 1882.
    const cairo = new NameGenerator(culturePack('egyptLevant'), 'seed-1', 1925, culturePackById);
    const names = Array.from({ length: 60 }, (_, i) => cairo.street(`${i}`, 'street'));
    expect(names.some((n) => /Sharia|Darb|Haret|Zuqaq/.test(n))).toBe(true);
    expect(names.some((n) => /Street|Lane|Row|Terrace|Place/.test(n))).toBe(true);
    const cairo1850 = new NameGenerator(culturePack('egyptLevant'), 'seed-1', 1850, culturePackById);
    const early = Array.from({ length: 60 }, (_, i) => cairo1850.street(`${i}`, 'street'));
    expect(early.some((n) => /Street|Lane|Row|Terrace|Place/.test(n))).toBe(false);
  });

  it('names settlements and rivers for the region and streets and districts per town', async () => {
    const { terrain, siting } = await fixture();
    const region = await runner.run(regionNamesStage, {
      seed: 'names',
      culture: 'newEngland',
      year: 1925,
      sites: siting.sites,
      rivers: terrain.riverLines.features.filter((r) => r.properties.order >= 2).map((r) => String(r.id)),
    });
    expect(Object.keys(region.siteNames)).toEqual(['city', 'village']);
    expect(region.siteNames.city).not.toBe(region.siteNames.village);
    expect(Object.keys(region.riverNames).length).toBeGreaterThan(0);
    const eras = eraParams('newEngland');
    const society = await runner.run(societyStage, {
      seed: 'names',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    });
    const site = siting.sites[0]!;
    const town = await runner.run(townStage, {
      seed: 'names',
      site,
      terrain,
      year: 1925,
      blockSizeM: 90,
      eras,
      society,
    });
    const names = await runner.run(townNamesStage, {
      seed: 'names',
      culture: 'newEngland',
      year: 1925,
      site,
      town,
    });
    // Every street feature has a name and the ways cover them all with fewer, longer lines.
    expect(Object.keys(names.streetNames).length).toBe(town.streets.features.length);
    expect(names.ways.features.length).toBeLessThan(town.streets.features.length);
    expect(names.ways.features.length).toBeGreaterThan(10);
    const wayNames = names.ways.features.map((w) => w.properties.name);
    expect(new Set(wayNames).size).toBe(wayNames.length);
    expect(wayNames.some((n) => /Street|Avenue|Road|Lane/.test(n))).toBe(true);
    // Districts: the old town plus ring sectors, each with a label point.
    expect(names.districts.features.some((d) => d.properties.name === 'Old Town')).toBe(true);
    expect(names.districts.features.length).toBeGreaterThan(3);
    expect(Object.keys(names.patchDistricts).length).toBe(town.patches.features.length);
    const again = await new StageRunner().run(townNamesStage, {
      seed: 'names',
      culture: 'newEngland',
      year: 1925,
      site,
      town,
    });
    expect(contentHash(again.ways)).toBe(contentHash(names.ways));
  }, 60_000);

  it('makes a 1925 Cairo and a 1925 Boston from the same seed differ in street pattern, building kinds and names', async () => {
    const { terrain, siting } = await fixture();
    const society = await runner.run(societyStage, {
      seed: 'names',
      terrain,
      sites: siting.sites,
      year: 1925,
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    });
    const site = siting.sites[0]!;
    const boston = await runner.run(townStage, {
      seed: 'names',
      site,
      terrain,
      year: 1925,
      blockSizeM: eraParams('newEngland').find((e) => e.year === 1925)!.blockSizeM.core,
      eras: eraParams('newEngland'),
      society,
    });
    const cairo = await runner.run(townStage, {
      seed: 'names',
      site,
      terrain,
      year: 1925,
      blockSizeM: eraParams('egyptLevant').find((e) => e.year === 1925)!.blockSizeM.core,
      eras: eraParams('egyptLevant'),
      society,
    });
    // Street pattern: the packs' early patterns and block scales differ, so the streets differ.
    expect(contentHash(boston.streets)).not.toBe(contentHash(cairo.streets));
    expect(cairo.blocks.length).toBeGreaterThan(boston.blocks.length); // smaller medina blocks
    // Building kinds and names.
    const bb = boston.blocks
      .slice(0, 15)
      .flatMap((b) => generateBlock(b, 1925, { pack: culturePack('newEngland') }).buildings);
    const cb = cairo.blocks
      .slice(0, 15)
      .flatMap((b) => generateBlock(b, 1925, { pack: culturePack('egyptLevant') }).buildings);
    const bKinds = new Set(bb.map((b) => b.properties.kindLabel));
    const cKinds = new Set(cb.map((b) => b.properties.kindLabel));
    expect(bKinds).not.toEqual(cKinds);
    expect(bb.some((b) => b.properties.kindLabel !== b.properties.kind)).toBe(true);
    expect(cb.some((b) => b.properties.kindLabel !== b.properties.kind)).toBe(true);
    expect(bb.every((b) => b.properties.name && b.properties.material && b.properties.use)).toBe(true);
    const bNames = new Set(bb.map((b) => b.properties.name));
    const cNames = new Set(cb.map((b) => b.properties.name));
    expect([...bNames].filter((n) => cNames.has(n!)).length).toBeLessThan(bNames.size / 2);
    expect(new Set(bb.map((b) => b.properties.material)).has('timber')).toBe(true);
    expect(new Set(cb.map((b) => b.properties.material)).has('timber')).toBe(false);
    // Culture-aware eras: Cairo keeps organic growth until 1880 and gets rail later.
    const e = eraParams('egyptLevant');
    expect(e.find((x) => x.year === 1780)!.ringPattern).toBe('organic');
    expect(e.find((x) => x.year === 1850)!.transport.rail).toBe(false);
    expect(eraParams('newEngland').find((x) => x.year === 1850)!.transport.rail).toBe(true);
    expect(eraParams('china').find((x) => x.year === 1400)!.ringPattern).toBe('grid');
  }, 60_000);

  it('assigns amenities by era and ward with a plausible rate', () => {
    let pubs = 0;
    let cinemas = 0;
    let residential = 0;
    for (let i = 0; i < 400; i++) {
      const a = amenityFor(new Rng(`a${i}`), 1925, 'rowhouse', 'rowhouse');
      if (!a) residential++;
      else if (a.id === 'pub') pubs++;
      else if (a.id === 'cinema') cinemas++;
    }
    expect(residential).toBeGreaterThan(250);
    expect(pubs).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++)
      expect(amenityFor(new Rng(`b${i}`), 1650, 'market', 'shop')?.id).not.toBe('cinema');
    expect(cinemas).toBeLessThan(40);
    for (let i = 0; i < 50; i++) expect(amenityFor(new Rng(`c${i}`), 1925, 'cbd', 'office')).not.toBeNull();
  });
});
