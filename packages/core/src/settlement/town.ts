import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { Raster } from '../raster/raster.js';
import { contourPolygons } from '../raster/contours.js';
import {
  area,
  centroid,
  compactness,
  distToRing,
  inset,
  open,
  orientedBox,
  pointInRing,
  type Pt,
} from '../geometry/polygon.js';
import { relax, unionBoundary, voronoi, type VoronoiCell } from '../geometry/voronoi.js';
import type { TerrainOutput } from '../terrain/stage.js';
import { landSampler, shoreDistance } from '../terrain/land.js';
import type { SettlementSite } from './siting.js';
import { FILL_WARDS, WARDS, type WardContext, type WardId } from './wards.js';
import type { EraParams } from './eras.js';
import type { SocietyOutput } from '../society/stage.js';
import { generateRings, growthRings, modernCoreZone, modernZone } from './rings.js';
import { distToPolyline, type FieldEdit, type ZoneEdit } from '../document/authored.js';
import type { EventKind, RegionEvent } from '../document/schema.js';
import { maxRadius, peakUntil, populationAt, radiusAt, yearForRadius } from './history.js';
import { growthFootprint } from './footprint.js';
import { gradientBetween, STEPS_GRADIENT } from './orientation.js';
import type { Ring } from '../raster/contours.js';

/**
 * Settlement stage for organic towns (the reference's approach, on terrain):
 * relaxed Voronoi patches around the site, clipped to the coast; a wall around
 * the inner patches with gates and towers; plaza, castle, cathedral and other
 * wards by location score; artery streets from the gates to the plaza along
 * patch edges; every inner patch becomes a block with a generation recipe.
 */

export interface TownInput {
  seed: string;
  site: SettlementSite;
  terrain: TerrainOutput;
  year: number;
  /** Target block (patch) spacing in metres for the organic core. */
  blockSizeM: number;
  /** Era table (oldest first) for growth rings; when omitted the whole town is organic. */
  eras?: EraParams[];
  /** Wealth and density fields for modern zoning; when omitted, ring blocks use a modest default. */
  society?: SocietyOutput;
  /** Extra seed material from reseed overrides; changes every random choice of this town. */
  salt?: string;
  /** Hand-authored zone polygons and strokes that override generated wards. */
  zoneEdits?: ZoneEdit[];
  /** Year strokes: the ground under them was built this many years earlier or later. */
  yearEdits?: FieldEdit[];
  /** Land taken by facilities and rail yards: patches inside take the ward and get no buildings. */
  reserved?: { id: string; ring: Ring; ward: WardId }[];
  /** Disasters on the timeline; those before the year mark the blocks they touched. */
  events?: RegionEvent[];
}

/** A change of zoning on a block: lots are rebuilt in the new ward over the following decades. */
export interface WardTransition {
  year: number;
  ward: WardId;
}

/** A disaster that touched a block (a gas explosion is a small fire; a burst main a short flood). */
export interface BlockDisaster {
  kind: EventKind;
  year: number;
  magnitude: number;
}

export interface BlockRecipe {
  id: string;
  settlementId: string;
  ring: Ring;
  ward: WardId;
  /** Street half-widths already removed from the ring. */
  areaM2: number;
  seed: string;
  /** Rough elevation at the block, metres. */
  elevationM: number;
  /** Year the block was laid out (lots build over the following decades). */
  builtYear?: number;
  /** Ward the block was first built as; `ward` is its zoning now. */
  originalWard?: WardId;
  /** Zoning changes since, oldest first. */
  transitions?: WardTransition[];
  /** Year the block emptied when the settlement shrank. */
  abandonedYear?: number;
  disasters?: BlockDisaster[];
}

export interface TownOutput {
  key: string;
  id: string;
  center: Pt;
  radiusM: number;
  /** Farthest any patch reaches from the centre: the town is shaped by its ground, not a disc. */
  extentM: number;
  patches: FeatureCollection<
    Polygon,
    {
      settlement: string;
      ward: WardId;
      inner: boolean;
      ring: number;
      why: string;
      built?: number;
      abandoned?: number;
    }
  >;
  streets: FeatureCollection<
    LineString,
    {
      settlement: string;
      class: 'artery' | 'street' | 'steps' | 'lane' | 'road' | 'collector' | 'motorway';
      built?: number;
    }
  >;
  walls: FeatureCollection<LineString, { settlement: string; kind: 'wall' }>;
  gates: FeatureCollection<Point, { settlement: string; kind: 'gate' | 'tower' }>;
  /** Where a street crosses a river: an artery's bridge in the core, a radial's in the rings. */
  bridges: FeatureCollection<LineString, { settlement: string; kind: 'bridge' }>;
  /** Field boundaries in the farm belt: the strips and the edges of each holding. */
  hedges: FeatureCollection<LineString, { settlement: string; kind: 'hedge' }>;
  blocks: BlockRecipe[];
  stats: {
    patches: number;
    inner: number;
    walled: boolean;
    streetsKm: number;
    rings: number;
    coreRadiusM: number;
    /** Population at the year, the peak so far and the blocks left empty by decline. */
    population: number;
    peakPopulation: number;
    peakYear: number;
    abandonedBlocks: number;
    /** Year the organic core reached its final extent. */
    coreEndYear: number;
    /** Share of the core's ground steeper than 1 in 5 (a terrain-fit measure for the sweep). */
    steepShare: number;
  };
}

interface Patch {
  index: number;
  cell: VoronoiCell;
  ring: Ring;
  centroid: Pt;
  inner: boolean;
  land: boolean;
  ward: WardId | null;
  waterfront: boolean;
  slope: number;
  elevation: number;
  /** Explanation of the zone choice for the inspector. */
  why: string;
  /** Year the patch was built up, from the growth curve. */
  builtYear: number;
  originalWard: WardId | null;
  transitions: WardTransition[];
}

const ARTERY_HALF_WIDTH = 4;
const STREET_HALF_WIDTH = 2;

export const townStage = defineStage<TownInput, TownOutput>({
  id: 'town',
  version: 1,
  seedOf: (i) => `${i.seed}/${i.site.id}${i.salt ? `/${i.salt}` : ''}`,
  keyOf: (i) =>
    `${i.terrain.key}|${i.seed}|${i.year}|${i.blockSizeM}|${JSON.stringify(i.site)}|${i.society?.key ?? ''}|${JSON.stringify(i.eras?.map((e) => e.id) ?? [])}|${i.salt ?? ''}|${JSON.stringify(i.zoneEdits ?? [])}|${JSON.stringify(i.yearEdits ?? [])}|${JSON.stringify(i.reserved?.map((r) => [r.id, r.ward, r.ring]) ?? [])}|${JSON.stringify(i.events ?? [])}`,
  run(input, ctx) {
    const { site, terrain, year } = input;
    const rng = ctx.rng;
    // Growth history: the organic core covers the pre-grid eras; later eras add rings.
    const history = site.history;
    const growth = input.eras?.length
      ? growthRings(site, year, input.eras)
      : {
          coreRadius: radiusAt(history, Math.max(year, history.anchorYear)),
          rings: [],
          coreEndYear: Math.max(year, history.anchorYear),
        };
    const R = growth.coreRadius;
    // The farm belt is laid out once; ring blocks replace it when the first grid era arrives.
    const outerR = R * 1.7;
    // The footprint: a growth fill over the buildable ground (see footprint.ts). Every "within
    // R of the centre" below is an equivalent radius on that fill, so the town takes the same
    // area as a disc would but shaped by the shore, the valley and the slopes.
    // Sized to the largest radius the history ever reaches, so the fill (and with it every
    // patch and block) is the same at every year.
    const lastRing = growth.rings[growth.rings.length - 1];
    const maxR = Math.max(outerR, maxRadius(history) * 1.05);
    const footprint = growthFootprint(terrain, site.center, maxR);
    const reAt = (p: Pt) => footprint.radiusAt(p[0], p[1]);
    const populationNow = site.population;
    const peak = peakUntil(history, year);
    const [cx, cy] = site.center;
    const { height, slope } = terrain;

    // --- Sample helpers over the terrain rasters -----------------------------
    const cellAt = (x: number, y: number) => {
      const col = Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1);
      const row = Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1);
      return row * height.width + col;
    };
    // The drawn shoreline (see terrain/land.ts). A river is water to a patch: the town stops at
    // the bank and crosses only where an artery takes a bridge.
    const isLand = landSampler(terrain, { rivers: 'water' });

    // --- 1. Patch sites: sunflower spiral, denser inside the town ------------
    const spacing = input.blockSizeM;
    // Sites are spread over the disc that holds the whole footprint (a shore town runs along its
    // coast): one site per block area where the core's growth reaches, a third of that density
    // beyond it.
    const E = Math.max(outerR, footprint.extent(outerR));
    const innerCount = Math.max(6, Math.round((Math.PI * E * E) / (spacing * spacing)));
    const outerCount = Math.max(6, Math.round((Math.PI * E * E) / (spacing * spacing * 3)));
    const sites: Pt[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    const jitter = rng.fork('jitter');
    let innerSites = 0;
    for (let i = 0; i < innerCount; i++) {
      const r = E * Math.sqrt((i + 0.5) / innerCount);
      const t = i * golden;
      const p: Pt = [
        cx + Math.cos(t) * r + jitter.range(-spacing, spacing) * 0.2,
        cy + Math.sin(t) * r + jitter.range(-spacing, spacing) * 0.2,
      ];
      if (reAt(p) > R) continue;
      sites.push(p);
      innerSites++;
    }
    for (let i = 0; i < outerCount; i++) {
      const r = E * Math.sqrt((i + 0.5) / outerCount);
      const t = i * golden + 1.3;
      const p: Pt = [
        cx + Math.cos(t) * r + jitter.range(-spacing, spacing) * 0.3,
        cy + Math.sin(t) * r + jitter.range(-spacing, spacing) * 0.3,
      ];
      // Sites beyond the farm edge stay: they keep the cells of the kept sites compact (a cell
      // with no neighbour on one side would sprawl into the unbuilt ground); their patches go.
      if (reAt(p) <= R) continue;
      sites.push(p);
    }
    // Ground the fill barely reaches (a cliff-bound cove, a bare crag): lay the disc's sites
    // anyway so the rugged-core fallback below has patches to choose from.
    if (innerSites < 6) {
      const discCount = Math.max(6, Math.round((Math.PI * R * R) / (spacing * spacing)));
      for (let i = 0; i < discCount; i++) {
        const r = R * Math.sqrt((i + 0.5) / discCount);
        const t = i * golden + 0.7;
        sites.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
      }
    }
    const bounds = {
      minX: cx - E * 1.15,
      minY: cy - E * 1.15,
      maxX: cx + E * 1.15,
      maxY: cy + E * 1.15,
    };
    const relaxed = relax(sites, bounds, 2);
    const cells = voronoi(relaxed, bounds);
    ctx.checkpoint();

    // --- 2. Patches: keep those within the outer radius, clip to the coast ---
    const patches: Patch[] = [];
    const localCell = Math.max(8, Math.min(20, spacing / 8));
    // Clipping rasterises at the local cell; a setback of half a cell keeps the traced edge inside
    // the drawn shoreline rather than up to half a local cell beyond it.
    const clipLand = landSampler(terrain, { rivers: 'water', setbackM: localCell * 0.6 });
    // A block by the water stands back behind a quay or a promenade.
    const QUAY_M = 10;
    // The clip is traced on the local grid, half a cell outside the last cell centre that passes.
    const quayLand = landSampler(terrain, { rivers: 'water', setbackM: QUAY_M + localCell * 0.6 });
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      if (cell.ring.length < 3) continue;
      const c = centroid(cell.ring);
      const d = reAt(c);
      if (d > outerR) continue;
      const siteLand = isLand(cell.site[0], cell.site[1]);
      let ring = open(cell.ring);
      let allLand = siteLand;
      let waterfront = false;
      if (siteLand) {
        for (const [x, y] of ring) if (!isLand(x, y)) allLand = false;
        if (!allLand) {
          const clipped = clipToLand(ring, cell.site, clipLand, localCell);
          if (!clipped) continue;
          ring = clipped;
          waterfront = true;
        }
      }
      if (!siteLand) continue;
      if (area(ring) < spacing * spacing * 0.15) continue;
      const idx = cellAt(c[0], c[1]);
      const s = slope[idx]!;
      patches.push({
        index: patches.length,
        cell,
        ring,
        centroid: centroid(ring),
        inner: d <= R && s < 0.35,
        land: true,
        ward: null,
        waterfront,
        slope: s,
        elevation: height.data[idx]!,
        why: '',
        builtYear: d <= R ? yearForRadius(history, d, history.founded, growth.coreEndYear) : history.founded,
        originalWard: null,
        transitions: [],
      });
    }
    // Rugged ground: when the slope cut leaves (almost) no core, keep the flattest patches
    // within the radius instead, so a settlement always has somewhere to stand.
    {
      const wanted = Math.max(3, Math.min(innerCount, 8));
      if (patches.filter((p) => p.inner).length < wanted) {
        const near = patches
          .filter((p) => Math.hypot(p.centroid[0] - cx, p.centroid[1] - cy) <= R * 1.25)
          .sort((a, b) => a.slope - b.slope);
        for (const p of near.slice(0, wanted)) p.inner = true;
      }
    }
    // With growth rings the ring blocks take the land outside the core.
    if (growth.rings.length) {
      const keep = patches.filter((p) => p.inner);
      patches.length = 0;
      keep.forEach((p, i) => {
        p.index = i;
        patches.push(p);
      });
    }
    // Year strokes: a quarter that went up earlier or later than the growth curve says. The
    // shift moves the built year of every patch the stroke passes, within the town's history.
    if (input.yearEdits?.length) {
      const shiftAt = (p: Pt): number => {
        let shift = 0;
        for (const e of input.yearEdits!) {
          let best = Infinity;
          for (let k = 0; k < e.points.length; k++) {
            const a = e.points[k]!;
            const b = e.points[Math.min(k + 1, e.points.length - 1)]!;
            const vx = b[0] - a[0];
            const vy = b[1] - a[1];
            const len2 = vx * vx + vy * vy;
            const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
            best = Math.min(best, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)));
          }
          // Full shift at the stroke, fading to nothing at the edge of its radius.
          if (best <= e.radiusM) shift += e.delta * (1 - best / e.radiusM);
        }
        return Math.round(shift);
      };
      for (const p of patches) {
        const shift = shiftAt(p.centroid);
        if (!shift) continue;
        p.builtYear = Math.max(history.founded, Math.min(year, p.builtYear + shift));
        p.why = `${p.why}; built ${shift > 0 ? 'later' : 'earlier'} by hand`;
      }
    }

    // Map original cell index → patch for adjacency.
    const patchByCell = new Map<number, Patch>();
    for (const p of patches) patchByCell.set(cells.indexOf(p.cell), p);
    const neighbours = (p: Patch): Patch[] =>
      p.cell.neighbours.map((n) => patchByCell.get(n)).filter((q): q is Patch => !!q);
    ctx.checkpoint();

    const inner = patches.filter((p) => p.inner);
    // The layout is the town's final one; what stands at the year is what was built by then.
    // Walls, gates and arteries follow the final plan (walls often ran ahead of growth), so the
    // street skeleton is the same at every year; only what stands inside changes.
    const innerSet = new Set(inner.map((p) => cells.indexOf(p.cell)));
    const walled =
      (year <= 1700 || site.spec.layout.walls === true) && site.anchorPopulation >= 800 && inner.length >= 6;

    // --- 3. Wall, gates, towers ----------------------------------------------
    let wallRing: Ring = [];
    const gates: Pt[] = [];
    const towers: Pt[] = [];
    if (walled) {
      const rings = unionBoundary(cells, innerSet);
      if (rings[0]) wallRing = rings[0];
    }
    const edgeRing: Ring = wallRing.length ? wallRing : (unionBoundary(cells, innerSet)[0] ?? []);
    if (edgeRing.length >= 3) {
      const gateCount = Math.min(6, Math.max(2, Math.round(2 + Math.sqrt(inner.length) / 2)));
      // Candidate vertices sorted by angle; pick spread-out ones on land.
      const withAngle = edgeRing
        .map((p, i) => ({ p, i, angle: Math.atan2(p[1] - cy, p[0] - cx) }))
        .sort((a, b) => a.angle - b.angle);
      const start = rng.range(0, Math.PI * 2);
      for (let g = 0; g < gateCount; g++) {
        const want = ((start + (g / gateCount) * Math.PI * 2 + Math.PI) % (Math.PI * 2)) - Math.PI;
        let best: (typeof withAngle)[number] | null = null;
        let bestD = Infinity;
        for (const v of withAngle) {
          let dA = Math.abs(v.angle - want);
          if (dA > Math.PI) dA = Math.PI * 2 - dA;
          const outward: Pt = [v.p[0] + (v.p[0] - cx) * 0.15, v.p[1] + (v.p[1] - cy) * 0.15];
          if (!isLand(outward[0], outward[1])) continue;
          if (gates.some((q) => Math.hypot(q[0] - v.p[0], q[1] - v.p[1]) < spacing * 1.5)) continue;
          if (dA < bestD) {
            bestD = dA;
            best = v;
          }
        }
        if (best) gates.push(best.p);
      }
      if (walled) {
        for (let i = 0; i < edgeRing.length; i += 2) {
          const p = edgeRing[i]!;
          if (!gates.some((g) => g[0] === p[0] && g[1] === p[1])) towers.push(p);
        }
      }
    }
    ctx.checkpoint();

    // --- 4. Streets: arteries from gates to the centre along patch edges -----
    const graph = buildEdgeGraph(patches);
    // Bridges: a river through the town is crossed only where an artery or a road takes a bridge.
    // Candidate spans join a bank vertex to the nearest vertex on the far bank (a different
    // component of the patch-edge graph) across the river, at three times the cost of a street.
    {
      const maxSpan = Math.max(60, height.cellSizeM * 3);
      const riverBank = (v: Pt) =>
        shoreDistance(terrain, v[0], v[1], 'water') < localCell * 1.5 &&
        shoreDistance(terrain, v[0], v[1], 'land') > localCell * 1.5;
      const overRiver = (a: Pt, b: Pt) => {
        for (const t of [0.35, 0.5, 0.65]) {
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          if (shoreDistance(terrain, x, y, 'water') > 0 || shoreDistance(terrain, x, y, 'land') <= 0)
            return false;
        }
        return true;
      };
      const bank: { p: Pt; k: string; comp: number }[] = [];
      const seenBank = new Set<string>();
      for (const p of patches)
        for (const v of p.ring) {
          const k = graph.key(v);
          if (seenBank.has(k) || !riverBank(v)) continue;
          seenBank.add(k);
          bank.push({ p: v, k, comp: graph.componentOf(k) });
        }
      const spans = new Map<string, [Pt, Pt]>();
      for (const a of bank) {
        let best: (typeof bank)[number] | null = null;
        let bestD = Infinity;
        for (const b of bank) {
          if (b.comp === a.comp) continue;
          const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
          if (d < 8 || d > maxSpan || d >= bestD || !overRiver(a.p, b.p)) continue;
          bestD = d;
          best = b;
        }
        if (best) spans.set(graph.edgeKey(a.p, best.p), [a.p, best.p]);
      }
      for (const [a, b] of spans.values()) graph.addBridge(a, b);
    }
    const bridgeFactor = (ek: string) => (graph.bridgeKeys.has(ek) ? 3 : 1);
    const centrePatch = inner.reduce<Patch | null>((best, p) => {
      if (!best) return p;
      const db = Math.hypot(best.centroid[0] - cx, best.centroid[1] - cy);
      const dp = Math.hypot(p.centroid[0] - cx, p.centroid[1] - cy);
      return dp < db ? p : best;
    }, null);
    const centreVertices = centrePatch ? centrePatch.ring.map((p) => graph.key(p)) : [];
    const arteryEdges = new Set<string>();
    const arteries: Ring[] = [];
    for (const g of gates) {
      const path = graph.shortestPath(
        graph.key(g),
        new Set(centreVertices),
        (edgeKey) => (arteryEdges.has(edgeKey) ? 0.45 : 1) * bridgeFactor(edgeKey),
        slopeAt(height, slope),
      );
      if (path.length < 2) continue;
      arteries.push(path);
      for (let i = 1; i < path.length; i++) arteryEdges.add(graph.edgeKey(path[i - 1]!, path[i]!));
    }
    // Roads: from each gate outward to the far edge of the outer ring.
    const roads: Ring[] = [];
    const outerVertices = new Set<string>();
    for (const p of patches)
      if (!p.inner) for (const v of p.ring) if (reAt(v) > outerR * 0.92) outerVertices.add(graph.key(v));
    for (const g of gates) {
      const dir = Math.atan2(g[1] - cy, g[0] - cx);
      const targets = new Set<string>();
      for (const k of outerVertices) {
        const v = graph.point(k);
        let dA = Math.abs(Math.atan2(v[1] - cy, v[0] - cx) - dir);
        if (dA > Math.PI) dA = Math.PI * 2 - dA;
        if (dA < 0.6) targets.add(k);
      }
      if (!targets.size) continue;
      const path = graph.shortestPath(graph.key(g), targets, bridgeFactor, slopeAt(height, slope));
      if (path.length >= 2) roads.push(path);
    }
    // The bridges the arteries and roads took.
    const bridgeSpans: [Pt, Pt][] = [];
    {
      const seen = new Set<string>();
      for (const path of [...arteries, ...roads])
        for (let i = 1; i < path.length; i++) {
          const ek = graph.edgeKey(path[i - 1]!, path[i]!);
          if (!graph.bridgeKeys.has(ek) || seen.has(ek)) continue;
          seen.add(ek);
          bridgeSpans.push([path[i - 1]!, path[i]!]);
        }
    }
    ctx.checkpoint();

    // --- 5. Wards ----------------------------------------------------------
    const plaza = centrePatch;
    if (plaza && site.anchorPopulation >= 1000) {
      plaza.ward = 'plaza';
      plaza.why = 'plaza: the market square at the heart of the old town';
    }
    let castle: Patch | null = null;
    const gateSet = gates;
    const arteryPatchSet = new Set<Patch>();
    for (const p of patches) {
      for (let i = 0; i < p.ring.length; i++) {
        if (arteryEdges.has(graph.edgeKey(p.ring[i]!, p.ring[(i + 1) % p.ring.length]!))) {
          arteryPatchSet.add(p);
          break;
        }
      }
    }
    const medianArea = median(inner.map((p) => area(p.ring))) || 1;
    // The distances and shape measures never change while wards are assigned; only the
    // adjacency to the plaza and the castle does. Scoring asks for every patch once per ward.
    // Terrain for the wards: where a patch stands in the core's range of heights, and whether
    // it sits low by a river (the floodplain the rich avoid and the mills want).
    const innerHeights = inner.map((p) => p.elevation);
    const minH = innerHeights.length ? Math.min(...innerHeights) : 0;
    const maxH = innerHeights.length ? Math.max(...innerHeights) : 0;
    const elevationRank = (p: Patch) => (maxH - minH > 2 ? (p.elevation - minH) / (maxH - minH) : 0.5);
    const floodplainOf = (p: Patch) => {
      const dRiver = shoreDistance(terrain, p.centroid[0], p.centroid[1], 'water');
      return p.elevation - minH < 4 && dRiver < 250 ? 1 - dRiver / 250 : 0;
    };
    const fixedContext = new Map<
      Patch,
      { dC: number; dG: number; dW: number; compact: number; relativeArea: number }
    >();
    function contextOf(p: Patch): WardContext {
      let fixed = fixedContext.get(p);
      if (!fixed) {
        fixed = {
          dC: Math.min(reAt(p.centroid), R * 2) / R,
          dG: gateSet.length
            ? Math.min(...gateSet.map((g) => Math.hypot(g[0] - p.centroid[0], g[1] - p.centroid[1]))) / R
            : 1,
          dW: edgeRing.length ? distToRing(p.centroid, edgeRing) / R : 1,
          compact: compactness(p.ring),
          relativeArea: area(p.ring) / medianArea,
        };
        fixedContext.set(p, fixed);
      }
      const ns = neighbours(p);
      return {
        centreDist: fixed.dC,
        gateDist: fixed.dG,
        wallDist: fixed.dW,
        onArtery: arteryPatchSet.has(p),
        adjacentToPlaza: !!plaza && ns.includes(plaza),
        adjacentToCastle: !!castle && ns.includes(castle),
        compactness: fixed.compact,
        relativeArea: fixed.relativeArea,
        slope: p.slope,
        waterfront: p.waterfront,
        // On the sea shore: a clipped patch within a block of the water, or, in a fishing village
        // whose whole core is the shore, any patch close to it.
        seaside:
          terrain.distToSea[cellAt(p.centroid[0], p.centroid[1])]! <
          (site.kind === 'fishingVillage' ? 250 : p.waterfront ? 120 : 0),
        elevation: elevationRank(p),
        floodplain: floodplainOf(p),
      };
    }
    if (walled && site.anchorPopulation >= 2000) {
      castle = pickBest(inner, (p) => (p.ward ? -Infinity : WARDS.castle.score(contextOf(p))));
      if (castle) {
        castle.ward = 'castle';
        castle.why = 'castle: most compact patch by the wall';
      }
    }
    for (const wardId of ['cathedral', 'market', 'military', 'park'] as WardId[]) {
      const profile = WARDS[wardId];
      const count = profile.count ? profile.count(inner.length, site.anchorPopulation) : 0;
      for (let k = 0; k < count; k++) {
        const best = pickBest(inner, (p) => (p.ward ? -Infinity : profile.score(contextOf(p))));
        if (best) {
          best.ward = wardId;
          best.why = `${wardId}: best location score ${profile.score(contextOf(best)).toFixed(2)}`;
        }
      }
    }
    // The fishing quarter: boats drawn up on the shore of a coastal town, the whole shore of a
    // fishing village.
    if (site.coastal) {
      const seaside = inner.filter((p) => !p.ward && contextOf(p).seaside);
      const count =
        site.kind === 'fishingVillage'
          ? seaside.length
          : Math.min(seaside.length, Math.max(1, Math.round(inner.length / 12)));
      const ranked = [...seaside].sort(
        (a, b) => WARDS.fishing.score(contextOf(b)) - WARDS.fishing.score(contextOf(a)) || a.index - b.index,
      );
      for (const p of ranked.slice(0, count)) {
        p.ward = 'fishing';
        p.why = 'fishing: boats drawn up on the shore';
      }
    }
    const fillRng = rng.fork('wards');
    for (const p of inner) {
      if (p.ward) continue;
      const c = contextOf(p);
      const weights = FILL_WARDS.map((w) =>
        Math.max(0.01, WARDS[w].fillWeight * Math.exp(WARDS[w].score(c))),
      );
      p.ward = fillRng.fork(`patch:${p.index}`).weighted(FILL_WARDS, weights);
      p.why = FILL_WARDS.map((w) => [w, WARDS[w].score(c)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w, v]) => `${w} ${v.toFixed(2)}`)
        .join(' · ');
    }
    for (const p of patches) {
      if (p.inner) continue;
      const near = gateSet.some(
        (g) => Math.hypot(g[0] - p.centroid[0], g[1] - p.centroid[1]) < spacing * 1.6,
      );
      p.ward = near && p.slope < 0.2 ? 'gate' : 'farm';
      p.why = p.ward === 'gate' ? 'gate: suburb outside a gate' : 'farm: fields outside the town';
    }
    // Modern years: the old town becomes the centre (DESIGN §6.3).
    const currentEra = input.eras?.length
      ? [...input.eras]
          .sort((a, b) => a.year - b.year)
          .filter((e) => e.year <= year)
          .pop()
      : undefined;
    for (const p of inner) p.originalWard = p.ward;
    if (input.eras?.length) {
      // Zoning changes are part of the history, future ones included, so a building knows the year
      // it will be replaced whatever year the map shows; the ward in force is the last one so far.
      const modernEras = [...input.eras].sort((a, b) => a.year - b.year).filter((e) => e.year >= 1890);
      for (const p of inner) {
        const c = contextOf(p);
        let ward = p.originalWard!;
        for (const era of modernEras) {
          const z = modernCoreZone(p.originalWard!, era, c.centreDist, c.onArtery);
          if (z !== ward) {
            p.transitions.push({ year: era.year, ward: z });
            ward = z;
          }
        }
        const now = p.transitions.filter((t) => t.year <= year).pop();
        if (now && now.ward !== p.ward) {
          p.why = `${now.ward}: old town reassigned in ${currentEra?.name ?? now.year} (was ${p.ward})`;
          p.ward = now.ward;
        }
      }
    }
    // Patches the growth curve has not reached yet are still fields.
    for (const p of inner)
      if (p.builtYear > year) {
        p.why = `farm: not built until ${p.builtYear} (${p.ward})`;
        p.ward = 'farm';
      }
    ctx.checkpoint();

    // --- 6. Outputs ----------------------------------------------------------
    const id = site.id;
    const patchFeatures: TownOutput['patches']['features'] = patches.map((p) => ({
      type: 'Feature',
      id: `${id}-patch-${p.index}`,
      geometry: { type: 'Polygon', coordinates: [[...p.ring, p.ring[0]!]] },
      properties: {
        settlement: id,
        ward: p.ward ?? 'common',
        inner: p.inner,
        ring: 0,
        why: p.why,
        ...(p.inner ? { built: p.builtYear } : {}),
      },
    }));
    const streetFeatures: TownOutput['streets']['features'] = [];
    let streetsKm = 0;
    const pushLine = (
      pts: Ring,
      cls: 'artery' | 'street' | 'steps' | 'lane' | 'road' | 'collector' | 'motorway',
      k: number | string,
      built = history.founded,
    ) => {
      streetFeatures.push({
        type: 'Feature',
        id: `${id}-${cls}-${k}`,
        geometry: { type: 'LineString', coordinates: pts },
        properties: { settlement: id, class: cls, built },
      });
      for (let i = 1; i < pts.length; i++)
        streetsKm += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]) / 1000;
    };
    arteries.forEach((a, k) => pushLine(a, 'artery', k));
    roads.forEach((r, k) => pushLine(r, 'road', k));
    // Country lanes: each farm holding that no road or artery touches gets a lane along patch
    // edges to the nearest of them; lanes share their way where they can.
    const hedgeFeatures: TownOutput['hedges']['features'] = [];
    {
      const served = new Set<string>();
      for (const path of [...arteries, ...roads]) for (const v of path) served.add(graph.key(v));
      const laneEdges = new Set<string>();
      let laneCount = 0;
      const fieldRng = rng.fork('fields');
      for (const p of patches) {
        if (p.inner || p.ward !== 'farm') continue;
        const keys = p.ring.map((v) => graph.key(v));
        if (keys.some((k) => served.has(k))) continue;
        // Start from the vertex nearest the centre: the lane heads for the town.
        const start = keys.reduce((best, k) => {
          const a = graph.point(k);
          const b = graph.point(best);
          return Math.hypot(a[0] - cx, a[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? k : best;
        }, keys[0]!);
        const path = graph.shortestPath(
          start,
          served,
          (ek) => (laneEdges.has(ek) ? 0.5 : 1) * bridgeFactor(ek),
          slopeAt(height, slope),
        );
        let len = 0;
        for (let i = 1; i < path.length; i++)
          len += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
        if (path.length < 2 || len > 600) continue;
        // Only the stretch not already a lane is new.
        let from = 0;
        for (let i = 1; i < path.length; i++) {
          const ek = graph.edgeKey(path[i - 1]!, path[i]!);
          if (laneEdges.has(ek)) {
            if (i - from >= 2) pushLine(path.slice(from, i), 'lane', laneCount++);
            from = i;
          }
          laneEdges.add(ek);
        }
        if (path.length - from >= 2) pushLine(path.slice(from), 'lane', laneCount++);
        for (const v of path) served.add(graph.key(v));
        // Strip fields: the holding cut across its long axis, a hedge on every boundary.
        const box = orientedBox(p.ring);
        const stripW = fieldRng.fork(`strip:${p.index}`).range(35, 70);
        const perp: Pt = [-box.axis[1], box.axis[0]];
        const hedge = (a: Pt, b: Pt) =>
          hedgeFeatures.push({
            type: 'Feature',
            id: `${id}-hedge-${hedgeFeatures.length}`,
            geometry: { type: 'LineString', coordinates: [a, b] },
            properties: { settlement: id, kind: 'hedge' },
          });
        for (let u = -box.length / 2 + stripW; u < box.length / 2 - stripW * 0.5; u += stripW) {
          const c: Pt = [box.center[0] + box.axis[0] * u, box.center[1] + box.axis[1] * u];
          const reach = box.width;
          const a: Pt = [c[0] - perp[0] * reach, c[1] - perp[1] * reach];
          const b: Pt = [c[0] + perp[0] * reach, c[1] + perp[1] * reach];
          for (const [q0, q1] of chords(p.ring, a, b)) hedge(q0, q1);
        }
        for (let i = 0; i < p.ring.length; i++) hedge(p.ring[i]!, p.ring[(i + 1) % p.ring.length]!);
      }
    }
    // Minor streets: every inner patch edge not already an artery.
    const seenEdges = new Set<string>();
    for (const p of inner) {
      if (p.ward === 'plaza' || p.builtYear > year) continue;
      for (let i = 0; i < p.ring.length; i++) {
        const a = p.ring[i]!;
        const b = p.ring[(i + 1) % p.ring.length]!;
        const ek = graph.edgeKey(a, b);
        if (seenEdges.has(ek) || arteryEdges.has(ek)) continue;
        seenEdges.add(ek);
        const cls = gradientBetween(height, a, b) > STEPS_GRADIENT ? 'steps' : 'street';
        pushLine([a, b], cls, `${p.index}-${i}`, p.builtYear);
      }
    }
    const wallFeatures: TownOutput['walls']['features'] = wallRing.length
      ? [
          {
            type: 'Feature',
            id: `${id}-wall`,
            geometry: { type: 'LineString', coordinates: [...wallRing, wallRing[0]!] },
            properties: { settlement: id, kind: 'wall' },
          },
        ]
      : [];
    const gateFeatures: TownOutput['gates']['features'] = [
      ...gates.map((g, k) => ({
        type: 'Feature' as const,
        id: `${id}-gate-${k}`,
        geometry: { type: 'Point' as const, coordinates: g },
        properties: { settlement: id, kind: 'gate' as const },
      })),
      ...towers.map((t, k) => ({
        type: 'Feature' as const,
        id: `${id}-tower-${k}`,
        geometry: { type: 'Point' as const, coordinates: t },
        properties: { settlement: id, kind: 'tower' as const },
      })),
    ];
    const blocks: BlockRecipe[] = [];
    for (const p of patches) {
      if (!p.ward || p.ward === 'plaza' || p.ward === 'farm') continue;
      const halfWidth = arteryPatchSet.has(p) ? ARTERY_HALF_WIDTH : STREET_HALF_WIDTH;
      let ring = inset(p.ring, halfWidth);
      // A block on the water stands back behind a quay strip (clipped or merely close to it).
      const nearWater =
        p.waterfront || ring.some(([x, y]) => shoreDistance(terrain, x, y, 'water') < QUAY_M + localCell);
      if (nearWater && ring.length >= 3) {
        const back = clipToLand(ring, centroid(ring), quayLand, localCell);
        if (!back) continue;
        ring = back;
      }
      // A sliver left by the shoreline clip is not a block.
      if (ring.length < 3 || area(ring) < 50) continue;
      blocks.push({
        id: `${id}-b${p.index}`,
        settlementId: id,
        ring,
        ward: p.ward,
        areaM2: area(ring),
        seed: `${input.seed}${input.salt ? `/${input.salt}` : ''}/settlement:${id}/block:${p.index}`,
        elevationM: p.elevation,
        builtYear: p.builtYear,
        originalWard: p.originalWard ?? p.ward,
        ...(p.transitions.length ? { transitions: p.transitions } : {}),
      });
    }
    // --- 7. Growth rings ------------------------------------------------------
    let ringCount = 0;
    if (growth.rings.length) {
      const rings = generateRings(growth.rings, R, {
        site,
        terrain,
        rng: rng.fork('rings'),
        isLand,
        clipToLand: (ring, s) => clipToLand(ring, s, clipLand, localCell),
        slopeAt: slopeAt(height, slope),
        gates,
        radiusAt: footprint.radiusAt,
        extent: (r) => footprint.extent(r),
        outline: (r) => footprint.outline(r),
        bbox: (r) => footprint.bbox(r),
        clipQuay: (ring, s) => clipToLand(ring, s, quayLand, localCell),
        quayM: QUAY_M,
        localCell,
        coreElevationM: innerHeights.length ? median(innerHeights) : height.sample(cx, cy),
        riverDistance: (x, y) => shoreDistance(terrain, x, y, 'water'),
      });
      ringCount = rings.rings.length;
      bridgeSpans.push(...rings.bridges);
      const zoneRng = rng.fork('zones');
      for (const b of rings.blocks) {
        if (area(b.ring) < 50) continue;
        const c = centroid(b.ring);
        const f = input.society?.sample(c[0], c[1]);
        const { zone, why } = modernZone(
          b.era,
          f?.wealthClass ?? 'modest',
          f?.densityClass ?? 'medium',
          b,
          zoneRng.fork(b.key),
        );
        patchFeatures.push({
          type: 'Feature',
          id: `${id}-ring-${b.key}`,
          geometry: { type: 'Polygon', coordinates: [[...b.ring, b.ring[0]!]] },
          properties: {
            settlement: id,
            ward: zone,
            inner: false,
            ring: b.ringIndex + 1,
            why,
            built: b.builtYear,
          },
        });
        blocks.push({
          id: `${id}-r${b.key}`,
          settlementId: id,
          ring: b.ring,
          ward: zone,
          areaM2: area(b.ring),
          seed: `${input.seed}${input.salt ? `/${input.salt}` : ''}/settlement:${id}/ring:${b.key}`,
          elevationM: height.sample(c[0], c[1]),
          builtYear: b.builtYear,
          originalWard: zone,
        });
      }
      rings.streets.forEach((st) => {
        const mid = st.points[Math.floor(st.points.length / 2)]!;
        const d = Math.min(reAt(mid), lastRing?.rOut ?? R);
        const ring = growth.rings.find((r) => d >= r.rIn && d <= r.rOut) ?? growth.rings[0]!;
        const built =
          st.cls === 'artery' ? growth.coreEndYear : yearForRadius(history, d, ring.fromYear, ring.toYear);
        pushLine(st.points, st.cls, st.key, built);
      });
    }
    // Decline: when the population falls below its peak the outermost blocks empty first.
    let abandonedBlocks = 0;
    if (blocks.length && populationNow < peak.population * 0.97) {
      const jitter = rng.fork('abandon');
      const ranked = blocks
        .map((b) => {
          const c = centroid(b.ring);
          return { b, d: Math.min(reAt(c), maxR) + jitter.fork(b.id).range(0, 0.15) * R };
        })
        .sort((a, b) => b.d - a.d);
      const fraction = (t: number) => {
        const pk = peakUntil(history, t).population;
        return pk > 0 ? 1 - populationAt(history, t) / pk : 0;
      };
      const n = ranked.length;
      ranked.forEach(({ b }, rank) => {
        const share = (rank + 1) / n;
        for (let t = peak.year; t <= year; t += 5) {
          if (share <= fraction(t)) {
            b.abandonedYear = t;
            abandonedBlocks++;
            break;
          }
        }
      });
      const abandonedById = new Map(
        blocks.filter((b) => b.abandonedYear).map((b) => [b.id, b.abandonedYear!]),
      );
      for (const f of patchFeatures) {
        const bid = String(f.id).replace(`${id}-patch-`, `${id}-b`).replace(`${id}-ring-`, `${id}-r`);
        const ay = abandonedById.get(bid);
        if (ay) f.properties.abandoned = ay;
      }
    }
    // Disasters: fires rebuild, storms and floods damage the blocks they reached.
    // Disasters are on the timeline whatever the year shows: a lot knows the fire that will take it.
    for (const e of input.events ?? []) {
      for (const b of blocks) {
        if ((b.builtYear ?? history.founded) >= e.year) continue;
        const c = centroid(b.ring);
        if (Math.hypot(c[0] - e.center[0], c[1] - e.center[1]) > e.radiusM) continue;
        if (e.kind === 'flood' && e.levelM !== undefined && b.elevationM > e.levelM) continue;
        (b.disasters ??= []).push({ kind: e.kind, year: e.year, magnitude: e.magnitude });
      }
    }
    // Reserved land: facilities and yards take their patches; those blocks draw nothing.
    if (input.reserved?.length) {
      const reservedFor = (ring: Ring) => {
        const c = centroid(ring);
        return input.reserved!.find((r) => pointInRing(c[0], c[1], r.ring));
      };
      for (const f of patchFeatures) {
        const ring = f.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
        const r = reservedFor(ring);
        if (r) {
          f.properties.ward = r.ward;
          f.properties.why = `${r.ward}: land taken by ${r.id}`;
        }
      }
      for (let i = blocks.length - 1; i >= 0; i--) if (reservedFor(blocks[i]!.ring)) blocks.splice(i, 1);
    }
    // Authored zones override generated wards for the patches they cover (DESIGN §9.3).
    if (input.zoneEdits?.length) {
      const covers = (x: number, y: number, e: ZoneEdit) =>
        e.ring
          ? pointInRing(x, y, e.ring)
          : e.points
            ? distToPolyline(x, y, e.points) <= (e.radiusM ?? 80)
            : false;
      const zoneFor = (ring: Ring): ZoneEdit | undefined => {
        const c = centroid(ring);
        return input.zoneEdits!.find((e) => covers(c[0], c[1], e));
      };
      for (const f of patchFeatures) {
        const ring = f.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
        const e = zoneFor(ring);
        if (e && e.ward in WARDS) {
          f.properties.ward = e.ward as WardId;
          f.properties.why = `${e.ward}: authored zone ${e.id}`;
        }
      }
      for (const b of blocks) {
        const e = zoneFor(b.ring);
        if (e && e.ward in WARDS) b.ward = e.ward as WardId;
      }
    }
    let extentM = site.radiusM;
    for (const f of patchFeatures)
      for (const c of f.geometry.coordinates[0]!)
        extentM = Math.max(extentM, Math.hypot(c[0]! - cx, c[1]! - cy));
    return {
      key: ctx.key,
      id,
      center: site.center,
      radiusM: site.radiusM,
      extentM,
      patches: { type: 'FeatureCollection', features: patchFeatures },
      streets: { type: 'FeatureCollection', features: streetFeatures },
      walls: { type: 'FeatureCollection', features: wallFeatures },
      gates: { type: 'FeatureCollection', features: gateFeatures },
      hedges: { type: 'FeatureCollection', features: hedgeFeatures },
      bridges: {
        type: 'FeatureCollection',
        features: bridgeSpans.map(([a, b], k) => ({
          type: 'Feature' as const,
          id: `${id}-bridge-${k}`,
          geometry: { type: 'LineString' as const, coordinates: [a, b] },
          properties: { settlement: id, kind: 'bridge' as const },
        })),
      },
      blocks,
      stats: {
        patches: patchFeatures.length,
        inner: inner.length,
        walled: wallRing.length > 0,
        streetsKm,
        rings: ringCount,
        coreRadiusM: R,
        population: populationNow,
        peakPopulation: peak.population,
        peakYear: peak.year,
        abandonedBlocks,
        coreEndYear: growth.coreEndYear,
        steepShare: footprint.steepShare(R, 0.2),
      },
    };
  },
});

/** The stretches of the line a→b that lie inside the ring (pairs of crossings along it). */
function chords(ring: Ring, a: Pt, b: Pt): [Pt, Pt][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ts: number[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * Math.hypot(dx, dy) < 8) continue;
    out.push([
      [a[0] + dx * t0, a[1] + dy * t0],
      [a[0] + dx * t1, a[1] + dy * t1],
    ]);
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function pickBest(patches: Patch[], score: (p: Patch) => number): Patch | null {
  let best: Patch | null = null;
  let bestScore = -Infinity;
  for (const p of patches) {
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

function slopeAt(height: Raster, slope: Float32Array) {
  return (x: number, y: number) => {
    const col = Math.min(Math.max(Math.round(height.col(x)), 0), height.width - 1);
    const row = Math.min(Math.max(Math.round(height.row(y)), 0), height.height - 1);
    return slope[row * height.width + col]!;
  };
}

/**
 * Clip a patch to land with a fine local mask: rasterise "inside ring and on
 * land", polygonise, and keep the piece containing (or nearest to) the site.
 */
function clipToLand(
  ring: Ring,
  site: Pt,
  isLand: (x: number, y: number) => boolean,
  cellM: number,
): Ring | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = cellM * 2;
  const width = Math.ceil((maxX - minX + 2 * pad) / cellM) + 1;
  const height = Math.ceil((maxY - minY + 2 * pad) / cellM) + 1;
  if (width * height > 250_000) return ring;
  const r = new Raster({ width, height, cellSizeM: cellM, originX: minX - pad, originY: minY - pad });
  for (let row = 0; row < height; row++) {
    const y = r.y(row);
    for (let col = 0; col < width; col++) {
      const x = r.x(col);
      r.set(col, row, pointInRing(x, y, ring) && isLand(x, y) ? 1 : 0);
    }
  }
  const polys = contourPolygons(r, 0.5);
  if (!polys.length) return null;
  const containing = polys.find((p) => pointInRing(site[0], site[1], p.rings[0]!));
  const chosen = containing ?? polys[0]!;
  const out = open(chosen.rings[0]!);
  return out.length >= 3 ? out : null;
}

/** Graph over patch edges with Dijkstra shortest paths (deterministic tie-breaking by key). */
function buildEdgeGraph(patches: Patch[]) {
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const points = new Map<string, Pt>();
  const adj = new Map<string, Map<string, number>>();
  const addEdge = (a: Pt, b: Pt) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return;
    points.set(ka, a);
    points.set(kb, b);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    (adj.get(ka) ?? adj.set(ka, new Map()).get(ka)!).set(kb, d);
    (adj.get(kb) ?? adj.set(kb, new Map()).get(kb)!).set(ka, d);
  };
  for (const p of patches)
    for (let i = 0; i < p.ring.length; i++) addEdge(p.ring[i]!, p.ring[(i + 1) % p.ring.length]!);
  const edgeKey = (a: Pt, b: Pt) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  // Connected components of the patch edges (a river's two banks share no vertex), taken before
  // any bridge is added.
  let components: Map<string, number> | null = null;
  const componentOf = (k: string): number => {
    if (!components) {
      components = new Map();
      let id = 0;
      for (const start of points.keys()) {
        if (components.has(start)) continue;
        const stack = [start];
        components.set(start, id);
        while (stack.length) {
          const u = stack.pop()!;
          for (const v of adj.get(u)?.keys() ?? [])
            if (!components.has(v)) {
              components.set(v, id);
              stack.push(v);
            }
        }
        id++;
      }
    }
    return components.get(k) ?? -1;
  };
  const bridgeKeys = new Set<string>();
  return {
    key,
    edgeKey,
    componentOf,
    bridgeKeys,
    addBridge(a: Pt, b: Pt) {
      addEdge(a, b);
      bridgeKeys.add(edgeKey(a, b));
    },
    point: (k: string) => points.get(k)!,
    shortestPath(
      from: string,
      targets: Set<string>,
      edgeFactor: (edgeKey: string) => number,
      slopeAt: (x: number, y: number) => number,
    ): Ring {
      if (!adj.has(from)) return [];
      const dist = new Map<string, number>([[from, 0]]);
      const prev = new Map<string, string>();
      const open: string[] = [from];
      const done = new Set<string>();
      let found: string | null = null;
      while (open.length) {
        // Deterministic extract-min (small graphs; keys break ties).
        let bi = 0;
        for (let i = 1; i < open.length; i++) {
          const a = dist.get(open[i]!)!;
          const b = dist.get(open[bi]!)!;
          if (a < b || (a === b && open[i]! < open[bi]!)) bi = i;
        }
        const u = open.splice(bi, 1)[0]!;
        if (done.has(u)) continue;
        done.add(u);
        if (targets.has(u)) {
          found = u;
          break;
        }
        const pu = points.get(u)!;
        for (const [v, d] of adj.get(u) ?? []) {
          if (done.has(v)) continue;
          const pv = points.get(v)!;
          const s = (slopeAt(pu[0], pu[1]) + slopeAt(pv[0], pv[1])) / 2;
          const ek = u < v ? `${u}|${v}` : `${v}|${u}`;
          const cost = d * (1 + 4 * s) * edgeFactor(ek);
          const nd = dist.get(u)! + cost;
          if (nd < (dist.get(v) ?? Infinity)) {
            dist.set(v, nd);
            prev.set(v, u);
            open.push(v);
          }
        }
      }
      if (!found) return [];
      const path: Ring = [];
      let cur: string | undefined = found;
      while (cur) {
        path.push(points.get(cur)!);
        cur = prev.get(cur);
      }
      return path.reverse();
    },
  };
}
