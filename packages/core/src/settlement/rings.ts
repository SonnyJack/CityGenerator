import { area, ccw, centroid, inset, open, splitByLine, type Pt } from '../geometry/polygon.js';
import type { Ring } from '../raster/contours.js';
import type { Rng } from '../random/rng.js';
import type { TerrainOutput } from '../terrain/stage.js';
import type { SocietyOutput, WealthClass, DensityClass } from '../society/stage.js';
import type { SettlementSite } from './siting.js';
import { populationAt, radiusAt, radiusForPopulation, yearForRadius } from './history.js';
import type { EraParams } from './eras.js';
import type { WardId } from './wards.js';

/**
 * Growth rings: the part of a settlement built after its organic core, in
 * the street pattern of the era that built it (DESIGN §6.3). Ring extents come
 * from a growth curve of the population; each ring is a rotated grid whose
 * cells become blocks, cut by radial arteries.
 */

export interface GrowthRing {
  era: EraParams;
  rIn: number;
  rOut: number;
  /** Years the ring was under construction: the era's start to the next boundary. */
  fromYear: number;
  toYear: number;
}

export interface RingBlock {
  ring: Ring;
  /** Ring index (0 = first ring outside the core). */
  ringIndex: number;
  /** Stable cell key within the ring (grid indices and piece), the same at every year. */
  key: string;
  era: EraParams;
  onArtery: boolean;
  waterfront: boolean;
  /** Year the block was laid out, from the settlement's growth curve. */
  builtYear: number;
}

export interface RingsResult {
  rings: GrowthRing[];
  blocks: RingBlock[];
  /** Street polylines with their class. */
  streets: { points: Ring; cls: 'artery' | 'collector' | 'street' | 'motorway'; key: string }[];
  coreRadius: number;
}

/**
 * Ring boundaries for the settlement's history. Past boundaries come from the
 * anchored growth curve, so they are the same at every year; only the newest
 * ring grows with the year. The core is everything up to the first non-organic
 * era after the founding.
 */
export function growthRings(
  site: SettlementSite,
  year: number,
  eras: readonly EraParams[],
): { coreRadius: number; rings: GrowthRing[]; coreEndYear: number } {
  const h = site.history;
  const sorted = [...eras].sort((a, b) => a.year - b.year);
  const boundaries: { era: EraParams; r: number; year: number }[] = [];
  for (const era of sorted) {
    if (era.year <= h.founded || era.year > year) continue;
    boundaries.push({ era, r: radiusForPopulation(populationAt(h, era.year), era.year), year: era.year });
  }
  // The current year closes the last ring at the settlement's radius, in the current era's pattern.
  const current = sorted.filter((e) => e.year <= year).pop() ?? sorted[0]!;
  boundaries.push({ era: current, r: radiusAt(h, year), year });
  // The core's final extent is fixed by the first grid era after the founding (or the anchor when
  // the settlement stays organic), so the old town never re-tessellates as the year moves.
  const firstGrid = sorted.find((e) => e.year > h.founded && e.ringPattern !== 'organic');
  const coreEndYear = firstGrid ? firstGrid.year : Math.max(h.anchorYear, year);
  const coreRadius = Math.max(
    radiusForPopulation(populationAt(h, coreEndYear), coreEndYear) * (firstGrid ? 1 : 1),
    radiusForPopulation(30, coreEndYear),
  );
  const rings: GrowthRing[] = [];
  let prevR = coreRadius;
  let prevYear = coreEndYear;
  for (const b of boundaries) {
    if (b.era.ringPattern === 'organic' || b.year <= coreEndYear) continue;
    if (b.r > prevR + 40) {
      rings.push({ era: b.era, rIn: prevR, rOut: b.r, fromYear: prevYear, toYear: b.year });
      prevR = b.r;
    }
    prevYear = b.year;
  }
  return { coreRadius, rings, coreEndYear };
}

interface RingGenContext {
  site: SettlementSite;
  terrain: TerrainOutput;
  rng: Rng;
  isLand: (x: number, y: number) => boolean;
  clipToLand: (ring: Ring, site: Pt) => Ring | null;
  slopeAt: (x: number, y: number) => number;
  /** Gate positions of the organic core, used to start radial arteries. */
  gates: Pt[];
}

/** Generate grid blocks and streets for all rings. */
export function generateRings(rings: GrowthRing[], coreRadius: number, ctx: RingGenContext): RingsResult {
  const { site, rng } = ctx;
  const [cx, cy] = site.center;
  const blocks: RingBlock[] = [];
  const streets: RingsResult['streets'] = [];
  if (!rings.length) return { rings, blocks, streets, coreRadius };
  const R = rings[rings.length - 1]!.rOut;

  // Radial arteries: from gates (or evenly spaced angles) out to the edge.
  const arteryCount = Math.min(8, Math.max(3, Math.round(2 + Math.sqrt(site.anchorPopulation) / 40)));
  const angles: number[] = [];
  const base = rng.range(0, Math.PI * 2);
  for (let i = 0; i < arteryCount; i++) {
    let a = base + (i / arteryCount) * Math.PI * 2 + rng.range(-0.15, 0.15);
    // Snap to a nearby gate direction when the core has one.
    const gate = ctx.gates
      .map((g) => ({ g, a: Math.atan2(g[1] - cy, g[0] - cx) }))
      .find((g) => Math.abs(((g.a - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.35);
    if (gate) a = gate.a;
    angles.push(a);
  }
  const arteryLines: { a: Pt; b: Pt; far: Pt }[] = [];
  for (const a of angles) {
    const dir: Pt = [Math.cos(a), Math.sin(a)];
    const start: Pt = [cx + dir[0] * coreRadius * 0.98, cy + dir[1] * coreRadius * 0.98];
    // Stop the artery where it would enter the sea.
    let end: Pt = [cx + dir[0] * R * 1.05, cy + dir[1] * R * 1.05];
    for (let d = coreRadius; d <= R * 1.05; d += 25) {
      const p: Pt = [cx + dir[0] * d, cy + dir[1] * d];
      if (!ctx.isLand(p[0], p[1])) {
        end = [cx + dir[0] * (d - 25), cy + dir[1] * (d - 25)];
        break;
      }
    }
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 60) continue;
    // Cuts use a far point on the same line so the split arithmetic is bit-identical whatever the
    // artery's current length (the ring's outer edge moves with the year; the cuts must not).
    arteryLines.push({ a: start, b: end, far: [start[0] + dir[0] * 50_000, start[1] + dir[1] * 50_000] });
    streets.push({ points: [start, end], cls: 'artery', key: `artery-${arteryLines.length - 1}` });
  }

  // Grid orientation: along the first artery, jittered per ring for variety.
  const theta0 = angles[0] ?? 0;
  const edgeKeys = new Set<string>();
  const key = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const pushEdge = (a: Pt, b: Pt, cls: 'collector' | 'street') => {
    const ka = key(a);
    const kb = key(b);
    const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (edgeKeys.has(ek)) return;
    edgeKeys.add(ek);
    streets.push({ points: [a, b], cls, key: ek });
  };

  rings.forEach((ring, ringIndex) => {
    const era = ring.era;
    const pattern = era.ringPattern;
    const sizeMul =
      pattern === 'suburban' ? 1.25 : pattern === 'culDeSac' ? 1.6 : pattern === 'towers' ? 2 : 1;
    const bw = era.blockSizeM.ring * 0.62 * sizeMul;
    const bh = era.blockSizeM.ring * (pattern === 'streetcar' ? 1.5 : 1) * sizeMul;
    const ringRng = rng.fork(`ring:${ringIndex}`);
    const theta =
      theta0 +
      (pattern === 'grid' || pattern === 'streetcar' ? 0 : ringRng.range(-0.2, 0.2)) +
      ringIndex * 0.02;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -uy;
    const vy = ux;
    const toWorld = (u: number, v: number): Pt => [cx + u * ux + v * vx, cy + u * uy + v * vy];
    const halfWidth = era.streetWidthM.local / 2;
    const iMax = Math.ceil(ring.rOut / bw) + 1;
    const jMax = Math.ceil(ring.rOut / bh) + 1;
    for (let i = -iMax; i < iMax; i++) {
      for (let j = -jMax; j < jMax; j++) {
        // Per-cell randomness: a cell draws the same numbers whatever the ring's current extent.
        const cellRng = ringRng.fork(`cell:${i},${j}`);
        const u0 = i * bw;
        const v0 = j * bh;
        const corners: Pt[] = [
          toWorld(u0, v0),
          toWorld(u0 + bw, v0),
          toWorld(u0 + bw, v0 + bh),
          toWorld(u0, v0 + bh),
        ];
        const c = centroid(corners);
        const d = Math.hypot(c[0] - cx, c[1] - cy);
        if (d < ring.rIn || d > ring.rOut) continue;
        // Suburban patterns thin out toward the edge, leaving gaps and greens.
        const edgeT = (d - ring.rIn) / Math.max(1, ring.rOut - ring.rIn);
        if ((pattern === 'suburban' || pattern === 'culDeSac') && cellRng.chance(0.08 + edgeT * 0.25))
          continue;
        if (!ctx.isLand(c[0], c[1])) continue;
        if (ctx.slopeAt(c[0], c[1]) > 0.28) continue;
        let poly: Ring = corners;
        let waterfront = false;
        if (!corners.every((p) => ctx.isLand(p[0], p[1]))) {
          const clipped = ctx.clipToLand(corners, c);
          if (!clipped || area(clipped) < bw * bh * 0.2) continue;
          poly = clipped;
          waterfront = true;
        }
        // Cut by radial arteries passing through the block.
        let pieces: Ring[] = [poly];
        let onArtery = false;
        for (const line of arteryLines) {
          const next: Ring[] = [];
          for (const piece of pieces) {
            if (!segmentCrossesRing(line.a, line.b, piece)) {
              next.push(piece);
              continue;
            }
            onArtery = true;
            const { left, right } = splitByLine(piece, line.a, line.far);
            for (const part of [left, right])
              if (part.length >= 3 && area(part) > bw * bh * 0.08) next.push(part);
          }
          pieces = next;
        }
        pieces.forEach((piece, pieceIndex) => {
          const shrunk = inset(ccw(open(piece)), halfWidth);
          if (shrunk.length < 3 || area(shrunk) < 150) return;
          const pc = centroid(shrunk);
          const dist = Math.hypot(pc[0] - cx, pc[1] - cy);
          blocks.push({
            ring: shrunk,
            ringIndex,
            key: `${ringIndex}-${i}_${j}-${pieceIndex}`,
            era,
            onArtery,
            waterfront,
            builtYear: yearForRadius(site.history, dist, ring.fromYear, ring.toYear),
          });
        });
        // Streets along the cell edges (the artery cuts are drawn as arteries already).
        const collectorI = i % 3 === 0;
        const collectorJ = j % 3 === 0;
        pushEdge(corners[0]!, corners[1]!, collectorJ ? 'collector' : 'street');
        pushEdge(corners[1]!, corners[2]!, (i + 1) % 3 === 0 ? 'collector' : 'street');
        pushEdge(corners[2]!, corners[3]!, (j + 1) % 3 === 0 ? 'collector' : 'street');
        pushEdge(corners[3]!, corners[0]!, collectorI ? 'collector' : 'street');
      }
    }
    // Ring road at the outer edge for motorway eras and large settlements.
    if (era.transport.motorway && site.population >= 20_000 && ringIndex === rings.length - 1) {
      const pts: Ring = [];
      const rr = ring.rOut * 1.03;
      for (let k = 0; k <= 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const p: Pt = [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
        if (ctx.isLand(p[0], p[1])) pts.push(p);
        else if (pts.length >= 2) {
          streets.push({ points: pts.splice(0), cls: 'motorway', key: `motorway-${ringIndex}-${k}` });
        } else pts.length = 0;
      }
      if (pts.length >= 2) streets.push({ points: pts, cls: 'motorway', key: `motorway-${ringIndex}-end` });
    }
  });
  return { rings, blocks, streets, coreRadius };
}

function segmentCrossesRing(a: Pt, b: Pt, ring: Ring): boolean {
  // The block is crossed when its vertices lie on both sides of the segment's line and the
  // segment's extent overlaps the block along its direction.
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  let neg = false;
  let pos = false;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const [x, y] of ring) {
    const side = dx * (y - a[1]) - dy * (x - a[0]);
    if (side < 0) neg = true;
    else pos = true;
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  return neg && pos && maxT > 0 && minT < 1;
}

/** Zone for a ring block from era, wealth and density (DESIGN §6.3). */
export function modernZone(
  era: EraParams,
  wealth: WealthClass,
  density: DensityClass,
  block: { onArtery: boolean; waterfront: boolean },
  rng: Rng,
): { zone: WardId; why: string } {
  const y = era.year;
  const w = ['slum', 'poor', 'modest', 'comfortable', 'affluent', 'elite'].indexOf(wealth);
  const d = ['rural', 'suburban', 'low', 'medium', 'high', 'core'].indexOf(density);
  const pick = (zone: WardId, reason: string) => ({
    zone,
    why: `${zone}: ${reason} (${wealth}, ${density}, ${era.name})`,
  });
  if (block.waterfront && w <= 1 && y >= 1850 && y < 1985)
    return pick('warehouse', 'poor waterfront in an industrial era');
  if (block.onArtery && d >= 3 && rng.chance(0.45))
    return pick('retailStrip', 'artery frontage in a dense area');
  if (y < 1890) {
    if (w <= 1) return pick('tenement', 'poor in the industrial city');
    if (w <= 3) return pick('rowhouse', 'modest to comfortable terraces');
    return pick('patriciate', 'the rich build villas');
  }
  if (y < 1955) {
    if (w <= 1) return pick(d >= 3 ? 'tenement' : 'rowhouse', 'poor households');
    if (w === 2) return pick(d >= 4 ? 'tenement' : 'rowhouse', 'modest households');
    if (w === 3) return pick('streetcarSuburb', 'the middle class rides the streetcar');
    return pick('gardenSuburb', 'affluent garden suburbs');
  }
  if (y < 1985) {
    if (w <= 1) return pick(d >= 3 ? 'towerEstate' : 'suburb', 'post-war housing estates');
    if (w === 2) return pick(d >= 4 ? 'apartment' : 'suburb', 'modest post-war housing');
    if (w === 3) return pick(d >= 4 ? 'apartment' : 'suburb', 'comfortable post-war housing');
    return pick('gardenSuburb', 'affluent leafy streets');
  }
  if (w <= 1) return pick('apartment', 'lower-income apartments');
  if (w === 2) return pick(d >= 4 ? 'apartment' : 'suburb', 'modest housing');
  if (w <= 4) return pick('culDeSac', 'late-modern subdivisions');
  return pick('gardenSuburb', 'elite estates');
}

/** Reassign organic-core wards for modern years: the old town becomes the centre. */
export function modernCoreZone(ward: WardId, era: EraParams, centreDist: number, onArtery: boolean): WardId {
  if (era.year < 1890) return ward;
  if (
    ward === 'plaza' ||
    ward === 'castle' ||
    ward === 'cathedral' ||
    ward === 'park' ||
    ward === 'military' ||
    ward === 'farm' ||
    ward === 'gate'
  )
    return ward;
  if (centreDist < 0.55) return 'cbd';
  if (onArtery) return 'retailStrip';
  if (ward === 'slum') return 'tenement';
  if (ward === 'patriciate') return 'patriciate';
  return era.year >= 1955 ? 'apartment' : 'rowhouse';
}

export type { SocietyOutput };
