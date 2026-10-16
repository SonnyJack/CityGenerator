import { describe, expect, it } from 'vitest';
import {
  Rng,
  area,
  centroid,
  clipHalfPlane,
  clipRect,
  clearOfConvex,
  convexHull,
  convexOverlapArea,
  segmentOutsideConvex,
  Territory,
  inset,
  orientedBox,
  relax,
  splitByLine,
  unionBoundary,
  voronoi,
  type Pt,
} from '../src/index.js';

const square: Pt[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('polygon utilities', () => {
  it('computes area and centroid', () => {
    expect(area(square)).toBe(100);
    expect(centroid(square)).toEqual([5, 5]);
  });

  it('clips against half-planes and rectangles', () => {
    const left = clipHalfPlane(square, [5, 0], [5, 10]); // keep left of upward line: x <= 5
    expect(area(left)).toBeCloseTo(50);
    const r = clipRect(square, 2, 2, 20, 20);
    expect(area(r)).toBeCloseTo(64);
    const { left: l, right: rr } = splitByLine(square, [0, 3], [10, 3]);
    expect(area(l) + area(rr)).toBeCloseTo(100);
  });

  it('insets convex rings', () => {
    const inner = inset(square, 2);
    expect(area(inner)).toBeCloseTo(36);
    expect(inset(square, 6)).toEqual([]);
  });

  it('finds the oriented box of a rotated rectangle', () => {
    const c = Math.cos(0.4);
    const s = Math.sin(0.4);
    const rect: Pt[] = [
      [0, 0],
      [20 * c, 20 * s],
      [20 * c - 5 * s, 20 * s + 5 * c],
      [-5 * s, 5 * c],
    ];
    const box = orientedBox(rect);
    expect(box.length).toBeCloseTo(20);
    expect(box.width).toBeCloseTo(5);
    expect(Math.abs(box.axis[0] * c + box.axis[1] * s)).toBeCloseTo(1);
  });
});

describe('clearing older ground', () => {
  const shifted = (dx: number, dy: number): Pt[] => square.map(([x, y]) => [x + dx, y + dy]);

  it('takes the convex hull of a point set, counter-clockwise', () => {
    const hull = convexHull([...square, [5, 5], [2, 8]]);
    expect(hull).toHaveLength(4);
    expect(area(hull)).toBeCloseTo(100);
  });

  it('measures how much of a ring lies inside a convex one', () => {
    expect(convexOverlapArea(square, shifted(5, 5))).toBeCloseTo(25);
    expect(convexOverlapArea(square, shifted(20, 0))).toBe(0);
  });

  it('cuts a ring clear of a convex one along the edge that keeps the most', () => {
    // A neighbour reaching 3 m into the square from the right: one cut along its left edge.
    const cleared = clearOfConvex(square, shifted(7, 0), 0);
    expect(area(cleared)).toBeCloseTo(70);
    expect(convexOverlapArea(cleared, shifted(7, 0))).toBeLessThan(1e-9);
    // With a gap, the cut stands back from the edge.
    expect(area(clearOfConvex(square, shifted(7, 0), 2))).toBeCloseTo(50);
    // Swallowed whole: nothing is left.
    expect(clearOfConvex(square, shifted(-5, -5).map(([x, y]) => [x * 2, y * 2]) as Pt[], 0)).toEqual([]);
  });

  it('keeps the stretches of a segment outside a convex ring', () => {
    const out = segmentOutsideConvex([-5, 5], [15, 5], square);
    expect(out).toHaveLength(2);
    expect(out[0]![1][0]).toBeCloseTo(0);
    expect(out[1]![0][0]).toBeCloseTo(10);
    expect(segmentOutsideConvex([2, 2], [8, 8], square)).toEqual([]);
    expect(segmentOutsideConvex([-5, 20], [15, 20], square)).toHaveLength(1);
  });

  it('clears a ring of every claim in a territory, and knows which points are taken', () => {
    const t = new Territory<string>(50);
    t.add(shifted(7, 0), 'east');
    t.add(shifted(0, 8), 'north');
    const cleared = t.clear(square);
    expect(area(cleared)).toBeGreaterThan(40);
    for (const c of t.near({ minX: -100, minY: -100, maxX: 100, maxY: 100 }))
      expect(convexOverlapArea(cleared, c.hull)).toBeLessThan(1e-6);
    expect(t.covers([12, 5])).toBe(true);
    // On the edge of a claim is a street, not inside it.
    expect(t.covers([7, 5])).toBe(false);
    expect(t.covers([3, 3])).toBe(false);
  });
});

describe('voronoi', () => {
  const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

  it('partitions the bounds with cells that tile the area', () => {
    const rng = new Rng('voronoi');
    const sites: Pt[] = Array.from({ length: 60 }, () => [rng.range(-90, 90), rng.range(-90, 90)]);
    const cells = voronoi(sites, bounds);
    expect(cells).toHaveLength(60);
    const total = cells.reduce((s, c) => s + area(c.ring), 0);
    expect(total).toBeCloseTo(200 * 200, 0);
    for (const c of cells) expect(c.neighbours.length).toBeGreaterThan(0);
  });

  it('relaxes toward centroids and is deterministic', () => {
    const rng = new Rng('relax');
    const sites: Pt[] = Array.from({ length: 40 }, () => [rng.range(-90, 90), rng.range(-90, 90)]);
    const a = relax(sites, bounds, 3);
    const b = relax(sites, bounds, 3);
    expect(a).toEqual(b);
    const cells = voronoi(a, bounds);
    const areas = cells.map((c) => area(c.ring));
    const mean = areas.reduce((s, x) => s + x, 0) / areas.length;
    const spread = Math.sqrt(areas.reduce((s, x) => s + (x - mean) ** 2, 0) / areas.length) / mean;
    const raw = voronoi(sites, bounds).map((c) => area(c.ring));
    const rawSpread = Math.sqrt(raw.reduce((s, x) => s + (x - mean) ** 2, 0) / raw.length) / mean;
    expect(spread).toBeLessThan(rawSpread);
  });

  it('unions adjacent cells by edge counting', () => {
    const sites: Pt[] = [
      [-50, -50],
      [50, -50],
      [-50, 50],
      [50, 50],
      [0, 0],
    ];
    const cells = voronoi(sites, bounds);
    const rings = unionBoundary(cells, [0, 1, 4]);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const u = area(rings[0]!);
    expect(u).toBeCloseTo(area(cells[0]!.ring) + area(cells[1]!.ring) + area(cells[4]!.ring), 3);
  });
});
