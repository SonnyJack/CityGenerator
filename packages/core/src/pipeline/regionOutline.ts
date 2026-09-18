import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { defineStage } from './stage.js';
import type { RegionSpec } from '../document/schema.js';

/**
 * Phase 0 placeholder stage: the region boundary and a 1 km graticule in
 * metres. It exists so the whole pipeline (worker → tiles → MapLibre) can be
 * exercised end to end before terrain generation lands in Phase 1.
 */

export interface RegionOutlineInput {
  seed: string;
  extent: RegionSpec['extent'];
}

export interface RegionOutlineOutput {
  boundary: Feature<Polygon, { kind: 'regionBoundary' }>;
  graticule: FeatureCollection<LineString, { kind: 'graticule'; major: boolean }>;
  /** Deterministic sample points, to prove the RNG path end to end. */
  samples: FeatureCollection<Point, { kind: 'sample'; i: number }>;
}

export const regionOutlineStage = defineStage<RegionOutlineInput, RegionOutlineOutput>({
  id: 'regionOutline',
  version: 1,
  seedOf: (input) => input.seed,
  run(input, ctx) {
    const hw = input.extent.widthM / 2;
    const hh = input.extent.heightM / 2;
    const boundary: RegionOutlineOutput['boundary'] = {
      type: 'Feature',
      id: 'region-boundary',
      properties: { kind: 'regionBoundary' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
            [-hw, -hh],
          ],
        ],
      },
    };

    const lines: RegionOutlineOutput['graticule']['features'] = [];
    const step = 1000;
    for (let x = Math.ceil(-hw / step) * step; x <= hw; x += step) {
      lines.push({
        type: 'Feature',
        id: `grat-x-${x}`,
        properties: { kind: 'graticule', major: x % 5000 === 0 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [x, -hh],
            [x, hh],
          ],
        },
      });
    }
    for (let y = Math.ceil(-hh / step) * step; y <= hh; y += step) {
      lines.push({
        type: 'Feature',
        id: `grat-y-${y}`,
        properties: { kind: 'graticule', major: y % 5000 === 0 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-hw, y],
            [hw, y],
          ],
        },
      });
    }
    ctx.checkpoint();

    const rng = ctx.rng.fork('samples');
    const samples: RegionOutlineOutput['samples'] = { type: 'FeatureCollection', features: [] };
    for (let i = 0; i < 64; i++) {
      samples.features.push({
        type: 'Feature',
        id: `sample-${i}`,
        properties: { kind: 'sample', i },
        geometry: { type: 'Point', coordinates: [rng.range(-hw, hw), rng.range(-hh, hh)] },
      });
    }
    ctx.progress(1);
    return { boundary, graticule: { type: 'FeatureCollection', features: lines }, samples };
  },
});
