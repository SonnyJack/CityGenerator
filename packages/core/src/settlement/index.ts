export {
  sitingStage,
  radiusForPopulation,
  urbanDensity,
  DEFAULT_POPULATION,
  type SettlementSite,
  type SitingInput,
  type SitingOutput,
} from './siting.js';
export { townStage, type TownInput, type TownOutput, type BlockRecipe } from './town.js';
export { generateBlock, subdivide, type BlockModel } from './blocks.js';
export { roadsStage, type RoadsInput, type RoadsOutput } from './roads.js';
export { WARDS, MODERN_WARDS, FILL_WARDS, type WardId, type WardProfile, type WardContext } from './wards.js';
export { eraAt, eraInterpolated, type EraParams, type RingPattern } from './eras.js';
export {
  growthRings,
  generateRings,
  populationAt,
  modernZone,
  modernCoreZone,
  type GrowthRing,
  type RingBlock,
  type RingsResult,
} from './rings.js';
