import { useRef, useState } from 'react';
import { useApp } from '../store.js';
import { HistoryMenu } from './HistoryMenu.js';
import { RecentMenu } from './RecentMenu.js';
import { ExportPanel } from './ExportPanel.js';
import { useAssistant } from '../assistant/store.js';

export function Toolbar() {
  const doc = useApp((s) => s.document);
  const {
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    newDocument,
    importJson,
    exportJson,
    status,
    stats,
    error,
  } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const directoryOpen = useApp((s) => s.directoryOpen);
  const setDirectoryOpen = useApp((s) => s.setDirectoryOpen);
  const assistantOpen = useAssistant((s) => s.open);
  const setAssistantOpen = useAssistant((s) => s.setOpen);
  void exportJson;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importJson(await file.text());
    e.target.value = '';
  }

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-stone-300 bg-stone-50 px-3 py-2 text-sm">
      <span className="font-semibold tracking-tight">CityGenerator</span>
      <span className="text-xs text-stone-500">Phase 8</span>

      <label className="ml-4 flex items-center gap-1">
        <span className="text-stone-600">Name</span>
        <input
          aria-label="Document name"
          className="w-40 rounded border border-stone-300 px-2 py-1"
          value={doc.meta.name}
          onChange={(e) => dispatch({ type: 'meta.rename', name: e.target.value || 'Untitled region' })}
        />
      </label>
      <div className="ml-auto flex items-center gap-1">
        <button className={btn} onClick={undo} disabled={!canUndo} aria-label="Undo">
          Undo
        </button>
        <button className={btn} onClick={redo} disabled={!canRedo} aria-label="Redo">
          Redo
        </button>
        <HistoryMenu />
        <button className={btn} onClick={() => newDocument()}>
          New
        </button>
        <RecentMenu />
        <button className={btn} onClick={() => fileInput.current?.click()}>
          Import…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onFile}
        />
        <button className={btn} onClick={() => setDirectoryOpen(!directoryOpen)} aria-pressed={directoryOpen}>
          Directory
        </button>
        <button className={btn} onClick={() => setExportOpen(true)}>
          Export…
        </button>
        <button className={btn} onClick={() => setAssistantOpen(!assistantOpen)} aria-pressed={assistantOpen}>
          Assistant
        </button>
      </div>
      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}

      <div className="basis-full text-xs text-stone-500" data-testid="status">
        {status === 'generating' && 'Generating…'}
        {status === 'idle' &&
          stats &&
          `Ready · terrain ${stats.terrainMs.toFixed(0)} ms · land cover ${stats.landcoverMs.toFixed(0)} ms · settlements ${stats.settlementsMs.toFixed(0)} ms · roads & rail ${stats.roadsMs.toFixed(0)} ms · tiles ${stats.tilesMs.toFixed(0)} ms · memo ${stats.memoHits}/${stats.memoHits + stats.memoMisses}`}
        {status === 'idle' && !stats && 'Starting engine…'}
        {error && <span className="ml-2 text-red-700">{error}</span>}
      </div>
    </header>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
