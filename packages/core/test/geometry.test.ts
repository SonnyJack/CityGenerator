import { describe, expect, it } from 'vitest';
import {
  Rng,
  area,
  centroid,
  clipHalfPlane,
  clipRect,
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
