import { describe, expect, it } from 'vitest';
import type { Geometry } from 'geojson';
import {
  distToGeometry,
  featureBBox,
  geometryCentroid,
  insertVertex,
  joinLines,
  mirror,
  offsetLine,
  pointInRing,
  removeVertex,
  rotate,
  scale,
  setVertex,
  splitLine,
  translate,
  vertices,
} from '../src/index.js';

const square: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};
const line: Geometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [10, 0],
    [20, 0],
  ],
};

describe('editor geometry', () => {
  it('translates, rotates, scales and mirrors about the centroid', () => {
    expect(geometryCentroid(square)).toEqual([5, 5]);
    const moved = translate(square, 5, -5) as typeof square;
    expect(moved.coordinates[0]![2]).toEqual([15, 5]);
    const rotated = rotate(square, Math.PI / 2) as typeof square;
    const c = rotated.coordinates[0]!;
    expect(c[0]![0]).toBeCloseTo(10);
    expect(c[0]![1]).toBeCloseTo(0);
    expect(geometryCentroid(rotated)[0]).toBeCloseTo(5);
    const scaled = scale(square, 2) as typeof square;
    expect(scaled.coordinates[0]![0]).toEqual([-5, -5]);
    const mirrored = mirror(square, 'x') as typeof square;
    expect(geometryCentroid(mirrored)).toEqual([5, 5]);
    expect(
      featureBBox({
        type: 'Feature',
        id: 'a',
        geometry: mirrored,
        properties: { layer: 'zone', origin: 'authored' },
      }),
    ).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
  });

  it('tests points against rings and measures distance to geometries', () => {
    expect(pointInRing([5, 5], square.coordinates[0]!)).toBe(true);
    expect(pointInRing([15, 5], square.coordinates[0]!)).toBe(false);
    expect(distToGeometry([5, 5], square)).toBe(0);
    expect(distToGeometry([15, 5], square)).toBeCloseTo(5);
    expect(distToGeometry([10, 3], line)).toBeCloseTo(3);
    expect(distToGeometry([1, 1], { type: 'Point', coordinates: [4, 5] })).toBeCloseTo(5);
  });

  it('edits vertices and keeps polygons closed', () => {
    expect(vertices(square)).toHaveLength(4);
    const moved = setVertex(square, 0, 0, [-1, -1]) as typeof square;
    expect(moved.coordinates[0]![0]).toEqual([-1, -1]);
    expect(moved.coordinates[0]![4]).toEqual([-1, -1]);
    const inserted = insertVertex(square, 0, 0, [5, -1]) as typeof square;
    expect(inserted.coordinates[0]).toHaveLength(6);
    expect(inserted.coordinates[0]![1]).toEqual([5, -1]);
    const removed = removeVertex(inserted, 0, 1) as typeof square;
    expect(removed.coordinates[0]).toEqual(square.coordinates[0]);
    const triangle = removeVertex(square, 0, 0) as typeof square;
    expect(triangle.coordinates[0]).toHaveLength(4);
    expect(triangle.coordinates[0]![0]).toEqual(triangle.coordinates[0]![3]);
    // A triangle cannot lose another vertex.
    expect(removeVertex(triangle, 0, 0)).toBe(triangle);
    const two = removeVertex(line, 0, 1) as typeof line;
    expect(two.coordinates).toHaveLength(2);
    expect(removeVertex(two, 0, 0)).toBe(two);
  });

  it('splits, joins and offsets lines', () => {
    const [a, b] = splitLine(line, 1);
    expect(a!.coordinates).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(b!.coordinates).toEqual([
      [10, 0],
      [20, 0],
    ]);
    const joined = joinLines(a!, b!, 0.1) as typeof line;
    expect(joined.coordinates).toEqual(line.coordinates);
    const reversed = joinLines(b!, a!, 0.1) as typeof line;
    expect(reversed.coordinates).toHaveLength(3);
    const off = offsetLine(line, 2) as typeof line;
    expect(off.coordinates.every((p) => Math.abs(Math.abs(p[1]!) - 2) < 1e-9)).toBe(true);
    expect(off.coordinates).toHaveLength(3);
  });
});
