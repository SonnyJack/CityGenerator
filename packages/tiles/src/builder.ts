import GeoJSONVT, { type LegacyTile } from 'geojson-vt';
import { fromGeojsonVt } from 'vt-pbf';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { collectionToLonLat } from '@citygen/core';

/**
 * A TileSource wraps a set of named GeoJSON layers (in model metres) and
 * serves Mapbox Vector Tiles for MapLibre. Layers are converted once to the
 * synthetic lon/lat CRS and indexed with geojson-vt; tiles are encoded on
 * request with vt-pbf.
 *
 * Phase 0 indexes whole layers. Later phases replace this with block-assembled
 * tiles (DESIGN §8.1) behind the same `getTile` contract.
 */

export interface TileLayerInput {
  name: string;
  features: FeatureCollection<Geometry, Record<string, unknown>>;
  /** Minimum zoom at which this layer is emitted. */
  minZoom?: number;
  /** Zoom band [min, max] in which this entry is emitted; several entries may share a name. */
  zoomRange?: [number, number];
}

interface IndexedLayer {
  name: string;
  minZoom: number;
  maxZoom: number;
  index: GeoJSONVT;
}

export const TILE_EXTENT = 4096;

/** A provider of per-tile layers computed on demand (e.g. lazily generated blocks). */
export interface TileLayerProvider {
  getTile(z: number, x: number, y: number): Record<string, LegacyTile> | null;
}

export class TileSource {
  private readonly layers: IndexedLayer[];
  private readonly providers: TileLayerProvider[];
  readonly version: number;

  constructor(layers: TileLayerInput[], version = 0, providers: TileLayerProvider[] = []) {
    this.version = version;
    this.providers = providers;
    this.layers = layers.map((layer) => ({
      name: layer.name,
      minZoom: layer.zoomRange?.[0] ?? layer.minZoom ?? 0,
      maxZoom: layer.zoomRange?.[1] ?? 24,
      index: new GeoJSONVT(withStringIds(collectionToLonLat(layer.features)), {
        extent: TILE_EXTENT,
        maxZoom: 20,
        indexMaxZoom: 6,
        indexMaxPoints: 100_000,
        tolerance: 3,
        buffer: 64,
        promoteId: '__id',
      }),
    }));
  }

  /** Encoded MVT for a tile, or null when no layer has data there. */
  getTile(z: number, x: number, y: number): Uint8Array | null {
    const tiles: Record<string, LegacyTile> = {};
    for (const layer of this.layers) {
      if (z < layer.minZoom || z > layer.maxZoom) continue;
      const tile = layer.index.getTile(z, x, y);
      if (!tile || tile.features.length === 0) continue;
      const existing = tiles[layer.name];
      tiles[layer.name] = existing ? { features: [...existing.features, ...tile.features] } : tile;
    }
    for (const provider of this.providers) {
      const extra = provider.getTile(z, x, y);
      if (!extra) continue;
      for (const [name, tile] of Object.entries(extra)) {
        const existing = tiles[name];
        tiles[name] = existing ? { features: [...existing.features, ...tile.features] } : tile;
      }
    }
    if (Object.keys(tiles).length === 0) return null;
    return fromGeojsonVt(tiles, { version: 2, extent: TILE_EXTENT });
  }
}

/**
 * geojson-vt keeps only `properties`; copy feature ids in so MapLibre feature-state
 * works, and drop undefined values, which the vector-tile encoder cannot represent.
 */
function withStringIds<G extends Geometry, P extends Record<string, unknown>>(
  fc: FeatureCollection<G, P>,
): FeatureCollection<G, P & { __id?: string }> {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f: Feature<G, P>) => ({
      ...f,
      properties: cleanProperties({
        ...f.properties,
        __id: f.id === undefined ? undefined : String(f.id),
      }) as P & { __id?: string },
    })),
  };
}

/** Properties without undefined values (vt-pbf rejects them). */
export function cleanProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) out[k] = v;
  return out;
}
