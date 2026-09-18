import type { Usage } from './client.js';

/**
 * Estimated prices in USD per million tokens. These are estimates for the
 * cost display, editable in the settings; the invoice is the truth.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** Multipliers on the input price. */
  cacheRead: number;
  cacheWrite: number;
}

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export function priceFor(model: string, prices: Record<string, ModelPrice> = DEFAULT_PRICES): ModelPrice {
  if (prices[model]) return prices[model]!;
  const key = Object.keys(prices).find((k) => model.startsWith(k.replace(/-\d{8}$/, '')));
  return key ? prices[key]! : { input: 5, output: 25, cacheRead: 0.1, cacheWrite: 1.25 };
}

export function costUsd(usage: Usage, price: ModelPrice): number {
  const m = 1_000_000;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.input * price.cacheRead +
      usage.cacheWriteTokens * price.input * price.cacheWrite) /
    m
  );
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
