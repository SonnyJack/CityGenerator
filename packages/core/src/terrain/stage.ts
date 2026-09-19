import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { Raster, type RasterSpec } from '../raster/raster.js';
import { Simplex2, fbm, warpedFbm } from '../raster/noise.js';
import { contourLines, contourPolygons, smoothLine, simplifyLine, type Ring } from '../raster/contours.js';
import { defineStage } from '../pipeline/stage.js';
import { computeFlow, diffuse, distanceTo, erodeStep, fillDepressions, slopeAspect } from './hydrology.js';
import { extractRivers, type RiverReach } from './rivers.js';
import { presetShape, type TerrainPresetId } from './presets.js';
import { DEFAULT_BIOME, type BiomeTerrainParams } from './biome.js';
import { distToPolyline, type TerrainEdit } from '../document/authored.js';

/** Water classes in the `water` mask. */
export const WATER = { land: 0, sea: 1, lake: 2, river: 3 } as const;

export interface TerrainInput {
  seed: string;
  extent: { widthM: number; heightM: number };
  preset: TerrainPresetId;
  relief: number;
  roughness: number;
  seaLevel: number;
  rivers: { major: number; minor: number };
  /** 0..1 — fluvial erosion passes that carve valleys and drain basins (default 0.5). */
  erosion?: number;
  biome?: BiomeTerrainParams;
  /** Override the base cell size (metres); defaults from the extent. */
  cellSizeM?: number;
  /** Imported heights replacing the synthetic field (row-major, south row first). */
  imported?: { width: number; height: number; data: Float32Array; minM: number; maxM: number };
  /** Hand-authored brush strokes applied after synthesis (DESIGN §6.1). */
  edits?: TerrainEdit[];
}

export interface TerrainOutput {
  /** Memo key of the run; downstream stages key on it. */
  key: string;
  /** Original heights (metres); sea cells carry bathymetry (negative relative to sea level). */
  height: Raster;
  /** Depression-filled heights used for drainage. */
  filled: Raster;
  water: Uint8Array;
  slope: Float32Array;
  aspect: Float32Array;
  distToWater: Float32Array;
  distToSea: Float32Array;
  /** Distance to the sea or a lake (rivers excluded), for tests that bridge rivers. */
  distToStillWater?: Float32Array;
  accumulation: Float32Array;
  seaLevel: number;
  rivers: RiverReach[];
  riverLines: FeatureCollection<LineString, { kind: 'river'; widthM: number; order: number; areaM2: number }>;
  seaPolygons: FeatureCollection<Polygon, { kind: 'sea' }>;
  lakePolygons: FeatureCollection<Polygon, { kind: 'lake'; areaM2: number }>;
  contours: FeatureCollection<LineString, { kind: 'contour'; elevation: number; major: boolean }>;
  contourIntervalM: number;
  stats: {
    minM: number;
    maxM: number;
    landFraction: number;
    riverKm: number;
    lakes: number;
    cellSizeM: number;
    cells: number;
  };
}

/** Base cell size: about 768 cells on the long side, rounded up to 5 m, at least 10 m. */
export function baseCellSize(extent: { widthM: number; heightM: number }): number {
  const longest = Math.max(extent.widthM, extent.heightM);
  return Math.max(10, Math.ceil(longest / 768 / 5) * 5);
}

/** Contour interval for a given vertical range. */
export function contourInterval(rangeM: number): number {
  if (rangeM > 1500) return 100;
  if (rangeM > 600) return 50;
  if (rangeM > 250) return 20;
  if (rangeM > 80) return 10;
  return 5;
}

export const terrainStage = defineStage<TerrainInput, TerrainOutput>({
  id: 'terrain',
  version: 1,
  seedOf: (input) => input.seed,
  keyOf: (input) => {
    const { imported, ...rest } = input;
    const importedKey = imported
      ? `${imported.width}x${imported.height}:${imported.minM}:${imported.maxM}:${hashFloat32(imported.data)}`
      : '';
    return JSON.stringify(rest) + importedKey;
  },
  run(input, ctx) {
    const biome = input.biome ?? DEFAULT_BIOME;
    const cellSizeM = input.cellSizeM ?? baseCellSize(input.extent);
    const height = Raster.forExtent(input.extent.widthM, input.extent.heightM, cellSizeM);
    const { width, height: rows } = height;
    const n = width * rows;
    const shape = presetShape(input.preset, ctx.rng.fork('preset'));

    // --- 1. Heights ---------------------------------------------------------
    if (input.imported) {
      const src = new Raster(
        {
          width: input.imported.width,
          height: input.imported.height,
          cellSizeM: input.extent.widthM / Math.max(1, input.imported.width - 1),
          originX: -input.extent.widthM / 2,
          originY: -input.extent.heightM / 2,
        },
        input.imported.data,
      );
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < width; col++) height.set(col, row, src.sample(height.x(col), height.y(row)));
    } else {
      const noise = new Simplex2(`${input.seed}/height`);
      const warp = new Simplex2(`${input.seed}/warp`);
      const longest = Math.max(input.extent.widthM, input.extent.heightM);
      const wavelength = longest / 3.5;
      const maxElev = 60 + 900 * input.relief * shape.reliefScale;
      const octaves = 5 + Math.round(input.roughness * 3);
      const persistence = 0.42 + 0.18 * input.roughness;
      const ridged = shape.ridged * (0.4 + 0.6 * input.roughness);
      const halfW = input.extent.widthM / 2;
      const halfH = input.extent.heightM / 2;
      for (let row = 0; row < rows; row++) {
        const y = height.y(row);
        for (let col = 0; col < width; col++) {
          const x = height.x(col);
          const base = shape.base(x / halfW, y / halfH);
          const nz = warpedFbm(noise, warp, x / wavelength, y / wavelength, 0.35, {
            octaves,
            persistence,
            ridged,
          });
          const h = base + nz * shape.noiseWeight * (0.55 + 0.45 * input.roughness);
          height.set(col, row, h * maxElev);
        }
      }
    }
    ctx.checkpoint();
    applyTerrainEdits(height, input.edits ?? []);
    ctx.checkpoint();
    ctx.progress(0.25, 'heights');

    // --- 2. Sea, bathymetry, depression filling -----------------------------
    const seaLevel = input.seaLevel;
    const water = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (height.data[i]! < seaLevel) water[i] = WATER.sea;
    const landMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) landMask[i] = water[i] === WATER.sea ? 0 : 1;
    const distToSea = distanceTo(
      water.map((w) => (w === WATER.sea ? 1 : 0)),
      width,
      rows,
      cellSizeM,
    );
    const distToLand = distanceTo(landMask, width, rows, cellSizeM);
    // Deepen the sea away from the coast so harbours and ports can find deep water.
    for (let i = 0; i < n; i++) {
      if (water[i] === WATER.sea) {
        const shelf = seaLevel - distToLand[i]! * 0.025;
        if (height.data[i]! > shelf) height.data[i] = shelf;
      }
    }
    // Fluvial erosion: a few explicit steps carve valleys and cut outlets through basin rims.
    const erosionPasses = Math.round((input.erosion ?? 0.5) * 6);
    for (let pass = 0; pass < erosionPasses; pass++) {
      const step = fillDepressions(height, seaLevel);
      const stepFlow = computeFlow(step.filled, seaLevel, step.order);
      erodeStep(height, stepFlow, water, 0.55, cellSizeM);
      diffuse(height, water, 0.08);
      ctx.checkpoint();
      ctx.progress(0.3 + (0.12 * (pass + 1)) / erosionPasses, 'erosion');
    }
    // Basins: keep a few of the deepest as lakes (scaled by region area and wetness); raise the
    // rest to their spill level so they become flat valley floors that drain.
    const basins = fillDepressions(height, seaLevel);
    const regionKm2 = (input.extent.widthM * input.extent.heightM) / 1e6;
    const maxLakes = Math.max(1, Math.round((regionKm2 * (0.3 + biome.wetness)) / 45));
    const lake = selectLakes(basins.lake, height.data, basins.filled.data, width, rows, {
      minDepthM: 3,
      minCells: 6,
      maxLakes,
      maxFraction: 0.03 * n,
    });
    for (let i = 0; i < n; i++) {
      if (basins.lake[i] && !lake[i]) height.data[i] = basins.filled.data[i]!;
    }
    const { filled, order } = fillDepressions(height, seaLevel);
    for (let i = 0; i < n; i++) if (lake[i]) water[i] = WATER.lake;
    ctx.checkpoint();
    ctx.progress(0.45, 'hydrology');

    // --- 3. Flow and rivers -------------------------------------------------
    const flow = computeFlow(filled, seaLevel, order);
    const drainageThreshold =
      4.5e6 / (0.25 + biome.wetness) / (1 + 0.2 * input.rivers.minor + 0.5 * input.rivers.major);
    const { reaches, riverMask } = extractRivers(filled, flow, water, drainageThreshold);
    for (let i = 0; i < n; i++) if (riverMask[i] && water[i] === WATER.land) water[i] = WATER.river;
    ctx.checkpoint();
    ctx.progress(0.6, 'rivers');

    // --- 4. Derived rasters -------------------------------------------------
    const { slope, aspect } = slopeAspect(height);
    const anyWater = new Uint8Array(n);
    for (let i = 0; i < n; i++) anyWater[i] = water[i] === WATER.land ? 0 : 1;
    const distToWater = distanceTo(anyWater, width, rows, cellSizeM);
    const stillWater = new Uint8Array(n);
    for (let i = 0; i < n; i++) stillWater[i] = water[i] === WATER.sea || water[i] === WATER.lake ? 1 : 0;
    const distToStillWater = distanceTo(stillWater, width, rows, cellSizeM);
    ctx.checkpoint();

    // --- 5. Vector outputs --------------------------------------------------
    const seaField = new Float32Array(n);
    for (let i = 0; i < n; i++) seaField[i] = seaLevel - height.data[i]!;
    const seaPolygons: TerrainOutput['seaPolygons'] = {
      type: 'FeatureCollection',
      features: contourPolygons(height, 0, seaField).map((p, i) =>
        polygonFeature(`sea-${i}`, p.rings, { kind: 'sea' }),
      ),
    };
    const lakeField = new Float32Array(n);
    for (let i = 0; i < n; i++) lakeField[i] = lake[i] ? 1 : 0;
    const minLakeArea = 4 * cellSizeM * cellSizeM;
    const lakePolygons: TerrainOutput['lakePolygons'] = {
      type: 'FeatureCollection',
      features: contourPolygons(height, 0.5, lakeField)
        .filter((p) => p.area >= minLakeArea)
        .map((p, i) =>
          polygonFeature(
            `lake-${i}`,
            p.rings.map((r) => simplifyLine(smoothLine(r, 1, true), cellSizeM * 0.2)),
            { kind: 'lake', areaM2: p.area },
          ),
        ),
    };
    ctx.checkpoint();
    ctx.progress(0.75, 'water polygons');

    const riverLines: TerrainOutput['riverLines'] = {
      type: 'FeatureCollection',
      features: reaches.map((r, i) => ({
        type: 'Feature',
        id: `river-${i}`,
        geometry: { type: 'LineString', coordinates: r.points },
        properties: { kind: 'river', widthM: r.widthM, order: r.order, areaM2: r.areaM2 },
      })),
    };

    let minM = Infinity;
    let maxM = -Infinity;
    let landCells = 0;
    for (let i = 0; i < n; i++) {
      const h = height.data[i]!;
      if (h < minM) minM = h;
      if (h > maxM) maxM = h;
      if (water[i] !== WATER.sea) landCells++;
    }
    const interval = contourInterval(maxM - Math.max(seaLevel, minM));
    const contourFeatures: TerrainOutput['contours']['features'] = [];
    const firstLevel = Math.ceil((Math.max(minM, seaLevel) + 1e-6) / interval) * interval;
    let li = 0;
    for (let level = firstLevel; level < maxM; level += interval) {
      // Skip contours through the sea by contouring the land-only field.
      for (const line of contourLines(height, level)) {
        const pts = simplifyLine(smoothLine(line, 1), cellSizeM * 0.2);
        if (pts.length < 2) continue;
        contourFeatures.push({
          type: 'Feature',
          id: `contour-${li++}`,
          geometry: { type: 'LineString', coordinates: pts },
          properties: { kind: 'contour', elevation: level, major: Math.round(level / interval) % 5 === 0 },
        });
      }
      ctx.checkpoint();
    }
    ctx.progress(0.95, 'contours');

    let riverKm = 0;
    for (const r of reaches) {
      for (let i = 1; i < r.points.length; i++) {
        const [x0, y0] = r.points[i - 1]!;
        const [x1, y1] = r.points[i]!;
        riverKm += Math.hypot(x1 - x0, y1 - y0) / 1000;
      }
    }

    return {
      key: ctx.key,
      height,
      filled,
      water,
      slope,
      aspect,
      distToWater,
      distToSea,
      distToStillWater,
      accumulation: flow.accumulation,
      seaLevel,
      rivers: reaches,
      riverLines,
      seaPolygons,
      lakePolygons,
      contours: { type: 'FeatureCollection', features: contourFeatures },
      contourIntervalM: interval,
      stats: {
        minM,
        maxM,
        landFraction: landCells / n,
        riverKm,
        lakes: lakePolygons.features.length,
        cellSizeM,
        cells: n,
      },
    };
  },
});

interface LakeSelection {
  minDepthM: number;
  minCells: number;
  maxLakes: number;
  /** Maximum total lake cells. */
  maxFraction: number;
}

/**
 * Choose which filled basins remain as lakes: connected components at least
 * `minDepthM` deep and `minCells` large, the largest by volume first, up to
 * `maxLakes` and `maxFraction` cells in total.
 */
function selectLakes(
  raw: Uint8Array,
  height: Float32Array,
  filled: Float32Array,
  width: number,
  rows: number,
  opts: LakeSelection,
): Uint8Array {
  const n = width * rows;
  const out = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const candidates: { cells: number[]; volume: number; start: number }[] = [];
  for (let start = 0; start < n; start++) {
    if (!raw[start] || seen[start]) continue;
    const cells: number[] = [];
    let deepest = 0;
    let volume = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const depth = filled[i]! - height[i]!;
      volume += depth;
      if (depth > deepest) deepest = depth;
      const col = i % width;
      const row = (i / width) | 0;
      const visit = (j: number) => {
        if (raw[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (col > 0) visit(i - 1);
      if (col < width - 1) visit(i + 1);
      if (row > 0) visit(i - width);
      if (row < rows - 1) visit(i + width);
    }
    if (deepest >= opts.minDepthM && cells.length >= opts.minCells) candidates.push({ cells, volume, start });
  }
  candidates.sort((a, b) => b.volume - a.volume || a.start - b.start);
  let total = 0;
  let kept = 0;
  for (const c of candidates) {
    if (kept >= opts.maxLakes || total + c.cells.length > opts.maxFraction) continue;
    for (const i of c.cells) out[i] = 1;
    total += c.cells.length;
    kept++;
  }
  return out;
}

function polygonFeature<P>(id: string, rings: Ring[], properties: P): Feature<Polygon, P> {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: rings }, properties };
}

/**
 * Replay brush strokes on the heightmap. Each stroke affects cells within its
 * radius with a smooth falloff; ops: raise/lower by `amount` metres, flatten
 * (and water: flatten below sea level) toward `amount` metres, smooth toward
 * the local mean with strength `amount` in [0, 1].
 */
export function applyTerrainEdits(height: Raster, edits: TerrainEdit[]): void {
  for (const e of edits) {
    if (!e.points.length) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of e.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const c0 = Math.max(0, Math.floor(height.col(minX - e.radiusM)));
    const c1 = Math.min(height.width - 1, Math.ceil(height.col(maxX + e.radiusM)));
    const r0 = Math.max(0, Math.floor(height.row(minY - e.radiusM)));
    const r1 = Math.min(height.height - 1, Math.ceil(height.row(maxY + e.radiusM)));
    if (c1 < c0 || r1 < r0) continue;
    const before = e.op === 'smooth' ? new Float32Array(height.data) : null;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x = height.x(col);
        const y = height.y(row);
        const d = distToPolyline(x, y, e.points);
        if (d > e.radiusM) continue;
        const t = 1 - d / e.radiusM;
        const w = t * t * (3 - 2 * t);
        const i = row * height.width + col;
        const h = height.data[i]!;
        switch (e.op) {
          case 'raise':
            height.data[i] = h + e.amount * w;
            break;
          case 'lower':
            height.data[i] = h - e.amount * w;
            break;
          case 'flatten':
            height.data[i] = h + (e.amount - h) * w;
            break;
          case 'water':
            height.data[i] = h + (Math.min(e.amount, -2) - h) * w;
            break;
          case 'smooth': {
            let sum = 0;
            let n = 0;
            for (let dr = -2; dr <= 2; dr++)
              for (let dc = -2; dc <= 2; dc++) {
                const rr = row + dr;
                const cc = col + dc;
                if (rr < 0 || cc < 0 || rr >= height.height || cc >= height.width) continue;
                sum += before![rr * height.width + cc]!;
                n++;
              }
            height.data[i] = h + (sum / n - h) * w * Math.min(1, Math.max(0, e.amount));
            break;
          }
        }
      }
    }
  }
}

function hashFloat32(data: Float32Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 16777619);
    h2 = Math.imul(h2 + bytes[i]!, 2246822519) ^ (h2 >>> 15);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Land cover
// ---------------------------------------------------------------------------

export const LANDCOVER = {
  water: 0,
  snow: 1,
  rock: 2,
  marsh: 3,
  forest: 4,
  farmland: 5,
  open: 6,
  sand: 7,
  mangrove: 8,
} as const;
export type LandcoverClass = keyof typeof LANDCOVER;
const LANDCOVER_NAMES = Object.keys(LANDCOVER) as LandcoverClass[];

export interface LandcoverInput {
  terrain: TerrainOutput;
  biome: BiomeTerrainParams;
  seed: string;
  /** Hand-painted land cover: each stroke overwrites the classes under it (never the water). */
  edits?: { id: string; kind: string; points: [number, number][]; radiusM: number }[];
}

export interface LandcoverOutput {
  key: string;
  /** Class per cell of `raster` (which may be coarser than the terrain raster). */
  classes: Uint8Array;
  raster: RasterSpec;
  polygons: FeatureCollection<
    Polygon,
    {
      kind: LandcoverClass;
      forestKind?: BiomeTerrainParams['forestKind'];
      openKind?: BiomeTerrainParams['openKind'];
    }
  >;
  fractions: Record<LandcoverClass, number>;
}

export const landcoverStage = defineStage<LandcoverInput, LandcoverOutput>({
  id: 'landcover',
  version: 1,
  seedOf: (input) => input.seed,
  keyOf: (input) =>
    `${input.terrain.key}|${JSON.stringify(input.biome)}|${input.seed}|${JSON.stringify(input.edits ?? [])}`,
  run({ terrain, biome, seed, edits }, ctx) {
    const { water, slope, distToSea, distToWater, seaLevel } = terrain;
    // Land cover varies over kilometres, so classify on a coarser grid when the base raster is large.
    const step = terrain.height.width * terrain.height.height > 160_000 ? 2 : 1;
    const fine = terrain.height;
    const height = step === 1 ? fine : coarsen(fine, step);
    const { width, height: rows, cellSizeM } = height;
    const n = width * rows;
    const fineIndex = (col: number, row: number) =>
      Math.min(row * step, fine.height - 1) * fine.width + Math.min(col * step, fine.width - 1);
    const classes = new Uint8Array(n);
    const veg = new Simplex2(`${seed}/vegetation`);
    const farm = new Simplex2(`${seed}/farmland`);
    const wavelength = 2500;
    const counts = new Float64Array(LANDCOVER_NAMES.length);

    for (let row = 0; row < rows; row++) {
      const y = height.y(row);
      for (let col = 0; col < width; col++) {
        const i = row * width + col;
        const fi = fineIndex(col, row);
        const x = height.x(col);
        let cls: number;
        const h = height.data[i]!;
        const s = slope[fi]!;
        if (water[fi] === WATER.sea || water[fi] === WATER.lake) cls = LANDCOVER.water;
        else if (h > biome.snowLineM) cls = LANDCOVER.snow;
        else if (s > 0.55 || (h > biome.treeLineM && s > 0.3)) cls = LANDCOVER.rock;
        else if (
          s < 0.012 &&
          ((h < seaLevel + 2.5 && distToSea[fi]! < 900) || (distToWater[fi]! < 250 && h < seaLevel + 40))
        ) {
          cls = biome.coastKind === 'mangrove' && distToSea[fi]! < 900 ? LANDCOVER.mangrove : LANDCOVER.marsh;
        } else if (
          biome.openKind === 'desert' &&
          s < 0.05 &&
          0.5 + 0.5 * fbm(veg, x / wavelength, y / wavelength) > 0.55
        ) {
          cls = LANDCOVER.sand;
        } else {
          const v = 0.5 + 0.5 * fbm(veg, x / wavelength, y / wavelength, { octaves: 4 });
          const f =
            0.5 + 0.5 * fbm(farm, x / (wavelength * 1.6) + 3.1, y / (wavelength * 1.6) - 2.7, { octaves: 3 });
          const flat = s < 0.09 && h < biome.treeLineM * 0.8;
          const farmSuit = flat ? biome.farmland * (1 - Math.min(s / 0.09, 1) * 0.5) : 0;
          const forestBias = biome.forestCover + Math.min(s / 0.35, 1) * 0.35 - farmSuit * 0.4;
          if (biome.forestKind !== 'none' && h < biome.treeLineM && v < forestBias) cls = LANDCOVER.forest;
          else if (flat && f < farmSuit) cls = LANDCOVER.farmland;
          else cls = LANDCOVER.open;
        }
        classes[i] = cls;
        counts[cls] = counts[cls]! + 1;
      }
      if ((row & 63) === 0) ctx.checkpoint();
    }
    // Hand-painted cover: a stroke lays its class over the ground it passes, water aside.
    for (const e of edits ?? []) {
      const id = LANDCOVER[e.kind as LandcoverClass];
      if (id === undefined || id === LANDCOVER.water || !e.points.length) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of e.points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      const c0 = Math.max(0, Math.floor(height.col(minX - e.radiusM)));
      const c1 = Math.min(width - 1, Math.ceil(height.col(maxX + e.radiusM)));
      const r0 = Math.max(0, Math.floor(height.row(minY - e.radiusM)));
      const r1 = Math.min(rows - 1, Math.ceil(height.row(maxY + e.radiusM)));
      const r2 = e.radiusM * e.radiusM;
      for (let row = r0; row <= r1; row++) {
        const y = height.y(row);
        for (let col = c0; col <= c1; col++) {
          const i = row * width + col;
          if (classes[i] === LANDCOVER.water) continue;
          const x = height.x(col);
          let near = false;
          for (let k = 0; k < e.points.length && !near; k++) {
            const a = e.points[k]!;
            const b = e.points[Math.min(k + 1, e.points.length - 1)]!;
            const vx = b[0] - a[0];
            const vy = b[1] - a[1];
            const len2 = vx * vx + vy * vy;
            const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / len2)) : 0;
            const dx = x - (a[0] + vx * t);
            const dy = y - (a[1] + vy * t);
            near = dx * dx + dy * dy <= r2;
          }
          if (!near) continue;
          counts[classes[i]!] = counts[classes[i]!]! - 1;
          classes[i] = id;
          counts[id] = counts[id]! + 1;
        }
      }
      ctx.checkpoint();
    }
    ctx.progress(0.5, 'classified');

    const features: LandcoverOutput['polygons']['features'] = [];
    const field = new Float32Array(n);
    const minArea = 3 * cellSizeM * cellSizeM;
    for (const name of LANDCOVER_NAMES) {
      const id = LANDCOVER[name];
      if (id === LANDCOVER.water || counts[id] === 0) continue;
      for (let i = 0; i < n; i++) field[i] = classes[i] === id ? 1 : 0;
      const polys = contourPolygons(height, 0.5, field);
      let k = 0;
      for (const p of polys) {
        if (p.area < minArea) continue;
        const rings = p.rings.map((r) => simplifyLine(smoothLine(r, 1, true), cellSizeM * 0.2));
        features.push({
          type: 'Feature',
          id: `lc-${name}-${k++}`,
          geometry: { type: 'Polygon', coordinates: rings },
          properties: {
            kind: name,
            ...(name === 'forest' ? { forestKind: biome.forestKind } : {}),
            ...(name === 'open' ? { openKind: biome.openKind } : {}),
          },
        });
      }
      ctx.checkpoint();
    }
    const fractions = Object.fromEntries(
      LANDCOVER_NAMES.map((name) => [name, counts[LANDCOVER[name]]! / n]),
    ) as Record<LandcoverClass, number>;
    return {
      key: ctx.key,
      classes,
      raster: height.spec,
      polygons: { type: 'FeatureCollection', features },
      fractions,
    };
  },
});

/** Every `step`-th cell of a raster (nearest sampling), keeping the same origin. */
function coarsen(src: Raster, step: number): Raster {
  const width = Math.ceil(src.width / step);
  const height = Math.ceil(src.height / step);
  const out = new Raster({
    width,
    height,
    cellSizeM: src.cellSizeM * step,
    originX: src.originX,
    originY: src.originY,
  });
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      out.set(col, row, src.get(Math.min(col * step, src.width - 1), Math.min(row * step, src.height - 1)));
  return out;
}
