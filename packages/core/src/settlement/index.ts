export {
  sitingStage,
  DEFAULT_POPULATION,
  type SettlementSite,
  type SitingInput,
  type SitingOutput,
} from './siting.js';
export { townStage, type TownInput, type TownOutput, type BlockRecipe } from './town.js';
export { growthFootprint, type Footprint, type FootprintOptions } from './footprint.js';
export {
  gridOrientation,
  gradientBetween,
  STEPS_GRADIENT,
  type GridOrientation,
  type OrientationTerrain,
} from './orientation.js';
export {
  generateBlock,
  subdivide,
  type BlockModel,
  type BlockOptions,
  type BuildingProps,
} from './blocks.js';
export { roadsStage, ROAD_GRADIENT_CAP, type RoadsInput, type RoadsOutput, type RoadMode } from './roads.js';
export {
  WARDS,
  MODERN_WARDS,
  FILL_WARDS,
  RESERVED_WARDS,
  type WardId,
  type WardProfile,
  type WardContext,
} from './wards.js';
export { eraAt, eraInterpolated, type EraParams, type RingPattern } from './eras.js';
export {
  growthRings,
  generateRings,
  modernZone,
  modernCoreZone,
  type GrowthRing,
  type RingBlock,
  type RingsResult,
} from './rings.js';
export * from './history.js';
