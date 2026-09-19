import type { Feature, LineString, Point, Polygon } from 'geojson';
import type { Rng } from '../random/rng.js';
import type { Ring } from '../raster/contours.js';
import type { TerrainOutput } from '../terrain/stage.js';
import type { SettlementSite } from '../settlement/siting.js';
import type { RailOutput } from '../networks/rail.js';
import type { WardId } from '../settlement/wards.js';

/**
 * The placement engine (DESIGN §6.5): one engine places everything from a
 * container port to an observatory. A feature type declares its footprint,
 * hard constraints, soft scorers, orientation, connectors, nuisance and a
 * layout that fills the footprint with parts.
 */

export type Pt = [number, number];
export type FeatureLevel = 'region' | 'settlement';
export type FeatureSize = 'small' | 'medium' | 'large';
export type Orientation = 'free' | 'alignCoast' | 'alignRail' | 'alignRadial' | 'alignWind' | 'alignRiver';

/** A placed footprint frame: centre, unit axis of the long side, and dimensions in metres. */
export interface Frame {
  center: Pt;
  axis: Pt;
  lengthM: number;
  widthM: number;
}

/** What a hard constraint or scorer can look at. */
export interface PlacementContext {
  terrain: TerrainOutput;
  year: number;
  sites: SettlementSite[];
  rail: RailOutput | null;
  /** Direction the wind comes from, radians. */
  windFrom: number;
  /** Footprints already placed (region and settlement level), for overlap. */
  placed: Frame[];
  /** Sample helpers over the rasters. */
  isLand(x: number, y: number): boolean;
  isSea(x: number, y: number): boolean;
  isWater(x: number, y: number): boolean;
  slopeAt(x: number, y: number): number;
  elevationAt(x: number, y: number): number;
  distToSea(x: number, y: number): number;
  distToWater(x: number, y: number): number;
  /** Fraction of sea within a radius of a point (shelter and depth proxy). */
  seaFraction(x: number, y: number, radiusM: number): number;
  /** Distance to the nearest railway track (Infinity without rail). */
  distToRail(x: number, y: number): number;
  /** Unit tangent of the nearest track, or null. */
  railTangent(x: number, y: number): Pt | null;
  /** Unit tangent of the coast (perpendicular to the sea gradient), or null when far from the sea. */
  coastTangent(x: number, y: number): Pt | null;
  /** Unit tangent of the nearest river within reach, or null. */
  riverTangent(x: number, y: number): Pt | null;
}

/** The settlement a request belongs to (null for region-level features). */
export interface HostSite {
  site: SettlementSite;
  /** Old-core radius approximation used for "edge of town" tests. */
  coreRadiusM: number;
}

export interface CandidateInfo {
  frame: Frame;
  /** Frame corner and edge samples in world coordinates (5 × 5 grid). */
  samples: Pt[];
  /** Midpoints of the four edges: [+axis, -axis, +normal, -normal]. */
  edges: [Pt, Pt, Pt, Pt];
  host: HostSite | null;
  ctx: PlacementContext;
}

export type HardConstraint = (c: CandidateInfo) => string | null; // null = ok, else reason
export type SoftScorer = { weight: number; score: (c: CandidateInfo) => number };

export type PartKind =
  | 'quay'
  | 'pier'
  | 'breakwater'
  | 'berth'
  | 'shed'
  | 'warehouse'
  | 'building'
  | 'hall'
  | 'crane'
  | 'tank'
  | 'gasholder'
  | 'chimney'
  | 'coolingTower'
  | 'dock'
  | 'slipway'
  | 'basin'
  | 'pond'
  | 'track'
  | 'road'
  | 'yard'
  | 'apron'
  | 'runway'
  | 'hangar'
  | 'terminal'
  | 'grounds'
  | 'field'
  | 'graves'
  | 'chapel'
  | 'wall'
  | 'fence'
  | 'gate'
  | 'tower'
  | 'reservoir'
  | 'dome'
  | 'wheelhouse'
  | 'race'
  | 'ramp'
  | 'containerYard'
  | 'slag'
  | 'switchyard';

/** A part in the footprint's local frame: u along the long axis (−L/2..L/2), v across (−W/2..W/2). */
export type LocalPart =
  | {
      kind: PartKind;
      shape: 'rect';
      u: number;
      v: number;
      lengthM: number;
      widthM: number;
      angle?: number;
      name?: string;
      floors?: number;
    }
  | { kind: PartKind; shape: 'circle'; u: number; v: number; radiusM: number; name?: string }
  | { kind: PartKind; shape: 'line'; points: Pt[]; widthM?: number; name?: string }
  | { kind: PartKind; shape: 'point'; u: number; v: number; name?: string }
  | { kind: PartKind; shape: 'polygon'; points: Pt[]; name?: string; floors?: number };

export interface LayoutInput {
  size: FeatureSize;
  year: number;
  /** Footprint dimensions after compression. */
  lengthM: number;
  widthM: number;
  /** Compression factor applied (1 = true scale). */
  compression: number;
  rng: Rng;
  host: HostSite | null;
  /** Which edge faces the sea / rail / town (+normal side is "front" when aligned). */
  front: 'sea' | 'rail' | 'town' | 'none';
}

export interface FeatureType {
  id: string;
  name: string;
  category: 'port' | 'industry' | 'institution' | 'transport' | 'custom';
  level: FeatureLevel;
  years: [number, number];
  /** Real-world footprint by size, metres [length, width]. */
  footprint: (size: FeatureSize, ctx: { population: number; year: number }) => [number, number];
  /** Default compression for the footprint (1 = none); applied when the document allows it. */
  scaleCompression?: number;
  orientation: Orientation;
  /** Where the footprint sits relative to its host: fraction of the site radius [min, max]. */
  radial?: [number, number];
  hard: HardConstraint[];
  soft: SoftScorer[];
  connectors?: { rail?: boolean; road?: boolean };
  nuisance?: { radiusM: number; strength: number };
  /** Ward the reserved town patches take. */
  ward: WardId;
  layout: (input: LayoutInput) => LocalPart[];
}

export interface PlacementRequest {
  id: string;
  type: string;
  size: FeatureSize;
  /** Settlement id for settlement-level requests. */
  settlement?: string;
  pin?: { x: number; y: number; rotation: number; lengthM?: number; widthM?: number };
  /** Point hint the app resolved ("north of the station"). */
  hint?: Pt;
  params?: Record<string, unknown>;
  /** Year the facility opened (defaults follow the host's growth; explicit requests the type's first year). */
  opened?: number;
  /** Year it closed: a brownfield drawn as it stood when it shut. */
  closed?: number;
}

export interface PlacedFeature {
  id: string;
  type: string;
  name: string;
  category: FeatureType['category'];
  settlement: string | null;
  size: FeatureSize;
  frame: Frame;
  ring: Ring;
  realLengthM: number;
  realWidthM: number;
  compression: number;
  ward: WardId;
  pinned: boolean;
  /** How the engine got here: 'placed', or a degraded outcome. */
  outcome: 'placed' | 'shrunk' | 'relaxed';
  opened: number;
  closed?: number;
}

export interface PlacementFailure {
  id: string;
  type: string;
  settlement: string | null;
  reason: string;
}

export type PartFeature = Feature<
  Polygon | LineString | Point,
  {
    feature: string;
    type: string;
    kind: PartKind;
    settlement: string | null;
    name?: string;
    floors?: number;
    widthM?: number;
  }
>;
