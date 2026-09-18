/**
 * Themes are authored as a palette, a land-cover paint table and a set of
 * pattern images described as data. `compileStyle` turns a theme into a
 * MapLibre style; the app rasterises `patterns` into images at runtime.
 */

export interface ThemePalette {
  background: string;
  land: string;
  water: string;
  waterLine: string;
  ink: string;
  inkMuted: string;
  accent: string;
  label: string;
  labelHalo: string;
  contour: string;
  contourMajor: string;
  river: string;
}

export type WardKind =
  | 'plaza'
  | 'market'
  | 'craftsmen'
  | 'merchant'
  | 'patriciate'
  | 'slum'
  | 'military'
  | 'cathedral'
  | 'castle'
  | 'park'
  | 'gate'
  | 'farm'
  | 'common';

export type LandcoverKind = 'snow' | 'rock' | 'marsh' | 'forest' | 'farmland' | 'open' | 'sand' | 'mangrove';

export interface LandcoverPaint {
  color: string;
  opacity?: number;
  /** Pattern image id (see `patterns`); drawn instead of a flat colour when set. */
  pattern?: string;
}

/** A small repeating image described as strokes and dots on a transparent tile. */
export interface PatternSpec {
  id: string;
  size: number;
  color: string;
  lineWidth: number;
  lines?: [number, number, number, number][];
  dots?: [number, number, number][];
}

export interface TownPaint {
  building: string;
  buildingOutline: string;
  buildingPattern?: string;
  street: string;
  streetCasing?: string;
  wall: string;
  road: string;
  parcel: string;
  plaza: string;
  ward: Record<string, string>;
  settlementMarker: string;
}

/** Six-step overlay palettes for the wealth and density fields, lowest class first. */
export interface OverlayPalettes {
  wealth: [string, string, string, string, string, string];
  density: [string, string, string, string, string, string];
}

export const WEALTH_CLASS_NAMES = ['slum', 'poor', 'modest', 'comfortable', 'affluent', 'elite'] as const;
export const DENSITY_CLASS_NAMES = ['rural', 'suburban', 'low', 'medium', 'high', 'core'] as const;

export interface Theme {
  id: string;
  name: string;
  palette: ThemePalette;
  town: TownPaint;
  overlays: OverlayPalettes;
  landcover: Record<LandcoverKind, LandcoverPaint>;
  patterns: PatternSpec[];
  /** Hypsometric tint stops [elevation m, colour]; empty disables colour relief. */
  relief: [number, string][];
  hillshade: { exaggeration: number; shadow: string; highlight: string; accent: string; opacity: number };
  /** Displace geometry for a hand-drawn look (tile builder option). */
  sketch: boolean;
  contours: { minor: boolean; majorEvery: number };
}

export const atlas: Theme = {
  id: 'atlas',
  name: 'Atlas',
  palette: {
    background: '#dfe8ee',
    land: '#eef0e4',
    water: '#a9c8de',
    waterLine: '#7fa8c4',
    ink: '#2b2b2b',
    inkMuted: '#8a8578',
    accent: '#c0392b',
    label: '#2b2b2b',
    labelHalo: '#f2efe6',
    contour: '#9c8a6a',
    contourMajor: '#7a6746',
    river: '#5f95bf',
  },
  landcover: {
    snow: { color: '#f7f9fb' },
    rock: { color: '#c9c4b8' },
    marsh: { color: '#b8d4c4' },
    forest: { color: '#a9c79a' },
    farmland: { color: '#e6e2b8' },
    open: { color: '#d9e0c4' },
    sand: { color: '#ece0b8' },
    mangrove: { color: '#9dbfa2' },
  },
  town: {
    building: '#8d7b6a',
    buildingOutline: '#5f5045',
    street: '#fbfaf5',
    streetCasing: '#b9b1a3',
    wall: '#3a332c',
    road: '#d9c9a8',
    parcel: '#c9bfae',
    plaza: '#f2ead3',
    ward: {
      plaza: '#f2ead3',
      market: '#f0d9b5',
      craftsmen: '#e9e1cf',
      merchant: '#e4d6bd',
      patriciate: '#dfe6d3',
      slum: '#e6d8d0',
      military: '#d6d6d2',
      cathedral: '#d9d2e8',
      castle: '#cfcfcf',
      park: '#c9dcb2',
      gate: '#ece3c9',
      farm: '#eceddb',
      common: '#e9e5da',
    },
    settlementMarker: '#5f5045',
  },
  overlays: {
    wealth: ['#7f2704', '#d94801', '#fd8d3c', '#fdd0a2', '#a1d99b', '#238b45'],
    density: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b', '#3f007d'],
  },
  patterns: [],
  relief: [
    [-100, '#eef0e4'],
    [0, '#eef0e4'],
    [150, '#e9e6d2'],
    [400, '#dfd3b4'],
    [800, '#cdb894'],
    [1500, '#b9a58c'],
    [2500, '#e8e6e2'],
  ],
  hillshade: { exaggeration: 0.45, shadow: '#3f3a2f', highlight: '#ffffff', accent: '#4a4536', opacity: 1 },
  sketch: false,
  contours: { minor: true, majorEvery: 5 },
};

export const ink: Theme = {
  id: 'ink',
  name: 'Ink',
  palette: {
    background: '#f7f3ea',
    land: '#f7f3ea',
    water: '#f7f3ea',
    waterLine: '#1a1a1a',
    ink: '#1a1a1a',
    inkMuted: '#6d6d6d',
    accent: '#1a1a1a',
    label: '#1a1a1a',
    labelHalo: '#f7f3ea',
    contour: '#8c8778',
    contourMajor: '#5a5648',
    river: '#1a1a1a',
  },
  landcover: {
    snow: { color: '#f7f3ea' },
    rock: { color: '#f7f3ea', pattern: 'ink-rock' },
    marsh: { color: '#f7f3ea', pattern: 'ink-marsh' },
    forest: { color: '#f7f3ea', pattern: 'ink-forest' },
    farmland: { color: '#f7f3ea', pattern: 'ink-farmland' },
    open: { color: '#f7f3ea' },
    sand: { color: '#f7f3ea', pattern: 'ink-sand' },
    mangrove: { color: '#f7f3ea', pattern: 'ink-marsh' },
  },
  patterns: [
    {
      id: 'ink-forest',
      size: 24,
      color: '#2a2a2a',
      lineWidth: 1,
      dots: [
        [6, 6, 2.2],
        [17, 9, 2.6],
        [10, 17, 2.4],
        [20, 20, 1.8],
      ],
    },
    {
      id: 'ink-marsh',
      size: 24,
      color: '#2a2a2a',
      lineWidth: 1,
      lines: [
        [2, 6, 10, 6],
        [14, 12, 22, 12],
        [4, 18, 12, 18],
        [16, 22, 22, 22],
      ],
    },
    {
      id: 'ink-farmland',
      size: 16,
      color: '#5a5a5a',
      lineWidth: 0.8,
      lines: [
        [0, 4, 16, 4],
        [0, 12, 16, 12],
      ],
    },
    {
      id: 'ink-rock',
      size: 16,
      color: '#2a2a2a',
      lineWidth: 1,
      lines: [
        [0, 16, 16, 0],
        [0, 8, 8, 0],
        [8, 16, 16, 8],
      ],
    },
    {
      id: 'ink-sand',
      size: 16,
      color: '#3a3a3a',
      lineWidth: 1,
      dots: [
        [3, 3, 0.8],
        [11, 6, 0.8],
        [6, 12, 0.8],
        [13, 14, 0.8],
      ],
    },
    {
      id: 'ink-water',
      size: 32,
      color: '#1a1a1a',
      lineWidth: 0.7,
      lines: [
        [0, 8, 12, 8],
        [16, 8, 32, 8],
        [6, 24, 22, 24],
      ],
    },
  ],
  town: {
    building: '#2a2a2a',
    buildingOutline: '#1a1a1a',
    street: '#f7f3ea',
    wall: '#1a1a1a',
    road: '#1a1a1a',
    parcel: '#9a948a',
    plaza: '#f7f3ea',
    ward: {},
    settlementMarker: '#1a1a1a',
  },
  overlays: {
    wealth: ['#1a1a1a', '#4a4a4a', '#7a7a7a', '#a9a9a9', '#cfcfcf', '#f0f0f0'],
    density: ['#f0f0f0', '#cfcfcf', '#a9a9a9', '#7a7a7a', '#4a4a4a', '#1a1a1a'],
  },
  relief: [],
  hillshade: {
    exaggeration: 0.35,
    shadow: '#4a4a4a',
    highlight: '#ffffff',
    accent: '#5a5a5a',
    opacity: 0.55,
  },
  sketch: true,
  contours: { minor: true, majorEvery: 5 },
};

export const themes: Record<string, Theme> = { atlas, ink };

export function themeById(id: string | undefined): Theme {
  return (id && themes[id]) || atlas;
}
