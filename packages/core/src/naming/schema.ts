import { z } from 'zod';

/**
 * Culture packs (DESIGN §7): naming grammars, street and block conventions,
 * building kinds, religious and civic kinds, materials and colonial overlays.
 * Packs are data validated by this schema; the name generator expands the
 * grammars deterministically from the region seed.
 */
export const grammarSchema = z.object({
  /** Patterns with `{key}` tokens drawn from `parts`, or from the pack's given/family lists. */
  patterns: z.array(z.string().min(1)).min(1),
  parts: z.record(z.string(), z.array(z.string()).min(1)).default({}),
});
export type Grammar = z.infer<typeof grammarSchema>;

export const ringPatternSchema = z.enum(['organic', 'grid', 'streetcar', 'suburban', 'culDeSac', 'towers']);

export const culturePackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  language: z.string().default('en'),
  naming: z.object({
    given: z.array(z.string()).min(4),
    family: z.array(z.string()).min(4),
    settlement: grammarSchema,
    street: grammarSchema,
    /** Suffix or prefix conventions by street class, applied by the street grammar's `{suffix}` token. */
    streetSuffix: z.object({
      artery: z.array(z.string()).min(1),
      road: z.array(z.string()).min(1),
      collector: z.array(z.string()).min(1),
      street: z.array(z.string()).min(1),
      lane: z.array(z.string()).min(1),
    }),
    district: grammarSchema,
    water: grammarSchema,
    business: grammarSchema,
    /** Names for the historic core and for special wards. */
    quarters: z.object({
      core: z.string(),
      cathedral: z.string(),
      castle: z.string(),
      market: z.string(),
      port: z.string(),
      industrial: z.string(),
      station: z.string(),
    }),
  }),
  conventions: z.object({
    /** Street pattern of growth before the era table's own switch to grids (1780 by default). */
    earlyPattern: ringPatternSchema.default('organic'),
    /** Year from which the era table's patterns apply unchanged. */
    modernFrom: z.number().int().default(1780),
    /** Multiplier on block sizes (medina alleys < 1 < American grids). */
    blockSizeScale: z.number().positive().default(1),
    /** Building kind names by generic kind. */
    buildingKinds: z.record(z.string(), z.string()).default({}),
    religious: z.array(z.string()).min(1),
    civic: z.array(z.string()).min(1),
    /** Material weights by era band. */
    materials: z.object({
      preIndustrial: z.record(z.string(), z.number().min(0)),
      industrial: z.record(z.string(), z.number().min(0)),
      modern: z.record(z.string(), z.number().min(0)),
    }),
    /** Years at which transport modes arrive (defaults from the era table when omitted). */
    transport: z
      .object({
        rail: z.number().int().optional(),
        tram: z.number().int().optional(),
        motorway: z.number().int().optional(),
        container: z.number().int().optional(),
      })
      .default({}),
    walls: z.boolean().default(true),
  }),
  /** A second culture that arrived in a given year and contributes a share of the names. */
  colonial: z
    .object({
      culture: z.string(),
      from: z.number().int(),
      to: z.number().int().optional(),
      share: z.number().min(0).max(1),
    })
    .optional(),
});
export type CulturePack = z.infer<typeof culturePackSchema>;
