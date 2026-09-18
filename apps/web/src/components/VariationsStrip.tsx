import { useEffect, useRef } from 'react';
import { useApp } from '../store.js';
import type { Thumbnail } from '../engine/api.js';
import { useT } from '../i18n/index.js';

function ThumbnailCanvas({ thumb, onPick }: { thumb: Thumbnail; onPick: () => void }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(thumb.rgba), thumb.width, thumb.height), 0, 0);
  }, [thumb]);
  return (
    <button
      className="rounded border border-stone-300 bg-white p-0.5 hover:border-stone-500"
      title={t('Use seed {seed}', { seed: thumb.seed })}
      aria-label={t('Variation {seed}', { seed: thumb.seed })}
      onClick={onPick}
    >
      <canvas ref={ref} width={thumb.width} height={thumb.height} className="block" />
    </button>
  );
}

/** Six terrain previews for sibling seeds of the current spec. */
export function VariationsStrip() {
  const t = useT();
  const thumbnails = useApp((s) => s.thumbnails);
  const refresh = useApp((s) => s.refreshThumbnails);
  const dispatch = useApp((s) => s.dispatch);
  const spec = useApp((s) => s.document.spec);
  useEffect(() => {
    refresh();
  }, [spec, refresh]);
  return (
    <div
      className="flex items-center gap-2 border-t border-stone-300 bg-stone-50 px-3 py-1.5"
      data-testid="variations"
    >
      <span className="text-xs text-stone-500">{t('Variations')}</span>
      {thumbnails.length === 0 && <span className="text-xs text-stone-400">{t('rendering…')}</span>}
      {thumbnails.map((t) => (
        <ThumbnailCanvas
          key={t.seed}
          thumb={t}
          onPick={() => dispatch({ type: 'spec.setSeed', seed: t.seed })}
        />
      ))}
    </div>
  );
}
