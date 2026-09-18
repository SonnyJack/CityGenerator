import { useEffect, useRef, useState } from 'react';
import type { Command } from '@citygen/editor';
import { useApp } from '../store.js';

function describe(c: Command): string {
  switch (c.type) {
    case 'meta.rename':
      return `Rename to “${c.name}”`;
    case 'spec.patch':
      return `Change ${c.ops.map((o) => o.path.replace(/^\//, '').replace(/\//g, ' › ')).join(', ')}`;
    case 'spec.setSeed':
      return `Seed ${c.seed}`;
    case 'year.set':
      return `Year ${c.year}`;
    case 'settlement.add':
      return `Add settlement ${c.settlement.name ?? c.settlement.id}`;
    case 'settlement.update':
      return `Edit settlement ${c.id}`;
    case 'settlement.remove':
      return `Remove settlement ${c.id}`;
    case 'authored.add':
      return c.features.length === 1
        ? `Draw ${c.features[0]!.properties.layer}`
        : `Add ${c.features.length} features`;
    case 'authored.update':
      return c.geometry ? 'Edit geometry' : 'Edit properties';
    case 'authored.remove':
      return c.ids.length === 1 ? 'Delete feature' : `Delete ${c.ids.length} features`;
    case 'annotation.add':
      return `Add ${c.annotation.kind}`;
    case 'annotation.update':
      return 'Edit annotation';
    case 'annotation.remove':
      return 'Remove annotation';
    case 'override.add':
      return c.override.op === 'reseed'
        ? `Regenerate ${c.override.target}`
        : c.override.op === 'reroll'
          ? 'Re-roll blocks'
          : c.override.op === 'suppress'
            ? 'Remove generated feature'
            : `Override ${c.override.op}`;
    case 'override.remove':
      return 'Remove override';
    case 'override.clear':
      return c.op ? `Clear ${c.op} overrides` : 'Clear overrides';
    default:
      return c.type;
  }
}

/** Drop-down list of the undo history; clicking an entry jumps to that state. */
export function HistoryMenu() {
  const history = useApp((s) => s.history);
  const canRedo = useApp((s) => s.canRedo);
  const jumpTo = useApp((s) => s.jumpTo);
  const [open, setOpen] = useState(false);
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
        History ({history.length}
        {canRedo ? ' ↷' : ''})
      </button>
      {open && (
        <ul
          className="absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded border border-stone-300 bg-white py-1 text-xs shadow"
          role="listbox"
          data-testid="history-list"
        >
          <li>
            <button
              className="w-full px-2 py-1 text-left hover:bg-stone-100"
              onClick={() => {
                jumpTo(0);
                setOpen(false);
              }}
            >
              Original document
            </button>
          </li>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <button
                className={`w-full px-2 py-1 text-left hover:bg-stone-100 ${i === history.length - 1 ? 'font-semibold' : ''}`}
                onClick={() => {
                  jumpTo(i + 1);
                  setOpen(false);
                }}
              >
                {describe(h.command)}
                <span className="ml-1 text-stone-400">{new Date(h.at).toLocaleTimeString()}</span>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="px-2 py-1 text-stone-500">No edits yet</li>}
        </ul>
      )}
    </div>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
