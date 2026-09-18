import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { simplifyLine, type Ring } from '@citygen/core';
import { clipToFrame, type Frame } from './model.js';

/**
 * Line-of-sight walls for virtual tabletops from building outlines
 * (DESIGN §8.4, decided with a performance guard): outlines are simplified,
 * clipped to the frame, merged along shared edges, and capped; over the cap
 * the export falls back to solid block outlines and says so.
 */
export interface WallOptions {
  /** Hard cap on segments; above it the export falls back to blocks. */
  maxSegments?: number;
  /** Simplification tolerance in metres. */
  toleranceM?: number;
}

export interface WallResult {
  /** [x1, y1, x2, y2] in model metres. */
  segments: [number, number, number, number][];
  warnings: string[];
  mode: 'buildings' | 'blocks' | 'none';
  /** Segments before merging and capping, for the report. */
  rawCount: number;
}

type Props = Record<string, unknown>;

function ringsOf(fc: FeatureCollection<Polygon, Props>): Ring[] {
  return fc.features.map((f: Feature<Polygon, Props>) =>
    f.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as [number, number]),
  );
}

/** Edges deduplicated by rounded endpoints regardless of direction. */
function edgesOf(rings: Ring[], frame: Frame, toleranceM: number): [number, number, number, number][] {
  const seen = new Set<string>();
  const out: [number, number, number, number][] = [];
  const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const inFrame = (x: number, y: number) =>
    x >= frame.minX && x <= frame.maxX && y >= frame.minY && y <= frame.maxY;
  for (const ring of rings) {
    const r = simplifyLine(ring, toleranceM);
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1]!;
      const b = r[i]!;
      if (!inFrame(a[0], a[1]) && !inFrame(b[0], b[1])) continue;
      const ka = key(a[0], a[1]);
      const kb = key(b[0], b[1]);
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

export function buildWalls(
  buildings: FeatureCollection<Polygon, Props>,
  blocks: FeatureCollection<Polygon, Props>,
  frame: Frame,
  options: WallOptions = {},
): WallResult {
  const max = options.maxSegments ?? 4000;
  const tol = options.toleranceM ?? 0.5;
  const warnings: string[] = [];
  const b = clipToFrame(buildings, frame);
  const raw = edgesOf(ringsOf(b), frame, tol);
  if (raw.length <= max)
    return { segments: raw, warnings, mode: raw.length ? 'buildings' : 'none', rawCount: raw.length };
  // Try a coarser simplification before giving up on buildings.
  const coarse = edgesOf(ringsOf(b), frame, tol * 3);
  if (coarse.length <= max) {
    warnings.push(
      `Building outlines were simplified to ${tol * 3} m to stay under ${max} wall segments (${raw.length} before).`,
    );
    return { segments: coarse, warnings, mode: 'buildings', rawCount: raw.length };
  }
  const blk = edgesOf(ringsOf(clipToFrame(blocks, frame)), frame, tol * 2);
  warnings.push(
    `The frame holds ${raw.length} building wall segments, more than the cap of ${max}; buildings are exported as solid blocks (${blk.length} segments). Export a smaller frame for building-level walls.`,
  );
  if (blk.length > max) {
    warnings.push(`Even block outlines exceed the cap; the first ${max} segments are kept.`);
    return { segments: blk.slice(0, max), warnings, mode: 'blocks', rawCount: raw.length };
  }
  return { segments: blk, warnings, mode: 'blocks', rawCount: raw.length };
}
