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

/** Label typography and colours; fonts are glyph stacks served from the app. */
export interface LabelStyle {
  font: string;
  fontBold: string;
  fontItalic: string;
  settlement: string;
  district: string;
  street: string;
  water: string;
  facility: string;
  halo: string;
  haloWidth: number;
  /** Letter case for district and settlement labels. */
  transform: 'none' | 'uppercase';
}

/** Building colours by material (Sanborn-style) or by use; `default` when neither set. */
export interface BuildingColouring {
  by: 'flat' | 'material' | 'use';
  materials?: Record<string, string>;
  uses?: Record<string, string>;
  /** Draw outlines only (blueprint). */
  outlineOnly?: boolean;
}

export interface Theme {
  id: string;
  name: string;
  palette: ThemePalette;
  town: TownPaint;
  labels: LabelStyle;
  buildings?: BuildingColouring;
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
      port: '#d8dde0',
      industrial: '#d9d6cf',
      institution: '#e3e1d6',
      campus: '#dfe4d2',
      cemetery: '#d5dcc8',
      airfield: '#e2e6d4',
      yard: '#d6d3cb',
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
  labels: {
    font: 'Open Sans Regular',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#2b2b2b',
    district: '#6b6257',
    street: '#3d3731',
    water: '#3f6f94',
    facility: '#4a443c',
    halo: '#f2efe6',
    haloWidth: 1.4,
    transform: 'none',
  },
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
  labels: {
    font: 'Open Sans Italic',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#1a1a1a',
    district: '#3a3a3a',
    street: '#1a1a1a',
    water: '#1a1a1a',
    facility: '#1a1a1a',
    halo: '#f7f3ea',
    haloWidth: 1.6,
    transform: 'uppercase',
  },
};

/** A 1920s street-atlas look: warm paper, sepia inks, italic water names. */
export const period1920s: Theme = {
  ...atlas,
  id: 'period1920s',
  name: 'Period (1920s)',
  palette: {
    ...atlas.palette,
    background: '#e9e0cb',
    land: '#f1e9d5',
    water: '#cfd9cf',
    waterLine: '#6f7f74',
    ink: '#3b2f22',
    inkMuted: '#8a7a66',
    accent: '#8b2f1e',
    label: '#3b2f22',
    labelHalo: '#f1e9d5',
    contour: '#b59f7f',
    contourMajor: '#8f7a5c',
    river: '#6f7f74',
  },
  landcover: {
    snow: { color: '#f4efe4' },
    rock: { color: '#d8cdb8' },
    marsh: { color: '#d7dbc4' },
    forest: { color: '#c8cfae' },
    farmland: { color: '#ece3c6' },
    open: { color: '#e6dfc4' },
    sand: { color: '#ecdfbe' },
    mangrove: { color: '#c3cdb0' },
  },
  town: {
    ...atlas.town,
    building: '#a4836a',
    buildingOutline: '#5a4634',
    street: '#f7f1de',
    streetCasing: '#b7a58a',
    wall: '#3b2f22',
    road: '#c9a878',
    parcel: '#c9b89a',
    plaza: '#efe4c8',
    ward: {
      ...atlas.town.ward,
      cbd: '#e9d7b8',
      retailStrip: '#eadcbe',
      rowhouse: '#e8dcc7',
      tenement: '#e2d3bd',
    },
    settlementMarker: '#5a4634',
  },
  relief: [
    [-100, '#f1e9d5'],
    [0, '#f1e9d5'],
    [200, '#e8dcbc'],
    [600, '#d9c59e'],
    [1500, '#c8ad86'],
  ],
  hillshade: { exaggeration: 0.35, shadow: '#5a4634', highlight: '#fff8e8', accent: '#5a4634', opacity: 0.7 },
  labels: {
    font: 'Open Sans Semibold',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#3b2f22',
    district: '#6b5340',
    street: '#3b2f22',
    water: '#4f6a5c',
    facility: '#5a4634',
    halo: '#f1e9d5',
    haloWidth: 1.6,
    transform: 'uppercase',
  },
};

/** Fire-insurance atlas colouring: buildings by material, bold outlines, pale streets. */
export const sanborn: Theme = {
  ...period1920s,
  id: 'sanborn',
  name: 'Sanborn',
  palette: {
    ...period1920s.palette,
    background: '#efe7d3',
    land: '#f5efdf',
    water: '#cfd9d8',
    river: '#7f9a9a',
    accent: '#a12b1f',
  },
  town: {
    ...period1920s.town,
    building: '#e8b7b0',
    buildingOutline: '#1e1a17',
    street: '#fbf7ea',
    streetCasing: '#1e1a17',
    plaza: '#f5efdf',
    ward: {},
  },
  buildings: {
    by: 'material',
    materials: {
      brick: '#e88f84',
      stone: '#8fb3d9',
      concrete: '#b7bec4',
      steel: '#9fa8ad',
      timber: '#f2d67c',
      mudbrick: '#d9b58a',
      adobe: '#d9b58a',
      rammedEarth: '#cdb28a',
      earth: '#cdb28a',
    },
  },
  labels: { ...period1920s.labels, font: 'Open Sans Regular', transform: 'none' },
};

/** White lines on blueprint blue; fills are hatched or absent. */
export const blueprint: Theme = {
  ...atlas,
  id: 'blueprint',
  name: 'Blueprint',
  palette: {
    background: '#12305e',
    land: '#12305e',
    water: '#0d2650',
    waterLine: '#9fc4ff',
    ink: '#e8f1ff',
    inkMuted: '#8fb0e6',
    accent: '#ffffff',
    label: '#e8f1ff',
    labelHalo: '#12305e',
    contour: '#4f7bc4',
    contourMajor: '#7aa2e0',
    river: '#9fc4ff',
  },
  landcover: {
    snow: { color: '#12305e' },
    rock: { color: '#12305e' },
    marsh: { color: '#12305e' },
    forest: { color: '#15386b' },
    farmland: { color: '#12305e' },
    open: { color: '#12305e' },
    sand: { color: '#12305e' },
    mangrove: { color: '#15386b' },
  },
  town: {
    building: '#12305e',
    buildingOutline: '#e8f1ff',
    street: '#e8f1ff',
    wall: '#ffffff',
    road: '#bcd3f5',
    parcel: '#5f8ad0',
    plaza: '#12305e',
    ward: {},
    settlementMarker: '#e8f1ff',
  },
  overlays: {
    wealth: ['#1d3f7a', '#2a5aa8', '#3f7fd6', '#6aa2ea', '#9fc4ff', '#dfeaff'],
    density: ['#1d3f7a', '#2a5aa8', '#3f7fd6', '#6aa2ea', '#9fc4ff', '#dfeaff'],
  },
  buildings: { by: 'flat', outlineOnly: true },
  patterns: [],
  relief: [],
  hillshade: { exaggeration: 0.3, shadow: '#08183a', highlight: '#3a63b0', accent: '#08183a', opacity: 0.5 },
  sketch: false,
  contours: { minor: true, majorEvery: 5 },
  labels: {
    font: 'Open Sans Regular',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#ffffff',
    district: '#c9dcff',
    street: '#e8f1ff',
    water: '#9fc4ff',
    facility: '#e8f1ff',
    halo: '#12305e',
    haloWidth: 1.2,
    transform: 'uppercase',
  },
};

/** A dark screen theme for late-night sessions. */
export const dark: Theme = {
  ...atlas,
  id: 'dark',
  name: 'Dark',
  palette: {
    background: '#1b1d22',
    land: '#25282e',
    water: '#171c26',
    waterLine: '#3d5470',
    ink: '#d8dbe0',
    inkMuted: '#7c828c',
    accent: '#e0a458',
    label: '#e6e8eb',
    labelHalo: '#1b1d22',
    contour: '#3f434b',
    contourMajor: '#565b64',
    river: '#4c6d94',
  },
  landcover: {
    snow: { color: '#3a3d44' },
    rock: { color: '#2e3137' },
    marsh: { color: '#232d2b' },
    forest: { color: '#1f2c24' },
    farmland: { color: '#2a2c26' },
    open: { color: '#272a2a' },
    sand: { color: '#2e2c26' },
    mangrove: { color: '#1f2c26' },
  },
  town: {
    building: '#6b6f78',
    buildingOutline: '#9aa0aa',
    street: '#3a3e46',
    streetCasing: '#14161a',
    wall: '#c9ccd2',
    road: '#4a4030',
    parcel: '#3c4048',
    plaza: '#3a3e46',
    ward: {
      plaza: '#3a3e46',
      market: '#3d3a33',
      craftsmen: '#33353a',
      merchant: '#36353a',
      patriciate: '#333a36',
      slum: '#3a3434',
      military: '#35363a',
      cathedral: '#38353f',
      castle: '#3a3a3d',
      park: '#2c3a2e',
      gate: '#38362f',
      farm: '#2c2f28',
      common: '#31322f',
      cbd: '#3c3c44',
      retailStrip: '#3f3a34',
      rowhouse: '#35343a',
      tenement: '#3a3438',
      streetcarSuburb: '#333a34',
      gardenSuburb: '#2f3a30',
      suburb: '#30362e',
      culDeSac: '#30362e',
      apartment: '#363a40',
      towerEstate: '#383b42',
      warehouse: '#3a3937',
      port: '#2d3540',
      industrial: '#3a3835',
      institution: '#36383a',
      campus: '#2f3a34',
      cemetery: '#2c3530',
      airfield: '#30362e',
      yard: '#35342f',
    },
    settlementMarker: '#e0a458',
  },
  overlays: {
    wealth: ['#7f2704', '#d94801', '#fd8d3c', '#fdd0a2', '#a1d99b', '#238b45'],
    density: ['#2b2f3a', '#3b4a63', '#4f6d94', '#6f96c9', '#9ec3ee', '#d7e8ff'],
  },
  relief: [
    [-100, '#25282e'],
    [0, '#25282e'],
    [300, '#2c2f34'],
    [900, '#35383d'],
    [2000, '#45484d'],
  ],
  hillshade: { exaggeration: 0.4, shadow: '#0e0f12', highlight: '#4a4f58', accent: '#0e0f12', opacity: 0.8 },
  labels: {
    font: 'Open Sans Regular',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#f0f1f3',
    district: '#b9bec7',
    street: '#d8dbe0',
    water: '#8fb3dd',
    facility: '#d8dbe0',
    halo: '#1b1d22',
    haloWidth: 1.4,
    transform: 'none',
  },
};

/** High-contrast greyscale for printing. */
export const print: Theme = {
  ...atlas,
  id: 'print',
  name: 'Print',
  palette: {
    background: '#ffffff',
    land: '#ffffff',
    water: '#e6e6e6',
    waterLine: '#000000',
    ink: '#000000',
    inkMuted: '#555555',
    accent: '#000000',
    label: '#000000',
    labelHalo: '#ffffff',
    contour: '#bbbbbb',
    contourMajor: '#888888',
    river: '#000000',
  },
  landcover: {
    snow: { color: '#ffffff' },
    rock: { color: '#eeeeee' },
    marsh: { color: '#f2f2f2' },
    forest: { color: '#e4e4e4' },
    farmland: { color: '#f7f7f7' },
    open: { color: '#fafafa' },
    sand: { color: '#f4f4f4' },
    mangrove: { color: '#e4e4e4' },
  },
  town: {
    building: '#333333',
    buildingOutline: '#000000',
    street: '#ffffff',
    streetCasing: '#000000',
    wall: '#000000',
    road: '#000000',
    parcel: '#999999',
    plaza: '#ffffff',
    ward: {},
    settlementMarker: '#000000',
  },
  overlays: {
    wealth: ['#111111', '#444444', '#777777', '#aaaaaa', '#cccccc', '#eeeeee'],
    density: ['#eeeeee', '#cccccc', '#aaaaaa', '#777777', '#444444', '#111111'],
  },
  relief: [],
  hillshade: { exaggeration: 0.3, shadow: '#000000', highlight: '#ffffff', accent: '#000000', opacity: 0.25 },
  labels: {
    font: 'Open Sans Regular',
    fontBold: 'Open Sans Bold',
    fontItalic: 'Open Sans Italic',
    settlement: '#000000',
    district: '#333333',
    street: '#000000',
    water: '#000000',
    facility: '#000000',
    halo: '#ffffff',
    haloWidth: 1.8,
    transform: 'uppercase',
  },
};

export const themes: Record<string, Theme> = { atlas, ink, period1920s, sanborn, blueprint, dark, print };

export function themeById(id: string | undefined): Theme {
  return (id && themes[id]) || atlas;
}
