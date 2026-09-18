import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LandcoverKind, Theme } from './theme.js';

export interface CompileOptions {
  /** MapLibre source id for the generated vector tiles. */
  sourceId: string;
  tileUrl: string;
  /** Raster-DEM source id and URL for hillshade and 3-D terrain. */
  demSourceId: string;
  demTileUrl: string;
  /** Per-layer visibility overrides (layer group id → visible). */
  layers?: Partial<Record<LayerGroup, boolean>>;
}

export type LayerGroup =
  | 'relief'
  | 'hillshade'
  | 'landcover'
  | 'water'
  | 'rivers'
  | 'contours'
  | 'graticule'
  | 'authored'
  | 'settlements'
  | 'buildings'
  | 'parcels';

const LANDCOVER_KINDS: LandcoverKind[] = [
  'snow',
  'rock',
  'marsh',
  'forest',
  'farmland',
  'open',
  'sand',
  'mangrove',
];

/** Pixels per metre at zoom z (512 px tiles at the equator) as a MapLibre expression factor. */
function metresToPixels(widthProperty: string, min = 0.6): ExpressionSpecification {
  // px = metres * 2^z / 78271.517; exponential interpolation between the z0 and z20 stops reproduces it.
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    0,
    ['max', min, ['/', ['get', widthProperty], 78271.517]],
    20,
    ['max', min, ['*', ['get', widthProperty], 13.4]],
  ];
}

/** Compile a theme into a complete MapLibre style. */
export function compileStyle(theme: Theme, options: CompileOptions): StyleSpecification {
  const p = theme.palette;
  const visible = (group: LayerGroup) => (options.layers?.[group] === false ? 'none' : 'visible');
  const layers: LayerSpecification[] = [];

  layers.push({ id: 'background', type: 'background', paint: { 'background-color': p.background } });
  layers.push({
    id: 'region-land',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'region',
    paint: { 'fill-color': p.land },
  });

  if (theme.relief.length > 0) {
    layers.push({
      id: 'relief',
      type: 'color-relief',
      source: options.demSourceId,
      layout: { visibility: visible('relief') },
      paint: {
        'color-relief-color': [
          'interpolate',
          ['linear'],
          ['elevation'],
          ...theme.relief.flat(),
        ] as ExpressionSpecification,
        'color-relief-opacity': 0.75,
      },
    });
  }

  // Land cover: one fill layer per kind so patterns and colours can differ.
  for (const kind of LANDCOVER_KINDS) {
    const paint = theme.landcover[kind];
    layers.push({
      id: `landcover-${kind}`,
      type: 'fill',
      source: options.sourceId,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'kind'], kind],
      layout: { visibility: visible('landcover') },
      paint: {
        'fill-color': paint.color,
        'fill-opacity': paint.opacity ?? (theme.relief.length > 0 ? 0.7 : 1),
        ...(paint.pattern ? { 'fill-pattern': paint.pattern } : {}),
        'fill-antialias': false,
      },
    });
  }

  layers.push({
    id: 'hillshade',
    type: 'hillshade',
    source: options.demSourceId,
    layout: { visibility: visible('hillshade') },
    paint: {
      'hillshade-exaggeration': theme.hillshade.exaggeration,
      'hillshade-shadow-color': theme.hillshade.shadow,
      'hillshade-highlight-color': theme.hillshade.highlight,
      'hillshade-accent-color': theme.hillshade.accent,
      'hillshade-illumination-direction': 315,
    },
  });

  layers.push({
    id: 'water-fill',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'water',
    layout: { visibility: visible('water') },
    paint: theme.sketch
      ? { 'fill-color': p.water, 'fill-pattern': 'ink-water', 'fill-antialias': false }
      : { 'fill-color': p.water },
  });
  layers.push({
    id: 'water-line',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'water',
    layout: { visibility: visible('water'), 'line-join': 'round' },
    paint: {
      'line-color': p.waterLine,
      'line-width': theme.sketch ? ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 1.6] : 0.8,
      'line-opacity': theme.sketch ? 1 : 0.7,
    },
  });

  layers.push({
    id: 'rivers',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'rivers',
    layout: { visibility: visible('rivers'), 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': p.river, 'line-width': metresToPixels('widthM', theme.sketch ? 0.7 : 0.9) },
  });

  layers.push({
    id: 'contours-minor',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'contours',
    minzoom: 11,
    filter: ['!', ['get', 'major']],
    layout: { visibility: theme.contours.minor ? visible('contours') : 'none', 'line-join': 'round' },
    paint: {
      'line-color': p.contour,
      'line-width': theme.sketch ? 0.5 : 0.6,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 13, 0.6],
    },
  });
  layers.push({
    id: 'contours-major',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'contours',
    minzoom: 8,
    filter: ['get', 'major'],
    layout: { visibility: visible('contours'), 'line-join': 'round' },
    paint: {
      'line-color': p.contourMajor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.2],
      'line-opacity': 0.75,
    },
  });

  // --- Settlements ---------------------------------------------------------
  const t = theme.town;
  const wardEntries = Object.entries(t.ward);
  layers.push({
    id: 'patches',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'patches',
    layout: { visibility: visible('settlements') },
    paint: {
      'fill-color': wardEntries.length
        ? (['match', ['get', 'ward'], ...wardEntries.flat(), p.land] as unknown as ExpressionSpecification)
        : p.land,
      'fill-opacity': theme.sketch ? 1 : 0.9,
      'fill-antialias': false,
    },
  });
  layers.push({
    id: 'roads',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'roads',
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': t.road,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 2, 16, 6],
      ...(theme.sketch ? { 'line-dasharray': [4, 2] } : {}),
    },
  });
  layers.push({
    id: 'bridges',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'bridges',
    layout: { visibility: visible('settlements'), 'line-cap': 'butt' },
    paint: {
      'line-color': p.ink,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 10],
      'line-opacity': 0.8,
    },
  });
  layers.push({
    id: 'parcels',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'parcels',
    minzoom: 15,
    layout: { visibility: visible('parcels') },
    paint: { 'line-color': t.parcel, 'line-width': 0.5, 'line-opacity': 0.8 },
  });
  layers.push({
    id: 'buildings',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 13,
    layout: { visibility: visible('buildings') },
    paint: {
      'fill-color': t.building,
      'fill-outline-color': t.buildingOutline,
      ...(t.buildingPattern ? { 'fill-pattern': t.buildingPattern } : {}),
    },
  });
  if (t.streetCasing) {
    layers.push({
      id: 'streets-casing',
      type: 'line',
      source: options.sourceId,
      'source-layer': 'streets',
      minzoom: 12,
      layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': t.streetCasing,
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          12,
          ['match', ['get', 'class'], 'artery', 2.2, 'road', 1.8, 1.2],
          17,
          ['match', ['get', 'class'], 'artery', 12, 'road', 9, 6],
        ],
      },
    });
  }
  layers.push({
    id: 'streets',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'streets',
    minzoom: 11,
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': theme.sketch ? p.ink : t.street,
      'line-width': theme.sketch
        ? [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['match', ['get', 'class'], 'artery', 1.2, 0.5],
            17,
            ['match', ['get', 'class'], 'artery', 3, 1.2],
          ]
        : [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            12,
            ['match', ['get', 'class'], 'artery', 1.4, 'road', 1.2, 0.7],
            17,
            ['match', ['get', 'class'], 'artery', 9, 'road', 7, 4],
          ],
    },
  });
  layers.push({
    id: 'walls',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'walls',
    layout: { visibility: visible('settlements'), 'line-join': 'miter' },
    paint: {
      'line-color': t.wall,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 4, 17, 9],
    },
  });
  layers.push({
    id: 'gates',
    type: 'circle',
    source: options.sourceId,
    'source-layer': 'gates',
    minzoom: 12,
    layout: { visibility: visible('settlements') },
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        ['match', ['get', 'kind'], 'gate', 2.5, 1.5],
        17,
        ['match', ['get', 'kind'], 'gate', 9, 5],
      ],
      'circle-color': t.wall,
      'circle-stroke-color': p.labelHalo,
      'circle-stroke-width': 1,
    },
  });
  layers.push({
    id: 'settlement-markers',
    type: 'circle',
    source: options.sourceId,
    'source-layer': 'settlements',
    maxzoom: 11,
    layout: { visibility: visible('settlements') },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'population'], 100, 2.5, 5000, 5, 50000, 9],
      'circle-color': t.settlementMarker,
      'circle-stroke-color': p.labelHalo,
      'circle-stroke-width': 1.5,
    },
  });

  layers.push({
    id: 'graticule',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'graticule',
    layout: { visibility: visible('graticule') },
    paint: {
      'line-color': p.inkMuted,
      'line-opacity': ['case', ['get', 'major'], 0.35, 0.15],
      'line-width': ['case', ['get', 'major'], 1, 0.5],
    },
  });
  layers.push({
    id: 'region-outline',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'region',
    paint: { 'line-color': p.ink, 'line-width': theme.sketch ? 1.5 : 1.2 },
  });

  layers.push({
    id: 'authored-lines',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'authored',
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
    layout: { visibility: visible('authored'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['match', ['get', 'layer'], 'rail', p.ink, 'water', p.waterLine, p.accent],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 4],
    },
  });
  layers.push({
    id: 'authored-polygons',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'authored',
    filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
    layout: { visibility: visible('authored') },
    paint: { 'fill-color': p.accent, 'fill-opacity': 0.35, 'fill-outline-color': p.accent },
  });

  return {
    version: 8,
    name: theme.name,
    sources: {
      [options.sourceId]: { type: 'vector', tiles: [options.tileUrl], minzoom: 0, maxzoom: 20 },
      [options.demSourceId]: {
        type: 'raster-dem',
        tiles: [options.demTileUrl],
        tileSize: 256,
        encoding: 'terrarium',
        minzoom: 6,
        maxzoom: 16,
      },
    },
    layers,
  };
}
