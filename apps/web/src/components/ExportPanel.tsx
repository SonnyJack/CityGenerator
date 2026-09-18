import { useState } from 'react';
import { themes } from '@citygen/themes';
import { useApp } from '../store.js';
import {
  VTT_PRESETS,
  currentViewFrame,
  downloadDataUrl,
  downloadText,
  exportDirectoryCsv,
  exportFoundry,
  exportGeoJsonText,
  exportPng,
  exportSvg,
  exportUniversalVtt,
  handoutFrames,
  slug,
  type ExportRequest,
} from '../export/exports.js';

/** Export dialog: pick a frame, a format and a scale; player mode hides GM notes. */
export function ExportPanel({ onClose }: { onClose: () => void }) {
  const doc = useApp((s) => s.document);
  const exportJson = useApp((s) => s.exportJson);
  const [frameId, setFrameId] = useState<string>('view');
  const [pxPerM, setPxPerM] = useState(2);
  const [player, setPlayer] = useState(false);
  const [preset, setPreset] = useState(VTT_PRESETS[0]!.id);
  const [themeId, setThemeId] = useState<string>(doc.ui?.theme ?? 'atlas');
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const frames = handoutFrames();

  const request = (): ExportRequest | null => {
    const frame = frameId === 'view' ? currentViewFrame() : frames.find((f) => f.id === frameId)?.frame;
    if (!frame) return null;
    const p = VTT_PRESETS.find((x) => x.id === preset)!;
    const name =
      frameId === 'view'
        ? doc.meta.name
        : `${doc.meta.name} - ${frames.find((f) => f.id === frameId)?.text ?? 'handout'}`;
    return { frame, pxPerM, player, gridM: p.gridM, pixelsPerGrid: p.pixelsPerGrid, name, themeId };
  };
  const run = async (kind: string, fn: (req: ExportRequest) => Promise<void>) => {
    const req = request();
    if (!req) {
      setReport('No frame to export.');
      return;
    }
    setBusy(kind);
    setReport(null);
    try {
      await fn(req);
    } catch (e) {
      setReport(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const base = () => slug(request()?.name ?? doc.meta.name) + (player ? '-player' : '');
  const frameM = request()?.frame;
  const sizeM: [number, number] | null = frameM
    ? [Math.round(frameM.maxX - frameM.minX), Math.round(frameM.maxY - frameM.minY)]
    : null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onClick={onClose}
      data-testid="export-panel"
    >
      <div
        className="w-[34rem] max-w-[95vw] rounded border border-stone-300 bg-white p-4 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Export</span>
          <button
            className="rounded px-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close export"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-[7rem_1fr] items-center gap-x-2 gap-y-2 text-xs">
          <span className="text-stone-600">Frame</span>
          <select
            aria-label="Export frame"
            className={sel}
            value={frameId}
            onChange={(e) => setFrameId(e.target.value)}
          >
            <option value="view">Current view</option>
            {frames.map((f) => (
              <option key={f.id} value={f.id}>
                Handout frame: {f.text || f.id}
              </option>
            ))}
          </select>
          <span className="text-stone-600">Theme</span>
          <select
            aria-label="Export theme"
            className={sel}
            value={themeId}
            onChange={(e) => setThemeId(e.target.value)}
          >
            {Object.values(themes).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-stone-600">Scale</span>
          <label className="flex items-center gap-2">
            <input
              aria-label="Pixels per metre"
              type="range"
              min={0.25}
              max={12}
              step={0.25}
              value={pxPerM}
              onChange={(e) => setPxPerM(Number(e.target.value))}
            />
            <span className="w-28 font-mono">{pxPerM} px/m</span>
            {sizeM && (
              <span className="text-stone-500">
                {sizeM[0]} × {sizeM[1]} m → {Math.round(sizeM[0] * pxPerM)} × {Math.round(sizeM[1] * pxPerM)}{' '}
                px
              </span>
            )}
          </label>
          <span className="text-stone-600">VTT grid</span>
          <select
            aria-label="VTT preset"
            className={sel}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {VTT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-stone-600">Audience</span>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label="Player export"
              checked={player}
              onChange={(e) => setPlayer(e.target.checked)}
            />
            Player handout (hides GM notes and overlays)
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('png', async (r) => downloadDataUrl((await exportPng(r)).dataUrl, `${base()}.png`))
            }
          >
            PNG image
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('svg', async (r) => downloadText(await exportSvg(r), `${base()}.svg`, 'image/svg+xml'))
            }
          >
            SVG drawing
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('geojson', async (r) =>
                downloadText(await exportGeoJsonText(r), `${base()}.geojson`, 'application/geo+json'),
              )
            }
          >
            GeoJSON (metres)
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('uvtt', async (r) => {
                const out = await exportUniversalVtt(r);
                downloadText(out.json, `${base()}.dd2vtt`, 'application/json');
                setReport(
                  `Universal VTT: ${out.segments} wall segments from ${out.mode}.${out.warnings.length ? ` ${out.warnings.join(' ')}` : ''}`,
                );
              })
            }
          >
            Universal VTT (.dd2vtt)
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('foundry', async (r) => {
                const out = await exportFoundry(r);
                downloadText(out.json, `${base()}.foundry-scene.json`, 'application/json');
                const png = await exportPng({ ...r, pxPerM: r.pixelsPerGrid / r.gridM });
                downloadDataUrl(png.dataUrl, `${slug(r.name)}.png`);
                setReport(
                  `Foundry scene: ${out.segments} wall segments from ${out.mode}; the PNG is the scene background.${out.warnings.length ? ` ${out.warnings.join(' ')}` : ''}`,
                );
              })
            }
          >
            Foundry scene + background
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              run('csv', async () =>
                downloadText(
                  await exportDirectoryCsv(null),
                  `${slug(doc.meta.name)}-directory.csv`,
                  'text/csv',
                ),
              )
            }
          >
            Directory CSV
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              downloadText(exportJson(), `${slug(doc.meta.name)}.citygen.json`, 'application/json')
            }
          >
            Document (.citygen.json)
          </button>
        </div>
        {busy && <p className="mt-2 text-xs text-stone-500">Exporting {busy}…</p>}
        {report && (
          <p className="mt-2 text-xs text-stone-700" data-testid="export-report">
            {report}
          </p>
        )}
        <p className="mt-2 text-[11px] text-stone-500">
          Walls for virtual tabletops come from building outlines in the frame, merged along shared edges and
          capped at 4 000 segments; larger frames fall back to solid blocks.
        </p>
      </div>
    </div>
  );
}

const sel = 'rounded border border-stone-300 bg-white px-1 py-0.5';
const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 text-left hover:bg-stone-100 disabled:opacity-50';
