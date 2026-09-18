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
  /** Maximum zoom for which geojson-vt precomputes; higher zooms are drilled on demand. */
  maxZoom?: number;
}

interface IndexedLayer {
  name: string;
  minZoom: number;
  index: GeoJSONVT;
}

export const TILE_EXTENT = 4096;

export class TileSource {
  private readonly layers: IndexedLayer[];
  readonly version: number;

  constructor(layers: TileLayerInput[], version = 0) {
    this.version = version;
    this.layers = layers.map((layer) => ({
      name: layer.name,
      minZoom: layer.minZoom ?? 0,
      index: new GeoJSONVT(withStringIds(collectionToLonLat(layer.features)), {
        extent: TILE_EXTENT,
        maxZoom: layer.maxZoom ?? 20,
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
      if (z < layer.minZoom) continue;
      const tile = layer.index.getTile(z, x, y);
      if (tile && tile.features.length > 0) tiles[layer.name] = tile;
    }
    if (Object.keys(tiles).length === 0) return null;
    return fromGeojsonVt(tiles, { version: 2, extent: TILE_EXTENT });
  }
}

/** geojson-vt keeps only `properties`; copy feature ids in so MapLibre feature-state works. */
function withStringIds<G extends Geometry, P extends Record<string, unknown>>(
  fc: FeatureCollection<G, P>,
): FeatureCollection<G, P & { __id?: string }> {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f: Feature<G, P>) => ({
      ...f,
      properties: { ...f.properties, __id: f.id === undefined ? undefined : String(f.id) },
    })),
  };
}
