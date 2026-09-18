import type { Feature, Point } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import type { SettlementKind, SettlementSpec } from '../document/schema.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import type { Rng } from '../random/rng.js';
import { populationAt, radiusAt, radiusForPopulation, type SettlementHistory } from './history.js';

/**
 * Region stage R3: where settlements go. Explicit settlement specs are honoured
 * (pinned sites are used as given); when the spec lists none, a set is drawn
 * from the settlement policy. Sites are scored on flatness, water access,
 * centrality and separation, largest settlements first.
 */

export interface SettlementSite {
  id: string;
  kind: SettlementKind;
  name?: string;
  population: number;
  center: [number, number];
  /** Radius of the built-up area at the current year, metres. */
  radiusM: number;
  founded: number;
  /** The settlement's growth history; `population` and `radiusM` are its values at the current year. */
  history: SettlementHistory;
  /** Population at the anchor year (what the spec says). */
  anchorPopulation: number;
  /** Original spec (explicit or synthesised). */
  spec: SettlementSpec;
  /** True when the site touches the sea within a short distance. */
  coastal: boolean;
  /** True when a river passes within the settlement radius. */
  riverside: boolean;
}

export interface SitingInput {
  seed: string;
  terrain: TerrainOutput;
  year: number;
  /** Year the spec populations describe; defaults to `year`. */
  anchorYear?: number;
  settlements: SettlementSpec[];
  policy: { count: [number, number]; kinds: Partial<Record<SettlementKind, number>> };
}

export interface SitingOutput {
  key: string;
  sites: SettlementSite[];
  points: Feature<Point, { kind: SettlementKind; population: number; name?: string; radiusM: number }>[];
}

export const DEFAULT_POPULATION: Record<SettlementKind, number> = {
  metropolis: 250_000,
  city: 30_000,
  town: 6_000,
  village: 600,
  hamlet: 120,
  portTown: 8_000,
  fishingVillage: 400,
  millTown: 3_000,
  miningTown: 2_500,
  resort: 2_000,
  universityTown: 8_000,
  suburb: 5_000,
  industrialSatellite: 6_000,
};

export { urbanDensity, radiusForPopulation } from './history.js';

const DEFAULT_KIND_WEIGHTS: Partial<Record<SettlementKind, number>> = {
  village: 6,
  town: 2,
  hamlet: 3,
  fishingVillage: 1,
  millTown: 1,
};

function synthesiseSpecs(rng: Rng, policy: SitingInput['policy'], coastal: boolean): SettlementSpec[] {
  const specs: SettlementSpec[] = [];
  const [lo, hi] = policy.count;
  const count = Math.max(1, rng.int(Math.min(lo, hi), Math.max(lo, hi)));
  const weights = Object.keys(policy.kinds).length ? policy.kinds : DEFAULT_KIND_WEIGHTS;
  const kinds = Object.keys(weights) as SettlementKind[];
  const ws = kinds.map((k) =>
    k === 'fishingVillage' || k === 'portTown' ? (coastal ? weights[k]! : 0) : weights[k]!,
  );
  specs.push({
    id: 'city',
    kind: coastal && rng.chance(0.5) ? 'portTown' : 'city',
    population: DEFAULT_POPULATION.city,
    layout: { streetPattern: 'mixed' },
    features: [],
  });
  specs[0]!.population = DEFAULT_POPULATION[specs[0]!.kind];
  for (let i = 1; i < count; i++) {
    const kind = ws.some((w) => w > 0) ? rng.weighted(kinds, ws) : 'village';
    const pop = Math.round(DEFAULT_POPULATION[kind] * rng.range(0.6, 1.5));
    specs.push({ id: `s${i}`, kind, population: pop, layout: { streetPattern: 'mixed' }, features: [] });
  }
  return specs;
}

export const sitingStage = defineStage<SitingInput, SitingOutput>({
  id: 'siting',
  version: 2,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.terrain.key}|${i.year}|${i.anchorYear ?? ''}|${JSON.stringify(i.settlements)}|${JSON.stringify(i.policy)}|${i.seed}`,
  run(input, ctx) {
    const { terrain, year } = input;
    const anchorYear = input.anchorYear ?? year;
    const { height, water, slope, distToSea, distToWater } = terrain;
    const { width, height: rows, cellSizeM } = height;
    const n = width * rows;
    const rng = ctx.rng;
    let seaCells = 0;
    for (let i = 0; i < n; i++) if (water[i] === WATER.sea) seaCells++;
    const regionCoastal = seaCells > n * 0.03;
    const specs = input.settlements.length
      ? input.settlements
      : synthesiseSpecs(rng.fork('specs'), input.policy, regionCoastal);

    // Connected landmasses (4-neighbour; rivers count as land) so nothing lands on an islet.
    const component = new Int32Array(n).fill(-1);
    const componentArea: number[] = [];
    {
      const stack: number[] = [];
      for (let seed = 0; seed < n; seed++) {
        if (component[seed] !== -1 || water[seed] === WATER.sea || water[seed] === WATER.lake) continue;
        const id = componentArea.length;
        let area = 0;
        component[seed] = id;
        stack.push(seed);
        while (stack.length) {
          const i = stack.pop()!;
          area++;
          const c = i % width;
          const r = (i / width) | 0;
          for (const j of [
            c > 0 ? i - 1 : -1,
            c < width - 1 ? i + 1 : -1,
            r > 0 ? i - width : -1,
            r < rows - 1 ? i + width : -1,
          ]) {
            if (j < 0 || component[j] !== -1 || water[j] === WATER.sea || water[j] === WATER.lake) continue;
            component[j] = id;
            stack.push(j);
          }
        }
        componentArea.push(area);
      }
    }
    const mainland = componentArea.reduce((best, a, i) => (a > componentArea[best]! ? i : best), 0);
    /** Land fraction on a ring of radius r around a cell. */
    const landAround = (i: number, r: number): number => {
      const cx = i % width;
      const cy = (i / width) | 0;
      const rc = r / cellSizeM;
      let land = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const c = Math.round(cx + Math.cos(a) * rc);
        const rr = Math.round(cy + Math.sin(a) * rc);
        if (c < 0 || rr < 0 || c >= width || rr >= rows) continue;
        const w = water[rr * width + c]!;
        if (w === WATER.land || w === WATER.river) land++;
      }
      return land / 16;
    };

    // Candidate cells: land, gentle, above the sea. Sampled deterministically.
    const candRng = rng.fork('candidates');
    const candidates: number[] = [];
    const target = Math.min(6000, Math.max(500, Math.floor(n / 40)));
    for (let k = 0; k < target * 4 && candidates.length < target; k++) {
      const i = candRng.int(0, n - 1);
      if (water[i] !== WATER.land && water[i] !== WATER.river) continue;
      if (slope[i]! > 0.12) continue;
      if (height.data[i]! < terrain.seaLevel + 1) continue;
      candidates.push(i);
    }
    const halfW = ((width - 1) * cellSizeM) / 2;
    const halfH = ((rows - 1) * cellSizeM) / 2;
    const maxDist = Math.hypot(halfW, halfH);

    const ordered = [...specs].sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1));
    const placed: SettlementSite[] = [];
    for (const spec of ordered) {
      // Placement uses the anchor-year footprint so the site does not move when the year does.
      const radiusM = radiusForPopulation(spec.population, anchorYear);
      const wantsCoast = spec.kind === 'portTown' || spec.kind === 'fishingVillage' || spec.kind === 'resort';
      const wantsRiver = spec.kind === 'millTown';
      let best: { i: number; score: number } | null = null;
      let center: [number, number] | null = spec.site?.center ?? null;
      if (!center) {
        for (const i of candidates) {
          const x = height.x(i % width);
          const y = height.y((i / width) | 0);
          // Hard constraints.
          if (Math.abs(x) > halfW - radiusM * 0.6 || Math.abs(y) > halfH - radiusM * 0.6) continue;
          if (wantsCoast && distToSea[i]! > radiusM * 0.9 + 300) continue;
          // Room to grow: on the mainland (or an island several times the town's area) with
          // most of the ground around the centre dry.
          const comp = component[i]!;
          const areaM2 = componentArea[comp]! * cellSizeM * cellSizeM;
          if (comp !== mainland && areaM2 < Math.PI * radiusM * radiusM * 4) continue;
          if (landAround(i, radiusM * 0.7) < 0.6) continue;
          let score = 1 - slope[i]! / 0.12;
          const dSea = distToSea[i]!;
          const dWater = distToWater[i]!;
          if (wantsCoast) score += 1.5 * (1 - Math.min(dSea, 1500) / 1500);
          else if (wantsRiver) score += 1.5 * (1 - Math.min(dWater, 800) / 800);
          else score += 0.6 * (1 - Math.min(dWater, 2500) / 2500);
          if (spec.kind === 'city' || spec.kind === 'metropolis')
            score += 0.8 * (1 - Math.hypot(x, y) / maxDist);
          // Avoid sitting in the sea's reach but not flooding: prefer a few metres above sea level.
          const hAbove = height.data[i]! - terrain.seaLevel;
          if (hAbove < 3) score -= 0.5;
          // Separation from placed settlements.
          let ok = true;
          for (const p of placed) {
            const d = Math.hypot(p.center[0] - x, p.center[1] - y);
            const minD = (p.radiusM + radiusM) * 2.5 + 800;
            if (d < minD) {
              ok = false;
              break;
            }
            score += 0.15 * Math.min(1, d / 15_000);
          }
          if (!ok) continue;
          score += candRng.range(0, 0.15);
          if (!best || score > best.score) best = { i, score };
        }
        if (!best) continue; // nowhere to put it; reported through stats
        center = [height.x(best.i % width), height.y((best.i / width) | 0)];
      }
      const ci = Math.min(Math.max(Math.round(height.col(center[0])), 0), width - 1);
      const ri = Math.min(Math.max(Math.round(height.row(center[1])), 0), rows - 1);
      const idx = ri * width + ci;
      const founded =
        spec.founded ??
        Math.min(
          anchorYear,
          spec.kind === 'city' || spec.kind === 'town' || spec.kind === 'portTown' ? 1250 : 1500,
        );
      const history: SettlementHistory = {
        founded,
        anchorYear,
        anchorPopulation: spec.population,
        ...(spec.growth?.length ? { points: spec.growth } : {}),
      };
      const populationNow = Math.max(1, populationAt(history, Math.max(year, founded)));
      placed.push({
        id: spec.id,
        kind: spec.kind,
        name: spec.name,
        population: populationNow,
        center,
        radiusM: year >= founded ? radiusAt(history, year) : radiusForPopulation(populationNow, year),
        founded,
        history,
        anchorPopulation: spec.population,
        spec,
        coastal: distToSea[idx]! < radiusM + 300,
        riverside: distToWater[idx]! < radiusM && distToSea[idx]! > radiusM,
      });
      ctx.checkpoint();
    }
    const points: SitingOutput['points'] = placed.map((s) => ({
      type: 'Feature',
      id: `settlement-${s.id}`,
      geometry: { type: 'Point', coordinates: s.center },
      properties: { kind: s.kind, population: s.population, name: s.name, radiusM: s.radiusM },
    }));
    return { key: ctx.key, sites: placed, points };
  },
});
