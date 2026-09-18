import * as Comlink from 'comlink';
import {
  StageRunner,
  computeFixtureHash,
  landcoverStage,
  regionOutlineStage,
  terrainStage,
  type MapDocument,
  type TerrainInput,
  type TerrainOutput,
} from '@citygen/core';
import { biomeTerrain } from '@citygen/features';
import {
  TileSource,
  createDemSampler,
  demTilePng,
  renderThumbnail,
  terrainLayers,
  type DemSampler,
} from '@citygen/tiles';
import type { EngineApi, EngineStats, Thumbnail } from './api.js';

/**
 * Engine worker: runs pipeline stages off the UI thread and serves vector and
 * DEM tiles to MapLibre. One StageRunner lives for the worker's lifetime so
 * unchanged stages are served from memo across document edits.
 */

const runner = new StageRunner({ maxEntries: 64 });
let version = 0;
let source: TileSource | null = null;
let dem: { sampler: DemSampler; extent: { widthM: number; heightM: number } } | null = null;
let controller: AbortController | null = null;

function terrainInput(doc: MapDocument, cellSizeM?: number): TerrainInput {
  const t = doc.spec.terrain;
  return {
    seed: doc.spec.seed,
    extent: doc.spec.extent,
    preset: t.preset,
    relief: t.relief,
    roughness: t.roughness,
    seaLevel: t.seaLevel,
    erosion: t.erosion,
    rivers: t.rivers,
    biome: biomeTerrain(doc.spec.biome),
    ...(cellSizeM ? { cellSizeM } : {}),
  };
}

const api: EngineApi = {
  async setDocument(doc, options) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const started = performance.now();

    const t0 = performance.now();
    const terrain: TerrainOutput = await runner.run(terrainStage, terrainInput(doc), { signal });
    const terrainMs = performance.now() - t0;

    const t1 = performance.now();
    const landcover = await runner.run(
      landcoverStage,
      { terrain, biome: biomeTerrain(doc.spec.biome), seed: doc.spec.seed },
      { signal },
    );
    const landcoverMs = performance.now() - t1;

    const outline = await runner.run(
      regionOutlineStage,
      { seed: doc.spec.seed, extent: doc.spec.extent },
      { signal },
    );

    const t2 = performance.now();
    version += 1;
    source = new TileSource(
      [
        { name: 'region', features: { type: 'FeatureCollection', features: [outline.boundary] } },
        { name: 'graticule', features: outline.graticule, minZoom: 9 },
        ...terrainLayers(terrain, landcover, options.sketch ? { sketch: { seed: doc.spec.seed } } : {}),
        { name: 'authored', features: doc.authored },
      ],
      version,
    );
    dem = { sampler: createDemSampler(terrain, doc.spec.seed), extent: doc.spec.extent };
    const tilesMs = performance.now() - t2;

    const stats: EngineStats = {
      terrainMs,
      landcoverMs,
      tilesMs,
      totalMs: performance.now() - started,
      memoHits: runner.hits,
      memoMisses: runner.misses,
      terrain: { ...terrain.stats, contourIntervalM: terrain.contourIntervalM },
    };
    return { version, stats };
  },

  async getTile(v, z, x, y) {
    if (!source || v !== source.version) return null;
    const data = source.getTile(z, x, y);
    if (!data) return null;
    return Comlink.transfer(data, [data.buffer as ArrayBuffer]);
  },

  async getDemTile(v, z, x, y) {
    if (!dem || !source || v !== source.version) return null;
    const png = await demTilePng(dem.sampler, dem.extent, z, x, y, 256);
    if (!png) return null;
    return Comlink.transfer(png, [png.buffer as ArrayBuffer]);
  },

  async thumbnails(doc, seeds, width, height) {
    const out: Thumbnail[] = [];
    // Coarse cells keep previews cheap: ~96 cells on the long side.
    const cellSizeM = Math.max(
      20,
      Math.ceil(Math.max(doc.spec.extent.widthM, doc.spec.extent.heightM) / 96 / 5) * 5,
    );
    for (const seed of seeds) {
      const terrain = await runner.run(terrainStage, { ...terrainInput(doc, cellSizeM), seed });
      out.push({ seed, width, height, rgba: renderThumbnail(terrain, width, height) });
    }
    return out;
  },

  fixtureHash: () => computeFixtureHash(),
};

Comlink.expose(api);
