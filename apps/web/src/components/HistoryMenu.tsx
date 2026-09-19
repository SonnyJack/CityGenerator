import { useEffect, useRef, useState } from 'react';
import type { Command } from '@citygen/editor';
import { useApp } from '../store.js';
import { useT, type Translate } from '../i18n/index.js';

function describe(c: Command, t: Translate): string {
  switch (c.type) {
    case 'meta.rename':
      return t('Rename to “{name}”', { name: c.name });
    case 'spec.patch':
      return t('Change {what}', {
        what: c.ops.map((o) => o.path.replace(/^\//, '').replace(/\//g, ' › ')).join(', '),
      });
    case 'spec.setSeed':
      return t('Seed {seed}', { seed: c.seed });
    case 'year.set':
      return t('Year {year}', { year: c.year });
    case 'settlement.add':
      return t('Add settlement {name}', { name: c.settlement.name ?? c.settlement.id });
    case 'settlement.update':
      return t('Edit settlement {id}', { id: c.id });
    case 'settlement.remove':
      return t('Remove settlement {id}', { id: c.id });
    case 'authored.add':
      return c.features.length === 1
        ? t('Draw {layer}', { layer: c.features[0]!.properties.layer })
        : t('Add {count} features', { count: c.features.length });
    case 'authored.update':
      return t(c.geometry ? 'Edit geometry' : 'Edit properties');
    case 'authored.remove':
      return c.ids.length === 1 ? t('Delete feature') : t('Delete {count} features', { count: c.ids.length });
    case 'annotation.add':
      return t('Add {kind}', { kind: c.annotation.kind });
    case 'annotation.update':
      return t('Edit annotation');
    case 'annotation.remove':
      return t('Remove annotation');
    case 'override.add':
      return c.override.op === 'reseed'
        ? t('Regenerate {target}', { target: c.override.target })
        : c.override.op === 'reroll'
          ? t('Re-roll blocks')
          : c.override.op === 'suppress'
            ? t('Remove generated feature')
            : t('Override {op}', { op: c.override.op });
    case 'override.remove':
      return t('Remove override');
    case 'override.clear':
      return c.op ? t('Clear {op} overrides', { op: c.op }) : t('Clear overrides');
    default:
      return c.type;
  }
}

/** What was drawn by hand at one point in the history, as a small sketch. */
function Sketch({ index }: { index: number }) {
  const t = useT();
  const thumbnail = useApp((s) => s.historyThumbnail);
  const src = thumbnail(index);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={t('What was drawn at this point')}
      width={48}
      height={32}
      className="shrink-0 rounded-sm border border-stone-200"
      data-testid="history-sketch"
    />
  );
}

/** Drop-down list of the undo history; clicking an entry jumps to that state. */
export function HistoryMenu() {
  const t = useT();
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
        {t('History')} ({history.length}
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
              className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-stone-100"
              onClick={() => {
                jumpTo(0);
                setOpen(false);
              }}
            >
              <Sketch index={0} />
              {t('Original document')}
            </button>
          </li>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <button
                className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-stone-100 ${i === history.length - 1 ? 'font-semibold' : ''}`}
                onClick={() => {
                  jumpTo(i + 1);
                  setOpen(false);
                }}
              >
                <Sketch index={i + 1} />
                <span>
                  {describe(h.command, t)}
                  <span className="ml-1 text-stone-400">{new Date(h.at).toLocaleTimeString()}</span>
                </span>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="px-2 py-1 text-stone-500">{t('No edits yet')}</li>}
        </ul>
      )}
    </div>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
