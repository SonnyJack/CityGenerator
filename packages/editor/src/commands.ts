import { z } from 'zod';
import { annotationSchema, authoredFeatureSchema, geometrySchema, authoredPropsSchema } from '@citygen/core';

/**
 * Every mutation of a MapDocument, from the UI or the LLM assistant, is one of
 * these commands. Schemas double as validation and as LLM tool input schemas.
 * Phase 0 carries the document-level commands; feature placement, brushes and
 * regeneration scopes arrive with their pipeline stages.
 */

const jsonPatchOp = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  from: z.string().optional(),
  value: z.unknown().optional(),
});

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta.rename'), name: z.string().min(1) }),
  z.object({ type: z.literal('spec.patch'), ops: z.array(jsonPatchOp).min(1) }),
  z.object({ type: z.literal('spec.setSeed'), seed: z.string().min(1) }),
  z.object({ type: z.literal('year.set'), year: z.number().int().min(1100).max(2100) }),
  z.object({ type: z.literal('authored.add'), features: z.array(authoredFeatureSchema).min(1) }),
  z.object({
    type: z.literal('authored.update'),
    id: z.string(),
    geometry: geometrySchema.optional(),
    properties: authoredPropsSchema.partial().optional(),
  }),
  z.object({ type: z.literal('authored.remove'), ids: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('annotation.add'), annotation: annotationSchema }),
  z.object({ type: z.literal('annotation.remove'), ids: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal('ui.set'),
    theme: z.string().optional(),
    layers: z.record(z.string(), z.boolean()).optional(),
    terrain3d: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('viewport.set'),
    viewport: z.object({
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number(),
      bearing: z.number(),
      pitch: z.number(),
    }),
  }),
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];

/** Commands that do not belong in undo history (pure presentation state). */
export const TRANSIENT_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>(['viewport.set', 'ui.set']);
