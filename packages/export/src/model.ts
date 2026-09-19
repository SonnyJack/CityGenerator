import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';

/** A rectangle in model metres. */
export interface Frame {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const frameWidth = (f: Frame) => f.maxX - f.minX;
export const frameHeight = (f: Frame) => f.maxY - f.minY;

type Props = Record<string, unknown>;
export type AnyFc = FeatureCollection<Geometry, Props>;

/**
 * Everything an exporter needs for a frame, in model metres. The engine
 * worker assembles it from the stage outputs (buildings generated for the
 * blocks that touch the frame) and the document's authored features.
 */
export interface ExportModel {
  frame: Frame;
  year: number;
  name: string;
  water: FeatureCollection<Polygon, Props>;
  rivers: FeatureCollection<LineString, Props>;
  landcover: FeatureCollection<Polygon, Props>;
  contours: FeatureCollection<LineString, Props>;
  patches: FeatureCollection<Polygon, Props>;
  streets: FeatureCollection<LineString, Props>;
  ways: FeatureCollection<LineString, Props>;
  walls: FeatureCollection<LineString, Props>;
  roads: FeatureCollection<LineString, Props>;
  /** Bridges: regional roads over rivers and town streets across them. */
  bridges?: FeatureCollection<LineString, Props>;
  rail: FeatureCollection<LineString, Props>;
  stations: FeatureCollection<Point, Props>;
  railStructures: FeatureCollection<Polygon, Props>;
  facilities: FeatureCollection<Polygon, Props>;
  facilityParts: AnyFc;
  buildings: FeatureCollection<Polygon, Props>;
  /** Block outlines, for the solid-block wall fallback. */
  blocks: FeatureCollection<Polygon, Props>;
  districts: FeatureCollection<Point, Props>;
  authored: AnyFc;
  annotations: AnyFc;
  /** Utility networks (mains, power lines, sewers, pipelines, canals); sewers are GM-only. */
  utilities?: FeatureCollection<LineString, Props>;
  utilityPoints?: FeatureCollection<Point, Props>;
  utilityAreas?: FeatureCollection<Polygon, Props>;
  /** Terrain heights over the frame (for 3D export); absent when the engine has none. */
  heights?: { cols: number; rows: number; cellM: number; data: number[]; seaLevelM: number };
}

function bboxOf(g: Geometry): Frame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (typeof c?.[0 as keyof typeof c] === 'number') {
      const p = c as number[];
      if (p[0]! < minX) minX = p[0]!;
      if (p[0]! > maxX) maxX = p[0]!;
      if (p[1]! < minY) minY = p[1]!;
      if (p[1]! > maxY) maxY = p[1]!;
    } else if (Array.isArray(c)) for (const x of c) visit(x);
  };
  if (g.type === 'GeometryCollection')
    g.geometries.forEach((x) => visit((x as { coordinates?: unknown }).coordinates));
  else visit((g as { coordinates?: unknown }).coordinates);
  return { minX, minY, maxX, maxY };
}

export function intersects(a: Frame, b: Frame): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Features whose bounding box touches the frame. */
export function clipToFrame<G extends Geometry, P>(
  fc: FeatureCollection<G, P>,
  frame: Frame,
): FeatureCollection<G, P> {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter((f: Feature<G, P>) => intersects(bboxOf(f.geometry), frame)),
  };
}

/** Frame → pixel transform (y up in metres, y down in pixels). */
export function pixelTransform(frame: Frame, pxPerM: number): (x: number, y: number) => [number, number] {
  return (x, y) => [(x - frame.minX) * pxPerM, (frame.maxY - y) * pxPerM];
}
