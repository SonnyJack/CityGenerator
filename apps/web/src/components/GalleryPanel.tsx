import { useEffect, useState } from 'react';
import { fetchRegistry, type Registry } from '@citygen/import';
import { importFromUrl } from '../import/importFile.js';
import { useT } from '../i18n/index.js';

/**
 * The gallery: example documents and community packs from every registry
 * the app knows. The site ships two (its gallery and its plugin index);
 * users add any hosted index.json, remembered in this browser.
 */
export const BASE = new URL(import.meta.env.BASE_URL, window.location.origin).href;

/** A link that opens a hosted document in this app. */
export function shareLink(docUrl: string): string {
  const u = new URL(BASE);
  u.searchParams.set('doc', docUrl);
  return u.href;
}

const STORAGE = 'citygen.registries';

export const BUILT_IN_REGISTRIES: { url: string; name: string }[] = [
  { url: `${BASE}gallery/index.json`, name: 'Examples' },
  { url: `${BASE}plugins/index.json`, name: 'Community packs' },
];

export function userRegistries(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveUserRegistries(urls: string[]) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(urls));
  } catch {
    // Private mode or blocked storage: the list lives for this session only.
  }
}

type Loaded = { url: string; name: string; builtIn: boolean; registry?: Registry; error?: string };

export function GalleryPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [urls, setUrls] = useState<string[]>(() => userRegistries());
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const all = [...BUILT_IN_REGISTRIES, ...urls.map((url) => ({ url, name: '' }))];
  const key = all.map((r) => r.url).join('\n');
  useEffect(() => {
    let live = true;
    const list = key ? key.split('\n') : [];
    void Promise.all(
      list.map(async (url): Promise<Loaded> => {
        const builtIn = BUILT_IN_REGISTRIES.find((b) => b.url === url);
        try {
          const registry = await fetchRegistry(url, fetch, builtIn?.name);
          return { url, name: registry.name, builtIn: !!builtIn, registry };
        } catch (e) {
          return { url, name: builtIn?.name ?? url, builtIn: !!builtIn, error: (e as Error).message };
        }
      }),
    ).then((rs) => live && setLoaded(rs));
    return () => {
      live = false;
    };
  }, [key]);

  function addRegistry() {
    const url = draft.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      setReport(t('{url}: not a URL', { url }));
      return;
    }
    if (!urls.includes(url) && !BUILT_IN_REGISTRIES.some((b) => b.url === url)) {
      const next = [...urls, url];
      setUrls(next);
      saveUserRegistries(next);
    }
    setDraft('');
  }

  function removeRegistry(url: string) {
    const next = urls.filter((u) => u !== url);
    setUrls(next);
    saveUserRegistries(next);
  }

  const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100';
  const primary = `${btn} border-stone-800 bg-stone-800 text-white hover:bg-stone-700`;
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
      onClick={onClose}
      data-testid="gallery"
    >
      <div
        className="max-h-[90vh] w-[44rem] max-w-[95vw] overflow-y-auto rounded border border-stone-300 bg-white p-4 text-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">{t('Gallery')}</span>
          <button
            className="rounded px-1 text-stone-500 hover:bg-stone-100"
            aria-label={t('Close gallery')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="mb-2 text-xs text-stone-600">
          {t(
            'Example regions and community packs. Opening a document replaces the current one (undo brings it back); importing a pack adds it to this document. Share any hosted document with a link like',
          )}{' '}
          <code className="rounded bg-stone-100 px-1">?doc=…</code>.
        </p>
        {!loaded.length && <p className="text-xs text-stone-500">{t('Loading…')}</p>}
        {loaded.map((r) => (
          <section key={r.url} className="mb-3" data-testid="registry" data-url={r.url}>
            <h3 className="mt-3 mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <span>{r.builtIn ? t(r.name) : r.name}</span>
              {r.registry?.description && (
                <span className="font-normal normal-case tracking-normal">· {r.registry.description}</span>
              )}
              {!r.builtIn && (
                <button
                  className="ml-auto rounded px-1 font-normal normal-case tracking-normal text-stone-400 hover:text-stone-700"
                  aria-label={t('Remove registry {name}', { name: r.name })}
                  onClick={() => removeRegistry(r.url)}
                >
                  {t('remove')}
                </button>
              )}
            </h3>
            {r.error && <p className="text-xs text-red-700">{r.error}</p>}
            {r.registry && !r.registry.documents.length && !r.registry.packs.length && (
              <p className="text-xs text-stone-500">{t('Nothing listed.')}</p>
            )}
            {r.registry && r.registry.documents.length > 0 && (
              <ul className="space-y-2" data-testid={r.builtIn ? 'gallery-list' : 'registry-documents'}>
                {r.registry.documents.map((g) => (
                  <li key={g.url} className="rounded border border-stone-200 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {g.name}{' '}
                        {g.seed && <span className="font-mono text-xs text-stone-500">{g.seed}</span>}
                      </span>
                      <span className="flex gap-1">
                        <button
                          className={btn}
                          onClick={() =>
                            void navigator.clipboard?.writeText(shareLink(g.url)).then(
                              () => setReport(t('Link copied for {name}', { name: g.name })),
                              () => setReport(shareLink(g.url)),
                            )
                          }
                        >
                          {t('Copy link')}
                        </button>
                        <button
                          className={primary}
                          onClick={() =>
                            void importFromUrl(g.url).then((res) => {
                              setReport(res.message);
                              if (res.ok) onClose();
                            })
                          }
                        >
                          {t('Open')}
                        </button>
                      </span>
                    </div>
                    {g.description && <p className="mt-1 text-xs text-stone-600">{g.description}</p>}
                  </li>
                ))}
              </ul>
            )}
            {r.registry && r.registry.packs.length > 0 && (
              <ul className="space-y-1" data-testid={r.builtIn ? 'plugin-list' : 'registry-packs'}>
                {r.registry.packs.map((p) => (
                  <li key={p.url} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      <span className="font-medium">{p.name}</span> ·{' '}
                      {t(p.kind === 'culturePack' ? 'culture pack' : 'feature type')}
                      {p.author ? ` · ${p.author}` : ''}
                      {p.description ? ` · ${p.description}` : ''}
                    </span>
                    <button
                      className={btn}
                      onClick={() => void importFromUrl(p.url).then((res) => setReport(res.message))}
                    >
                      {t('Import')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <form
          className="mt-3 flex items-center gap-1 border-t border-stone-200 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            addRegistry();
          }}
        >
          <input
            aria-label={t('Registry URL')}
            className="flex-1 rounded border border-stone-300 px-2 py-1 text-xs"
            placeholder="https://…/index.json — add a pack registry"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className={btn} type="submit">
            {t('Add registry')}
          </button>
        </form>
        <p className="mt-1 text-[11px] text-stone-500">
          {t(
            'A registry is a JSON index of packs and documents hosted anywhere; the format is in the authoring guide. Added registries are remembered in this browser only.',
          )}
        </p>
        {report && (
          <p className="mt-2 text-xs text-stone-600" data-testid="gallery-report">
            {report}
          </p>
        )}
      </div>
    </div>
  );
}
