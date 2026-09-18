import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVAL_CASES, runRecorded, type Recording } from '../src/eval/index.js';

const recording = JSON.parse(
  readFileSync(new URL('../eval/recordings.json', import.meta.url), 'utf8'),
) as Recording;

describe('evaluation set (recorded responses)', () => {
  it('has fifty cases across the four categories with a recording each', () => {
    expect(EVAL_CASES).toHaveLength(50);
    const byCat = EVAL_CASES.reduce<Record<string, number>>(
      (m, c) => ({ ...m, [c.category]: (m[c.category] ?? 0) + 1 }),
      {},
    );
    expect(Object.keys(byCat).sort()).toEqual(['draw', 'edit', 'multi', 'question']);
    for (const c of EVAL_CASES) expect(recording[c.id], c.id).toBeDefined();
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(50);
  });

  it('every recorded request produces valid commands or a correct answer', async () => {
    const results = await runRecorded(EVAL_CASES, recording);
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.id}: ${r.failures.join('; ')}`)).toEqual([]);
  });
});
