import type { FeatureCollection, Geometry } from 'geojson';
import type { RoadsOutput, SitingOutput, SocietyOutput, TownNamesOutput, TownOutput } from '@citygen/core';
import type { TileLayerInput } from './builder.js';

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/** Eager vector layers for the society fields: class polygons for the wealth and density overlays. */
export function societyLayers(society: SocietyOutput): TileLayerInput[] {
  return [
    { name: 'wealth', features: society.wealthPolygons as unknown as AnyFc, minZoom: 8 },
    { name: 'density', features: society.densityPolygons as unknown as AnyFc, minZoom: 8 },
  ];
}

export interface NamesForLayers {
  /** Per town, street feature id → name and patch id → district. */
  towns: TownNamesOutput[];
  siteNames: Record<string, string>;
}

/** Eager vector layers for settlements: patches, streets, walls, gates, regional roads, settlement points. */
export function settlementLayers(
  towns: TownOutput[],
  roads: RoadsOutput | null,
  siting: SitingOutput | null,
  names: NamesForLayers | null = null,
): TileLayerInput[] {
  const merge = (pick: (t: TownOutput) => AnyFc): AnyFc => ({
    type: 'FeatureCollection',
    features: towns.flatMap((t) => pick(t).features),
  });
  const streetNames = new Map<string, string>();
  const districts = new Map<string, string>();
  for (const t of names?.towns ?? []) {
    for (const [k, v] of Object.entries(t.streetNames)) streetNames.set(k, v);
    for (const [k, v] of Object.entries(t.patchDistricts)) districts.set(k, v);
  }
  const withName = (fc: AnyFc, lookup: Map<string, string>, key: string): AnyFc =>
    lookup.size
      ? {
          type: 'FeatureCollection',
          features: fc.features.map((f) => ({
            ...f,
            properties: { ...f.properties, [key]: lookup.get(String(f.id)) },
          })),
        }
      : fc;
  const settlementPoints: AnyFc['features'] = ((siting?.points ?? []) as unknown as AnyFc['features']).map(
    (f) => ({
      ...f,
      properties: {
        ...f.properties,
        name: f.properties.name ?? names?.siteNames[String(f.id).replace(/^settlement-/, '')],
      },
    }),
  );
  return [
    {
      name: 'patches',
      features: withName(
        merge((t) => t.patches as unknown as AnyFc),
        districts,
        'district',
      ),
      minZoom: 9,
    },
    {
      name: 'streets',
      features: withName(
        merge((t) => t.streets as unknown as AnyFc),
        streetNames,
        'name',
      ),
      minZoom: 11,
    },
    {
      name: 'ways',
      features: {
        type: 'FeatureCollection',
        features: (names?.towns ?? []).flatMap((t) => t.ways.features as unknown as AnyFc['features']),
      },
      minZoom: 13,
    },
    {
      name: 'districts',
      features: {
        type: 'FeatureCollection',
        features: (names?.towns ?? []).flatMap((t) => t.districts.features as unknown as AnyFc['features']),
      },
      minZoom: 11,
    },
    { name: 'walls', features: merge((t) => t.walls as unknown as AnyFc), minZoom: 9 },
    {
      name: 'hedges',
      features: merge((t) => (t.hedges ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc),
      minZoom: 12,
    },
    { name: 'gates', features: merge((t) => t.gates as unknown as AnyFc), minZoom: 12 },
    {
      name: 'roads',
      features: (roads?.roads ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc,
    },
    {
      name: 'bridges',
      features: {
        type: 'FeatureCollection',
        features: [
          ...((roads?.bridges.features ?? []) as unknown as AnyFc['features']),
          ...merge((t) => (t.bridges ?? { type: 'FeatureCollection', features: [] }) as unknown as AnyFc)
            .features,
        ],
      },
      minZoom: 11,
    },
    {
      name: 'settlements',
      features: { type: 'FeatureCollection', features: settlementPoints },
    },
  ];
}
