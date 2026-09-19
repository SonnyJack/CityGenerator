import type { FeatureCollection, Geometry } from 'geojson';
import type { UtilitiesOutput } from '@citygen/core';
import type { TileLayerInput } from './builder.js';

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/**
 * Eager vector layers for the utility networks: trunk lines (mains, power
 * lines, pipelines, canals) from zoom 9, the distribution mains and sewer
 * branches under the streets from zoom 13, and the points and areas
 * (reservoirs, substations, pylons, outfalls, locks) from zoom 11.
 */
export function utilityLayers(utilities: UtilitiesOutput | null): TileLayerInput[] {
  const empty: AnyFc = { type: 'FeatureCollection', features: [] };
  const lines = (utilities?.lines.features ?? []) as unknown as AnyFc['features'];
  const points = (utilities?.points.features ?? []) as unknown as AnyFc['features'];
  const fine = (f: AnyFc['features'][number]) =>
    f.properties.kind === 'distribution' || f.properties.kind === 'branch';
  return [
    {
      name: 'utilities',
      features: { type: 'FeatureCollection', features: lines.filter((f) => !fine(f)) },
      minZoom: 9,
    },
    { name: 'utilities', features: { type: 'FeatureCollection', features: lines.filter(fine) }, minZoom: 13 },
    {
      name: 'utilityPoints',
      features: { type: 'FeatureCollection', features: points.filter((f) => f.properties.kind !== 'pole') },
      minZoom: 11,
    },
    // Telegraph poles every 150 m along the railway: only when the map is close enough.
    {
      name: 'utilityPoints',
      features: { type: 'FeatureCollection', features: points.filter((f) => f.properties.kind === 'pole') },
      minZoom: 14,
    },
    { name: 'utilityAreas', features: (utilities?.areas ?? empty) as unknown as AnyFc, minZoom: 11 },
  ];
}
