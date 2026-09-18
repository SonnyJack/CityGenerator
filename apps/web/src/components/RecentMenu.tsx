import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store.js';
import { importFromUrl } from '../import/importFile.js';

/** Documents stored in this browser (IndexedDB), most recent first. */
export function RecentMenu() {
  const recent = useApp((s) => s.recent);
  const current = useApp((s) => s.document.meta.created);
  const openRecent = useApp((s) => s.openRecent);
  const forget = useApp((s) => s.forgetRecent);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [urlReport, setUrlReport] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        Open ▾
      </button>
      {open && (
        <ul
          className="absolute right-0 z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded border border-stone-300 bg-white py-1 text-xs shadow"
          role="listbox"
          data-testid="recent-list"
        >
          <li className="flex items-center gap-1 px-2 py-1">
            <input
              aria-label="Document URL"
              className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-0.5"
              placeholder="https://… (a raw gist or any .citygen.json)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void importFromUrl(url).then((r) => setUrlReport(r.message));
              }}
            />
            <button
              className="rounded border border-stone-300 px-1 py-0.5 hover:bg-stone-100"
              onClick={() => void importFromUrl(url).then((r) => setUrlReport(r.message))}
            >
              Open URL
            </button>
          </li>
          {urlReport && (
            <li className="px-2 pb-1 text-stone-500" data-testid="url-report">
              {urlReport}
            </li>
          )}
          {recent.map((r) => (
            <li key={r.key} className="flex items-center hover:bg-stone-100">
              <button
                className={`min-w-0 flex-1 truncate px-2 py-1 text-left ${r.key.endsWith(current) ? 'font-semibold' : ''}`}
                onClick={() => {
                  void openRecent(r.key);
                  setOpen(false);
                }}
              >
                {r.name} <span className="font-mono text-stone-500">{r.seed}</span>
                <span className="ml-1 text-stone-400">{new Date(r.modified).toLocaleString()}</span>
              </button>
              {!r.key.endsWith(current) && (
                <button
                  className="px-2 text-stone-400 hover:text-red-700"
                  aria-label={`Forget ${r.name}`}
                  onClick={() => forget(r.key)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {recent.length === 0 && <li className="px-2 py-1 text-stone-500">Nothing stored yet</li>}
        </ul>
      )}
    </div>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
