import type { StyleSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Theme } from './theme.js';

export interface CompileOptions {
  /** MapLibre source id that serves the generated vector tiles. */
  sourceId: string;
  /** Tile URL template using the app's custom protocol, e.g. `citygen://tiles/{z}/{x}/{y}`. */
  tileUrl: string;
}

/** Compile a theme into a complete MapLibre style for the Phase 0 layer set. */
export function compileStyle(theme: Theme, options: CompileOptions): StyleSpecification {
  const p = theme.palette;
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': p.background } },
    {
      id: 'region-fill',
      type: 'fill',
      source: options.sourceId,
      'source-layer': 'region',
      paint: { 'fill-color': p.land },
    },
    {
      id: 'graticule',
      type: 'line',
      source: options.sourceId,
      'source-layer': 'graticule',
      paint: {
        'line-color': p.inkMuted,
        'line-opacity': ['case', ['get', 'major'], 0.5, 0.2],
        'line-width': ['case', ['get', 'major'], 1, 0.5],
      },
    },
    {
      id: 'region-outline',
      type: 'line',
      source: options.sourceId,
      'source-layer': 'region',
      paint: { 'line-color': p.ink, 'line-width': 2 },
    },
    {
      id: 'samples',
      type: 'circle',
      source: options.sourceId,
      'source-layer': 'samples',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 6],
        'circle-color': p.accent,
        'circle-stroke-color': p.labelHalo,
        'circle-stroke-width': 1,
      },
    },
  ];
  return {
    version: 8,
    name: theme.name,
    sources: {
      [options.sourceId]: {
        type: 'vector',
        tiles: [options.tileUrl],
        minzoom: 0,
        maxzoom: 20,
      },
    },
    layers,
  };
}
