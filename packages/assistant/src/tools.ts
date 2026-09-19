import { z } from 'zod';
import { geometrySchema } from '@citygen/core';

/**
 * Tool definitions for the assistant. Each input schema is a zod schema
 * (validated locally before anything reaches the command bus) and is also
 * converted to a strict JSON schema for the API.
 */

const xy = z.number().describe('Model metres; x grows east, y grows north, origin at the region centre.');
const bbox = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe('[minX, minY, maxX, maxY] in model metres.');
const nullableString = z.string().nullable().optional();

export const jsonPatchOpSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z
    .string()
    .describe('JSON Pointer into the region spec, e.g. /terrain/relief or /settlements/0/population.'),
  value: z.unknown().nullable().optional(),
  from: nullableString,
});

export const TOOL_SCHEMAS = {
  get_region_summary: z.object({}),
  get_settlement_summary: z.object({ id: z.string().describe('Settlement id from the region summary.') }),
  describe_area: z.object({
    x: xy,
    y: xy,
    radiusM: z
      .number()
      .min(0)
      .max(5000)
      .nullable()
      .optional()
      .describe('Search radius for nearby features (default 150).'),
  }),
  find_features: z.object({
    kind: z
      .enum([
        'settlement',
        'facility',
        'building',
        'street',
        'district',
        'station',
        'annotation',
        'authored',
        'utility',
      ])
      .nullable()
      .optional(),
    name: nullableString.describe('Case-insensitive substring of the name.'),
    settlement: nullableString.describe('Restrict to a settlement id.'),
    bbox: bbox.nullable().optional(),
    limit: z.number().int().min(1).max(200).nullable().optional(),
  }),
  render_snapshot: z.object({
    bbox,
    theme: nullableString.describe('atlas, ink, period1920s, sanborn, blueprint, dark or print.'),
    layers: z
      .array(z.string())
      .nullable()
      .optional()
      .describe('Layer groups to show; default is the current view.'),
  }),
  get_spec: z.object({}),
  patch_spec: z.object({ ops: z.array(jsonPatchOpSchema).min(1) }),
  set_year: z.object({ year: z.number().int().min(1100).max(2100) }),
  set_theme: z.object({ theme: z.string() }),
  regenerate: z.object({
    scope: z.enum(['region', 'settlement', 'area']),
    id: nullableString.describe('Settlement id when scope is settlement.'),
    polygon: z
      .array(z.tuple([z.number(), z.number()]))
      .min(3)
      .nullable()
      .optional()
      .describe('Area polygon in metres when scope is area; blocks whose centre lies inside are re-rolled.'),
  }),
  draw: z.object({
    layer: z
      .enum(['street', 'rail', 'tram', 'water', 'wall', 'building', 'zone', 'vegetation', 'facility', 'poi'])
      .describe(
        'street, rail, tram, wall: LineString. water: Polygon (lake) or LineString (canal, kind "canal"). building, zone, vegetation, facility: Polygon. poi: Point.',
      ),
    geometry: geometrySchema.describe('GeoJSON geometry in model metres (LineString, Polygon or Point).'),
    kind: nullableString.describe(
      'Street class (artery, collector, local), zone ward, building kind, point kind.',
    ),
    name: nullableString,
    widthM: z.number().positive().nullable().optional(),
    floors: z.number().int().min(1).max(120).nullable().optional(),
  }),
  remove_feature: z.object({
    id: z.string().describe('Any feature id: authored, generated, facility or annotation.'),
  }),
  freeze: z.object({ x: xy, y: xy }),
  unfreeze: z.object({ id: z.string().describe('Id of a frozen (authored) feature.') }),
  place_feature: z.object({
    type: z
      .string()
      .describe('Feature type id, e.g. port, gasworks, hospital, cemetery, airport, campus, brewery.'),
    settlement: nullableString.describe('Settlement id to attach to; omit for a regional feature.'),
    x: xy.nullable().optional(),
    y: xy.nullable().optional(),
    rotation: z.number().nullable().optional().describe('Degrees when pinned at x, y.'),
    size: z.enum(['small', 'medium', 'large']).nullable().optional(),
    hint: nullableString,
  }),
  move_feature: z.object({
    id: z.string(),
    x: xy,
    y: xy,
    rotation: z.number().nullable().optional(),
  }),
  brush: z.object({
    kind: z.enum(['raise', 'lower', 'smooth', 'flatten', 'water', 'wealth', 'density', 'zone']),
    points: z
      .array(z.tuple([z.number(), z.number()]))
      .min(1)
      .describe('Stroke path in metres.'),
    radiusM: z.number().positive().max(5000),
    amount: z
      .number()
      .nullable()
      .optional()
      .describe('Metres for terrain ops (default 15), delta in [-1, 1] for wealth/density (default 0.3).'),
    ward: nullableString.describe(
      'Ward for zone brushes: park, industrial, commercial, residential, market…',
    ),
  }),
  annotate: z.object({
    kind: z.enum(['label', 'marker', 'note', 'handoutFrame']),
    x: xy.nullable().optional(),
    y: xy.nullable().optional(),
    polygon: z
      .array(z.tuple([z.number(), z.number()]))
      .min(3)
      .nullable()
      .optional()
      .describe('For handout frames.'),
    text: z.string(),
    gmOnly: z.boolean().nullable().optional(),
  }),
  name_features: z.object({
    items: z.array(z.object({ id: z.string(), name: z.string().min(1) })).min(1),
  }),
  add_settlement: z.object({
    kind: z.enum(['city', 'town', 'village', 'hamlet']),
    x: xy,
    y: xy,
    population: z.number().int().min(1),
    name: nullableString,
    culture: nullableString,
  }),
  remove_settlement: z.object({ id: z.string() }),
  add_event: z.object({
    kind: z.enum(['fire', 'storm', 'flood', 'burst', 'blackout', 'explosion']),
    year: z.number().int().min(1100).max(2100),
    x: xy,
    y: xy,
    radiusM: z.number().positive().max(20_000),
    magnitude: z.number().min(0).max(1).nullable().optional().describe('Severity 0–1 (default 0.7).'),
    levelM: z.number().nullable().optional().describe('Floods: water level in metres above the datum.'),
    durationYears: z
      .number()
      .int()
      .min(1)
      .max(200)
      .nullable()
      .optional()
      .describe('Floods: years the water stays.'),
  }),
  remove_event: z.object({ id: z.string() }),
  floor_plan: z.object({
    id: z
      .string()
      .describe(
        'Building id (from find_features or describe_area) or a facility part id (from a facility’s `parts` in find_features).',
      ),
    floor: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe('Floor index, 0 = ground; omit for all floors.'),
  }),
  undo: z.object({}),
  redo: z.object({}),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[N]>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_region_summary:
    'Settlements (ids, names, kinds, populations, centres), facilities, rivers, rail, year and era, authored features and annotations. Call this before answering questions about the region.',
  get_settlement_summary:
    'Districts, facilities, stations, premises and notable businesses of one settlement.',
  describe_area:
    'What is at a point: terrain, ground, settlement, district, ward, zone, wealth and density, the building or facility there, and nearby named features.',
  find_features:
    'Find features by kind, name, settlement or bounding box. Returns ids and centres for other tools.',
  render_snapshot:
    'Render a PNG of a bounding box (at most about 4 km across) so you can look at it. Costly; use sparingly.',
  get_spec: 'The full generation spec (terrain, society, networks, settlements, features) as JSON.',
  patch_spec:
    'Apply JSON Patch operations to the generation spec. Use for terrain, society, network and settlement parameters; the region regenerates.',
  set_year:
    'Move the region to a year between 1100 and 2100. The era, street patterns, buildings, rail and facilities follow.',
  set_theme: 'Switch the map theme: atlas, ink, period1920s, sanborn, blueprint, dark, print.',
  regenerate:
    'Re-roll the layout of the region, one settlement or an area polygon with a new seed. Authored features stay.',
  draw: 'Author geometry in model metres: a street, railway, tram, canal, water, wall, building, zone, vegetation, facility or point. It is validated and the generator adapts around it.',
  remove_feature:
    'Remove a feature by id: authored features are deleted, generated ones are hidden, facilities are dropped.',
  freeze:
    'Freeze the generated building, street or patch at a point so regeneration keeps it. Returns the new authored id.',
  unfreeze: 'Delete a frozen feature so the generator takes over again.',
  place_feature:
    'Request a facility (port, gasworks, hospital, cemetery, airport, campus, brewery, mill, prison…) for a settlement or the region, optionally pinned at a point.',
  move_feature: 'Move a facility, settlement or authored feature to a point (and rotate it).',
  brush:
    'Paint terrain (raise, lower, smooth, flatten, water), wealth, density or a zone ward along a stroke with a radius.',
  annotate: 'Add a label, marker, GM-only note or handout frame.',
  name_features: 'Rename settlements, facilities, streets or buildings by id.',
  add_settlement: 'Add a settlement at a point; the engine lays it out.',
  remove_settlement: 'Remove a settlement by id.',
  add_event:
    'Put a disaster or a utility failure on the timeline: a fire (burnt buildings rebuild over the following years), a storm (damage that heals), a flood (low ground under water for a while), a burst water main, a power cut, or a gas explosion (a small fire that also takes out the gas mains it reached). Centre, radius and year.',
  remove_event: 'Remove a disaster by id.',
  floor_plan:
    'Rooms, doors, windows and stairs of a building or a facility part (warehouse, hall, ward, cell block, terminal…), floor by floor, generated from its footprint, use and era. Use it to describe an interior or plan a scene.',
  undo: 'Undo the last command.',
  redo: 'Redo the last undone command.',
};

/** Tools that only read. */
export const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'get_region_summary',
  'get_settlement_summary',
  'describe_area',
  'find_features',
  'render_snapshot',
  'get_spec',
  'floor_plan',
]);

type JsonSchema = Record<string, unknown>;

/**
 * Make a JSON schema acceptable to strict tool use: every property required
 * (optionals are nullable), no additional properties, no numeric or length
 * constraints (they stay in the zod schema, which validates locally).
 */
export function strictify(schema: JsonSchema): JsonSchema {
  const drop = new Set([
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    '$schema',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'pattern',
    'format',
  ]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: JsonSchema = {};
    for (const [k, v] of Object.entries(node as JsonSchema)) {
      if (drop.has(k)) continue;
      out[k] = walk(v);
    }
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      const props = out.properties as Record<string, JsonSchema>;
      const required = new Set((out.required as string[] | undefined) ?? []);
      for (const [key, prop] of Object.entries(props)) {
        if (!required.has(key)) {
          props[key] = nullable(prop);
          required.add(key);
        }
      }
      out.required = [...required];
      out.additionalProperties = false;
    }
    if (out.type === 'array' && out.items === false) delete out.items;
    return out;
  };
  return walk(schema) as JsonSchema;
}

function nullable(prop: JsonSchema): JsonSchema {
  if (Array.isArray(prop.type))
    return prop.type.includes('null') ? prop : { ...prop, type: [...prop.type, 'null'] };
  if (typeof prop.type === 'string')
    return prop.type === 'null' ? prop : { ...prop, type: [prop.type, 'null'] };
  if (Array.isArray(prop.anyOf))
    return prop.anyOf.some((p) => (p as JsonSchema).type === 'null')
      ? prop
      : { ...prop, anyOf: [...prop.anyOf, { type: 'null' }] };
  return { anyOf: [prop, { type: 'null' }], ...(prop.description ? { description: prop.description } : {}) };
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: JsonSchema & { type: 'object' };
  strict?: boolean;
}

/** Tool definitions for the API, in a stable order for prompt caching. */
export function toolDefinitions(options: { strict?: boolean } = {}): ToolDefinition[] {
  const strict = options.strict ?? true;
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => {
    const raw = z.toJSONSchema(TOOL_SCHEMAS[name], { unrepresentable: 'any' }) as JsonSchema;
    const input_schema = (strict ? strictify(raw) : raw) as JsonSchema & { type: 'object' };
    input_schema.type = 'object';
    if (!input_schema.properties) input_schema.properties = {};
    if (!input_schema.required) input_schema.required = [];
    return { name, description: TOOL_DESCRIPTIONS[name], input_schema, ...(strict ? { strict: true } : {}) };
  });
}
