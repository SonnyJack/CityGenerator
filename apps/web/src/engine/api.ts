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
}
