import { z } from 'zod';
import type { FeatureType, LocalPart, PartKind } from './types.js';
import { primitives } from './library.js';

/**
 * Feature types defined in the document (DESIGN §6.5 "custom feature types"):
 * a footprint, a placement rule set and a list of parts in local metres.
 */
const partKinds: [PartKind, ...PartKind[]] = [
  'quay',
  'pier',
  'breakwater',
  'berth',
  'shed',
  'warehouse',
  'building',
  'hall',
  'crane',
  'tank',
  'gasholder',
  'chimney',
  'coolingTower',
  'dock',
  'slipway',
  'basin',
  'pond',
  'track',
  'road',
  'yard',
  'apron',
  'runway',
  'hangar',
  'terminal',
  'grounds',
  'field',
  'graves',
  'chapel',
  'wall',
  'fence',
  'gate',
  'tower',
  'reservoir',
  'dome',
  'wheelhouse',
  'race',
  'ramp',
  'containerYard',
  'slag',
  'switchyard',
];

export const customFeatureTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['port', 'industry', 'institution', 'transport', 'custom']).default('custom'),
  years: z.tuple([z.number().int(), z.number().int()]).default([1100, 2100]),
  /** Footprint in metres [length, width] for the medium size; small = ×0.6, large = ×1.6. */
  footprintM: z.tuple([z.number().positive(), z.number().positive()]),
  orientation: z
    .enum(['free', 'alignCoast', 'alignRail', 'alignRadial', 'alignWind', 'alignRiver'])
    .default('free'),
  radial: z.tuple([z.number().min(0), z.number().min(0)]).default([0.4, 1.8]),
  placement: z
    .object({
      shore: z.boolean().default(false),
      river: z.boolean().default(false),
      maxSlope: z.number().min(0).max(1).default(0.1),
      minCentreDist: z.number().min(0).default(0),
      nearRail: z.number().min(0).default(0),
      downwind: z.number().default(0),
      farFromCentre: z.number().default(0),
      elevated: z.number().default(0),
    })
    .default({
      shore: false,
      river: false,
      maxSlope: 0.1,
      minCentreDist: 0,
      nearRail: 0,
      downwind: 0,
      farFromCentre: 0,
      elevated: 0,
    }),
  connectors: z
    .object({ rail: z.boolean().default(false), road: z.boolean().default(true) })
    .default({ rail: false, road: true }),
  nuisance: z.object({ radiusM: z.number().positive(), strength: z.number().min(0).max(1) }).optional(),
  ward: z
    .enum(['port', 'industrial', 'institution', 'campus', 'cemetery', 'airfield'])
    .default('institution'),
  parts: z
    .array(
      z.discriminatedUnion('shape', [
        z.object({
          shape: z.literal('rect'),
          kind: z.enum(partKinds),
          u: z.number(),
          v: z.number(),
          lengthM: z.number().positive(),
          widthM: z.number().positive(),
          angle: z.number().optional(),
          name: z.string().optional(),
          floors: z.number().int().positive().optional(),
        }),
        z.object({
          shape: z.literal('circle'),
          kind: z.enum(partKinds),
          u: z.number(),
          v: z.number(),
          radiusM: z.number().positive(),
          name: z.string().optional(),
        }),
        z.object({
          shape: z.literal('line'),
          kind: z.enum(partKinds),
          points: z.array(z.tuple([z.number(), z.number()])).min(2),
          widthM: z.number().positive().optional(),
          name: z.string().optional(),
        }),
        z.object({
          shape: z.literal('point'),
          kind: z.enum(partKinds),
          u: z.number(),
          v: z.number(),
          name: z.string().optional(),
        }),
      ]),
    )
    .default([]),
});
export type CustomFeatureType = z.infer<typeof customFeatureTypeSchema>;

/** Turn a document-defined type into an engine type; parts scale with the footprint. */
export function customFeatureType(spec: CustomFeatureType): FeatureType {
  const p = spec.placement;
  const hard = [
    spec.placement.shore ? primitives.mostlyLand(0.55) : primitives.allLand,
    primitives.maxSlope(p.maxSlope),
  ];
  if (p.shore) hard.push(primitives.seaFront(60));
  if (p.river) hard.push(primitives.riverFront(100));
  if (p.minCentreDist > 0) hard.push(primitives.awayFromCentre(p.minCentreDist));
  const soft = [primitives.flat];
  if (p.nearRail) soft.push(primitives.nearRail(p.nearRail));
  if (p.downwind) soft.push(primitives.downwind(p.downwind));
  if (p.farFromCentre) soft.push(primitives.farFromCentre(p.farFromCentre));
  if (p.elevated) soft.push(primitives.elevated(p.elevated));
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    level: 'settlement',
    years: spec.years,
    footprint: (size) => {
      const f = size === 'small' ? 0.6 : size === 'large' ? 1.6 : 1;
      return [spec.footprintM[0] * f, spec.footprintM[1] * f];
    },
    orientation: spec.orientation,
    radial: spec.radial,
    hard,
    soft,
    connectors: spec.connectors,
    ...(spec.nuisance ? { nuisance: spec.nuisance } : {}),
    ward: spec.ward,
    layout: ({ lengthM, widthM }) => {
      // Parts are authored for the medium footprint; scale them to the placed one.
      const sx = lengthM / spec.footprintM[0];
      const sy = widthM / spec.footprintM[1];
      const s = Math.min(sx, sy);
      return spec.parts.map((part): LocalPart => {
        switch (part.shape) {
          case 'rect':
            return {
              ...part,
              u: part.u * sx,
              v: part.v * sy,
              lengthM: part.lengthM * s,
              widthM: part.widthM * s,
            };
          case 'circle':
            return { ...part, u: part.u * sx, v: part.v * sy, radiusM: part.radiusM * s };
          case 'line':
            return { ...part, points: part.points.map(([u, v]) => [u * sx, v * sy] as [number, number]) };
          case 'point':
            return { ...part, u: part.u * sx, v: part.v * sy };
        }
      });
    },
  };
}
