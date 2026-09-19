import type { EraParams } from '@citygen/core';
import { culturePackById, eraAt, eraInterpolated } from '@citygen/core';
import { z } from 'zod';
import { Registry } from './registry.js';

/**
 * Era profiles: ten reference years from the late medieval period to the
 * present. Years between profiles interpolate the numeric fields and take the
 * discrete choices (street pattern, transport, walls) of the nearest earlier
 * profile. See DESIGN §5.2.
 */
export const eraProfileSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  name: z.string(),
  ringPattern: z.enum(['organic', 'grid', 'streetcar', 'suburban', 'culDeSac', 'towers']),
  blockSizeM: z.object({ core: z.number(), ring: z.number() }),
  streetWidthM: z.object({
    arterial: z.number(),
    collector: z.number(),
    local: z.number(),
    lane: z.number(),
  }),
  densityPerKm2: z.number(),
  transport: z.object({
    horse: z.boolean(),
    tram: z.boolean(),
    rail: z.boolean(),
    car: z.boolean(),
    motorway: z.boolean(),
    container: z.boolean(),
  }),
  walls: z.boolean(),
  /** Relative weights of zone profiles for ordinary blocks in this era. */
  zoneWeights: z.record(z.string(), z.number().min(0)),
});
export type EraProfile = z.infer<typeof eraProfileSchema>;

const T = (
  horse: boolean,
  tram: boolean,
  rail: boolean,
  car: boolean,
  motorway: boolean,
  container: boolean,
) => ({ horse, tram, rail, car, motorway, container });

const profiles: EraProfile[] = [
  {
    id: 'era-1100',
    year: 1100,
    name: 'High medieval',
    ringPattern: 'organic',
    blockSizeM: { core: 55, ring: 80 },
    streetWidthM: { arterial: 7, collector: 5, local: 3, lane: 1.8 },
    densityPerKm2: 14000,
    transport: T(true, false, false, false, false, false),
    walls: true,
    zoneWeights: { craftsmen: 6, merchant: 1.5, patriciate: 0.8, slum: 2.5 },
  },
  {
    id: 'era-1400',
    year: 1400,
    name: 'Late medieval',
    ringPattern: 'organic',
    blockSizeM: { core: 60, ring: 90 },
    streetWidthM: { arterial: 8, collector: 5, local: 3.5, lane: 2 },
    densityPerKm2: 13000,
    transport: T(true, false, false, false, false, false),
    walls: true,
    zoneWeights: { craftsmen: 6, merchant: 2, patriciate: 1, slum: 2 },
  },
  {
    id: 'era-1650',
    year: 1650,
    name: 'Early modern',
    ringPattern: 'organic',
    blockSizeM: { core: 70, ring: 100 },
    streetWidthM: { arterial: 9, collector: 6, local: 4, lane: 2 },
    densityPerKm2: 12000,
    transport: T(true, false, false, false, false, false),
    walls: true,
    zoneWeights: { craftsmen: 5, merchant: 3, patriciate: 1.5, slum: 2 },
  },
  {
    id: 'era-1780',
    year: 1780,
    name: 'Georgian',
    ringPattern: 'grid',
    blockSizeM: { core: 80, ring: 120 },
    streetWidthM: { arterial: 12, collector: 9, local: 7, lane: 3 },
    densityPerKm2: 11000,
    transport: T(true, false, false, false, false, false),
    walls: false,
    zoneWeights: { craftsmen: 4, merchant: 3, patriciate: 2, slum: 2, rowhouse: 3 },
  },
  {
    id: 'era-1850',
    year: 1850,
    name: 'Early industrial',
    ringPattern: 'grid',
    blockSizeM: { core: 85, ring: 130 },
    streetWidthM: { arterial: 14, collector: 10, local: 8, lane: 3.5 },
    densityPerKm2: 11000,
    transport: T(true, false, true, false, false, false),
    walls: false,
    zoneWeights: { tenement: 4, rowhouse: 4, warehouse: 2, merchant: 2, patriciate: 1 },
  },
  {
    id: 'era-1890',
    year: 1890,
    name: 'Gaslight',
    ringPattern: 'streetcar',
    blockSizeM: { core: 90, ring: 140 },
    streetWidthM: { arterial: 18, collector: 12, local: 9, lane: 4 },
    densityPerKm2: 10000,
    transport: T(true, true, true, false, false, false),
    walls: false,
    zoneWeights: { cbd: 1, tenement: 4, rowhouse: 4, streetcarSuburb: 3, warehouse: 2, patriciate: 1 },
  },
  {
    id: 'era-1925',
    year: 1925,
    name: 'Classic',
    ringPattern: 'streetcar',
    blockSizeM: { core: 100, ring: 160 },
    streetWidthM: { arterial: 20, collector: 14, local: 10, lane: 4 },
    densityPerKm2: 7000,
    transport: T(false, true, true, true, false, false),
    walls: false,
    zoneWeights: { cbd: 1, tenement: 3, rowhouse: 3, streetcarSuburb: 4, gardenSuburb: 2, warehouse: 2 },
  },
  {
    id: 'era-1955',
    year: 1955,
    name: 'Post-war',
    ringPattern: 'suburban',
    blockSizeM: { core: 105, ring: 200 },
    streetWidthM: { arterial: 22, collector: 15, local: 10, lane: 5 },
    densityPerKm2: 5000,
    transport: T(false, true, true, true, true, false),
    walls: false,
    zoneWeights: { cbd: 1, apartment: 3, suburb: 5, towerEstate: 2, warehouse: 1 },
  },
  {
    id: 'era-1985',
    year: 1985,
    name: 'Late modern',
    ringPattern: 'culDeSac',
    blockSizeM: { core: 110, ring: 240 },
    streetWidthM: { arterial: 24, collector: 16, local: 10, lane: 5 },
    densityPerKm2: 4000,
    transport: T(false, false, true, true, true, true),
    walls: false,
    zoneWeights: { cbd: 1, apartment: 3, suburb: 4, culDeSac: 4, retailStrip: 1 },
  },
  {
    id: 'era-2020',
    year: 2020,
    name: 'Contemporary',
    ringPattern: 'culDeSac',
    blockSizeM: { core: 110, ring: 220 },
    streetWidthM: { arterial: 24, collector: 16, local: 9, lane: 5 },
    densityPerKm2: 3800,
    transport: T(false, true, true, true, true, true),
    walls: false,
    zoneWeights: { cbd: 1, apartment: 4, suburb: 3, culDeSac: 3, retailStrip: 1 },
  },
];

export const eras = new Registry<EraProfile>('era profile', eraProfileSchema);
for (const p of profiles) eras.register(p);

/**
 * All profiles as core-typed era parameters, oldest first. With a culture the
 * profiles are culture-aware (DESIGN §7): the early street pattern and block
 * scale come from the pack, and transport modes arrive in the pack's years.
 */
export function eraParams(cultureId?: string): EraParams[] {
  const base = eras.all().sort((a, b) => a.year - b.year);
  const pack = cultureId ? culturePackById(cultureId) : undefined;
  if (!pack) return base;
  const c = pack.conventions;
  const firstYear = (mode: 'rail' | 'tram' | 'motorway' | 'container') =>
    c.transport[mode] ?? base.find((e) => e.transport[mode])?.year ?? Infinity;
  const tramEnd = base.filter((e) => e.transport.tram).map((e) => e.year);
  return base.map((e) => ({
    ...e,
    ringPattern:
      e.year < c.modernFrom && (e.ringPattern === 'organic' || e.ringPattern === 'grid')
        ? c.earlyPattern
        : e.ringPattern,
    blockSizeM: { core: e.blockSizeM.core * c.blockSizeScale, ring: e.blockSizeM.ring * c.blockSizeScale },
    streetcarReach: c.streetcarReach,
    transport: {
      ...e.transport,
      rail: e.year >= firstYear('rail'),
      tram:
        e.year >= firstYear('tram') &&
        (tramEnd.length === 0 || e.year <= Math.max(...tramEnd) || e.transport.tram),
      motorway: e.year >= firstYear('motorway'),
      container: e.year >= firstYear('container'),
    },
    walls: e.walls && c.walls,
  }));
}

/** The profile whose reference year is nearest to (and not after, if possible) the given year. */
export function eraForYear(year: number): EraProfile {
  return eraAt(eras.all(), year) as EraProfile;
}

/** Era parameters with numeric fields interpolated for the year. */
export function eraForYearInterpolated(year: number): EraParams {
  return eraInterpolated(eraParams(), year);
}
