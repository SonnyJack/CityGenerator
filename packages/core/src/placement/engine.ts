import type { Feature, LineString, Point, Polygon } from 'geojson';
import { Rng } from '../random/rng.js';
import type { Ring } from '../raster/contours.js';
import { pointInRing } from '../geometry/polygon.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import { landSampler } from '../terrain/land.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { RailOutput } from '../networks/rail.js';
import type {
  CandidateInfo,
  FeatureType,
  Frame,
  HostSite,
  LocalPart,
  PartFeature,
  PlacedFeature,
  PlacementContext,
  PlacementFailure,
  PlacementRequest,
  Pt,
} from './types.js';

/** Corners of a frame as a closed ring. */
export function frameRing(f: Frame): Ring {
  const [ax, ay] = f.axis;
  const nx = -ay;
  const ny = ax;
  const hl = f.lengthM / 2;
  const hw = f.widthM / 2;
  const c = f.center;
  const ring: Ring = [
    [c[0] - ax * hl - nx * hw, c[1] - ay * hl - ny * hw],
    [c[0] + ax * hl - nx * hw, c[1] + ay * hl - ny * hw],
    [c[0] + ax * hl + nx * hw, c[1] + ay * hl + ny * hw],
    [c[0] - ax * hl + nx * hw, c[1] - ay * hl + ny * hw],
  ];
  ring.push(ring[0]!);
  return ring;
}

/** Local (u, v) → world. */
export function toWorld(f: Frame, u: number, v: number): Pt {
  const [ax, ay] = f.axis;
  return [f.center[0] + ax * u - ay * v, f.center[1] + ay * u + ax * v];
}

function frameSamples(f: Frame): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) out.push(toWorld(f, (i / 4 - 0.5) * f.lengthM, (j / 4 - 0.5) * f.widthM));
  return out;
}

function candidateInfo(frame: Frame, host: HostSite | null, ctx: PlacementContext): CandidateInfo {
  return {
    frame,
    samples: frameSamples(frame),
    edges: [
      toWorld(frame, frame.lengthM / 2, 0),
      toWorld(frame, -frame.lengthM / 2, 0),
      toWorld(frame, 0, frame.widthM / 2),
      toWorld(frame, 0, -frame.widthM / 2),
    ],
    host,
    ctx,
  };
}

/** Two frames overlap when a corner or the centre of one lies in the other. */
export function framesOverlap(a: Frame, b: Frame): boolean {
  const ra = frameRing(a);
  const rb = frameRing(b);
  const test = (pts: Ring, ring: Ring) => pts.some((p) => pointInRing(p[0], p[1], ring));
  return (
    test([...ra.slice(0, 4), a.center], rb) ||
    test([...rb.slice(0, 4), b.center], ra) ||
    // Long thin frames crossing: check edge midpoints too.
    test(
      frameSamples(a).filter((_, i) => i % 3 === 0),
      rb,
    )
  );
}

/** Build the raster-backed context shared by every request. */
export function createContext(
  terrain: TerrainOutput,
  sites: SettlementSite[],
  rail: RailOutput | null,
  year: number,
  windFrom: number,
): PlacementContext {
  const onLand = landSampler(terrain, { rivers: 'land', aboveSea: false });
  const { height, water, slope, distToSea, distToWater } = terrain;
  const { width, height: rows, cellSizeM } = height;
  const idx = (x: number, y: number) => {
    const c = Math.min(Math.max(Math.round(height.col(x)), 0), width - 1);
    const r = Math.min(Math.max(Math.round(height.row(y)), 0), rows - 1);
    return r * width + c;
  };
  const inside = (x: number, y: number) =>
    Math.abs(x) <= ((width - 1) * cellSizeM) / 2 && Math.abs(y) <= ((rows - 1) * cellSizeM) / 2;
  // Track segments in a coarse grid for distance queries.
  const cell = 500;
  const grid = new Map<string, { a: Pt; b: Pt }[]>();
  if (rail) {
    for (const t of rail.tracks.features) {
      if (t.properties.class === 'yard' || t.properties.mode === 'subway' || t.properties.mode === 'tunnel')
        continue;
      const c = t.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const a: Pt = [c[i - 1]![0]!, c[i - 1]![1]!];
        const b: Pt = [c[i]![0]!, c[i]![1]!];
        for (
          let gx = Math.floor(Math.min(a[0], b[0]) / cell) - 1;
          gx <= Math.floor(Math.max(a[0], b[0]) / cell) + 1;
          gx++
        )
          for (
            let gy = Math.floor(Math.min(a[1], b[1]) / cell) - 1;
            gy <= Math.floor(Math.max(a[1], b[1]) / cell) + 1;
            gy++
          ) {
            const k = `${gx},${gy}`;
            (grid.get(k) ?? grid.set(k, []).get(k)!).push({ a, b });
          }
      }
    }
  }
  const nearestTrack = (x: number, y: number): { d: number; t: Pt } | null => {
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    let best: { d: number; t: Pt } | null = null;
    for (const s of grid.get(k) ?? []) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (y - s.a[1]) * dy) / len2)) : 0;
      const d = Math.hypot(x - (s.a[0] + dx * u), y - (s.a[1] + dy * u));
      if (!best || d < best.d) {
        const len = Math.sqrt(len2) || 1;
        best = { d, t: [dx / len, dy / len] };
      }
    }
    return best;
  };
  const rivers = terrain.riverLines.features;
  const riverTangent = (x: number, y: number): Pt | null => {
    let best: { d: number; t: Pt } | null = null;
    for (const r of rivers) {
      const c = r.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const ax = c[i - 1]![0]!;
        const ay = c[i - 1]![1]!;
        const bx = c[i]![0]!;
        const by = c[i]![1]!;
        if (Math.abs(ax - x) > 1500 || Math.abs(ay - y) > 1500) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const u = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const d = Math.hypot(x - (ax + dx * u), y - (ay + dy * u));
        if (!best || d < best.d) {
          const len = Math.sqrt(len2) || 1;
          best = { d, t: [dx / len, dy / len] };
        }
      }
    }
    return best && best.d < 2000 ? best.t : null;
  };
  return {
    terrain,
    year,
    sites,
    rail,
    windFrom,
    placed: [],
    isLand: (x, y) => inside(x, y) && onLand(x, y),
    isSea: (x, y) => inside(x, y) && water[idx(x, y)] === WATER.sea,
    isWater: (x, y) => !inside(x, y) || water[idx(x, y)] !== WATER.land,
    slopeAt: (x, y) => slope[idx(x, y)]!,
    elevationAt: (x, y) => height.data[idx(x, y)]! - terrain.seaLevel,
    distToSea: (x, y) => distToSea[idx(x, y)]!,
    distToWater: (x, y) => distToWater[idx(x, y)]!,
    seaFraction: (x, y, r) => {
      let n = 0;
      let sea = 0;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        for (const rr of [0.5, 1]) {
          n++;
          if (!inside(x + Math.cos(a) * r * rr, y + Math.sin(a) * r * rr)) continue;
          if (water[idx(x + Math.cos(a) * r * rr, y + Math.sin(a) * r * rr)] === WATER.sea) sea++;
        }
      }
      return sea / n;
    },
    distToRail: (x, y) => nearestTrack(x, y)?.d ?? Infinity,
    railTangent: (x, y) => nearestTrack(x, y)?.t ?? null,
    coastTangent: (x, y) => {
      const d = cellSizeM * 2;
      const gx = (distToSea[idx(x + d, y)]! - distToSea[idx(x - d, y)]!) / (2 * d);
      const gy = (distToSea[idx(x, y + d)]! - distToSea[idx(x, y - d)]!) / (2 * d);
      const len = Math.hypot(gx, gy);
      if (len < 1e-6) return null;
      // Gradient points away from the sea; the tangent is perpendicular.
      return [-gy / len, gx / len];
    },
    riverTangent,
  };
}

export interface PlaceResult {
  placed: PlacedFeature[];
  parts: PartFeature[];
  failures: PlacementFailure[];
  nuisance: [number, number, number, number][];
  /** Rail connector requests: from the feature's rail edge. */
  railConnectors: { feature: string; from: Pt; settlement: string | null }[];
  roadConnectors: { feature: string; from: Pt; settlement: string | null }[];
}

export interface PlaceOptions {
  seed: string;
  types: Map<string, FeatureType>;
  scaleCompression: boolean;
  hosts: Map<string, HostSite>;
  /** Region extent for region-level sampling. */
  extent: { widthM: number; heightM: number };
}

function normalise(v: Pt): Pt {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Place every request in order: pinned first, then largest footprints first. */
export function placeFeatures(
  ctx: PlacementContext,
  requests: PlacementRequest[],
  options: PlaceOptions,
): PlaceResult {
  const result: PlaceResult = {
    placed: [],
    parts: [],
    failures: [],
    nuisance: [],
    railConnectors: [],
    roadConnectors: [],
  };
  const rng = new Rng(`${options.seed}/placement`);
  const ordered = [...requests].sort((a, b) => {
    if (!!a.pin !== !!b.pin) return a.pin ? -1 : 1;
    const ta = options.types.get(a.type);
    const tb = options.types.get(b.type);
    const areaOf = (t: FeatureType | undefined, size: PlacementRequest['size']) => {
      if (!t) return 0;
      const [l, w] = t.footprint(size, { population: 0, year: ctx.year });
      return l * w;
    };
    return areaOf(tb, b.size) - areaOf(ta, a.size) || (a.id < b.id ? -1 : 1);
  });

  for (const req of ordered) {
    const type = options.types.get(req.type);
    const host = req.settlement ? (options.hosts.get(req.settlement) ?? null) : null;
    const fail = (reason: string) =>
      result.failures.push({ id: req.id, type: req.type, settlement: req.settlement ?? null, reason });
    if (!type) {
      fail(`unknown feature type "${req.type}"`);
      continue;
    }
    if (ctx.year < type.years[0] || ctx.year > type.years[1]) {
      fail(`${type.name} is not built in ${ctx.year} (available ${type.years[0]}–${type.years[1]})`);
      continue;
    }
    if (type.level === 'settlement' && !host) {
      fail(`${type.name} needs a settlement to belong to`);
      continue;
    }
    const population = host?.site.population ?? 0;
    const [realL, realW] = type.footprint(req.size, { population, year: ctx.year });
    const compression = options.scaleCompression
      ? (type.scaleCompression ?? (Math.max(realL, realW) > 300 ? 0.6 : 1))
      : 1;
    const reqRng = rng.fork(req.id);

    let outcome: PlacedFeature['outcome'] = 'placed';
    let chosen: { frame: Frame; front: 'sea' | 'rail' | 'town' | 'none' } | null = null;
    let lastReason = 'no site passed the constraints';

    if (req.pin) {
      const axis: Pt = [Math.cos(req.pin.rotation), Math.sin(req.pin.rotation)];
      const frame: Frame = {
        center: [req.pin.x, req.pin.y],
        axis,
        lengthM: realL * compression,
        widthM: realW * compression,
      };
      const info = candidateInfo(frame, host, ctx);
      const problems = type.hard.map((h) => h(info)).filter((r): r is string => !!r);
      // Pinned features are honoured; problems are reported as warnings through the failure list.
      if (problems.length) fail(`pinned ${type.name} kept although ${problems[0]}`);
      chosen = { frame, front: frontOf(type, frame, ctx) };
    } else {
      // Degrade in steps: full size, shrunk, shrunk and relaxed, then half size searched
      // farther out (small islands and cramped valleys), before reporting a failure.
      for (let attempt = 0; attempt < 4 && !chosen; attempt++) {
        const shrink = attempt === 0 ? 1 : attempt === 1 ? 0.8 : attempt === 2 ? 0.65 : 0.5;
        const L = realL * compression * shrink;
        const W = realW * compression * shrink;
        const relaxed = attempt >= 2;
        const best = search(
          type,
          req,
          host,
          ctx,
          L,
          W,
          reqRng.fork(`attempt${attempt}`),
          options,
          relaxed,
          attempt === 3 ? 1.7 : 1,
        );
        if (best.frame) {
          chosen = { frame: best.frame, front: frontOf(type, best.frame, ctx) };
          outcome = attempt === 0 ? 'placed' : relaxed ? 'relaxed' : 'shrunk';
        } else lastReason = best.reason;
      }
    }
    if (!chosen) {
      fail(
        `could not place ${type.name}${host ? ` at ${host.site.name ?? host.site.id}` : ''}: ${lastReason}`,
      );
      continue;
    }
    const { frame, front } = chosen;
    ctx.placed.push(frame);
    const ring = frameRing(frame);
    const placed: PlacedFeature = {
      id: req.id,
      type: type.id,
      name: type.name,
      category: type.category,
      settlement: req.settlement ?? null,
      size: req.size,
      frame,
      ring,
      realLengthM: realL,
      realWidthM: realW,
      compression: frame.lengthM / realL,
      ward: type.ward,
      pinned: !!req.pin,
      outcome,
    };
    result.placed.push(placed);
    // Layout parts.
    const parts = type.layout({
      size: req.size,
      year: ctx.year,
      lengthM: frame.lengthM,
      widthM: frame.widthM,
      compression: frame.lengthM / realL,
      rng: reqRng.fork('layout'),
      host,
      front,
    });
    parts.forEach((p, k) => result.parts.push(partToFeature(p, frame, placed, k)));
    if (type.nuisance)
      result.nuisance.push([
        frame.center[0],
        frame.center[1],
        type.nuisance.radiusM * Math.sqrt(compression),
        type.nuisance.strength,
      ]);
    // Connectors from the edge facing the rail / the town.
    const info = candidateInfo(frame, host, ctx);
    if (type.connectors?.rail && ctx.rail && ctx.rail.tracks.features.length) {
      const railEdge = info.edges.reduce(
        (b, e) => (ctx.distToRail(e[0], e[1]) < ctx.distToRail(b[0], b[1]) ? e : b),
        info.edges[0],
      );
      result.railConnectors.push({ feature: req.id, from: railEdge, settlement: req.settlement ?? null });
    }
    if (type.connectors?.road && host) {
      const c = host.site.center;
      const townEdge = info.edges.reduce(
        (b, e) => (Math.hypot(e[0] - c[0], e[1] - c[1]) < Math.hypot(b[0] - c[0], b[1] - c[1]) ? e : b),
        info.edges[0],
      );
      result.roadConnectors.push({ feature: req.id, from: townEdge, settlement: req.settlement ?? null });
    }
  }
  return result;
}

function frontOf(type: FeatureType, frame: Frame, ctx: PlacementContext): 'sea' | 'rail' | 'town' | 'none' {
  if (type.orientation === 'alignCoast' || type.orientation === 'alignRiver') return 'sea';
  if (type.orientation === 'alignRail') return 'rail';
  if (type.orientation === 'alignRadial') return 'town';
  void frame;
  void ctx;
  return 'none';
}

interface SearchResult {
  frame: Frame | null;
  reason: string;
}

function search(
  type: FeatureType,
  req: PlacementRequest,
  host: HostSite | null,
  ctx: PlacementContext,
  L: number,
  W: number,
  rng: Rng,
  options: PlaceOptions,
  relaxed: boolean,
  reach = 1,
): SearchResult {
  // Candidate centres: shore or river points for water-fronted types, else an
  // annulus around the host, or a grid over the region.
  const centres: Pt[] = [];
  if (host && type.orientation === 'alignCoast') centres.push(...shoreCandidates(host, ctx, W));
  else if (host && type.orientation === 'alignRiver') centres.push(...riverCandidates(host, ctx, W));
  else if (host) {
    const R = host.site.radiusM;
    const [r0, r1raw] = type.radial ?? [0.4, 1.8];
    const r1 = r1raw * reach;
    const n = reach > 1 ? 480 : 320;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const r = R * Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * ((i + 0.5) / n));
      const a = i * golden + rng.range(-0.1, 0.1);
      centres.push([host.site.center[0] + Math.cos(a) * r, host.site.center[1] + Math.sin(a) * r]);
    }
  } else {
    const { widthM, heightM } = options.extent;
    const step = Math.max(300, Math.sqrt((widthM * heightM) / 600));
    for (let y = -heightM / 2 + step; y < heightM / 2; y += step)
      for (let x = -widthM / 2 + step; x < widthM / 2; x += step)
        centres.push([x + rng.range(-step, step) * 0.3, y + rng.range(-step, step) * 0.3]);
  }
  if (req.hint) centres.push(req.hint);

  let best: { frame: Frame; score: number } | null = null;
  const reasons = new Map<string, number>();
  for (const c of centres) {
    const axes = orientationsFor(type, c, ctx, host);
    for (const axis of axes) {
      const frame: Frame = { center: c, axis, lengthM: L, widthM: W };
      const info = candidateInfo(frame, host, ctx);
      let reason: string | null = null;
      for (const h of type.hard) {
        reason = h(info);
        if (reason) break;
      }
      if (reason) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      if (ctx.placed.some((p) => framesOverlap(p, frame))) {
        reasons.set('overlaps another facility', (reasons.get('overlaps another facility') ?? 0) + 1);
        continue;
      }
      let score = 0;
      for (const s of type.soft) score += s.weight * s.score(info) * (relaxed ? 0.5 : 1);
      if (req.hint) score -= Math.hypot(c[0] - req.hint[0], c[1] - req.hint[1]) / 400;
      score += rng.range(0, 0.05);
      if (!best || score > best.score) best = { frame, score };
    }
  }
  if (best) return { frame: best.frame, reason: '' };
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  return { frame: null, reason: top ? top[0] : 'no candidate sites' };
}

/** Points just inland of the shore around a settlement, one per ray that reaches the sea. */
function shoreCandidates(host: HostSite, ctx: PlacementContext, W: number): Pt[] {
  const out: Pt[] = [];
  const R = host.site.radiusM;
  const [cx, cy] = host.site.center;
  const step = Math.max(20, ctx.terrain.height.cellSizeM);
  for (let k = 0; k < 144; k++) {
    const a = (k / 144) * Math.PI * 2;
    let prev: Pt | null = null;
    for (let r = R * 0.15; r <= R * 2.4; r += step) {
      const p: Pt = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      if (ctx.isSea(p[0], p[1])) {
        if (prev) {
          // Pull the centre inland by half the width along the sea gradient.
          const t = ctx.coastTangent(prev[0], prev[1]);
          const inward: Pt = t ? [t[1], -t[0]] : [-Math.cos(a), -Math.sin(a)];
          // Ensure "inward" points away from the sea.
          const sign =
            ctx.distToSea(prev[0] + inward[0] * step * 2, prev[1] + inward[1] * step * 2) >=
            ctx.distToSea(prev[0], prev[1])
              ? 1
              : -1;
          for (const back of [W / 2 - 8, W / 2 + 25])
            out.push([prev[0] + inward[0] * sign * back, prev[1] + inward[1] * sign * back]);
        }
        break;
      }
      if (ctx.isLand(p[0], p[1])) prev = p;
    }
  }
  return out;
}

/** Points beside the rivers within reach of a settlement, on both banks. */
function riverCandidates(host: HostSite, ctx: PlacementContext, W: number): Pt[] {
  const out: Pt[] = [];
  const R = host.site.radiusM;
  const [cx, cy] = host.site.center;
  for (const river of ctx.terrain.riverLines.features) {
    const c = river.geometry.coordinates;
    for (let i = 1; i < c.length; i += 2) {
      const x = c[i]![0]!;
      const y = c[i]![1]!;
      if (Math.hypot(x - cx, y - cy) > Math.max(R * 2.4, 1800)) continue;
      const dx = x - c[i - 1]![0]!;
      const dy = y - c[i - 1]![1]!;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const off = W / 2 + river.properties.widthM / 2 + 6;
      for (const side of [1, -1]) {
        const p: Pt = [x + nx * side * off, y + ny * side * off];
        if (ctx.isLand(p[0], p[1])) out.push(p);
      }
    }
  }
  return out;
}

function orientationsFor(type: FeatureType, c: Pt, ctx: PlacementContext, host: HostSite | null): Pt[] {
  switch (type.orientation) {
    case 'alignCoast': {
      const t = ctx.coastTangent(c[0], c[1]);
      return t ? [t, [-t[0], -t[1]]] : [];
    }
    case 'alignRiver': {
      const t = ctx.riverTangent(c[0], c[1]);
      return t ? [t, [-t[0], -t[1]]] : [];
    }
    case 'alignRail': {
      const t = ctx.railTangent(c[0], c[1]);
      if (t) return [t];
      return [
        [1, 0],
        [0, 1],
      ];
    }
    case 'alignRadial': {
      if (!host) return [[1, 0]];
      const r = normalise([c[0] - host.site.center[0], c[1] - host.site.center[1]]);
      // Long side tangential to the town (the front faces the centre).
      return [[-r[1], r[0]]];
    }
    case 'alignWind': {
      const a = ctx.windFrom;
      return [[Math.cos(a), Math.sin(a)]];
    }
    default:
      return [
        [1, 0],
        [Math.SQRT1_2, Math.SQRT1_2],
        [0, 1],
        [-Math.SQRT1_2, Math.SQRT1_2],
      ];
  }
}

function partToFeature(p: LocalPart, frame: Frame, placed: PlacedFeature, k: number): PartFeature {
  const props = {
    feature: placed.id,
    type: placed.type,
    kind: p.kind,
    settlement: placed.settlement,
    ...(p.name ? { name: p.name } : {}),
    ...('floors' in p && p.floors ? { floors: p.floors } : {}),
    ...('widthM' in p && p.shape === 'line' && p.widthM ? { widthM: p.widthM } : {}),
  };
  const id = `${placed.id}-p${k}`;
  switch (p.shape) {
    case 'rect': {
      const ang = p.angle ?? 0;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const local: Pt[] = [
        [-p.lengthM / 2, -p.widthM / 2],
        [p.lengthM / 2, -p.widthM / 2],
        [p.lengthM / 2, p.widthM / 2],
        [-p.lengthM / 2, p.widthM / 2],
      ];
      const corners: Pt[] = local.map(([u, v]) =>
        toWorld(frame, p.u + u * ca - v * sa, p.v + u * sa + v * ca),
      );
      corners.push(corners[0]!);
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Polygon', coordinates: [corners] },
        properties: props,
      } as PartFeature;
    }
    case 'circle': {
      const ring: Pt[] = [];
      const n = p.radiusM > 20 ? 24 : 12;
      for (let i = 0; i < n; i++)
        ring.push(
          toWorld(
            frame,
            p.u + Math.cos((i / n) * Math.PI * 2) * p.radiusM,
            p.v + Math.sin((i / n) * Math.PI * 2) * p.radiusM,
          ),
        );
      ring.push(ring[0]!);
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: props,
      } as PartFeature;
    }
    case 'polygon': {
      const ring = p.points.map(([u, v]) => toWorld(frame, u, v));
      ring.push(ring[0]!);
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: props,
      } as PartFeature;
    }
    case 'line':
      return {
        type: 'Feature',
        id,
        geometry: { type: 'LineString', coordinates: p.points.map(([u, v]) => toWorld(frame, u, v)) },
        properties: props,
      } as PartFeature;
    case 'point':
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: toWorld(frame, p.u, p.v) },
        properties: props,
      } as PartFeature;
  }
}

export type { Feature, LineString, Point, Polygon };
