import type { Raster } from '../raster/raster.js';

/**
 * Hydrology on a base heightmap: depression filling (priority flood), D8 flow
 * direction and accumulation, lake detection, distance-to-water. All routines
 * are deterministic and operate on Float32/Int32 typed arrays.
 */

/** Binary min-heap of cell indices keyed by a Float32 array (plus insertion order to break ties deterministically). */
class MinHeap {
  private readonly idx: Int32Array;
  private readonly key: Float64Array;
  private readonly seq: Int32Array;
  private size = 0;
  private counter = 0;

  constructor(capacity: number) {
    this.idx = new Int32Array(capacity);
    this.key = new Float64Array(capacity);
    this.seq = new Int32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(i: number, k: number): void {
    let pos = this.size++;
    this.idx[pos] = i;
    this.key[pos] = k;
    this.seq[pos] = this.counter++;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.less(pos, parent)) {
        this.swap(pos, parent);
        pos = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.idx[0]!;
    this.size--;
    if (this.size > 0) {
      this.idx[0] = this.idx[this.size]!;
      this.key[0] = this.key[this.size]!;
      this.seq[0] = this.seq[this.size]!;
      let pos = 0;
      for (;;) {
        const l = pos * 2 + 1;
        const r = l + 1;
        let m = pos;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === pos) break;
        this.swap(pos, m);
        pos = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const ka = this.key[a]!;
    const kb = this.key[b]!;
    return ka < kb || (ka === kb && this.seq[a]! < this.seq[b]!);
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = ti;
    const tk = this.key[a]!;
    this.key[a] = this.key[b]!;
    this.key[b] = tk;
    const ts = this.seq[a]!;
    this.seq[a] = this.seq[b]!;
    this.seq[b] = ts;
  }
}

/** 8-neighbour offsets, in a fixed order (E, NE, N, NW, W, SW, S, SE). */
export const D8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export interface FillResult {
  /** Depression-filled heights (metres); every land cell drains to the sea or the edge. */
  filled: Raster;
  /** True where filling raised the cell: standing water (lakes). */
  lake: Uint8Array;
  /** Cells in ascending order of filled height (the flood's pop order): a valid drainage order. */
  order: Int32Array;
}

/**
 * Priority-flood depression filling (Barnes et al. 2014) with a small epsilon
 * gradient so that flat filled areas still drain. Sea cells (height below
 * `seaLevel`) and border cells seed the flood.
 */
export function fillDepressions(height: Raster, seaLevel: number, epsilon = 1e-3): FillResult {
  const { width, height: rows } = height;
  const n = width * rows;
  const filled = new Float32Array(height.data);
  const lake = new Uint8Array(n);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(n);
  const order = new Int32Array(n);
  let popped = 0;

  for (let i = 0; i < n; i++) {
    const col = i % width;
    const row = (i / width) | 0;
    const border = col === 0 || row === 0 || col === width - 1 || row === rows - 1;
    if (border || height.data[i]! < seaLevel) {
      closed[i] = 1;
      heap.push(i, filled[i]!);
    }
  }

  while (heap.length > 0) {
    const i = heap.pop();
    order[popped++] = i;
    const col = i % width;
    const row = (i / width) | 0;
    const h = filled[i]!;
    for (let d = 0; d < 8; d++) {
      const nc = col + D8[d]![0];
      const nr = row + D8[d]![1];
      if (nc < 0 || nr < 0 || nc >= width || nr >= rows) continue;
      const j = nr * width + nc;
      if (closed[j]) continue;
      closed[j] = 1;
      if (filled[j]! <= h) {
        // Raised: part of a depression. Sea cells are not lakes.
        if (filled[j]! >= seaLevel) lake[j] = 1;
        filled[j] = h + epsilon;
      }
      heap.push(j, filled[j]!);
    }
  }
  // A cell raised only by epsilon on a genuine slope is not a lake; require a visible rise.
  for (let i = 0; i < n; i++) if (lake[i] && filled[i]! - height.data[i]! < 0.25) lake[i] = 0;
  return { filled: height.like(filled), lake, order };
}

export interface FlowResult {
  /** Index of the downstream cell, or -1 for outlets (sea/border/pit). */
  downstream: Int32Array;
  /** Number of cells draining through each cell, including itself. */
  accumulation: Float32Array;
  /** Cell indices sorted from highest to lowest filled height (processing order). */
  order: Int32Array;
}

/**
 * D8 steepest-descent flow on a depression-filled DEM, and accumulation in
 * topological order. `ascendingOrder` (from `fillDepressions`) avoids a sort.
 */
export function computeFlow(filled: Raster, seaLevel: number, ascendingOrder?: Int32Array): FlowResult {
  const { width, height: rows, cellSizeM } = filled;
  const n = width * rows;
  const h = filled.data;
  const downstream = new Int32Array(n).fill(-1);
  const diag = Math.SQRT2 * cellSizeM;

  for (let i = 0; i < n; i++) {
    if (h[i]! < seaLevel) continue; // sea: outlet
    const col = i % width;
    const row = (i / width) | 0;
    let best = -1;
    let bestSlope = 0;
    for (let d = 0; d < 8; d++) {
      const nc = col + D8[d]![0];
      const nr = row + D8[d]![1];
      if (nc < 0 || nr < 0 || nc >= width || nr >= rows) continue;
      const j = nr * width + nc;
      const dist = d & 1 ? diag : cellSizeM;
      const slope = (h[i]! - h[j]!) / dist;
      if (slope > bestSlope) {
        bestSlope = slope;
        best = j;
      }
    }
    downstream[i] = best;
  }

  const order = new Int32Array(n);
  if (ascendingOrder) {
    for (let k = 0; k < n; k++) order[k] = ascendingOrder[n - 1 - k]!;
  } else {
    // Sort by height descending with index as tie-break for determinism.
    const asArray: number[] = [];
    for (let i = 0; i < n; i++) asArray.push(i);
    asArray.sort((a, b) => h[b]! - h[a]! || a - b);
    order.set(asArray);
  }

  const accumulation = new Float32Array(n).fill(1);
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const j = downstream[i]!;
    if (j >= 0) accumulation[j] = accumulation[j]! + accumulation[i]!;
  }
  return { downstream, accumulation, order };
}

/**
 * Distance (metres) from every cell to the nearest cell where `mask` is non-zero,
 * by a two-pass chamfer transform (exact for orthogonal/diagonal steps, within
 * ~8 % of Euclidean otherwise). Deterministic and O(n).
 */
export function distanceTo(mask: Uint8Array, width: number, rows: number, cellSizeM: number): Float32Array {
  const n = width * rows;
  const dist = new Float32Array(n);
  const INF = 1e30;
  for (let i = 0; i < n; i++) dist[i] = mask[i] ? 0 : INF;
  const a = cellSizeM;
  const b = Math.SQRT2 * cellSizeM;
  // Forward pass: neighbours W, SW, S, SE.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      let d = dist[i]!;
      if (col > 0) d = Math.min(d, dist[i - 1]! + a);
      if (row > 0) {
        d = Math.min(d, dist[i - width]! + a);
        if (col > 0) d = Math.min(d, dist[i - width - 1]! + b);
        if (col < width - 1) d = Math.min(d, dist[i - width + 1]! + b);
      }
      dist[i] = d;
    }
  }
  // Backward pass: neighbours E, NE, N, NW.
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = width - 1; col >= 0; col--) {
      const i = row * width + col;
      let d = dist[i]!;
      if (col < width - 1) d = Math.min(d, dist[i + 1]! + a);
      if (row < rows - 1) {
        d = Math.min(d, dist[i + width]! + a);
        if (col < width - 1) d = Math.min(d, dist[i + width + 1]! + b);
        if (col > 0) d = Math.min(d, dist[i + width - 1]! + b);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/** Slope (rise/run, unitless) and aspect (radians, 0 = east, counter-clockwise) by central differences. */
export function slopeAspect(height: Raster): { slope: Float32Array; aspect: Float32Array } {
  const { width, height: rows, cellSizeM } = height;
  const h = height.data;
  const slope = new Float32Array(width * rows);
  const aspect = new Float32Array(width * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < width; col++) {
      const cl = Math.max(col - 1, 0);
      const cr = Math.min(col + 1, width - 1);
      const rd = Math.max(row - 1, 0);
      const ru = Math.min(row + 1, rows - 1);
      const dx = (h[row * width + cr]! - h[row * width + cl]!) / ((cr - cl) * cellSizeM);
      const dy = (h[ru * width + col]! - h[rd * width + col]!) / ((ru - rd) * cellSizeM);
      const i = row * width + col;
      slope[i] = Math.sqrt(dx * dx + dy * dy);
      aspect[i] = Math.atan2(-dy, -dx);
    }
  }
  return { slope, aspect };
}

/**
 * One explicit step of stream-power erosion: each land cell moves toward its
 * downstream neighbour by a fraction of the drop that grows with drainage
 * area. Applied to the original heights using directions from the filled
 * surface, it cuts outlets through basin rims so that enclosed hollows drain.
 */
export function erodeStep(
  height: Raster,
  flow: FlowResult,
  water: Uint8Array,
  strength: number,
  cellSizeM: number,
): void {
  const h = height.data;
  const n = h.length;
  const cellArea = cellSizeM * cellSizeM;
  const next = new Float32Array(h);
  for (let i = 0; i < n; i++) {
    if (water[i] === 1) continue; // sea
    const j = flow.downstream[i]!;
    if (j < 0) continue;
    const drop = h[i]! - h[j]!;
    if (drop <= 0) continue;
    const areaKm2 = (flow.accumulation[i]! * cellArea) / 1e6;
    const w = Math.min(1, Math.sqrt(areaKm2) * 1.5);
    next[i] = h[i]! - strength * w * drop;
  }
  h.set(next);
}

/** Light hillslope diffusion (3x3 box blend) on land cells; keeps the sea untouched. */
export function diffuse(height: Raster, water: Uint8Array, amount: number): void {
  const { width, height: rows } = height;
  const h = height.data;
  const next = new Float32Array(h);
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const i = row * width + col;
      if (water[i] === 1) continue;
      const avg =
        (h[i - 1]! +
          h[i + 1]! +
          h[i - width]! +
          h[i + width]! +
          h[i - width - 1]! +
          h[i - width + 1]! +
          h[i + width - 1]! +
          h[i + width + 1]!) /
        8;
      next[i] = h[i]! + (avg - h[i]!) * amount;
    }
  }
  h.set(next);
}
