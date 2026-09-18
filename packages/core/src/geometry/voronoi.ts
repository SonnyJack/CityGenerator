import Delaunator from '../vendor/delaunator.js';
import { centroid, clipRect, type Pt, type Ring } from './polygon.js';

/**
 * Bounded Voronoi cells from a point set. A ring of guard points far outside
 * the bounds keeps every real cell finite, so cells are simply the polygons of
 * circumcentres around each site, clipped to the bounds. Adjacent cells share
 * exact vertices, which lets callers union cells by edge counting.
 */
export interface VoronoiCell {
  site: Pt;
  ring: Ring;
  /** Indices of neighbouring real sites. */
  neighbours: number[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function voronoi(sites: Pt[], bounds: Bounds): VoronoiCell[] {
  const n = sites.length;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const radius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 2;
  const guardCount = 24;
  const coords = new Float64Array((n + guardCount) * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = sites[i]![0];
    coords[i * 2 + 1] = sites[i]![1];
  }
  for (let g = 0; g < guardCount; g++) {
    const t = (g / guardCount) * Math.PI * 2;
    coords[(n + g) * 2] = cx + Math.cos(t) * radius;
    coords[(n + g) * 2 + 1] = cy + Math.sin(t) * radius;
  }
  const d = new Delaunator(coords);
  const { triangles, halfedges } = d;
  const triCount = triangles.length / 3;
  const circum = new Float64Array(triCount * 2);
  for (let t = 0; t < triCount; t++) {
    const a = triangles[t * 3]!;
    const b = triangles[t * 3 + 1]!;
    const c = triangles[t * 3 + 2]!;
    const [x, y] = circumcentre(coords, a, b, c);
    circum[t * 2] = x;
    circum[t * 2 + 1] = y;
  }
  // One incoming half-edge per point, to start walking around it.
  const incoming = new Int32Array(n + guardCount).fill(-1);
  for (let e = 0; e < triangles.length; e++) {
    const endpoint = triangles[e % 3 === 2 ? e - 2 : e + 1]!;
    if (incoming[endpoint] === -1 || halfedges[e] === -1) incoming[endpoint] = e;
  }
  const cells: VoronoiCell[] = [];
  for (let i = 0; i < n; i++) {
    const start = incoming[i]!;
    const ring: Ring = [];
    const neighbours: number[] = [];
    if (start === -1) {
      cells.push({ site: sites[i]!, ring: [], neighbours });
      continue;
    }
    let e = start;
    let guard = 0;
    do {
      const t = Math.floor(e / 3);
      ring.push([circum[t * 2]!, circum[t * 2 + 1]!]);
      const from = triangles[e]!;
      if (from < n && from !== i) neighbours.push(from);
      const next = e % 3 === 2 ? e - 2 : e + 1;
      e = halfedges[next]!;
      if (++guard > 10_000) break;
    } while (e !== -1 && e !== start);
    cells.push({
      site: sites[i]!,
      ring: clipRect(ring, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
      neighbours,
    });
  }
  return cells;
}

function circumcentre(coords: Float64Array, a: number, b: number, c: number): Pt {
  const ax = coords[a * 2]!;
  const ay = coords[a * 2 + 1]!;
  const bx = coords[b * 2]!;
  const by = coords[b * 2 + 1]!;
  const cx = coords[c * 2]!;
  const cy = coords[c * 2 + 1]!;
  const dx = bx - ax;
  const dy = by - ay;
  const ex = cx - ax;
  const ey = cy - ay;
  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  const dd = 0.5 / (dx * ey - dy * ex);
  return [ax + (ey * bl - dy * cl) * dd, ay + (dx * cl - ex * bl) * dd];
}

/** Lloyd relaxation: move each site to its cell centroid, `iterations` times. */
export function relax(sites: Pt[], bounds: Bounds, iterations: number, fixed?: ReadonlySet<number>): Pt[] {
  let current = sites;
  for (let k = 0; k < iterations; k++) {
    const cells = voronoi(current, bounds);
    current = cells.map((c, i) => (fixed?.has(i) || c.ring.length < 3 ? current[i]! : centroid(c.ring)));
  }
  return current;
}

/**
 * Boundary of the union of the given cells, by keeping edges used by exactly
 * one selected cell and stitching them into rings (largest first).
 */
export function unionBoundary(cells: VoronoiCell[], selected: Iterable<number>): Ring[] {
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const edgeCount = new Map<string, { a: Pt; b: Pt; count: number }>();
  for (const i of selected) {
    const ring = cells[i]!.ring;
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % n]!;
      const ka = key(a);
      const kb = key(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = edgeCount.get(ek);
      if (entry) entry.count++;
      else edgeCount.set(ek, { a, b, count: 1 });
    }
  }
  const next = new Map<string, Pt[]>();
  for (const { a, b, count } of edgeCount.values()) {
    if (count !== 1) continue;
    (next.get(key(a)) ?? next.set(key(a), []).get(key(a))!).push(b);
    (next.get(key(b)) ?? next.set(key(b), []).get(key(b))!).push(a);
  }
  const used = new Set<string>();
  const rings: Ring[] = [];
  const starts = [...next.keys()].sort();
  for (const s of starts) {
    if (used.has(s)) continue;
    const ring: Ring = [];
    let currentKey = s;
    let current = next.get(s)![0]!;
    let prevKey = '';
    // Walk: from the start, pick the neighbour that is not where we came from.
    let pt: Pt = parseKey(s);
    let guard = 0;
    while (!used.has(currentKey) && guard++ < 100_000) {
      used.add(currentKey);
      ring.push(pt);
      const options = next.get(currentKey) ?? [];
      const choice = options.find((o) => key(o) !== prevKey) ?? options[0];
      if (!choice) break;
      prevKey = currentKey;
      pt = choice;
      currentKey = key(choice);
      current = choice;
    }
    void current;
    if (ring.length >= 3) rings.push(ring);
  }
  return rings.sort((r1, r2) => Math.abs(polyArea(r2)) - Math.abs(polyArea(r1)));
}

function parseKey(k: string): Pt {
  const [x, y] = k.split(',');
  return [Number(x), Number(y)];
}

function polyArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
