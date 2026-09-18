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
