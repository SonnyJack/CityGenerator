import { StageRunner } from './stage.js';
import { regionOutlineStage, type RegionOutlineInput } from './regionOutline.js';
import { contentHash } from '../random/hash.js';
import { Rng } from '../random/rng.js';

/**
 * Determinism fixture shared by the unit tests (Node) and the end-to-end tests
 * (Chromium, Firefox, WebKit). If any engine produces a different hash, the
 * generator is not portable and the build must fail.
 */
export const FIXTURE_INPUT: RegionOutlineInput = {
  seed: 'fixture',
  extent: { widthM: 10_000, heightM: 8_000 },
};

/** Golden value. Update deliberately, in the same commit as the engine change that moves it. */
export const FIXTURE_GOLDEN_HASH = 'e599da5ada17d9d27e2cb299b44fa755';

export async function computeFixtureHash(): Promise<string> {
  const out = await new StageRunner().run(regionOutlineStage, FIXTURE_INPUT);
  const rng = new Rng('fixture');
  const draws: number[] = [];
  for (let i = 0; i < 10_000; i++) draws.push(rng.nextU32());
  const normals: number[] = [];
  for (let i = 0; i < 100; i++) normals.push(Math.round(rng.normal() * 1e6));
  return contentHash({ out, draws, normals });
}
