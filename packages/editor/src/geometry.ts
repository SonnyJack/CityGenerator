import type { Geometry, Position } from 'geojson';
import type { AuthoredFeature } from '@citygen/core';

/** Geometry helpers for the editor: transforms, hit testing and vertex access. */

export type XY = [number, number];

function mapPositions(g: Geometry, fn: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { ...g, coordinates: fn(g.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...g, coordinates: g.coordinates.map(fn) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...g, coordinates: g.coordinates.map((r) => r.map(fn)) };
    case 'MultiPolygon':
      return { ...g, coordinates: g.coordinates.map((poly) => poly.map((r) => r.map(fn))) };
    default:
      return g;
  }
}

export function allPositions(g: Geometry): Position[] {
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates;
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.flat();
    case 'MultiPolygon':
      return g.coordinates.flat(2);
    default:
      return [];
  }
}

export function geometryCentroid(g: Geometry): XY {
  // Rings repeat their first position; drop the closing point so it is not double-weighted.
  const pts =
    g.type === 'Polygon'
      ? g.coordinates.flatMap((r) => r.slice(0, -1))
      : g.type === 'MultiPolygon'
        ? g.coordinates.flatMap((poly) => poly.flatMap((r) => r.slice(0, -1)))
        : allPositions(g);
  if (!pts.length) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p[0]!;
    sy += p[1]!;
  }
  return [sx / pts.length, sy / pts.length];
}

export function translate(g: Geometry, dx: number, dy: number): Geometry {
  return mapPositions(g, (p) => [p[0]! + dx, p[1]! + dy]);
}

/** Rotate by `radians` counter-clockwise around `about` (default: centroid). */
export function rotate(g: Geometry, radians: number, about?: XY): Geometry {
  const [cx, cy] = about ?? geometryCentroid(g);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return mapPositions(g, (p) => {
    const x = p[0]! - cx;
    const y = p[1]! - cy;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

export function scale(g: Geometry, factor: number, about?: XY): Geometry {
  const [cx, cy] = about ?? geometryCentroid(g);
  return mapPositions(g, (p) => [cx + (p[0]! - cx) * factor, cy + (p[1]! - cy) * factor]);
}

/** Mirror across a vertical (axis 'x') or horizontal (axis 'y') line through the centroid. */
export function mirror(g: Geometry, axis: 'x' | 'y', about?: XY): Geometry {
  const [cx, cy] = about ?? geometryCentroid(g);
  const out = mapPositions(g, (p) => (axis === 'x' ? [2 * cx - p[0]!, p[1]!] : [p[0]!, 2 * cy - p[1]!]));
  // Mirroring flips ring orientation; keep polygons counter-clockwise.
  if (out.type === 'Polygon') return { ...out, coordinates: out.coordinates.map((r) => [...r].reverse()) };
  return out;
}

export function distToSegment(p: XY, a: Position, b: Position): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]!) * dx + (p[1] - a[1]!) * dy) / len2));
  return Math.hypot(p[0] - (a[0]! + t * dx), p[1] - (a[1]! + t * dy));
}

export function pointInRing(p: XY, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a geometry (0 inside polygons). */
export function distToGeometry(p: XY, g: Geometry): number {
  switch (g.type) {
    case 'Point':
      return Math.hypot(p[0] - g.coordinates[0]!, p[1] - g.coordinates[1]!);
    case 'MultiPoint':
      return Math.min(...g.coordinates.map((c) => Math.hypot(p[0] - c[0]!, p[1] - c[1]!)));
    case 'LineString':
      return lineDist(p, g.coordinates);
    case 'MultiLineString':
      return Math.min(...g.coordinates.map((l) => lineDist(p, l)));
    case 'Polygon':
      return pointInRing(p, g.coordinates[0]!) ? 0 : lineDist(p, g.coordinates[0]!);
    case 'MultiPolygon':
      return Math.min(...g.coordinates.map((poly) => (pointInRing(p, poly[0]!) ? 0 : lineDist(p, poly[0]!))));
    default:
      return Infinity;
  }
}

function lineDist(p: XY, line: Position[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1]!, line[i]!));
  return line.length === 1 ? Math.hypot(p[0] - line[0]![0]!, p[1] - line[0]![1]!) : best;
}

export function featureBBox(f: AuthoredFeature): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of allPositions(f.geometry)) {
    minX = Math.min(minX, p[0]!);
    minY = Math.min(minY, p[1]!);
    maxX = Math.max(maxX, p[0]!);
    maxY = Math.max(maxY, p[1]!);
  }
  return { minX, minY, maxX, maxY };
}

/** Editable vertices of a geometry as [ringIndex, pointIndex, x, y]; polygons omit the closing point. */
export function vertices(g: Geometry): { ring: number; index: number; p: XY }[] {
  const out: { ring: number; index: number; p: XY }[] = [];
  if (g.type === 'Point') out.push({ ring: 0, index: 0, p: [g.coordinates[0]!, g.coordinates[1]!] });
  else if (g.type === 'LineString')
    g.coordinates.forEach((c, i) => out.push({ ring: 0, index: i, p: [c[0]!, c[1]!] }));
  else if (g.type === 'Polygon')
    g.coordinates.forEach((r, ri) =>
      r.slice(0, -1).forEach((c, i) => out.push({ ring: ri, index: i, p: [c[0]!, c[1]!] })),
    );
  return out;
}

/** Move one vertex; polygons keep their closing point in sync. */
export function setVertex(g: Geometry, ring: number, index: number, p: XY): Geometry {
  if (g.type === 'Point') return { ...g, coordinates: [p[0], p[1]] };
  if (g.type === 'LineString')
    return { ...g, coordinates: g.coordinates.map((c, i) => (i === index ? [p[0], p[1]] : c)) };
  if (g.type === 'Polygon') {
    return {
      ...g,
      coordinates: g.coordinates.map((r, ri) => {
        if (ri !== ring) return r;
        const out = r.map((c, i) => (i === index ? [p[0], p[1]] : c));
        if (index === 0) out[out.length - 1] = [p[0], p[1]];
        return out;
      }),
    };
  }
  return g;
}

/** Insert a vertex after `index` (on the segment index→index+1). */
export function insertVertex(g: Geometry, ring: number, index: number, p: XY): Geometry {
  if (g.type === 'LineString') {
    const c = [...g.coordinates];
    c.splice(index + 1, 0, [p[0], p[1]]);
    return { ...g, coordinates: c };
  }
  if (g.type === 'Polygon') {
    return {
      ...g,
      coordinates: g.coordinates.map((r, ri) => {
        if (ri !== ring) return r;
        const c = [...r];
        c.splice(index + 1, 0, [p[0], p[1]]);
        return c;
      }),
    };
  }
  return g;
}

/** Remove a vertex when the geometry stays valid (lines keep ≥ 2 points, rings ≥ 3). */
export function removeVertex(g: Geometry, ring: number, index: number): Geometry {
  if (g.type === 'LineString' && g.coordinates.length > 2) {
    return { ...g, coordinates: g.coordinates.filter((_, i) => i !== index) };
  }
  if (g.type === 'Polygon') {
    const r = g.coordinates[ring]!;
    if (r.length - 1 <= 3) return g;
    const open = r.slice(0, -1).filter((_, i) => i !== index);
    return { ...g, coordinates: g.coordinates.map((rr, ri) => (ri === ring ? [...open, open[0]!] : rr)) };
  }
  return g;
}

/** Split a line at vertex `index` into two lines (both keep the vertex). */
export function splitLine(g: Geometry, index: number): [Geometry, Geometry] | null {
  if (g.type !== 'LineString' || index <= 0 || index >= g.coordinates.length - 1) return null;
  return [
    { type: 'LineString', coordinates: g.coordinates.slice(0, index + 1) },
    { type: 'LineString', coordinates: g.coordinates.slice(index) },
  ];
}

/** Join two lines end to start when their ends are within `tolerance`. */
export function joinLines(a: Geometry, b: Geometry, tolerance: number): Geometry | null {
  if (a.type !== 'LineString' || b.type !== 'LineString') return null;
  const ends = [
    [a.coordinates[a.coordinates.length - 1]!, b.coordinates[0]!, a.coordinates, b.coordinates],
    [
      a.coordinates[a.coordinates.length - 1]!,
      b.coordinates[b.coordinates.length - 1]!,
      a.coordinates,
      [...b.coordinates].reverse(),
    ],
    [a.coordinates[0]!, b.coordinates[0]!, [...a.coordinates].reverse(), b.coordinates],
    [
      a.coordinates[0]!,
      b.coordinates[b.coordinates.length - 1]!,
      [...a.coordinates].reverse(),
      [...b.coordinates].reverse(),
    ],
  ] as const;
  for (const [pa, pb, first, second] of ends) {
    if (Math.hypot(pa[0]! - pb[0]!, pa[1]! - pb[1]!) <= tolerance) {
      return { type: 'LineString', coordinates: [...first, ...second.slice(1)] };
    }
  }
  return null;
}

/** Offset a line sideways by `d` metres (left of travel when positive). */
export function offsetLine(g: Geometry, d: number): Geometry {
  if (g.type !== 'LineString') return g;
  const c = g.coordinates;
  const out: Position[] = c.map((p, i) => {
    const prev = c[Math.max(0, i - 1)]!;
    const next = c[Math.min(c.length - 1, i + 1)]!;
    const dx = next[0]! - prev[0]!;
    const dy = next[1]! - prev[1]!;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0]! - (dy / len) * d, p[1]! + (dx / len) * d];
  });
  return { type: 'LineString', coordinates: out };
}
