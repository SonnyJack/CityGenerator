import type { Raster } from '../raster/raster.js';
import { smoothLine, simplifyLine, type Ring } from '../raster/contours.js';
import type { FlowResult } from './hydrology.js';

export interface RiverReach {
  /** Polyline in world metres, upstream to downstream. */
  points: Ring;
  /** Drainage area at the downstream end, m². */
  areaM2: number;
  widthM: number;
  /** Strahler-like order: 1 for headwater reaches, increasing at junctions. */
  order: number;
  /** 'sea' | 'lake' | 'edge' | 'junction' */
  endsIn: 'sea' | 'lake' | 'edge' | 'junction';
}

/** Width from drainage area: about 14 m at 4 km², 60 m at 100 km². */
export function riverWidth(areaM2: number): number {
  return 2 + 0.0058 * Math.sqrt(areaM2);
}

/**
 * Extract river reaches from flow accumulation. A cell is a river cell when its
 * drainage area reaches `thresholdM2`. Reaches run from a head or junction to
 * the next junction or outlet.
 */
export function extractRivers(
  filled: Raster,
  flow: FlowResult,
  water: Uint8Array,
  thresholdM2: number,
): { reaches: RiverReach[]; riverMask: Uint8Array } {
  const { width, height: rows, cellSizeM } = filled;
  const n = width * rows;
  const cellArea = cellSizeM * cellSizeM;
  const isRiver = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] === 1 || water[i] === 2) continue; // sea, lake
    if (flow.accumulation[i]! * cellArea >= thresholdM2 && flow.downstream[i]! >= 0) isRiver[i] = 1;
  }
  const inCount = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isRiver[i]) continue;
    const j = flow.downstream[i]!;
    if (j >= 0 && isRiver[j]) inCount[j] = inCount[j]! + 1;
  }
  const order = new Int32Array(n);
  const reaches: RiverReach[] = [];
  const startCells: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver[i] && inCount[i] !== 1) startCells.push(i);
  // Process in flow order (highest first) so upstream reaches exist before junctions are ordered.
  const rank = new Int32Array(n);
  for (let k = 0; k < n; k++) rank[flow.order[k]!] = k;
  startCells.sort((a, b) => rank[a]! - rank[b]! || a - b);

  const inOrders = new Map<number, number[]>();
  for (const start of startCells) {
    let ord = 1;
    const incoming = inOrders.get(start);
    if (incoming && incoming.length > 0) {
      const sorted = [...incoming].sort((a, b) => b - a);
      ord = sorted.length >= 2 && sorted[0] === sorted[1] ? sorted[0]! + 1 : sorted[0]!;
    }
    const pts: Ring = [];
    let i = start;
    let endsIn: RiverReach['endsIn'] = 'edge';
    for (;;) {
      pts.push([filled.x(i % width), filled.y((i / width) | 0)]);
      order[i] = ord;
      const j = flow.downstream[i]!;
      if (j < 0) {
        endsIn = 'edge';
        break;
      }
      if (water[j] === 1) {
        pts.push([filled.x(j % width), filled.y((j / width) | 0)]);
        endsIn = 'sea';
        break;
      }
      if (water[j] === 2) {
        pts.push([filled.x(j % width), filled.y((j / width) | 0)]);
        endsIn = 'lake';
        break;
      }
      if (!isRiver[j]) {
        endsIn = 'edge';
        break;
      }
      if (inCount[j]! >= 2) {
        pts.push([filled.x(j % width), filled.y((j / width) | 0)]);
        endsIn = 'junction';
        const list = inOrders.get(j) ?? [];
        list.push(ord);
        inOrders.set(j, list);
        break;
      }
      i = j;
    }
    const areaM2 = flow.accumulation[i]! * cellArea;
    const smoothed = simplifyLine(smoothLine(pts, 2), cellSizeM * 0.25);
    if (smoothed.length >= 2) {
      reaches.push({ points: smoothed, areaM2, widthM: riverWidth(areaM2), order: ord, endsIn });
    }
  }
  return { reaches, riverMask: isRiver };
}
