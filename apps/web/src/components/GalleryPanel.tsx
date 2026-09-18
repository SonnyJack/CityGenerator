import { useEffect, useState } from 'react';
import { importFromUrl } from '../import/importFile.js';

/**
 * Curated example documents shipped with the app and a small index of
 * community packs, both plain JSON under the site root, opened through the
 * same importer as any URL.
 */
interface GalleryEntry {
  file: string;
  name: string;
  seed: string;
  description: string;
  year: number;
  culture: string;
}
interface PluginEntry {
  file: string;
  name: string;
  kind: 'culturePack' | 'featureType';
  description: string;
}

export const BASE = new URL(import.meta.env.BASE_URL, window.location.origin).href;

/** A link that opens a hosted document in this app. */
export function shareLink(docUrl: string): string {
  const u = new URL(BASE);
  u.searchParams.set('doc', docUrl);
  return u.href;
}

export function GalleryPanel({ onClose }: { onClose: () => void }) {
  const [gallery, setGallery] = useState<GalleryEntry[] | null>(null);
  const [plugins, setPlugins] = useState<PluginEntry[] | null>(null);
  const [report, setReport] = useState<string | null>(null);
  useEffect(() => {
    void fetch(`${BASE}gallery/index.json`)
      .then((r) => r.json())
      .then((j: GalleryEntry[]) => setGallery(j))
      .catch(() => setGallery([]));
    void fetch(`${BASE}plugins/index.json`)
      .then((r) => r.json())
      .then((j: PluginEntry[]) => setPlugins(j))
      .catch(() => setPlugins([]));
  }, []);
  const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100';
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onClick={onClose}
      data-testid="gallery"
    >
      <div
        className="max-h-[90vh] w-[40rem] max-w-[95vw] overflow-y-auto rounded border border-stone-300 bg-white p-4 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Gallery</span>
          <button
            className="rounded px-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close gallery"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="mb-2 text-xs text-stone-600">
          Example regions to start from. Opening one replaces the current document (undo brings it back).
          Share any hosted document with a link like <code className="rounded bg-stone-100 px-1">?doc=…</code>
          .
        </p>
        {!gallery && <p className="text-xs text-stone-500">Loading…</p>}
        <ul className="space-y-2" data-testid="gallery-list">
          {gallery?.map((g) => (
            <li key={g.file} className="rounded border border-stone-200 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {g.name} <span className="font-mono text-xs text-stone-500">{g.seed}</span>
                </span>
                <span className="flex gap-1">
                  <button
                    className={btn}
                    onClick={() =>
                      void navigator.clipboard?.writeText(shareLink(`${BASE}gallery/${g.file}`)).then(
                        () => setReport(`Link copied for ${g.name}`),
                        () => setReport(shareLink(`${BASE}gallery/${g.file}`)),
                      )
                    }
                  >
                    Copy link
                  </button>
                  <button
                    className={`${btn} border-stone-800 bg-stone-800 text-white hover:bg-stone-700`}
                    onClick={() =>
                      void importFromUrl(`${BASE}gallery/${g.file}`).then((r) => {
                        setReport(r.message);
                        if (r.ok) onClose();
                      })
                    }
                  >
                    Open
                  </button>
                </span>
              </div>
              <p className="mt-1 text-xs text-stone-600">{g.description}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Community packs
        </h3>
        <p className="mb-2 text-xs text-stone-600">
          Culture packs and feature types listed in the site’s plugin index. Importing adds them to this
          document; see the authoring guide to make your own.
        </p>
        <ul className="space-y-1" data-testid="plugin-list">
          {plugins?.map((p) => (
            <li key={p.file} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-medium">{p.name}</span> ·{' '}
                {p.kind === 'culturePack' ? 'culture pack' : 'feature type'} · {p.description}
              </span>
              <button
                className={btn}
                onClick={() =>
                  void importFromUrl(`${BASE}plugins/${p.file}`).then((r) => setReport(r.message))
                }
              >
                Import
              </button>
            </li>
          ))}
          {plugins && !plugins.length && <li className="text-xs text-stone-500">No packs listed.</li>}
        </ul>
        {report && (
          <p className="mt-2 text-xs text-stone-600" data-testid="gallery-report">
            {report}
          </p>
        )}
      </div>
    </div>
  );
}
