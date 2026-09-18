import { create } from 'zustand';
import { createDocument, parseDocument, serializeDocument, type MapDocument } from '@citygen/core';
import { CommandBus, type Command } from '@citygen/editor';
import { engine } from './engine/client.js';
import { loadAutosave, saveAutosave, clearAutosave } from './persistence.js';
import type { EngineStats } from './engine/api.js';

export interface AppState {
  document: MapDocument;
  canUndo: boolean;
  canRedo: boolean;
  tileVersion: number;
  status: 'idle' | 'generating' | 'error';
  error?: string;
  stats?: EngineStats;
  warnings: string[];

  dispatch(command: Command): void;
  undo(): void;
  redo(): void;
  newDocument(seed?: string): void;
  importJson(text: string): void;
  exportJson(): string;
}

const now = () => new Date().toISOString();

const initial = createDocument({ now: now(), seed: 'arkham', name: 'Untitled region' });
const bus = new CommandBus(initial, { now });

export const useApp = create<AppState>((set, get) => {
  let generation = 0;

  async function regenerate(doc: MapDocument) {
    const run = ++generation;
    set({ status: 'generating', error: undefined });
    try {
      const { version, stats } = await engine().setDocument(doc);
      if (run !== generation) return; // superseded
      set({ tileVersion: version, stats, status: 'idle' });
    } catch (e) {
      if (run !== generation) return;
      set({ status: 'error', error: (e as Error).message });
    }
  }

  function sync(doc: MapDocument, regen: boolean) {
    set({ document: doc, canUndo: bus.canUndo, canRedo: bus.canRedo });
    void saveAutosave(doc);
    if (regen) void regenerate(doc);
  }

  bus.subscribe((doc, event) => {
    // Presentation-only commands do not touch the engine.
    const regen = event.command?.type !== 'viewport.set';
    sync(doc, regen);
  });

  // Restore the autosaved document, if any, then start the engine.
  void loadAutosave().then((saved) => {
    if (saved) bus.load(saved);
    else void regenerate(bus.document);
  });

  return {
    document: initial,
    canUndo: false,
    canRedo: false,
    tileVersion: 0,
    status: 'idle',
    warnings: [],

    dispatch(command) {
      try {
        const { warnings } = bus.dispatch(command);
        set({ warnings, error: undefined });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    undo: () => void bus.undo(),
    redo: () => void bus.redo(),
    newDocument(seed) {
      void clearAutosave();
      bus.load(createDocument({ now: now(), seed: seed ?? randomSeed(), name: 'Untitled region' }));
    },
    importJson(text) {
      try {
        bus.load(parseDocument(text));
        set({ error: undefined });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    exportJson: () => serializeDocument(get().document),
  };
});

/** Seeds are user-facing words, not engine randomness, so the app may use the platform RNG here. */
function randomSeed(): string {
  const words = [
    'arkham',
    'innsmouth',
    'dunwich',
    'kingsport',
    'foxfield',
    'bolton',
    'aylesbury',
    'greyhaven',
  ];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 10_000)}`;
}
