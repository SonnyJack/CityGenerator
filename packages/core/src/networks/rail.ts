import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { Rng } from '../random/rng.js';
import type { Ring } from '../raster/contours.js';
import { landSampler, smoothOnLand } from '../terrain/land.js';
import { gradeProfile, resampleLine } from './profile.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import { eraAt, type EraParams } from '../settlement/eras.js';
import type { SettlementSite } from '../settlement/siting.js';
import { cellAt, routeCells } from './routing.js';

/**
 * Region stage R5b (rail): a railway network between the settlements that
 * are big enough to be served in the given year. Mainlines join the large
 * places and leave the region at the edges; branch lines reach the smaller
 * ones; after the 1960s the least-used branches close. Every link is routed
 * on the terrain with a ruling gradient, then given a vertical profile that
 * respects the gradient: where the ground climbs faster the track runs in
 * cuttings and tunnels, where it drops away it runs on embankments and
 * viaducts. Stations sit at the edge of each old core; big stations get goods
 * yards, marshalling yards with steam-era roundhouses (later diesel depots and
 * container terminals) and freight spurs to the docks and the industrial
 * side of town. Metropolitan cores after 1900 take their lines underground.
 */

export type TrackClass = 'mainline' | 'branch' | 'spur' | 'yard' | 'disused';
export type TrackMode = 'surface' | 'cutting' | 'embankment' | 'viaduct' | 'tunnel' | 'subway' | 'elevated';

export interface TrackProps {
  class: TrackClass;
  mode: TrackMode;
  line: string;
  from: string;
  to: string;
  lengthKm: number;
  /** Steepest gradient on the segment (rise/run). */
  gradient: number;
}

export type StationKind = 'central' | 'town' | 'halt' | 'suburban';

export interface StationProps {
  kind: StationKind;
  settlement: string;
  name?: string;
  line: string;
  /** True for stations on closed branches. */
  closed: boolean;
}

export type StructureKind =
  'goodsYard' | 'railYard' | 'roundhouse' | 'turntable' | 'coaling' | 'waterTower' | 'depot' | 'intermodal';

export interface RailInput {
  seed: string;
  terrain: TerrainOutput;
  sites: SettlementSite[];
  year: number;
  eras: EraParams[];
  /** Number of mainlines leaving the region through the largest settlement (0–4). */
  mainlines: number;
  enabled: boolean;
  /** Direction the wind comes from (radians); industry and yards go downwind. */
  windFrom?: number;
}

export interface RailOutput {
  key: string;
  tracks: FeatureCollection<LineString, TrackProps>;
  stations: FeatureCollection<Point, StationProps>;
  structures: FeatureCollection<Polygon, { kind: StructureKind; settlement: string }>;
  portals: FeatureCollection<Point, { kind: 'tunnelPortal' | 'viaductEnd' }>;
  /** Noise sources for the society stage: [x, y, radiusM, strength]. */
  nuisance: [number, number, number, number][];
  stats: {
    trackKm: number;
    mainlineKm: number;
    branchKm: number;
    spurKm: number;
    yardKm: number;
    disusedKm: number;
    stations: number;
    yards: number;
    tunnels: number;
    viaducts: number;
    maxGradient: number;
    minRadiusM: number;
  };
}

/** Ruling gradients (rise/run) by class. */
const GRADIENT_CAP: Record<TrackClass, number> = {
  mainline: 0.02,
  branch: 0.03,
  spur: 0.035,
  yard: 0.01,
  disused: 0.03,
};

const EMPTY = (key: string): RailOutput => ({
  key,
  tracks: { type: 'FeatureCollection', features: [] },
  stations: { type: 'FeatureCollection', features: [] },
  structures: { type: 'FeatureCollection', features: [] },
  portals: { type: 'FeatureCollection', features: [] },
  nuisance: [],
  stats: {
    trackKm: 0,
    mainlineKm: 0,
    branchKm: 0,
    spurKm: 0,
    yardKm: 0,
    disusedKm: 0,
    stations: 0,
    yards: 0,
    tunnels: 0,
    viaducts: 0,
    maxGradient: 0,
    minRadiusM: Infinity,
  },
});

/** Smallest population served by rail in a year (branch lines reach further as the network matures). */
export function railServiceThreshold(year: number): { active: number; served: number } {
  if (year < 1870) return { active: 3000, served: 3000 };
  if (year < 1900) return { active: 1500, served: 1500 };
  if (year < 1965) return { active: 500, served: 500 };
  // Branch-line closures: small places keep a disused alignment.
  return { active: 1500, served: 500 };
}

type Pt = [number, number];

export const railStage = defineStage<RailInput, RailOutput>({
  id: 'rail',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.terrain.key}|${i.seed}|${i.year}|${i.mainlines}|${i.enabled}|${i.windFrom ?? ''}|${JSON.stringify(
      i.sites.map((s) => [s.id, s.kind, s.center, s.population, s.radiusM, s.coastal]),
    )}|${JSON.stringify(i.eras.map((e) => [e.id, e.transport.rail]))}`,
  run(input, ctx) {
    const { terrain, sites, year } = input;
    const era = eraAt(input.eras, year);
    if (!input.enabled || !era.transport.rail || sites.length === 0) return EMPTY(ctx.key);
    const rng = new Rng(`${input.seed}/rail`);
    const { height, water, slope } = terrain;
    const { width, height: rows, cellSizeM } = height;
    const halfW = ((width - 1) * cellSizeM) / 2;
    const halfH = ((rows - 1) * cellSizeM) / 2;
    const windFrom = input.windFrom ?? Math.PI;
    const downwind: Pt = [Math.cos(windFrom + Math.PI), Math.sin(windFrom + Math.PI)];

    // --- 1. Which places are served -------------------------------------------------
    const threshold = railServiceThreshold(year);
    let served = sites.filter((s) => s.population >= threshold.served);
    if (!served.length) {
      const largest = sites.reduce((m, s) => (s.population > m.population ? s : m), sites[0]!);
      if (largest.population >= 800) served = [largest];
      else return EMPTY(ctx.key);
    }
    served.sort((a, b) => b.population - a.population);
    const hub = served[0]!;
    const isActive = (s: SettlementSite) => s.population >= threshold.active || s === hub;

    // --- 2. Links: MST with a penalty for crossing the sea ------------------------------
    const seaFraction = (a: Pt, b: Pt) => {
      let n = 0;
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        const [c, r] = cellAt(terrain, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        if (water[r * width + c] === WATER.sea) n++;
      }
      return n / 11;
    };
    const linkCost = (a: SettlementSite, b: SettlementSite) => {
      const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
      return d * (1 + 2.5 * seaFraction(a.center, b.center));
    };
    const links: [number, number][] = [];
    if (served.length >= 2) {
      const inTree = new Set<number>([0]);
      while (inTree.size < served.length) {
        let best: [number, number, number] | null = null;
        for (const a of inTree)
          for (let b = 0; b < served.length; b++) {
            if (inTree.has(b)) continue;
            const c = linkCost(served[a]!, served[b]!);
            if (!best || c < best[2]) best = [a, b, c];
          }
        if (!best) break;
        links.push([best[0], best[1]]);
        inTree.add(best[1]);
      }
    }
    const neighbours = new Map<number, number[]>();
    for (const [a, b] of links) {
      neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
      neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
    }
    ctx.checkpoint();

    // --- 3. Station points at the edge of each old core, facing the network ----------
    const landAt = (p: Pt) => {
      const [c, r] = cellAt(terrain, p[0], p[1]);
      const w = water[r * width + c]!;
      return w !== WATER.sea && w !== WATER.lake;
    };
    const stationOf = new Map<string, Pt>();
    served.forEach((s, i) => {
      const ns = neighbours.get(i) ?? [];
      let dx = 0;
      let dy = 0;
      for (const n of ns) {
        const o = served[n]!;
        const d = Math.hypot(o.center[0] - s.center[0], o.center[1] - s.center[1]) || 1;
        dx += (o.center[0] - s.center[0]) / d;
        dy += (o.center[1] - s.center[1]) / d;
      }
      let len = Math.hypot(dx, dy);
      if (len < 0.3) {
        // Neighbours on opposite sides (a through station) or none: use a perpendicular / the long axis.
        if (ns.length) {
          const o = served[ns[0]!]!;
          const d = Math.hypot(o.center[0] - s.center[0], o.center[1] - s.center[1]) || 1;
          dx = -(o.center[1] - s.center[1]) / d;
          dy = (o.center[0] - s.center[0]) / d;
        } else {
          dx = 1;
          dy = 0;
        }
        len = 1;
      }
      dx /= len;
      dy /= len;
      const dist = Math.min(0.8 * s.radiusM, 350 + 0.25 * s.radiusM);
      const candidates: Pt[] = [
        [s.center[0] + dx * dist, s.center[1] + dy * dist],
        [s.center[0] - dx * dist, s.center[1] - dy * dist],
        [s.center[0] - dy * dist, s.center[1] + dx * dist],
        [s.center[0] + dy * dist, s.center[1] - dx * dist],
        [s.center[0] + dx * dist * 0.5, s.center[1] + dy * dist * 0.5],
        s.center,
      ];
      stationOf.set(s.id, candidates.find(landAt) ?? s.center);
    });

    // --- 4. Routing ---------------------------------------------------------------------
    const coreOf = served.map((s) => ({ c: s.center, r: Math.max(150, s.radiusM * 0.55) }));
    const railCost =
      (cap: number, endpoints: Set<number>) =>
      (v: number): number => {
        const w = water[v]!;
        if (w === WATER.sea || w === WATER.lake) return Infinity;
        const g = slope[v]!;
        let cost = 1 + 2 * g + (g > cap ? (24 * (g - cap)) / cap : 0);
        if (w === WATER.river) cost += 600 / cellSizeM;
        // Skirt the cores of settlements the link is not serving.
        const x = height.x(v % width);
        const y = height.y((v / width) | 0);
        for (let i = 0; i < coreOf.length; i++) {
          if (endpoints.has(i)) continue;
          const k = coreOf[i]!;
          if (Math.hypot(x - k.c[0], y - k.c[1]) < k.r) {
            cost *= 4;
            break;
          }
        }
        return cost;
      };
    const tracks: RailOutput['tracks']['features'] = [];
    const portals: RailOutput['portals']['features'] = [];
    const stations: RailOutput['stations']['features'] = [];
    const structures: RailOutput['structures']['features'] = [];
    const nuisance: RailOutput['nuisance'] = [];
    const stats = EMPTY('').stats;
    let tunnels = 0;
    let viaducts = 0;

    const onLand = landSampler(terrain, { rivers: 'land', aboveSea: false });
    /** Route between two world points; returns a smoothed polyline or null. */
    const route = (from: Pt, to: Pt, cls: TrackClass, endpoints: Set<number>): Ring | null => {
      const cells = routeCells(terrain, cellAt(terrain, from[0], from[1]), cellAt(terrain, to[0], to[1]), {
        costOf: railCost(GRADIENT_CAP[cls], endpoints),
      });
      if (cells.length < 2) return null;
      const raw: Ring = cells.map(([c, r]) => [height.x(c), height.y(r)]);
      raw[0] = [from[0], from[1]];
      raw[raw.length - 1] = [to[0], to[1]];
      // Rail curves are gentle: drop the staircase first, smooth heavily, then simplify lightly,
      // without the curve leaving the land the router chose (rivers are viaducts).
      return smoothOnLand(raw, onLand, {
        preSimplify: cellSizeM * 0.75,
        iterations: cls === 'mainline' ? 5 : 4,
        tolerance: cellSizeM * 0.2,
      });
    };

    /** Resample a polyline at a fixed spacing (keeps the endpoints). */
    const resample = (line: Ring, ds: number): { pts: Ring; s: number[] } => resampleLine(line, ds);

    /** Vertical profile within the gradient cap, iterated forward and backward. */
    const profile = (pts: Ring, s: number[], cap: number): Float64Array => gradeProfile(terrain, pts, s, cap);

    const minRadiusOf = (line: Ring): number => {
      let best = Infinity;
      for (let i = 4; i < line.length - 4; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const c = line[i + 1]!;
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
        if (l1 < 1 || l2 < 1) continue;
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
        const theta = Math.abs(Math.atan2(cross, dot));
        if (theta < 1e-4) continue;
        best = Math.min(best, Math.min(l1, l2) / (2 * Math.sin(theta / 2)));
      }
      return best;
    };

    const metroCores = served
      .filter((s) => s.population >= 100_000)
      .map((s) => ({ c: s.center, r: s.radiusM, rCore: Math.min(0.6 * s.radiusM, 350 + 0.35 * s.radiusM) }));

    /**
     * Ease vertices whose local curve radius is below the minimum (endpoints fixed). Constrained,
     * a vertex moves only onto land (half way when the full move would be wet), so the corners
     * the land projection makes are softened without the track swinging back into the cove.
     */
    const relaxCurves = (pts: Ring, minRadius: number, iterations: number, constrained = false): void => {
      for (let it = 0; it < iterations; it++) {
        let moved = false;
        for (let i = 1; i < pts.length - 1; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          const c = pts[i + 1]!;
          const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
          if (l1 < 1 || l2 < 1) continue;
          const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
          const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
          const theta = Math.abs(Math.atan2(cross, dot));
          if (theta < 1e-4) continue;
          const radius = Math.min(l1, l2) / (2 * Math.sin(theta / 2));
          if (radius >= minRadius) continue;
          const q: Pt = [b[0] * 0.4 + ((a[0] + c[0]) / 2) * 0.6, b[1] * 0.4 + ((a[1] + c[1]) / 2) * 0.6];
          if (constrained && !onLand(q[0], q[1])) {
            const h: Pt = [(b[0] + q[0]) / 2, (b[1] + q[1]) / 2];
            if (!onLand(h[0], h[1])) continue;
            pts[i] = h;
          } else pts[i] = q;
          moved = true;
        }
        if (!moved) break;
      }
    };
    const MIN_RADIUS: Record<TrackClass, number> = {
      mainline: 300,
      branch: 180,
      spur: 120,
      yard: 60,
      disused: 180,
    };

    /**
     * Curve easing may swing a track into a cove. A short span of water (an inlet a viaduct
     * crosses in a few cells) is kept: that is how a railway takes a ragged shore. A longer run
     * of eased points over water is replaced by the stretch of the routed line between its dry
     * neighbours, so the track follows the route the router found there; the joints are eased
     * on land afterwards.
     */
    const keepOnLand = (pts: Ring, ref: Ring, spanM: number): Ring => {
      const refS: number[] = [0];
      for (let k = 1; k < ref.length; k++)
        refS.push(refS[k - 1]! + Math.hypot(ref[k]![0] - ref[k - 1]![0], ref[k]![1] - ref[k - 1]![1]));
      const projectS = (p: Pt): number => {
        let best = 0;
        let bestD = Infinity;
        for (let k = 1; k < ref.length; k++) {
          const a = ref[k - 1]!;
          const b = ref[k]!;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len2 = dx * dx + dy * dy || 1;
          const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
          const d = (a[0] + dx * t - p[0]) ** 2 + (a[1] + dy * t - p[1]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = refS[k - 1]! + Math.sqrt(len2) * t;
          }
        }
        return best;
      };
      const pointAtS = (target: number): Pt => {
        for (let k = 1; k < ref.length; k++)
          if (refS[k]! >= target) {
            const a = ref[k - 1]!;
            const b = ref[k]!;
            const t = refS[k]! > refS[k - 1]! ? (target - refS[k - 1]!) / (refS[k]! - refS[k - 1]!) : 0;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          }
        return ref[ref.length - 1]!;
      };
      const out: Ring = [pts[0]!];
      let i = 1;
      while (i < pts.length - 1) {
        const p = pts[i]!;
        if (onLand(p[0], p[1])) {
          out.push(p);
          i++;
          continue;
        }
        let j = i;
        let span = Math.hypot(p[0] - out[out.length - 1]![0], p[1] - out[out.length - 1]![1]);
        while (j < pts.length - 1 && !onLand(pts[j]![0], pts[j]![1])) {
          j++;
          span += Math.hypot(pts[j]![0] - pts[j - 1]![0], pts[j]![1] - pts[j - 1]![1]);
        }
        if (span <= spanM) {
          for (let k = i; k < j; k++) out.push(pts[k]!);
          i = j;
          continue;
        }
        const s0 = projectS(out[out.length - 1]!);
        const s1 = projectS(pts[j]!);
        const lo = Math.min(s0, s1);
        const hi = Math.max(s0, s1);
        const mids: Pt[] = [];
        for (let k = 0; k < ref.length; k++) if (refS[k]! > lo && refS[k]! < hi) mids.push(ref[k]!);
        if (s0 > s1) mids.reverse();
        if (!mids.length) mids.push(pointAtS((lo + hi) / 2));
        out.push(...mids);
        i = j;
      }
      out.push(pts[pts.length - 1]!);
      return out;
    };

    /** Split a routed line into mode runs and push them as track features. */
    const pushTrack = (line: Ring, cls: TrackClass, lineId: string, from: string, to: string): Ring => {
      // Ease curves at a coarse spacing first (large moves), then at the working spacing.
      // A mainline may bridge a longer inlet than a branch or a spur.
      const spanM = cellSizeM * (cls === 'mainline' ? 6 : 3);
      let coarse = resample(line, cellSizeM * 1.5).pts;
      relaxCurves(coarse, MIN_RADIUS[cls], 200);
      coarse = keepOnLand(coarse, line, spanM);
      relaxCurves(coarse, MIN_RADIUS[cls], 80, true);
      let fine = resample(coarse, cellSizeM * 0.5).pts;
      relaxCurves(fine, MIN_RADIUS[cls], 200);
      fine = keepOnLand(fine, line, spanM);
      relaxCurves(fine, MIN_RADIUS[cls], 80, true);
      const { pts, s } = resample(fine, cellSizeM * 0.5);
      if (pts.length < 2) return line;
      const cap = GRADIENT_CAP[cls];
      const z = profile(pts, s, cap);
      const modes: TrackMode[] = new Array<TrackMode>(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const [c, r] = cellAt(terrain, pts[i]![0], pts[i]![1]);
        const ground = Math.max(terrain.seaLevel, height.data[r * width + c]!);
        const d = z[i]! - ground;
        let m: TrackMode = 'surface';
        if (d > 12) m = 'viaduct';
        else if (d > 3) m = 'embankment';
        else if (d < -16) m = 'tunnel';
        else if (d < -3) m = 'cutting';
        // Over water of any kind (by the drawn shoreline) the track is carried: a bridge over a
        // river, a viaduct across an inlet.
        if (
          (water[r * width + c] !== WATER.land || !onLand(pts[i]![0], pts[i]![1])) &&
          (m === 'surface' || m === 'embankment' || m === 'cutting')
        )
          m = 'viaduct';
        for (const k of metroCores) {
          const dist = Math.hypot(pts[i]![0] - k.c[0], pts[i]![1] - k.c[1]);
          if (cls !== 'yard' && cls !== 'spur' && year >= 1900 && dist < k.rCore) m = 'subway';
          else if (year >= 1890 && year < 1950 && dist < k.r && m === 'viaduct') m = 'elevated';
        }
        modes[i] = m;
      }
      // Merge runs shorter than four samples into their neighbours.
      for (let pass = 0; pass < 2; pass++) {
        let i = 0;
        while (i < modes.length) {
          let j = i;
          while (j < modes.length && modes[j] === modes[i]) j++;
          if (j - i < 4 && (i > 0 || j < modes.length)) {
            const fill = i > 0 ? modes[i - 1]! : modes[j]!;
            for (let k = i; k < j; k++) modes[k] = fill;
          }
          i = j;
        }
      }
      let i = 0;
      while (i < modes.length - 1) {
        let j = i + 1;
        while (j < modes.length && modes[j] === modes[i]) j++;
        const end = Math.min(j, modes.length - 1);
        const coords: Ring = pts.slice(i, end + 1);
        let len = 0;
        let grad = 0;
        for (let k = i + 1; k <= end; k++) {
          const ds = s[k]! - s[k - 1]!;
          len += ds;
          if (ds > 0) grad = Math.max(grad, Math.abs(z[k]! - z[k - 1]!) / ds);
        }
        const mode = modes[i]!;
        if (mode === 'tunnel') {
          tunnels++;
          portals.push(
            {
              type: 'Feature',
              id: `portal-${portals.length}`,
              geometry: { type: 'Point', coordinates: coords[0]! },
              properties: { kind: 'tunnelPortal' },
            },
            {
              type: 'Feature',
              id: `portal-${portals.length + 1}`,
              geometry: { type: 'Point', coordinates: coords[coords.length - 1]! },
              properties: { kind: 'tunnelPortal' },
            },
          );
        }
        if (mode === 'viaduct' || mode === 'elevated') viaducts++;
        tracks.push({
          type: 'Feature',
          id: `rail-${tracks.length}`,
          geometry: { type: 'LineString', coordinates: coords },
          properties: { class: cls, mode, line: lineId, from, to, lengthKm: len / 1000, gradient: grad },
        });
        stats.trackKm += len / 1000;
        if (cls === 'mainline') stats.mainlineKm += len / 1000;
        else if (cls === 'branch') stats.branchKm += len / 1000;
        else if (cls === 'spur') stats.spurKm += len / 1000;
        else if (cls === 'yard') stats.yardKm += len / 1000;
        else stats.disusedKm += len / 1000;
        stats.maxGradient = Math.max(stats.maxGradient, grad);
        i = end;
      }
      if (cls === 'mainline' || cls === 'branch')
        stats.minRadiusM = Math.min(stats.minRadiusM, minRadiusOf(pts));
      if (cls === 'mainline' || cls === 'branch') {
        for (let k = 0; k < pts.length; k += Math.max(1, Math.round(250 / (cellSizeM * 0.5)))) {
          if (modes[k] !== 'subway' && modes[k] !== 'tunnel')
            nuisance.push([pts[k]![0], pts[k]![1], 220, 0.25]);
        }
      }
      return pts;
    };

    // Lines between served sites.
    const routedLines: { a: number; b: number; pts: Ring; cls: TrackClass }[] = [];
    for (const [a, b] of links) {
      const sa = served[a]!;
      const sb = served[b]!;
      const big = sa.population >= 3000 && sb.population >= 3000;
      const cls: TrackClass = !isActive(sa) || !isActive(sb) ? 'disused' : big ? 'mainline' : 'branch';
      const line = route(stationOf.get(sa.id)!, stationOf.get(sb.id)!, cls, new Set([a, b]));
      if (!line) continue;
      const pts = pushTrack(line, cls, `${sa.id}-${sb.id}`, sa.id, sb.id);
      routedLines.push({ a, b, pts, cls });
      ctx.checkpoint();
    }
    // Mainlines out to the region edge from the hub.
    const hubStation = stationOf.get(hub.id)!;
    const hubN = neighbours.get(0) ?? [];
    let base = 0;
    if (hubN.length) {
      const o = served[hubN[0]!]!;
      base = Math.atan2(o.center[1] - hub.center[1], o.center[0] - hub.center[0]) + Math.PI;
    }
    const exits: Pt[] = [];
    for (let i = 0; i < Math.min(4, Math.max(0, Math.round(input.mainlines))); i++) {
      const angle = base + (i * Math.PI) / Math.max(1, Math.round(input.mainlines));
      for (const side of i === 0 && hubN.length ? [0] : [0, Math.PI]) {
        for (const jitter of [0, 0.25, -0.25, 0.5, -0.5]) {
          const a = angle + side + jitter;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          // Intersect the ray with the region rectangle.
          const tx = dx !== 0 ? (Math.sign(dx) * (halfW - cellSizeM * 2) - hubStation[0]) / dx : Infinity;
          const ty = dy !== 0 ? (Math.sign(dy) * (halfH - cellSizeM * 2) - hubStation[1]) / dy : Infinity;
          const t = Math.min(tx, ty);
          const target: Pt = [hubStation[0] + dx * t, hubStation[1] + dy * t];
          if (!landAt(target)) continue;
          if (exits.some((e) => Math.hypot(e[0] - target[0], e[1] - target[1]) < 3000)) continue;
          exits.push(target);
          break;
        }
      }
    }
    exits.forEach((target, k) => {
      const line = route(hubStation, target, 'mainline', new Set([0]));
      if (line) {
        const pts = pushTrack(line, 'mainline', `${hub.id}-edge${k}`, hub.id, 'edge');
        routedLines.push({ a: 0, b: -1, pts, cls: 'mainline' });
      }
      ctx.checkpoint();
    });

    // --- 5. Stations ---------------------------------------------------------------------
    const suburbanEvery = year < 1925 ? 1500 : 2000;
    served.forEach((s, i) => {
      const p = stationOf.get(s.id)!;
      const closed = !isActive(s);
      const kind: StationKind = s.population >= 6000 ? 'central' : s.population >= 1500 ? 'town' : 'halt';
      const lineIds = routedLines.filter((l) => l.a === i || l.b === i);
      stations.push({
        type: 'Feature',
        id: `station-${s.id}`,
        geometry: { type: 'Point', coordinates: p },
        properties: {
          kind,
          settlement: s.id,
          ...(s.name ? { name: kind === 'central' ? `${s.name} Central` : s.name } : {}),
          line: lineIds[0]
            ? lineIds[0].b >= 0
              ? `${served[lineIds[0].a]!.id}-${served[lineIds[0].b]!.id}`
              : `${s.id}-edge`
            : s.id,
          closed,
        },
      });
      // Suburban stations along each line while still inside the built-up area.
      if (year >= 1880 && s.radiusM >= 1200 && !closed) {
        for (const l of lineIds) {
          const pts = l.a === i ? l.pts : [...l.pts].reverse();
          let acc = 0;
          let next = suburbanEvery;
          let n = 0;
          for (let k = 1; k < pts.length; k++) {
            acc += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
            const d = Math.hypot(pts[k]![0] - s.center[0], pts[k]![1] - s.center[1]);
            if (d > s.radiusM * 1.15) break;
            if (acc >= next) {
              next += suburbanEvery;
              stations.push({
                type: 'Feature',
                id: `station-${s.id}-sub-${l.b}-${n++}`,
                geometry: { type: 'Point', coordinates: pts[k]! },
                properties: {
                  kind: 'suburban',
                  settlement: s.id,
                  line: `${s.id}-${l.b >= 0 ? served[l.b]!.id : 'edge'}`,
                  closed: false,
                },
              });
            }
          }
        }
      }
    });

    // --- 6. Yards, sheds and spurs beside the big stations ---------------------------------
    const yardHost = (s: SettlementSite, i: number) => {
      const lines = routedLines.filter((l) => (l.a === i || l.b === i) && l.cls !== 'disused');
      if (!lines.length) return null;
      // Prefer the line heading downwind (industry side); otherwise the first.
      let best = lines[0]!;
      let bestScore = -Infinity;
      for (const l of lines) {
        const pts = l.a === i ? l.pts : [...l.pts].reverse();
        const q = pts[Math.min(pts.length - 1, 12)]!;
        const score = (q[0] - s.center[0]) * downwind[0] + (q[1] - s.center[1]) * downwind[1];
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      return best.a === i ? best.pts : [...best.pts].reverse();
    };
    /** Point and unit tangent at distance `d` along a polyline. */
    const along = (pts: Ring, d: number): { p: Pt; t: Pt } | null => {
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc + seg >= d && seg > 0) {
          const u = (d - acc) / seg;
          return {
            p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
            t: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg],
          };
        }
        acc += seg;
      }
      return null;
    };
    const lengthOf = (pts: Ring) => {
      let l = 0;
      for (let k = 1; k < pts.length; k++)
        l += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
      return l;
    };
    const band = (pts: Ring, s0: number, s1: number, o0: number, o1: number, side: number): Ring | null => {
      const left: Ring = [];
      const right: Ring = [];
      for (let d = s0; d <= s1 + 1e-6; d += Math.max(10, (s1 - s0) / 12)) {
        const a = along(pts, Math.min(d, s1));
        if (!a) return null;
        const nx = -a.t[1] * side;
        const ny = a.t[0] * side;
        left.push([a.p[0] + nx * o0, a.p[1] + ny * o0]);
        right.push([a.p[0] + nx * o1, a.p[1] + ny * o1]);
      }
      const ring: Ring = [...left, ...right.reverse()];
      if (!ring.every(landAt)) return null;
      ring.push(ring[0]!);
      return ring;
    };
    const pushStructure = (ring: Ring, kind: StructureKind, settlement: string) =>
      structures.push({
        type: 'Feature',
        id: `structure-${structures.length}`,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { kind, settlement },
      });
    const rect = (c: Pt, t: Pt, len: number, wid: number): Ring => {
      const nx = -t[1];
      const ny = t[0];
      const hx = (t[0] * len) / 2;
      const hy = (t[1] * len) / 2;
      const wx = (nx * wid) / 2;
      const wy = (ny * wid) / 2;
      return [
        [c[0] - hx - wx, c[1] - hy - wy],
        [c[0] + hx - wx, c[1] + hy - wy],
        [c[0] + hx + wx, c[1] + hy + wy],
        [c[0] - hx + wx, c[1] - hy + wy],
        [c[0] - hx - wx, c[1] - hy - wy],
      ];
    };
    const circle = (c: Pt, r: number, n = 20): Ring => {
      const out: Ring = [];
      for (let k = 0; k < n; k++)
        out.push([c[0] + Math.cos((k / n) * Math.PI * 2) * r, c[1] + Math.sin((k / n) * Math.PI * 2) * r]);
      out.push(out[0]!);
      return out;
    };

    served.forEach((s, i) => {
      if (!isActive(s) || s.population < 1500) return;
      const host = yardHost(s, i);
      if (!host) return;
      const total = lengthOf(host);
      const pop = Math.min(s.population, 200_000);
      // Side of the line away from the town centre.
      const probe = along(host, Math.min(total - 1, 200));
      if (!probe) return;
      const nx = -probe.t[1];
      const ny = probe.t[0];
      const side = (probe.p[0] - s.center[0]) * nx + (probe.p[1] - s.center[1]) * ny >= 0 ? 1 : -1;
      const pick = (s0: number, s1: number, o0: number, o1: number) =>
        band(host, s0, s1, o0, o1, side) ?? band(host, s0, s1, o0, o1, -side);

      // The yard goes where the ground is low, flat and by the river when the line offers such a
      // stretch within reach of the station: the floodplain, not the hill.
      let cursor = 120;
      {
        const hCentre = height.sample(s.center[0], s.center[1]);
        let bestScore = -Infinity;
        for (let d = 120; d <= Math.min(total - 400, 900); d += 40) {
          const at = along(host, d);
          if (!at) break;
          const [c, r] = cellAt(terrain, at.p[0], at.p[1]);
          const i = r * width + c;
          const score =
            -Math.max(0, height.data[i]! - hCentre) / 8 -
            terrain.slope[i]! * 15 +
            (terrain.distToWater[i]! < 300 ? 0.6 : 0) -
            d / 3000;
          if (score > bestScore) {
            bestScore = score;
            cursor = d;
          }
        }
      }
      // Goods yard (1840–1965) or a smaller freight depot later.
      if (year < 1965 || s.population >= 20_000) {
        const L = 220 + Math.min(pop, 100_000) / 400;
        const W = 40 + Math.min(pop, 100_000) / 2500;
        if (cursor + L < total) {
          const ring = pick(cursor, cursor + L, 14, 14 + W);
          if (ring) {
            pushStructure(ring, 'goodsYard', s.id);
            nuisance.push([ring[0]![0], ring[0]![1], 350, 0.4]);
            cursor += L + 80;
          }
        }
      }
      // Marshalling yard with ladder tracks for cities.
      if (s.population >= 20_000 && year >= 1850) {
        const Ly = 400 + Math.min(pop, 200_000) / 500;
        const T = 140;
        const n = 4 + Math.floor(Math.min(pop, 200_000) / 25_000);
        if (cursor + Ly + 2 * T < total) {
          const start = along(host, cursor)!;
          const end = along(host, cursor + Ly + 2 * T)!;
          const throatSide = band(host, cursor + T, cursor + T + Ly, 6, 6 * n + 6, side) ? side : -side;
          let ok = true;
          const yardLines: Ring[] = [];
          for (let k = 1; k <= n; k++) {
            const o = 6 * k;
            const a = along(host, cursor + 8 * (k - 1))!;
            const b = along(host, cursor + T)!;
            const c = along(host, cursor + T + Ly)!;
            const d = along(host, cursor + Ly + 2 * T - 8 * (k - 1))!;
            const off = (q: { p: Pt; t: Pt }): Pt => [
              q.p[0] - q.t[1] * throatSide * o,
              q.p[1] + q.t[0] * throatSide * o,
            ];
            const line: Ring = [a.p, off(b), off(c), d.p];
            if (!line.every(landAt)) ok = false;
            yardLines.push(line);
          }
          if (ok) {
            yardLines.forEach((line, k) => {
              const len = lengthOf(line);
              tracks.push({
                type: 'Feature',
                id: `rail-${tracks.length}`,
                geometry: { type: 'LineString', coordinates: line },
                properties: {
                  class: 'yard',
                  mode: 'surface',
                  line: `${s.id}-yard`,
                  from: `${s.id}-throat-a`,
                  to: `${s.id}-throat-b`,
                  lengthKm: len / 1000,
                  gradient: 0,
                },
              });
              stats.trackKm += len / 1000;
              stats.yardKm += len / 1000;
              void k;
            });
            const outline = band(host, cursor, cursor + Ly + 2 * T, 3, 6 * n + 12, throatSide);
            if (outline) pushStructure(outline, 'railYard', s.id);
            stats.yards++;
            nuisance.push([(start.p[0] + end.p[0]) / 2, (start.p[1] + end.p[1]) / 2, 500, 0.6]);
            // Locomotive facilities beside the yard's far end.
            const mid = along(host, cursor + T + Ly * 0.7)!;
            const fx = -mid.t[1] * throatSide;
            const fy = mid.t[0] * throatSide;
            const base: Pt = [mid.p[0] + fx * (6 * n + 60), mid.p[1] + fy * (6 * n + 60)];
            if (year < 1960) {
              if (landAt(base)) {
                pushStructure(circle(base, 12, 16), 'turntable', s.id);
                // Roundhouse: an annular sector facing away from the line.
                const a0 = Math.atan2(fy, fx) - Math.PI * 0.45;
                const a1 = Math.atan2(fy, fx) + Math.PI * 0.45;
                const inner: Ring = [];
                const outer: Ring = [];
                for (let k = 0; k <= 10; k++) {
                  const a = a0 + ((a1 - a0) * k) / 10;
                  inner.push([base[0] + Math.cos(a) * 24, base[1] + Math.sin(a) * 24]);
                  outer.push([base[0] + Math.cos(a) * 52, base[1] + Math.sin(a) * 52]);
                }
                const ring: Ring = [...inner, ...outer.reverse()];
                ring.push(ring[0]!);
                if (ring.every(landAt)) pushStructure(ring, 'roundhouse', s.id);
                const coal = along(host, cursor + T + Ly * 0.4)!;
                const cb: Pt = [coal.p[0] + fx * (6 * n + 30), coal.p[1] + fy * (6 * n + 30)];
                if (landAt(cb)) pushStructure(rect(cb, coal.t, 34, 10), 'coaling', s.id);
                const wt: Pt = [coal.p[0] + fx * (6 * n + 48), coal.p[1] + fy * (6 * n + 48)];
                if (landAt(wt)) pushStructure(circle(wt, 4, 10), 'waterTower', s.id);
              }
            } else if (landAt(base)) {
              pushStructure(rect(base, mid.t, 130, 42), 'depot', s.id);
            }
            if (year >= 1970 && (s.population >= 30_000 || s.kind === 'portTown' || s.coastal)) {
              const im = along(host, cursor + T + Ly * 0.3)!;
              const ic: Pt = [im.p[0] + fx * (6 * n + 130), im.p[1] + fy * (6 * n + 130)];
              const ring = rect(ic, im.t, 260, 70);
              if (ring.every(landAt)) pushStructure(ring, 'intermodal', s.id);
            }
            cursor += Ly + 2 * T + 60;
          }
        }
      }
      ctx.checkpoint();

      // Freight spurs: to the docks of ports and to the downwind (industrial) edge of cities.
      const spurFrom = along(host, Math.min(total - 1, cursor))?.p ?? stationOf.get(s.id)!;
      const spurs: { target: Pt; id: string }[] = [];
      if ((s.kind === 'portTown' || (s.coastal && s.population >= 5000)) && year >= 1850) {
        // Nearest shore point around the town.
        // Land cells nearest the sea around the town; among those, the closest to the yard.
        let best: { p: Pt; score: number } | null = null;
        for (let k = 0; k < 36; k++) {
          for (let rr = 0.4; rr <= 1.6; rr += 0.1) {
            const a = (k / 36) * Math.PI * 2;
            const p: Pt = [
              s.center[0] + Math.cos(a) * s.radiusM * rr,
              s.center[1] + Math.sin(a) * s.radiusM * rr,
            ];
            const [c, r] = cellAt(terrain, p[0], p[1]);
            const idx = r * width + c;
            const dSea = terrain.distToSea[idx]!;
            if (water[idx] !== WATER.land || dSea > 400) continue;
            // A quay some way along the shore: near the sea, 350–900 m from the yard.
            const d = Math.hypot(p[0] - spurFrom[0], p[1] - spurFrom[1]);
            const score = dSea * 4 + Math.max(0, 350 - d) * 3 + Math.max(0, d - 900);
            if (!best || score < best.score) best = { p, score };
          }
        }
        if (best) spurs.push({ target: best.p, id: `${s.id}-docks` });
      }
      if (s.population >= 15_000 && year >= 1850 && year < 1995) {
        // The industrial edge: downwind of the centre, the first candidate on land.
        const baseAngle = Math.atan2(downwind[1], downwind[0]);
        let target: Pt | null = null;
        for (const rr of [0.95, 0.75, 1.1]) {
          for (const da of [0, 0.35, -0.35, 0.7, -0.7]) {
            const a = baseAngle + da;
            const p: Pt = [
              s.center[0] + Math.cos(a) * s.radiusM * rr,
              s.center[1] + Math.sin(a) * s.radiusM * rr,
            ];
            if (landAt(p)) {
              target = p;
              break;
            }
          }
          if (target) break;
        }
        if (target) spurs.push({ target, id: `${s.id}-industry` });
      }
      for (const sp of spurs) {
        if (Math.hypot(sp.target[0] - spurFrom[0], sp.target[1] - spurFrom[1]) < 150) continue;
        const line = route(spurFrom, sp.target, 'spur', new Set([i]));
        if (line) pushTrack(line, 'spur', sp.id, s.id, sp.id);
        ctx.checkpoint();
      }
    });

    // Keep the nuisance list bounded for the society stage.
    while (nuisance.length > 240) {
      for (let k = nuisance.length - 1; k >= 0; k -= 2) nuisance.splice(k, 1);
    }
    void rng;
    stats.stations = stations.length;
    stats.tunnels = tunnels;
    stats.viaducts = viaducts;
    return {
      key: ctx.key,
      tracks: { type: 'FeatureCollection', features: tracks },
      stations: { type: 'FeatureCollection', features: stations },
      structures: { type: 'FeatureCollection', features: structures },
      portals: { type: 'FeatureCollection', features: portals },
      nuisance,
      stats,
    };
  },
});
