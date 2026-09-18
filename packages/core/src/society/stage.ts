import type { FeatureCollection, Polygon } from 'geojson';
import { defineStage } from '../pipeline/stage.js';
import { Raster, type RasterSpec } from '../raster/raster.js';
import { Simplex2, fbm } from '../raster/noise.js';
import { contourPolygons, smoothLine, simplifyLine } from '../raster/contours.js';
import { WATER, type TerrainOutput } from '../terrain/stage.js';
import type { SettlementSite } from '../settlement/siting.js';
import { distToPolyline, type FieldEdit } from '../document/authored.js';

/**
 * Region stage R4: wealth and density fields (DESIGN §6.2). Both are scalar
 * rasters in [0, 1] on a coarse grid. Density follows settlement centres and
 * flat ground; wealth follows elevation advantage, waterfront amenity, the
 * upwind side of town and distance from flood risk, shifted by the era and
 * spread by the inequality parameter. Nuisance from industry is added by the
 * placement engine in a later phase through `nuisance`.
 */

export interface FieldParams {
  baseline: number;
  gradient: number;
  noise: number;
}

export interface SocietyInput {
  seed: string;
  terrain: TerrainOutput;
  sites: SettlementSite[];
  year: number;
  wealth: FieldParams;
  density: FieldParams;
  inequality: number;
  /** Prevailing wind direction the air comes from, radians (0 = from the east). */
  windFrom?: number;
  /** Optional nuisance sources: [x, y, radiusM, strength]. */
  nuisance?: [number, number, number, number][];
  /** Hand-painted adjustments applied after the model. */
  edits?: FieldEdit[];
}

export const WEALTH_CLASSES = ['slum', 'poor', 'modest', 'comfortable', 'affluent', 'elite'] as const;
export const DENSITY_CLASSES = ['rural', 'suburban', 'low', 'medium', 'high', 'core'] as const;
export type WealthClass = (typeof WEALTH_CLASSES)[number];
export type DensityClass = (typeof DENSITY_CLASSES)[number];

export interface SocietyOutput {
  key: string;
  raster: RasterSpec;
  wealth: Float32Array;
  density: Float32Array;
  landValue: Float32Array;
  wealthPolygons: FeatureCollection<Polygon, { kind: 'wealth'; class: WealthClass; level: number }>;
  densityPolygons: FeatureCollection<Polygon, { kind: 'density'; class: DensityClass; level: number }>;
  /** Sample both fields at a world position. */
  sample(
    x: number,
    y: number,
  ): { wealth: number; density: number; wealthClass: WealthClass; densityClass: DensityClass };
}

export function wealthClassOf(v: number): WealthClass {
  return WEALTH_CLASSES[Math.min(5, Math.max(0, Math.floor(v * 6)))]!;
}
export function densityClassOf(v: number): DensityClass {
  return DENSITY_CLASSES[Math.min(5, Math.max(0, Math.floor(v * 6)))]!;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const societyStage = defineStage<SocietyInput, SocietyOutput>({
  id: 'society',
  version: 1,
  seedOf: (i) => i.seed,
  keyOf: (i) =>
    `${i.terrain.key}|${i.seed}|${i.year}|${JSON.stringify([i.wealth, i.density, i.inequality, i.windFrom, i.nuisance, i.edits])}|${JSON.stringify(i.sites.map((s) => [s.id, s.center, s.population, s.radiusM]))}`,
  run(input, ctx) {
    const { terrain, sites, year } = input;
    const fine = terrain.height;
    const step = fine.width * fine.height > 100_000 ? 2 : 1;
    const width = Math.ceil(fine.width / step);
    const rows = Math.ceil(fine.height / step);
    const grid = new Raster({
      width,
      height: rows,
      cellSizeM: fine.cellSizeM * step,
      originX: fine.originX,
      originY: fine.originY,
    });
    const n = width * rows;
    const wealth = new Float32Array(n);
    const density = new Float32Array(n);
    const landValue = new Float32Array(n);
    const noiseW = new Simplex2(`${input.seed}/wealth`);
    const noiseD = new Simplex2(`${input.seed}/density`);
    const maxPop = Math.max(1, ...sites.map((s) => s.population));
    const windFrom = input.windFrom ?? Math.PI; // from the west by default
    const wx = Math.cos(windFrom);
    const wy = Math.sin(windFrom);
    const eraShift = year < 1850 ? 0.15 : year < 1950 ? 0.05 : -0.1; // pre-industrial towns are dense
    const spread = 0.6 + input.inequality * 1.4;

    for (let row = 0; row < rows; row++) {
      const y = grid.y(row);
      const fr = Math.min(row * step, fine.height - 1);
      for (let col = 0; col < width; col++) {
        const x = grid.x(col);
        const fc = Math.min(col * step, fine.width - 1);
        const fi = fr * fine.width + fc;
        const i = row * width + col;
        const w = terrain.water[fi]!;
        if (w === WATER.sea || w === WATER.lake) {
          wealth[i] = 0;
          density[i] = 0;
          continue;
        }
        // Settlement influence: nearest-dominant kernel, weighted by population.
        let centre = 0;
        let upwind = 0;
        let nearestR = 1;
        let nearestD = Infinity;
        for (const s of sites) {
          const dx = x - s.center[0];
          const dy = y - s.center[1];
          const d = Math.hypot(dx, dy);
          const scale = s.radiusM * 1.6;
          const k =
            Math.exp(-((d / scale) ** 2) * 0.7) *
            (0.45 + (0.55 * Math.log(s.population + 1)) / Math.log(maxPop + 1));
          if (k > centre) centre = k;
          if (d < nearestD) {
            nearestD = d;
            nearestR = s.radiusM;
            // Positive when the point lies on the side the wind comes from.
            upwind = d > 1 ? (dx * wx + dy * wy) / d : 0;
          }
        }
        const slope = terrain.slope[fi]!;
        const flat = 1 - Math.min(slope / 0.15, 1);
        const h = terrain.height.data[fi]! - terrain.seaLevel;
        const dWater = terrain.distToWater[fi]!;
        const dSea = terrain.distToSea[fi]!;
        const nD = fbm(noiseD, x / 1800, y / 1800, { octaves: 3 });
        const nW = fbm(noiseW, x / 1400 + 7.3, y / 1400 - 2.1, { octaves: 3 });

        const dRaw =
          (input.density.baseline - 0.5) * 2 +
          input.density.gradient * (centre * 3.2 - 1.3) +
          0.5 * flat +
          eraShift +
          input.density.noise * nD * 1.5;
        density[i] = sigmoid(dRaw * 1.6);

        // Elevation advantage relative to the nearest settlement's typical height: hills with views.
        const elevationAdvantage = Math.tanh(Math.max(0, h) / 60) * 0.8 - Math.max(0, 3 - h) * 0.15;
        const waterfront = dSea < 400 ? 0.6 : dWater < 300 ? 0.35 : 0;
        const floodRisk = h < 4 && dWater < 500 ? -0.5 : 0;
        let nuisance = 0;
        for (const [nx, ny, r, strength] of input.nuisance ?? []) {
          const d = Math.hypot(x - nx, y - ny);
          if (d < r) nuisance += strength * (1 - d / r);
        }
        const inTown = nearestD < nearestR * 1.8;
        const wRaw =
          (input.wealth.baseline - 0.5) * 2 +
          input.wealth.gradient * (elevationAdvantage + waterfront + (inTown ? upwind * 0.45 : 0)) +
          floodRisk -
          nuisance -
          (density[i]! - 0.5) * 0.35 +
          input.wealth.noise * nW * 1.6;
        wealth[i] = sigmoid(wRaw * spread);
        landValue[i] = 0.5 * density[i]! + 0.5 * wealth[i]!;
      }
      if ((row & 63) === 0) ctx.checkpoint();
    }
    // Painted adjustments: smooth falloff from the stroke, clamped to (0, 1] so land stays land.
    for (const e of input.edits ?? []) {
      const target = e.field === 'wealth' ? wealth : density;
      for (let row = 0; row < rows; row++) {
        const y = grid.y(row);
        for (let col = 0; col < width; col++) {
          const i = row * width + col;
          if (target[i] === 0) continue;
          const d = distToPolyline(grid.x(col), y, e.points);
          if (d > e.radiusM) continue;
          const t = 1 - d / e.radiusM;
          const w = t * t * (3 - 2 * t);
          target[i] = Math.min(1, Math.max(0.001, target[i]! + e.delta * w));
          landValue[i] = 0.5 * density[i]! + 0.5 * wealth[i]!;
        }
      }
    }
    ctx.progress(0.6, 'fields');

    const classPolys = <C extends string, K extends 'wealth' | 'density'>(
      field: Float32Array,
      classes: readonly C[],
      kind: K,
    ): FeatureCollection<Polygon, { kind: K; class: C; level: number }> => {
      const features: FeatureCollection<Polygon, { kind: K; class: C; level: number }>['features'] = [];
      const mask = new Float32Array(n);
      classes.forEach((cls, level) => {
        for (let i = 0; i < n; i++) {
          const v = field[i]!;
          const isWater = v === 0;
          mask[i] = !isWater && Math.min(5, Math.floor(v * 6)) === level ? 1 : 0;
        }
        let k = 0;
        for (const p of contourPolygons(grid, 0.5, mask)) {
          if (p.area < grid.cellSizeM * grid.cellSizeM * 4) continue;
          features.push({
            type: 'Feature',
            id: `${kind}-${cls}-${k++}`,
            geometry: {
              type: 'Polygon',
              coordinates: p.rings.map((r) => simplifyLine(smoothLine(r, 1, true), grid.cellSizeM * 0.2)),
            },
            properties: { kind, class: cls, level },
          });
        }
        ctx.checkpoint();
      });
      return { type: 'FeatureCollection', features };
    };
    const wealthPolygons = classPolys(wealth, WEALTH_CLASSES, 'wealth');
    const densityPolygons = classPolys(density, DENSITY_CLASSES, 'density');
    const wealthRaster = new Raster(grid.spec, wealth);
    const densityRaster = new Raster(grid.spec, density);
    return {
      key: ctx.key,
      raster: grid.spec,
      wealth,
      density,
      landValue,
      wealthPolygons,
      densityPolygons,
      sample(x, y) {
        const wv = wealthRaster.sample(x, y);
        const dv = densityRaster.sample(x, y);
        return { wealth: wv, density: dv, wealthClass: wealthClassOf(wv), densityClass: densityClassOf(dv) };
      },
    };
  },
});
