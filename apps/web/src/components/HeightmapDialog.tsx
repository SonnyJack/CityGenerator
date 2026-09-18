import { useState } from 'react';
import { importHeightmap } from '../import/importFile.js';
import { useT } from '../i18n/index.js';

/** Height range for an imported image: black to white, or Terrain-RGB. */
export function HeightmapDialog({
  pixels,
  name,
  onClose,
}: {
  pixels: { width: number; height: number; rgba: Uint8ClampedArray };
  name: string;
  onClose: (message?: string) => void;
}) {
  const t = useT();
  const [minM, setMinM] = useState(0);
  const [maxM, setMaxM] = useState(500);
  const [terrainRgb, setTerrainRgb] = useState(false);
  const input = 'w-24 rounded border border-stone-300 px-1 py-0.5 font-mono';
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      data-testid="heightmap-dialog"
    >
      <div className="w-96 rounded border border-stone-300 bg-white p-4 text-sm shadow-xl">
        <div className="mb-2 font-semibold">{t('Import heightmap')}</div>
        <p className="mb-2 text-xs text-stone-600">
          {name}: {pixels.width} × {pixels.height} pixels, stretched over the region ({' '}
          {pixels.width >= 2 ? 'north up' : ''}). Rivers, coasts and land cover are derived from it.
        </p>
        <label className="mb-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={terrainRgb} onChange={(e) => setTerrainRgb(e.target.checked)} />
          {t('Mapbox Terrain-RGB encoding (heights in the colour channels)')}
        </label>
        {!terrainRgb && (
          <div className="mb-3 flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-stone-600">black =</span>
              <input
                aria-label={t('Height of black')}
                type="number"
                className={input}
                value={minM}
                onChange={(e) => setMinM(Number(e.target.value))}
              />{' '}
              m
            </label>
            <label className="flex items-center gap-1">
              <span className="text-stone-600">white =</span>
              <input
                aria-label={t('Height of white')}
                type="number"
                className={input}
                value={maxM}
                onChange={(e) => setMaxM(Number(e.target.value))}
              />{' '}
              m
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100"
            onClick={() => onClose()}
          >
            {t('Cancel')}
          </button>
          <button
            className="rounded border border-stone-800 bg-stone-800 px-2 py-0.5 text-xs text-white hover:bg-stone-700"
            onClick={() =>
              onClose(
                importHeightmap(pixels, { minM, maxM: Math.max(minM + 1, maxM), terrainRgb, source: name })
                  .message,
              )
            }
          >
            {t('Import')}
          </button>
        </div>
      </div>
    </div>
  );
}
