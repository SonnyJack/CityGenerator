import { area, ccw, centroid, inset, open, splitByLine, type Pt } from '../geometry/polygon.js';
import type { Ring } from '../raster/contours.js';
import type { Rng } from '../random/rng.js';
import type { TerrainOutput } from '../terrain/stage.js';
import type { SocietyOutput, WealthClass, DensityClass } from '../society/stage.js';
import { radiusForPopulation, type SettlementSite } from './siting.js';
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
}

export interface RingBlock {
  ring: Ring;
  /** Ring index (0 = first ring outside the core). */
  ringIndex: number;
  era: EraParams;
  onArtery: boolean;
  waterfront: boolean;
}

export interface RingsResult {
  rings: GrowthRing[];
  blocks: RingBlock[];
  /** Street polylines with their class. */
  streets: { points: Ring; cls: 'artery' | 'collector' | 'street' | 'motorway' }[];
  coreRadius: number;
}

/** Population of the settlement at year t: slow early growth, fast late growth. */
export function populationAt(site: SettlementSite, year: number, t: number): number {
  if (t >= year || year <= site.founded) return site.population;
  if (t <= site.founded) return Math.max(50, site.population * 0.08);
  const s = (t - site.founded) / (year - site.founded);
  return Math.max(50, site.population * (0.08 + 0.92 * s * s));
}

/** Ring boundaries for the settlement's history; the core is everything up to the first non-organic era. */
export function growthRings(
  site: SettlementSite,
  year: number,
  eras: readonly EraParams[],
): { coreRadius: number; rings: GrowthRing[] } {
  const sorted = [...eras].sort((a, b) => a.year - b.year);
  const boundaries: { era: EraParams; r: number }[] = [];
  for (const era of sorted) {
    if (era.year <= site.founded || era.year > year) continue;
    boundaries.push({ era, r: radiusForPopulation(populationAt(site, year, era.year), era.year) });
  }
  // The current year closes the last ring at the settlement's full radius, in the current era's pattern.
  const current = sorted.filter((e) => e.year <= year).pop() ?? sorted[0]!;
  boundaries.push({ era: current, r: site.radiusM });
  let coreRadius = site.radiusM;
  const rings: GrowthRing[] = [];
  let organic = true;
  let prevR = 0;
  for (const b of boundaries) {
    if (organic && b.era.ringPattern === 'organic') {
      coreRadius = b.r;
      prevR = b.r;
      continue;
    }
    if (organic) {
      organic = false;
      coreRadius = Math.max(prevR, site.radiusM * 0.18);
      prevR = coreRadius;
    }
    if (b.r > prevR + 40) {
      rings.push({ era: b.era, rIn: prevR, rOut: b.r });
      prevR = b.r;
    }
  }
  if (organic) coreRadius = site.radiusM;
  return { coreRadius, rings };
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
  const arteryCount = Math.min(8, Math.max(3, Math.round(2 + Math.sqrt(site.population) / 40)));
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
  const arteryLines: { a: Pt; b: Pt }[] = [];
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
    arteryLines.push({ a: start, b: end });
    streets.push({ points: [start, end], cls: 'artery' });
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
    streets.push({ points: [a, b], cls });
  };

  rings.forEach((ring, ringIndex) => {
    const era = ring.era;
    const pattern = era.ringPattern;
    const sizeMul =
      pattern === 'suburban' ? 1.25 : pattern === 'culDeSac' ? 1.6 : pattern === 'towers' ? 2 : 1;
    const bw = era.blockSizeM.ring * 0.62 * sizeMul;
    const bh = era.blockSizeM.ring * (pattern === 'streetcar' ? 1.5 : 1) * sizeMul;
    const theta =
      theta0 + (pattern === 'grid' || pattern === 'streetcar' ? 0 : rng.range(-0.2, 0.2)) + ringIndex * 0.02;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -uy;
    const vy = ux;
    const toWorld = (u: number, v: number): Pt => [cx + u * ux + v * vx, cy + u * uy + v * vy];
    const halfWidth = era.streetWidthM.local / 2;
    const iMax = Math.ceil(ring.rOut / bw) + 1;
    const jMax = Math.ceil(ring.rOut / bh) + 1;
    const ringRng = rng.fork(`ring:${ringIndex}`);
    for (let i = -iMax; i < iMax; i++) {
      for (let j = -jMax; j < jMax; j++) {
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
        if ((pattern === 'suburban' || pattern === 'culDeSac') && ringRng.chance(0.08 + edgeT * 0.25))
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
            const { left, right } = splitByLine(piece, line.a, line.b);
            for (const part of [left, right])
              if (part.length >= 3 && area(part) > bw * bh * 0.08) next.push(part);
          }
          pieces = next;
        }
        for (const piece of pieces) {
          const shrunk = inset(ccw(open(piece)), halfWidth);
          if (shrunk.length < 3 || area(shrunk) < 150) continue;
          blocks.push({ ring: shrunk, ringIndex, era, onArtery, waterfront });
        }
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
          streets.push({ points: pts.splice(0), cls: 'motorway' });
        } else pts.length = 0;
      }
      if (pts.length >= 2) streets.push({ points: pts, cls: 'motorway' });
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
