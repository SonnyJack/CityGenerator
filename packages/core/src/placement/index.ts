export type {
  FeatureLevel,
  FeatureSize,
  Orientation,
  Frame,
  PlacementContext,
  HostSite,
  CandidateInfo,
  HardConstraint,
  SoftScorer,
  PartKind,
  LocalPart,
  LayoutInput,
  FeatureType,
  PlacementRequest,
  PlacedFeature,
  PlacementFailure,
  PartFeature,
} from './types.js';
export {
  placeFeatures,
  createContext,
  frameRing,
  toWorld,
  framesOverlap,
  type PlaceResult,
  type PlaceOptions,
} from './engine.js';
export { FEATURE_TYPES, featureTypeMap, primitives } from './library.js';
export { defaultRequests } from './defaults.js';
export { customFeatureTypeSchema, customFeatureType, type CustomFeatureType } from './custom.js';
export {
  facilitiesStage,
  type FacilitiesInput,
  type FacilitiesOutput,
  type FacilityProps,
  type ReservedArea,
} from './stage.js';
