import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { LandcoverKind, Theme } from './theme.js';
import { utilityLayers } from './utilityStyle.js';

export interface CompileOptions {
  /** MapLibre source id for the generated vector tiles. */
  sourceId: string;
  tileUrl: string;
  /** Raster-DEM source id and URL for hillshade and 3-D terrain. */
  demSourceId: string;
  demTileUrl: string;
  /** Per-layer visibility overrides (layer group id → visible). */
  layers?: Partial<Record<LayerGroup, boolean>>;
  /** Glyph URL template (`{fontstack}`, `{range}`); labels are omitted without it. */
  glyphs?: string;
  /** Hide GM-only content (notes, secret overlays) for player exports. */
  player?: boolean;
  /**
   * GeoJSON sources owned by the editor on the UI thread: hand-authored features,
   * the in-progress draft/selection overlay and annotation frames. When set, the
   * style declares them (empty) and styles them; the app feeds them with setData.
   */
  editor?: { authoredSourceId: string; overlaySourceId: string; annotationSourceId: string };
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
  | 'parcels'
  | 'wealth'
  | 'density'
  | 'edits'
  | 'annotations'
  | 'rail'
  | 'stations'
  | 'facilities'
  | 'labels'
  | 'pois'
  | 'events'
  | 'age'
  | 'buildings3d'
  | 'utilities';

/** Colour stops for the age overlay: [built year, colour]. Shared with the legend. */
export const AGE_STOPS: [number, string][] = [
  [1100, '#4a2c17'],
  [1650, '#8c5a2b'],
  [1780, '#c9a227'],
  [1850, '#c0392b'],
  [1890, '#e67e22'],
  [1925, '#7f8c8d'],
  [1955, '#2980b9'],
  [1985, '#16a085'],
  [2020, '#8e44ad'],
];

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
function metresToPixels(width: string | ExpressionSpecification, min = 0.6): ExpressionSpecification {
  // px = metres * 2^z / 78271.517; exponential interpolation between the z0 and z20 stops reproduces it.
  const w: ExpressionSpecification = typeof width === 'string' ? ['get', width] : width;
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    0,
    ['max', min, ['/', w, 78271.517]],
    20,
    ['max', min, ['*', w, 13.4]],
  ];
}

/** Compile a theme into a complete MapLibre style. */
export function compileStyle(theme: Theme, options: CompileOptions): StyleSpecification {
  const p = theme.palette;
  const visible = (group: LayerGroup) => (options.layers?.[group] === false ? 'none' : 'visible');
  /** Overlays are opt-in: hidden unless the group is explicitly enabled. */
  const optIn = (group: LayerGroup) => (options.layers?.[group] === true ? 'visible' : 'none');
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
  // Earthworks under the main roads: a cutting's banks as a wide faint casing, an embankment's
  // as a narrower dark one.
  layers.push({
    id: 'roads-cutting',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'roads',
    minzoom: 12,
    filter: ['==', ['get', 'mode'], 'cutting'],
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': p.inkMuted,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 16],
      'line-opacity': 0.25,
    },
  });
  layers.push({
    id: 'roads-embankment',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'roads',
    minzoom: 12,
    filter: ['==', ['get', 'mode'], 'embankment'],
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': p.ink,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 10],
      'line-opacity': 0.35,
    },
  });
  layers.push({
    id: 'roads',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'roads',
    filter: ['!=', ['get', 'mode'], 'tunnel'],
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': t.road,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 2, 16, 6],
      ...(theme.sketch ? { 'line-dasharray': [4, 2] } : {}),
    },
  });
  layers.push({
    id: 'roads-tunnel',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'roads',
    filter: ['==', ['get', 'mode'], 'tunnel'],
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': t.road,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 2, 16, 6],
      'line-dasharray': [2, 2],
      'line-opacity': 0.7,
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
    filter: ['!=', ['get', 'state'], 'ruin'],
    layout: { visibility: visible('buildings') },
    paint: {
      'fill-color': buildingColour(theme),
      'fill-outline-color': t.buildingOutline,
      'fill-opacity': theme.buildings?.outlineOnly ? 0 : 1,
      ...(t.buildingPattern ? { 'fill-pattern': t.buildingPattern } : {}),
    },
  });
  if (theme.buildings?.outlineOnly || theme.buildings?.by === 'material') {
    layers.push({
      id: 'buildings-outline',
      type: 'line',
      source: options.sourceId,
      'source-layer': 'buildings',
      minzoom: 14,
      layout: { visibility: visible('buildings'), 'line-join': 'round' },
      paint: {
        'line-color': t.buildingOutline,
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 1.4],
      },
    });
  }
  // Condition: derelict buildings are muted, ruins are an outline only.
  layers.push({
    id: 'buildings-derelict',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 13,
    filter: ['==', ['get', 'state'], 'derelict'],
    layout: { visibility: visible('buildings') },
    paint: { 'fill-color': p.inkMuted, 'fill-opacity': 0.45 },
  });
  layers.push({
    id: 'buildings-ruin',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 13,
    filter: ['==', ['get', 'state'], 'ruin'],
    layout: { visibility: visible('buildings'), 'line-join': 'round' },
    paint: {
      'line-color': t.buildingOutline,
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 1.2],
      'line-dasharray': [2, 1.5],
    },
  });
  // Age overlay: buildings tinted by the year they were built.
  layers.push({
    id: 'buildings-age',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 12,
    filter: ['has', 'built'],
    layout: { visibility: optIn('age') },
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'built'],
        ...AGE_STOPS.flat(),
      ] as unknown as ExpressionSpecification,
      'fill-opacity': 0.85,
    },
  });
  // Disasters: floods drown the ground, fires scorch it, storms cross-hatch it.
  layers.push({
    id: 'events-flood',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'events',
    filter: ['==', ['get', 'kind'], 'flood'],
    layout: { visibility: visible('events') },
    paint: { 'fill-color': p.water, 'fill-opacity': 0.55, 'fill-outline-color': p.waterLine },
  });
  layers.push({
    id: 'events-fire',
    type: 'fill',
    source: options.sourceId,
    'source-layer': 'events',
    filter: ['==', ['get', 'kind'], 'fire'],
    layout: { visibility: visible('events') },
    paint: {
      'fill-color': '#7a2e12',
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['get', 'since'],
        0,
        0.45,
        5,
        0.05,
      ] as unknown as ExpressionSpecification,
    },
  });
  layers.push({
    id: 'events-storm',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'events',
    filter: ['==', ['get', 'kind'], 'storm'],
    layout: { visibility: visible('events') },
    paint: { 'line-color': p.inkMuted, 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  });
  // Optional 3D: extrude buildings by their floors (ruins stay low).
  layers.push({
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 13,
    filter: ['!=', ['get', 'state'], 'ruin'],
    layout: { visibility: optIn('buildings3d') },
    paint: {
      'fill-extrusion-color': buildingColour(theme) as never,
      'fill-extrusion-height': [
        '*',
        ['coalesce', ['get', 'floors'], 2],
        3.2,
      ] as unknown as ExpressionSpecification,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
    },
  });
  // Points of interest: named non-residential buildings get a dot at high zoom.
  layers.push({
    id: 'pois',
    type: 'circle',
    source: options.sourceId,
    'source-layer': 'buildings',
    minzoom: 15,
    filter: ['all', ['has', 'use'], ['!=', ['get', 'use'], 'residential']],
    layout: { visibility: visible('pois') },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 18, 4],
      'circle-color': p.accent,
      'circle-stroke-color': p.labelHalo,
      'circle-stroke-width': 1,
      'circle-translate': [0, 0],
    },
  });
  if (t.streetCasing) {
    layers.push({
      id: 'streets-casing',
      type: 'line',
      source: options.sourceId,
      'source-layer': 'streets',
      minzoom: 12,
      filter: ['!=', ['get', 'class'], 'steps'],
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
    filter: ['!=', ['get', 'class'], 'steps'],
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
            ['match', ['get', 'class'], 'artery', 1.4, 'road', 1.2, 'lane', 0.5, 0.7],
            17,
            ['match', ['get', 'class'], 'artery', 9, 'road', 7, 'lane', 2.5, 4],
          ],
    },
  });
  // Flights of steps where a lane is too steep to drive: thin, dashed, from the street zooms.
  layers.push({
    id: 'streets-steps',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'streets',
    minzoom: 14,
    filter: ['==', ['get', 'class'], 'steps'],
    layout: { visibility: visible('settlements'), 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': theme.sketch ? p.ink : t.street,
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 3.5],
      'line-dasharray': [0.6, 0.6],
    },
  });
  // Field boundaries in the farm belt.
  layers.push({
    id: 'hedges',
    type: 'line',
    source: options.sourceId,
    'source-layer': 'hedges',
    minzoom: 12,
    layout: { visibility: visible('settlements'), 'line-join': 'round' },
    paint: {
      'line-color': theme.sketch ? p.ink : p.inkMuted,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.4],
      'line-opacity': theme.sketch ? 0.7 : 0.45,
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

  // --- Facilities (ports, industry, institutions, airports) ------------------
  layers.push(...facilityLayers(theme, options, visible));

  // --- Railways and trams ---------------------------------------------------
  layers.push(...railLayers(theme, options, visible));

  // --- Utilities (mains, power lines, sewers, pipelines, canals) ------------
  layers.push(...utilityLayers(theme, options, visible));

  // --- Labels ----------------------------------------------------------------
  if (options.glyphs) layers.push(...labelLayers(theme, options, visible));

  // --- Society overlays (opt-in) --------------------------------------------
  for (const field of ['wealth', 'density'] as const) {
    const colours = theme.overlays[field];
    layers.push({
      id: `overlay-${field}`,
      type: 'fill',
      source: options.sourceId,
      'source-layer': field,
      layout: { visibility: optIn(field) },
      paint: {
        'fill-color': [
          'match',
          ['get', 'level'],
          0,
          colours[0],
          1,
          colours[1],
          2,
          colours[2],
          3,
          colours[3],
          4,
          colours[4],
          colours[5],
        ] as unknown as ExpressionSpecification,
        'fill-opacity': 0.55,
        'fill-antialias': false,
      },
    });
  }

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

  if (options.editor) layers.push(...editorLayers(theme, options, visible));

  return {
    version: 8,
    name: theme.name,
    ...(options.glyphs ? { glyphs: options.glyphs } : {}),
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
      ...(options.editor
        ? {
            [options.editor.authoredSourceId]: { type: 'geojson', data: EMPTY },
            [options.editor.overlaySourceId]: { type: 'geojson', data: EMPTY },
            [options.editor.annotationSourceId]: { type: 'geojson', data: EMPTY },
          }
        : {}),
    },
    layers,
  };
}

const EMPTY = { type: 'FeatureCollection', features: [] } as const;

/** Building fill: flat, by material (Sanborn) or by use. */
function buildingColour(theme: Theme): ExpressionSpecification | string {
  const b = theme.buildings;
  if (!b || b.by === 'flat') return theme.town.building;
  const table = b.by === 'material' ? b.materials : b.uses;
  if (!table || !Object.keys(table).length) return theme.town.building;
  return [
    'match',
    ['get', b.by],
    ...Object.entries(table).flat(),
    theme.town.building,
  ] as unknown as ExpressionSpecification;
}

/**
 * Labels: settlement names at low zoom, districts, street names along the
 * ways, river names along the water, facility and station names, and named
 * premises at the highest zooms. Every label uses the theme's glyph stack.
 */
function labelLayers(
  theme: Theme,
  options: CompileOptions,
  visible: (group: LayerGroup) => 'visible' | 'none',
): LayerSpecification[] {
  const l = theme.labels;
  const src = options.sourceId;
  const out: LayerSpecification[] = [];
  const halo = { 'text-halo-color': l.halo, 'text-halo-width': l.haloWidth, 'text-halo-blur': 0.5 };
  const upper = l.transform === 'uppercase' ? { 'text-transform': 'uppercase' as const } : {};
  out.push({
    id: 'label-settlements',
    type: 'symbol',
    source: src,
    'source-layer': 'settlements',
    maxzoom: 13,
    filter: ['has', 'name'],
    layout: {
      visibility: visible('labels'),
      'text-field': ['get', 'name'],
      'text-font': [l.fontBold],
      'text-size': [
        'interpolate',
        ['linear'],
        ['get', 'population'],
        100,
        10,
        5000,
        12,
        50000,
        15,
        250000,
        18,
      ],
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-letter-spacing': 0.05,
      ...upper,
    },
    paint: { 'text-color': l.settlement, ...halo },
  });
  out.push({
    id: 'label-districts',
    type: 'symbol',
    source: src,
    'source-layer': 'districts',
    minzoom: 12.5,
    maxzoom: 17,
    layout: {
      visibility: visible('labels'),
      'text-field': ['get', 'name'],
      'text-font': [l.font],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 16, 14],
      'text-letter-spacing': 0.12,
      'text-transform': 'uppercase',
      'text-max-width': 6,
    },
    paint: { 'text-color': l.district, 'text-opacity': 0.85, ...halo },
  });
  out.push({
    id: 'label-streets',
    type: 'symbol',
    source: src,
    'source-layer': 'ways',
    minzoom: 14,
    layout: {
      visibility: visible('labels'),
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['get', 'name'],
      'text-font': [l.font],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        ['match', ['get', 'class'], 'artery', 11, 'road', 10.5, 9],
        18,
        ['match', ['get', 'class'], 'artery', 15, 'road', 14, 12],
      ],
      'text-letter-spacing': 0.04,
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
    },
    paint: { 'text-color': l.street, ...halo },
  });
  out.push({
    id: 'label-rivers',
    type: 'symbol',
    source: src,
    'source-layer': 'rivers',
    minzoom: 11,
    filter: ['has', 'name'],
    layout: {
      visibility: visible('labels'),
      'symbol-placement': 'line',
      'symbol-spacing': 600,
      'text-field': ['get', 'name'],
      'text-font': [l.fontItalic],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
      'text-letter-spacing': 0.08,
    },
    paint: { 'text-color': l.water, ...halo },
  });
  out.push({
    id: 'label-facilities',
    type: 'symbol',
    source: src,
    'source-layer': 'facilityLabels',
    minzoom: 13,
    layout: {
      visibility: visible('labels'),
      'text-field': ['get', 'name'],
      'text-font': [l.font],
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 16, 12],
      'text-max-width': 8,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
    },
    paint: { 'text-color': l.facility, 'text-opacity': 0.9, ...halo },
  });
  out.push({
    id: 'label-stations',
    type: 'symbol',
    source: src,
    'source-layer': 'stations',
    minzoom: 12,
    filter: ['all', ['has', 'name'], ['in', ['get', 'kind'], ['literal', ['central', 'town', 'halt']]]],
    layout: {
      visibility: visible('labels'),
      'text-field': ['get', 'name'],
      'text-font': [l.fontBold],
      'text-size': 10.5,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
    },
    paint: { 'text-color': l.street, ...halo },
  });
  out.push({
    id: 'label-premises',
    type: 'symbol',
    source: src,
    'source-layer': 'buildings',
    minzoom: 17,
    filter: ['all', ['has', 'name'], ['!=', ['get', 'use'], 'residential']],
    layout: {
      visibility: visible('pois'),
      'text-field': ['get', 'name'],
      'text-font': [l.font],
      'text-size': ['interpolate', ['linear'], ['zoom'], 17, 9, 19, 12],
      'text-max-width': 7,
      'text-offset': [0, 0.6],
      'text-anchor': 'top',
    },
    paint: { 'text-color': l.facility, ...halo },
  });
  // Authored annotations: labels from the editor source when present (player mode drops GM notes).
  if (options.editor) {
    out.push({
      id: 'label-annotations',
      type: 'symbol',
      source: options.editor.annotationSourceId,
      filter: options.player
        ? ['all', ['==', ['get', 'kind'], 'label'], ['!=', ['get', 'gmOnly'], true]]
        : ['==', ['get', 'kind'], 'label'],
      layout: {
        visibility: visible('annotations'),
        'text-field': ['get', 'text'],
        'text-font': [l.fontBold],
        'text-size': 14,
        'text-letter-spacing': 0.06,
      },
      paint: { 'text-color': l.settlement, ...halo },
    });
  }
  return out;
}

/**
 * Facility footprints tinted by category with a hairline edge, then the parts
 * that make them recognisable: quays and piers, transit sheds, cranes, tanks
 * and gasholders, chimneys, docks, runways and aprons, campus grounds, graves.
 */
function facilityLayers(
  theme: Theme,
  options: CompileOptions,
  visible: (group: LayerGroup) => 'visible' | 'none',
): LayerSpecification[] {
  const p = theme.palette;
  const t = theme.town;
  const src = options.sourceId;
  const out: LayerSpecification[] = [];
  const sketch = theme.sketch;
  const kind = (...ids: string[]): ExpressionSpecification => ['in', ['get', 'kind'], ['literal', ids]];
  const isPoly: ExpressionSpecification = ['==', ['geometry-type'], 'Polygon'];
  const isLine: ExpressionSpecification = ['==', ['geometry-type'], 'LineString'];
  const isPoint: ExpressionSpecification = ['==', ['geometry-type'], 'Point'];
  const ink = sketch ? p.ink : '#4a443c';
  const paper = (colour: string) => (sketch ? p.background : colour);

  out.push({
    id: 'facilities',
    type: 'fill',
    source: src,
    'source-layer': 'facilities',
    layout: { visibility: visible('facilities') },
    paint: {
      'fill-color': sketch
        ? p.background
        : [
            'match',
            ['get', 'category'],
            'port',
            '#d8dde0',
            'industry',
            '#d9d6cf',
            'institution',
            '#e3e1d6',
            'transport',
            '#e2e6d4',
            '#e0ddd5',
          ],
      'fill-opacity': sketch ? 0.4 : 0.85,
      'fill-outline-color': ink,
    },
  });
  out.push({
    id: 'facilities-outline',
    type: 'line',
    source: src,
    'source-layer': 'facilities',
    minzoom: 11,
    layout: { visibility: visible('facilities'), 'line-join': 'round' },
    paint: {
      'line-color': ink,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.4],
      'line-dasharray': [4, 2],
      'line-opacity': 0.7,
    },
  });
  out.push({
    id: 'facility-grounds',
    type: 'fill',
    source: src,
    'source-layer': 'facilityParts',
    filter: [
      'all',
      isPoly,
      kind(
        'grounds',
        'field',
        'graves',
        'yard',
        'apron',
        'containerYard',
        'switchyard',
        'slag',
        'reservoir',
        'pond',
        'basin',
        'dock',
      ),
    ],
    layout: { visibility: visible('facilities') },
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'grounds',
        paper('#d9e2c6'),
        'field',
        paper('#cfdcb8'),
        'graves',
        paper('#c9d3b9'),
        'yard',
        paper('#cfc9bd'),
        'apron',
        paper('#c4c4c0'),
        'containerYard',
        paper('#bfc3c7'),
        'switchyard',
        paper('#cdccc6'),
        'slag',
        paper('#a9a39a'),
        p.water,
      ],
      'fill-outline-color': ink,
      'fill-opacity': sketch ? 0.5 : 1,
    },
  });
  out.push({
    id: 'facility-graves',
    type: 'line',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 14,
    filter: ['all', isPoly, kind('graves')],
    layout: { visibility: visible('facilities') },
    paint: { 'line-color': ink, 'line-width': 0.6, 'line-dasharray': [1, 2] },
  });
  out.push({
    id: 'facility-surfaces',
    type: 'fill',
    source: src,
    'source-layer': 'facilityParts',
    filter: ['all', isPoly, kind('runway', 'quay', 'pier', 'ramp', 'slipway', 'gate')],
    layout: { visibility: visible('facilities') },
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'runway',
        sketch ? p.ink : '#5c5c5c',
        'quay',
        sketch ? p.inkMuted : '#8a8478',
        'pier',
        sketch ? p.ink : '#6e6659',
        'slipway',
        sketch ? p.inkMuted : '#b3ada2',
        sketch ? p.inkMuted : '#9a9388',
      ],
      'fill-opacity': sketch ? 0.7 : 1,
    },
  });
  out.push({
    id: 'facility-buildings',
    type: 'fill',
    source: src,
    'source-layer': 'facilityParts',
    filter: [
      'all',
      isPoly,
      kind('building', 'shed', 'warehouse', 'hall', 'hangar', 'terminal', 'chapel', 'wheelhouse'),
    ],
    layout: { visibility: visible('facilities') },
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'shed',
        sketch ? t.building : '#7d7469',
        'hall',
        sketch ? t.building : '#77706a',
        'hangar',
        sketch ? t.building : '#7c7f82',
        t.building,
      ],
      'fill-outline-color': t.buildingOutline,
      ...(t.buildingPattern ? { 'fill-pattern': t.buildingPattern } : {}),
    },
  });
  out.push({
    id: 'facility-tanks',
    type: 'fill',
    source: src,
    'source-layer': 'facilityParts',
    filter: ['all', isPoly, kind('tank', 'gasholder', 'coolingTower', 'dome', 'tower')],
    layout: { visibility: visible('facilities') },
    paint: { 'fill-color': paper('#cfd2d6'), 'fill-outline-color': ink },
  });
  out.push({
    id: 'facility-tanks-outline',
    type: 'line',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 14,
    filter: ['all', isPoly, kind('tank', 'gasholder', 'coolingTower', 'dome')],
    layout: { visibility: visible('facilities') },
    paint: { 'line-color': ink, 'line-width': ['match', ['get', 'kind'], 'gasholder', 1.6, 1] },
  });
  out.push({
    id: 'facility-walls',
    type: 'line',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 13,
    filter: ['all', isPoly, kind('wall', 'fence')],
    layout: { visibility: visible('facilities'), 'line-join': 'miter' },
    paint: { 'line-color': ink, 'line-width': ['match', ['get', 'kind'], 'wall', 1.8, 0.9] },
  });
  out.push({
    id: 'facility-lines',
    type: 'line',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 12,
    filter: ['all', isLine, kind('road', 'race', 'breakwater', 'berth', 'pier')],
    layout: { visibility: visible('facilities'), 'line-cap': 'butt' },
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'road',
        sketch ? p.inkMuted : t.road,
        'race',
        p.waterLine,
        ink,
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        ['match', ['get', 'kind'], 'breakwater', 2.5, 'pier', 1.2, 1],
        17,
        ['match', ['get', 'kind'], 'breakwater', 9, 'berth', 4, 'pier', 3, 5],
      ],
    },
  });
  out.push({
    id: 'facility-tracks',
    type: 'line',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 12,
    filter: ['all', isLine, kind('track')],
    layout: { visibility: visible('facilities'), 'line-cap': 'butt' },
    paint: {
      'line-color': sketch ? p.ink : '#2f2a26',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 17, 2],
    },
  });
  out.push({
    id: 'facility-points',
    type: 'circle',
    source: src,
    'source-layer': 'facilityParts',
    minzoom: 13,
    filter: ['all', isPoint, kind('crane', 'chimney')],
    layout: { visibility: visible('facilities') },
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        1.5,
        17,
        ['match', ['get', 'kind'], 'chimney', 5, 3.5],
      ],
      'circle-color': ['match', ['get', 'kind'], 'chimney', ink, p.background],
      'circle-stroke-color': ink,
      'circle-stroke-width': 1.2,
    },
  });
  out.push({
    id: 'access-roads',
    type: 'line',
    source: src,
    'source-layer': 'accessRoads',
    layout: { visibility: visible('facilities'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': t.road,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 4],
      ...(sketch ? { 'line-dasharray': [4, 2] } : {}),
    },
  });
  return out;
}

/**
 * Railway styling by class and mode: mainlines heavy with sleepers at high
 * zoom, branches lighter, disused lines faint and dashed, tunnels and subways
 * dashed, viaducts and elevated lines with a wide casing, yards as thin
 * ladders; tram lines thin in the accent colour; stations by kind; yards and
 * sheds as hatched or grey footprints; crossings and portals as small marks.
 */
function railLayers(
  theme: Theme,
  options: CompileOptions,
  visible: (group: LayerGroup) => 'visible' | 'none',
): LayerSpecification[] {
  const p = theme.palette;
  const src = options.sourceId;
  const out: LayerSpecification[] = [];
  const cls = (...ids: string[]): ExpressionSpecification => ['in', ['get', 'class'], ['literal', ids]];
  const mode = (...ids: string[]): ExpressionSpecification => ['in', ['get', 'mode'], ['literal', ids]];
  const railInk = theme.sketch ? p.ink : '#2f2a26';
  const heavy: ExpressionSpecification = [
    'match',
    ['get', 'class'],
    'mainline',
    1,
    'branch',
    0.75,
    'spur',
    0.6,
    'yard',
    0.45,
    0.6,
  ];
  const width = (z12: number, z17: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    9,
    ['*', heavy, z12 * 0.5],
    12,
    ['*', heavy, z12],
    17,
    ['*', heavy, z17],
  ];

  // Structures first so tracks draw over them.
  out.push({
    id: 'rail-structures',
    type: 'fill',
    source: src,
    'source-layer': 'railStructures',
    minzoom: 11,
    layout: { visibility: visible('rail') },
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'railYard',
        theme.sketch ? p.background : '#d8d3ca',
        'goodsYard',
        theme.sketch ? p.background : '#cfc9bd',
        'intermodal',
        theme.sketch ? p.background : '#c9ccd2',
        'tramDepot',
        theme.sketch ? p.background : '#d4cfc4',
        theme.town.building,
      ],
      'fill-opacity': theme.sketch ? 0.6 : 0.9,
      'fill-outline-color': railInk,
    },
  });
  out.push({
    id: 'rail-structures-outline',
    type: 'line',
    source: src,
    'source-layer': 'railStructures',
    minzoom: 12,
    filter: ['in', ['get', 'kind'], ['literal', ['railYard', 'goodsYard', 'intermodal', 'tramDepot']]],
    layout: { visibility: visible('rail') },
    paint: { 'line-color': railInk, 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  });

  // Viaduct / elevated casing.
  out.push({
    id: 'rail-viaduct-casing',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: ['all', cls('mainline', 'branch', 'spur'), mode('viaduct', 'elevated')],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: { 'line-color': railInk, 'line-width': width(4, 11), 'line-opacity': 0.35 },
  });
  out.push({
    id: 'rail-viaduct-inner',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: ['all', cls('mainline', 'branch', 'spur'), mode('viaduct', 'elevated')],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: { 'line-color': p.background, 'line-width': width(2.6, 8) },
  });
  // Cuttings: a pale band.
  out.push({
    id: 'rail-cutting',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    minzoom: 12,
    filter: ['all', cls('mainline', 'branch', 'spur'), mode('cutting')],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: { 'line-color': railInk, 'line-width': width(4, 12), 'line-opacity': 0.12 },
  });
  // Surface and engineered tracks.
  out.push({
    id: 'rail-track',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: ['all', cls('mainline', 'branch', 'spur', 'yard'), ['!', mode('tunnel', 'subway')]],
    layout: { visibility: visible('rail'), 'line-join': 'round', 'line-cap': 'butt' },
    paint: { 'line-color': railInk, 'line-width': width(1.6, 3.2) },
  });
  // Sleepers: a dashed light line over the track at high zoom.
  out.push({
    id: 'rail-sleepers',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    minzoom: 13,
    filter: ['all', cls('mainline', 'branch', 'spur'), ['!', mode('tunnel', 'subway')]],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: { 'line-color': p.background, 'line-width': width(0.7, 1.4), 'line-dasharray': [3, 3] },
  });
  out.push({
    id: 'rail-tunnel',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: ['all', cls('mainline', 'branch', 'spur'), mode('tunnel')],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: {
      'line-color': railInk,
      'line-width': width(1.4, 2.6),
      'line-dasharray': [2, 2.5],
      'line-opacity': 0.55,
    },
  });
  out.push({
    id: 'rail-subway',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: ['all', cls('mainline', 'branch'), mode('subway')],
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: {
      'line-color': theme.sketch ? p.ink : '#1e4fd8',
      'line-width': width(1.6, 3),
      'line-dasharray': [1.5, 2],
      'line-opacity': 0.75,
    },
  });
  out.push({
    id: 'rail-disused',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    filter: cls('disused'),
    layout: { visibility: visible('rail'), 'line-cap': 'butt' },
    paint: {
      'line-color': p.inkMuted,
      'line-width': width(1.2, 2.2),
      'line-dasharray': [4, 3],
      'line-opacity': 0.6,
    },
  });
  out.push({
    id: 'tram-line',
    type: 'line',
    source: src,
    'source-layer': 'rail',
    minzoom: 11,
    filter: cls('tram'),
    layout: { visibility: visible('rail'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': theme.sketch ? p.ink : p.accent,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 14, 1.4, 17, 2.4],
      'line-opacity': theme.sketch ? 0.9 : 0.85,
      ...(theme.sketch ? { 'line-dasharray': [6, 1.5] } : {}),
    },
  });

  // Crossings and tunnel portals.
  out.push({
    id: 'rail-crossings',
    type: 'circle',
    source: src,
    'source-layer': 'crossings',
    minzoom: 13,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 4],
      'circle-color': [
        'match',
        ['get', 'kind'],
        'levelCrossing',
        p.accent,
        'tunnelPortal',
        railInk,
        p.background,
      ],
      'circle-stroke-color': railInk,
      'circle-stroke-width': 1,
      'circle-opacity': ['match', ['get', 'kind'], 'railUnderpass', 0.6, 1],
    },
    layout: { visibility: visible('rail') },
  });

  // Stations: rail stations as ringed circles, tram stops as small dots at high zoom.
  out.push({
    id: 'tram-stops',
    type: 'circle',
    source: src,
    'source-layer': 'stations',
    minzoom: 13,
    filter: ['in', ['get', 'kind'], ['literal', ['tramStop', 'tramTerminus']]],
    layout: { visibility: visible('stations') },
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        1.5,
        17,
        ['match', ['get', 'kind'], 'tramTerminus', 5, 3],
      ],
      'circle-color': p.background,
      'circle-stroke-color': theme.sketch ? p.ink : p.accent,
      'circle-stroke-width': 1.2,
    },
  });
  out.push({
    id: 'stations',
    type: 'circle',
    source: src,
    'source-layer': 'stations',
    minzoom: 9,
    filter: ['in', ['get', 'kind'], ['literal', ['central', 'town', 'halt', 'suburban']]],
    layout: { visibility: visible('stations') },
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['match', ['get', 'kind'], 'central', 3, 'town', 2.2, 1.5],
        14,
        ['match', ['get', 'kind'], 'central', 8, 'town', 6, 4],
        17,
        ['match', ['get', 'kind'], 'central', 14, 'town', 10, 7],
      ],
      'circle-color': ['case', ['get', 'closed'], p.inkMuted, p.background],
      'circle-stroke-color': railInk,
      'circle-stroke-width': ['match', ['get', 'kind'], 'central', 2.5, 'town', 2, 1.5],
      'circle-opacity': ['case', ['get', 'closed'], 0.5, 1],
    },
  });
  out.push({
    id: 'stations-inner',
    type: 'circle',
    source: src,
    'source-layer': 'stations',
    minzoom: 12,
    filter: ['in', ['get', 'kind'], ['literal', ['central', 'town']]],
    layout: { visibility: visible('stations') },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 17, 4],
      'circle-color': railInk,
    },
  });
  return out;
}

/** Highlight colour for selection and drafts; deliberately outside both palettes. */
export const EDITOR_ACCENT = '#2563eb';

/**
 * Styling for hand-authored features, the editor overlay and annotations. Authored
 * features carry `layer` (street, rail, …) and metre widths/radii; the overlay
 * carries `role` (draft, selection, handle, brush, hover).
 */
function editorLayers(
  theme: Theme,
  options: CompileOptions,
  visible: (group: LayerGroup) => 'visible' | 'none',
): LayerSpecification[] {
  const p = theme.palette;
  const t = theme.town;
  const src = options.editor!.authoredSourceId;
  const overlay = options.editor!.overlaySourceId;
  const ann = options.editor!.annotationSourceId;
  const isPoly: ExpressionSpecification = ['==', ['geometry-type'], 'Polygon'];
  const isLine: ExpressionSpecification = ['==', ['geometry-type'], 'LineString'];
  const isPoint: ExpressionSpecification = ['==', ['geometry-type'], 'Point'];
  const layerIn = (...ids: string[]): ExpressionSpecification => ['in', ['get', 'layer'], ['literal', ids]];
  const wardColor: ExpressionSpecification | string = Object.keys(t.ward).length
    ? ([
        'match',
        ['get', 'kind'],
        ...Object.entries(t.ward).flat(),
        t.plaza,
      ] as unknown as ExpressionSpecification)
    : p.inkMuted;
  const out: LayerSpecification[] = [];

  // Zones: tinted by ward with a dashed outline so they read as "designated", not built.
  out.push({
    id: 'authored-zones',
    type: 'fill',
    source: src,
    filter: ['all', isPoly, layerIn('zone')],
    layout: { visibility: visible('authored') },
    paint: { 'fill-color': wardColor, 'fill-opacity': theme.sketch ? 0.15 : 0.45 },
  });
  out.push({
    id: 'authored-zones-outline',
    type: 'line',
    source: src,
    filter: ['all', isPoly, layerIn('zone')],
    layout: { visibility: visible('authored'), 'line-join': 'round' },
    paint: { 'line-color': p.inkMuted, 'line-width': 1.2, 'line-dasharray': [3, 2] },
  });
  out.push({
    id: 'authored-vegetation',
    type: 'fill',
    source: src,
    filter: ['all', isPoly, layerIn('vegetation')],
    layout: { visibility: visible('authored') },
    paint: {
      'fill-color': theme.landcover.forest.color,
      'fill-opacity': theme.sketch ? 0.3 : 0.8,
      'fill-outline-color': p.inkMuted,
    },
  });
  out.push({
    id: 'authored-water-fill',
    type: 'fill',
    source: src,
    filter: ['all', isPoly, layerIn('water')],
    layout: { visibility: visible('authored') },
    paint: { 'fill-color': p.water, 'fill-outline-color': p.waterLine },
  });
  out.push({
    id: 'authored-buildings',
    type: 'fill',
    source: src,
    filter: ['all', isPoly, layerIn('building', 'facility')],
    layout: { visibility: visible('authored') },
    paint: { 'fill-color': t.building, 'fill-opacity': theme.sketch ? 0.85 : 0.95 },
  });
  out.push({
    id: 'authored-buildings-outline',
    type: 'line',
    source: src,
    filter: ['all', isPoly, layerIn('building', 'facility')],
    layout: { visibility: visible('authored'), 'line-join': 'round' },
    paint: {
      'line-color': t.buildingOutline,
      'line-width': ['case', ['==', ['get', 'layer'], 'facility'], 1.6, 0.8],
    },
  });

  // Lines with metre widths: streets, rail, tram, water, walls.
  const lineColor: ExpressionSpecification = [
    'match',
    ['get', 'layer'],
    'street',
    theme.sketch ? p.ink : t.street,
    'rail',
    p.ink,
    'tram',
    p.inkMuted,
    'water',
    theme.sketch ? p.waterLine : p.river,
    'wall',
    t.wall,
    p.accent,
  ];
  if (t.streetCasing) {
    out.push({
      id: 'authored-lines-casing',
      type: 'line',
      source: src,
      filter: ['all', isLine, layerIn('street')],
      layout: { visibility: visible('authored'), 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': t.streetCasing,
        'line-width': metresToPixels(['+', ['get', 'widthM'], 2], 1.4),
      },
    });
  }
  out.push({
    id: 'authored-lines',
    type: 'line',
    source: src,
    filter: ['all', isLine, layerIn('street', 'rail', 'tram', 'water', 'wall')],
    layout: { visibility: visible('authored'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': lineColor,
      'line-width': metresToPixels('widthM', theme.sketch ? 0.9 : 0.8),
    },
  });
  out.push({
    id: 'authored-rail-ties',
    type: 'line',
    source: src,
    filter: ['all', isLine, layerIn('rail')],
    minzoom: 12,
    layout: { visibility: visible('authored'), 'line-cap': 'butt' },
    paint: {
      'line-color': p.background,
      'line-width': metresToPixels(['*', ['get', 'widthM'], 0.4], 0.5),
      'line-dasharray': [2, 2],
    },
  });

  // Terrain and field strokes: translucent bands the width of the brush.
  const strokeColor: ExpressionSpecification = [
    'match',
    ['coalesce', ['get', 'op'], ['get', 'field']],
    'raise',
    '#b45309',
    'lower',
    '#0369a1',
    'smooth',
    '#78716c',
    'flatten',
    '#a16207',
    'water',
    p.waterLine,
    'wealth',
    '#15803d',
    'density',
    '#6d28d9',
    p.accent,
  ];
  out.push({
    id: 'authored-strokes',
    type: 'line',
    source: src,
    filter: ['all', isLine, layerIn('terrainEdit', 'fieldEdit')],
    layout: { visibility: visible('edits'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': strokeColor,
      'line-opacity': 0.22,
      'line-width': metresToPixels(['*', ['get', 'radiusM'], 2], 2),
    },
  });
  out.push({
    id: 'authored-strokes-centre',
    type: 'line',
    source: src,
    filter: ['all', isLine, layerIn('terrainEdit', 'fieldEdit')],
    layout: { visibility: visible('edits'), 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': strokeColor, 'line-opacity': 0.7, 'line-width': 1, 'line-dasharray': [4, 3] },
  });
  out.push({
    id: 'authored-stroke-points',
    type: 'circle',
    source: src,
    filter: ['all', isPoint, layerIn('terrainEdit', 'fieldEdit')],
    layout: { visibility: visible('edits') },
    paint: {
      'circle-color': strokeColor,
      'circle-opacity': 0.22,
      'circle-radius': metresToPixels('radiusM', 2),
    },
  });
  // Zone strokes (brush zones are lines with a radius).
  out.push({
    id: 'authored-zone-strokes',
    type: 'line',
    source: src,
    filter: ['all', isLine, layerIn('zone')],
    layout: { visibility: visible('authored'), 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': wardColor,
      'line-opacity': theme.sketch ? 0.2 : 0.5,
      'line-width': metresToPixels(['*', ['get', 'radiusM'], 2], 2),
    },
  });

  out.push({
    id: 'authored-points',
    type: 'circle',
    source: src,
    filter: ['all', isPoint, layerIn('poi', 'facility', 'building')],
    layout: { visibility: visible('authored') },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6],
      'circle-color': p.accent,
      'circle-stroke-color': p.background,
      'circle-stroke-width': 1.5,
    },
  });

  // Annotations: handout frames and arrows (labels and markers are DOM markers).
  out.push({
    id: 'annotation-frames',
    type: 'line',
    source: ann,
    filter: ['==', ['get', 'kind'], 'handoutFrame'],
    layout: { visibility: visible('annotations'), 'line-join': 'miter' },
    paint: { 'line-color': '#b91c1c', 'line-width': 2, 'line-dasharray': [6, 3] },
  });
  out.push({
    id: 'annotation-lines',
    type: 'line',
    source: ann,
    filter: ['all', isLine, ['==', ['get', 'kind'], 'arrow']],
    layout: { visibility: visible('annotations'), 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#b91c1c', 'line-width': 2.5 },
  });

  // Editor overlay: drafts, selection, brush footprint and vertex handles, always on top.
  const role = (r: string): ExpressionSpecification => ['==', ['get', 'role'], r];
  out.push({
    id: 'editor-brush',
    type: 'fill',
    source: overlay,
    filter: ['all', isPoly, role('brush')],
    paint: { 'fill-color': EDITOR_ACCENT, 'fill-opacity': 0.12, 'fill-outline-color': EDITOR_ACCENT },
  });
  out.push({
    id: 'editor-selection-fill',
    type: 'fill',
    source: overlay,
    filter: ['all', isPoly, role('selection')],
    paint: { 'fill-color': EDITOR_ACCENT, 'fill-opacity': 0.1 },
  });
  out.push({
    id: 'editor-selection-line',
    type: 'line',
    source: overlay,
    filter: ['all', ['any', isPoly, isLine], role('selection')],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': EDITOR_ACCENT, 'line-width': 2.5, 'line-opacity': 0.9 },
  });
  out.push({
    id: 'editor-draft-fill',
    type: 'fill',
    source: overlay,
    filter: ['all', isPoly, role('draft')],
    paint: { 'fill-color': EDITOR_ACCENT, 'fill-opacity': 0.15 },
  });
  out.push({
    id: 'editor-draft-line',
    type: 'line',
    source: overlay,
    filter: ['all', ['any', isPoly, isLine], role('draft')],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': EDITOR_ACCENT, 'line-width': 2, 'line-dasharray': [2, 2] },
  });
  out.push({
    id: 'editor-selection-point',
    type: 'circle',
    source: overlay,
    filter: ['all', isPoint, role('selection')],
    paint: {
      'circle-radius': 8,
      'circle-color': EDITOR_ACCENT,
      'circle-opacity': 0.25,
      'circle-stroke-color': EDITOR_ACCENT,
      'circle-stroke-width': 2,
    },
  });
  out.push({
    id: 'editor-handles',
    type: 'circle',
    source: overlay,
    filter: ['all', isPoint, role('handle')],
    paint: {
      'circle-radius': 4.5,
      'circle-color': '#ffffff',
      'circle-stroke-color': EDITOR_ACCENT,
      'circle-stroke-width': 2,
    },
  });
  out.push({
    id: 'editor-hover',
    type: 'line',
    source: overlay,
    filter: ['all', ['any', isPoly, isLine], role('hover')],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': EDITOR_ACCENT, 'line-width': 1.5, 'line-opacity': 0.6 },
  });
  return out;
}
