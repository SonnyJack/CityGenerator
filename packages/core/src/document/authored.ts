import type { AuthoredFeature, MapDocument, Override } from './schema.js';
import type { Ring } from '../raster/contours.js';

/**
 * Typed views over hand-authored features and overrides, for the stages that
 * consume them. Authored features keep loose `properties`; these helpers
 * validate the fields each stage needs and ignore malformed entries.
 */

export type TerrainEditOp = 'raise' | 'lower' | 'smooth' | 'flatten' | 'water';

export interface TerrainEdit {
  id: string;
  op: TerrainEditOp;
  /** Stroke path in metres. */
  points: Ring;
  radiusM: number;
  /** Height change in metres for raise/lower; target level for flatten/water; 0..1 strength for smooth. */
  amount: number;
}

export interface FieldEdit {
  id: string;
  field: 'wealth' | 'density' | 'condition' | 'year';
  points: Ring;
  radiusM: number;
  /** Change in [-1, 1] at the stroke centre, falling off to the edge; years for a `year` stroke. */
  delta: number;
}

/** A stroke of land cover painted over the ground (the land cover stage takes it as it is). */
export interface VegetationEdit {
  id: string;
  /** A land cover class name: forest, open, farmland, marsh, sand, rock, snow, mangrove. */
  kind: string;
  points: Ring;
  radiusM: number;
}

export interface ZoneEdit {
  id: string;
  ward: string;
  /** Polygon ring, or a stroke with a radius. */
  ring?: Ring;
  points?: Ring;
  radiusM?: number;
}

function lineOrPolygonPoints(f: AuthoredFeature): Ring | null {
  const g = f.geometry;
  if (g.type === 'LineString') return g.coordinates.map((p) => [p[0]!, p[1]!] as [number, number]);
  if (g.type === 'Polygon') return g.coordinates[0]!.map((p) => [p[0]!, p[1]!] as [number, number]);
  if (g.type === 'Point') return [[g.coordinates[0]!, g.coordinates[1]!]];
  return null;
}

export function terrainEdits(doc: MapDocument): TerrainEdit[] {
  const out: TerrainEdit[] = [];
  for (const f of doc.authored.features) {
    if (f.properties.layer !== 'terrainEdit') continue;
    const op = f.properties.op;
    const points = lineOrPolygonPoints(f);
    if (!points || typeof op !== 'string' || !['raise', 'lower', 'smooth', 'flatten', 'water'].includes(op))
      continue;
    out.push({
      id: f.id,
      op: op as TerrainEditOp,
      points,
      radiusM: typeof f.properties.radiusM === 'number' ? f.properties.radiusM : 100,
      amount: typeof f.properties.amount === 'number' ? f.properties.amount : 10,
    });
  }
  return out;
}

/** Wealth and density strokes (consumed by the society stage). */
export function societyEdits(doc: MapDocument): FieldEdit[] {
  return fieldEdits(doc).filter((e) => e.field === 'wealth' || e.field === 'density');
}

/** Condition strokes (consumed by block generation). */
export function conditionEdits(doc: MapDocument): FieldEdit[] {
  return fieldEdits(doc).filter((e) => e.field === 'condition');
}

/** Year strokes: the ground under them was built that many years earlier or later. */
export function yearEdits(doc: MapDocument): FieldEdit[] {
  return fieldEdits(doc).filter((e) => e.field === 'year');
}

/** Land cover strokes (consumed by the land cover stage). */
export function vegetationEdits(doc: MapDocument): VegetationEdit[] {
  const out: VegetationEdit[] = [];
  for (const f of doc.authored.features) {
    if (f.properties.layer !== 'vegetation' || typeof f.properties.kind !== 'string') continue;
    const points = lineOrPolygonPoints(f);
    if (!points) continue;
    out.push({
      id: f.id,
      kind: f.properties.kind,
      points,
      radiusM: typeof f.properties.radiusM === 'number' ? f.properties.radiusM : 150,
    });
  }
  return out;
}

export function fieldEdits(doc: MapDocument): FieldEdit[] {
  const out: FieldEdit[] = [];
  for (const f of doc.authored.features) {
    if (f.properties.layer !== 'fieldEdit') continue;
    const field = f.properties.field;
    const points = lineOrPolygonPoints(f);
    if (!points || (field !== 'wealth' && field !== 'density' && field !== 'condition' && field !== 'year'))
      continue;
    out.push({
      id: f.id,
      field,
      points,
      radiusM: typeof f.properties.radiusM === 'number' ? f.properties.radiusM : 200,
      delta: typeof f.properties.delta === 'number' ? f.properties.delta : 0.3,
    });
  }
  return out;
}

export function zoneEdits(doc: MapDocument): ZoneEdit[] {
  const out: ZoneEdit[] = [];
  for (const f of doc.authored.features) {
    if (f.properties.layer !== 'zone' || typeof f.properties.kind !== 'string') continue;
    if (f.geometry.type === 'Polygon') {
      out.push({ id: f.id, ward: f.properties.kind, ring: lineOrPolygonPoints(f)! });
    } else if (f.geometry.type === 'LineString') {
      out.push({
        id: f.id,
        ward: f.properties.kind,
        points: lineOrPolygonPoints(f)!,
        radiusM: typeof f.properties.radiusM === 'number' ? f.properties.radiusM : 80,
      });
    }
  }
  return out;
}

/** Seed salt for a settlement (or the whole region) from `reseed` overrides. */
export function reseedSalt(overrides: Override[], target: string): string {
  const salts = overrides
    .filter((o) => o.op === 'reseed' && (o.target === target || o.target === 'region'))
    .map((o) => (o as { salt: string }).salt);
  return salts.join('+');
}

/** Distance from a point to a polyline, metres. */
export function distToPolyline(x: number, y: number, points: Ring): number {
  let best = Infinity;
  if (points.length === 1) return Math.hypot(x - points[0]![0], y - points[0]![1]);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}
