import * as Comlink from 'comlink';
import { createEngine, type EngineApi } from '@citygen/engine';
import { deferStoreWrites, stageStore } from './stageStore.js';

/**
 * The engine worker: the headless engine behind a Comlink boundary. Tile
 * buffers are transferred rather than copied, and the terrain of a document
 * that has been open before comes back from IndexedDB instead of being
 * computed again. A tile is what the map is waiting for, so asking for one
 * also puts off the store's next write until the worker falls quiet.
 */
const engine = createEngine({ store: stageStore() });
const api: EngineApi = {
  ...engine,
  async getTile(v, z, x, y) {
    deferStoreWrites();
    const data = await engine.getTile(v, z, x, y);
    return data ? Comlink.transfer(data, [data.buffer as ArrayBuffer]) : null;
  },
  async getDemTile(v, z, x, y) {
    deferStoreWrites();
    const png = await engine.getDemTile(v, z, x, y);
    return png ? Comlink.transfer(png, [png.buffer as ArrayBuffer]) : null;
  },
};
Comlink.expose(api);
