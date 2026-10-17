import {
  area,
  bbox,
  ccw,
  clearOfConvex,
  convexHull,
  convexOverlapArea,
  inset,
  open,
  pointInRing,
  segmentOutsideConvex,
  type Pt,
  type Ring,
} from './polygon.js';

/** A piece of ground already taken, by its convex outline. */
export interface Claim<T = unknown> {
  hull: Ring;
  /** The hull a little inside its edges: a street along the edge is not inside the claim. */
  interior: Ring;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  tag: T;
}

/**
 * Ground already built on or set aside, and the questions a later layout asks of it: what does
 * this block run into, is this point inside, cut this block clear. Each claim is held by its convex
 * hull, so a cut along one of its edges is guaranteed to clear it. A grid index keeps the lookups
 * local.
 */
export class Territory<T = unknown> {
  private readonly cells = new Map<string, Claim<T>[]>();
  constructor(private readonly cellM = 200) {}

  add(ring: Ring, tag: T, interiorM = 1.5): Claim<T> | null {
    const hull = ccw(convexHull(open(ring)));
    if (hull.length < 3 || area(hull) < 1) return null;
    const claim: Claim<T> = { hull, interior: inset(hull, interiorM), box: bbox(hull), tag };
    for (const k of this.keys(claim.box)) {
      const list = this.cells.get(k);
      if (list) list.push(claim);
      else this.cells.set(k, [claim]);
    }
    return claim;
  }

  /** Claims whose box meets this box, each once, optionally filtered. */
  near(box: Claim['box'], keep?: (c: Claim<T>) => boolean): Claim<T>[] {
    const seen = new Set<Claim<T>>();
    for (const k of this.keys(box))
      for (const c of this.cells.get(k) ?? [])
        if (
          !seen.has(c) &&
          c.box.minX <= box.maxX &&
          c.box.maxX >= box.minX &&
          c.box.minY <= box.maxY &&
          c.box.maxY >= box.minY &&
          (!keep || keep(c))
        )
          seen.add(c);
    return [...seen];
  }

  /** Whether a point is well inside some claim (not on a street along its edge). */
  covers(p: Pt, keep?: (c: Claim<T>) => boolean): boolean {
    const box = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] };
    return this.near(box, keep).some((c) => c.interior.length >= 3 && pointInRing(p[0], p[1], c.interior));
  }

  /**
   * Cut `ring` clear of every claim it overlaps by more than `toleranceM2`, one straight cut per
   * claim (largest overlap first), each `gapM` back from the claim's edge. Empty when it cannot be
   * cleared in a few cuts or nothing is left.
   */
  clear(
    ring: Ring,
    options: { gapM?: number; toleranceM2?: number; keep?: (c: Claim<T>) => boolean } = {},
  ): Ring {
    const { gapM = 0, toleranceM2 = 1, keep } = options;
    let out = ring;
    for (let step = 0; step < 8; step++) {
      if (out.length < 3) return [];
      let worst: Claim<T> | null = null;
      let worstArea = toleranceM2;
      for (const c of this.near(bbox(out), keep)) {
        const a = convexOverlapArea(out, c.hull);
        if (a > worstArea) {
          worstArea = a;
          worst = c;
        }
      }
      if (!worst) return out;
      out = clearOfConvex(out, worst.hull, gapM);
    }
    return [];
  }

  /**
   * The runs of a polyline outside every claim (inside a claim's interior, so a line along its
   * edge stays), each at least `minLengthM` long. A line that never enters a claim comes back
   * whole as one run.
   */
  outside(points: Pt[], minLengthM = 0, keep?: (c: Claim<T>) => boolean): Pt[][] {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]!;
      const b = points[k]!;
      const box = {
        minX: Math.min(a[0], b[0]),
        minY: Math.min(a[1], b[1]),
        maxX: Math.max(a[0], b[0]),
        maxY: Math.max(a[1], b[1]),
      };
      let pieces: [Pt, Pt][] = [[a, b]];
      for (const c of this.near(box, keep))
        if (c.interior.length >= 3)
          pieces = pieces.flatMap(([p, q]) => segmentOutsideConvex(p, q, c.interior));
      for (const [p, q] of pieces) {
        const last = run[run.length - 1];
        if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-6) run.push(q);
        else {
          if (run.length >= 2) runs.push(run);
          run = [p, q];
        }
      }
    }
    if (run.length >= 2) runs.push(run);
    const length = (r: Pt[]) =>
      r.reduce((d, q, j) => (j ? d + Math.hypot(q[0] - r[j - 1]![0], q[1] - r[j - 1]![1]) : 0), 0);
    return runs.filter((r) => length(r) >= minLengthM);
  }

  private keys(box: Claim['box']): string[] {
    const out: string[] = [];
    const s = this.cellM;
    for (let gx = Math.floor(box.minX / s); gx <= Math.floor(box.maxX / s); gx++)
      for (let gy = Math.floor(box.minY / s); gy <= Math.floor(box.maxY / s); gy++) out.push(`${gx},${gy}`);
    return out;
  }
}
