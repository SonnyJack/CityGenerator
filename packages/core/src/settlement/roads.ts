import type { FeatureCollection, LineString } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { smoothLine, simplifyLine, type Ring } from '../raster/contours.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import type { SettlementSite } from './siting.js';

/**
 * Region stage R5 (roads): connect settlements with terrain-routed roads.
 * A minimum spanning tree plus a few short extra links gives the network;
 * each link is routed with A* over the base raster, penalising slope and
 * treating river crossings as bridges (sea and lakes are impassable). The
 * largest settlement also gets roads out to the region edge.
 */

export interface RoadsInput {
  seed: string;
  terrain: TerrainOutput;
  sites: SettlementSite[];
}

export interface RoadsOutput {
  key: string;
  roads: FeatureCollection<LineString, { class: 'road'; from: string; to: string; lengthKm: number }>;
  bridges: FeatureCollection<LineString, { kind: 'bridge' }>;
  stats: { links: number; roadKm: number; bridges: number };
}

export const roadsStage = defineStage<RoadsInput, RoadsOutput>({
  id: 'roads',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) => `${i.terrain.key}|${JSON.stringify(i.sites.map((s) => [s.id, s.center, s.population]))}`,
  run({ terrain, sites }, ctx) {
    const { height, water, slope } = terrain;
    const { width, height: rows, cellSizeM } = height;
    const cellOf = (x: number, y: number): [number, number] => [
      Math.min(Math.max(Math.round(height.col(x)), 0), width - 1),
      Math.min(Math.max(Math.round(height.row(y)), 0), rows - 1),
    ];

    // Links: MST on Euclidean distance, plus extra links shorter than 1.3× the MST link for pairs
    // within 12 km that are not yet connected within two hops.
    const links: [number, number][] = [];
    if (sites.length >= 2) {
      const inTree = new Set<number>([0]);
      while (inTree.size < sites.length) {
        let best: [number, number, number] | null = null;
        for (const a of inTree)
          for (let b = 0; b < sites.length; b++) {
            if (inTree.has(b)) continue;
            const d = Math.hypot(
              sites[a]!.center[0] - sites[b]!.center[0],
              sites[a]!.center[1] - sites[b]!.center[1],
            );
            if (!best || d < best[2]) best = [a, b, d];
          }
        if (!best) break;
        links.push([best[0], best[1]]);
        inTree.add(best[1]);
      }
      for (let a = 0; a < sites.length; a++)
        for (let b = a + 1; b < sites.length; b++) {
          if (links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
          const d = Math.hypot(
            sites[a]!.center[0] - sites[b]!.center[0],
            sites[a]!.center[1] - sites[b]!.center[1],
          );
          const big = sites[a]!.population >= 3000 && sites[b]!.population >= 3000;
          if (d < (big ? 15_000 : 6_000)) links.push([a, b]);
        }
    }
    ctx.checkpoint();

    const roadFeatures: RoadsOutput['roads']['features'] = [];
    const bridgeFeatures: RoadsOutput['bridges']['features'] = [];
    let roadKm = 0;
    const trimRadius = new Map<string, number>();
    for (const s of sites) trimRadius.set(s.id, s.radiusM * 0.95);
    const routeAndPush = (
      from: [number, number],
      to: [number, number],
      idFrom: string,
      idTo: string,
      k: number,
    ) => {
      const allCells = astar(
        cellOf(from[0], from[1]),
        cellOf(to[0], to[1]),
        width,
        rows,
        cellSizeM,
        water,
        slope,
      );
      if (allCells.length < 2) return;
      // Stop at the built-up edge of each settlement; the town's own streets take over inside.
      const rFrom = trimRadius.get(idFrom) ?? 0;
      const rTo = trimRadius.get(idTo) ?? 0;
      const cells = allCells.filter(([c, r]) => {
        const x = height.x(c);
        const y = height.y(r);
        return Math.hypot(x - from[0], y - from[1]) >= rFrom && Math.hypot(x - to[0], y - to[1]) >= rTo;
      });
      if (cells.length < 2) return;
      const pts: Ring = cells.map(([c, r]) => [height.x(c), height.y(r)]);
      // Bridges: runs of river cells along the path.
      let run: Ring = [];
      for (const [c, r] of cells) {
        if (water[r * width + c] === WATER.river) run.push([height.x(c), height.y(r)]);
        else if (run.length) {
          bridgeFeatures.push({
            type: 'Feature',
            id: `bridge-${bridgeFeatures.length}`,
            geometry: { type: 'LineString', coordinates: run.length === 1 ? [run[0]!, run[0]!] : run },
            properties: { kind: 'bridge' },
          });
          run = [];
        }
      }
      const line = simplifyLine(smoothLine(pts, 2), cellSizeM * 0.3);
      let len = 0;
      for (let i = 1; i < line.length; i++)
        len += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
      roadKm += len / 1000;
      roadFeatures.push({
        type: 'Feature',
        id: `road-${k}`,
        geometry: { type: 'LineString', coordinates: line },
        properties: { class: 'road', from: idFrom, to: idTo, lengthKm: len / 1000 },
      });
    };
    links.forEach(([a, b], k) => {
      routeAndPush(sites[a]!.center, sites[b]!.center, sites[a]!.id, sites[b]!.id, k);
      ctx.checkpoint();
    });
    // Roads to the region edge from the largest settlement: two opposite-ish directions.
    if (sites.length) {
      const main = sites.reduce((m, s) => (s.population > m.population ? s : m), sites[0]!);
      const halfW = ((width - 1) * cellSizeM) / 2;
      const halfH = ((rows - 1) * cellSizeM) / 2;
      const targets: [number, number][] = [
        [halfW - cellSizeM, main.center[1]],
        [-halfW + cellSizeM, main.center[1]],
        [main.center[0], halfH - cellSizeM],
        [main.center[0], -halfH + cellSizeM],
      ];
      let k = links.length;
      for (const t of targets) {
        const [c, r] = cellOf(t[0], t[1]);
        if (water[r * width + c] === WATER.sea) continue;
        routeAndPush(main.center, t, main.id, 'edge', k++);
        ctx.checkpoint();
      }
    }
    return {
      key: ctx.key,
      roads: { type: 'FeatureCollection', features: roadFeatures },
      bridges: { type: 'FeatureCollection', features: bridgeFeatures },
      stats: { links: links.length, roadKm, bridges: bridgeFeatures.length },
    };
  },
});

/** A* over the raster with 8-connectivity. Returns cell coordinates from start to goal. */
function astar(
  start: [number, number],
  goal: [number, number],
  width: number,
  rows: number,
  cellSizeM: number,
  water: Uint8Array,
  slope: Float32Array,
): [number, number][] {
  const n = width * rows;
  const si = start[1] * width + start[0];
  const gi = goal[1] * width + goal[0];
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  g[si] = 0;
  // Binary heap of [f, index].
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
  let expanded = 0;
  while (heapF.length) {
    const u = pop();
    if (closed[u]) continue;
    closed[u] = 1;
    if (u === gi) break;
    if (++expanded > 400_000) break;
    const col = u % width;
    const row = (u / width) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= width || nr >= rows) continue;
        const v = nr * width + nc;
        if (closed[v]) continue;
        const w = water[v]!;
        if (w === WATER.sea || w === WATER.lake) continue;
        const step = dx && dy ? diag : cellSizeM;
        let cost = step * (1 + 6 * slope[v]!);
        if (w === WATER.river) cost += 400; // a bridge
        const ng = g[u]! + cost;
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
