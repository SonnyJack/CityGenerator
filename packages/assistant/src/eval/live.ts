import { anthropicClient, type ContentBlock, type ScriptedTurn } from '../client.js';
import { EVAL_CASES } from './cases.js';
import { runCase } from './run.js';
import type { EvalCase, EvalResult, Recording } from './types.js';

/**
 * Run the evaluation set against the real API and record every assistant
 * turn, so the recording can replay in CI. Needs ANTHROPIC_API_KEY.
 */
export async function runLive(options: {
  apiKey: string;
  model?: string;
  only?: string[];
  onCase?: (result: EvalResult) => void;
}): Promise<{ results: EvalResult[]; recording: Recording }> {
  const base = anthropicClient({ apiKey: options.apiKey, dangerouslyAllowBrowser: false });
  const recording: Recording = {};
  const results: EvalResult[] = [];
  const cases: EvalCase[] = options.only?.length
    ? EVAL_CASES.filter((c) => options.only!.includes(c.id))
    : EVAL_CASES;
  for (const c of cases) {
    const turns: ScriptedTurn[] = [];
    const recorder = {
      async *stream(request: Parameters<typeof base.stream>[0], signal?: AbortSignal) {
        let content: ContentBlock[] = [];
        for await (const ev of base.stream(request, signal)) {
          if (ev.type === 'done') {
            content = ev.content;
            turns.push({
              content: content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'),
              stopReason: ev.stopReason,
              usage: ev.usage,
            });
          }
          yield ev;
        }
      },
      structured: base.structured,
    };
    const r = await runCase(c, recorder, { ...(options.model ? { model: options.model } : {}) });
    recording[c.id] = turns;
    results.push(r);
    options.onCase?.(r);
  }
  return { results, recording };
}
