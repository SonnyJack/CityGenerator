import { area, ccw, centroid, inset, open, splitByLine, type Pt } from '../geometry/polygon.js';
import { smoothLine, type Ring } from '../raster/contours.js';
import type { Rng } from '../random/rng.js';
import type { TerrainOutput } from '../terrain/stage.js';
import type { SocietyOutput, WealthClass, DensityClass } from '../society/stage.js';
import type { SettlementSite } from './siting.js';
import { populationAt, radiusAt, radiusForPopulation, yearForRadius } from './history.js';
import type { EraParams } from './eras.js';
import type { WardId } from './wards.js';
import { gradientBetween, gridOrientation, STEPS_GRADIENT } from './orientation.js';

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
  /** Low ground by a river. */
  floodplain: boolean;
  /** Well above the old town: the hill with the view. */
  highGround: boolean;
  /** Year the block was laid out, from the settlement's growth curve. */
  builtYear: number;
}

export interface RingsResult {
  rings: GrowthRing[];
  blocks: RingBlock[];
  /** Street polylines with their class. */
  streets: { points: Ring; cls: 'artery' | 'collector' | 'street' | 'steps' | 'motorway'; key: string }[];
  /** Spans where a radial artery bridges a river. */
  bridges: [Pt, Pt][];
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
  /** Equivalent radius on the settlement's growth footprint (see footprint.ts). */
  radiusAt: (x: number, y: number) => number;
  /** Farthest the footprint within equivalent radius r reaches from the centre. */
  extent: (r: number) => number;
  /** Outline of the footprint within equivalent radius r. */
  outline: (r: number) => Ring | null;
  /** Bounding box of the footprint within equivalent radius r. */
  bbox: (r: number) => { minX: number; minY: number; maxX: number; maxY: number };
  /** Clip a block back from the water behind a quay strip. */
  clipQuay: (ring: Ring, site: Pt) => Ring | null;
  /** Width of that strip and the grid it is traced on, metres. */
  quayM: number;
  localCell: number;
  /** Typical height of the old town, metres. */
  coreElevationM: number;
  /** Distance to the nearest river or other water, negative in it. */
  riverDistance: (x: number, y: number) => number;
}

/** Generate grid blocks and streets for all rings. */
export function generateRings(rings: GrowthRing[], coreRadius: number, ctx: RingGenContext): RingsResult {
  const { site, rng } = ctx;
  const [cx, cy] = site.center;
  const blocks: RingBlock[] = [];
  const streets: RingsResult['streets'] = [];
  const bridges: [Pt, Pt][] = [];
  if (!rings.length) return { rings, blocks, streets, bridges, coreRadius };
  const R = rings[rings.length - 1]!.rOut;
  // The footprint may run well past R along a shore or a valley; the grid must cover it.
  const E = Math.max(R, ctx.extent(R * 1.05));
  const box = ctx.bbox(R * 1.05);
  // The footprint's final reach, whatever the year: artery cuts are made with the full line.
  const EMax = Math.max(E, ctx.extent(Infinity));

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
    // The artery's full line runs to the sea or the footprint's final edge, the same at every
    // year, and that line makes the cuts; the drawn street stops at the built-up ground of the
    // year (a block cut by an artery in 1890 must not be whole in 1850).
    // A river in the way is bridged (a short span of water); the sea or a lake ends the artery.
    const maxBridgeM = Math.max(80, ctx.terrain.height.cellSizeM * 3);
    let endFull: Pt = [cx + dir[0] * EMax * 1.05, cy + dir[1] * EMax * 1.05];
    let end: Pt | null = null;
    let wetFrom: number | null = null;
    const arteryBridges: [Pt, Pt][] = [];
    for (let d = coreRadius; d <= EMax * 1.05; d += 5) {
      const p: Pt = [cx + dir[0] * d, cy + dir[1] * d];
      const re = ctx.radiusAt(p[0], p[1]);
      if (!end && re > R * 1.05) end = [cx + dir[0] * (d - 5), cy + dir[1] * (d - 5)];
      const wet = !ctx.isLand(p[0], p[1]);
      if (wet && wetFrom === null) wetFrom = d;
      if (!wet && wetFrom !== null) {
        arteryBridges.push([
          [cx + dir[0] * (wetFrom - 5), cy + dir[1] * (wetFrom - 5)],
          [cx + dir[0] * d, cy + dir[1] * d],
        ]);
        wetFrom = null;
      }
      const longWet = wetFrom !== null && d - wetFrom > maxBridgeM;
      if (longWet || !Number.isFinite(re)) {
        const stop = (wetFrom ?? d) - 5;
        endFull = [cx + dir[0] * stop, cy + dir[1] * stop];
        if (end && Math.hypot(end[0] - start[0], end[1] - start[1]) > stop - coreRadius) end = endFull;
        break;
      }
    }
    end ??= endFull;
    // Only bridges within the drawn artery count for the year.
    const endD = Math.hypot(end[0] - start[0], end[1] - start[1]);
    for (const [a, b] of arteryBridges)
      if (Math.hypot(b[0] - start[0], b[1] - start[1]) <= endD + 1) bridges.push([a, b]);
    if (Math.hypot(endFull[0] - start[0], endFull[1] - start[1]) < 60) continue;
    // Cuts use a far point on the same line so the split arithmetic is bit-identical whatever the
    // artery's current length (the ring's outer edge moves with the year; the cuts must not).
    arteryLines.push({
      a: start,
      b: endFull,
      far: [start[0] + dir[0] * 50_000, start[1] + dir[1] * 50_000],
    });
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) >= 60)
      streets.push({ points: [start, end], cls: 'artery', key: `artery-${arteryLines.length - 1}` });
  }

  // Grid orientation: along the first artery, jittered per ring for variety.
  const theta0 = angles[0] ?? 0;
  const edgeKeys = new Set<string>();
  const key = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  // A grid edge is drawn only where it is on land: an edge across an inlet is trimmed to its land
  // runs (a run shorter than a lane is dropped), so no street crosses the drawn water.
  const landRuns = (a: Pt, b: Pt): [Pt, Pt][] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 6));
    const runs: [Pt, Pt][] = [];
    let start: number | null = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const land = ctx.isLand(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (land && start === null) start = t;
      if ((!land || k === n) && start !== null) {
        const end = land ? t : (k - 1) / n;
        if ((end - start) * len >= 20)
          runs.push([
            [a[0] + (b[0] - a[0]) * start, a[1] + (b[1] - a[1]) * start],
            [a[0] + (b[0] - a[0]) * end, a[1] + (b[1] - a[1]) * end],
          ]);
        start = null;
      }
    }
    return runs;
  };
  // A minor street too steep to drive becomes a flight of steps.
  const classOf = (a: Pt, b: Pt, cls: 'collector' | 'street'): 'collector' | 'street' | 'steps' =>
    cls === 'street' && gradientBetween(ctx.terrain.height, a, b) > STEPS_GRADIENT ? 'steps' : cls;
  const pushEdge = (a: Pt, b: Pt, cls: 'collector' | 'street') => {
    const ka = key(a);
    const kb = key(b);
    const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (edgeKeys.has(ek)) return;
    edgeKeys.add(ek);
    const runs = landRuns(a, b);
    if (runs.length === 1 && runs[0]![0] === a && runs[0]![1] === b)
      streets.push({ points: [a, b], cls: classOf(a, b, cls), key: ek });
    else
      runs.forEach(([p, q], i) =>
        streets.push({ points: [p, q], cls: classOf(p, q, cls), key: `${ek}#${i}` }),
      );
  };
  // Terrain samples for a ring's orientation: a band just outside its inner edge, fixed by that
  // edge alone so the newest ring keeps its angle while it grows with the year.
  const orientationSamples = (rIn: number): Pt[] => {
    const rSample = rIn * 1.6 + 300;
    const box = ctx.bbox(rSample);
    const cell = ctx.terrain.height.cellSizeM;
    const step = Math.max(cell, Math.sqrt(((box.maxX - box.minX) * (box.maxY - box.minY)) / 1500));
    const pts: Pt[] = [];
    for (let y = box.minY; y <= box.maxY; y += step)
      for (let x = box.minX; x <= box.maxX; x += step) {
        const d = ctx.radiusAt(x, y);
        if (d < rIn || d > rSample || !ctx.isLand(x, y)) continue;
        pts.push([x, y]);
      }
    return pts;
  };

  // A ring the ground leaves alone keeps the angle of the ring inside it, so a plain reads as
  // one grid with the odd shift, not a patchwork.
  let prevTheta = theta0;
  rings.forEach((ring, ringIndex) => {
    const era = ring.era;
    const pattern = era.ringPattern;
    const sizeMul =
      pattern === 'suburban' ? 1.25 : pattern === 'culDeSac' ? 1.6 : pattern === 'towers' ? 2 : 1;
    const bw = era.blockSizeM.ring * 0.62 * sizeMul;
    const bh = era.blockSizeM.ring * (pattern === 'streetcar' ? 1.5 : 1) * sizeMul;
    const ringRng = rng.fork(`ring:${ringIndex}`);
    // Along the shore or the contours where the ground says so; else along the first artery.
    const jitter = pattern === 'grid' || pattern === 'streetcar' ? 0 : ringRng.range(-0.2, 0.2);
    const orientation = gridOrientation(ctx.terrain, orientationSamples(ring.rIn), prevTheta + jitter);
    const theta = orientation.theta;
    prevTheta = theta;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const vx = -uy;
    const vy = ux;
    const toWorld = (u: number, v: number): Pt => [cx + u * ux + v * vx, cy + u * uy + v * vy];
    const halfWidth = era.streetWidthM.local / 2;
    const iMax = Math.ceil(E / bw) + 1;
    const jMax = Math.ceil(E / bh) + 1;
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
        if (c[0] < box.minX || c[0] > box.maxX || c[1] < box.minY || c[1] > box.maxY) continue;
        const d = ctx.radiusAt(c[0], c[1]);
        if (d < ring.rIn || d > ring.rOut) continue;
        // Per-cell randomness: a cell draws the same numbers whatever the ring's current extent.
        const cellRng = ringRng.fork(`cell:${i},${j}`);
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
        const hBlock = ctx.terrain.height.sample(c[0], c[1]);
        const floodplain = hBlock - ctx.coreElevationM < 2 && ctx.riverDistance(c[0], c[1]) < 250;
        const highGround = hBlock - ctx.coreElevationM > 15;
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
          let shrunk = inset(ccw(open(piece)), halfWidth);
          const nearWater =
            waterfront || shrunk.some(([x, y]) => ctx.riverDistance(x, y) < ctx.quayM + ctx.localCell);
          if (nearWater && shrunk.length >= 3) {
            const back = ctx.clipQuay(shrunk, centroid(shrunk));
            if (!back) return;
            shrunk = back;
          }
          if (shrunk.length < 3 || area(shrunk) < 150) return;
          const pc = centroid(shrunk);
          const dist = Math.min(ctx.radiusAt(pc[0], pc[1]), ring.rOut);
          blocks.push({
            ring: shrunk,
            ringIndex,
            key: `${ringIndex}-${i}_${j}-${pieceIndex}`,
            era,
            onArtery,
            waterfront,
            floodplain,
            highGround,
            builtYear: yearForRadius(site.history, dist, ring.fromYear, ring.toYear),
          });
        });
        // Streets along the cell edges (the artery cuts are drawn as arteries already). On a
        // slope the collectors run along the contour (the grid's u axis); the cross streets
        // climb, and the steepest of them are steps.
        const along = orientation.sloped ? 2 : 3;
        const collectorI = !orientation.sloped && i % 3 === 0;
        const collectorJ = j % along === 0;
        pushEdge(corners[0]!, corners[1]!, collectorJ ? 'collector' : 'street');
        pushEdge(corners[1]!, corners[2]!, !orientation.sloped && (i + 1) % 3 === 0 ? 'collector' : 'street');
        pushEdge(corners[2]!, corners[3]!, (j + 1) % along === 0 ? 'collector' : 'street');
        pushEdge(corners[3]!, corners[0]!, collectorI ? 'collector' : 'street');
      }
    }
    // Ring road at the outer edge for motorway eras and large settlements: it follows the
    // footprint's outline (round the bay, along the valley) rather than a circle.
    if (era.transport.motorway && site.population >= 20_000 && ringIndex === rings.length - 1) {
      const pts: Ring = [];
      const rr = ring.rOut * 1.03;
      const loop = ctx.outline(rr);
      const path: Pt[] = loop
        ? resampleClosed(smoothLine(open(loop), 2, true), Math.max(40, rr / 36))
        : Array.from({ length: 73 }, (_, k) => {
            const a = (k / 72) * Math.PI * 2;
            return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as Pt;
          });
      for (let k = 0; k < path.length; k++) {
        const p = path[k]!;
        if (ctx.isLand(p[0], p[1])) pts.push(p);
        else if (pts.length >= 2) {
          streets.push({ points: pts.splice(0), cls: 'motorway', key: `motorway-${ringIndex}-${k}` });
        } else pts.length = 0;
      }
      if (pts.length >= 2) streets.push({ points: pts, cls: 'motorway', key: `motorway-${ringIndex}-end` });
    }
  });
  return { rings, blocks, streets, bridges, coreRadius };
}

/** Points every `stepM` along a closed ring, ending back at the start. */
function resampleClosed(ring: Ring, stepM: number): Pt[] {
  const out: Pt[] = [];
  if (ring.length < 2) return out;
  const n = ring.length;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d <= len) {
      const t = len ? d / len : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += stepM;
    }
    carry = d - len;
  }
  if (out.length) out.push(out[0]!);
  return out;
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
  block: { onArtery: boolean; waterfront: boolean; floodplain?: boolean; highGround?: boolean },
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
  // The ground has a say: works and yards take the floodplain in the industrial city, the rich
  // take the hill with the view.
  if (block.floodplain && w <= 2 && y >= 1850 && y < 1985)
    return pick('warehouse', 'works and yards on the floodplain');
  if (block.highGround && w >= 4 && !block.onArtery)
    return pick(y < 1890 ? 'patriciate' : 'gardenSuburb', 'the rich take the hill with the view');
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
  // The fishing quarter keeps its boats until the post-war flats.
  if (ward === 'fishing') return era.year >= 1955 ? 'apartment' : 'fishing';
  return era.year >= 1955 ? 'apartment' : 'rowhouse';
}

export type { SocietyOutput };
