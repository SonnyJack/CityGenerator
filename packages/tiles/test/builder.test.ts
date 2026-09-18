import { describe, expect, it } from 'vitest';
import { StageRunner, regionOutlineStage, FIXTURE_INPUT } from '@citygen/core';
import { TileSource } from '../src/index.js';

describe('TileSource', () => {
  it('encodes non-empty tiles for the region outline and null elsewhere', async () => {
    const out = await new StageRunner().run(regionOutlineStage, FIXTURE_INPUT);
    const source = new TileSource([
      { name: 'region', features: { type: 'FeatureCollection', features: [out.boundary] } },
      { name: 'graticule', features: out.graticule, minZoom: 8 },
      { name: 'samples', features: out.samples },
    ]);
    // The region sits at lon/lat (0,0): at z=1 that is tile (1,0)/(0,0)/(1,1)/(0,1) corner; z=0 is tile 0/0.
    const root = source.getTile(0, 0, 0);
    expect(root).not.toBeNull();
    expect(root!.byteLength).toBeGreaterThan(20);
    // Far away tile: nothing.
    expect(source.getTile(10, 5, 5)).toBeNull();
    // Graticule is hidden below its minZoom but present above it.
    const z12 = source.getTile(12, 2048, 2047);
    expect(z12).not.toBeNull();
  });

  it('is deterministic', async () => {
    const out = await new StageRunner().run(regionOutlineStage, FIXTURE_INPUT);
    const make = () => new TileSource([{ name: 'samples', features: out.samples }]);
    expect(Array.from(make().getTile(0, 0, 0)!)).toEqual(Array.from(make().getTile(0, 0, 0)!));
  });
});
