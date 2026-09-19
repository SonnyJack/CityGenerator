/**
 * Era parameters consumed by the settlement stages. The data lives in
 * @citygen/features; core owns the shape and the year lookup so that stages
 * stay data-driven.
 */
export type RingPattern = 'organic' | 'grid' | 'streetcar' | 'suburban' | 'culDeSac' | 'towers';

export interface EraParams {
  id: string;
  year: number;
  name: string;
  /** Street pattern for growth rings built in this era. */
  ringPattern: RingPattern;
  /** Block spacing (metres) for the organic core and for rings. */
  blockSizeM: { core: number; ring: number };
  streetWidthM: { arterial: number; collector: number; local: number; lane: number };
  /** Persons per km² of built-up area. */
  densityPerKm2: number;
  transport: {
    horse: boolean;
    tram: boolean;
    rail: boolean;
    car: boolean;
    motorway: boolean;
    container: boolean;
  };
  walls: boolean;
  /**
   * How far the streetcar suburbs of this era reached out along the radial arteries the trams
   * ran on, relative to the default (1). Above 1 the growth of a streetcar ring strings itself
   * along the lines and leaves the ground between them open; 0 fills the ring evenly. Culture
   * packs set it (compact cities keep their growth continuous, new-world ones string it out).
   */
  streetcarReach?: number;
}

/** Nearest profile at or before the year (the earliest when the year precedes all). */
export function eraAt(eras: readonly EraParams[], year: number): EraParams {
  const sorted = [...eras].sort((a, b) => a.year - b.year);
  let best = sorted[0]!;
  for (const e of sorted) if (e.year <= year) best = e;
  return best;
}

/** Linear interpolation of the numeric fields between the surrounding profiles. */
export function eraInterpolated(eras: readonly EraParams[], year: number): EraParams {
  const sorted = [...eras].sort((a, b) => a.year - b.year);
  const lo = eraAt(sorted, year);
  const hi = sorted.find((e) => e.year > year) ?? lo;
  if (hi === lo) return lo;
  const t = (year - lo.year) / (hi.year - lo.year);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    ...lo,
    blockSizeM: {
      core: mix(lo.blockSizeM.core, hi.blockSizeM.core),
      ring: mix(lo.blockSizeM.ring, hi.blockSizeM.ring),
    },
    streetWidthM: {
      arterial: mix(lo.streetWidthM.arterial, hi.streetWidthM.arterial),
      collector: mix(lo.streetWidthM.collector, hi.streetWidthM.collector),
      local: mix(lo.streetWidthM.local, hi.streetWidthM.local),
      lane: mix(lo.streetWidthM.lane, hi.streetWidthM.lane),
    },
    densityPerKm2: mix(lo.densityPerKm2, hi.densityPerKm2),
  };
}
