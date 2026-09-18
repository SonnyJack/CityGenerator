import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  FIXTURE_GOLDEN_HASH,
  StageRunner,
  computeFixtureHash,
  defineStage,
  regionOutlineStage,
} from '../src/index.js';

describe('StageRunner', () => {
  it('memoises by input content and stage version', async () => {
    let calls = 0;
    const stage = defineStage<{ n: number }, number>({
      id: 'double',
      version: 1,
      run: (input) => {
        calls++;
        return input.n * 2;
      },
    });
    const runner = new StageRunner();
    expect(await runner.run(stage, { n: 2 })).toBe(4);
    expect(await runner.run(stage, { n: 2 })).toBe(4);
    expect(await runner.run(stage, { n: 3 })).toBe(6);
    expect(calls).toBe(2);
    expect(runner.hits).toBe(1);
    expect(runner.misses).toBe(2);
    const v2 = { ...stage, version: 2 };
    expect(await runner.run(v2, { n: 2 })).toBe(4);
    expect(calls).toBe(3);
  });

  it('gives each stage a stable random stream', async () => {
    const stage = defineStage<{ seed: string }, number>({
      id: 'draw',
      version: 1,
      seedOf: (i) => i.seed,
      run: (_input, ctx) => ctx.rng.nextU32(),
    });
    const a = await new StageRunner().run(stage, { seed: 's' });
    const b = await new StageRunner().run(stage, { seed: 's' });
    const c = await new StageRunner().run(stage, { seed: 't' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('cancels at checkpoints', async () => {
    const controller = new AbortController();
    const stage = defineStage<Record<string, never>, string>({
      id: 'slow',
      version: 1,
      run: async (_i, ctx) => {
        await Promise.resolve();
        controller.abort();
        ctx.checkpoint();
        return 'unreachable';
      },
    });
    await expect(new StageRunner().run(stage, {}, { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it('evicts least recently used entries', async () => {
    const stage = defineStage<{ n: number }, number>({ id: 'id', version: 1, run: (i) => i.n });
    const runner = new StageRunner({ maxEntries: 2 });
    await runner.run(stage, { n: 1 });
    await runner.run(stage, { n: 2 });
    await runner.run(stage, { n: 1 });
    await runner.run(stage, { n: 3 });
    expect(runner.has(stage, { n: 2 })).toBe(false);
    expect(runner.has(stage, { n: 1 })).toBe(true);
    expect(runner.size).toBe(2);
  });
});

describe('regionOutline stage (golden)', () => {
  it('produces a fixed hash for the fixture seed', async () => {
    const out = await new StageRunner().run(regionOutlineStage, {
      seed: 'fixture',
      extent: { widthM: 10_000, heightM: 8_000 },
    });
    expect(out.graticule.features.length).toBe(11 + 9);
    expect(out.samples.features.length).toBe(64);
  });

  it('matches the golden determinism hash shared with the browser e2e tests', async () => {
    expect(await computeFixtureHash()).toBe(FIXTURE_GOLDEN_HASH);
  });
});
