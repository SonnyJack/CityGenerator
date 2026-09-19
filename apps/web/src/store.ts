import { create } from 'zustand';
import {
  createDocument,
  lonLatToMeters,
  parseDocument,
  serializeDocument,
  type AuthoredLayer,
  type MapDocument,
} from '@citygen/core';
import {
  CommandBus,
  ToolController,
  type Command,
  type HistoryEntry,
  type ToolId,
  type ToolOptions,
} from '@citygen/editor';
import { themeById } from '@citygen/themes';
import { engine } from './engine/client.js';
import {
  clearAutosave,
  forgetRecent,
  listRecent,
  loadAutosave,
  loadRecent,
  saveAutosave,
  type RecentDocument,
} from './persistence.js';
import type { EngineStats, GeneratedHit, Inspection, Thumbnail } from './engine/api.js';

export interface AppState {
  document: MapDocument;
  canUndo: boolean;
  canRedo: boolean;
  history: readonly HistoryEntry[];
  tileVersion: number;
  status: 'idle' | 'generating' | 'error';
  error?: string;
  stats?: EngineStats;
  warnings: string[];
  thumbnails: Thumbnail[];
  thumbnailsFor?: string;
  inspection?: Inspection;
  /** Generated feature under the last select-click on empty ground (freeze / remove). */
  generatedHit?: GeneratedHit;
  recent: RecentDocument[];

  // Editor state mirrored from the ToolController for React.
  tool: ToolId;
  toolOptions: ToolOptions;
  selection: string[];
  selectedAnnotation?: string;
  /** Bumps whenever the controller's transient state (draft, handles, preview) changes. */
  editorTick: number;
  directoryOpen: boolean;
  setDirectoryOpen(open: boolean): void;

  dispatch(command: Command): void;
  undo(): void;
  redo(): void;
  /** Undo or redo until the history has `length` entries. */
  jumpTo(length: number): void;
  newDocument(seed?: string): void;
  importJson(text: string): void;
  exportJson(): string;
  openRecent(key: string): Promise<boolean>;
  forgetRecent(key: string): void;
  refreshThumbnails(): void;
  inspect(x: number, y: number): void;
  clearInspection(): void;

  setTool(tool: ToolId): void;
  setToolOptions(patch: Partial<ToolOptions>): void;
  /** Select every authored feature matching the query (the editor bar's Find row). */
  selectByQuery(query: { layer?: AuthoredLayer; text?: string; inView?: boolean }): void;
  selectAnnotation(id: string | undefined): void;
  /** Ask the engine what generated feature is at a point (select tool on empty ground). */
  probeGenerated(x: number, y: number, toleranceM: number): void;
  freezeGenerated(): void;
  suppressGenerated(): void;
  /** Re-roll a settlement (its id) or the whole region ('region') by adding a reseed override. */
  regenerate(target: string): void;
}

const now = () => new Date().toISOString();

const initial = createDocument({ now: now(), seed: 'arkham', name: 'Untitled region' });
const bus = new CommandBus(initial, { now });

/** Layers whose features change what the engine produces (POIs and labels only decorate). */
const GENERATING_LAYERS = new Set([
  'street',
  'rail',
  'tram',
  'water',
  'wall',
  'zone',
  'building',
  'facility',
  'vegetation',
  'terrainEdit',
  'fieldEdit',
]);

/** The part of the document that changes what the engine produces. */
function engineKey(doc: MapDocument): string {
  const authored = doc.authored.features
    .filter((f) => GENERATING_LAYERS.has(f.properties.layer))
    .map((f) => {
      const { name: _name, ...rest } = f.properties;
      return [f.id, f.geometry, rest];
    });
  return JSON.stringify([doc.spec, authored, doc.overrides, themeById(doc.ui?.theme).sketch]);
}

/** Ids only need to be unique within a document; the app may use the platform RNG. */
export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

export const tools = new ToolController({
  document: () => bus.document,
  dispatch: (c) => useApp.getState().dispatch(c),
  changed: () => useApp.getState().dispatchEditorChanged?.(),
  newId,
});

export const useApp = create<AppState & { dispatchEditorChanged?: () => void }>((set, get) => {
  let generation = 0;
  let lastKey = '';

  async function regenerate(doc: MapDocument) {
    const run = ++generation;
    set({ status: 'generating', error: undefined });
    try {
      const { version, stats } = await engine().setDocument(doc, { sketch: themeById(doc.ui?.theme).sketch });
      if (run !== generation) return; // superseded
      set({ tileVersion: version, stats, status: 'idle', generatedHit: undefined });
    } catch (e) {
      if (run !== generation) return;
      set({ status: 'error', error: (e as Error).message });
    }
  }

  function sync(doc: MapDocument, kind: 'command' | 'undo' | 'redo' | 'load') {
    if (kind !== 'command') tools.reconcile();
    const selectedAnnotation = get().selectedAnnotation;
    set({
      document: doc,
      canUndo: bus.canUndo,
      canRedo: bus.canRedo,
      history: [...bus.history],
      selection: [...tools.selection],
      selectedAnnotation:
        selectedAnnotation && doc.annotations.some((a) => a.id === selectedAnnotation)
          ? selectedAnnotation
          : undefined,
    });
    void saveAutosave(doc).then(() => listRecent().then((recent) => set({ recent })));
    const key = engineKey(doc);
    if (key !== lastKey) {
      lastKey = key;
      void regenerate(doc);
    }
  }

  bus.subscribe((doc, event) => sync(doc, event.kind));

  // Restore the autosaved document, if any, then start the engine.
  void loadAutosave().then((saved) => {
    if (saved) bus.load(saved);
    else sync(bus.document, 'load');
  });
  void listRecent().then((recent) => set({ recent }));

  return {
    document: initial,
    canUndo: false,
    canRedo: false,
    history: [],
    tileVersion: 0,
    status: 'idle',
    warnings: [],
    thumbnails: [],
    recent: [],
    tool: 'navigate',
    toolOptions: { ...tools.options },
    selection: [],
    editorTick: 0,
    directoryOpen: false,
    setDirectoryOpen: (open) => set({ directoryOpen: open }),

    dispatchEditorChanged() {
      set((s) => ({
        editorTick: s.editorTick + 1,
        selection: [...tools.selection],
        tool: tools.tool,
        toolOptions: { ...tools.options },
      }));
    },

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
    jumpTo(length) {
      while (bus.history.length > length && bus.undo()) {
        /* step back */
      }
      while (bus.history.length < length && bus.redo()) {
        /* step forward */
      }
    },
    newDocument(seed) {
      void clearAutosave();
      tools.selection.clear();
      bus.load(createDocument({ now: now(), seed: seed ?? randomSeed(), name: 'Untitled region' }));
    },
    importJson(text) {
      try {
        tools.selection.clear();
        bus.load(parseDocument(text));
        set({ error: undefined });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },
    exportJson: () => serializeDocument(get().document),
    async openRecent(key) {
      const doc = await loadRecent(key);
      if (!doc) {
        set({ error: 'That document is no longer stored in this browser.' });
        return false;
      }
      tools.selection.clear();
      bus.load(doc);
      return true;
    },
    forgetRecent(key) {
      void forgetRecent(key).then((recent) => set({ recent }));
    },
    inspect(x, y) {
      void engine()
        .inspect(x, y)
        .then((inspection) => set({ inspection: inspection ?? undefined }))
        .catch(() => set({ inspection: undefined }));
    },
    clearInspection: () => set({ inspection: undefined, generatedHit: undefined }),
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

    setTool(tool) {
      tools.setTool(tool);
      set({ tool, generatedHit: undefined });
    },
    setToolOptions(patch) {
      tools.setOptions(patch);
      set({ toolOptions: { ...tools.options } });
    },
    selectByQuery({ layer, text, inView }) {
      // A single box of text matches either the kind or the name, so one field does for both.
      const map = window.__citygenMap;
      let within: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
      if (inView && map) {
        const b = map.getBounds();
        const [minX, minY] = lonLatToMeters([b.getWest(), b.getSouth()]);
        const [maxX, maxY] = lonLatToMeters([b.getEast(), b.getNorth()]);
        within = { minX, minY, maxX, maxY };
      }
      const byKind = tools.selectByQuery({
        ...(layer ? { layer } : {}),
        ...(text ? { kind: text } : {}),
        ...(within ? { within } : {}),
      });
      if (text && !byKind.length)
        tools.selectByQuery({ ...(layer ? { layer } : {}), name: text, ...(within ? { within } : {}) });
      set({ selection: [...tools.selection], selectedAnnotation: undefined });
      get().dispatchEditorChanged?.();
    },
    selectAnnotation(id) {
      if (id) {
        tools.selection.clear();
        get().dispatchEditorChanged?.();
      }
      set({ selectedAnnotation: id });
    },
    probeGenerated(x, y, toleranceM) {
      void engine()
        .generatedAt(x, y, toleranceM)
        .then((hit) => set({ generatedHit: hit ?? undefined }))
        .catch(() => set({ generatedHit: undefined }));
    },
    freezeGenerated() {
      const hit = get().generatedHit;
      if (!hit) return;
      tools.freezeGenerated(hit);
      tools.setTool('select');
      set({ generatedHit: undefined, tool: 'select' });
    },
    suppressGenerated() {
      const hit = get().generatedHit;
      if (!hit) return;
      get().dispatch({ type: 'override.add', override: { op: 'suppress', target: hit.id } });
      set({ generatedHit: undefined });
    },
    regenerate(target) {
      get().dispatch({ type: 'override.add', override: { op: 'reseed', target, salt: newId('r').slice(2) } });
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
