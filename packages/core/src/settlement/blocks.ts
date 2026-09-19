import type { Feature, Polygon } from 'geojson';
import { Rng } from '../random/rng.js';
import { area, distToRing, inset, open, orientedBox, splitByLine, type Pt } from '../geometry/polygon.js';
import type { Ring } from '../raster/contours.js';
import { WARDS, type WardId } from './wards.js';
import type { BlockRecipe } from './town.js';
import type { CulturePack } from '../naming/schema.js';
import { NameGenerator } from '../naming/generator.js';
import { amenityFor, materialFor } from '../naming/amenities.js';
import { culturePack } from '../naming/packs.js';
import { ringOnLand } from '../terrain/land.js';

/** Optional context that turns generated buildings into named, addressed premises. */
export interface BlockOptions {
  /** Culture pack for kinds, materials and business names. */
  pack?: CulturePack;
  /** Nearest named way for addresses. */
  address?: (x: number, y: number) => { street: string; number: number } | null;
  /** Second-culture share for names (colonial overlays, culture mix). */
  cultureMix?: { culture: string; weight: number }[];
  /** User or assistant renames by building id. */
  renames?: Record<string, string>;
  /** Condition strokes from the editor (field 'condition'). */
  conditionEdits?: { points: Pt[]; radiusM: number; delta: number }[];
  /** Ground test for footprints (the drawn shoreline with a setback); a building failing it is not built. */
  buildable?: (x: number, y: number) => boolean;
}

export interface BuildingProps {
  [key: string]: unknown;
  block: string;
  ward: WardId;
  floors: number;
  areaM2: number;
  kind: string;
  /** Culture-specific label for the kind (machiya, siheyuan, clapboard house…). */
  kindLabel?: string;
  material?: string;
  /** Amenity id, or 'residential'. */
  use?: string;
  useLabel?: string;
  /** Business or household name. */
  name?: string;
  address?: string;
  street?: string;
  number?: number;
  /** Timeline (when the block carries a built year). */
  built?: number;
  /** Year the building is (or will be) replaced. */
  demolished?: number;
  condition?: number;
  state?: BuildingState;
  abandoned?: number;
}

/**
 * Block level (lazy): lots by recursive splitting perpendicular to the block's
 * long axis, then a building on most lots. Deterministic per block seed.
 */

export interface BlockModel {
  id: string;
  parcels: Feature<Polygon, { block: string; ward: WardId; areaM2: number }>[];
  buildings: Feature<Polygon, BuildingProps>[];
}

/** Condition a building of this ward keeps when well looked after. */
const WARD_CONDITION: Partial<Record<WardId, number>> = {
  patriciate: 0.85,
  gardenSuburb: 0.85,
  cbd: 0.8,
  culDeSac: 0.8,
  merchant: 0.75,
  streetcarSuburb: 0.75,
  suburb: 0.75,
  market: 0.7,
  rowhouse: 0.7,
  cathedral: 0.8,
  castle: 0.6,
  craftsmen: 0.65,
  apartment: 0.65,
  warehouse: 0.55,
  towerEstate: 0.5,
  tenement: 0.45,
  slum: 0.35,
};

export type BuildingState = 'sound' | 'worn' | 'derelict' | 'ruin';

export function buildingState(condition: number): BuildingState {
  return condition >= 0.6 ? 'sound' : condition >= 0.3 ? 'worn' : condition >= 0.12 ? 'derelict' : 'ruin';
}

/** One building generation on a lot. */
interface Episode {
  built: number;
  ward: WardId;
  demolished?: number;
  /** Set when a fire took the previous building; the lot stays empty until `built`. */
  afterFire?: boolean;
}

/**
 * The history of a lot: first built with the block, rebuilt after each zoning
 * change (over the following decades) and after fires. Deterministic per lot.
 */
function lotEpisodes(block: BlockRecipe, parcelRng: Rng): Episode[] {
  const original = block.originalWard ?? block.ward;
  const built0 = (block.builtYear ?? -Infinity) + parcelRng.int(0, 25);
  const episodes: Episode[] = [{ built: built0, ward: original }];
  for (const t of block.transitions ?? []) {
    const rebuilt = t.year + parcelRng.int(0, 45);
    const last = episodes[episodes.length - 1]!;
    if (rebuilt > last.built) episodes.push({ built: rebuilt, ward: t.ward });
    else last.ward = t.ward;
  }
  for (const d of block.disasters ?? []) {
    if (d.kind !== 'fire' || !parcelRng.chance(d.magnitude)) continue;
    const standing = episodes.filter((e) => e.built <= d.year).pop();
    if (!standing) continue;
    standing.demolished = d.year;
    const ward = episodes.filter((e) => e.built <= d.year).pop()!.ward;
    // Rebuilt in the zoning of the time (a later transition may already apply).
    const later = (block.transitions ?? []).filter((t) => t.year <= d.year).pop();
    episodes.push({ built: d.year + parcelRng.int(1, 12), ward: later?.ward ?? ward, afterFire: true });
    // Drop episodes that would have started between the fire and the rebuild.
    for (let i = episodes.length - 2; i >= 0; i--)
      if (episodes[i]!.built > d.year && episodes[i]!.built < episodes[episodes.length - 1]!.built)
        episodes.splice(i, 1);
  }
  episodes.sort((a, b) => a.built - b.built);
  for (let i = 0; i < episodes.length - 1; i++) {
    const e = episodes[i]!;
    const next = episodes[i + 1]!;
    if (e.demolished === undefined || e.demolished > next.built) e.demolished = next.built;
  }
  return episodes;
}

export function generateBlock(block: BlockRecipe, year: number, options: BlockOptions = {}): BlockModel {
  const rng = new Rng(block.seed);
  const original = block.originalWard ?? block.ward;
  const profile = WARDS[original];
  const parcels: BlockModel['parcels'] = [];
  const buildings: BlockModel['buildings'] = [];
  const ring = open(block.ring);
  const model = { id: block.id, parcels, buildings };
  if (ring.length < 3) return model;
  const timeline = block.builtYear !== undefined;
  const finish = (): BlockModel => {
    if (timeline) conditionOf(model, block, year, options);
    if (options.pack) describeBuildings(model, year, options);
    return model;
  };

  // Single-structure wards.
  if (block.ward === 'cathedral' || block.ward === 'castle') {
    const footprint = inset(ring, profile.setbackM);
    if (footprint.length >= 3 && (!options.buildable || ringOnLand(footprint, options.buildable))) {
      const b = buildingFeature(
        block,
        footprint,
        block.ward === 'castle' ? 'keep' : 'cathedral',
        rng.int(profile.floors[0], profile.floors[1]),
      );
      if (timeline) b.properties.built = block.builtYear!;
      buildings.push(b);
    }
    parcels.push(parcelFeature(block, ring));
    return finish();
  }
  if (profile.lotAreaM2 <= 0) {
    parcels.push(parcelFeature(block, ring));
    return finish();
  }

  const lots = subdivide(ring, profile.lotAreaM2, rng.fork('lots'));
  const buildRng = rng.fork('buildings');
  // Lots that do not touch the street stay as yards most of the time (courtyard blocks).
  const touchesStreet = (lot: Ring) => lot.some((p) => distToRing(p, ring) < 0.5);
  lots.forEach((lot, i) => {
    parcels.push(parcelFeature(block, lot, i));
    if (buildRng.chance(profile.emptyChance)) return;
    if (profile.courtyards && !touchesStreet(lot) && buildRng.chance(0.8)) return;
    const setback = profile.setbackM + buildRng.range(0, 0.6);
    const floorJitter = rng.range(0, 1);
    // The building standing at the year, from the lot's history.
    let ward: WardId = block.ward;
    let built: number | undefined;
    let demolished: number | undefined;
    if (timeline) {
      const episodes = lotEpisodes(block, rng.fork(`parcel:${i}`));
      const now = episodes
        .filter((e) => e.built <= year && (e.demolished === undefined || e.demolished > year))
        .pop();
      if (!now) return; // not built yet, or burnt and not yet rebuilt
      ward = now.ward;
      built = now.built;
      demolished = now.demolished;
    }
    const wardProfile = WARDS[ward];
    const footprint = inset(lot, timeline ? wardProfile.setbackM + (setback - profile.setbackM) : setback);
    if (footprint.length < 3 || area(footprint) < 25) return;
    if (options.buildable && !ringOnLand(footprint, options.buildable)) return;
    const floors = Math.max(
      1,
      Math.round(
        wardProfile.floors[0] +
          floorJitter * (wardProfile.floors[1] - wardProfile.floors[0]) +
          ((built ?? year) > 1850 ? 0.5 : 0),
      ),
    );
    const b = buildingFeature(block, footprint, kindFor(ward, area(footprint)), floors, i);
    b.properties.ward = ward;
    if (built !== undefined) b.properties.built = built;
    if (demolished !== undefined && Number.isFinite(demolished)) b.properties.demolished = demolished;
    buildings.push(b);
  });
  return finish();
}

/** Condition from ward, age, material, decline, disasters and condition strokes. */
function conditionOf(model: BlockModel, block: BlockRecipe, year: number, options: BlockOptions): void {
  for (const b of model.buildings) {
    const p = b.properties;
    const built = typeof p.built === 'number' ? p.built : (block.builtYear ?? year);
    let c = WARD_CONDITION[p.ward] ?? 0.65;
    const age = Math.max(0, year - built);
    c -= Math.min(0.45, age / 250);
    if (block.abandonedYear !== undefined && year >= block.abandonedYear) {
      c -= 0.9 * Math.min(1, (year - block.abandonedYear) / 40);
      p.abandoned = block.abandonedYear;
    }
    for (const d of block.disasters ?? []) {
      if (d.kind === 'fire' || built > d.year) continue;
      const since = year - d.year;
      if (since < 0) continue;
      c -= d.magnitude * 0.5 * Math.max(0, 1 - since / 25);
    }
    if (options.conditionEdits?.length) {
      const ring = b.geometry.coordinates[0]!;
      const n = ring.length - 1 || 1;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += ring[i]![0]!;
        cy += ring[i]![1]!;
      }
      cx /= n;
      cy /= n;
      for (const e of options.conditionEdits) {
        let best = Infinity;
        for (let i = 0; i < e.points.length; i++) {
          const a = e.points[i]!;
          const bp = e.points[Math.min(i + 1, e.points.length - 1)]!;
          best = Math.min(best, distToSegment(cx, cy, a, bp));
        }
        if (best <= e.radiusM) c += e.delta * (1 - best / e.radiusM);
      }
    }
    c = Math.max(0, Math.min(1, c));
    p.condition = Math.round(c * 100) / 100;
    p.state = buildingState(p.condition);
  }
}

function distToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/** Give every building a material, a use, a name and an address (deterministic per building). */
function describeBuildings(model: BlockModel, year: number, options: BlockOptions): void {
  const pack = options.pack ?? culturePack(undefined);
  const gen = new NameGenerator(pack, model.id, year, (id) => culturePack(id), options.cultureMix);
  for (const b of model.buildings) {
    const rng = new Rng(`${b.id}/describe`);
    const p = b.properties;
    p.kindLabel = pack.conventions.buildingKinds[p.kind] ?? p.kind;
    p.material = materialFor(rng.fork('material'), year, pack, p.kind);
    const amenity =
      p.kind === 'keep' || p.kind === 'cathedral' ? null : amenityFor(rng.fork('use'), year, p.ward, p.kind);
    if (p.kind === 'cathedral') {
      p.use = 'cathedral';
      p.useLabel = pack.conventions.religious[0]!;
      p.name = `The ${pack.conventions.buildingKinds.cathedral ?? 'cathedral'}`;
    } else if (p.kind === 'keep') {
      p.use = 'castle';
      p.useLabel = pack.conventions.buildingKinds.keep ?? 'keep';
      p.name = `The ${p.useLabel}`;
    } else if (amenity) {
      p.use = amenity.id;
      p.useLabel = amenity.label;
      p.name =
        amenity.category === 'religious'
          ? pack.conventions.religious[rng.fork('rel').int(0, pack.conventions.religious.length - 1)]!
          : amenity.category === 'civic'
            ? capitalise(pack.conventions.civic[rng.fork('civ').int(0, pack.conventions.civic.length - 1)]!)
            : gen.business(b.id as string, amenity.trade);
    } else {
      p.use = 'residential';
      p.useLabel = 'residence';
      const who = gen.person(b.id as string);
      p.name = `${who.family} household`;
    }
    const renamed = options.renames?.[String(b.id)];
    if (renamed) p.name = renamed;
    if (options.address) {
      const ring = b.geometry.coordinates[0]!;
      const n = ring.length - 1 || 1;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += ring[i]![0]!;
        cy += ring[i]![1]!;
      }
      const a = options.address(cx / n, cy / n);
      if (a) {
        p.street = a.street;
        p.number = a.number;
        p.address = `${a.number} ${a.street}`;
      }
    }
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
