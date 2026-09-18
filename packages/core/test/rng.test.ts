import { describe, expect, it } from 'vitest';
import { Rng, hash128, hashHex, contentHash, stableStringify } from '../src/index.js';

describe('Rng', () => {
  it('is deterministic for the same path', () => {
    const a = new Rng('seed/x');
    const b = new Rng('seed/x');
    const seqA = Array.from({ length: 100 }, () => a.nextU32());
    const seqB = Array.from({ length: 100 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('forks depend only on the child path, not on parent consumption', () => {
    const p1 = new Rng('seed');
    const p2 = new Rng('seed');
    p2.next();
    p2.next();
    expect(p1.fork('a').nextU32()).toBe(p2.fork('a').nextU32());
    expect(p1.fork('a').nextU32()).not.toBe(p1.fork('b').nextU32());
  });

  it('produces uniform-ish floats in [0, 1)', () => {
    const r = new Rng('uniform');
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('int() covers the inclusive range', () => {
    const r = new Rng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('weighted() respects weights', () => {
    const r = new Rng('weighted');
    let heavy = 0;
    for (let i = 0; i < 5000; i++) if (r.weighted(['a', 'b'], [9, 1]) === 'a') heavy++;
    expect(heavy / 5000).toBeGreaterThan(0.85);
  });
});

describe('hashing', () => {
  it('hash128 is stable', () => {
    expect(hash128('')).toEqual(hash128(''));
    expect(hash128('a')).not.toEqual(hash128('b'));
    expect(hashHex('citygen')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('stableStringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
  });

  it('contentHash distinguishes typed array contents', () => {
    expect(contentHash(new Float32Array([1, 2, 3]))).not.toBe(contentHash(new Float32Array([1, 2, 4])));
    expect(contentHash(new Float32Array([1, 2, 3]))).toBe(contentHash(new Float32Array([1, 2, 3])));
  });
});
