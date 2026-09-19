import { contentHash } from '../random/hash.js';
import { Rng } from '../random/rng.js';

/**
 * Pipeline stages are pure functions of their inputs. The runner memoises each
 * stage on a content hash of its inputs, so a document change re-runs only the
 * stages whose inputs actually changed. Long stages call `ctx.checkpoint()`
 * regularly so a superseded run can be cancelled.
 */

export class CancelledError extends Error {
  constructor() {
    super('Stage run cancelled');
    this.name = 'CancelledError';
  }
}

export interface StageContext {
  /** Memo key of this run; outputs may carry it so downstream stages can key on it cheaply. */
  key: string;
  /** Named random stream for this stage, derived from the seed and stage id. */
  rng: Rng;
  /** Throws CancelledError if the run has been aborted. */
  checkpoint(): void;
  /** Reports coarse progress in [0, 1]. */
  progress(fraction: number, message?: string): void;
  /** Runs a nested stage, memoised like any other. */
  run<I, O>(stage: StageDef<I, O>, input: I): Promise<O>;
}

export interface StageDef<I, O> {
  /** Stable id; part of the memo key. Bump `version` when the algorithm changes. */
  id: string;
  version: number;
  /** Which part of the input decides the random stream (defaults to the whole input hash). */
  seedOf?: (input: I) => string;
  /**
   * Cheap memo key for large inputs (e.g. the key of an upstream stage's output plus a
   * small parameter hash). Defaults to a content hash of the whole input.
   */
  keyOf?: (input: I) => string;
  run: (input: I, ctx: StageContext) => O | Promise<O>;
  /**
   * How to keep this stage's output between sessions. A stage whose output is dear to compute
   * and cheap to describe (the terrain, say) can say how to flatten it for a store and how to
   * build it back; the runner then reads it from the store instead of running again. Output
   * with methods on it (a Raster) has to be rebuilt here, since a store only keeps data.
   * `pack` may return `undefined` for a run not worth keeping, such as a coarse preview.
   */
  cache?: { pack(value: O): unknown | undefined; unpack(raw: unknown): O };
}

/**
 * Somewhere to keep stage output between sessions, such as IndexedDB in the browser. Both
 * calls may fail (quota, a private window); the runner treats a failure as a miss.
 */
export interface StageStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function defineStage<I, O>(def: StageDef<I, O>): StageDef<I, O> {
  return def;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (stageId: string, fraction: number, message?: string) => void;
}

export interface StageRunnerOptions {
  /** Maximum memo entries; least recently used are evicted. */
  maxEntries?: number;
  /** Where to keep the output of stages that say how to cache it (see `StageDef.cache`). */
  store?: StageStore;
}

interface MemoEntry {
  value: unknown;
  lastUsed: number;
}

export class StageRunner {
  private readonly memo = new Map<string, MemoEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly store?: StageStore;
  private tick = 0;
  hits = 0;
  misses = 0;
  /** Runs answered from the store rather than by running the stage. */
  stored = 0;

  constructor(options: StageRunnerOptions = {}) {
    this.maxEntries = options.maxEntries ?? 512;
    this.store = options.store;
  }

  /** Memo key for a stage and input; exposed for tests and diagnostics. */
  keyFor<I, O>(stage: StageDef<I, O>, input: I): string {
    return `${stage.id}@${stage.version}:${stage.keyOf ? stage.keyOf(input) : contentHash(input)}`;
  }

  async run<I, O>(stage: StageDef<I, O>, input: I, options: RunOptions = {}): Promise<O> {
    const key = this.keyFor(stage, input);
    const cached = this.memo.get(key);
    if (cached) {
      cached.lastUsed = ++this.tick;
      this.hits++;
      return cached.value as O;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<O>;

    this.misses++;
    const signal = options.signal;
    const seed = stage.seedOf ? stage.seedOf(input) : key;
    const ctx: StageContext = {
      key,
      rng: new Rng(`${seed}/${stage.id}`),
      checkpoint: () => {
        if (signal?.aborted) throw new CancelledError();
      },
      progress: (fraction, message) => options.onProgress?.(stage.id, fraction, message),
      run: (inner, innerInput) => this.run(inner, innerInput, options),
    };

    const promise = (async () => {
      ctx.checkpoint();
      // A stage that says how to cache it may already be in the store from an earlier session.
      if (stage.cache && this.store) {
        try {
          const raw = await this.store.get(key);
          if (raw !== undefined) {
            const value = stage.cache.unpack(raw);
            ctx.checkpoint();
            this.stored++;
            this.memo.set(key, { value, lastUsed: ++this.tick });
            this.evict();
            return value;
          }
        } catch {
          // A store that cannot be read is a miss, not a failure.
        }
      }
      const value = await stage.run(input, ctx);
      ctx.checkpoint();
      this.memo.set(key, { value, lastUsed: ++this.tick });
      this.evict();
      if (stage.cache && this.store) {
        const packed = stage.cache.pack(value);
        if (packed !== undefined)
          void this.store.set(key, packed).catch(() => {
            // Out of quota or no store: the run still stands, it just is not kept.
          });
      }
      return value;
    })();
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  has<I, O>(stage: StageDef<I, O>, input: I): boolean {
    return this.memo.has(this.keyFor(stage, input));
  }

  clear(): void {
    this.memo.clear();
  }

  get size(): number {
    return this.memo.size;
  }

  private evict(): void {
    while (this.memo.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [k, v] of this.memo) {
        if (v.lastUsed < oldest) {
          oldest = v.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) break;
      this.memo.delete(oldestKey);
    }
  }
}
