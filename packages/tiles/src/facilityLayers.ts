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
    {
      name: 'facilityLabels',
      features: {
        type: 'FeatureCollection',
        features: (facilities?.features.features ?? []).map((f) => {
          const ring = f.geometry.coordinates[0]!;
          const n = ring.length - 1 || 1;
          let x = 0;
          let y = 0;
          for (let i = 0; i < n; i++) {
            x += ring[i]![0]!;
            y += ring[i]![1]!;
          }
          return {
            type: 'Feature' as const,
            id: `${f.properties.id}-label`,
            geometry: { type: 'Point' as const, coordinates: [x / n, y / n] },
            properties: { name: f.properties.name, category: f.properties.category, id: f.properties.id },
          };
        }),
      },
      minZoom: 12,
    },
  ];
}
