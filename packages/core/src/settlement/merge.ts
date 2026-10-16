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
