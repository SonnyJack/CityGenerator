/**
 * Planar polygon utilities on plain `[x, y]` rings (metres). Rings are closed
 * or open; functions treat the last→first edge implicitly.
 */
import type { Ring } from '../raster/contours.js';

export type Pt = [number, number];
export type { Ring };

export function signedArea(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function area(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

export function centroid(ring: Ring): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) {
    const s = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Pt, [0, 0] as Pt);
    return [s[0] / n, s[1] / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ensure counter-clockwise orientation (positive area). */
export function ccw(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Drop a repeated closing point and consecutive duplicates. */
export function open(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const f = out[0]!;
    const l = out[out.length - 1]!;
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  }
  return out;
}

export function close(ring: Ring): Ring {
  const o = open(ring);
  return o.length ? [...o, o[0]!] : o;
}

export function perimeter(ring: Ring): number {
  let p = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
}

/** Isoperimetric compactness in (0, 1]; 1 for a circle. */
export function compactness(ring: Ring): number {
  const p = perimeter(ring);
  return p === 0 ? 0 : (4 * Math.PI * area(ring)) / (p * p);
}

export function bbox(ring: Ring): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Keep the part of `ring` on the left of the directed line a→b (half-plane
 * clip, Sutherland–Hodgman). Exact for convex subjects; for concave subjects
 * the result may join separated pieces with zero-width bridges.
 */
export function clipHalfPlane(ring: Ring, a: Pt, b: Pt): Ring {
  const out: Ring = [];
  const n = ring.length;
  if (n === 0) return out;
  const side = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const cur = ring[i]!;
    const prev = ring[(i + n - 1) % n]!;
    const sc = side(cur);
    const sp = side(prev);
    if (sc >= 0) {
      if (sp < 0) out.push(intersect(prev, cur, sp, sc));
      out.push(cur);
    } else if (sp >= 0) {
      out.push(intersect(prev, cur, sp, sc));
    }
  }
  return out;
}

function intersect(p: Pt, q: Pt, sp: number, sq: number): Pt {
  const t = sp / (sp - sq);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

/** Clip a ring to an axis-aligned rectangle. */
export function clipRect(ring: Ring, minX: number, minY: number, maxX: number, maxY: number): Ring {
  let r = clipHalfPlane(ring, [minX, minY], [maxX, minY]); // bottom: keep above
  r = clipHalfPlane(r, [maxX, minY], [maxX, maxY]); // right: keep left
  r = clipHalfPlane(r, [maxX, maxY], [minX, maxY]); // top
  r = clipHalfPlane(r, [minX, maxY], [minX, minY]); // left
  return r;
}

/** Split a ring by the infinite line through a→b into the left and right parts. */
export function splitByLine(ring: Ring, a: Pt, b: Pt): { left: Ring; right: Ring } {
  return { left: clipHalfPlane(ring, a, b), right: clipHalfPlane(ring, b, a) };
}

/**
 * Inset a ring by `d` metres: clip against each edge's inward-offset
 * half-plane. Exact for convex rings; approximate (over-clipped) for concave.
 * Returns an empty ring when the inset collapses.
 */
export function inset(ring: Ring, d: number): Ring {
  const r = ccw(open(ring));
  let out: Ring = r;
  const n = r.length;
  for (let i = 0; i < n && out.length >= 3; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // Inward normal for a CCW ring is to the left of the edge direction.
    const nx = (-dy / len) * d;
    const ny = (dx / len) * d;
    out = clipHalfPlane(out, [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]);
  }
  return out.length >= 3 && area(out) > 1e-6 ? out : [];
}

/** Longest edge index and its direction. */
export function longestEdge(ring: Ring): { index: number; length: number; dir: Pt } {
  let best = 0;
  let bestLen = -1;
  let dir: Pt = [1, 0];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > bestLen) {
      bestLen = len;
      best = i;
      dir = [(x1 - x0) / len, (y1 - y0) / len];
    }
  }
  return { index: best, length: bestLen, dir };
}

export interface Obb {
  center: Pt;
  /** Unit axis of the long side. */
  axis: Pt;
  length: number;
  width: number;
}

/** Minimum-area oriented bounding box by trying each edge direction. */
export function orientedBox(ring: Ring): Obb {
  const r = open(ring);
  const n = r.length;
  let best: Obb | null = null;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = r[i]!;
    const [x1, y1] = r[(i + 1) % n]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-9) continue;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of r) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU;
    const dv = maxV - minV;
    const a = du * dv;
    if (!best || a < best.length * best.width) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center: Pt = [cu * ux - cv * uy, cu * uy + cv * ux];
      best =
        du >= dv
          ? { center, axis: [ux, uy], length: du, width: dv }
          : { center, axis: [-uy, ux], length: dv, width: du };
    }
  }
  return best ?? { center: centroid(r), axis: [1, 0], length: 0, width: 0 };
}

/** Distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance from a point to a ring's boundary. */
export function distToRing(p: Pt, ring: Ring): number {
  let d = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) d = Math.min(d, distToSegment(p, ring[i]!, ring[(i + 1) % n]!));
  return d;
}

/** Convex hull of a point set (Andrew's monotone chain): counter-clockwise, open. */
export function convexHull(points: Ring): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Area of the part of `subject` inside the convex ring `clip` (counter-clockwise, open). */
export function convexOverlapArea(subject: Ring, clip: Ring): number {
  let out = subject;
  const n = clip.length;
  for (let i = 0; i < n && out.length >= 3; i++) out = clipHalfPlane(out, clip[i]!, clip[(i + 1) % n]!);
  return out.length >= 3 ? area(out) : 0;
}

/**
 * The part of `subject` clear of the convex ring `clip` (counter-clockwise, open), cut along the
 * one edge of `clip` that keeps the most of it, moved `gapM` outward. A single straight cut keeps a
 * convex subject convex and is how a later grid meets older ground: its last blocks are cut off by
 * a street along the old edge. Empty when nothing is left.
 */
export function clearOfConvex(subject: Ring, clip: Ring, gapM = 0): Ring {
  let best: Ring = [];
  let bestArea = 0;
  const n = clip.length;
  for (let i = 0; i < n; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    // Outward normal of a counter-clockwise edge points to its right.
    const nx = ((b[1] - a[1]) / len) * gapM;
    const ny = (-(b[0] - a[0]) / len) * gapM;
    // Keep the right of a→b, i.e. the left of b→a.
    const kept = clipHalfPlane(subject, [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]);
    const k = kept.length >= 3 ? area(kept) : 0;
    if (k > bestArea) {
      bestArea = k;
      best = kept;
    }
  }
  return best;
}

/**
 * The stretches of the segment a→b outside the convex ring `clip` (counter-clockwise, open), by
 * Cyrus–Beck: none, one or two pieces.
 */
export function segmentOutsideConvex(a: Pt, b: Pt, clip: Ring): [Pt, Pt][] {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const n = clip.length;
  for (let i = 0; i < n; i++) {
    const p = clip[i]!;
    const q = clip[(i + 1) % n]!;
    // Inside is the left of each edge: side(x) = cross(q − p, x − p) ≥ 0.
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const s0 = ex * (a[1] - p[1]) - ey * (a[0] - p[0]);
    const ds = ex * dy - ey * dx;
    if (Math.abs(ds) < 1e-12) {
      if (s0 < 0) return [[a, b]];
      continue;
    }
    const t = -s0 / ds;
    if (ds > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return [[a, b]];
  }
  const at = (t: number): Pt => [a[0] + dx * t, a[1] + dy * t];
  const out: [Pt, Pt][] = [];
  if (t0 > 1e-9) out.push([a, at(t0)]);
  if (t1 < 1 - 1e-9) out.push([at(t1), b]);
  return out;
}
