import * as Comlink from 'comlink';
import { StageRunner, regionOutlineStage, computeFixtureHash, type MapDocument } from '@citygen/core';
import { TileSource } from '@citygen/tiles';
import type { EngineApi, EngineStats } from './api.js';

/**
 * Engine worker: runs pipeline stages off the UI thread and serves vector
 * tiles to MapLibre. One StageRunner lives for the worker's lifetime so
 * unchanged stages are served from memo across document edits.
 */

const runner = new StageRunner({ maxEntries: 256 });
let version = 0;
let source: TileSource | null = null;
let controller: AbortController | null = null;

const api: EngineApi = {
  async setDocument(doc: MapDocument) {
    controller?.abort();
    controller = new AbortController();
    const started = performance.now();
    const out = await runner.run(
      regionOutlineStage,
      { seed: doc.spec.seed, extent: doc.spec.extent },
      { signal: controller.signal },
    );
    version += 1;
    source = new TileSource(
      [
        { name: 'region', features: { type: 'FeatureCollection', features: [out.boundary] } },
        { name: 'graticule', features: out.graticule, minZoom: 8 },
        { name: 'samples', features: out.samples },
        { name: 'authored', features: doc.authored },
      ],
      version,
    );
    const stats: EngineStats = {
      stageMs: performance.now() - started,
      memoHits: runner.hits,
      memoMisses: runner.misses,
    };
    return { version, stats };
  },

  async getTile(v, z, x, y) {
    if (!source || v !== source.version) return null;
    const data = source.getTile(z, x, y);
    if (!data) return null;
    // Transfer the buffer rather than copying it.
    return Comlink.transfer(data, [data.buffer as ArrayBuffer]);
  },

  fixtureHash: () => computeFixtureHash(),
};

Comlink.expose(api);
