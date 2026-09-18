import { describe, expect, it } from 'vitest';
import {
  Raster,
  Simplex2,
  contourLines,
  contourPolygons,
  fbm,
  simplifyLine,
  smoothLine,
} from '../src/index.js';

describe('Raster', () => {
  it('maps world coordinates to cells symmetrically about the origin', () => {
    const r = Raster.forExtent(1000, 500, 100);
    expect(r.width).toBe(11);
    expect(r.height).toBe(6);
    expect(r.x(0)).toBe(-500);
    expect(r.x(10)).toBe(500);
    expect(r.col(0)).toBe(5);
    expect(r.y(0)).toBe(-250);
  });

  it('samples bilinearly and cubically through a linear field exactly', () => {
    const r = Raster.forExtent(1000, 1000, 100);
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) r.set(col, row, r.x(col) * 2 + r.y(row));
    expect(r.sample(123, -321)).toBeCloseTo(123 * 2 - 321, 6);
    expect(r.sampleCubic(123, -321)).toBeCloseTo(123 * 2 - 321, 6);
    expect(r.sample(5000, 5000)).toBeCloseTo(500 * 2 + 500, 6); // clamped
  });
});

describe('Simplex2 / fbm', () => {
  it('is deterministic per seed and bounded', () => {
    const a = new Simplex2('s');
    const b = new Simplex2('s');
    const c = new Simplex2('t');
    let differs = false;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
      if (a.noise(x, y) !== c.noise(x, y)) differs = true;
      expect(Math.abs(fbm(a, x, y))).toBeLessThanOrEqual(1.0001);
    }
    expect(differs).toBe(true);
  });
});

describe('contours', () => {
  function cone(size: number, cell: number) {
    const r = Raster.forExtent(size, size, cell);
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) r.set(col, row, 100 - Math.hypot(r.x(col), r.y(row)) / 10);
    return r;
  }

  it('extracts a closed ring around a cone with the right area and orientation', () => {
    const r = cone(4000, 50);
    const polys = contourPolygons(r, 50); // radius 500 m
    expect(polys).toHaveLength(1);
    const p = polys[0]!;
    expect(p.rings).toHaveLength(1);
    expect(p.area).toBeGreaterThan(Math.PI * 500 * 500 * 0.95);
    expect(p.area).toBeLessThan(Math.PI * 500 * 500 * 1.05);
    const ring = p.rings[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('produces holes for a crater', () => {
    const r = cone(4000, 50);
    // Carve a pit in the middle.
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) if (Math.hypot(r.x(col), r.y(row)) < 200) r.set(col, row, 0);
    const polys = contourPolygons(r, 50);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.rings).toHaveLength(2);
  });

  it('keeps regions touching the border as polygons but drops border lines', () => {
    const r = Raster.forExtent(1000, 1000, 100);
    for (let row = 0; row < r.height; row++)
      for (let col = 0; col < r.width; col++) r.set(col, row, r.x(col));
    const polys = contourPolygons(r, 0); // east half
    expect(polys).toHaveLength(1);
    expect(polys[0]!.area).toBeCloseTo(500 * 1000, -2);
    const lines = contourLines(r, 0);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.length).toBeGreaterThanOrEqual(2);
    for (const [x] of line) expect(x).toBeCloseTo(0, 6);
  });

  it('smooths and simplifies lines', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const smooth = smoothLine(square, 1, true);
    expect(smooth.length).toBeGreaterThan(square.length);
    const zig: [number, number][] = [
      [0, 0],
      [1, 0.01],
      [2, -0.01],
      [3, 0],
    ];
    expect(simplifyLine(zig, 0.1)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });
});
