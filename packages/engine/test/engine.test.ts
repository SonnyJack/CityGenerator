import { describe, expect, it } from 'vitest';
import { createDocument } from '@citygen/core';
import { createEngine } from '../src/index.js';

describe('headless engine', () => {
  it('generates a small region, serves tiles, and answers queries without a browser', async () => {
    const engine = createEngine();
    const doc = createDocument({
      now: '2026-01-01T00:00:00.000Z',
      seed: 'engine-test',
      widthM: 6000,
      heightM: 6000,
    });
    const { version, stats } = await engine.setDocument(doc, { sketch: false });
    expect(version).toBe(1);
    expect(stats.settlements.length).toBeGreaterThan(0);
    expect(stats.regionName.length).toBeGreaterThan(2);
    const tile = await engine.getTile(version, 0, 0, 0);
    expect(tile).toBeInstanceOf(Uint8Array);
    expect(tile!.byteLength).toBeGreaterThan(100);
    const dem = await engine.getDemTile(version, 8, 128, 128);
    expect(dem === null || dem instanceof Uint8Array).toBe(true);
    const s = stats.settlements[0]!;
    const found = await engine.find({ kind: 'settlement' });
    expect(found.map((f) => f.id)).toContain(s.id);
    const summary = await engine.settlementSummary(s.id);
    expect(summary?.premises).toBeGreaterThan(10);
    const { entries } = await engine.directory(s.id, '', 1);
    const info = await engine.inspect(entries[0]!.center[0], entries[0]!.center[1]);
    expect(info?.settlement?.id).toBe(s.id);
    expect(info?.building?.id).toBe(entries[0]!.id);
    const frame = {
      minX: s.center[0] - 200,
      minY: s.center[1] - 200,
      maxX: s.center[0] + 200,
      maxY: s.center[1] + 200,
    };
    const model = await engine.exportFrame(frame);
    expect(model.buildings.features.length).toBeGreaterThan(0);
    expect(model.heights?.data.length).toBeGreaterThan(4);
    const { total } = await engine.directory(s.id, '', 10);
    expect(total).toBe(summary!.premises);
  });
});

describe('imported heightmap', () => {
  it('replaces the synthetic terrain with the document grid', async () => {
    const { encodeHeightmap } = await import('@citygen/core');
    const engine = createEngine();
    const w = 32;
    // A ridge along the middle row, sea elsewhere.
    const heights = new Float32Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) heights[y * w + x] = Math.abs(y - w / 2) < 4 ? 120 : -30;
    const doc = createDocument({ now: '2026-01-01T00:00:00.000Z', seed: 'dem', widthM: 8000, heightM: 8000 });
    doc.spec.terrain.importedHeightmap = encodeHeightmap(heights, w, w);
    doc.spec.terrain.rivers = { major: 0, minor: 0 };
    const { stats } = await engine.setDocument(doc, { sketch: false });
    expect(stats.terrain.maxM).toBeGreaterThan(80);
    expect(stats.terrain.landFraction).toBeLessThan(0.5);
    const ridge = await engine.inspect(0, 0);
    const sea = await engine.inspect(0, 3000);
    expect(ridge!.elevationM).toBeGreaterThan(sea!.elevationM + 50);
    expect(sea!.water).toBe('sea');
  });
});
