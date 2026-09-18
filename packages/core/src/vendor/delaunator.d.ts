/** Type declarations for the vendored Delaunator (mapbox/delaunator 4.0.1). */
export default class Delaunator {
  static from<P>(points: ArrayLike<P>, getX?: (p: P) => number, getY?: (p: P) => number): Delaunator;
  constructor(coords: ArrayLike<number>);
  coords: Float64Array;
  /** Triangle vertex indices, three per triangle. */
  triangles: Uint32Array;
  /** Opposite half-edge for each half-edge, or -1 on the hull. */
  halfedges: Int32Array;
  /** Indices of hull points in counter-clockwise order. */
  hull: Uint32Array;
  update(): void;
}
