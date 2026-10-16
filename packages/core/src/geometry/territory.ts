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

  private keys(box: Claim['box']): string[] {
    const out: string[] = [];
    const s = this.cellM;
    for (let gx = Math.floor(box.minX / s); gx <= Math.floor(box.maxX / s); gx++)
      for (let gy = Math.floor(box.minY / s); gy <= Math.floor(box.maxY / s); gy++) out.push(`${gx},${gy}`);
    return out;
  }
}
