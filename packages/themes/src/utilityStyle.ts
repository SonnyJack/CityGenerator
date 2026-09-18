import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { CompileOptions, LayerGroup } from './compile.js';
import type { Theme } from './theme.js';

/** Utility colours per theme family: fixed inks on light themes, lighter on dark, the theme ink when sketching. */
export function utilityColours(theme: Theme): Record<string, string> {
  const p = theme.palette;
  if (theme.sketch)
    return {
      waterMain: p.ink,
      gasMain: p.ink,
      powerLine: p.ink,
      sewer: p.inkMuted,
      pipeline: p.ink,
      canal: p.waterLine,
    };
  const dark = theme.id === 'dark';
  return {
    waterMain: dark ? '#6fb1e8' : '#2f7bbf',
    gasMain: dark ? '#e0b45a' : '#b8860b',
    powerLine: dark ? '#d8d8d8' : '#3a3a3a',
    sewer: dark ? '#c99a6b' : '#7a4b2a',
    pipeline: dark ? '#e07070' : '#8b2e2e',
    canal: p.waterLine,
  };
}

/**
 * Utility networks: canals as water with a casing (dashed when disused),
 * mains and pipelines as thin dashed lines in a colour per network, power
 * lines solid with pylon dots, sewers dotted and hidden on player exports,
 * and the works (reservoirs, substations, sewage works, basins) as small
 * footprints with a point marker.
 */
export function utilityLayers(
  theme: Theme,
  options: CompileOptions,
  visible: (group: LayerGroup) => 'visible' | 'none',
): LayerSpecification[] {
  const p = theme.palette;
  const src = options.sourceId;
  const c = utilityColours(theme);
  const out: LayerSpecification[] = [];
  const cls = (...ids: string[]): ExpressionSpecification => ['in', ['get', 'class'], ['literal', ids]];
  const notGm: ExpressionSpecification = ['!=', ['get', 'gmOnly'], true];
  const gm = (f: ExpressionSpecification): ExpressionSpecification =>
    options.player ? ['all', f, notGm] : f;
  // Zoom must drive a top-level interpolate, so the per-feature factor goes inside each stop.
  const width = (
    mult: ExpressionSpecification | number,
    z13: number,
    z17: number,
  ): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    9,
    ['*', mult, z13 * 0.5],
    13,
    ['*', mult, z13],
    17,
    ['*', mult, z17],
  ];
  const byKind = (trunk: number, fine: number): ExpressionSpecification => [
    'match',
    ['get', 'kind'],
    ['distribution', 'branch'],
    fine,
    trunk,
  ];

  out.push({
    id: 'utility-areas',
    type: 'fill',
    source: src,
    'source-layer': 'utilityAreas',
    minzoom: 11,
    filter: gm(['has', 'kind']),
    layout: { visibility: visible('utilities') },
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        ['reservoir', 'canalBasin'],
        p.water,
        'substation',
        theme.sketch ? p.background : '#b9b9b9',
        'sewageWorks',
        theme.sketch ? p.background : '#cdc5a9',
        p.land,
      ],
      'fill-opacity': theme.sketch ? 0.7 : 0.9,
      'fill-outline-color': p.inkMuted,
    },
  });
  out.push({
    id: 'utility-canal-casing',
    type: 'line',
    source: src,
    'source-layer': 'utilities',
    filter: cls('canal'),
    layout: { visibility: visible('utilities'), 'line-cap': 'butt' },
    paint: {
      'line-color': c.canal,
      'line-width': width(1, 5.5, 13.5),
      'line-opacity': ['match', ['get', 'status'], 'disused', 0.5, 0.9],
    },
  });
  out.push({
    id: 'utility-canal',
    type: 'line',
    source: src,
    'source-layer': 'utilities',
    filter: cls('canal'),
    layout: { visibility: visible('utilities'), 'line-cap': 'butt' },
    paint: {
      'line-color': p.water,
      'line-width': width(1, 4, 12),
      'line-opacity': ['match', ['get', 'status'], 'disused', 0.6, 1],
    },
  });
  out.push({
    id: 'utility-canal-disused',
    type: 'line',
    source: src,
    'source-layer': 'utilities',
    filter: ['all', cls('canal'), ['==', ['get', 'status'], 'disused']],
    layout: { visibility: visible('utilities') },
    paint: { 'line-color': p.inkMuted, 'line-width': 0.8, 'line-dasharray': [3, 3] },
  });
  const dashed = (id: string, klass: string, dash: number[], colour: string, minzoom = 9) =>
    out.push({
      id,
      type: 'line',
      source: src,
      'source-layer': 'utilities',
      minzoom,
      filter: gm(cls(klass)),
      layout: { visibility: visible('utilities') },
      paint: {
        'line-color': colour,
        'line-width': width(byKind(1, 0.6), 1.6, 3),
        'line-dasharray': dash,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 0.85],
      },
    });
  dashed('utility-water', 'waterMain', [4, 2], c.waterMain!);
  dashed('utility-gas', 'gasMain', [2, 2], c.gasMain!);
  dashed('utility-pipeline', 'pipeline', [6, 3], c.pipeline!);
  dashed('utility-sewer', 'sewer', [1, 2], c.sewer!, 10);
  out.push({
    id: 'utility-power',
    type: 'line',
    source: src,
    'source-layer': 'utilities',
    filter: cls('powerLine'),
    layout: { visibility: visible('utilities') },
    paint: {
      'line-color': c.powerLine!,
      'line-width': width(['match', ['get', 'kind'], 'transmission', 1, 0.7], 1.4, 2.4),
      'line-opacity': 0.9,
    },
  });
  out.push({
    id: 'utility-pylons',
    type: 'circle',
    source: src,
    'source-layer': 'utilityPoints',
    minzoom: 12,
    filter: ['==', ['get', 'kind'], 'pylon'],
    layout: { visibility: visible('utilities') },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3.5],
      'circle-color': p.background,
      'circle-stroke-color': c.powerLine!,
      'circle-stroke-width': 1,
    },
  });
  out.push({
    id: 'utility-points',
    type: 'circle',
    source: src,
    'source-layer': 'utilityPoints',
    minzoom: 11,
    filter: gm(['!=', ['get', 'kind'], 'pylon']),
    layout: { visibility: visible('utilities') },
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        ['match', ['get', 'kind'], 'waterTower', 3, 'lock', 2, 2.5],
        16,
        ['match', ['get', 'kind'], 'waterTower', 6, 'lock', 3.5, 5],
      ],
      'circle-color': [
        'match',
        ['get', 'class'],
        'waterMain',
        c.waterMain!,
        'gasMain',
        c.gasMain!,
        'powerLine',
        c.powerLine!,
        'sewer',
        c.sewer!,
        'pipeline',
        c.pipeline!,
        'canal',
        c.canal!,
        p.ink,
      ],
      'circle-stroke-color': p.background,
      'circle-stroke-width': 1.2,
    },
  });
  return out;
}
