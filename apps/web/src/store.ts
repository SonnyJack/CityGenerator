import { create } from 'zustand';
import { createDocument, parseDocument, serializeDocument, type MapDocument } from '@citygen/core';
import { CommandBus, type Command } from '@citygen/editor';
import { themeById } from '@citygen/themes';
import { engine } from './engine/client.js';
import { loadAutosave, saveAutosave, clearAutosave } from './persistence.js';
import type { EngineStats, Thumbnail } from './engine/api.js';

export interface AppState {
  document: MapDocument;
  canUndo: boolean;
  canRedo: boolean;
  tileVersion: number;
  status: 'idle' | 'generating' | 'error';
  error?: string;
  stats?: EngineStats;
  warnings: string[];
  thumbnails: Thumbnail[];
  thumbnailsFor?: string;

  dispatch(command: Command): void;
  undo(): void;
  redo(): void;
  newDocument(seed?: string): void;
  importJson(text: string): void;
  exportJson(): string;
  refreshThumbnails(): void;
}

const now = () => new Date().toISOString();

const initial = createDocument({ now: now(), seed: 'arkham', name: 'Untitled region' });
const bus = new CommandBus(initial, { now });

/** The part of the document that changes what the engine produces. */
function engineKey(doc: MapDocument): string {
  return JSON.stringify([doc.spec, doc.authored, themeById(doc.ui?.theme).sketch]);
}

export const useApp = create<AppState>((set, get) => {
  let generation = 0;
  let lastKey = '';

  async function regenerate(doc: MapDocument) {
    const run = ++generation;
    set({ status: 'generating', error: undefined });
    try {
      const { version, stats } = await engine().setDocument(doc, { sketch: themeById(doc.ui?.theme).sketch });
      if (run !== generation) return; // superseded
      set({ tileVersion: version, stats, status: 'idle' });
    } catch (e) {
      if (run !== generation) return;
      set({ status: 'error', error: (e as Error).message });
    }
  }

  function sync(doc: MapDocument) {
    set({ document: doc, canUndo: bus.canUndo, canRedo: bus.canRedo });
    void saveAutosave(doc);
    const key = engineKey(doc);
    if (key !== lastKey) {
      lastKey = key;
      void regenerate(doc);
    }
  }

  bus.subscribe((doc) => sync(doc));

  // Restore the autosaved document, if any, then start the engine.
  void loadAutosave().then((saved) => {
    if (saved) bus.load(saved);
    else sync(bus.document);
  });

  return {
    document: initial,
    canUndo: false,
    canRedo: false,
    tileVersion: 0,
    status: 'idle',
    warnings: [],
    thumbnails: [],

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
    refreshThumbnails() {
      const doc = get().document;
      // Sibling seeds derive from the current seed, so the key includes it.
      const key = JSON.stringify(doc.spec);
      if (get().thumbnailsFor === key) return;
      const seeds = Array.from({ length: 6 }, (_, i) => `${doc.spec.seed}-${i + 1}`);
      set({ thumbnailsFor: key, thumbnails: [] });
      void engine()
        .thumbnails(doc, seeds, 96, 72)
        .then((thumbnails) => {
          if (get().thumbnailsFor === key) set({ thumbnails });
        })
        .catch(() => set({ thumbnailsFor: undefined }));
    },
  };
});

/** Seeds are user-facing words, not engine randomness, so the app may use the platform RNG here. */
export function randomSeed(): string {
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
