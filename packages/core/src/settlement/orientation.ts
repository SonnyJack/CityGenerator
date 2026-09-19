import type { Pt } from '../geometry/polygon.js';
import type { Raster } from '../raster/raster.js';

/**
 * Which way a street grid should run. Grids laid at an arbitrary angle are the
 * surest sign of a town pasted onto its ground: real ones run along the shore
 * and along the contours. Over a set of sample points the terrain votes with a
 * doubled-doubled angle (a grid repeats every quarter turn, so angles are
 * averaged as 4θ): the contour direction where the ground slopes, the
 * shoreline direction near the sea. When the votes are weak or disagree (flat
 * ground inland), the caller's fallback wins.
 */
export interface OrientationTerrain {
  height: Raster;
  slope: Float32Array;
  aspect: Float32Array;
  distToSea: Float32Array;
}

export interface GridOrientation {
  /** Grid axis in radians (mod π/2). */
  theta: number;
  /** True when the terrain decided the angle. */
  aligned: boolean;
  /** True when the contours, not the shore, decided it. */
  sloped: boolean;
}

/** Slope from which the contours start to matter, and where they matter fully. */
const SLOPE_FROM = 0.03;
const SLOPE_FULL = 0.15;
/** Distance from the sea within which the shoreline matters. */
const SHORE_M = 600;

export function gridOrientation(
  terrain: OrientationTerrain,
  samples: Pt[],
  fallback: number,
): GridOrientation {
  const { height, slope, aspect, distToSea } = terrain;
  const w = height.width;
  const h = height.height;
  const cell = height.cellSizeM;
  const at = (c: number, r: number) => Math.min(Math.max(r, 0), h - 1) * w + Math.min(Math.max(c, 0), w - 1);
  let sx = 0;
  let sy = 0;
  let wSlope = 0;
  let wShore = 0;
  for (const [x, y] of samples) {
    const c = Math.round(height.col(x));
    const r = Math.round(height.row(y));
    if (c < 0 || r < 0 || c >= w || r >= h) continue;
    const i = r * w + c;
    const s = slope[i]!;
    const ws = Math.min(1, Math.max(0, (s - SLOPE_FROM) / (SLOPE_FULL - SLOPE_FROM)));
    if (ws > 0) {
      // The contour runs across the downhill direction.
      const th = aspect[i]! + Math.PI / 2;
      sx += ws * Math.cos(4 * th);
      sy += ws * Math.sin(4 * th);
      wSlope += ws;
    }
    const d = distToSea[i]!;
    if (d < SHORE_M) {
      // The shore runs across the gradient of the distance to the sea.
      const gx = (distToSea[at(c + 1, r)]! - distToSea[at(c - 1, r)]!) / (2 * cell);
      const gy = (distToSea[at(c, r + 1)]! - distToSea[at(c, r - 1)]!) / (2 * cell);
      const g = Math.hypot(gx, gy);
      if (g > 0.2) {
        const th = Math.atan2(gy, gx) + Math.PI / 2;
        const wsh = 1.5 * (1 - d / SHORE_M);
        sx += wsh * Math.cos(4 * th);
        sy += wsh * Math.sin(4 * th);
        wShore += wsh;
      }
    }
  }
  const total = wSlope + wShore;
  const n = samples.length || 1;
  // Too little ground with an opinion, or opinions that cancel out: keep the fallback.
  if (total / n < 0.15 || Math.hypot(sx, sy) < 0.4 * total)
    return { theta: fallback, aligned: false, sloped: false };
  return { theta: Math.atan2(sy, sx) / 4, aligned: true, sloped: wSlope > wShore };
}

/** Rise over run between two points on the height raster. */
export function gradientBetween(height: Raster, a: Pt, b: Pt): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return 0;
  return Math.abs(height.sample(b[0], b[1]) - height.sample(a[0], a[1])) / len;
}

/** Streets steeper than this become flights of steps. */
export const STEPS_GRADIENT = 0.15;
