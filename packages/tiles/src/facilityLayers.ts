import type { FeatureCollection, Geometry } from 'geojson';
import type { FacilitiesOutput } from '@citygen/core';
import type { TileLayerInput } from './builder.js';

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/**
 * Eager vector layers for placed facilities: footprints (by category) and
 * their parts (quays, sheds, cranes, tanks, runways…), plus their access roads.
 * Facility rail spurs join the rail layer through `railLayers`.
 */
export function facilityLayers(facilities: FacilitiesOutput | null): TileLayerInput[] {
  const empty: AnyFc = { type: 'FeatureCollection', features: [] };
  return [
    { name: 'facilities', features: (facilities?.features ?? empty) as unknown as AnyFc, minZoom: 9 },
    { name: 'facilityParts', features: (facilities?.parts ?? empty) as unknown as AnyFc, minZoom: 12 },
    { name: 'accessRoads', features: (facilities?.roads ?? empty) as unknown as AnyFc, minZoom: 10 },
  ];
}
