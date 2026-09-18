import type { LegacyTile } from 'geojson-vt';
import {
  centroid,
  distToPolyline,
  generateBlock,
  pointInRing,
  type BlockModel,
  type BlockOptions,
  type BlockRecipe,
} from '@citygen/core';
import type { Feature, Geometry } from 'geojson';
import { encodeTileLayer, tileProjection } from './mvt.js';
import type { TileLayerProvider } from './builder.js';

export interface BlockTilerOptions {
  minZoom?: number;
  maxCached?: number;
  /** Authored buildings, zones (polygons) and streets/rail (lines): generated buildings under them are dropped. */
  authored?: Feature<Geometry, Record<string, unknown>>[];
  /** Generated feature ids hidden by `suppress` overrides. */
  suppressIds?: string[];
  /** `reroll` overrides: blocks inside the polygon draw from a salted seed. */
  rerolls?: { polygon: [number, number][]; salt: string }[];
  /** Culture, addresses and names for the buildings. */
  block?: BlockOptions;
}

/**
 * Lazy block content for tiles: blocks intersecting a tile are generated on
 * demand (LRU-cached by block id) and encoded directly into the tile. Buildings
 * appear from `minZoom`; parcels one zoom level later.
 */
export class BlockTiler implements TileLayerProvider {
  private readonly cache = new Map<string, BlockModel>();
  private readonly boxes: { minX: number; minY: number; maxX: number; maxY: number; block: BlockRecipe }[];
  readonly minZoom: number;

  private readonly suppressPolygons: [number, number][][] = [];
  private readonly suppressLines: { points: [number, number][]; radiusM: number }[] = [];
  private readonly suppressIds: Set<string>;
  private readonly rerolls: { polygon: [number, number][]; salt: string }[];

  constructor(
    private readonly blocks: BlockRecipe[],
    private readonly year: number,
    options: BlockTilerOptions = {},
  ) {
    this.minZoom = options.minZoom ?? 13;
    this.maxCached = options.maxCached ?? 4000;
    this.blockOptions = options.block ?? {};
    this.suppressIds = new Set(options.suppressIds ?? []);
    this.rerolls = options.rerolls ?? [];
    for (const f of options.authored ?? []) {
      const g = f.geometry;
      if (g.type === 'Polygon') this.suppressPolygons.push(g.coordinates[0]!.map((p) => [p[0]!, p[1]!]));
      else if (g.type === 'LineString') {
        const w = typeof f.properties?.widthM === 'number' ? f.properties.widthM : 8;
        this.suppressLines.push({ points: g.coordinates.map((p) => [p[0]!, p[1]!]), radiusM: w / 2 + 1 });
      }
    }
    this.boxes = blocks.map((block) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of block.ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY, block };
    });
  }

  private readonly maxCached: number;
  private readonly blockOptions: BlockOptions;

  get blockCount(): number {
    return this.blocks.length;
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  model(block: BlockRecipe): BlockModel {
    const hit = this.cache.get(block.id);
    if (hit) {
      // Refresh recency.
      this.cache.delete(block.id);
      this.cache.set(block.id, hit);
      return hit;
    }
    // Re-roll: blocks inside a reroll polygon draw from a salted seed.
    const c = centroid(block.ring);
    const salts = this.rerolls.filter((r) => pointInRing(c[0], c[1], r.polygon)).map((r) => r.salt);
    const recipe = salts.length ? { ...block, seed: `${block.seed}/${salts.join('+')}` } : block;
    const raw = generateBlock(recipe, this.year, this.blockOptions);
    // Conflicts are resolved in favour of the user: drop generated buildings under authored geometry.
    const keep = (f: Feature<Geometry, { block: string }>) => {
      const id = String(f.id);
      if (this.suppressIds.has(id)) return false;
      if (f.geometry.type !== 'Polygon') return true;
      const bc = centroid(f.geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]));
      for (const poly of this.suppressPolygons) if (pointInRing(bc[0], bc[1], poly)) return false;
      for (const line of this.suppressLines)
        if (distToPolyline(bc[0], bc[1], line.points) <= line.radiusM) return false;
      return true;
    };
    const m: BlockModel =
      this.suppressPolygons.length || this.suppressLines.length || this.suppressIds.size
        ? { ...raw, buildings: raw.buildings.filter(keep) }
        : raw;
    this.cache.set(block.id, m);
    if (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return m;
  }

  getTile(z: number, x: number, y: number): Record<string, LegacyTile> | null {
    if (z < this.minZoom) return null;
    const proj = tileProjection(z, x, y);
    const hits = this.boxes.filter(
      (b) => b.maxX >= proj.minX && b.minX <= proj.maxX && b.maxY >= proj.minY && b.minY <= proj.maxY,
    );
    if (!hits.length) return null;
    const buildings = [];
    const parcels = [];
    for (const h of hits) {
      const m = this.model(h.block);
      buildings.push(...m.buildings);
      if (z >= this.minZoom + 1) parcels.push(...m.parcels);
    }
    const out: Record<string, LegacyTile> = {};
    const b = encodeTileLayer(buildings, proj);
    if (b) out.buildings = b;
    const p = encodeTileLayer(parcels, proj);
    if (p) out.parcels = p;
    return Object.keys(out).length ? out : null;
  }
}
