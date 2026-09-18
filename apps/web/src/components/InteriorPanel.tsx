import { useEffect, useState } from 'react';
import type { Interior } from '@citygen/core';
import { interiorSvg, interiorVtt } from '@citygen/export';
import { engine } from '../engine/client.js';
import { downloadText } from '../export/exports.js';
import { useT } from '../i18n/index.js';

/**
 * Floor plans of the inspected building: a floor selector, the SVG plan, and
 * downloads (SVG per floor, Universal VTT with the plan rasterised as the
 * scene image).
 */
export function InteriorPanel({
  buildingId,
  name,
  onClose,
}: {
  buildingId: string;
  name: string;
  onClose: () => void;
}) {
  const t = useT();
  const [plan, setPlan] = useState<Interior | null>(null);
  const [floor, setFloor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    engine()
      .interior(buildingId)
      .then((p) => {
        if (!live) return;
        if (p) setPlan(p);
        else setError('No plan for this building.');
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [buildingId]);
  const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100';
  const current = plan?.floors[floor];
  const svg = plan && current ? interiorSvg(plan, floor, { pxPerM: 24 }) : '';

  async function downloadVtt() {
    if (!plan) return;
    // Rasterise the plan at 100 px per 1.5 m grid square (about 67 px/m) for the scene image.
    const pxPerM = 100 / 1.5;
    const image = await svgToPngBase64(interiorSvg(plan, floor, { pxPerM }));
    const scene = interiorVtt(plan, floor, { imageBase64: image, name: `${name} floor ${floor + 1}` });
    downloadText(
      JSON.stringify(scene),
      `${name.replace(/[^\w.-]+/g, '_')}-floor-${floor + 1}.dd2vtt`,
      'application/json',
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onClick={onClose}
      data-testid="interior-panel"
    >
      <div
        className="max-h-[92vh] w-[44rem] max-w-[95vw] overflow-y-auto rounded border border-stone-300 bg-white p-4 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Floor plans · {name}</span>
          <button
            className="rounded px-1 text-stone-500 hover:bg-stone-100"
            aria-label={t('Close floor plans')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
        {!plan && !error && <p className="text-xs text-stone-500">{t('Drawing…')}</p>}
        {plan && current && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
              {plan.floors.map((f) => (
                <button
                  key={f.floor}
                  className={`${btn} ${f.floor === floor ? 'bg-stone-800 text-white hover:bg-stone-700' : ''}`}
                  onClick={() => setFloor(f.floor)}
                  aria-pressed={f.floor === floor}
                >
                  {f.name}
                </button>
              ))}
              <span className="ml-auto text-stone-500">
                {current.rooms.length} rooms · {current.doors.length} doors · {current.windows.length} windows
                · {plan.floorHeightM} m ceilings
              </span>
            </div>
            <div
              className="overflow-auto rounded border border-stone-200 bg-stone-50 p-1"
              data-testid="interior-svg"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <ul className="mt-2 grid grid-cols-2 gap-x-3 text-xs text-stone-700" data-testid="interior-rooms">
              {current.rooms.map((r) => (
                <li key={r.id}>
                  {r.name} · {r.areaM2} m²
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button
                className={btn}
                onClick={() =>
                  downloadText(
                    svg,
                    `${name.replace(/[^\w.-]+/g, '_')}-floor-${floor + 1}.svg`,
                    'image/svg+xml',
                  )
                }
              >
                {t('SVG of this floor')}
              </button>
              <button className={btn} onClick={() => void downloadVtt()}>
                {t('Universal VTT (.dd2vtt) with walls and doors')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Rasterise an SVG string to PNG base64 (without the data-URL prefix) with a canvas. */
export async function svgToPngBase64(svg: string): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  } finally {
    URL.revokeObjectURL(url);
  }
}
