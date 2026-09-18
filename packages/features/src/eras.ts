import { Registry, eraProfileSchema, type EraProfile } from './registry.js';

const profiles: EraProfile[] = [
  {
    id: 'era-1400',
    year: 1400,
    name: 'Late medieval',
    streetWidthM: { arterial: 8, collector: 5, local: 3.5, lane: 2 },
    blockSizeM: { core: 60, ring: 90 },
    transport: { horse: true, tram: false, rail: false, car: false, motorway: false, container: false },
    zoneWeights: {
      market: 1,
      craftsmen: 6,
      merchant: 2,
      patriciate: 1,
      slum: 2,
      military: 1,
      cathedral: 1,
      farm: 4,
    },
  },
  {
    id: 'era-1890',
    year: 1890,
    name: 'Gaslight',
    streetWidthM: { arterial: 18, collector: 12, local: 9, lane: 4 },
    blockSizeM: { core: 90, ring: 140 },
    transport: { horse: true, tram: true, rail: true, car: false, motorway: false, container: false },
    zoneWeights: {
      cbd: 1,
      tenement: 4,
      rowhouse: 4,
      streetcarSuburb: 2,
      warehouse: 2,
      heavyIndustry: 2,
      rail: 1,
      park: 1,
    },
  },
  {
    id: 'era-1925',
    year: 1925,
    name: 'Classic',
    streetWidthM: { arterial: 20, collector: 14, local: 10, lane: 4 },
    blockSizeM: { core: 100, ring: 160 },
    transport: { horse: false, tram: true, rail: true, car: true, motorway: false, container: false },
    zoneWeights: {
      cbd: 1,
      tenement: 3,
      rowhouse: 3,
      streetcarSuburb: 3,
      bungalowSuburb: 2,
      warehouse: 2,
      heavyIndustry: 2,
      rail: 1,
      park: 1,
    },
  },
  {
    id: 'era-1985',
    year: 1985,
    name: 'Late modern',
    streetWidthM: { arterial: 24, collector: 16, local: 10, lane: 5 },
    blockSizeM: { core: 110, ring: 220 },
    transport: { horse: false, tram: false, rail: true, car: true, motorway: true, container: true },
    zoneWeights: {
      cbd: 1,
      apartment: 3,
      suburb: 5,
      culDeSac: 3,
      retailStrip: 2,
      lightIndustry: 3,
      logistics: 2,
      park: 1,
    },
  },
];

export const eras = new Registry<EraProfile>('era profile', eraProfileSchema);
for (const p of profiles) eras.register(p);

/** The era profile whose reference year is nearest to (and not after, if possible) the given year. */
export function eraForYear(year: number): EraProfile {
  const all = eras.all().sort((a, b) => a.year - b.year);
  let best = all[0]!;
  for (const p of all) if (p.year <= year) best = p;
  return best;
}
