import { useApp } from './store.js';
import { engine } from './engine/client.js';

/**
 * A small window-level API for end-to-end tests. It exposes the same store
 * and engine the UI uses; nothing here bypasses validation.
 */
export function installTestApi() {
  window.__citygen = {
    getDocument: () => useApp.getState().document,
    dispatch: (command) => useApp.getState().dispatch(command as never),
    exportJson: () => useApp.getState().exportJson(),
    importJson: (text) => useApp.getState().importJson(text),
    newDocument: (seed) => useApp.getState().newDocument(seed),
    fixtureHash: () => engine().fixtureHash(),
    status: () => useApp.getState().status,
    tileVersion: () => useApp.getState().tileVersion,
    stats: () => useApp.getState().stats,
    thumbnails: () => useApp.getState().thumbnails.length,
    inspect: (x, y) => engine().inspect(x, y),
  };
}

declare global {
  interface Window {
    __citygen: {
      getDocument(): unknown;
      dispatch(command: unknown): void;
      exportJson(): string;
      importJson(text: string): void;
      newDocument(seed?: string): void;
      fixtureHash(): Promise<string>;
      status(): string;
      tileVersion(): number;
      stats(): unknown;
      thumbnails(): number;
      inspect(x: number, y: number): Promise<unknown>;
    };
  }
}
