import type { Raster } from './raster.js';

/**
 * Marching squares over a raster, producing either closed polygons (area where
 * value >= threshold) with holes, or open/closed contour lines, in world
 * metres. Segments are oriented so the high side is on the left, which makes
 * outer rings counter-clockwise and holes clockwise without a separate pass.
 *
 * The grid is padded with a very low value so every region closes inside the
 * padded grid; border-running pieces are kept for polygons (they clip the sea
 * to the region) and dropped for lines.
 */

export type Ring = [number, number][];

export interface ContourPolygon {
  /** Outer ring (counter-clockwise) followed by holes (clockwise). */
  rings: Ring[];
  area: number;
}

const PAD = -1e9;

/** Edge key for the padded grid: horizontal edges have even keys, vertical odd. */
function hKey(c: number, r: number, w: number): number {
  return 2 * (r * w + c);
}
function vKey(c: number, r: number, w: number): number {
  return 2 * (r * w + c) + 1;
}

interface Segment {
  from: number; // edge key
  to: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** True when either endpoint lies on the artificial padding border. */
  border: boolean;
}

/**
 * Trace oriented segments of the threshold isoline over the padded grid.
 * `value(c, r)` reads the padded grid, size (w, h).
 */
function traceSegments(
  value: (c: number, r: number) => number,
  w: number,
  h: number,
  threshold: number,
  isBorderEdge: (key: number) => boolean,
): Segment[] {
  const segs: Segment[] = [];
  const lerp = (v0: number, v1: number) => {
    const d = v1 - v0;
    if (d === 0) return 0.5;
    const t = (threshold - v0) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const bl = value(c, r);
      const br = value(c + 1, r);
      const tr = value(c + 1, r + 1);
      const tl = value(c, r + 1);
      const code =
        (bl >= threshold ? 1 : 0) |
        (br >= threshold ? 2 : 0) |
        (tr >= threshold ? 4 : 0) |
        (tl >= threshold ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Crossing points on the four edges (only those used are valid).
      const pts: Record<number, [number, number, number]> = {};
      const edgeVals: [number, number][] = [
        [bl, br],
        [br, tr],
        [tl, tr],
        [bl, tl],
      ];
      const edgeKeys = [hKey(c, r, w), vKey(c + 1, r, w), hKey(c, r + 1, w), vKey(c, r, w)];
      const point = (e: number): [number, number, number] => {
        if (pts[e]) return pts[e]!;
        const [v0, v1] = edgeVals[e]!;
        const t = lerp(v0, v1);
        let p: [number, number, number];
        if (e === 0) p = [c + t, r, edgeKeys[0]!];
        else if (e === 1) p = [c + 1, r + t, edgeKeys[1]!];
        else if (e === 2) p = [c + t, r + 1, edgeKeys[2]!];
        else p = [c, r + t, edgeKeys[3]!];
        pts[e] = p;
        return p;
      };
      // Oriented [from, to] edge pairs per case so the high side is on the left of travel.
      let pairs: [number, number][];
      switch (code) {
        case 1:
          pairs = [[0, 3]];
          break;
        case 2:
          pairs = [[1, 0]];
          break;
        case 4:
          pairs = [[2, 1]];
          break;
        case 8:
          pairs = [[3, 2]];
          break;
        case 14:
          pairs = [[3, 0]];
          break;
        case 13:
          pairs = [[0, 1]];
          break;
        case 11:
          pairs = [[1, 2]];
          break;
        case 7:
          pairs = [[2, 3]];
          break;
        case 3:
          pairs = [[1, 3]];
          break;
        case 12:
          pairs = [[3, 1]];
          break;
        case 6:
          pairs = [[2, 0]];
          break;
        case 9:
          pairs = [[0, 2]];
          break;
        case 5: {
          const high = (bl + br + tr + tl) / 4 >= threshold;
          pairs = high
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [0, 3],
                [2, 1],
              ];
          break;
        }
        case 10: {
          const high = (bl + br + tr + tl) / 4 >= threshold;
          pairs = high
            ? [
                [3, 0],
                [1, 2],
              ]
            : [
                [1, 0],
                [3, 2],
              ];
          break;
        }
        default:
          continue;
      }
      for (const [ea, eb] of pairs) {
        const from = point(ea);
        const to = point(eb);
        segs.push({
          from: from[2],
          to: to[2],
          fx: from[0],
          fy: from[1],
          tx: to[0],
          ty: to[1],
          border: isBorderEdge(from[2]) || isBorderEdge(to[2]),
        });
      }
    }
  }
  return segs;
}

interface PaddedGrid {
  value: (c: number, r: number) => number;
  w: number;
  h: number;
  isBorderEdge: (key: number) => boolean;
  toWorld: (gx: number, gy: number) => [number, number];
}

function pad(raster: Raster, data: ArrayLike<number> = raster.data): PaddedGrid {
  const w = raster.width + 2;
  const h = raster.height + 2;
  const value = (c: number, r: number) =>
    c === 0 || r === 0 || c === w - 1 || r === h - 1 ? PAD : data[(r - 1) * raster.width + (c - 1)]!;
  const isBorderEdge = (key: number) => {
    const cell = key >> 1;
    const c = cell % w;
    const r = (cell / w) | 0;
    return key & 1
      ? c === 0 || c === w - 1 || r === 0 || r === h - 2 // vertical edge from (c,r) to (c,r+1)
      : r === 0 || r === h - 1 || c === 0 || c === w - 2; // horizontal edge from (c,r) to (c+1,r)
  };
  const toWorld = (gx: number, gy: number): [number, number] => [
    raster.originX + (gx - 1) * raster.cellSizeM,
    raster.originY + (gy - 1) * raster.cellSizeM,
  ];
  return { value, w, h, isBorderEdge, toWorld };
}

/** Stitch oriented segments into closed rings (grid coordinates). Deterministic: starts from the lowest edge key. */
function stitchRings(segs: Segment[]): { ring: Ring; borderFlags: boolean[] }[] {
  const byFrom = new Map<number, Segment>();
  for (const s of segs) byFrom.set(s.from, s);
  const used = new Set<number>();
  const keys = [...byFrom.keys()].sort((a, b) => a - b);
  const rings: { ring: Ring; borderFlags: boolean[] }[] = [];
  for (const start of keys) {
    if (used.has(start)) continue;
    const ring: Ring = [];
    const flags: boolean[] = [];
    let key = start;
    let guard = 0;
    while (!used.has(key)) {
      const s = byFrom.get(key);
      if (!s) break;
      used.add(key);
      ring.push([s.fx, s.fy]);
      flags.push(s.border);
      key = s.to;
      if (++guard > segs.length + 1) break;
    }
    if (ring.length >= 3) rings.push({ ring, borderFlags: flags });
  }
  return rings;
}

function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Polygons (with holes) covering the area where `data >= threshold`, in world metres.
 * Outer rings are counter-clockwise; holes clockwise; rings are closed (first point repeated).
 */
export function contourPolygons(
  raster: Raster,
  threshold: number,
  data: ArrayLike<number> = raster.data,
): ContourPolygon[] {
  const g = pad(raster, data);
  const segs = traceSegments(g.value, g.w, g.h, threshold, g.isBorderEdge);
  const rings = stitchRings(segs).map(({ ring }) => ring.map(([x, y]) => g.toWorld(x, y)) as Ring);
  const outers: { ring: Ring; area: number; holes: Ring[] }[] = [];
  const holes: { ring: Ring; area: number }[] = [];
  for (const ring of rings) {
    const area = signedArea(ring);
    if (Math.abs(area) < 1e-9) continue;
    if (area > 0) outers.push({ ring, area, holes: [] });
    else holes.push({ ring, area });
  }
  // Assign each hole to the smallest outer ring that contains it.
  outers.sort((a, b) => a.area - b.area);
  for (const hole of holes) {
    const [x, y] = hole.ring[0]!;
    const owner = outers.find((o) => pointInRing(x, y, o.ring));
    if (owner) owner.holes.push(hole.ring);
  }
  const close = (r: Ring): Ring =>
    r.length && (r[0]![0] !== r[r.length - 1]![0] || r[0]![1] !== r[r.length - 1]![1]) ? [...r, r[0]!] : r;
  return outers
    .sort((a, b) => b.area - a.area)
    .map((o) => ({ rings: [close(o.ring), ...o.holes.map(close)], area: o.area }));
}

/**
 * Contour lines at a threshold, in world metres. Pieces running along the
 * region border are removed, so lines may be open polylines.
 */
export function contourLines(
  raster: Raster,
  threshold: number,
  data: ArrayLike<number> = raster.data,
): Ring[] {
  const g = pad(raster, data);
  const segs = traceSegments(g.value, g.w, g.h, threshold, g.isBorderEdge);
  const lines: Ring[] = [];
  for (const { ring, borderFlags } of stitchRings(segs)) {
    const n = ring.length;
    if (!borderFlags.some(Boolean)) {
      lines.push([...ring, ring[0]!].map(([x, y]) => g.toWorld(x, y)) as Ring);
      continue;
    }
    // Rotate so we start right after a border piece, then split at border pieces.
    let start = borderFlags.findIndex((f, i) => f && !borderFlags[(i + 1) % n]);
    if (start < 0) continue; // entirely on the border
    start = (start + 1) % n;
    let current: Ring = [];
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (borderFlags[i]) {
        // The point at i begins a border segment; include it as the end of the open line.
        current.push(g.toWorld(ring[i]![0], ring[i]![1]));
        if (current.length >= 2) lines.push(current);
        current = [];
      } else {
        current.push(g.toWorld(ring[i]![0], ring[i]![1]));
      }
    }
    if (current.length >= 2) lines.push(current);
  }
  return lines;
}

/** Chaikin corner cutting; keeps endpoints of open lines. */
export function smoothLine(points: Ring, iterations = 1, closed = false): Ring {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: Ring = [];
    const n = pts.length;
    if (n < 3) return pts;
    const limit = closed ? n : n - 1;
    if (!closed) out.push(pts[0]!);
    for (let i = 0; i < limit; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[(i + 1) % n]!;
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]!);
    else out.push(out[0]!);
    pts = out;
  }
  return pts;
}

/** Ramer–Douglas–Peucker simplification with a tolerance in the same units as the points. */
export function simplifyLine(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      let d2: number;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Ring = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}
