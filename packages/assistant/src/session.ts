import type { AssistantClient, ChatRequest, ContentBlock, Message, StopReason, Usage } from './client.js';
import { AssistantError, toAssistantError } from './client.js';
import { executeTool, type ToolOutcome } from './execute.js';
import type { ToolHost } from './host.js';
import { addUsage, costUsd, DEFAULT_PRICES, priceFor, type ModelPrice } from './pricing.js';
import { settlementText, summaryText, systemPrompt } from './prompt.js';
import { toolDefinitions, type ToolDefinition } from './tools.js';

/** What the UI renders: a transcript of user text, assistant text, tool cards and errors. */
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; thinking: string; streaming: boolean }
  | { kind: 'tool'; id: string; outcome: ToolOutcome; running: boolean }
  | { kind: 'error'; id: string; code: AssistantError['code']; message: string }
  | { kind: 'notice'; id: string; text: string };

export interface SessionOptions {
  client: AssistantClient;
  host: ToolHost;
  model?: string;
  maxTokens?: number;
  /** Tool rounds per user message before the session stops and reports. */
  maxRounds?: number;
  thinking?: 'adaptive' | 'off';
  effort?: ChatRequest['effort'];
  strictTools?: boolean;
  prices?: Record<string, ModelPrice>;
  /** Keep this many recent tool results in full; older ones are trimmed to a stub. */
  keepToolResults?: number;
  /** Settlement to include a summary for at the start of the conversation. */
  focus?: string | null;
  onChange?: (session: AssistantSession) => void;
}

export const DEFAULT_MODEL = 'claude-opus-5';

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;

/**
 * One conversation: holds the API messages, the transcript for the UI, usage
 * and cost. `send` runs the tool loop until the model ends its turn.
 */
export class AssistantSession {
  readonly model: string;
  readonly transcript: TranscriptItem[] = [];
  usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  costUsd = 0;
  busy = false;
  private messages: Message[] = [];
  private readonly tools: ToolDefinition[];
  private readonly client: AssistantClient;
  private readonly host: ToolHost;
  private readonly opts: SessionOptions;
  private system: string | null = null;
  private abort: AbortController | null = null;

  constructor(options: SessionOptions) {
    this.opts = options;
    this.client = options.client;
    this.host = options.host;
    this.model = options.model ?? DEFAULT_MODEL;
    this.tools = toolDefinitions({ strict: options.strictTools ?? true });
  }

  /** The API-side messages (for tests and recordings). */
  get apiMessages(): readonly Message[] {
    return this.messages;
  }

  cancel(): void {
    this.abort?.abort();
  }

  private changed(): void {
    this.opts.onChange?.(this);
  }

  private push(item: TranscriptItem): TranscriptItem {
    this.transcript.push(item);
    this.changed();
    return item;
  }

  /** Every session starts with the region summary (and the focused settlement) as context. */
  private async prime(): Promise<void> {
    if (this.system) return;
    const summary = await this.host.regionSummary();
    this.system = systemPrompt(summary);
    const parts = [`Current region summary:\n${summaryText(summary)}`];
    if (this.opts.focus) {
      const s = await this.host.settlementSummary(this.opts.focus);
      if (s) parts.push(settlementText(s));
    }
    this.messages.push({ role: 'user', content: [{ type: 'text', text: parts.join('\n\n') }] });
    this.messages.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Understood. I have the region summary and will use tools for any change.' },
      ],
    });
  }

  async send(text: string): Promise<void> {
    if (this.busy) throw new AssistantError('unknown', 'A request is already running.');
    this.busy = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.push({ kind: 'user', id: nextId('u'), text });
    try {
      await this.prime();
      this.messages.push({ role: 'user', content: [{ type: 'text', text }] });
      const maxRounds = this.opts.maxRounds ?? 12;
      for (let round = 0; round <= maxRounds; round++) {
        const item = this.push({
          kind: 'assistant',
          id: nextId('a'),
          text: '',
          thinking: '',
          streaming: true,
        }) as Extract<TranscriptItem, { kind: 'assistant' }>;
        let done: { stopReason: StopReason; content: ContentBlock[] } | null = null;
        const toolUses: { id: string; name: string; input: unknown }[] = [];
        try {
          for await (const ev of this.client.stream(this.request(), signal)) {
            if (ev.type === 'text') {
              item.text += ev.text;
              this.changed();
            } else if (ev.type === 'thinking') {
              item.thinking += ev.text;
              this.changed();
            } else if (ev.type === 'tool_use') toolUses.push(ev);
            else if (ev.type === 'done') {
              done = { stopReason: ev.stopReason, content: ev.content };
              this.usage = addUsage(this.usage, ev.usage);
              this.costUsd += costUsd(ev.usage, priceFor(this.model, this.opts.prices ?? DEFAULT_PRICES));
            }
          }
        } finally {
          item.streaming = false;
          if (!item.text && !item.thinking) this.transcript.splice(this.transcript.indexOf(item), 1);
          this.changed();
        }
        if (!done) throw new AssistantError('unknown', 'The stream ended without a result.');
        const assistantContent = done.content.length
          ? done.content
          : item.text
            ? [{ type: 'text' as const, text: item.text }]
            : [];
        if (assistantContent.length) this.messages.push({ role: 'assistant', content: assistantContent });
        if (done.stopReason === 'refusal') {
          this.push({
            kind: 'notice',
            id: nextId('n'),
            text: 'The model declined this request. Rephrase it or ask for something else; nothing was changed.',
          });
          break;
        }
        if (done.stopReason === 'max_tokens') {
          this.push({
            kind: 'notice',
            id: nextId('n'),
            text: 'The reply hit the token limit and was cut short.',
          });
        }
        if (done.stopReason === 'model_context_window_exceeded') {
          this.push({
            kind: 'notice',
            id: nextId('n'),
            text: 'The conversation is too long for the model. Start a new one.',
          });
          break;
        }
        if (!toolUses.length || done.stopReason === 'end_turn') break;
        if (round === maxRounds) {
          this.push({
            kind: 'notice',
            id: nextId('n'),
            text: `Stopped after ${maxRounds} tool rounds; ask to continue.`,
          });
          // Tell the model too, so the conversation stays well formed.
          this.messages.push({
            role: 'user',
            content: toolUses.map((t) => ({
              type: 'tool_result' as const,
              tool_use_id: t.id,
              content: [{ type: 'text' as const, text: 'Skipped: tool round limit reached.' }],
              is_error: true,
            })),
          });
          break;
        }
        const results: ContentBlock[] = [];
        for (const t of toolUses) {
          const card = this.push({
            kind: 'tool',
            id: nextId('t'),
            running: true,
            outcome: {
              name: t.name as never,
              input: t.input,
              content: [],
              isError: false,
              historyBefore: this.host.historyLength(),
              historyAfter: this.host.historyLength(),
              commands: [],
              warnings: [],
              summary: `${t.name}…`,
            },
          }) as Extract<TranscriptItem, { kind: 'tool' }>;
          const outcome = await executeTool(t.name, t.input, this.host);
          card.outcome = outcome;
          card.running = false;
          this.changed();
          results.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: outcome.content,
            ...(outcome.isError ? { is_error: true } : {}),
          });
        }
        await this.host.settle();
        this.messages.push({ role: 'user', content: results });
        this.trim();
      }
    } catch (e) {
      const err = toAssistantError(e);
      this.push({ kind: 'error', id: nextId('e'), code: err.code, message: err.message });
      // Keep the API transcript well formed: a tool_use without results is dropped.
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'assistant' && last.content.some((b) => b.type === 'tool_use')) this.messages.pop();
    } finally {
      this.busy = false;
      this.abort = null;
      this.changed();
    }
  }

  private request(): ChatRequest {
    const tools = this.tools.map((t, i) =>
      i === this.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t,
    );
    return {
      model: this.model,
      maxTokens: this.opts.maxTokens ?? 4096,
      system: [{ type: 'text', text: this.system ?? '', cache_control: { type: 'ephemeral' } }],
      messages: [...this.messages],
      tools: tools as ToolDefinition[],
      thinking: this.opts.thinking ?? 'adaptive',
      ...(this.opts.effort ? { effort: this.opts.effort } : {}),
    };
  }

  /**
   * Bound the context: old tool results are replaced by a stub and old images
   * dropped, keeping the latest `keepToolResults` results whole. The priming
   * summary (first user message) is never trimmed.
   */
  private trim(): void {
    const keep = this.opts.keepToolResults ?? 6;
    let seen = 0;
    for (let m = this.messages.length - 1; m >= 1; m--) {
      const msg = this.messages[m]!;
      if (msg.role !== 'user') continue;
      for (let b = msg.content.length - 1; b >= 0; b--) {
        const block = msg.content[b]!;
        if (block.type !== 'tool_result') continue;
        seen += 1;
        if (seen <= keep) continue;
        const hadImage = block.content.some((c) => c.type === 'image');
        const textLen = block.content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0);
        if (hadImage || textLen > 400)
          msg.content[b] = {
            ...block,
            content: [
              {
                type: 'text',
                text: '[earlier result trimmed to save context; call the tool again if needed]',
              },
            ],
          };
      }
    }
  }
}
