import type { Ring } from '../raster/contours.js';
import { simplifyLine, smoothLine } from '../raster/contours.js';
import type { TerrainOutput } from './stage.js';

/**
 * One shoreline for every test. The map draws water from marching-squares
 * contours of the raster, whose boundary runs half a cell from the water
 * cell centres; a nearest-cell lookup puts the shore up to half a cell
 * away from that, which is how blocks came to hang over the drawn lake.
 * Sampling the distance-to-water field bilinearly reproduces the drawn
 * boundary (the distance crosses half a cell exactly where the contour
 * runs), and a setback keeps footprints clear of it.
 */
export interface LandOptions {
  /** Extra metres to keep clear of the drawn shoreline (0 = touch it). */
  setbackM?: number;
  /** Whether rivers count as water ('water', buildings) or as land that a road may bridge ('land'). */
  rivers?: 'water' | 'land';
  /** Also require the ground to be above sea level (default true). */
  aboveSea?: boolean;
}

export type LandTest = (x: number, y: number) => boolean;

/** Bilinear sample of a per-cell field on the terrain grid, clamped at the edges. */
export function sampleTerrainField(
  terrain: TerrainOutput,
  field: Float32Array,
  x: number,
  y: number,
): number {
  const { height } = terrain;
  const fc = Math.min(Math.max(height.col(x), 0), height.width - 1);
  const fr = Math.min(Math.max(height.row(y), 0), height.height - 1);
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const c1 = Math.min(c0 + 1, height.width - 1);
  const r1 = Math.min(r0 + 1, height.height - 1);
  const tx = fc - c0;
  const ty = fr - r0;
  const w = height.width;
  const a = field[r0 * w + c0]!;
  const b = field[r0 * w + c1]!;
  const c = field[r1 * w + c0]!;
  const d = field[r1 * w + c1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Signed-ish distance to the drawn shoreline in metres (positive on land, ~0 on the line, negative-ish in water). */
export function shoreDistance(
  terrain: TerrainOutput,
  x: number,
  y: number,
  rivers: 'water' | 'land' = 'land',
): number {
  const field = rivers === 'water' ? terrain.distToWater : (terrain.distToStillWater ?? terrain.distToWater);
  return sampleTerrainField(terrain, field, x, y) - terrain.height.cellSizeM / 2;
}

/** A land test that agrees with the drawn water polygons, with an optional setback. */
export function landSampler(terrain: TerrainOutput, options: LandOptions = {}): LandTest {
  const setback = options.setbackM ?? 0;
  const rivers = options.rivers ?? 'land';
  const aboveSea = options.aboveSea ?? true;
  const { height, seaLevel } = terrain;
  const field = rivers === 'water' ? terrain.distToWater : (terrain.distToStillWater ?? terrain.distToWater);
  const cell = height.cellSizeM;
  const farM = cell * 1.5 + setback;
  return (x, y) => {
    if (x < height.originX || y < height.originY) return false;
    if (x > height.x(height.width - 1) || y > height.y(height.height - 1)) return false;
    // Fast path: well inland by the nearest cell, and well above the sea.
    const c = Math.round(height.col(x));
    const r = Math.round(height.row(y));
    const i = r * height.width + c;
    if (field[i]! > farM && (!aboveSea || height.data[i]! >= seaLevel + 2)) return true;
    if (shoreDistance(terrain, x, y, rivers) <= setback) return false;
    return !aboveSea || height.sample(x, y) >= seaLevel;
  };
}

/** True when every vertex of the ring (and its centroid) passes the land test. */
export function ringOnLand(ring: Ring, onLand: LandTest): boolean {
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  if (!n) return false;
  for (const [x, y] of ring) {
    if (!onLand(x, y)) return false;
    cx += x;
    cy += y;
  }
  return onLand(cx / n, cy / n);
}

/**
 * Smooth and simplify a routed cell path without letting the curve leave
 * the land the router chose: vertices that end up over water snap back to
 * the nearest raw point, and a raw point is inserted wherever a segment's
 * midpoint is over water. The endpoints are kept as given (they may be a
 * quay or a jetty on purpose).
 */
export function smoothOnLand(
  raw: Ring,
  onLand: LandTest,
  options: { iterations?: number; tolerance: number; preSimplify?: number; sampleM?: number },
): Ring {
  if (raw.length < 2) return raw;
  const sampleM = options.sampleM ?? options.tolerance * 4;
  const coarse = options.preSimplify ? simplifyLine(raw, options.preSimplify) : raw;
  let line = simplifyLine(smoothLine(coarse, options.iterations ?? 2), options.tolerance);
  // Nearest routed point, preferring one that is itself on land (an endpoint may sit on a quay).
  const nearestRaw = (p: [number, number]): [number, number] => {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    let any = raw[0]!;
    let anyD = Infinity;
    for (const q of raw) {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < anyD) {
        anyD = d;
        any = q;
      }
      if (d < bestD && onLand(q[0], q[1])) {
        bestD = d;
        best = q;
      }
    }
    return best ?? any;
  };
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  const midOf = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  // A segment is on land when samples every `sampleM` along it are (a long straight can hop a bay).
  const midLand = (a: [number, number], b: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / sampleM));
    for (let k = 1; k < 2 * n; k += 2) {
      const t = k / (2 * n);
      if (!onLand(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  };
  /** First point along a segment that is over water (for the fallback snap). */
  const firstWet = (a: [number, number], b: [number, number]): [number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / sampleM));
    for (let k = 1; k < 2 * n; k += 2) {
      const t = k / (2 * n);
      const q: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!onLand(q[0], q[1])) return q;
    }
    return midOf(a, b);
  };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const out: Ring = [];
    for (let i = 0; i < line.length; i++) {
      let p = line[i]!;
      const endpoint = i === 0 || i === line.length - 1;
      if (!endpoint && !onLand(p[0], p[1])) {
        p = nearestRaw(p);
        changed = true;
      }
      if (!out.length || !same(out[out.length - 1]!, p)) out.push(p);
      if (i < line.length - 1) {
        const q = line[i + 1]!;
        const last = out[out.length - 1]!;
        if (!midLand(last, q)) {
          // A diagonal step past a water corner: go round the corner through a land cell centre
          // when there is one, else fall back to the nearest routed point.
          const corners: [number, number][] = [
            [last[0], q[1]],
            [q[0], last[1]],
          ];
          const corner = corners.find((c) => onLand(c[0], c[1]) && midLand(last, c) && midLand(c, q));
          const r = corner ?? nearestRaw(firstWet(last, q));
          if (!same(r, last) && !same(r, q)) {
            out.push(r);
            changed = true;
          }
        }
      }
    }
    line = out;
    if (!changed) break;
  }
  return line;
}
