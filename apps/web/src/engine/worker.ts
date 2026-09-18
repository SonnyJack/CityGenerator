import * as Comlink from 'comlink';
import { createEngine, type EngineApi } from '@citygen/engine';

/**
 * The engine worker: the headless engine behind a Comlink boundary. Tile
 * buffers are transferred rather than copied.
 */
const engine = createEngine();
const api: EngineApi = {
  ...engine,
  async getTile(v, z, x, y) {
    const data = await engine.getTile(v, z, x, y);
    return data ? Comlink.transfer(data, [data.buffer as ArrayBuffer]) : null;
  },
  async getDemTile(v, z, x, y) {
    const png = await engine.getDemTile(v, z, x, y);
    return png ? Comlink.transfer(png, [png.buffer as ArrayBuffer]) : null;
  },
};
Comlink.expose(api);
