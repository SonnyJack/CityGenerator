import type { MapDocument } from '@citygen/core';

/** Contract between the UI thread and the engine worker. */
export interface EngineApi {
  /**
   * Replace the document, run the eager stages and rebuild the tile sources.
   * Resolves to the new tile-source version and generation statistics.
   */
  setDocument(
    doc: MapDocument,
    options: { sketch: boolean },
  ): Promise<{ version: number; stats: EngineStats }>;
  /** Encoded vector tile for the given source version, or null when empty. */
  getTile(version: number, z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** Terrain-RGB PNG tile for hillshade and 3-D terrain, or null outside the region. */
  getDemTile(version: number, z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** Small terrain previews for other seeds of the same spec. */
  thumbnails(doc: MapDocument, seeds: string[], width: number, height: number): Promise<Thumbnail[]>;
  /** Determinism fixture (see @citygen/core computeFixtureHash). */
  fixtureHash(): Promise<string>;
  /** What is at a world position: terrain, society fields and the zone with its explanation. */
  inspect(x: number, y: number): Promise<Inspection | null>;
}

export interface Inspection {
  x: number;
  y: number;
  elevationM: number;
  slope: number;
  water: 'land' | 'sea' | 'lake' | 'river';
  landcover: string;
  wealth: number;
  density: number;
  wealthClass: string;
  densityClass: string;
  settlement?: { id: string; kind: string; name?: string; population: number };
  patch?: { ward: string; inner: boolean; ring: number; why: string };
}

export interface Thumbnail {
  seed: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface EngineStats {
  terrainMs: number;
  landcoverMs: number;
  settlementsMs: number;
  roadsMs: number;
  tilesMs: number;
  totalMs: number;
  memoHits: number;
  memoMisses: number;
  terrain: {
    cellSizeM: number;
    cells: number;
    minM: number;
    maxM: number;
    landFraction: number;
    riverKm: number;
    lakes: number;
    contourIntervalM: number;
  };
  settlements: {
    id: string;
    kind: string;
    name?: string;
    population: number;
    center: [number, number];
    radiusM: number;
    patches: number;
    walled: boolean;
    blocks: number;
    rings: number;
    coreRadiusM: number;
  }[];
  era: { id: string; name: string; year: number };
  roads: { links: number; roadKm: number; bridges: number };
  blocks: number;
}
