import type { Interior } from '@citygen/core';
import type { Geometry } from 'geojson';
import type { MapDocument } from '@citygen/core';
import type { ExportModel, Frame } from '@citygen/export';

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
  /** The generated building, street or patch under a point (for freeze/remove), or null. */
  generatedAt(x: number, y: number, toleranceM: number): Promise<GeneratedHit | null>;
  /** Everything an exporter needs for a frame (buildings generated for the blocks it touches). */
  exportFrame(frame: Frame): Promise<ExportModel>;
  /** Floor plans of a generated building by id (rooms, doors, windows, walls per floor), or null. */
  interior(buildingId: string): Promise<Interior | null>;
  /** Business and resident directory: every building of a settlement (or all), filtered by text. */
  directory(
    settlement: string | null,
    query: string,
    limit: number,
  ): Promise<{ total: number; entries: DirectoryEntry[] }>;
  /** Feature search for the assistant: settlements, facilities, stations, districts, ways and buildings. */
  find(query: FindQuery): Promise<FoundFeature[]>;
  /** Everything the assistant needs to know about one settlement. */
  settlementSummary(id: string): Promise<SettlementSummary | null>;
}

export interface FindQuery {
  kind?:
    'settlement' | 'facility' | 'building' | 'street' | 'district' | 'station' | 'annotation' | 'authored';
  name?: string;
  settlement?: string;
  bbox?: [number, number, number, number];
  limit?: number;
}

export interface FoundFeature {
  id: string;
  kind: string;
  name: string;
  center: [number, number];
  settlement?: string | null;
  properties?: Record<string, unknown>;
}

export interface SettlementSummary {
  id: string;
  name: string;
  kind: string;
  population: number;
  center: [number, number];
  radiusM: number;
  walled?: boolean;
  culture?: string;
  founded?: number;
  streetPattern?: string;
  ways: number;
  districts: number;
  districtList: { id: string; name: string; ward?: string; center: [number, number] }[];
  facilities: {
    id: string;
    type: string;
    name: string;
    settlement: string | null;
    center: [number, number];
    pinned: boolean;
    outcome: string;
  }[];
  stations: { id: string; name: string; center: [number, number] }[];
  premises: number;
  businesses: { name: string; use: string; address?: string }[];
  wealth?: string;
  density?: string;
}

export interface DirectoryEntry {
  id: string;
  built?: number;
  state?: string;
  condition?: number;
  settlement: string;
  name: string;
  use: string;
  useLabel: string;
  kind: string;
  kindLabel: string;
  material: string;
  floors: number;
  ward: string;
  address?: string;
  center: [number, number];
}

export interface GeneratedHit {
  layer: 'buildings' | 'streets' | 'patches';
  id: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
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
  patch?: { ward: string; inner: boolean; ring: number; why: string; district?: string };
  building?: Omit<DirectoryEntry, 'settlement' | 'center'>;
  facility?: {
    id: string;
    type: string;
    name: string;
    settlement: string | null;
    lengthM: number;
    widthM: number;
    realLengthM: number;
    realWidthM: number;
    pinned: boolean;
    outcome: string;
    center: [number, number];
    rotation: number;
    part?: { kind: string; name?: string };
  };
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
    ways: number;
    districts: number;
    founded: number;
    peakPopulation: number;
    peakYear: number;
    abandonedBlocks: number;
    coreEndYear: number;
  }[];
  anchorYear: number;
  era: { id: string; name: string; year: number };
  regionName: string;
  riverNames: string[];
  culture: string;
  roads: { links: number; roadKm: number; bridges: number };
  rail: {
    trackKm: number;
    mainlineKm: number;
    stations: number;
    yards: number;
    tunnels: number;
    viaducts: number;
    maxGradient: number;
    disusedKm: number;
    tramKm: number;
    tramLines: number;
    crossings: number;
  };
  blocks: number;
  facilities: {
    placed: number;
    failed: number;
    byCategory: Record<string, number>;
    list: {
      id: string;
      type: string;
      name: string;
      settlement: string | null;
      pinned: boolean;
      outcome: string;
      center: [number, number];
      rotation: number;
    }[];
    failures: { id: string; type: string; settlement: string | null; reason: string }[];
    /** Buildable land inside the built-up radius with no use, as a fraction, per settlement and overall. */
    wasteland: { overall: number; bySettlement: Record<string, number> };
  };
}
