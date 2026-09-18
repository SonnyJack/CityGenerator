/**
 * Zone (ward) profiles for organic settlements: the medieval/classic set
 * generalised from the reference's wards, as data plus a location scorer.
 * Scores are relative; the town stage assigns special wards greedily by best
 * score and fills the rest by weighted choice.
 */
export type WardId =
  | 'plaza'
  | 'market'
  | 'craftsmen'
  | 'merchant'
  | 'patriciate'
  | 'slum'
  | 'military'
  | 'cathedral'
  | 'castle'
  | 'park'
  | 'gate'
  | 'farm'
  | 'common';

export interface WardContext {
  /** Distance from the cell centroid to the plaza/centre, normalised by the town radius. */
  centreDist: number;
  /** Distance to the nearest gate, normalised by the town radius. */
  gateDist: number;
  /** Distance to the wall (or town edge), normalised. */
  wallDist: number;
  /** Whether an artery street runs along the cell. */
  onArtery: boolean;
  adjacentToPlaza: boolean;
  adjacentToCastle: boolean;
  compactness: number;
  /** Cell area relative to the median inner cell. */
  relativeArea: number;
  /** Slope at the cell (rise/run). */
  slope: number;
  /** Whether the cell touches water. */
  waterfront: boolean;
}

export interface WardProfile {
  id: WardId;
  /** Lot size targets in m² (min area of a lot before splitting stops). */
  lotAreaM2: number;
  /** Chance a lot stays empty (yard, garden, orchard). */
  emptyChance: number;
  /** Building gap from the lot edge, metres. */
  setbackM: number;
  /** Building floors range. */
  floors: [number, number];
  /** Probability weight when filling ordinary cells. */
  fillWeight: number;
  /** Fixed count when > 0 (special wards). */
  count?: (innerCells: number, population: number) => number;
  score: (c: WardContext) => number;
}

export const WARDS: Record<WardId, WardProfile> = {
  plaza: {
    id: 'plaza',
    lotAreaM2: 0,
    emptyChance: 1,
    setbackM: 0,
    floors: [0, 0],
    fillWeight: 0,
    score: (c) => -c.centreDist,
  },
  market: {
    id: 'market',
    lotAreaM2: 260,
    emptyChance: 0.05,
    setbackM: 0.6,
    floors: [2, 3],
    fillWeight: 0,
    count: (inner) => Math.min(6, Math.max(1, Math.round(inner / 25))),
    score: (c) => (c.adjacentToPlaza ? 2 : 0) - c.centreDist + (c.onArtery ? 0.5 : 0),
  },
  cathedral: {
    id: 'cathedral',
    lotAreaM2: 0,
    emptyChance: 0,
    setbackM: 6,
    floors: [3, 4],
    fillWeight: 0,
    count: (inner, pop) => (pop >= 1500 && inner >= 12 ? 1 : 0),
    score: (c) => (c.adjacentToPlaza ? 1.5 : 0) + c.compactness + c.relativeArea * 0.8 - c.centreDist * 0.5,
  },
  castle: {
    id: 'castle',
    lotAreaM2: 0,
    emptyChance: 0,
    setbackM: 10,
    floors: [3, 5],
    fillWeight: 0,
    score: (c) => c.compactness * 1.5 + (1 - c.wallDist) + c.relativeArea * 0.5 - (c.adjacentToPlaza ? 1 : 0),
  },
  merchant: {
    id: 'merchant',
    lotAreaM2: 420,
    emptyChance: 0.08,
    setbackM: 0.8,
    floors: [2, 4],
    fillWeight: 2,
    score: (c) => 1 - c.centreDist + (c.onArtery ? 0.8 : 0) + (c.waterfront ? 0.4 : 0),
  },
  patriciate: {
    id: 'patriciate',
    lotAreaM2: 900,
    emptyChance: 0.3,
    setbackM: 2.5,
    floors: [2, 3],
    fillWeight: 1,
    score: (c) =>
      (c.adjacentToCastle ? 1.2 : 0) +
      (c.onArtery ? -0.6 : 0.3) +
      c.gateDist * 0.6 -
      c.centreDist * 0.4 -
      c.slope * 2,
  },
  craftsmen: {
    id: 'craftsmen',
    lotAreaM2: 300,
    emptyChance: 0.06,
    setbackM: 0.6,
    floors: [1, 3],
    fillWeight: 6,
    score: () => 0.5,
  },
  slum: {
    id: 'slum',
    lotAreaM2: 150,
    emptyChance: 0.03,
    setbackM: 0.3,
    floors: [1, 2],
    fillWeight: 2,
    score: (c) => c.centreDist + (1 - c.wallDist) * 0.8 + c.slope * 2 - (c.onArtery ? 0.3 : 0),
  },
  military: {
    id: 'military',
    lotAreaM2: 700,
    emptyChance: 0.35,
    setbackM: 2,
    floors: [1, 2],
    fillWeight: 0,
    count: (inner, pop) => (pop >= 3000 && inner >= 20 ? 1 : 0),
    score: (c) => (c.adjacentToCastle ? 2 : 0) + (1 - c.gateDist) * 0.8,
  },
  park: {
    id: 'park',
    lotAreaM2: 0,
    emptyChance: 1,
    setbackM: 0,
    floors: [0, 0],
    fillWeight: 0,
    count: (inner, pop) => (pop >= 8000 ? Math.max(1, Math.round(inner / 60)) : 0),
    score: (c) => c.relativeArea + (c.onArtery ? -0.5 : 0.3) + c.wallDist * 0.3,
  },
  gate: {
    id: 'gate',
    lotAreaM2: 500,
    emptyChance: 0.25,
    setbackM: 1.5,
    floors: [1, 2],
    fillWeight: 0,
    score: (c) => 2 - c.gateDist * 3,
  },
  farm: {
    id: 'farm',
    lotAreaM2: 0,
    emptyChance: 1,
    setbackM: 0,
    floors: [1, 1],
    fillWeight: 0,
    score: () => 0,
  },
  common: {
    id: 'common',
    lotAreaM2: 400,
    emptyChance: 0.12,
    setbackM: 1.2,
    floors: [1, 2],
    fillWeight: 0,
    score: () => 0,
  },
};

/** Wards that appear as buildable blocks inside the town. */
export const FILL_WARDS: WardId[] = ['craftsmen', 'merchant', 'patriciate', 'slum'];
