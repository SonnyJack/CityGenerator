import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { TrackMode, TrackProps } from './rail.js';

export type CrossingKind = 'levelCrossing' | 'railBridge' | 'railUnderpass';

export interface CrossingProps {
  kind: CrossingKind;
  /** Id of the road or street crossed. */
  road: string;
  line: string;
}

type Pt = [number, number];

function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]];
  const s: Pt = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const qp: Pt = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

function kindFor(mode: TrackMode): CrossingKind | null {
  switch (mode) {
    case 'surface':
      return 'levelCrossing';
    case 'embankment':
    case 'viaduct':
    case 'elevated':
      return 'railBridge';
    case 'cutting':
      return 'railUnderpass';
    default:
      return null; // tunnels and subways do not meet the street
  }
}

/**
 * Where tracks meet roads or streets: a level crossing on the surface, a rail
 * bridge over the road on embankments and viaducts, an underpass in cuttings.
 * Uses a coarse grid to keep the segment pairing near-linear.
 */
export function railCrossings(
  tracks: FeatureCollection<LineString, TrackProps>,
  roads: Feature<LineString, unknown>[],
  options: { minSpacingM?: number } = {},
): FeatureCollection<Point, CrossingProps> {
  const cell = 400;
  const grid = new Map<string, { a: Pt; b: Pt; id: string }[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const road of roads) {
    const c = road.geometry.coordinates;
    const id = String(road.id ?? '');
    for (let i = 1; i < c.length; i++) {
      const a: Pt = [c[i - 1]![0]!, c[i - 1]![1]!];
      const b: Pt = [c[i]![0]!, c[i]![1]!];
      const minX = Math.min(a[0], b[0]);
      const maxX = Math.max(a[0], b[0]);
      const minY = Math.min(a[1], b[1]);
      const maxY = Math.max(a[1], b[1]);
      for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx++)
        for (let gy = Math.floor(minY / cell); gy <= Math.floor(maxY / cell); gy++) {
          const k = `${gx},${gy}`;
          const list = grid.get(k) ?? [];
          list.push({ a, b, id });
          grid.set(k, list);
        }
    }
  }
  const out: Feature<Point, CrossingProps>[] = [];
  const minSpacing = options.minSpacingM ?? 25;
  for (const t of tracks.features) {
    const kind = kindFor(t.properties.mode);
    if (!kind || t.properties.class === 'yard') continue;
    const c = t.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const a: Pt = [c[i - 1]![0]!, c[i - 1]![1]!];
      const b: Pt = [c[i]![0]!, c[i]![1]!];
      const seen = new Set<string>();
      for (const q of [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Pt]) {
        const k = keyOf(q[0], q[1]);
        if (seen.has(k)) continue;
        seen.add(k);
        for (const seg of grid.get(k) ?? []) {
          const p = segmentIntersection(a, b, seg.a, seg.b);
          if (!p) continue;
          if (
            out.some(
              (o) =>
                Math.hypot(o.geometry.coordinates[0]! - p[0], o.geometry.coordinates[1]! - p[1]) < minSpacing,
            )
          )
            continue;
          out.push({
            type: 'Feature',
            id: `crossing-${out.length}`,
            geometry: { type: 'Point', coordinates: p },
            properties: { kind, road: seg.id, line: t.properties.line },
          });
        }
      }
    }
  }
  return { type: 'FeatureCollection', features: out };
}
