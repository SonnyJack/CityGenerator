import { hash128 } from './hash.js';

/**
 * Deterministic random number generator (sfc32) seeded from a *path*.
 *
 * Every stream is identified by a path such as `"myseed/terrain/tile:3:4"`.
 * `fork(name)` derives a child stream whose state depends only on the child
 * path, never on how many numbers the parent has drawn. This keeps unrelated
 * stages stable when one parameter changes and lets blocks and tiles derive
 * their own streams lazily.
 *
 * The generator is small, fast, and uses only 32-bit integer arithmetic, so it
 * produces identical sequences in every JavaScript engine.
 */
export class Rng {
  readonly path: string;
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(path: string) {
    this.path = path;
    const [a, b, c, d] = hash128(path);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // Discard the first outputs so seeds with similar hashes decorrelate.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** A child stream for a named sub-task. */
  fork(name: string | number): Rng {
    return new Rng(`${this.path}/${name}`);
  }

  /** Unsigned 32-bit integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Element chosen by weight (weights need not sum to 1). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length)
      throw new RangeError('Rng.weighted: bad input');
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** Standard normal via Box–Muller. */
  normal(mean = 0, stdDev = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i]!;
      items[i] = items[j]!;
      items[j] = t;
    }
    return items;
  }
}

/** Path for a tile-scoped stream, so tiles can be generated lazily and independently. */
export function tilePath(seed: string, level: string, z: number, x: number, y: number): string {
  return `${seed}/${level}/tile:${z}:${x}:${y}`;
}

/** Path for a block-scoped stream. */
export function blockPath(seed: string, settlementId: string, blockId: string): string {
  return `${seed}/settlement:${settlementId}/block:${blockId}`;
}
