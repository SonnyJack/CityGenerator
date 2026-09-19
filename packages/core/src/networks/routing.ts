import { WATER, type TerrainOutput } from '../terrain/stage.js';

/**
 * A* over the terrain raster with 8-connectivity. The cost of entering a cell
 * is `step × costOf(cell)`; a non-finite cost makes the cell impassable.
 * Returns cell coordinates from start to goal (empty when unreachable).
 */
export interface RouteOptions {
  /** Multiplier for the metre length of a step entering cell `i` (Infinity blocks). */
  costOf: (i: number) => number;
  /** Cap on expanded cells; the search stops (returning the best partial path) beyond it. */
  maxExpanded?: number;
}

export function routeCells(
  terrain: TerrainOutput,
  start: [number, number],
  goal: [number, number],
  options: RouteOptions,
): [number, number][] {
  const { width, height: rows, cellSizeM } = terrain.height;
  const n = width * rows;
  const si = start[1] * width + start[0];
  const gi = goal[1] * width + goal[0];
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  g[si] = 0;
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, i: number) => {
    heapF.push(f);
    heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= heapF[k]!) break;
      [heapF[p], heapF[k]] = [heapF[k]!, heapF[p]!];
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      k = p;
    }
  };
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
        if (l < heapF.length && heapF[l]! < heapF[m]!) m = l;
        if (r < heapF.length && heapF[r]! < heapF[m]!) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k]!, heapF[m]!];
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        k = m;
      }
    }
    return top;
  };
  const h = (i: number) => Math.hypot((i % width) - goal[0], ((i / width) | 0) - goal[1]) * cellSizeM;
  push(h(si), si);
  const diag = Math.SQRT2 * cellSizeM;
  const maxExpanded = options.maxExpanded ?? 400_000;
  let expanded = 0;
  while (heapF.length) {
    const u = pop();
    if (closed[u]) continue;
    closed[u] = 1;
    if (u === gi) break;
    if (++expanded > maxExpanded) break;
    const col = u % width;
    const row = (u / width) | 0;
    // Orthogonal passability once per expansion; diagonals reuse it (no corner cutting: a
    // diagonal step between two water cells would put the drawn shoreline through the path).
    const passE = col + 1 < width && Number.isFinite(options.costOf(u + 1));
    const passW = col > 0 && Number.isFinite(options.costOf(u - 1));
    const passS = row + 1 < rows && Number.isFinite(options.costOf(u + width));
    const passN = row > 0 && Number.isFinite(options.costOf(u - width));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= width || nr >= rows) continue;
        const v = nr * width + nc;
        // The goal itself (an outfall in the water, a quay) may be entered from a diagonal.
        if (dx && dy && v !== gi && !((dx > 0 ? passE : passW) && (dy > 0 ? passS : passN))) continue;
        if (closed[v]) continue;
        const mult = options.costOf(v);
        if (!Number.isFinite(mult)) continue;
        const step = dx && dy ? diag : cellSizeM;
        const ng = g[u]! + step * mult;
        if (ng < g[v]!) {
          g[v] = ng;
          prev[v] = u;
          push(ng + h(v), v);
        }
      }
  }
  if (prev[gi] === -1 && gi !== si) return [];
  const path: [number, number][] = [];
  for (let i = gi; i !== -1; i = prev[i]!) {
    path.push([i % width, (i / width) | 0]);
    if (i === si) break;
  }
  return path.reverse();
}

/** Nearest raster cell to a world position, clamped to the grid. */
export function cellAt(terrain: TerrainOutput, x: number, y: number): [number, number] {
  const { height } = terrain;
  return [
    Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1),
    Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1),
  ];
}

/** The road cost model: slope-weighted, sea and lakes impassable, rivers bridged at a fixed price. */
export function roadCost(terrain: TerrainOutput): RouteOptions['costOf'] {
  const { water, slope } = terrain;
  const cell = terrain.height.cellSizeM;
  return (v) => {
    const w = water[v]!;
    if (w === WATER.sea || w === WATER.lake) return Infinity;
    // (1 + 6·slope) per metre, plus a bridge surcharge expressed per metre of the step.
    return 1 + 6 * slope[v]! + (w === WATER.river ? 400 / cell : 0);
  };
}
