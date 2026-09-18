import type { FeatureCollection, Geometry } from 'geojson';
import type { LandcoverOutput, TerrainOutput } from '@citygen/core';
import type { TileLayerInput } from './builder.js';
import { createSketch } from './sketch.js';

export interface TerrainLayerOptions {
  /** Apply the hand-drawn sketch displacement (ink theme). */
  sketch?: { seed: string };
  /** River feature id → name for labels. */
  riverNames?: Record<string, string>;
}

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/**
 * Vector tile layers for the terrain: water polygons, rivers, land cover and
 * contours. With `sketch`, two displaced variants are indexed for coarse and
 * fine zoom bands so the wobble stays visible at both scales.
 */
export function terrainLayers(
  terrain: TerrainOutput,
  landcover: LandcoverOutput | null,
  options: TerrainLayerOptions = {},
): TileLayerInput[] {
  const water: AnyFc = {
    type: 'FeatureCollection',
    features: [...terrain.seaPolygons.features, ...terrain.lakePolygons.features] as AnyFc['features'],
  };
  const base: Record<string, AnyFc> = {
    water,
    rivers: options.riverNames
      ? {
          type: 'FeatureCollection',
          features: terrain.riverLines.features.map((f) => ({
            ...f,
            properties: { ...f.properties, name: options.riverNames![String(f.id)] },
          })),
        }
      : (terrain.riverLines as unknown as AnyFc),
    contours: terrain.contours as unknown as AnyFc,
    landcover: (landcover?.polygons ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc,
  };
  if (!options.sketch) {
    return Object.entries(base).map(([name, features]) => ({ name, features }));
  }
  const coarse = createSketch(options.sketch.seed, { amplitudeM: 45, wavelengthM: 1400 });
  const fine = createSketch(options.sketch.seed, { amplitudeM: 7, wavelengthM: 220 });
  const layers: TileLayerInput[] = [];
  for (const [name, features] of Object.entries(base)) {
    layers.push({ name, features: coarse.collection(features), zoomRange: [0, 11] });
    layers.push({ name, features: fine.collection(features), zoomRange: [12, 24] });
  }
  return layers;
}
