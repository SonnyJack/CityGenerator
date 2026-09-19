import type { Pt } from '../geometry/polygon.js';
import { contourPolygons, type Ring } from '../raster/contours.js';
import { Raster } from '../raster/raster.js';
import { landSampler, sampleTerrainField } from '../terrain/land.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';

/**
 * The shape of a settlement on its ground. A town is not a disc: it takes the
 * flat land first, spreads along a shore or a valley floor, and climbs a slope
 * only when the easy ground is used up. This fill grows outward from the
 * centre over a buildability mask (land above the sea; slopes cost more
 * the steeper they are, a river costs a bridge) and records, for every cell,
 * the area the growth had covered when it reached the cell. Expressed as the
 * radius of a disc of that area, that is an *equivalent radius*: on a flat
 * plain it equals the distance from the centre, and wherever the code used to
 * ask "is this within R of the centre" it can ask "is the equivalent radius
 * under R" and get the same area, shaped by the terrain. Growth rings, built
 * years and ward scores keep their radius semantics unchanged.
 */
export interface Footprint {
  /** Equivalent radius at a point (metres); Infinity where the growth never reaches. */
  radiusAt(x: number, y: number): number;
  /** Farthest any point with equivalent radius ≤ r lies from the centre (metres). */
  extent(r: number): number;
  /** Outline of the ground with equivalent radius ≤ r: the largest ring, closed, or null. */
  outline(r: number): Ring | null;
  /** Bounding box of the ground with equivalent radius ≤ r. */
  bbox(r: number): { minX: number; minY: number; maxX: number; maxY: number };
  /** Share of the ground with equivalent radius ≤ r that is steeper than the given slope. */
  steepShare(r: number, slope: number): number;
  readonly cellSizeM: number;
  readonly maxRadius: number;
}

export interface FootprintOptions {
  /** Slope (rise over run) above which ground is not built on at all; default none (the cost keeps rising). */
  slopeLimit?: number;
  /** Slope from which the cost starts to rise; default 0.05. */
  easySlope?: number;
  /** Slope at which ground costs seven times flat ground (the cost keeps rising beyond); default 0.4. */
  steepSlope?: number;
  /** Cost multiplier for crossing a river (a bridge); default 2.5. */
  riverCost?: number;
}

const GRID_CELLS = 480;

export function growthFootprint(
  terrain: TerrainOutput,
  center: Pt,
  maxRadius: number,
  options: FootprintOptions = {},
): Footprint {
  const slopeLimit = options.slopeLimit ?? Infinity;
  const easySlope = options.easySlope ?? 0.05;
  const steepSlope = options.steepSlope ?? 0.4;
  const riverCost = options.riverCost ?? 2.5;
  const { height } = terrain;
  // Window: the growth can spread along a strip well past the disc radius; clamp it to the
  // terrain and coarsen the cell so the grid stays affordable for a metropolis.
  const half = maxRadius * 2.2;
  const minX = Math.max(height.originX, center[0] - half);
  const maxX = Math.min(height.x(height.width - 1), center[0] + half);
  const minY = Math.max(height.originY, center[1] - half);
  const maxY = Math.min(height.y(height.height - 1), center[1] + half);
  const cell = Math.max(4, Math.max(maxX - minX, maxY - minY) / GRID_CELLS);
  const w = Math.max(2, Math.ceil((maxX - minX) / cell) + 1);
  const h = Math.max(2, Math.ceil((maxY - minY) / cell) + 1);
  const grid = new Raster({ width: w, height: h, cellSizeM: cell, originX: minX, originY: minY });
  const n = w * h;
  const cellArea = cell * cell;

  // Buildability and cost per cell.
  const onLand = landSampler(terrain, { rivers: 'land' });
  const weight = new Float32Array(n);
  const steep = new Uint8Array(n);
  const slopeOf = new Float32Array(n);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const x = grid.x(c);
      const y = grid.y(r);
      if (!onLand(x, y)) {
        weight[i] = Infinity;
        continue;
      }
      const s = sampleTerrainField(terrain, terrain.slope, x, y);
      slopeOf[i] = s;
      if (s > slopeLimit) {
        weight[i] = Infinity;
        steep[i] = 1;
        continue;
      }
      // Steep ground is dear, not forbidden: a hill town still takes its whole area, on the
      // gentlest ground within reach first and up the slopes only when that is used up.
      const t = Math.max(0, (s - easySlope) / (steepSlope - easySlope));
      let wgt = 1 + 6 * t * t;
      const tc = Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1);
      const tr = Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1);
      if (terrain.water[tr * height.width + tc] === WATER.river) wgt *= riverCost;
      weight[i] = wgt;
    }

  // Dijkstra from the centre cell, popping cells in reach order; the cumulative area at each
  // pop is the cell's equivalent radius. Stops once the requested area is covered.
  const sc = Math.min(Math.max(Math.round(grid.col(center[0])), 0), w - 1);
  const sr = Math.min(Math.max(Math.round(grid.row(center[1])), 0), h - 1);
  const si = sr * w + sc;
  const reach = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const re = new Float32Array(n).fill(Infinity);
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, i: number) => {
    heapF.push(f);
    heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! < heapF[k]! || (heapF[p] === heapF[k] && heapI[p]! <= heapI[k]!)) break;
      [heapF[p], heapF[k]] = [heapF[k]!, heapF[p]!];
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      k = p;
    }
  };
  const less = (a: number, b: number) =>
    heapF[a]! < heapF[b]! || (heapF[a] === heapF[b] && heapI[a]! < heapI[b]!);
  const pop = (): number => {
    const top = heapI[0]!;
    const lf = heapF.pop()!;
    const li = heapI.pop()!;
    if (heapF.length) {
      heapF[0] = lf;
      heapI[0] = li;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && less(l, m)) m = l;
        if (r < heapF.length && less(r, m)) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k]!, heapF[m]!];
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        k = m;
      }
    }
    return top;
  };
  const targetArea = Math.PI * maxRadius * maxRadius * 1.15;
  const sourceWeight = Number.isFinite(weight[si]!) ? weight[si]! : 1;
  reach[si] = 0;
  push(0, si);
  // Pop order, for the extent and the outline queries.
  const orderRe: number[] = [];
  const orderDist: number[] = [];
  const orderX: number[] = [];
  const orderY: number[] = [];
  let covered = 0;
  const cx = center[0];
  const cy = center[1];
  while (heapF.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    covered += cellArea;
    const c = i % w;
    const r = (i / w) | 0;
    const x = grid.x(c);
    const y = grid.y(r);
    re[i] = Math.sqrt(covered / Math.PI);
    orderRe.push(re[i]!);
    orderDist.push(Math.hypot(x - cx, y - cy));
    orderX.push(x);
    orderY.push(y);
    if (covered >= targetArea) break;
    const wi = i === si ? sourceWeight : weight[i]!;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
        const j = nr * w + nc;
        if (done[j]) continue;
        const wj = weight[j]!;
        if (!Number.isFinite(wj)) continue;
        // No diagonal step past a corner of unbuildable ground.
        if (dr && dc && (!Number.isFinite(weight[r * w + nc]!) || !Number.isFinite(weight[nr * w + c]!)))
          continue;
        const g = reach[i]! + cell * (dr && dc ? Math.SQRT2 : 1) * ((wi + wj) / 2);
        if (g < reach[j]!) {
          reach[j] = g;
          push(g, j);
        }
      }
  }
  // Prefix maxima of the distance (and the box) in pop order, so extent(r) and bbox(r) are a
  // binary search.
  const prefixMax: number[] = [];
  const boxes: number[] = [];
  let m = 0;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (let k = 0; k < orderDist.length; k++) {
    if (orderDist[k]! > m) m = orderDist[k]!;
    prefixMax.push(m);
    const x = orderX[k]!;
    const y = orderY[k]!;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (y < by0) by0 = y;
    if (y > by1) by1 = y;
    boxes.push(bx0, by0, bx1, by1);
  }
  const countWithin = (r: number): number => {
    // Number of popped cells with re ≤ r (orderRe is non-decreasing).
    let lo = 0;
    let hi = orderRe.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (orderRe[mid]! <= r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Unreached cells are given a value beyond any radius asked for, so the bilinear sample
  // stays finite across the edge; the nearest cell decides whether a point is reached at all.
  const beyond = maxRadius * 1.5;
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) field[i] = Number.isFinite(re[i]!) ? re[i]! : beyond;
  // One smoothing pass over the reached cells (the unreached keep their value, so the water's
  // edge stays put): ring edges then follow the ground without speckling on every knoll.
  const smooth = new Float32Array(field);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (!done[i]) continue;
      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
          const j = nr * w + nc;
          if (!done[j]) continue;
          sum += field[j]!;
          count++;
        }
      smooth[i] = sum / count;
    }
  field.set(smooth);
  const radiusAt = (x: number, y: number): number => {
    if (x < minX || y < minY || x > grid.x(w - 1) || y > grid.y(h - 1)) return Infinity;
    const fc = Math.min(Math.max(grid.col(x), 0), w - 1);
    const fr = Math.min(Math.max(grid.row(y), 0), h - 1);
    const c0 = Math.floor(fc);
    const r0 = Math.floor(fr);
    const c1 = Math.min(c0 + 1, w - 1);
    const r1 = Math.min(r0 + 1, h - 1);
    const tx = fc - c0;
    const ty = fr - r0;
    const a = field[r0 * w + c0]!;
    const b = field[r0 * w + c1]!;
    const cc = field[r1 * w + c0]!;
    const d = field[r1 * w + c1]!;
    const v = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
    return v >= beyond ? Infinity : v;
  };
  return {
    radiusAt,
    extent: (r) => {
      const k = countWithin(r);
      return k ? Math.max(prefixMax[k - 1]!, cell) : cell;
    },
    bbox: (r) => {
      const k = countWithin(r);
      if (!k) return { minX: cx - cell, minY: cy - cell, maxX: cx + cell, maxY: cy + cell };
      const j = (k - 1) * 4;
      return {
        minX: boxes[j]! - cell,
        minY: boxes[j + 1]! - cell,
        maxX: boxes[j + 2]! + cell,
        maxY: boxes[j + 3]! + cell,
      };
    },
    outline: (r) => {
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = -field[i]!;
      const polys = contourPolygons(grid, -r, data);
      const best = polys[0]?.rings[0];
      return best && best.length >= 4 ? best : null;
    },
    steepShare: (r, slope) => {
      const k = countWithin(r);
      if (!k) return 0;
      let steepCount = 0;
      let seen = 0;
      for (let i = 0; i < n && seen < k; i++) {
        if (!done[i] || re[i]! > r) continue;
        seen++;
        if (slopeOf[i]! > slope) steepCount++;
      }
      return steepCount / k;
    },
    cellSizeM: cell,
    maxRadius,
  };
}
