import type { Feature, Polygon } from 'geojson';
import { Rng } from '../random/rng.js';
import { area, distToRing, inset, open, orientedBox, splitByLine, type Pt } from '../geometry/polygon.js';
import type { Ring } from '../raster/contours.js';
import { WARDS, type WardId } from './wards.js';
import type { BlockRecipe } from './town.js';

/**
 * Block level (lazy): lots by recursive splitting perpendicular to the block's
 * long axis, then a building on most lots. Deterministic per block seed.
 */

export interface BlockModel {
  id: string;
  parcels: Feature<Polygon, { block: string; ward: WardId; areaM2: number }>[];
  buildings: Feature<
    Polygon,
    { block: string; ward: WardId; floors: number; areaM2: number; kind: string }
  >[];
}

export function generateBlock(block: BlockRecipe, year: number): BlockModel {
  const rng = new Rng(block.seed);
  const profile = WARDS[block.ward];
  const parcels: BlockModel['parcels'] = [];
  const buildings: BlockModel['buildings'] = [];
  const ring = open(block.ring);
  if (ring.length < 3) return { id: block.id, parcels, buildings };

  // Single-structure wards.
  if (block.ward === 'cathedral' || block.ward === 'castle') {
    const footprint = inset(ring, profile.setbackM);
    if (footprint.length >= 3) {
      buildings.push(
        buildingFeature(
          block,
          footprint,
          block.ward === 'castle' ? 'keep' : 'cathedral',
          rng.int(profile.floors[0], profile.floors[1]),
        ),
      );
    }
    parcels.push(parcelFeature(block, ring));
    return { id: block.id, parcels, buildings };
  }
  if (profile.lotAreaM2 <= 0) {
    parcels.push(parcelFeature(block, ring));
    return { id: block.id, parcels, buildings };
  }

  const lots = subdivide(ring, profile.lotAreaM2, rng.fork('lots'));
  const buildRng = rng.fork('buildings');
  // Lots that do not touch the street stay as yards most of the time (courtyard blocks).
  const touchesStreet = (lot: Ring) => lot.some((p) => distToRing(p, ring) < 0.5);
  lots.forEach((lot, i) => {
    parcels.push(parcelFeature(block, lot, i));
    if (buildRng.chance(profile.emptyChance)) return;
    if (profile.courtyards && !touchesStreet(lot) && buildRng.chance(0.8)) return;
    const footprint = inset(lot, profile.setbackM + buildRng.range(0, 0.6));
    if (footprint.length < 3 || area(footprint) < 25) return;
    const floors = Math.max(
      1,
      Math.round(rng.range(profile.floors[0], profile.floors[1]) + (year > 1850 ? 0.5 : 0)),
    );
    buildings.push(buildingFeature(block, footprint, kindFor(block.ward, area(footprint)), floors, i));
  });
  return { id: block.id, parcels, buildings };
}

function kindFor(ward: WardId, areaM2: number): string {
  const profile = WARDS[ward];
  if (profile.kind) return profile.kind;
  if (ward === 'patriciate') return areaM2 > 400 ? 'mansion' : 'townhouse';
  if (ward === 'merchant') return 'shophouse';
  if (ward === 'slum') return 'shack';
  if (ward === 'military') return 'barracks';
  if (ward === 'market') return 'shop';
  return areaM2 > 250 ? 'workshop' : 'house';
}

/** Recursively split a convex-ish ring until pieces are below the target lot area (with jitter). */
export function subdivide(ring: Ring, lotAreaM2: number, rng: Rng, depth = 0): Ring[] {
  const a = area(ring);
  const target = lotAreaM2 * rng.range(0.8, 1.4);
  if (a <= target || depth > 12 || ring.length < 3) return [ring];
  const box = orientedBox(ring);
  if (box.length < 8) return [ring];
  // Cut across the long axis at a jittered position; occasionally along it for variety.
  const along = box.width > box.length * 0.7 && rng.chance(0.35);
  const t = rng.range(0.33, 0.67) - 0.5;
  const axis: Pt = along ? [-box.axis[1], box.axis[0]] : box.axis;
  const span = along ? box.width : box.length;
  const px = box.center[0] + axis[0] * span * t;
  const py = box.center[1] + axis[1] * span * t;
  const a1: Pt = [px, py];
  const b1: Pt = [px - axis[1], py + axis[0]];
  const { left, right } = splitByLine(ring, a1, b1);
  const parts = [left, right].filter((r) => r.length >= 3 && area(r) > 20);
  if (parts.length < 2) return [ring];
  return parts.flatMap((p) => subdivide(p, lotAreaM2, rng, depth + 1));
}

function parcelFeature(block: BlockRecipe, ring: Ring, i = 0): BlockModel['parcels'][number] {
  return {
    type: 'Feature',
    id: `${block.id}-p${i}`,
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
    properties: { block: block.id, ward: block.ward, areaM2: area(ring) },
  };
}

function buildingFeature(
  block: BlockRecipe,
  ring: Ring,
  kind: string,
  floors: number,
  i = 0,
): BlockModel['buildings'][number] {
  return {
    type: 'Feature',
    id: `${block.id}-h${i}`,
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
    properties: { block: block.id, ward: block.ward, floors, areaM2: area(ring), kind },
  };
}
