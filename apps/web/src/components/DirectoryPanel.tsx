import { useEffect, useState } from 'react';
import { engine } from '../engine/client.js';
import type { DirectoryEntry } from '../engine/api.js';
import { useApp } from '../store.js';
import { downloadText, exportDirectoryCsv, slug } from '../export/exports.js';

/** Business and resident directory with search; click an entry to fly to it. */
export function DirectoryPanel({ onClose }: { onClose: () => void }) {
  const stats = useApp((s) => s.stats);
  const doc = useApp((s) => s.document);
  const tileVersion = useApp((s) => s.tileVersion);
  const [settlement, setSettlement] = useState<string>('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ total: number; entries: DirectoryEntry[] }>({
    total: 0,
    entries: [],
  });
  const [businessOnly, setBusinessOnly] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void engine()
        .directory(settlement || null, query, 400)
        .then((r) => {
          if (!cancelled) setResult(r);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [settlement, query, tileVersion]);
  const entries = businessOnly ? result.entries.filter((e) => e.use !== 'residential') : result.entries;
  return (
    <aside className="rounded border border-stone-300 bg-white/95 p-3 text-xs shadow" data-testid="directory">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">Directory</span>
        <button
          className="rounded px-1 text-stone-500 hover:bg-stone-100"
          aria-label="Close directory"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="flex gap-1">
        <select
          aria-label="Directory settlement"
          className="rounded border border-stone-300 bg-white px-1 py-0.5"
          value={settlement}
          onChange={(e) => setSettlement(e.target.value)}
        >
          <option value="">All settlements</option>
          {(stats?.settlements ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
        <input
          aria-label="Directory search"
          className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-0.5"
          placeholder="Search names, trades, streets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <label className="mt-1 flex items-center gap-1 text-stone-600">
        <input type="checkbox" checked={businessOnly} onChange={(e) => setBusinessOnly(e.target.checked)} />
        Businesses and institutions only
      </label>
      <p className="mt-1 text-stone-500">
        {result.total.toLocaleString()} premises
        {result.total > result.entries.length ? ` (first ${result.entries.length})` : ''}
      </p>
      <ul className="mt-1 max-h-72 space-y-0.5 overflow-y-auto" data-testid="directory-list">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              className="w-full rounded px-1 py-0.5 text-left hover:bg-stone-100"
              onClick={() =>
                window.__citygenMap?.flyTo({
                  center: [e.center[0] / 111319.490793, e.center[1] / 111319.490793],
                  zoom: 17,
                  duration: 600,
                })
              }
            >
              <span className="font-medium">{e.name}</span>
              <span className="text-stone-500">
                {' '}
                · {e.useLabel}
                {e.address ? ` · ${e.address}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        className="mt-2 rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100"
        onClick={() =>
          void exportDirectoryCsv(settlement || null).then((csv) =>
            downloadText(csv, `${slug(doc.meta.name)}-directory.csv`, 'text/csv'),
          )
        }
      >
        Export CSV
      </button>
    </aside>
  );
}
