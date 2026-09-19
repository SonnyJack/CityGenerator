import type { Ring } from '../raster/contours.js';
import type { TerrainOutput } from '../terrain/stage.js';

/**
 * Vertical alignment of a route: a line resampled at a fixed spacing and a
 * height profile that stays within a ruling gradient by cutting into the
 * ground and filling over it (rail and main roads share it).
 */

/** Points every `ds` metres along a line, with their arc length; the last point is kept. */
export function resampleLine(line: Ring, ds: number): { pts: Ring; s: number[] } {
  const pts: Ring = [[line[0]![0], line[0]![1]]];
  const s: number[] = [0];
  let acc = 0; // length up to the start of the current segment
  let nextS = ds; // arc length of the next sample
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (nextS <= acc + seg && seg > 0) {
      const u = (nextS - acc) / seg;
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      s.push(nextS);
      nextS += ds;
    }
    acc += seg;
  }
  const last = line[line.length - 1]!;
  const prev = pts[pts.length - 1]!;
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > ds * 0.25) {
    pts.push([last[0], last[1]]);
    s.push(acc);
  } else {
    pts[pts.length - 1] = [last[0], last[1]];
    s[s.length - 1] = acc;
  }
  return { pts, s };
}

/**
 * Height profile within the ruling gradient `cap` (rise over run): the ground where it can be,
 * else the nearest grade that fits, nudged back toward the ground where there is slack so short
 * tunnels vanish.
 */
export function gradeProfile(terrain: TerrainOutput, pts: Ring, s: number[], cap: number): Float64Array {
  const { height } = terrain;
  const ground = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++)
    ground[i] = Math.max(terrain.seaLevel, height.sample(pts[i]![0], pts[i]![1]));
  const z = Float64Array.from(ground);
  for (let it = 0; it < 8; it++) {
    for (let i = 1; i < z.length; i++) {
      const d = (s[i]! - s[i - 1]!) * cap;
      z[i] = Math.min(Math.max(z[i]!, z[i - 1]! - d), z[i - 1]! + d);
    }
    for (let i = z.length - 2; i >= 0; i--) {
      const d = (s[i + 1]! - s[i]!) * cap;
      z[i] = Math.min(Math.max(z[i]!, z[i + 1]! - d), z[i + 1]! + d);
    }
  }
  // Nudge toward the ground where the profile has slack so short tunnels vanish.
  for (let it = 0; it < 3; it++)
    for (let i = 1; i < z.length - 1; i++) {
      const lo = Math.max(z[i - 1]! - (s[i]! - s[i - 1]!) * cap, z[i + 1]! - (s[i + 1]! - s[i]!) * cap);
      const hi = Math.min(z[i - 1]! + (s[i]! - s[i - 1]!) * cap, z[i + 1]! + (s[i + 1]! - s[i]!) * cap);
      if (lo <= hi) z[i] = Math.min(Math.max(ground[i]!, lo), hi);
    }
  return z;
}

export type StructureMode = 'surface' | 'embankment' | 'cutting' | 'tunnel' | 'viaduct';

/** Earthworks from the gap between a profile and the ground, one mode per sample. */
export function structureModes(
  terrain: TerrainOutput,
  pts: Ring,
  z: Float64Array,
  limits: { embankment: number; cutting: number; tunnel: number; viaduct: number },
): StructureMode[] {
  const modes: StructureMode[] = new Array<StructureMode>(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const ground = Math.max(terrain.seaLevel, terrain.height.sample(pts[i]![0], pts[i]![1]));
    const d = z[i]! - ground;
    modes[i] =
      d > limits.viaduct
        ? 'viaduct'
        : d > limits.embankment
          ? 'embankment'
          : d < limits.tunnel
            ? 'tunnel'
            : d < limits.cutting
              ? 'cutting'
              : 'surface';
  }
  // Merge runs shorter than four samples into their neighbours.
  for (let pass = 0; pass < 2; pass++) {
    let i = 0;
    while (i < modes.length) {
      let j = i;
      while (j < modes.length && modes[j] === modes[i]) j++;
      if (j - i < 4 && (i > 0 || j < modes.length)) {
        const fill = i > 0 ? modes[i - 1]! : modes[j]!;
        for (let k = i; k < j; k++) modes[k] = fill;
      }
      i = j;
    }
  }
  return modes;
}
