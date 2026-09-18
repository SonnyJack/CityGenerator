import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { Rng } from '../random/rng.js';
import { simplifyLine, smoothLine, type Ring } from '../raster/contours.js';
import { populationAt } from '../settlement/history.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { TownOutput } from '../settlement/town.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import { cellAt, routeCells } from './routing.js';

/**
 * Region stage U (utilities): the networks under and over the streets that
 * a period map or a scenario needs but a town plan does not draw.
 *
 * - Water: a trunk main from the waterworks (or a reservoir the stage sites
 *   on high ground) to the centre, distribution mains under the arteries and
 *   a water tower for big towns.
 * - Gas: a trunk main from the gasworks and mains under the arteries.
 * - Electricity: transmission lines on pylons from the power station (or the
 *   grid at the region edge) to a substation at the edge of each served
 *   town, chained town to town.
 * - Sewers (GM only): a trunk sewer downhill from the centre to an outfall on
 *   the nearest water, branches under the arteries, a sewage works from the
 *   1920s.
 * - Pipelines: refinery to port.
 * - Canals: a canal-age town away from navigable water gets a cut to the
 *   nearest river or sea, with locks where the ground changes and a basin in
 *   town; disused once the railway age has passed.
 *
 * Everything is a pure function of the terrain, the sites, the towns'
 * arteries and the placed facilities, so the output is stable across runs.
 */

export type UtilityClass = 'waterMain' | 'gasMain' | 'powerLine' | 'sewer' | 'pipeline' | 'canal';

export interface UtilityLineProps {
  class: UtilityClass;
  /** trunk | distribution | transmission | branch | oil | cut. */
  kind: string;
  settlement: string | null;
  from: string;
  to: string;
  lengthKm: number;
  built: number;
  status: 'open' | 'disused';
  /** Hidden on player exports. */
  gmOnly: boolean;
}

export type UtilityPointKind =
  | 'reservoir'
  | 'waterTower'
  | 'pumpingStation'
  | 'substation'
  | 'pylon'
  | 'outfall'
  | 'sewageWorks'
  | 'lock'
  | 'canalBasin'
  | 'gridSupply';

export interface UtilityPointProps {
  class: UtilityClass;
  kind: UtilityPointKind;
  settlement: string | null;
  name?: string;
  built: number;
  gmOnly: boolean;
}

export interface UtilityAreaProps {
  class: UtilityClass;
  kind: 'reservoir' | 'substation' | 'sewageWorks' | 'canalBasin';
  settlement: string | null;
  name?: string;
  built: number;
  gmOnly: boolean;
}

export interface UtilityFacility {
  id: string;
  type: string;
  name: string;
  settlement: string | null;
  center: [number, number];
}

export interface UtilitiesInput {
  seed: string;
  terrain: TerrainOutput;
  sites: SettlementSite[];
  /** Town outputs aligned with `sites`. */
  towns: TownOutput[];
  facilities: UtilityFacility[];
  year: number;
  enabled?: boolean;
  /** Cut canals in the canal age (default true). */
  canals?: boolean;
}

export interface UtilitiesOutput {
  key: string;
  lines: FeatureCollection<LineString, UtilityLineProps>;
  points: FeatureCollection<Point, UtilityPointProps>;
  areas: FeatureCollection<Polygon, UtilityAreaProps>;
  stats: {
    waterKm: number;
    gasKm: number;
    powerKm: number;
    sewerKm: number;
    pipelineKm: number;
    canalKm: number;
    reservoirs: number;
    substations: number;
    pylons: number;
    outfalls: number;
    locks: number;
  };
}

type Pt = [number, number];

/** First years of each network in a region (towns get them when large enough). */
export const UTILITY_YEARS = {
  canal: 1760,
  canalDisused: 1900,
  gas: 1820,
  water: 1850,
  sewer: 1860,
  waterTower: 1880,
  power: 1890,
  pipeline: 1905,
  sewageWorks: 1920,
} as const;

const EMPTY = (key: string): UtilitiesOutput => ({
  key,
  lines: { type: 'FeatureCollection', features: [] },
  points: { type: 'FeatureCollection', features: [] },
  areas: { type: 'FeatureCollection', features: [] },
  stats: {
    waterKm: 0,
    gasKm: 0,
    powerKm: 0,
    sewerKm: 0,
    pipelineKm: 0,
    canalKm: 0,
    reservoirs: 0,
    substations: 0,
    pylons: 0,
    outfalls: 0,
    locks: 0,
  },
});

const lengthOf = (pts: Ring): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
};

/** An axis-aligned rectangle ring around a centre. */
const rect = (c: Pt, w: number, h: number, angle = 0): Ring => {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const corners: Pt[] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const ring: Ring = corners.map(([u, v]) => [c[0] + u * ca - v * sa, c[1] + u * sa + v * ca] as Pt);
  ring.push(ring[0]!);
  return ring;
};

/** Points every `spacingM` along a line, skipping the ends. */
function alongLine(line: Ring, spacingM: number, marginM: number): Pt[] {
  const out: Pt[] = [];
  const total = lengthOf(line);
  if (total < marginM * 2 + spacingM) return out;
  let next = marginM;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= walked + seg && next <= total - marginM) {
      const t = seg ? (next - walked) / seg : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += spacingM;
    }
    walked += seg;
  }
  return out;
}

export const utilitiesStage = defineStage<UtilitiesInput, UtilitiesOutput>({
  id: 'utilities',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.terrain.key}|${i.seed}|${i.year}|${i.enabled ?? true}|${i.canals ?? true}|${i.sites
      .map((s) => `${s.id}:${s.population}:${s.radiusM.toFixed(0)}`)
      .join(',')}|${i.towns.map((t) => t.key).join(',')}|${i.facilities
      .map((f) => `${f.id}@${f.center[0].toFixed(0)},${f.center[1].toFixed(0)}`)
      .join(',')}`,
  run(input, ctx) {
    const { terrain, sites, towns, facilities, year } = input;
    if (input.enabled === false || !sites.length) return EMPTY(ctx.key);
    const { water, slope, height } = terrain;
    const { width, height: rows, cellSizeM } = height;
    const rng = new Rng(`${input.seed}/utilities`);
    const lines: Feature<LineString, UtilityLineProps>[] = [];
    const points: Feature<Point, UtilityPointProps>[] = [];
    const areas: Feature<Polygon, UtilityAreaProps>[] = [];
    let n = 0;
    const id = (p: string) => `util-${p}-${n++}`;

    const idx = (p: Pt) => {
      const [c, r] = cellAt(terrain, p[0], p[1]);
      return r * width + c;
    };
    const hAt = (p: Pt) => height.data[idx(p)]!;
    const isLand = (i: number) => water[i] === WATER.land;

    /** Route between two world points; returns a smoothed world line (empty when unreachable). */
    const route = (from: Pt, to: Pt, costOf: (i: number) => number, cap = 250_000): Ring => {
      const cells = routeCells(terrain, cellAt(terrain, from[0], from[1]), cellAt(terrain, to[0], to[1]), {
        costOf,
        maxExpanded: cap,
      });
      if (cells.length < 2) return [];
      const raw: Ring = cells.map(([c, r]) => [height.x(c), height.y(r)]);
      raw[0] = from;
      raw[raw.length - 1] = to;
      return simplifyLine(smoothLine(simplifyLine(raw, cellSizeM * 0.75), 2), cellSizeM * 0.2);
    };
    const line = (
      geometry: Ring,
      props: Omit<UtilityLineProps, 'lengthKm'>,
      prefix: string,
    ): Feature<LineString, UtilityLineProps> | null => {
      if (geometry.length < 2) return null;
      const f: Feature<LineString, UtilityLineProps> = {
        type: 'Feature',
        id: id(prefix),
        geometry: { type: 'LineString', coordinates: geometry },
        properties: { ...props, lengthKm: lengthOf(geometry) / 1000 },
      };
      lines.push(f);
      return f;
    };
    const point = (p: Pt, props: UtilityPointProps, prefix: string) =>
      points.push({
        type: 'Feature',
        id: id(prefix),
        geometry: { type: 'Point', coordinates: p },
        properties: props,
      });
    const area = (ring: Ring, props: UtilityAreaProps, prefix: string) =>
      areas.push({
        type: 'Feature',
        id: id(prefix),
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: props,
      });

    // Cost models. Mains and sewers follow the ground like roads; pylons shrug at slopes but
    // never stand in water; canals hate slopes and cannot cross the sea or a lake.
    const mainCost = (i: number) => {
      const w = water[i]!;
      if (w === WATER.sea || w === WATER.lake) return Infinity;
      return 1 + 5 * slope[i]! + (w === WATER.river ? 300 / cellSizeM : 0);
    };
    const pylonCost = (i: number) => {
      const w = water[i]!;
      if (w === WATER.sea || w === WATER.lake) return Infinity;
      return 1 + 1.5 * slope[i]! + (w === WATER.river ? 60 / cellSizeM : 0);
    };
    const canalCost = (i: number) => {
      const w = water[i]!;
      if (w === WATER.sea || w === WATER.lake) return Infinity;
      return 1 + 40 * slope[i]! + (w === WATER.river ? 0.2 : 0);
    };

    /** Nearest cell of a water kind to a point (world coords), searched on a coarse lattice. */
    const nearestWater = (p: Pt, kinds: number[], maxM: number): Pt | null => {
      const [c0, r0] = cellAt(terrain, p[0], p[1]);
      const reach = Math.ceil(maxM / cellSizeM);
      const step = Math.max(1, Math.floor(reach / 60));
      let best: Pt | null = null;
      let bestD = Infinity;
      for (let r = Math.max(0, r0 - reach); r < Math.min(rows, r0 + reach + 1); r += step)
        for (let c = Math.max(0, c0 - reach); c < Math.min(width, c0 + reach + 1); c += step) {
          if (!kinds.includes(water[r * width + c]!)) continue;
          const d = Math.hypot(c - c0, r - r0) * cellSizeM;
          if (d < bestD && d <= maxM) {
            bestD = d;
            best = [height.x(c), height.y(r)];
          }
        }
      return best;
    };

    /** The last land point before a line enters water, and the water point itself. */
    const shoreOf = (l: Ring): { shore: Pt; water: Pt } => {
      for (let i = l.length - 1; i > 0; i--)
        if (isLand(idx(l[i]!))) return { shore: l[i]!, water: l[l.length - 1]! };
      return { shore: l[0]!, water: l[l.length - 1]! };
    };

    /** Arteries (and collectors for big towns) as distribution routes. */
    const arteriesOf = (town: TownOutput, big: boolean): Ring[] =>
      town.streets.features
        .filter((s) => s.properties.class === 'artery' || (big && s.properties.class === 'collector'))
        .map((s) => s.geometry.coordinates as Ring);

    const facilitiesOf = (type: string, settlement?: string) =>
      facilities.filter((f) => f.type === type && (settlement === undefined || f.settlement === settlement));
    const nearestFacility = (type: string, p: Pt, maxM: number): UtilityFacility | null => {
      let best: UtilityFacility | null = null;
      let bestD = maxM;
      for (const f of facilitiesOf(type)) {
        const d = Math.hypot(f.center[0] - p[0], f.center[1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      return best;
    };

    // --- Water, gas and sewers per town ---------------------------------------------------
    sites.forEach((site, i) => {
      const town = towns[i];
      if (!town) return;
      const pop = site.population;
      const big = pop >= 20_000;
      const centre = site.center;
      const arteries = arteriesOf(town, big);

      // Water supply.
      if (year >= UTILITY_YEARS.water && pop >= 5_000) {
        const works =
          facilitiesOf('institution.waterworks', site.id)[0] ??
          nearestFacility('institution.waterworks', centre, 6_000);
        let source: Pt | null = null;
        let sourceId = '';
        if (works) {
          source = works.center;
          sourceId = works.id;
        } else {
          // A reservoir on the highest ground in a ring beyond the built-up area.
          let best: Pt | null = null;
          let bestScore = -Infinity;
          const rMin = site.radiusM * 1.2 + 300;
          const rMax = rMin + 2_000;
          for (let k = 0; k < 48; k++) {
            const a = (k / 48) * Math.PI * 2 + rng.next() * 0.05;
            const d = rMin + ((rMax - rMin) * ((k * 7) % 12)) / 12;
            const p: Pt = [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d];
            const [c, r] = cellAt(terrain, p[0], p[1]);
            if (c <= 1 || r <= 1 || c >= width - 2 || r >= rows - 2) continue;
            const ci = r * width + c;
            if (!isLand(ci) || slope[ci]! > 0.25) continue;
            const score = height.data[ci]! - d * 0.004;
            if (score > bestScore) {
              bestScore = score;
              best = p;
            }
          }
          if (best && hAt(best) > hAt(centre) + 5) {
            source = best;
            sourceId = `${site.id}-reservoir`;
            area(
              rect(best, 90, 60, rng.next() * Math.PI),
              {
                class: 'waterMain',
                kind: 'reservoir',
                settlement: site.id,
                built: UTILITY_YEARS.water,
                gmOnly: false,
              },
              'reservoir',
            );
            point(
              best,
              {
                class: 'waterMain',
                kind: 'reservoir',
                settlement: site.id,
                built: UTILITY_YEARS.water,
                gmOnly: false,
              },
              'reservoir',
            );
          }
        }
        if (source) {
          const trunk = route(source, centre, mainCost);
          line(
            trunk,
            {
              class: 'waterMain',
              kind: 'trunk',
              settlement: site.id,
              from: sourceId,
              to: site.id,
              built: UTILITY_YEARS.water,
              status: 'open',
              gmOnly: false,
            },
            'water',
          );
          for (const a of arteries)
            line(
              a,
              {
                class: 'waterMain',
                kind: 'distribution',
                settlement: site.id,
                from: site.id,
                to: site.id,
                built: UTILITY_YEARS.water,
                status: 'open',
                gmOnly: false,
              },
              'water',
            );
          if (year >= UTILITY_YEARS.waterTower && big) {
            // The water tower stands on the highest street corner of the outer rings.
            let best: Pt | null = null;
            let bestH = -Infinity;
            for (const a of arteries)
              for (const p of a) {
                const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
                if (d < site.radiusM * 0.3 || d > site.radiusM * 0.95) continue;
                const h = hAt(p);
                if (h > bestH) {
                  bestH = h;
                  best = p;
                }
              }
            if (best)
              point(
                best,
                {
                  class: 'waterMain',
                  kind: 'waterTower',
                  settlement: site.id,
                  built: UTILITY_YEARS.waterTower,
                  gmOnly: false,
                },
                'tower',
              );
          }
        }
      }

      // Town gas.
      if (year >= UTILITY_YEARS.gas && pop >= 5_000) {
        const works =
          facilitiesOf('industry.gasworks', site.id)[0] ??
          nearestFacility('industry.gasworks', centre, 4_000);
        if (works) {
          line(
            route(works.center, centre, mainCost),
            {
              class: 'gasMain',
              kind: 'trunk',
              settlement: site.id,
              from: works.id,
              to: site.id,
              built: UTILITY_YEARS.gas,
              status: 'open',
              gmOnly: false,
            },
            'gas',
          );
          for (const a of arteries)
            line(
              a,
              {
                class: 'gasMain',
                kind: 'distribution',
                settlement: site.id,
                from: site.id,
                to: site.id,
                built: UTILITY_YEARS.gas,
                status: 'open',
                gmOnly: false,
              },
              'gas',
            );
        }
      }

      // Sewers (GM only): downhill to the nearest water.
      if (year >= UTILITY_YEARS.sewer && (pop >= 5_000 || (year >= 1920 && pop >= 2_000))) {
        const target = nearestWater(centre, [WATER.sea, WATER.river, WATER.lake], 6_000);
        if (target) {
          const hCentre = hAt(centre);
          const sewerCost = (v: number) => {
            const w = water[v]!;
            if (w === WATER.sea || w === WATER.lake) return v === idx(target) ? 1 : Infinity;
            const rise = height.data[v]! - hCentre;
            return (
              1 +
              4 * slope[v]! +
              (rise > 0 ? rise / 4 : 0) +
              (w === WATER.river ? (v === idx(target) ? 0 : 200 / cellSizeM) : 0)
            );
          };
          const trunk = route(centre, target, sewerCost);
          if (trunk.length >= 2) {
            const { shore } = shoreOf(trunk);
            line(
              trunk,
              {
                class: 'sewer',
                kind: 'trunk',
                settlement: site.id,
                from: site.id,
                to: 'outfall',
                built: UTILITY_YEARS.sewer,
                status: 'open',
                gmOnly: true,
              },
              'sewer',
            );
            point(
              trunk[trunk.length - 1]!,
              {
                class: 'sewer',
                kind: 'outfall',
                settlement: site.id,
                built: UTILITY_YEARS.sewer,
                gmOnly: true,
              },
              'outfall',
            );
            if (year >= UTILITY_YEARS.sewageWorks && pop >= 5_000) {
              const back = trunk.length > 2 ? trunk[trunk.length - 3]! : trunk[0]!;
              const ang = Math.atan2(shore[1] - back[1], shore[0] - back[0]);
              const c: Pt = [shore[0] - Math.cos(ang) * 120, shore[1] - Math.sin(ang) * 120];
              area(
                rect(c, 140, 90, ang),
                {
                  class: 'sewer',
                  kind: 'sewageWorks',
                  settlement: site.id,
                  built: UTILITY_YEARS.sewageWorks,
                  gmOnly: true,
                },
                'sewage',
              );
              point(
                c,
                {
                  class: 'sewer',
                  kind: 'sewageWorks',
                  settlement: site.id,
                  built: UTILITY_YEARS.sewageWorks,
                  gmOnly: true,
                },
                'sewage',
              );
            }
            for (const a of arteries)
              line(
                a,
                {
                  class: 'sewer',
                  kind: 'branch',
                  settlement: site.id,
                  from: site.id,
                  to: site.id,
                  built: UTILITY_YEARS.sewer,
                  status: 'open',
                  gmOnly: true,
                },
                'sewer',
              );
          }
        }
      }
      ctx.checkpoint();
    });

    // --- Electricity: a chain of transmission lines from the source ------------------------
    if (year >= UTILITY_YEARS.power) {
      const served = sites
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.population >= (year >= 1950 ? 300 : year >= 1930 ? 1_000 : 3_000))
        .sort((a, b) => b.s.population - a.s.population);
      if (served.length) {
        const hub = served[0]!.s;
        const station = nearestFacility('industry.power', hub.center, 40_000);
        // Substation sites: at the edge of each town, facing the source.
        const subOf = new Map<string, Pt>();
        const substationFor = (s: SettlementSite, towards: Pt): Pt => {
          const cached = subOf.get(s.id);
          if (cached) return cached;
          const d = Math.hypot(towards[0] - s.center[0], towards[1] - s.center[1]) || 1;
          const dir: Pt = [(towards[0] - s.center[0]) / d, (towards[1] - s.center[1]) / d];
          let p: Pt = [s.center[0] + dir[0] * s.radiusM * 0.95, s.center[1] + dir[1] * s.radiusM * 0.95];
          // Nudge onto land.
          for (let k = 0; k < 8 && !isLand(idx(p)); k++)
            p = [p[0] - dir[0] * s.radiusM * 0.1, p[1] - dir[1] * s.radiusM * 0.1];
          subOf.set(s.id, p);
          area(
            rect(p, 40, 30, Math.atan2(dir[1], dir[0])),
            {
              class: 'powerLine',
              kind: 'substation',
              settlement: s.id,
              built: UTILITY_YEARS.power,
              gmOnly: false,
            },
            'substation',
          );
          point(
            p,
            {
              class: 'powerLine',
              kind: 'substation',
              settlement: s.id,
              built: UTILITY_YEARS.power,
              gmOnly: false,
            },
            'substation',
          );
          return p;
        };
        let source: Pt;
        let sourceId: string;
        if (station) {
          source = station.center;
          sourceId = station.id;
        } else {
          // Grid supply from beyond the region: the edge point away from the sea, in line with the hub.
          const halfW = ((width - 1) * cellSizeM) / 2;
          const halfH = ((rows - 1) * cellSizeM) / 2;
          const candidates: Pt[] = [
            [hub.center[0], halfH - cellSizeM * 2],
            [hub.center[0], -halfH + cellSizeM * 2],
            [halfW - cellSizeM * 2, hub.center[1]],
            [-halfW + cellSizeM * 2, hub.center[1]],
          ];
          const land = candidates.filter((p) => isLand(idx(p)));
          source = (land.length ? land : candidates).reduce((a, b) =>
            Math.hypot(b[0] - hub.center[0], b[1] - hub.center[1]) <
            Math.hypot(a[0] - hub.center[0], a[1] - hub.center[1])
              ? b
              : a,
          );
          sourceId = 'grid';
          point(
            source,
            {
              class: 'powerLine',
              kind: 'gridSupply',
              settlement: null,
              built: UTILITY_YEARS.power,
              gmOnly: false,
            },
            'grid',
          );
        }
        // Minimum spanning chain from the source over the served towns.
        const nodes: { id: string; p: Pt; site?: SettlementSite }[] = [{ id: sourceId, p: source }];
        const pending = served.map(({ s }) => s);
        while (pending.length) {
          let best: { from: number; site: SettlementSite; d: number } | null = null;
          for (let a = 0; a < nodes.length; a++)
            for (const s of pending) {
              const d = Math.hypot(s.center[0] - nodes[a]!.p[0], s.center[1] - nodes[a]!.p[1]);
              if (!best || d < best.d) best = { from: a, site: s, d };
            }
          if (!best) break;
          pending.splice(pending.indexOf(best.site), 1);
          const fromNode = nodes[best.from]!;
          const sub = substationFor(best.site, fromNode.p);
          const geometry = route(fromNode.p, sub, pylonCost);
          const trunk = fromNode.id === sourceId || best.site === hub;
          const f = line(
            geometry,
            {
              class: 'powerLine',
              kind: trunk ? 'transmission' : 'distribution',
              settlement: best.site.id,
              from: fromNode.id,
              to: best.site.id,
              built: UTILITY_YEARS.power,
              status: 'open',
              gmOnly: false,
            },
            'power',
          );
          if (f)
            for (const p of alongLine(geometry, trunk ? 300 : 220, 120))
              point(
                p,
                {
                  class: 'powerLine',
                  kind: 'pylon',
                  settlement: best.site.id,
                  built: UTILITY_YEARS.power,
                  gmOnly: false,
                },
                'pylon',
              );
          nodes.push({ id: best.site.id, p: sub, site: best.site });
        }
      }
      ctx.checkpoint();
    }

    // --- Pipelines: refinery to the nearest port -------------------------------------------
    if (year >= UTILITY_YEARS.pipeline)
      for (const refinery of facilitiesOf('industry.refinery')) {
        const port = nearestFacility('port', refinery.center, 30_000);
        const target = port?.center ?? nearestWater(refinery.center, [WATER.sea], 15_000);
        if (!target) continue;
        line(
          route(refinery.center, target, mainCost),
          {
            class: 'pipeline',
            kind: 'oil',
            settlement: refinery.settlement,
            from: refinery.id,
            to: port?.id ?? 'sea',
            built: UTILITY_YEARS.pipeline,
            status: 'open',
            gmOnly: false,
          },
          'pipeline',
        );
      }

    // --- Canals: the canal age reaches inland towns before the railway ---------------------
    if (year >= UTILITY_YEARS.canal && input.canals !== false)
      sites.forEach((site) => {
        if (site.coastal || populationAt(site.history, 1800) < 2_000) return;
        const centre = site.center;
        const nearRiver = nearestWater(centre, [WATER.river], site.radiusM * 0.8);
        if (nearRiver) return; // already on a river
        const target = nearestWater(centre, [WATER.river, WATER.sea], 12_000);
        if (!target) return;
        const cost = (v: number) => (v === idx(target) ? 1 : canalCost(v));
        const cut = route(centre, target, cost);
        if (cut.length < 2) return;
        const status = year >= UTILITY_YEARS.canalDisused ? 'disused' : 'open';
        // Basin at the town end, along the first segment.
        const a0 = cut[0]!;
        const a1 = cut[Math.min(2, cut.length - 1)]!;
        const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
        const basin: Pt = [a0[0] + Math.cos(ang) * 60, a0[1] + Math.sin(ang) * 60];
        area(
          rect(basin, 100, 45, ang),
          {
            class: 'canal',
            kind: 'canalBasin',
            settlement: site.id,
            built: UTILITY_YEARS.canal,
            gmOnly: false,
          },
          'basin',
        );
        point(
          basin,
          {
            class: 'canal',
            kind: 'canalBasin',
            settlement: site.id,
            built: UTILITY_YEARS.canal,
            gmOnly: false,
          },
          'basin',
        );
        line(
          cut,
          {
            class: 'canal',
            kind: 'cut',
            settlement: site.id,
            from: site.id,
            to: 'water',
            built: UTILITY_YEARS.canal,
            status,
            gmOnly: false,
          },
          'canal',
        );
        // Locks where the accumulated rise or fall passes a lock's lift.
        let acc = 0;
        let last = hAt(cut[0]!);
        let sinceLock = 0;
        for (let i = 1; i < cut.length; i++) {
          const h = hAt(cut[i]!);
          acc += Math.abs(h - last);
          sinceLock += Math.hypot(cut[i]![0] - cut[i - 1]![0], cut[i]![1] - cut[i - 1]![1]);
          last = h;
          if (acc >= 2.5 && sinceLock >= 150) {
            point(
              cut[i]!,
              {
                class: 'canal',
                kind: 'lock',
                settlement: site.id,
                built: UTILITY_YEARS.canal,
                gmOnly: false,
              },
              'lock',
            );
            acc = 0;
            sinceLock = 0;
          }
        }
      });

    const km = (cls: UtilityClass) =>
      lines.filter((l) => l.properties.class === cls).reduce((a, l) => a + l.properties.lengthKm, 0);
    const count = (kind: UtilityPointKind) => points.filter((p) => p.properties.kind === kind).length;
    return {
      key: ctx.key,
      lines: { type: 'FeatureCollection', features: lines },
      points: { type: 'FeatureCollection', features: points },
      areas: { type: 'FeatureCollection', features: areas },
      stats: {
        waterKm: km('waterMain'),
        gasKm: km('gasMain'),
        powerKm: km('powerLine'),
        sewerKm: km('sewer'),
        pipelineKm: km('pipeline'),
        canalKm: km('canal'),
        reservoirs: count('reservoir'),
        substations: count('substation'),
        pylons: count('pylon'),
        outfalls: count('outfall'),
        locks: count('lock'),
      },
    };
  },
});
