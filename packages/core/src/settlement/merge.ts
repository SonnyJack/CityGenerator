import { bbox, centroid, convexOverlapArea, pointInRing, type Pt } from '../geometry/polygon.js';
import { Territory } from '../geometry/territory.js';
import type { Ring } from '../raster/contours.js';
import type { TownOutput } from './town.js';

/** The block laid in a patch: `x-patch-12` ↔ `x-b12`, `x-ring-1-3_4-0` ↔ `x-r1-3_4-0`. */
function blockIdOf(townId: string, patchId: string): string {
  const core = `${townId}-patch-`;
  return patchId.startsWith(core)
    ? `${townId}-b${patchId.slice(core.length)}`
    : `${townId}-r${patchId.slice(`${townId}-ring-`.length)}`;
}

interface Built {
  town: number;
  id: string;
  /** Year the ground was built on; a gate suburb or an undated patch counts as old. */
  year: number;
}

/**
 * Where two settlements have grown into each other, the ground built first keeps it. A patch (and
 * the block in it) that runs onto older built ground of another town is cut back along that
 * ground's edge, and its buildings there are cleared; one that stands on it is dropped. The older
 * ground is never touched, so what stood in one year stands the same in the next however the
 * neighbour grows. Ground built in the same year defers to the town listed first (the larger).
 * Farmland is not built ground and gives way to nothing.
 */
export function settleTownOverlaps(towns: TownOutput[]): TownOutput[] {
  if (towns.length < 2) return towns;
  const ground = new Territory<Built>(200);
  towns.forEach((t, town) => {
    for (const f of t.patches.features) {
      if (f.properties.ward === 'farm') continue;
      const ring = f.geometry.coordinates[0]!.slice(0, -1).map((p) => [p[0]!, p[1]!] as Pt);
      const year = typeof f.properties.built === 'number' ? f.properties.built : -Infinity;
      ground.add(ring, { town, id: String(f.id), year }, 0);
    }
  });
  const olderThan = (a: Built, b: Built) => a.year < b.year || (a.year === b.year && a.town < b.town);
  return towns.map((t, town) => {
    const dropped = new Set<string>();
    const cut = new Map<string, Ring[]>();
    const features = t.patches.features.flatMap((f) => {
      if (f.properties.ward === 'farm') return [f];
      const ring = f.geometry.coordinates[0]!.slice(0, -1).map((p) => [p[0]!, p[1]!] as Pt);
      const me: Built = {
        town,
        id: String(f.id),
        year: typeof f.properties.built === 'number' ? f.properties.built : -Infinity,
      };
      const hits = ground.near(
        bbox(ring),
        (c) => c.tag.town !== town && olderThan(c.tag, me) && convexOverlapArea(ring, c.hull) > 1,
      );
      if (!hits.length) return [f];
      const c = centroid(ring);
      if (hits.some((h) => pointInRing(c[0], c[1], h.hull))) {
        dropped.add(blockIdOf(t.id, me.id));
        return [];
      }
      const hulls = hits.map((h) => h.hull);
      cut.set(blockIdOf(t.id, me.id), hulls);
      const local = new Territory<null>(200);
      for (const h of hulls) local.add(h, null, 0);
      const kept = local.clear(ring);
      if (kept.length < 3) {
        dropped.add(blockIdOf(t.id, me.id));
        return [];
      }
      return [{ ...f, geometry: { ...f.geometry, coordinates: [[...kept, kept[0]!]] } }];
    });
    if (!dropped.size && !cut.size) return t;
    const blocks = t.blocks
      .filter((b) => !dropped.has(b.id))
      .map((b) => {
        const hulls = cut.get(b.id);
        return hulls ? { ...b, clear: [...(b.clear ?? []), ...hulls] } : b;
      });
    return { ...t, blocks, patches: { ...t.patches, features } };
  });
}

/** A line through the towns and the half-width of the ground it takes (track bed, carriageway). */
export interface TownLine {
  points: Pt[];
  halfWidthM: number;
}

/** The rectangle a segment's corridor covers, ends overlapping the next by the half-width. */
function corridor(a: Pt, b: Pt, h: number): Ring {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const nx = -uy * h;
  const ny = ux * h;
  const a0: Pt = [a[0] - ux * h, a[1] - uy * h];
  const b0: Pt = [b[0] + ux * h, b[1] + uy * h];
  return [
    [a0[0] - nx, a0[1] - ny],
    [b0[0] - nx, b0[1] - ny],
    [b0[0] + nx, b0[1] + ny],
    [a0[0] + nx, a0[1] + ny],
  ];
}

/**
 * A railway through a town took its bed out of the blocks it crossed: the buildings standing in a
 * line's corridor are cleared (`BlockRecipe.clear`), and the blocks keep their outlines and lots,
 * so the rest of each block is what it would have been without the line.
 */
export function clearAlongLines(towns: TownOutput[], lines: TownLine[]): TownOutput[] {
  if (!lines.length) return towns;
  const beds = new Territory<null>(200);
  for (const l of lines)
    for (let i = 1; i < l.points.length; i++) {
      const r = corridor(l.points[i - 1]!, l.points[i]!, l.halfWidthM);
      if (r.length) beds.add(r, null, 0);
    }
  return towns.map((t) => {
    let changed = false;
    const blocks = t.blocks.map((b) => {
      const hits = beds.near(bbox(b.ring), (c) => convexOverlapArea(b.ring, c.hull) > 0.5);
      if (!hits.length) return b;
      changed = true;
      return { ...b, clear: [...(b.clear ?? []), ...hits.map((h) => h.hull)] };
    });
    return changed ? { ...t, blocks } : t;
  });
}

/**
 * A road from outside stops where the town's built-up ground begins; the town's own streets carry
 * it on from there. Each line keeps its runs outside every built patch (a run along the street at
 * a patch's edge stays) that are at least `minLengthM` long; extra runs get `#n` ids.
 */
export function stopAtTowns<F extends { id?: string | number; geometry: { coordinates: number[][] } }>(
  lines: F[],
  towns: TownOutput[],
  minLengthM = 40,
): F[] {
  const built = new Territory<null>(200);
  for (const t of towns)
    for (const f of t.patches.features) {
      if (f.properties.ward === 'farm') continue;
      built.add(
        f.geometry.coordinates[0]!.slice(0, -1).map((p) => [p[0]!, p[1]!] as Pt),
        null,
      );
    }
  return lines.flatMap((f) => {
    const pts = f.geometry.coordinates.map((p) => [p[0]!, p[1]!] as Pt);
    const runs = built.outside(pts, minLengthM);
    const whole =
      runs.length === 1 && runs[0]!.length === pts.length && runs[0]!.every((p, i) => p === pts[i]);
    if (whole) return [f];
    return runs.map((r, j) => ({
      ...f,
      ...(f.id !== undefined ? { id: j ? `${String(f.id)}#${j}` : f.id } : {}),
      geometry: { ...f.geometry, coordinates: r },
    }));
  });
}
