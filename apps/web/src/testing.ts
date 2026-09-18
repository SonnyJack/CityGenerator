import { useApp } from './store.js';
import { useAssistant } from './assistant/store.js';
import { scriptedClient, type ScriptedTurn } from '@citygen/assistant';
import { engine } from './engine/client.js';
import {
  currentViewFrame,
  exportGeoJsonText,
  exportPng,
  exportSvg,
  exportUniversalVtt,
  exportWalls,
} from './export/exports.js';

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
    directory: (settlement, query, limit) => engine().directory(settlement, query, limit),
    exportSvg: (req) => exportSvg(req as never),
    exportPng: (req) => exportPng(req as never),
    exportGeoJson: (req) => exportGeoJsonText(req as never),
    exportWalls: (req, max) => exportWalls(req as never, max),
    exportUvtt: (req) => exportUniversalVtt(req as never),
    currentViewFrame: () => currentViewFrame(),
    generatedAt: (x, y, tol) => engine().generatedAt(x, y, tol),
    tool: () => useApp.getState().tool,
    setTool: (tool) => useApp.getState().setTool(tool as never),
    setToolOptions: (patch) => useApp.getState().setToolOptions(patch as never),
    selection: () => useApp.getState().selection,
    generatedHit: () => useApp.getState().generatedHit,
    recent: () => useApp.getState().recent,
    openRecent: (key) => useApp.getState().openRecent(key),
    assistant: {
      useScripted(turns, structured) {
        useAssistant
          .getState()
          .setClientFactory(() => scriptedClient(turns as ScriptedTurn[], structured ?? []));
      },
      useRealClient(apiKey) {
        useAssistant.getState().setClientFactory(null);
        useAssistant.getState().setSettings({ apiKey, remember: false });
      },
      open: (open) => useAssistant.getState().setOpen(open),
      send: (text) => useAssistant.getState().send(text),
      transcript: () => JSON.parse(JSON.stringify(useAssistant.getState().session?.transcript ?? [])),
      usage: () => {
        const s = useAssistant.getState().session;
        return s ? { ...s.usage, costUsd: s.costUsd } : null;
      },
    },
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
      directory(settlement: string | null, query: string, limit: number): Promise<unknown>;
      exportSvg(req: unknown): Promise<string>;
      exportPng(req: unknown): Promise<{ dataUrl: string; width: number; height: number }>;
      exportGeoJson(req: unknown): Promise<string>;
      exportWalls(req: unknown, max?: number): Promise<unknown>;
      exportUvtt(req: unknown): Promise<{ json: string; warnings: string[]; segments: number; mode: string }>;
      currentViewFrame(): unknown;
      generatedAt(x: number, y: number, toleranceM: number): Promise<unknown>;
      tool(): string;
      setTool(tool: string): void;
      setToolOptions(patch: Record<string, unknown>): void;
      selection(): string[];
      generatedHit(): unknown;
      recent(): { key: string; name: string; seed: string }[];
      openRecent(key: string): Promise<boolean>;
      assistant: {
        useScripted(turns: unknown[], structured?: unknown[]): void;
        useRealClient(apiKey: string): void;
        open(open: boolean): void;
        send(text: string): Promise<void>;
        transcript(): unknown[];
        usage(): unknown;
      };
    };
  }
}
