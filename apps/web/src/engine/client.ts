import * as Comlink from 'comlink';
import type { EngineApi } from './api.js';

let instance: Comlink.Remote<EngineApi> | null = null;

/** The single engine worker for this page. */
export function engine(): Comlink.Remote<EngineApi> {
  if (!instance) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'citygen-engine',
    });
    instance = Comlink.wrap<EngineApi>(worker);
  }
  return instance;
}
