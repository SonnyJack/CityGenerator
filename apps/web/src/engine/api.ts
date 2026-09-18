import type { MapDocument } from '@citygen/core';

/** Contract between the UI thread and the engine worker. */
export interface EngineApi {
  /** Replace the document and run eager stages. Resolves to the new tile-source version. */
  setDocument(doc: MapDocument): Promise<{ version: number; stats: EngineStats }>;
  /** Encoded vector tile for the given source version, or null when empty. */
  getTile(version: number, z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** Determinism fixture (see @citygen/core computeFixtureHash). */
  fixtureHash(): Promise<string>;
}

export interface EngineStats {
  stageMs: number;
  memoHits: number;
  memoMisses: number;
}
