import { createStore, get, set, del } from 'idb-keyval';
import type { StageStore } from '@citygen/core';

/**
 * Where the engine keeps the output of its dear stages between sessions, so a document that is
 * opened again draws without computing them afresh. Each entry is keyed by the stage's own memo
 * key, which already carries the stage id, its version and a hash of its inputs, so an entry can
 * never be served to a different terrain or an older algorithm.
 *
 * The store is in its own IndexedDB database, away from the documents, and is trimmed to a few
 * entries: the terrain of a 12 km region is some fifteen megabytes, and a browser that runs out
 * of room throws on the write, which the runner treats as "not kept" rather than a failure.
 *
 * Two things keep the writing out of the way of the drawing. The entries are dated in a small
 * index of their own rather than in the entries, so neither touching an entry nor trimming the
 * store ever reads a terrain back. And a write waits for the worker to fall quiet — the map asks
 * this same worker for its tiles, and a fifteen megabyte write in the middle of that would hold
 * them up — though never longer than {@link LATEST_MS}, so a busy session still keeps its work.
 */
const db = createStore('citygen-stages', 'stages');

/** How many stage outputs to keep: enough for a document and the one before it. */
const MAX_ENTRIES = 6;
/** How long the worker must have been quiet before what is waiting is written. */
const QUIET_MS = 2_000;
/** How long a write may be put off while the worker stays busy. */
const LATEST_MS = 20_000;
/** The dates of the entries, under a key no stage can produce (stage keys start with their id). */
const INDEX_KEY = '#index';

type Index = Record<string, number>;

export function stageStore(): StageStore {
  return {
    async get(key) {
      const value = await get(key, db);
      if (value === undefined) return undefined;
      void touch(key);
      return value;
    },
    async set(key, value) {
      if (!pending.size) due = Date.now() + LATEST_MS;
      pending.set(key, value);
      arm();
    },
  };
}

/**
 * Put off a waiting write: the worker is about to do something the reader is waiting for. The
 * web worker calls this as it serves a tile.
 */
export function deferStoreWrites(): void {
  if (pending.size) arm();
}

const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
let due = 0;

/** Wait for the next lull, or until the write is due, whichever comes first. */
function arm(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), Math.max(0, Math.min(QUIET_MS, due - Date.now())));
}

/** Write what is waiting, then date it and tidy up. */
async function flush(): Promise<void> {
  const entries = [...pending];
  pending.clear();
  const written: string[] = [];
  for (const [key, value] of entries) {
    try {
      await set(key, value, db);
      written.push(key);
    } catch {
      // Out of room: the run still stands, it just is not kept.
    }
  }
  if (written.length) await trim(written);
}

/** Date an entry that has just been written or read, and drop the least recently used. */
async function trim(written: string[]): Promise<void> {
  try {
    const index = { ...(((await get(INDEX_KEY, db)) as Index | undefined) ?? {}) };
    for (const key of written) index[key] = Date.now();
    const dated = Object.entries(index).sort((a, b) => a[1] - b[1]);
    for (const [key] of dated.slice(0, Math.max(0, dated.length - MAX_ENTRIES))) {
      await del(key, db);
      delete index[key];
    }
    await set(INDEX_KEY, index, db);
  } catch {
    // Dating and trimming are housekeeping; a failure leaves the store as it was.
  }
}

/** Mark an entry as used, so the trim above keeps it. */
async function touch(key: string): Promise<void> {
  try {
    const index = ((await get(INDEX_KEY, db)) as Index | undefined) ?? {};
    await set(INDEX_KEY, { ...index, [key]: Date.now() }, db);
  } catch {
    // As above: a store that cannot be dated is still a store.
  }
}
