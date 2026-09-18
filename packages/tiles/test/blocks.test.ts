import { describe, expect, it } from 'vitest';
import { StageRunner, sitingStage, terrainStage, townStage, type SettlementSpec } from '@citygen/core';
import { BlockTiler, TileSource, encodeTileLayer, settlementLayers, tileProjection } from '../src/index.js';

describe('tile projection and direct encoding', () => {
  it('projects the origin to the centre of the world tile and clips to the tile', () => {
    const proj = tileProjection(0, 0, 0);
    const [px, py] = proj.project(0, 0);
    expect(px).toBeCloseTo(2048, 3);
    expect(py).toBeCloseTo(2048, 3);
    const z14 = tileProjection(14, 8192, 8191); // the tile just north-east of the origin
    expect(z14.minX).toBeLessThan(0);
    expect(z14.maxX).toBeGreaterThan(0);
    const layer = encodeTileLayer(
      [
        {
          type: 'Feature',
          id: 'a',
          properties: { k: 1 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [10, 10],
                [200, 10],
                [200, 200],
                [10, 200],
                [10, 10],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          id: 'b',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [50000, 50000],
                [50100, 50000],
                [50100, 50100],
                [50000, 50000],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          id: 'c',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [-100, 50],
              [100, 50],
            ],
          },
        },
        { type: 'Feature', id: 'd', properties: {}, geometry: { type: 'Point', coordinates: [30, 30] } },
      ],
      z14,
    );
    expect(layer).not.toBeNull();
    expect(layer!.features.map((f) => f.type)).toEqual([3, 2, 1]);
    expect(layer!.features[0]!.tags?.__id).toBe('a');
    // Polygon ring is closed and inside the buffered tile.
    const ring = (layer!.features[0]!.geometry as [number, number][][])[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) {
      expect(x).toBeGreaterThanOrEqual(-64);
      expect(y).toBeGreaterThanOrEqual(-64);
      expect(x).toBeLessThanOrEqual(4096 + 64);
      expect(y).toBeLessThanOrEqual(4096 + 64);
    }
  });
});

describe('BlockTiler', () => {
  it('serves buildings only at high zoom, caches blocks, and merges into the tile source', async () => {
    const runner = new StageRunner();
    const terrain = await runner.run(terrainStage, {
      seed: 'tiles-town',
      extent: { widthM: 10_000, heightM: 8_000 },
      preset: 'plains',
      relief: 0.3,
      roughness: 0.4,
      seaLevel: 0,
      rivers: { major: 0, minor: 2 },
      cellSizeM: 50,
    });
    const specs: SettlementSpec[] = [
      {
        id: 'town',
        kind: 'town',
        population: 4000,
        site: { center: [0, 0], lock: true },
        layout: { streetPattern: 'organic' },
        features: [],
      },
    ];
    const siting = await runner.run(sitingStage, {
      seed: 's',
      terrain,
      year: 1650,
      settlements: specs,
      policy: { count: [1, 1], kinds: {} },
    });
    const town = await runner.run(townStage, {
      seed: 's',
      site: siting.sites[0]!,
      terrain,
      year: 1650,
      blockSizeM: 80,
    });
    const tiler = new BlockTiler(town.blocks, 1650, { minZoom: 13 });
    expect(tiler.getTile(10, 512, 511)).toBeNull();
    const t14 = tiler.getTile(14, 8192, 8191);
    expect(t14).not.toBeNull();
    expect(t14!.buildings!.features.length).toBeGreaterThan(10);
    expect(t14!.parcels).toBeDefined();
    expect(tiler.cachedCount).toBeGreaterThan(0);
    const source = new TileSource(settlementLayers([town], null, siting), 1, [tiler]);
    const tile = source.getTile(14, 8192, 8191);
    expect(tile).not.toBeNull();
    expect(tile!.byteLength).toBeGreaterThan(500);
    // Deterministic bytes.
    const again = new TileSource(settlementLayers([town], null, siting), 1, [
      new BlockTiler(town.blocks, 1650, { minZoom: 13 }),
    ]).getTile(14, 8192, 8191);
    expect(Array.from(again!)).toEqual(Array.from(tile!));
  });
});
