import { z } from 'zod';
import type { AssistantClient, Usage } from './client.js';

/** Structured flavour text for a place, generated on the cheaper model. */
export const flavourSchema = z.object({
  title: z.string(),
  description: z.string().describe('Two or three sentences a game master can read aloud.'),
  hooks: z.array(z.string()).describe('Three adventure hooks tied to real places from the context.'),
  rumours: z.array(z.string()).describe('Two rumours locals repeat.'),
  npcs: z
    .array(z.object({ name: z.string(), role: z.string(), note: z.string() }))
    .describe('Two or three named locals.'),
});
export type Flavour = z.infer<typeof flavourSchema>;

export const FLAVOUR_MODEL = 'claude-sonnet-5';

export async function generateFlavour(
  client: AssistantClient,
  context: { subject: string; year: number; culture: string; details: string; tone?: string },
  options: { model?: string; signal?: AbortSignal } = {},
): Promise<{ value: Flavour; usage: Usage }> {
  const system =
    'You write short, evocative, period-accurate flavour text for a tabletop game master. Use only the places, names and facts given; invent people, not geography. No headings, no markdown.';
  const prompt = [
    `Subject: ${context.subject}`,
    `Year: ${context.year}. Culture: ${context.culture}. Tone: ${context.tone ?? 'quiet dread, Call of Cthulhu'}.`,
    'Facts:',
    context.details,
  ].join('\n');
  return client.structured(
    { model: options.model ?? FLAVOUR_MODEL, system, prompt, schema: flavourSchema },
    options.signal,
  );
}
