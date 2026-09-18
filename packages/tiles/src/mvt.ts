import type { LegacyFeature, LegacyTile } from 'geojson-vt';
import type { Feature, Geometry, Position } from 'geojson';
import { METERS_PER_DEGREE, clipRect, hash53 } from '@citygen/core';
import { TILE_EXTENT, cleanProperties } from './builder.js';

/**
 * Direct encoding of features (world metres) into geojson-vt's tile format for
 * one tile, without building a global index. Used for lazily generated content
 * whose features are known per tile (blocks). Polygons are clipped to the tile
 * with a buffer; lines are clipped per segment; points are filtered.
 */

export interface TileProjection {
  /** World metres → tile coordinates (0..extent, y down). */
  project(x: number, y: number): [number, number];
  /** Tile bounds in world metres, including the buffer. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const BUFFER = 64;

export function tileProjection(z: number, x: number, y: number, extent = TILE_EXTENT): TileProjection {
  const n = 2 ** z;
  const scale = (n * extent) / 360; // tile units per degree of longitude
  const lonToTx = (lon: number) => (lon + 180) * scale - x * extent;
  const latToTy = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    const yn = 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
    return yn * n * extent - y * extent;
  };
  const project = (wx: number, wy: number): [number, number] => [
    lonToTx(wx / METERS_PER_DEGREE),
    latToTy(wy / METERS_PER_DEGREE),
  ];
  // Bounds: invert at the buffered tile corners.
  const lonW = ((x * extent - BUFFER) / (n * extent)) * 360 - 180;
  const lonE = (((x + 1) * extent + BUFFER) / (n * extent)) * 360 - 180;
  const latN =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * extent - BUFFER)) / (n * extent)))) * 180) / Math.PI;
  const latS =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ((y + 1) * extent + BUFFER)) / (n * extent)))) * 180) / Math.PI;
  return {
    project,
    minX: lonW * METERS_PER_DEGREE,
    maxX: lonE * METERS_PER_DEGREE,
    minY: latS * METERS_PER_DEGREE,
    maxY: latN * METERS_PER_DEGREE,
  };
}

function numericId(id: string | number | undefined): number | undefined {
  if (id === undefined) return undefined;
  return typeof id === 'number' ? id : hash53(id) % 2147483647;
}

/** Encode features into one tile layer; returns null when nothing falls in the tile. */
export function encodeTileLayer<G extends Geometry, P extends Record<string, unknown>>(
  features: Iterable<Feature<G, P>>,
  proj: TileProjection,
): LegacyTile | null {
  const out: LegacyFeature[] = [];
  const clipMin = -BUFFER;
  const clipMax = TILE_EXTENT + BUFFER;
  const q = (p: [number, number]): [number, number] => [Math.round(p[0]), Math.round(p[1])];
  for (const f of features) {
    const tags = cleanProperties({ ...f.properties, __id: f.id === undefined ? undefined : String(f.id) });
    const id = numericId(f.id);
    const g = f.geometry;
    switch (g.type) {
      case 'Point': {
        const [px, py] = proj.project(g.coordinates[0]!, g.coordinates[1]!);
        if (px < clipMin || py < clipMin || px > clipMax || py > clipMax) break;
        out.push({ type: 1, geometry: [q([px, py])], tags, id });
        break;
      }
      case 'LineString': {
        const lines = clipLine(
          g.coordinates.map((p) => proj.project(p[0]!, p[1]!)),
          clipMin,
          clipMax,
        );
        if (lines.length) out.push({ type: 2, geometry: lines.map((l) => l.map(q)), tags, id });
        break;
      }
      case 'MultiLineString': {
        const lines = g.coordinates.flatMap((line) =>
          clipLine(
            line.map((p) => proj.project(p[0]!, p[1]!)),
            clipMin,
            clipMax,
          ),
        );
        if (lines.length) out.push({ type: 2, geometry: lines.map((l) => l.map(q)), tags, id });
        break;
      }
      case 'Polygon': {
        const rings = clipPolygon(g.coordinates, proj, clipMin, clipMax);
        if (rings.length) out.push({ type: 3, geometry: rings.map((r) => r.map(q)), tags, id });
        break;
      }
      case 'MultiPolygon': {
        for (const poly of g.coordinates) {
          const rings = clipPolygon(poly, proj, clipMin, clipMax);
          if (rings.length) out.push({ type: 3, geometry: rings.map((r) => r.map(q)), tags, id });
        }
        break;
      }
      default:
        break;
    }
  }
  return out.length ? { features: out } : null;
}

function clipPolygon(
  coords: Position[][],
  proj: TileProjection,
  min: number,
  max: number,
): [number, number][][] {
  const rings: [number, number][][] = [];
  for (let i = 0; i < coords.length; i++) {
    const ring = coords[i]!.map((p) => proj.project(p[0]!, p[1]!));
    // Tile space is y-down: a world-CCW exterior becomes CW here, which is what MVT expects.
    const clipped = clipRect(ring.slice(0, -1), min, min, max, max);
    if (clipped.length < 3) {
      if (i === 0) return [];
      continue;
    }
    rings.push([...clipped, clipped[0]!]);
  }
  return rings;
}

/** Clip a polyline to a square (Liang–Barsky per segment), splitting where it leaves. */
function clipLine(points: [number, number][], min: number, max: number): [number, number][][] {
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1]!, points[i]!, min, max);
    if (!seg) {
      if (current.length >= 2) out.push(current);
      current = [];
      continue;
    }
    if (current.length === 0) current.push(seg[0]);
    else {
      const last = current[current.length - 1]!;
      if (Math.abs(last[0] - seg[0][0]) > 1e-6 || Math.abs(last[1] - seg[0][1]) > 1e-6) {
        if (current.length >= 2) out.push(current);
        current = [seg[0]];
      }
    }
    current.push(seg[1]);
  }
  if (current.length >= 2) out.push(current);
  return out;
}

function clipSegment(
  a: [number, number],
  b: [number, number],
  min: number,
  max: number,
): [[number, number], [number, number]] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks: [number, number][] = [
    [-dx, a[0] - min],
    [dx, max - a[0]],
    [-dy, a[1] - min],
    [dy, max - a[1]],
  ];
  for (const [p, qv] of checks) {
    if (p === 0) {
      if (qv < 0) return null;
      continue;
    }
    const r = qv / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}
