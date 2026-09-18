import { useRef } from 'react';
import { useApp } from '../store.js';

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

  function download() {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.meta.name.replace(/[^\w.-]+/g, '_') || 'region'}.citygen.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importJson(await file.text());
    e.target.value = '';
  }

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-stone-300 bg-stone-50 px-3 py-2 text-sm">
      <span className="font-semibold tracking-tight">CityGenerator</span>
      <span className="text-xs text-stone-500">Phase 0</span>

      <label className="ml-4 flex items-center gap-1">
        <span className="text-stone-600">Name</span>
        <input
          aria-label="Document name"
          className="w-40 rounded border border-stone-300 px-2 py-1"
          value={doc.meta.name}
          onChange={(e) => dispatch({ type: 'meta.rename', name: e.target.value || 'Untitled region' })}
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-stone-600">Seed</span>
        <input
          aria-label="Seed"
          className="w-32 rounded border border-stone-300 px-2 py-1 font-mono"
          value={doc.spec.seed}
          onChange={(e) => e.target.value && dispatch({ type: 'spec.setSeed', seed: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-stone-600">Year</span>
        <input
          aria-label="Year"
          type="number"
          min={1100}
          max={2100}
          className="w-20 rounded border border-stone-300 px-2 py-1"
          value={doc.spec.year}
          onChange={(e) => {
            const year = Number(e.target.value);
            if (year >= 1100 && year <= 2100) dispatch({ type: 'year.set', year });
          }}
        />
      </label>

      <div className="ml-auto flex items-center gap-1">
        <button className={btn} onClick={undo} disabled={!canUndo} aria-label="Undo">
          Undo
        </button>
        <button className={btn} onClick={redo} disabled={!canRedo} aria-label="Redo">
          Redo
        </button>
        <button className={btn} onClick={() => newDocument()}>
          New
        </button>
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
        <button className={btn} onClick={download}>
          Export
        </button>
      </div>

      <div className="basis-full text-xs text-stone-500" data-testid="status">
        {status === 'generating' && 'Generating…'}
        {status === 'idle' &&
          stats &&
          `Ready · stage ${stats.stageMs.toFixed(0)} ms · memo ${stats.memoHits}/${stats.memoHits + stats.memoMisses}`}
        {status === 'idle' && !stats && 'Starting engine…'}
        {error && <span className="ml-2 text-red-700">{error}</span>}
      </div>
    </header>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
