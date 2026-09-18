import { z } from 'zod';
import { customFeatureTypeSchema } from '../placement/custom.js';
import { culturePackSchema } from '../naming/schema.js';

/**
 * MapDocument schema, version 2.
 *
 * The document is the single input to the generator and the unit of
 * persistence (`.citygen.json`). It holds the generation spec, hand-authored
 * geometry, overrides to generated results, and annotations. Derived results
 * are never stored here. See docs/DESIGN.md §5.
 */

export const DOCUMENT_VERSION = 3 as const;

// ---------------------------------------------------------------------------
// Geometry (GeoJSON, planar metres, origin at the region centre)
// ---------------------------------------------------------------------------

const position = z.array(z.number()).min(2).max(3);

export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2)) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4)) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(position).min(4))) }),
]);
export type Geometry = z.infer<typeof geometrySchema>;

export const authoredLayerSchema = z.enum([
  'street',
  'rail',
  'tram',
  'water',
  'wall',
  'zone',
  'building',
  'facility',
  'poi',
  'vegetation',
  'terrainEdit',
  'fieldEdit',
]);
export type AuthoredLayer = z.infer<typeof authoredLayerSchema>;

export const authoredPropsSchema = z
  .object({
    layer: authoredLayerSchema,
    origin: z.enum(['authored', 'frozen']).default('authored'),
    kind: z.string().optional(),
    name: z.string().optional(),
    /** For frozen features: id of the generated feature this replaced. */
    frozenFrom: z.string().optional(),
  })
  .catchall(z.unknown());
export type AuthoredProps = z.infer<typeof authoredPropsSchema>;

export const authoredFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.string(),
  geometry: geometrySchema,
  properties: authoredPropsSchema,
});
export type AuthoredFeature = z.infer<typeof authoredFeatureSchema>;

export const authoredCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(authoredFeatureSchema).default([]),
});

// ---------------------------------------------------------------------------
// Region spec
// ---------------------------------------------------------------------------

export const terrainPresetSchema = z.enum([
  'plains',
  'coast',
  'bay',
  'riverValley',
  'hills',
  'archipelago',
  'delta',
  'estuary',
  'custom',
]);

export const biomeIdSchema = z.enum([
  'temperateMaritime',
  'temperateContinental',
  'mediterranean',
  'boreal',
  'subarctic',
  'steppe',
  'desert',
  'semiArid',
  'subtropicalHumid',
  'tropicalMonsoon',
  'tropicalRainforest',
  'savanna',
  'alpine',
]);
export type BiomeId = z.infer<typeof biomeIdSchema>;

export const settlementKindSchema = z.enum([
  'metropolis',
  'city',
  'town',
  'village',
  'hamlet',
  'portTown',
  'fishingVillage',
  'millTown',
  'miningTown',
  'resort',
  'universityTown',
  'suburb',
  'industrialSatellite',
]);
export type SettlementKind = z.infer<typeof settlementKindSchema>;

export const fieldParamsSchema = z.object({
  baseline: z.number().min(0).max(1).default(0.5),
  gradient: z.number().min(0).max(1).default(0.5),
  noise: z.number().min(0).max(1).default(0.2),
});

export const featureRequestSchema = z.object({
  id: z.string(),
  type: z.string(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  pin: z.object({ x: z.number(), y: z.number(), rotation: z.number().default(0) }).optional(),
  lock: z.boolean().default(false),
  hint: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type FeatureRequest = z.infer<typeof featureRequestSchema>;

export const eventSchema = z.object({
  id: z.string(),
  kind: z.enum(['fire', 'storm', 'flood']),
  year: z.number().int().min(1100).max(2100),
  center: z.tuple([z.number(), z.number()]),
  radiusM: z.number().positive().max(20_000),
  /** Severity 0–1: share of buildings destroyed (fire) or damaged (storm, flood). */
  magnitude: z.number().min(0).max(1).default(0.7),
  /** Floods: water level in metres above the datum; ground below it is under water. */
  levelM: z.number().optional(),
  /** Floods: years the water stays. */
  durationYears: z.number().int().min(1).max(200).default(1),
});
export type RegionEvent = z.infer<typeof eventSchema>;

export const settlementSpecSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  kind: settlementKindSchema,
  site: z.object({ center: z.tuple([z.number(), z.number()]), lock: z.boolean().default(false) }).optional(),
  population: z.number().int().min(1),
  founded: z.number().int().optional(),
  growth: z.array(z.object({ year: z.number().int(), population: z.number().int().min(0) })).optional(),
  layout: z
    .object({
      streetPattern: z.enum(['organic', 'grid', 'radial', 'mixed']).default('mixed'),
      blockSizeM: z.number().positive().optional(),
      walls: z.boolean().optional(),
    })
    .default({ streetPattern: 'mixed' }),
  features: z.array(featureRequestSchema).default([]),
  culture: z.string().optional(),
});
export type SettlementSpec = z.infer<typeof settlementSpecSchema>;

export const regionSpecSchema = z.object({
  seed: z.string().min(1),
  extent: z.object({
    widthM: z.number().positive().max(200_000),
    heightM: z.number().positive().max(200_000),
  }),
  year: z.number().int().min(1100).max(2100),
  /**
   * The year the settlement populations describe. The year slider moves the
   * region along one history anchored here: earlier years show the towns
   * smaller, later years larger, without re-rolling what already stands.
   */
  anchorYear: z.number().int().min(1100).max(2100).default(1925),
  /** Disasters on the timeline: fires rebuild, storms damage, floods drown low ground for a while. */
  events: z.array(eventSchema).default([]),
  biome: biomeIdSchema.default('temperateMaritime'),
  culture: z.string().default('newEngland'),
  cultureMix: z
    .array(
      z.object({
        culture: z.string(),
        weight: z.number().positive(),
        districts: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  terrain: z
    .object({
      preset: terrainPresetSchema.default('coast'),
      relief: z.number().min(0).max(1).default(0.4),
      roughness: z.number().min(0).max(1).default(0.5),
      seaLevel: z.number().default(0),
      erosion: z.number().min(0).max(1).default(0.5),
      rivers: z
        .object({ major: z.number().int().min(0).default(1), minor: z.number().int().min(0).default(3) })
        .default({
          major: 1,
          minor: 3,
        }),
      /** Imported heights replacing the synthetic field: a width × height grid of 16-bit samples (base64), south row first, scaled from minM to maxM. */
      importedHeightmap: z
        .object({
          width: z.number().int().min(2).max(4096),
          height: z.number().int().min(2).max(4096),
          minM: z.number(),
          maxM: z.number(),
          data: z.string(),
          source: z.string().optional(),
        })
        .optional(),
    })
    .default({
      preset: 'coast',
      relief: 0.4,
      roughness: 0.5,
      seaLevel: 0,
      erosion: 0.5,
      rivers: { major: 1, minor: 3 },
    }),
  settlements: z.array(settlementSpecSchema).default([]),
  settlementPolicy: z
    .object({
      count: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([3, 8]),
      kinds: z.partialRecord(settlementKindSchema, z.number().min(0)).default({}),
    })
    .default({ count: [3, 8], kinds: {} }),
  society: z
    .object({
      wealth: fieldParamsSchema.default({ baseline: 0.5, gradient: 0.5, noise: 0.2 }),
      density: fieldParamsSchema.default({ baseline: 0.5, gradient: 0.5, noise: 0.2 }),
      inequality: z.number().min(0).max(1).default(0.5),
    })
    .default({
      wealth: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      density: { baseline: 0.5, gradient: 0.5, noise: 0.2 },
      inequality: 0.5,
    }),
  networks: z
    .object({
      roads: z
        .object({ motorways: z.boolean().default(true), ringRoad: z.boolean().default(false) })
        .default({
          motorways: true,
          ringRoad: false,
        }),
      rail: z
        .object({ enabled: z.boolean().default(true), mainlines: z.number().int().min(0).max(4).default(1) })
        .default({ enabled: true, mainlines: 1 }),
      water: z.object({ ferries: z.boolean().default(true), canals: z.boolean().default(false) }).default({
        ferries: true,
        canals: false,
      }),
    })
    .default({
      roads: { motorways: true, ringRoad: false },
      rail: { enabled: true, mainlines: 1 },
      water: { ferries: true, canals: false },
    }),
  features: z.array(featureRequestSchema).default([]),
  scaleCompression: z.boolean().default(true),
  /** Feature types defined in this document, usable in feature requests by id. */
  customFeatureTypes: z.array(customFeatureTypeSchema).default([]),
  /** Culture packs carried by this document (plugins); they override built-ins with the same id. */
  customCulturePacks: z.array(culturePackSchema).default([]),
  /** Facilities the engine adds by default from settlement kind, size and year. */
  defaultFacilities: z.boolean().default(true),
});
export type RegionSpec = z.infer<typeof regionSpecSchema>;

// ---------------------------------------------------------------------------
// Overrides, annotations, document
// ---------------------------------------------------------------------------

export const overrideSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('pin'),
    target: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().default(0),
  }),
  z.object({ op: z.literal('remove'), target: z.string() }),
  z.object({ op: z.literal('setProperty'), target: z.string(), key: z.string(), value: z.unknown() }),
  /** Re-roll a settlement (target = settlement id) or the whole region (target = 'region'). */
  z.object({ op: z.literal('reseed'), target: z.string(), salt: z.string() }),
  /** Re-roll the blocks whose centroid lies inside the polygon. */
  z.object({
    op: z.literal('reroll'),
    polygon: z.array(z.array(z.number()).min(2)).min(3),
    salt: z.string(),
  }),
  /** Hide a generated feature by id (e.g. a building removed by the user). */
  z.object({ op: z.literal('suppress'), target: z.string() }),
]);
export type Override = z.infer<typeof overrideSchema>;

export const annotationSchema = z.object({
  id: z.string(),
  kind: z.enum(['label', 'marker', 'arrow', 'note', 'handoutFrame']),
  geometry: geometrySchema,
  text: z.string().default(''),
  gmOnly: z.boolean().default(false),
  style: z.record(z.string(), z.unknown()).optional(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const mapDocumentSchema = z.object({
  format: z.literal('citygen'),
  version: z.literal(DOCUMENT_VERSION),
  meta: z.object({
    name: z.string().default('Untitled region'),
    created: z.string(),
    modified: z.string(),
    app: z.string().default('citygenerator'),
    notes: z.string().optional(),
  }),
  spec: regionSpecSchema,
  authored: authoredCollectionSchema.default({ type: 'FeatureCollection', features: [] }),
  overrides: z.array(overrideSchema).default([]),
  annotations: z.array(annotationSchema).default([]),
  viewport: z
    .object({
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number(),
      bearing: z.number(),
      pitch: z.number(),
    })
    .optional(),
  ui: z
    .object({
      theme: z.string().default('atlas'),
      layers: z.record(z.string(), z.boolean()).default({}),
      terrain3d: z.boolean().default(false),
    })
    .optional(),
});
export type MapDocument = z.infer<typeof mapDocumentSchema>;

/** JSON Schema (draft 2020-12) for the document, for editors, validators and LLM tools. */
export function documentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(mapDocumentSchema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
}
