import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { Rng } from '../random/rng.js';
import type { Ring } from '../raster/contours.js';
import { eraAt, type EraParams } from '../settlement/eras.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { TownOutput } from '../settlement/town.js';
import { railCrossings, type CrossingProps } from './crossings.js';
import type { RailOutput, StationProps } from './rail.js';

/**
 * Settlement stage S3b (tram): street-running tram or streetcar lines in the
 * eras that had them, radiating from the central station (or the centre)
 * along arteries and collectors to termini in the outer rings, with stops,
 * a depot at the longest line's terminus, and the level crossings, bridges
 * and underpasses where the railway meets the town's streets.
 *
 * The lines all leave the same hub, so their inner stretches lie on the same
 * street: each line is split into runs by the number of lines sharing the
 * track, and every run says how many routes use it, so the inner trunk can be
 * drawn as the double or quadruple track it was.
 */

export interface TramInput {
  seed: string;
  site: SettlementSite;
  town: TownOutput;
  year: number;
  eras: EraParams[];
  /** Rail output for the region (stations locate the hub; tracks give crossings). */
  rail?: RailOutput;
  enabled?: boolean;
}

export interface TramOutput {
  key: string;
  id: string;
  lines: FeatureCollection<
    LineString,
    {
      settlement: string;
      class: 'tram';
      line: number;
      lengthKm: number;
      /** How many routes run over this stretch (1 = the line has it to itself). */
      shared: number;
      /** The routes sharing it, in order. */
      routes: number[];
    }
  >;
  stops: FeatureCollection<Point, { kind: 'tramStop' | 'tramTerminus'; settlement: string; line: number }>;
  structures: FeatureCollection<Polygon, { kind: 'tramDepot'; settlement: string }>;
  crossings: FeatureCollection<Point, CrossingProps & { settlement: string }>;
  stats: {
    tramKm: number;
    /** Route-kilometres: the length of track, counting shared track once. */
    trackKm: number;
    lines: number;
    stops: number;
    crossings: number;
    /** Track carrying more than one route. */
    sharedKm: number;
  };
}

type Pt = [number, number];

const keyOf = (p: Pt) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;

class StreetGraph {
  readonly points = new Map<string, Pt>();
  readonly adj = new Map<string, { to: string; w: number }[]>();
  add(a: Pt, b: Pt, w: number) {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return;
    this.points.set(ka, a);
    this.points.set(kb, b);
    (this.adj.get(ka) ?? this.adj.set(ka, []).get(ka)!).push({ to: kb, w });
    (this.adj.get(kb) ?? this.adj.set(kb, []).get(kb)!).push({ to: ka, w });
  }
  /** Dijkstra from a source; returns distances and predecessors. */
  dijkstra(source: string): { dist: Map<string, number>; prev: Map<string, string> } {
    const dist = new Map<string, number>([[source, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    // Simple binary heap.
    const hk: string[] = [source];
    const hd: number[] = [0];
    const push = (k: string, d: number) => {
      hk.push(k);
      hd.push(d);
      let i = hk.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p]! <= hd[i]!) break;
        [hd[p], hd[i]] = [hd[i]!, hd[p]!];
        [hk[p], hk[i]] = [hk[i]!, hk[p]!];
        i = p;
      }
    };
    const pop = () => {
      const top = hk[0]!;
      const lk = hk.pop()!;
      const ld = hd.pop()!;
      if (hk.length) {
        hk[0] = lk;
        hd[0] = ld;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < hd.length && hd[l]! < hd[m]!) m = l;
          if (r < hd.length && hd[r]! < hd[m]!) m = r;
          if (m === i) break;
          [hd[m], hd[i]] = [hd[i]!, hd[m]!];
          [hk[m], hk[i]] = [hk[i]!, hk[m]!];
          i = m;
        }
      }
      return top;
    };
    while (hk.length) {
      const u = pop();
      if (done.has(u)) continue;
      done.add(u);
      const du = dist.get(u)!;
      for (const e of this.adj.get(u) ?? []) {
        const nd = du + e.w;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, u);
          push(e.to, nd);
        }
      }
    }
    return { dist, prev };
  }
  path(prev: Map<string, string>, source: string, target: string): Pt[] {
    const out: Pt[] = [];
    let k: string | undefined = target;
    while (k !== undefined) {
      out.push(this.points.get(k)!);
      if (k === source) break;
      k = prev.get(k);
    }
    return out.reverse();
  }
}

const EMPTY = (key: string, id: string): TramOutput => ({
  key,
  id,
  lines: { type: 'FeatureCollection', features: [] },
  stops: { type: 'FeatureCollection', features: [] },
  structures: { type: 'FeatureCollection', features: [] },
  crossings: { type: 'FeatureCollection', features: [] },
  stats: { tramKm: 0, trackKm: 0, lines: 0, stops: 0, crossings: 0, sharedKm: 0 },
});

export const tramStage = defineStage<TramInput, TramOutput>({
  id: 'tram',
  version: 1,
  seedOf: (i) => `${i.seed}/${i.site.id}/tram`,
  keyOf: (i) =>
    `${i.town.key}|${i.seed}|${i.year}|${i.enabled ?? true}|${i.rail?.key ?? ''}|${JSON.stringify(i.eras.map((e) => [e.id, e.transport.tram]))}`,
  run(input, ctx) {
    const { site, town, year } = input;
    const rng = new Rng(`${input.seed}/${site.id}/tram`);
    const era = eraAt(input.eras, year);
    const out = EMPTY(ctx.key, site.id);

    // Level crossings with the town's streets, whatever the era.
    if (input.rail) {
      const near = input.rail.tracks.features.filter((t) =>
        t.geometry.coordinates.some(
          (c) => Math.hypot(c[0]! - site.center[0], c[1]! - site.center[1]) < site.radiusM * 1.4,
        ),
      );
      if (near.length) {
        const xs = railCrossings({ type: 'FeatureCollection', features: near }, town.streets.features, {
          minSpacingM: 30,
        });
        out.crossings = {
          type: 'FeatureCollection',
          features: xs.features.map((f) => ({
            ...f,
            id: `${site.id}-${f.id}`,
            properties: { ...f.properties, settlement: site.id },
          })),
        };
        out.stats.crossings = out.crossings.features.length;
      }
    }
    if ((input.enabled ?? true) === false || !era.transport.tram || site.population < 15_000) return out;

    // --- Street graph: arteries, roads and collectors carry trams; minor streets only as a last resort.
    const graph = new StreetGraph();
    for (const st of town.streets.features) {
      const cls = st.properties.class;
      if (cls === 'motorway' || cls === 'steps' || cls === 'lane') continue;
      const mult = cls === 'artery' ? 1 : cls === 'road' ? 1.1 : cls === 'collector' ? 1.25 : 2.5;
      const c = st.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const a: Pt = [c[i - 1]![0]!, c[i - 1]![1]!];
        const b: Pt = [c[i]![0]!, c[i]![1]!];
        graph.add(a, b, Math.hypot(b[0] - a[0], b[1] - a[1]) * mult);
      }
    }
    if (graph.points.size < 10) return out;

    // Hub: the street node nearest the central station, else nearest the centre.
    const central = input.rail?.stations.features.find(
      (s: Feature<Point, StationProps>) =>
        s.properties.settlement === site.id && s.properties.kind !== 'suburban' && !s.properties.closed,
    );
    const hubTarget: Pt = central
      ? [central.geometry.coordinates[0]!, central.geometry.coordinates[1]!]
      : site.center;
    let hub = '';
    let hubD = Infinity;
    for (const [k, p] of graph.points) {
      const d = Math.hypot(p[0] - hubTarget[0], p[1] - hubTarget[1]);
      if (d < hubD) {
        hubD = d;
        hub = k;
      }
    }
    const { dist, prev } = graph.dijkstra(hub);

    // Termini: one per sector, the reachable node furthest out (by straight distance from the centre).
    const n = Math.max(2, Math.min(8, Math.round(site.population / 20_000)));
    const base = rng.range(0, Math.PI * 2);
    const R = site.radiusM;
    const lines: Ring[] = [];
    for (let k = 0; k < n; k++) {
      const dir = base + (k / n) * Math.PI * 2;
      let best: { key: string; score: number } | null = null;
      for (const [key, p] of graph.points) {
        const d = dist.get(key);
        if (d === undefined || d > R * 2.2) continue;
        const r = Math.hypot(p[0] - site.center[0], p[1] - site.center[1]);
        if (r < R * 0.45 || r > R * 1.05) continue;
        let dA = Math.abs(Math.atan2(p[1] - site.center[1], p[0] - site.center[0]) - dir);
        if (dA > Math.PI) dA = Math.PI * 2 - dA;
        if (dA > Math.PI / n) continue;
        const score = r - dA * R * 0.3 - d * 0.15;
        if (!best || score > best.score) best = { key, score };
      }
      if (!best) continue;
      const path = graph.path(prev, hub, best.key);
      if (path.length >= 2) lines.push(path);
    }
    ctx.checkpoint();

    // Shared track: the routes leave the same hub over the same streets, so count the routes
    // on every street segment and split each line into runs of equal sharing.
    const users = new Map<string, number[]>();
    const segKey = (a: Pt, b: Pt) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };
    lines.forEach((line, li) => {
      for (let i = 1; i < line.length; i++) {
        const k = segKey(line[i - 1]!, line[i]!);
        const list = users.get(k) ?? [];
        if (!list.includes(li)) list.push(li);
        users.set(k, list);
      }
    });

    // Stops every ~350 m along each line, a terminus at the end.
    const stopEvery = 350;
    const stopSeen = new Set<string>();
    lines.forEach((line, li) => {
      let len = 0;
      let next = stopEvery;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        while (next <= len + seg) {
          const u = (next - len) / seg;
          const p: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
          const key = keyOf([Math.round(p[0] / 80) * 80, Math.round(p[1] / 80) * 80]);
          if (!stopSeen.has(key)) {
            stopSeen.add(key);
            out.stops.features.push({
              type: 'Feature',
              id: `${site.id}-tramstop-${li}-${out.stops.features.length}`,
              geometry: { type: 'Point', coordinates: p },
              properties: { kind: 'tramStop', settlement: site.id, line: li },
            });
          }
          next += stopEvery;
        }
        len += seg;
      }
      out.stops.features.push({
        type: 'Feature',
        id: `${site.id}-tramterminus-${li}`,
        geometry: { type: 'Point', coordinates: line[line.length - 1]! },
        properties: { kind: 'tramTerminus', settlement: site.id, line: li },
      });
      // One feature per run of equal sharing, so the trunk can be drawn heavier than the branches.
      let start = 0;
      let part = 0;
      for (let i = 1; i <= line.length - 1; i++) {
        const here = users.get(segKey(line[i - 1]!, line[i]!)) ?? [li];
        const next = i < line.length - 1 ? (users.get(segKey(line[i]!, line[i + 1]!)) ?? [li]) : null;
        if (next && next.length === here.length && next.every((r) => here.includes(r))) continue;
        const run = line.slice(start, i + 1);
        let runLen = 0;
        for (let k = 1; k < run.length; k++)
          runLen += Math.hypot(run[k]![0] - run[k - 1]![0], run[k]![1] - run[k - 1]![1]);
        out.lines.features.push({
          type: 'Feature',
          id: `${site.id}-tram-${li}-${part++}`,
          geometry: { type: 'LineString', coordinates: run },
          properties: {
            settlement: site.id,
            class: 'tram',
            line: li,
            lengthKm: runLen / 1000,
            shared: here.length,
            routes: [...here].sort((a, b) => a - b),
          },
        });
        // Route-kilometres count every route; track-kilometres count shared track once.
        out.stats.tramKm += runLen / 1000;
        out.stats.trackKm += runLen / 1000 / here.length;
        if (here.length > 1) out.stats.sharedKm += runLen / 1000 / here.length;
        start = i;
      }
    });

    // Depot beside the terminus of the longest line, aligned with its last segment.
    const lineLen = new Map<number, number>();
    for (const f of out.lines.features)
      lineLen.set(f.properties.line, (lineLen.get(f.properties.line) ?? 0) + f.properties.lengthKm);
    let longestLine = -1;
    let longestKm = -1;
    for (const [li, km] of lineLen)
      if (km > longestKm) {
        longestKm = km;
        longestLine = li;
      }
    const longest = longestLine >= 0 ? (lines[longestLine] ?? null) : null;
    if (longest) {
      const c = longest;
      const a = c[c.length - 2]!;
      const b = c[c.length - 1]!;
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1;
      const t: Pt = [(b[0]! - a[0]!) / len, (b[1]! - a[1]!) / len];
      const nrm: Pt = [-t[1], t[0]];
      const side = rng.chance(0.5) ? 1 : -1;
      const cx = b[0]! - t[0] * 70 + nrm[0] * side * 50;
      const cy = b[1]! - t[1] * 70 + nrm[1] * side * 50;
      const L = 120;
      const W = 60;
      const ring: Ring = [
        [cx - (t[0] * L) / 2 - (nrm[0] * W) / 2, cy - (t[1] * L) / 2 - (nrm[1] * W) / 2],
        [cx + (t[0] * L) / 2 - (nrm[0] * W) / 2, cy + (t[1] * L) / 2 - (nrm[1] * W) / 2],
        [cx + (t[0] * L) / 2 + (nrm[0] * W) / 2, cy + (t[1] * L) / 2 + (nrm[1] * W) / 2],
        [cx - (t[0] * L) / 2 + (nrm[0] * W) / 2, cy - (t[1] * L) / 2 + (nrm[1] * W) / 2],
      ];
      ring.push(ring[0]!);
      out.structures.features.push({
        type: 'Feature',
        id: `${site.id}-tramdepot`,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { kind: 'tramDepot', settlement: site.id },
      });
    }
    out.stats.lines = lines.length;
    out.stats.stops = out.stops.features.length;
    return out;
  },
});
