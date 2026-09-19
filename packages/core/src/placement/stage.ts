import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import type { Ring } from '../raster/contours.js';
import { landSampler, smoothOnLand } from '../terrain/land.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { WardId } from '../settlement/wards.js';
import type { RailOutput, TrackProps } from '../networks/rail.js';
import { cellAt, roadCost, routeCells } from '../networks/routing.js';
import { createContext, placeFeatures } from './engine.js';
import { customFeatureType, type CustomFeatureType } from './custom.js';
import { defaultRequests } from './defaults.js';
import { featureTypeMap } from './library.js';
import type {
  HostSite,
  PartFeature,
  PlacedFeature,
  PlacementFailure,
  PlacementRequest,
  Pt,
} from './types.js';

/**
 * Region stage R6 (facilities): place ports, industry, institutions and
 * airports for every settlement with the placement engine, then connect them
 * with rail spurs and access roads. Runs after rail and before the society
 * and town stages, which take its footprints as nuisance and reserved land.
 */

export interface FacilitiesInput {
  seed: string;
  terrain: TerrainOutput;
  sites: SettlementSite[];
  rail: RailOutput | null;
  year: number;
  extent: { widthM: number; heightM: number };
  /** Explicit requests from the spec (region and settlement level). */
  requests: PlacementRequest[];
  /** Ids of default requests to drop, and pins to apply. */
  removed: string[];
  pins: { target: string; x: number; y: number; rotation: number }[];
  customTypes: CustomFeatureType[];
  scaleCompression: boolean;
  windFrom?: number;
  /** When false, no defaults are generated (explicit requests only). */
  defaults?: boolean;
}

export interface ReservedArea {
  id: string;
  ring: Ring;
  ward: WardId;
}

export interface FacilityProps {
  id: string;
  type: string;
  name: string;
  category: PlacedFeature['category'];
  settlement: string | null;
  size: PlacedFeature['size'];
  lengthM: number;
  widthM: number;
  realLengthM: number;
  realWidthM: number;
  compression: number;
  pinned: boolean;
  outcome: PlacedFeature['outcome'];
  rotation: number;
}

export interface FacilitiesOutput {
  key: string;
  features: FeatureCollection<Polygon, FacilityProps>;
  parts: FeatureCollection<PartFeature['geometry'], PartFeature['properties']>;
  /** Rail spurs to the facilities (class 'spur'). */
  spurs: FeatureCollection<LineString, TrackProps>;
  /** Access roads from the facilities to their town. */
  roads: FeatureCollection<LineString, { class: 'road'; from: string; to: string; lengthKm: number }>;
  reserved: ReservedArea[];
  nuisance: [number, number, number, number][];
  failures: PlacementFailure[];
  stats: {
    placed: number;
    failed: number;
    byCategory: Record<string, number>;
    spurKm: number;
    roadKm: number;
  };
}

export const facilitiesStage = defineStage<FacilitiesInput, FacilitiesOutput>({
  id: 'facilities',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.terrain.key}|${i.rail?.key ?? ''}|${i.seed}|${i.year}|${i.scaleCompression}|${i.windFrom ?? ''}|${i.defaults ?? true}|${JSON.stringify(
      [
        i.requests,
        i.removed,
        i.pins,
        i.customTypes,
        i.sites.map((s) => [s.id, s.kind, s.center, s.population, s.radiusM, s.coastal, s.riverside]),
      ],
    )}`,
  run(input, ctx) {
    const { terrain, sites, year } = input;
    const windFrom = input.windFrom ?? Math.PI;
    const pctx = createContext(terrain, sites, input.rail, year, windFrom);
    const types = featureTypeMap(input.customTypes.map(customFeatureType));
    const onLand = landSampler(terrain, { rivers: 'land', aboveSea: false });
    const hosts = new Map<string, HostSite>();
    for (const s of sites)
      hosts.set(s.id, { site: s, coreRadiusM: Math.min(0.8 * s.radiusM, 350 + 0.25 * s.radiusM) });

    // Requests: defaults per settlement, then explicit ones (which replace defaults with the same id).
    const removed = new Set(input.removed);
    const byId = new Map<string, PlacementRequest>();
    if (input.defaults ?? true)
      for (const s of sites)
        for (const r of defaultRequests(s, year)) {
          // A default outside its type's years (a mill town after the mills closed) is not a failure.
          const t = types.get(r.type);
          if (t && (year < t.years[0] || year > t.years[1])) continue;
          byId.set(r.id, r);
        }
    for (const r of input.requests) byId.set(r.id, r);
    for (const id of removed) byId.delete(id);
    for (const pin of input.pins) {
      const r = byId.get(pin.target);
      if (r) r.pin = { x: pin.x, y: pin.y, rotation: pin.rotation };
    }
    // Rail yards already occupy land: register them so facilities avoid them.
    if (input.rail) {
      for (const s of input.rail.structures.features) {
        if (s.properties.kind !== 'railYard' && s.properties.kind !== 'goodsYard') continue;
        const ring = s.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as Pt);
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
        pctx.placed.push({
          center: [(minX + maxX) / 2, (minY + maxY) / 2],
          axis: [1, 0],
          lengthM: maxX - minX,
          widthM: maxY - minY,
        });
      }
    }
    const result = placeFeatures(pctx, [...byId.values()], {
      seed: input.seed,
      types,
      scaleCompression: input.scaleCompression,
      hosts,
      extent: input.extent,
    });
    ctx.checkpoint();

    // --- Connectors ---------------------------------------------------------------------
    const { height, water, slope } = terrain;
    const { cellSizeM } = height;
    const spurs: FacilitiesOutput['spurs']['features'] = [];
    const roads: FacilitiesOutput['roads']['features'] = [];
    let spurKm = 0;
    let roadKm = 0;
    const lengthOf = (pts: Ring) => {
      let l = 0;
      for (let i = 1; i < pts.length; i++)
        l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      return l;
    };
    const railCost = (v: number) => {
      const w = water[v]!;
      if (w === WATER.sea || w === WATER.lake) return Infinity;
      const g = slope[v]!;
      return (
        1 + 2 * g + (g > 0.035 ? (24 * (g - 0.035)) / 0.035 : 0) + (w === WATER.river ? 600 / cellSizeM : 0)
      );
    };
    const roadC = roadCost(terrain);
    // Nearest point on the rail network to a point.
    const nearestTrackPoint = (p: Pt): Pt | null => {
      if (!input.rail) return null;
      let best: { q: Pt; d: number } | null = null;
      for (const t of input.rail.tracks.features) {
        if (t.properties.class === 'yard' || t.properties.mode === 'subway' || t.properties.mode === 'tunnel')
          continue;
        for (const c of t.geometry.coordinates) {
          const d = Math.hypot(c[0]! - p[0], c[1]! - p[1]);
          if (!best || d < best.d) best = { q: [c[0]!, c[1]!], d };
        }
      }
      return best && best.d < 4000 ? best.q : null;
    };
    for (const rc of result.railConnectors) {
      const target = nearestTrackPoint(rc.from);
      if (!target || Math.hypot(target[0] - rc.from[0], target[1] - rc.from[1]) < 40) continue;
      const cells = routeCells(
        terrain,
        cellAt(terrain, rc.from[0], rc.from[1]),
        cellAt(terrain, target[0], target[1]),
        { costOf: railCost },
      );
      if (cells.length < 2) continue;
      const raw: Ring = cells.map(([c, r]) => [height.x(c), height.y(r)]);
      raw[0] = rc.from;
      raw[raw.length - 1] = target;
      const line = smoothOnLand(raw, onLand, {
        preSimplify: cellSizeM * 0.75,
        iterations: 3,
        tolerance: cellSizeM * 0.2,
      });
      const len = lengthOf(line);
      spurKm += len / 1000;
      spurs.push({
        type: 'Feature',
        id: `spur-${rc.feature}`,
        geometry: { type: 'LineString', coordinates: line },
        properties: {
          class: 'spur',
          mode: 'surface',
          line: `${rc.feature}-spur`,
          from: rc.feature,
          to: 'rail',
          lengthKm: len / 1000,
          gradient: 0,
        },
      });
      ctx.checkpoint();
    }
    for (const rd of result.roadConnectors) {
      const site = sites.find((s) => s.id === rd.settlement);
      if (!site) continue;
      const dist = Math.hypot(rd.from[0] - site.center[0], rd.from[1] - site.center[1]);
      // Stop at the built-up edge; the town's streets take over inside.
      const stopR = Math.min(site.radiusM * 0.9, dist - 20);
      if (stopR <= 40) continue;
      const cells = routeCells(
        terrain,
        cellAt(terrain, rd.from[0], rd.from[1]),
        cellAt(terrain, site.center[0], site.center[1]),
        { costOf: roadC },
      );
      if (cells.length < 2) continue;
      const kept = cells.filter(
        ([c, r]) => Math.hypot(height.x(c) - site.center[0], height.y(r) - site.center[1]) >= stopR,
      );
      if (kept.length < 2) continue;
      const raw: Ring = kept.map(([c, r]) => [height.x(c), height.y(r)]);
      raw[0] = rd.from;
      const line = smoothOnLand(raw, onLand, { iterations: 2, tolerance: cellSizeM * 0.3 });
      const len = lengthOf(line);
      roadKm += len / 1000;
      roads.push({
        type: 'Feature',
        id: `access-${rd.feature}`,
        geometry: { type: 'LineString', coordinates: line },
        properties: { class: 'road', from: rd.feature, to: site.id, lengthKm: len / 1000 },
      });
    }

    const byCategory: Record<string, number> = {};
    for (const p of result.placed) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    const features: Feature<Polygon, FacilityProps>[] = result.placed.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Polygon', coordinates: [p.ring] },
      properties: {
        id: p.id,
        type: p.type,
        name: p.name,
        category: p.category,
        settlement: p.settlement,
        size: p.size,
        lengthM: p.frame.lengthM,
        widthM: p.frame.widthM,
        realLengthM: p.realLengthM,
        realWidthM: p.realWidthM,
        compression: p.compression,
        pinned: p.pinned,
        outcome: p.outcome,
        rotation: Math.atan2(p.frame.axis[1], p.frame.axis[0]),
      },
    }));
    return {
      key: ctx.key,
      features: { type: 'FeatureCollection', features },
      parts: { type: 'FeatureCollection', features: result.parts },
      spurs: { type: 'FeatureCollection', features: spurs },
      roads: { type: 'FeatureCollection', features: roads },
      reserved: result.placed.map((p) => ({ id: p.id, ring: p.ring, ward: p.ward })),
      nuisance: result.nuisance,
      failures: result.failures,
      stats: { placed: result.placed.length, failed: result.failures.length, byCategory, spurKm, roadKm },
    };
  },
});
