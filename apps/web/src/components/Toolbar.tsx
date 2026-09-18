import { useRef, useState } from 'react';
import { useApp } from '../store.js';
import { HistoryMenu } from './HistoryMenu.js';
import { RecentMenu } from './RecentMenu.js';
import { ExportPanel } from './ExportPanel.js';
import { useAssistant } from '../assistant/store.js';
import { imagePixels, importText } from '../import/importFile.js';
import { HeightmapDialog } from './HeightmapDialog.js';
import { GalleryPanel } from './GalleryPanel.js';
import { LOCALES, useLocale, useT } from '../i18n/index.js';

export function Toolbar() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const directoryOpen = useApp((s) => s.directoryOpen);
  const setDirectoryOpen = useApp((s) => s.setDirectoryOpen);
  const assistantOpen = useAssistant((s) => s.open);
  const setAssistantOpen = useAssistant((s) => s.setOpen);
  void exportJson;

  const [heightmap, setHeightmap] = useState<{
    name: string;
    pixels: { width: number; height: number; rgba: Uint8ClampedArray };
  } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  void importJson;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setHeightmap({ name: file.name, pixels: await imagePixels(file) });
      return;
    }
    const r = importText(file.name, await file.text());
    setReport(r.message);
  }

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-stone-300 bg-stone-50 px-3 py-2 text-sm">
      <span className="font-semibold tracking-tight">CityGenerator</span>
      <span className="text-xs text-stone-500">v1.0-rc</span>

      <label className="ml-4 flex items-center gap-1">
        <span className="text-stone-600">{t('Name')}</span>
        <input
          aria-label={t('Document name')}
          className="w-40 rounded border border-stone-300 px-2 py-1"
          value={doc.meta.name}
          onChange={(e) => dispatch({ type: 'meta.rename', name: e.target.value || 'Untitled region' })}
        />
      </label>
      <div className="ml-auto flex items-center gap-1">
        <button className={btn} onClick={undo} disabled={!canUndo} aria-label={t('Undo')}>
          {t('Undo')}
        </button>
        <button className={btn} onClick={redo} disabled={!canRedo} aria-label={t('Redo')}>
          {t('Redo')}
        </button>
        <HistoryMenu />
        <button className={btn} onClick={() => newDocument()}>
          {t('New')}
        </button>
        <RecentMenu />
        <button className={btn} onClick={() => fileInput.current?.click()}>
          {t('Import…')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.osm,.xml,.png,.jpg,.jpeg,.webp,application/json"
          className="hidden"
          onChange={onFile}
        />
        <button className={btn} onClick={() => setGalleryOpen(true)}>
          {t('Gallery')}
        </button>
        <button className={btn} onClick={() => setDirectoryOpen(!directoryOpen)} aria-pressed={directoryOpen}>
          {t('Directory')}
        </button>
        <button className={btn} onClick={() => setExportOpen(true)}>
          {t('Export…')}
        </button>
        <button className={btn} onClick={() => setAssistantOpen(!assistantOpen)} aria-pressed={assistantOpen}>
          {t('Assistant')}
        </button>
        <select
          aria-label={t('Language')}
          className="rounded border border-stone-300 bg-white px-1 py-1 text-xs"
          value={locale}
          onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]['id'])}
        >
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
      {galleryOpen && <GalleryPanel onClose={() => setGalleryOpen(false)} />}
      {heightmap && (
        <HeightmapDialog
          name={heightmap.name}
          pixels={heightmap.pixels}
          onClose={(message) => {
            setHeightmap(null);
            if (message) setReport(message);
          }}
        />
      )}
      {report && (
        <span className="text-xs text-stone-600" data-testid="import-report">
          {report}{' '}
          <button
            className="text-stone-400 hover:text-stone-700"
            aria-label={t('Dismiss import report')}
            onClick={() => setReport(null)}
          >
            ×
          </button>
        </span>
      )}

      <div className="basis-full text-xs text-stone-500" data-testid="status">
        {status === 'generating' && t('Generating…')}
        {status === 'idle' &&
          stats &&
          t(
            'Ready · terrain {terrain} ms · land cover {landcover} ms · settlements {settlements} ms · roads & rail {roads} ms · tiles {tiles} ms · memo {memo}',
            {
              terrain: stats.terrainMs.toFixed(0),
              landcover: stats.landcoverMs.toFixed(0),
              settlements: stats.settlementsMs.toFixed(0),
              roads: stats.roadsMs.toFixed(0),
              tiles: stats.tilesMs.toFixed(0),
              memo: `${stats.memoHits}/${stats.memoHits + stats.memoMisses}`,
            },
          )}
        {status === 'idle' && !stats && t('Starting engine…')}
        {error && <span className="ml-2 text-red-700">{error}</span>}
      </div>
    </header>
  );
}

const btn =
  'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40';
