import { get, set, del, keys } from 'idb-keyval';
import { validateDocument, migrateDocument, type MapDocument } from '@citygen/core';

const KEY = 'citygen:autosave';
const DOC_PREFIX = 'citygen:doc:';
const RECENT_KEY = 'citygen:recent';
const MAX_RECENT = 12;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: MapDocument | undefined;

export interface RecentDocument {
  /** Storage key: the document's creation timestamp, unique per document. */
  key: string;
  name: string;
  seed: string;
  modified: string;
}

/** Documents are keyed by their creation time, which survives renames and reseeds. */
export function documentKey(doc: MapDocument): string {
  return `${DOC_PREFIX}${doc.meta.created}`;
}

/** Debounced autosave of the current document to IndexedDB, plus its entry in the recent list. */
export function saveAutosave(doc: MapDocument): Promise<void> {
  pending = doc;
  return new Promise((resolve) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (pending) {
          await set(KEY, pending);
          await set(documentKey(pending), pending);
          await touchRecent(pending);
        }
      } catch (e) {
        console.warn('Autosave failed', e);
      }
      resolve();
    }, 300);
  });
}

export async function loadAutosave(): Promise<MapDocument | null> {
  try {
    const raw = await get<unknown>(KEY);
    if (!raw) return null;
    return validateDocument(migrateDocument(raw));
  } catch (e) {
    console.warn('Autosave could not be restored; starting fresh', e);
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  clearTimeout(timer);
  pending = undefined;
  try {
    await del(KEY);
  } catch {
    /* ignore */
  }
}

export async function listRecent(): Promise<RecentDocument[]> {
  try {
    return (await get<RecentDocument[]>(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function touchRecent(doc: MapDocument): Promise<void> {
  const key = documentKey(doc);
  const rest = (await listRecent()).filter((r) => r.key !== key);
  const entry: RecentDocument = {
    key,
    name: doc.meta.name,
    seed: doc.spec.seed,
    modified: doc.meta.modified,
  };
  const next = [entry, ...rest].slice(0, MAX_RECENT);
  await set(RECENT_KEY, next);
  // Drop stored documents that fell off the list.
  for (const k of await keys()) {
    if (typeof k === 'string' && k.startsWith(DOC_PREFIX) && !next.some((r) => r.key === k)) await del(k);
  }
}

export async function loadRecent(key: string): Promise<MapDocument | null> {
  try {
    const raw = await get<unknown>(key);
    if (!raw) return null;
    return validateDocument(migrateDocument(raw));
  } catch (e) {
    console.warn('Stored document could not be opened', e);
    return null;
  }
}

export async function forgetRecent(key: string): Promise<RecentDocument[]> {
  const next = (await listRecent()).filter((r) => r.key !== key);
  try {
    await set(RECENT_KEY, next);
    await del(key);
  } catch {
    /* ignore */
  }
  return next;
}
