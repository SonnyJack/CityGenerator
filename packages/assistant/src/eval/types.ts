import type { ScriptedTurn } from '../client.js';

/** One scripted request with its expected outcome. */
export interface EvalCase {
  id: string;
  category: 'question' | 'edit' | 'multi' | 'draw';
  prompt: string;
  /** Tools that must have been called successfully (any order). */
  tools: string[];
  /** Tool calls that are allowed to fail (e.g. a deliberate bad input). */
  allowErrors?: boolean;
  /** The document must be unchanged. */
  readOnly?: boolean;
  /** JSON-pointer checks on the document after the run. */
  doc?: { path: string; equals?: unknown; matches?: string; length?: number; exists?: boolean }[];
  /** A successful tool result whose text must contain a substring. */
  resultIncludes?: { tool: string; text: string }[];
  /** The final assistant text must contain these (case-insensitive). */
  answerIncludes?: string[];
}

export type Recording = Record<string, ScriptedTurn[]>;

export interface EvalResult {
  id: string;
  ok: boolean;
  failures: string[];
  tools: string[];
  answer: string;
}
