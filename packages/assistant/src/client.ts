import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ToolDefinition } from './tools.js';

/**
 * The narrow client interface the session talks to. The Anthropic
 * implementation wraps the official SDK (browser opt-in, streaming, adaptive
 * thinking, prompt caching); the scripted implementation replays recorded
 * turns for tests and the evaluation set.
 */

export type ContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: ToolResultContent[];
      is_error?: boolean;
      cache_control?: CacheControl;
    }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

export type CacheControl = { type: 'ephemeral' };

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded';

export interface ChatRequest {
  model: string;
  system: { type: 'text'; text: string; cache_control?: CacheControl }[];
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens: number;
  thinking?: 'adaptive' | 'off';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: StopReason; usage: Usage; content: ContentBlock[] };

export interface StructuredRequest<T> {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface AssistantClient {
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  structured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<{ value: T; usage: Usage }>;
}

/** Errors the UI can explain: the SDK's classes are mapped to these codes. */
export class AssistantError extends Error {
  constructor(
    public readonly code:
      'auth' | 'network' | 'rate_limit' | 'bad_request' | 'server' | 'aborted' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}

/** Plain-language messages per error code, shared by the SDK mapping and the scripted client. */
export const ERROR_MESSAGES: Record<AssistantError['code'], string> = {
  auth: 'The API key was rejected. Check it in the assistant settings.',
  network: 'Could not reach the Anthropic API. Check the network connection.',
  rate_limit: 'Rate limited by the API. Wait a moment and try again.',
  bad_request: 'The API rejected the request.',
  server: 'The API reported a server error. Try again shortly.',
  aborted: 'Request cancelled.',
  unknown: 'Something went wrong talking to the API.',
};

export function toAssistantError(e: unknown): AssistantError {
  if (e instanceof AssistantError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AssistantError('aborted', ERROR_MESSAGES.aborted);
  if (e instanceof Anthropic.AuthenticationError) return new AssistantError('auth', ERROR_MESSAGES.auth);
  if (e instanceof Anthropic.PermissionDeniedError)
    return new AssistantError('auth', 'This API key is not allowed to use that model.');
  if (e instanceof Anthropic.RateLimitError)
    return new AssistantError('rate_limit', ERROR_MESSAGES.rate_limit);
  if (e instanceof Anthropic.BadRequestError)
    return new AssistantError('bad_request', `The API rejected the request: ${(e as Error).message}`);
  if (e instanceof Anthropic.InternalServerError) return new AssistantError('server', ERROR_MESSAGES.server);
  if (e instanceof Anthropic.APIConnectionError) return new AssistantError('network', ERROR_MESSAGES.network);
  if (e instanceof Anthropic.APIError)
    return new AssistantError('unknown', `API error ${e.status ?? ''}: ${e.message}`.trim());
  const msg = (e as Error)?.message ?? String(e);
  if (/fetch|network|Failed to fetch|ECONN/i.test(msg))
    return new AssistantError('network', ERROR_MESSAGES.network);
  return new AssistantError('unknown', msg);
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

function usageOf(
  u:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      }
    | null
    | undefined,
): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export interface AnthropicClientOptions {
  apiKey: string;
  /** Required in browsers: the key stays on the user's machine and goes only to the API. */
  dangerouslyAllowBrowser?: boolean;
  baseURL?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
}

/** The production client over the official SDK. */
export function anthropicClient(options: AnthropicClientOptions): AssistantClient {
  const sdk = new Anthropic({
    apiKey: options.apiKey,
    dangerouslyAllowBrowser: options.dangerouslyAllowBrowser ?? true,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch as never } : {}),
    maxRetries: options.maxRetries ?? 2,
  });
  return {
    async *stream(request, signal) {
      let stream;
      try {
        stream = await sdk.messages.create(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system as never,
            messages: request.messages as never,
            tools: request.tools as never,
            stream: true,
            ...(request.thinking === 'off' ? {} : { thinking: { type: 'adaptive' } }),
            ...(request.effort ? { output_config: { effort: request.effort } } : {}),
          },
          { ...(signal ? { signal } : {}) },
        );
      } catch (e) {
        throw toAssistantError(e);
      }
      const blocks: ContentBlock[] = [];
      const partialJson: string[] = [];
      let stopReason: StopReason = 'end_turn';
      let usage = emptyUsage();
      try {
        for await (const ev of stream) {
          switch (ev.type) {
            case 'message_start':
              usage = usageOf(ev.message.usage);
              break;
            case 'content_block_start': {
              const b = ev.content_block;
              if (b.type === 'text') blocks[ev.index] = { type: 'text', text: '' };
              else if (b.type === 'thinking')
                blocks[ev.index] = { type: 'thinking', thinking: '', signature: '' };
              else if (b.type === 'redacted_thinking')
                blocks[ev.index] = { type: 'redacted_thinking', data: b.data };
              else if (b.type === 'tool_use') {
                blocks[ev.index] = { type: 'tool_use', id: b.id, name: b.name, input: {} };
                partialJson[ev.index] = '';
              }
              break;
            }
            case 'content_block_delta': {
              const b = blocks[ev.index];
              const d = ev.delta;
              if (d.type === 'text_delta' && b?.type === 'text') {
                b.text += d.text;
                yield { type: 'text', text: d.text };
              } else if (d.type === 'thinking_delta' && b?.type === 'thinking') {
                b.thinking += d.thinking;
                yield { type: 'thinking', text: d.thinking };
              } else if (d.type === 'signature_delta' && b?.type === 'thinking') b.signature += d.signature;
              else if (d.type === 'input_json_delta')
                partialJson[ev.index] = (partialJson[ev.index] ?? '') + d.partial_json;
              break;
            }
            case 'content_block_stop': {
              const b = blocks[ev.index];
              if (b?.type === 'tool_use') {
                const raw = partialJson[ev.index] ?? '';
                try {
                  b.input = raw.trim() ? JSON.parse(raw) : {};
                } catch {
                  b.input = { __invalid_json: raw };
                }
                yield { type: 'tool_use', id: b.id, name: b.name, input: b.input };
              }
              break;
            }
            case 'message_delta': {
              if (ev.delta.stop_reason) stopReason = ev.delta.stop_reason as StopReason;
              const u = ev.usage;
              usage = {
                inputTokens: u.input_tokens ?? usage.inputTokens,
                outputTokens: u.output_tokens ?? usage.outputTokens,
                cacheReadTokens: u.cache_read_input_tokens ?? usage.cacheReadTokens,
                cacheWriteTokens: u.cache_creation_input_tokens ?? usage.cacheWriteTokens,
              };
              break;
            }
            default:
              break;
          }
        }
      } catch (e) {
        throw toAssistantError(e);
      }
      yield { type: 'done', stopReason, usage, content: blocks.filter(Boolean) };
    },
    async structured(request, signal) {
      try {
        const message = await sdk.messages.parse(
          {
            model: request.model,
            max_tokens: request.maxTokens ?? 2048,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
            output_config: { format: zodOutputFormat(request.schema as never) },
          },
          { ...(signal ? { signal } : {}) },
        );
        const parsed =
          message.parsed_output ?? JSON.parse(message.content.find((c) => c.type === 'text')?.text ?? '{}');
        return { value: request.schema.parse(parsed), usage: usageOf(message.usage) };
      } catch (e) {
        throw toAssistantError(e);
      }
    },
  };
}

/**
 * A scripted client for tests and recorded evaluations: each call to
 * `stream` replays the next recorded assistant turn. A turn is either a list
 * of content blocks or an error to raise.
 */
export type ScriptedTurn =
  | { content: ContentBlock[]; usage?: Partial<Usage>; stopReason?: StopReason }
  | { error: AssistantError['code']; message?: string };

export function scriptedClient(
  turns: ScriptedTurn[],
  structuredValues: unknown[] = [],
): AssistantClient & {
  requests: ChatRequest[];
  remaining(): number;
} {
  const queue = [...turns];
  const values = [...structuredValues];
  const requests: ChatRequest[] = [];
  return {
    requests,
    remaining: () => queue.length,
    async *stream(request) {
      requests.push(request);
      const turn = queue.shift();
      if (!turn) throw new AssistantError('unknown', 'scripted client has no more turns');
      if ('error' in turn) throw new AssistantError(turn.error, turn.message ?? ERROR_MESSAGES[turn.error]);
      for (const block of turn.content) {
        if (block.type === 'text') yield { type: 'text', text: block.text };
        else if (block.type === 'thinking') yield { type: 'thinking', text: block.thinking };
        else if (block.type === 'tool_use')
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
      const hasTool = turn.content.some((b) => b.type === 'tool_use');
      yield {
        type: 'done',
        stopReason: turn.stopReason ?? (hasTool ? 'tool_use' : 'end_turn'),
        usage: { ...emptyUsage(), ...(turn.usage ?? {}) },
        content: turn.content,
      };
    },
    async structured(request) {
      const v = values.shift();
      if (v === undefined) throw new AssistantError('unknown', 'scripted client has no structured value');
      return { value: request.schema.parse(v), usage: emptyUsage() };
    },
  };
}
