import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { StageRunner, terrainStage, DEFAULT_BIOME, landcoverStage } from '@citygen/core';
import {
  createDemSampler,
  decodeTerrarium,
  demTilePng,
  encodePng,
  encodeTerrarium,
  renderThumbnail,
  sampleDemTile,
  terrainLayers,
  tileBoundsMeters,
  TileSource,
  createSketch,
} from '../src/index.js';

const fixture = {
  seed: 'dem-fixture',
  extent: { widthM: 12_000, heightM: 9_000 },
  preset: 'coast' as const,
  relief: 0.5,
  roughness: 0.5,
  seaLevel: 0,
  rivers: { major: 1, minor: 2 },
  cellSizeM: 100,
};

describe('encodePng', () => {
  it('writes a valid PNG whose IDAT inflates to the filtered rows', async () => {
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = i * 7;
    const png = await encodePng(2, 2, rgba);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    // Find IDAT and inflate.
    let offset = 8;
    let idat: Uint8Array | undefined;
    while (offset < png.length) {
      const len = new DataView(png.buffer, png.byteOffset + offset).getUint32(0);
      const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
      if (type === 'IDAT') idat = png.subarray(offset + 8, offset + 8 + len);
      offset += 12 + len;
    }
    const raw = inflateSync(idat!);
    expect(raw.length).toBe((2 * 4 + 1) * 2);
    expect(raw[0]).toBe(0);
    expect(Array.from(raw.subarray(1, 9))).toEqual(Array.from(rgba.subarray(0, 8)));
  });
});

describe('terrarium encoding', () => {
  it('round-trips heights to 1/256 m', () => {
    const h = new Float32Array([0, -12.5, 1234.75, 5000.125]);
    const rgba = encodeTerrarium(h, 2);
    for (let i = 0; i < 4; i++) expect(decodeTerrarium(rgba, i)).toBeCloseTo(h[i]!, 2);
  });
});

describe('DEM tiles', () => {
  it('agree across tile boundaries and follow the base heightmap', async () => {
    const terrain = await new StageRunner().run(terrainStage, fixture);
    const sampler = createDemSampler(terrain, fixture.seed);
    // Two horizontally adjacent tiles at z13 near the origin.
    const z = 13;
    const n = 2 ** z;
    const x = n / 2;
    const y = n / 2 - 1;
    const size = 64;
    const left = sampleDemTile(sampler, z, x - 1, y, size);
    const right = sampleDemTile(sampler, z, x, y, size);
    // The step across the shared edge is no larger than steps inside the tiles: no seam.
    let maxInner = 0;
    for (let row = 0; row < size; row++)
      for (let col = 1; col < size; col++) {
        maxInner = Math.max(maxInner, Math.abs(left[row * size + col]! - left[row * size + col - 1]!));
        maxInner = Math.max(maxInner, Math.abs(right[row * size + col]! - right[row * size + col - 1]!));
      }
    let maxEdge = 0;
    for (let row = 0; row < size; row++)
      maxEdge = Math.max(maxEdge, Math.abs(left[row * size + size - 1]! - right[row * size]!));
    expect(maxEdge).toBeLessThanOrEqual(maxInner);
    const b = tileBoundsMeters(z, x, y);
    const mid = sampler.heightAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    const base = terrain.height.sampleCubic((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    expect(Math.abs(mid - base)).toBeLessThan(12);
    const png = await demTilePng(sampler, fixture.extent, z, x, y, 32);
    expect(png).not.toBeNull();
    expect(await demTilePng(sampler, fixture.extent, z, 0, 0, 32)).toBeNull();
  });
});

describe('terrain layers and thumbnails', () => {
  it('builds vector tiles with water, rivers, contours and landcover, plain and sketched', async () => {
    const runner = new StageRunner();
    const terrain = await runner.run(terrainStage, fixture);
    const landcover = await runner.run(landcoverStage, { terrain, biome: DEFAULT_BIOME, seed: fixture.seed });
    const plain = new TileSource(terrainLayers(terrain, landcover));
    const root = plain.getTile(8, 128, 127);
    expect(root).not.toBeNull();
    const sketched = new TileSource(terrainLayers(terrain, landcover, { sketch: { seed: fixture.seed } }));
    expect(sketched.getTile(8, 128, 127)).not.toBeNull();
    expect(sketched.getTile(13, 4096, 4095)).not.toBeNull();
  });

  it('sketch keeps shared boundaries consistent', () => {
    const sk = createSketch('s', { amplitudeM: 10, wavelengthM: 300 });
    const a = sk.feature({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1000, 0],
        ],
      },
    });
    const b = sk.feature({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [1000, 0],
          [0, 0],
        ],
      },
    });
    const endA = a.geometry.coordinates[a.geometry.coordinates.length - 1]!;
    const startB = b.geometry.coordinates[0]!;
    expect(endA).toEqual(startB);
    expect(a.geometry.coordinates.length).toBeGreaterThan(2);
  });

  it('renders a thumbnail with water and land colours', async () => {
    const terrain = await new StageRunner().run(terrainStage, fixture);
    const px = renderThumbnail(terrain, 48, 36);
    expect(px.length).toBe(48 * 36 * 4);
    let blueish = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 2]! > px[i]! + 20) blueish++;
    expect(blueish).toBeGreaterThan(50);
    expect(blueish).toBeLessThan(48 * 36 - 50);
  });
});
