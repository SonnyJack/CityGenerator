export {
  D8,
  fillDepressions,
  computeFlow,
  distanceTo,
  slopeAspect,
  erodeStep,
  diffuse,
  type FillResult,
  type FlowResult,
} from './hydrology.js';
export { extractRivers, riverWidth, type RiverReach } from './rivers.js';
export { presetShape, type TerrainPresetId, type PresetShape } from './presets.js';
export { DEFAULT_BIOME, type BiomeTerrainParams } from './biome.js';
export {
  terrainStage,
  landcoverStage,
  baseCellSize,
  contourInterval,
  WATER,
  LANDCOVER,
  type TerrainInput,
  type TerrainOutput,
  type LandcoverInput,
  type LandcoverOutput,
  type LandcoverClass,
} from './stage.js';
