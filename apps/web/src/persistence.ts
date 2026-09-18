import { get, set, del } from 'idb-keyval';
import { validateDocument, migrateDocument, type MapDocument } from '@citygen/core';

const KEY = 'citygen:autosave';
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: MapDocument | undefined;

/** Debounced autosave of the current document to IndexedDB. */
export function saveAutosave(doc: MapDocument): Promise<void> {
  pending = doc;
  return new Promise((resolve) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (pending) await set(KEY, pending);
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
