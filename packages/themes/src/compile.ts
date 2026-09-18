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
  | 'annotations';

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
