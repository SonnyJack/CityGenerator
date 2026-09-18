import type { FeatureCollection, Geometry } from 'geojson';
import type { RoadsOutput, SitingOutput, SocietyOutput, TownOutput } from '@citygen/core';
import type { TileLayerInput } from './builder.js';

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/** Eager vector layers for the society fields: class polygons for the wealth and density overlays. */
export function societyLayers(society: SocietyOutput): TileLayerInput[] {
  return [
    { name: 'wealth', features: society.wealthPolygons as unknown as AnyFc, minZoom: 8 },
    { name: 'density', features: society.densityPolygons as unknown as AnyFc, minZoom: 8 },
  ];
}

/** Eager vector layers for settlements: patches, streets, walls, gates, regional roads, settlement points. */
export function settlementLayers(
  towns: TownOutput[],
  roads: RoadsOutput | null,
  siting: SitingOutput | null,
): TileLayerInput[] {
  const merge = (pick: (t: TownOutput) => AnyFc): AnyFc => ({
    type: 'FeatureCollection',
    features: towns.flatMap((t) => pick(t).features),
  });
  return [
    { name: 'patches', features: merge((t) => t.patches as unknown as AnyFc), minZoom: 9 },
    { name: 'streets', features: merge((t) => t.streets as unknown as AnyFc), minZoom: 11 },
    { name: 'walls', features: merge((t) => t.walls as unknown as AnyFc), minZoom: 9 },
    { name: 'gates', features: merge((t) => t.gates as unknown as AnyFc), minZoom: 12 },
    {
      name: 'roads',
      features: (roads?.roads ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc,
    },
    {
      name: 'bridges',
      features: (roads?.bridges ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc,
      minZoom: 11,
    },
    {
      name: 'settlements',
      features: {
        type: 'FeatureCollection',
        features: (siting?.points ?? []) as unknown as AnyFc['features'],
      },
    },
  ];
}
