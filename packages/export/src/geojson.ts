import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { clipToFrame, type ExportModel } from './model.js';

/**
 * GeoJSON of a frame in model metres (a planar synthetic CRS declared in
 * `properties.crs` at the collection level), one feature per model element
 * with a `layer` property, so GIS tools can style it.
 */
export function exportGeoJson(
  model: ExportModel,
  options: { player?: boolean } = {},
): FeatureCollection<Geometry, Record<string, unknown>> & {
  crs: unknown;
  properties: Record<string, unknown>;
} {
  const layers: [string, { features: Feature<Geometry, Record<string, unknown>>[] }][] = [
    ['water', model.water],
    ['rivers', model.rivers],
    ['landcover', model.landcover],
    ['contours', model.contours],
    ['patches', model.patches],
    ['streets', model.streets],
    ['walls', model.walls],
    ['roads', model.roads],
    ['bridges', (model.bridges ?? { type: 'FeatureCollection', features: [] }) as typeof model.roads],
    ['rail', model.rail],
    ['stations', model.stations],
    ['railStructures', model.railStructures],
    ['facilities', model.facilities],
    ['facilityParts', model.facilityParts],
    ['buildings', model.buildings],
    ['districts', model.districts],
    ['authored', model.authored],
    [
      'utilities',
      { features: (model.utilities?.features ?? []).filter((f) => !options.player || !f.properties.gmOnly) },
    ],
    [
      'utilityPoints',
      {
        features: (model.utilityPoints?.features ?? []).filter(
          (f) => !options.player || !f.properties.gmOnly,
        ),
      },
    ],
    [
      'utilityAreas',
      {
        features: (model.utilityAreas?.features ?? []).filter((f) => !options.player || !f.properties.gmOnly),
      },
    ],
    [
      'annotations',
      { features: model.annotations.features.filter((a) => !options.player || !a.properties.gmOnly) },
    ],
  ];
  const features: Feature<Geometry, Record<string, unknown>>[] = [];
  for (const [layer, fc] of layers) {
    for (const f of clipToFrame(fc as FeatureCollection<Geometry, Record<string, unknown>>, model.frame)
      .features) {
      features.push({ ...f, properties: { layer, ...f.properties } });
    }
  }
  return {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'citygen:planar-metres' } },
    properties: {
      name: model.name,
      year: model.year,
      frame: model.frame,
      units: 'metres',
      note: 'Planar coordinates in metres from the region centre, x east, y north.',
    },
    features,
  };
}

/** Directory rows as CSV (RFC 4180 quoting). */
export function directoryCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const q = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => q(r[c])).join(','))].join('\n');
}
