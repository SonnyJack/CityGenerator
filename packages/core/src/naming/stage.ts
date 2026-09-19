import type { FeatureCollection, LineString, Point } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import type { Ring } from '../raster/contours.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { TownOutput } from '../settlement/town.js';
import type { WardId } from '../settlement/wards.js';
import { NameGenerator, type StreetClass } from './generator.js';
import { culturePack, culturePackById } from './packs.js';
import type { CulturePack } from './schema.js';

/**
 * Naming stages: region names (settlements, rivers) and, per town, street
 * names on merged "ways", district names with label points, and the
 * facility names that the directory reuses. Everything derives from the
 * region seed and the culture pack(s), so names are stable across sessions.
 */

export interface RegionNamesInput {
  seed: string;
  culture: string;
  cultureMix?: { culture: string; weight: number }[];
  year: number;
  sites: SettlementSite[];
  /** River feature ids in a stable order. */
  rivers: string[];
}

export interface RegionNamesOutput {
  key: string;
  siteNames: Record<string, string>;
  riverNames: Record<string, string>;
  regionName: string;
}

const resolvePack = (id: string): CulturePack | undefined => culturePackById(id);

export const regionNamesStage = defineStage<RegionNamesInput, RegionNamesOutput>({
  id: 'regionNames',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.seed}|${i.culture}|${JSON.stringify(i.cultureMix ?? [])}|${i.year}|${JSON.stringify(i.sites.map((s) => [s.id, s.name, s.spec.culture]))}|${i.rivers.join(',')}`,
  run(input, ctx) {
    const gen = new NameGenerator(
      culturePack(input.culture),
      input.seed,
      input.year,
      resolvePack,
      input.cultureMix,
    );
    const siteNames: Record<string, string> = {};
    for (const s of input.sites) {
      if (s.name) {
        siteNames[s.id] = s.name;
        continue;
      }
      // A settlement with its own culture names itself from that pack.
      if (s.spec.culture && s.spec.culture !== input.culture) {
        const own = new NameGenerator(
          culturePack(s.spec.culture),
          `${input.seed}/${s.id}`,
          input.year,
          resolvePack,
        );
        siteNames[s.id] = own.settlement(s.id);
      } else siteNames[s.id] = gen.settlement(s.id);
    }
    const riverNames: Record<string, string> = {};
    for (const r of input.rivers) riverNames[r] = gen.water(r);
    const regionName = gen.settlement('region');
    return { key: ctx.key, siteNames, riverNames, regionName };
  },
});

export interface TownNamesInput {
  seed: string;
  culture: string;
  cultureMix?: { culture: string; weight: number }[];
  year: number;
  site: SettlementSite;
  town: TownOutput;
  /** Facilities in this town: id → type, for quarter names such as docks and works. */
  facilities?: { id: string; type: string; center: [number, number] }[];
}

export interface WayProps {
  settlement: string;
  name: string;
  class: 'artery' | 'road' | 'collector' | 'street' | 'lane';
  lengthM: number;
  /** Ids of the street segments that make up the way. */
  streets: string[];
}

export interface TownNamesOutput {
  key: string;
  id: string;
  /** Street feature id → way name. */
  streetNames: Record<string, string>;
  /** Merged ways for labels. */
  ways: FeatureCollection<LineString, WayProps>;
  /** Patch feature id → district name. */
  patchDistricts: Record<string, string>;
  districts: FeatureCollection<Point, { settlement: string; name: string; kind: string; patches: number }>;
  stats: { ways: number; districts: number };
}

type Pt = [number, number];
const key = (p: Pt) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
const CLASS_RANK: Record<string, number> = {
  artery: 4,
  road: 3,
  collector: 2,
  motorway: 5,
  street: 1,
  lane: 0.5,
  steps: 0,
};

function lengthOf(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
}

export const townNamesStage = defineStage<TownNamesInput, TownNamesOutput>({
  id: 'townNames',
  version: 1,
  seedOf: (i) => `${i.seed}/${i.site.id}/names`,
  keyOf: (i) =>
    `${i.town.key}|${i.seed}|${i.culture}|${JSON.stringify(i.cultureMix ?? [])}|${i.year}|${i.site.spec.culture ?? ''}|${JSON.stringify(i.facilities?.map((f) => [f.id, f.type]) ?? [])}`,
  run(input, ctx) {
    const { town, site } = input;
    const cultureId = site.spec.culture ?? input.culture;
    const gen = new NameGenerator(
      culturePack(cultureId),
      `${input.seed}/${site.id}`,
      input.year,
      resolvePack,
      site.spec.culture ? [] : input.cultureMix,
    );

    // --- Ways: chain street segments that continue straight through shared nodes -------
    const feats = town.streets.features;
    const nodes = new Map<string, { i: number; end: 0 | 1 }[]>();
    const coords = feats.map((f) => f.geometry.coordinates.map((c) => [c[0]!, c[1]!] as Pt));
    coords.forEach((c, i) => {
      for (const end of [0, 1] as const) {
        const p = end === 0 ? c[0]! : c[c.length - 1]!;
        const k = key(p);
        (nodes.get(k) ?? nodes.set(k, []).get(k)!).push({ i, end });
      }
    });
    const dirAt = (i: number, end: 0 | 1): Pt => {
      const c = coords[i]!;
      // Direction pointing away from the endpoint into the segment.
      const a = end === 0 ? c[0]! : c[c.length - 1]!;
      const b = end === 0 ? c[1]! : c[c.length - 2]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const used = new Uint8Array(feats.length);
    const ways: { members: number[]; pts: Pt[]; cls: string }[] = [];
    const order = feats
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (CLASS_RANK[feats[b]!.properties.class] ?? 0) - (CLASS_RANK[feats[a]!.properties.class] ?? 0) ||
          a - b,
      );
    for (const start of order) {
      if (used[start] || coords[start]!.length < 2) continue;
      used[start] = 1;
      let pts = [...coords[start]!];
      const members = [start];
      const cls = feats[start]!.properties.class;
      // Extend at both ends while a continuing segment of the same class exists.
      for (const side of ['tail', 'head'] as const) {
        for (;;) {
          const p = side === 'head' ? pts[pts.length - 1]! : pts[0]!;
          const prev = side === 'head' ? pts[pts.length - 2]! : pts[1]!;
          const l = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1;
          const dir: Pt = [(p[0] - prev[0]) / l, (p[1] - prev[1]) / l];
          let best: { i: number; end: 0 | 1; cos: number } | null = null;
          for (const cand of nodes.get(key(p)) ?? []) {
            if (used[cand.i] || feats[cand.i]!.properties.class !== cls) continue;
            const d = dirAt(cand.i, cand.end);
            const cos = dir[0] * d[0] + dir[1] * d[1];
            if (cos > 0.8 && (!best || cos > best.cos)) best = { i: cand.i, end: cand.end, cos };
          }
          if (!best) break;
          used[best.i] = 1;
          members.push(best.i);
          const c = best.end === 0 ? coords[best.i]!.slice(1) : coords[best.i]!.slice(0, -1).reverse();
          pts = side === 'head' ? [...pts, ...c] : [...c.reverse(), ...pts];
        }
      }
      ways.push({ members, pts, cls });
    }
    ctx.checkpoint();

    const streetNames: Record<string, string> = {};
    const wayFeatures: TownNamesOutput['ways']['features'] = [];
    ways.forEach((w, k) => {
      const len = lengthOf(w.pts);
      let cls: StreetClass =
        w.cls === 'motorway' ? 'artery' : w.cls === 'steps' ? 'lane' : (w.cls as StreetClass);
      if (cls === 'street' && len < 90) cls = 'lane';
      const name = gen.street(`${k}`, cls);
      for (const m of w.members) streetNames[String(feats[m]!.id)] = name;
      wayFeatures.push({
        type: 'Feature',
        id: `${site.id}-way-${k}`,
        geometry: { type: 'LineString', coordinates: w.pts },
        properties: {
          settlement: site.id,
          name,
          class: cls,
          lengthM: len,
          streets: w.members.map((m) => String(feats[m]!.id)),
        },
      });
    });

    // --- Districts: the old core, special wards, facilities and ring sectors ----------------
    const patchDistricts: Record<string, string> = {};
    const groups = new Map<string, { name: string; kind: string; pts: Pt[] }>();
    const add = (groupKey: string, name: string, kind: string, patchId: string, ring: Ring) => {
      let cx = 0;
      let cy = 0;
      const n = ring.length - 1 || 1;
      for (let i = 0; i < n; i++) {
        cx += ring[i]![0];
        cy += ring[i]![1];
      }
      const g = groups.get(groupKey) ?? groups.set(groupKey, { name, kind, pts: [] }).get(groupKey)!;
      g.pts.push([cx / n, cy / n]);
      patchDistricts[patchId] = name;
    };
    const quarterFor = (
      ward: WardId,
    ): { key: keyof CulturePack['naming']['quarters']; kind: string } | null => {
      switch (ward) {
        case 'cathedral':
          return { key: 'cathedral', kind: 'quarter' };
        case 'castle':
          return { key: 'castle', kind: 'quarter' };
        case 'market':
          return { key: 'market', kind: 'quarter' };
        case 'port':
          return { key: 'port', kind: 'quarter' };
        case 'fishing':
          return { key: 'fishing', kind: 'quarter' };
        case 'industrial':
        case 'yard':
          return { key: 'industrial', kind: 'quarter' };
        default:
          return null;
      }
    };
    const sectorNames = new Map<string, string>();
    const [cx, cy] = site.center;
    for (const p of town.patches.features) {
      const ring = p.geometry.coordinates[0]!.map((c) => [c[0]!, c[1]!] as Pt);
      const id = String(p.id);
      const q = quarterFor(p.properties.ward);
      if (q) {
        add(`quarter:${q.key}`, gen.quarter(q.key), q.kind, id, ring);
        continue;
      }
      if (p.properties.inner || p.properties.ring === 0) {
        add('core', gen.quarter('core'), 'core', id, ring);
        continue;
      }
      // Ring sectors: six wedges per ring.
      const c = ring.reduce(
        (a, pt) => [a[0] + pt[0] / (ring.length || 1), a[1] + pt[1] / (ring.length || 1)],
        [0, 0] as Pt,
      );
      const angle = Math.atan2(c[1] - cy, c[0] - cx);
      const sector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 6) % 6;
      const gk = `ring${p.properties.ring}-s${sector}`;
      let name = sectorNames.get(gk);
      if (!name) {
        const dirs = [
          'West',
          'South-West',
          'South',
          'South-East',
          'East',
          'North-East',
          'North',
          'North-West',
        ];
        const dir = dirs[Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8]!;
        name = gen.district(gk, { dir: [dir] });
        sectorNames.set(gk, name);
      }
      add(gk, name, 'district', id, ring);
    }
    const districts: TownNamesOutput['districts']['features'] = [];
    for (const [k, g] of groups) {
      const n = g.pts.length;
      const px = g.pts.reduce((a, p) => a + p[0], 0) / n;
      const py = g.pts.reduce((a, p) => a + p[1], 0) / n;
      districts.push({
        type: 'Feature',
        id: `${site.id}-district-${k}`,
        geometry: { type: 'Point', coordinates: [px, py] },
        properties: { settlement: site.id, name: g.name, kind: g.kind, patches: n },
      });
    }
    return {
      key: ctx.key,
      id: site.id,
      streetNames,
      ways: { type: 'FeatureCollection', features: wayFeatures },
      patchDistricts,
      districts: { type: 'FeatureCollection', features: districts },
      stats: { ways: wayFeatures.length, districts: districts.length },
    };
  },
});

/**
 * Nearest named way to a point, for addresses. Built once per region from the
 * towns' ways; queries use a coarse grid.
 */
export class StreetIndex {
  private readonly cell = 250;
  private readonly grid = new Map<string, { a: Pt; b: Pt; name: string; t0: number; way: string }[]>();
  constructor(ways: FeatureCollection<LineString, WayProps>[]) {
    for (const fc of ways)
      for (const w of fc.features) {
        const c = w.geometry.coordinates;
        let acc = 0;
        for (let i = 1; i < c.length; i++) {
          const a: Pt = [c[i - 1]![0]!, c[i - 1]![1]!];
          const b: Pt = [c[i]![0]!, c[i]![1]!];
          const seg = { a, b, name: w.properties.name, t0: acc, way: String(w.id) };
          for (
            let gx = Math.floor(Math.min(a[0], b[0]) / this.cell) - 1;
            gx <= Math.floor(Math.max(a[0], b[0]) / this.cell) + 1;
            gx++
          )
            for (
              let gy = Math.floor(Math.min(a[1], b[1]) / this.cell) - 1;
              gy <= Math.floor(Math.max(a[1], b[1]) / this.cell) + 1;
              gy++
            ) {
              const k = `${gx},${gy}`;
              (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(seg);
            }
          acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
      }
  }
  /** Street name and a house number for a point (odd on one side, even on the other), or null. */
  address(x: number, y: number, maxDistM = 90): { street: string; number: number; way: string } | null {
    const k = `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
    let best: { d: number; street: string; number: number; way: string } | null = null;
    for (const s of this.grid.get(k) ?? []) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (y - s.a[1]) * dy) / len2)) : 0;
      const px = s.a[0] + dx * u;
      const py = s.a[1] + dy * u;
      const d = Math.hypot(x - px, y - py);
      if (d > maxDistM || (best && d >= best.d)) continue;
      const side = dx * (y - s.a[1]) - dy * (x - s.a[0]) >= 0 ? 1 : 0;
      const along = s.t0 + Math.sqrt(len2) * u;
      best = {
        d,
        street: s.name,
        number: Math.max(1, Math.floor(along / 9) * 2 + (side ? 1 : 2)),
        way: s.way,
      };
    }
    return best ? { street: best.street, number: best.number, way: best.way } : null;
  }
}
