export {
  StageRunner,
  defineStage,
  CancelledError,
  type StageDef,
  type StageContext,
  type RunOptions,
} from './stage.js';
export { regionOutlineStage, type RegionOutlineInput, type RegionOutlineOutput } from './regionOutline.js';
export { FIXTURE_INPUT, FIXTURE_GOLDEN_HASH, computeFixtureHash } from './fixture.js';
