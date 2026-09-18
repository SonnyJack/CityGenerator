import type { LegacyTile } from 'geojson-vt';
import { generateBlock, type BlockModel, type BlockRecipe } from '@citygen/core';
import { encodeTileLayer, tileProjection } from './mvt.js';
import type { TileLayerProvider } from './builder.js';

/**
 * Lazy block content for tiles: blocks intersecting a tile are generated on
 * demand (LRU-cached by block id) and encoded directly into the tile. Buildings
 * appear from `minZoom`; parcels one zoom level later.
 */
export class BlockTiler implements TileLayerProvider {
  private readonly cache = new Map<string, BlockModel>();
  private readonly boxes: { minX: number; minY: number; maxX: number; maxY: number; block: BlockRecipe }[];
  readonly minZoom: number;

  constructor(
    private readonly blocks: BlockRecipe[],
    private readonly year: number,
    options: { minZoom?: number; maxCached?: number } = {},
  ) {
    this.minZoom = options.minZoom ?? 13;
    this.maxCached = options.maxCached ?? 4000;
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
    const m = generateBlock(block, this.year);
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
