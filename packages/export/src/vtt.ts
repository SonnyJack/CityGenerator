import { frameHeight, frameWidth, type Frame } from './model.js';
import type { WallResult } from './walls.js';

/**
 * Universal VTT (`.dd2vtt`, format 0.3): a scene image with line-of-sight
 * walls in grid units, importable by Foundry, Roll20 (via importers) and
 * others. Grid squares default to 1.5 m (5 ft).
 */
export interface VttOptions {
  frame: Frame;
  /** Metres per grid square. */
  gridM: number;
  /** Pixels per grid square in the image. */
  pixelsPerGrid: number;
  walls: WallResult;
  /** Base64 PNG without the data-URL prefix (optional; some tools accept walls only). */
  imageBase64?: string;
  name: string;
}

export interface UniversalVtt {
  format: number;
  resolution: {
    map_origin: { x: number; y: number };
    map_size: { x: number; y: number };
    pixels_per_grid: number;
  };
  line_of_sight: { x: number; y: number }[][];
  portals: unknown[];
  environment: { baked_lighting: boolean; ambient_light: string };
  lights: unknown[];
  image: string;
}

/** Model metres → grid units with y down. */
export function toGrid(frame: Frame, gridM: number): (x: number, y: number) => { x: number; y: number } {
  return (x, y) => ({ x: (x - frame.minX) / gridM, y: (frame.maxY - y) / gridM });
}

export function universalVtt(o: VttOptions): UniversalVtt {
  const g = toGrid(o.frame, o.gridM);
  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: Math.ceil(frameWidth(o.frame) / o.gridM), y: Math.ceil(frameHeight(o.frame) / o.gridM) },
      pixels_per_grid: o.pixelsPerGrid,
    },
    line_of_sight: o.walls.segments.map(([x1, y1, x2, y2]) => [g(x1, y1), g(x2, y2)]),
    portals: [],
    environment: { baked_lighting: true, ambient_light: 'ffffffff' },
    lights: [],
    image: o.imageBase64 ?? '',
  };
}

/** Foundry VTT scene data (v11+): the same walls in scene pixels. */
export interface FoundryScene {
  name: string;
  width: number;
  height: number;
  padding: number;
  grid: { size: number; type: number; distance: number; units: string };
  background: { src: string };
  walls: {
    c: [number, number, number, number];
    move: number;
    sense: number;
    sound: number;
    light: number;
    door: number;
    ds: number;
    dir: number;
  }[];
  flags: Record<string, unknown>;
}

export function foundryScene(o: VttOptions & { imageSrc?: string }): FoundryScene {
  const px = o.pixelsPerGrid / o.gridM;
  const toPx = (x: number, y: number): [number, number] => [
    Math.round((x - o.frame.minX) * px),
    Math.round((o.frame.maxY - y) * px),
  ];
  return {
    name: o.name,
    width: Math.ceil(frameWidth(o.frame) * px),
    height: Math.ceil(frameHeight(o.frame) * px),
    padding: 0,
    grid: { size: o.pixelsPerGrid, type: 1, distance: 5, units: 'ft' },
    background: { src: o.imageSrc ?? '' },
    walls: o.walls.segments.map(([x1, y1, x2, y2]) => {
      const a = toPx(x1, y1);
      const b = toPx(x2, y2);
      return {
        c: [a[0], a[1], b[0], b[1]],
        move: 20,
        sense: 20,
        sound: 20,
        light: 20,
        door: 0,
        ds: 0,
        dir: 0,
      };
    }),
    flags: { citygen: { walls: o.walls.mode, warnings: o.walls.warnings, gridM: o.gridM } },
  };
}
