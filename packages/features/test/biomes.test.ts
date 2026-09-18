import { describe, expect, it } from 'vitest';
import { biomeIdSchema } from '@citygen/core';
import { biomes, biomeTerrain } from '../src/index.js';

describe('biome packs', () => {
  it('covers every biome id in the document schema', () => {
    for (const id of biomeIdSchema.options) expect(biomes.has(id), id).toBe(true);
  });

  it('falls back to temperate maritime for unknown ids', () => {
    expect(biomeTerrain('nope').id).toBe('temperateMaritime');
    expect(biomeTerrain('desert').forestKind).toBe('none');
  });
});
