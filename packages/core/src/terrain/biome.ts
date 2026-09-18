/**
 * The subset of a biome pack that the terrain and land-cover stages consume.
 * The full packs live in @citygen/features; core only depends on this shape.
 */
export interface BiomeTerrainParams {
  id: string;
  /** 0..1 — scales river density (drainage threshold).*/
  wetness: number;
  /** 0..1 — fraction of unfarmed land that is wooded. */
  forestCover: number;
  forestKind: 'broadleaf' | 'conifer' | 'mixed' | 'rainforest' | 'none';
  /** Open land between woods and farms. */
  openKind: 'meadow' | 'moor' | 'steppe' | 'savanna' | 'scrub' | 'desert';
  /** Metres; forest does not grow above this. */
  treeLineM: number;
  /** Metres; permanent snow above this. */
  snowLineM: number;
  coastKind: 'beach' | 'cliff' | 'marsh' | 'mangrove';
  /** 0..1 — how much of the flat, low land is farmed. */
  farmland: number;
}

export const DEFAULT_BIOME: BiomeTerrainParams = {
  id: 'temperateMaritime',
  wetness: 0.7,
  forestCover: 0.45,
  forestKind: 'broadleaf',
  openKind: 'meadow',
  treeLineM: 700,
  snowLineM: 2500,
  coastKind: 'marsh',
  farmland: 0.6,
};
