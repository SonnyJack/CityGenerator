import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Polygon } from 'geojson';
import { atlas, sanborn } from '@citygen/themes';
import {
  buildWalls,
  directoryCsv,
  exportGeoJson,
  foundryScene,
  renderSvg,
  universalVtt,
  type ExportModel,
} from '../src/index.js';

type Props = Record<string, unknown>;
const rect = (x: number, y: number, w: number, h: number, props: Props = {}, id = `${x},${y}`) => ({
  type: 'Feature' as const,
  id,
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ],
    ],
  },
  properties: props,
});
const fc = <G>(features: G[]) => ({ type: 'FeatureCollection' as const, features }) as never;

function grid(n: number, size = 10, gap = 4): FeatureCollection<Polygon, Props> {
  const features = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      features.push(
        rect(
          i * (size + gap),
          j * (size + gap),
          size,
          size,
          {
            block: `b${i}`,
            kind: 'house',
            material: i % 2 ? 'brick' : 'timber',
            use: j % 3 ? 'residential' : 'pub',
            name: j % 3 ? 'Smith household' : 'The Crown',
          },
          `h${i}-${j}`,
        ),
      );
  return fc(features);
}

function model(
  buildings: FeatureCollection<Polygon, Props>,
  frame = { minX: -20, minY: -20, maxX: 520, maxY: 520 },
): ExportModel {
  const empty = fc([]);
  return {
    frame,
    year: 1925,
    name: 'Test frame',
    water: fc([rect(-500, -500, 600, 1200, { kind: 'sea' })]),
    rivers: fc([
      {
        type: 'Feature',
        id: 'r',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-100, 0],
            [600, 40],
          ],
        },
        properties: { widthM: 6, name: 'River Test' },
      },
    ]),
    landcover: fc([rect(-1000, -1000, 3000, 3000, { kind: 'open' })]),
    contours: empty,
    patches: fc([rect(-10, -10, 300, 300, { ward: 'merchant' })]),
    streets: fc([
      {
        type: 'Feature',
        id: 's',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, -5],
            [500, -5],
          ],
        },
        properties: { class: 'artery' },
      },
    ]),
    ways: fc([
      {
        type: 'Feature',
        id: 'w',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, -5],
            [500, -5],
          ],
        },
        properties: { name: 'High Street', class: 'artery', lengthM: 500 },
      },
    ]),
    walls: empty,
    roads: empty,
    rail: fc([
      {
        type: 'Feature',
        id: 'rl',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 500],
            [500, 500],
          ],
        },
        properties: { class: 'mainline', mode: 'surface' },
      },
    ]),
    stations: fc([
      {
        type: 'Feature',
        id: 'st',
        geometry: { type: 'Point', coordinates: [250, 500] },
        properties: { kind: 'central', name: 'Test Central' },
      },
    ]),
    railStructures: empty,
    facilities: fc([rect(400, 400, 100, 60, { name: 'Gasworks', category: 'industry' })]),
    facilityParts: fc([rect(410, 410, 30, 20, { kind: 'building' })]),
    buildings,
    blocks: fc([rect(-5, -5, 250, 250, { ward: 'merchant' })]),
    districts: fc([
      {
        type: 'Feature',
        id: 'd',
        geometry: { type: 'Point', coordinates: [100, 100] },
        properties: { name: 'Old Town' },
      },
    ]),
    authored: fc([
      {
        type: 'Feature',
        id: 'a',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 300],
            [300, 300],
          ],
        },
        properties: { layer: 'street', widthM: 8 },
      },
    ]),
    annotations: fc([
      {
        type: 'Feature',
        id: 'n1',
        geometry: { type: 'Point', coordinates: [50, 50] },
        properties: { kind: 'note', text: 'Deep Ones below', gmOnly: true },
      },
      {
        type: 'Feature',
        id: 'l1',
        geometry: { type: 'Point', coordinates: [60, 80] },
        properties: { kind: 'label', text: 'Harbour', gmOnly: false },
      },
    ]),
  };
}

describe('walls', () => {
  it('merges shared edges and keeps building walls under the cap', () => {
    const buildings = grid(10);
    const frame = { minX: -20, minY: -20, maxX: 200, maxY: 200 };
    const w = buildWalls(buildings, fc([]), frame, { maxSegments: 4000 });
    expect(w.mode).toBe('buildings');
    // 100 squares × 4 edges, all distinct here.
    expect(w.segments.length).toBe(400);
    expect(w.warnings).toEqual([]);
    // Shared edges between adjacent buildings count once.
    const shared = fc([rect(0, 0, 10, 10, {}, 'a'), rect(10, 0, 10, 10, {}, 'b')]) as FeatureCollection<
      Polygon,
      Props
    >;
    expect(buildWalls(shared, fc([]), frame).segments.length).toBe(7);
  });

  it('falls back to solid blocks with a warning above the cap', () => {
    const buildings = grid(40, 8, 2); // 1600 buildings → 6400 segments
    const frame = { minX: -20, minY: -20, maxX: 500, maxY: 500 };
    const blocks = fc([
      rect(-5, -5, 200, 200, {}, 'blk1'),
      rect(200, -5, 200, 200, {}, 'blk2'),
      rect(-5, 200, 400, 200, {}, 'blk3'),
    ]) as FeatureCollection<Polygon, Props>;
    const w = buildWalls(buildings, blocks, frame, { maxSegments: 4000 });
    expect(w.mode).toBe('blocks');
    expect(w.segments.length).toBeLessThanOrEqual(12);
    expect(w.warnings[0]).toMatch(/solid blocks/);
    expect(w.rawCount).toBeGreaterThan(4000);
  });
});

describe('vtt and foundry', () => {
  it('writes a Universal VTT scene in grid units and a Foundry scene in pixels', () => {
    const buildings = grid(3);
    const frame = { minX: 0, minY: 0, maxX: 300, maxY: 150 };
    const walls = buildWalls(buildings, fc([]), frame);
    const vtt = universalVtt({
      frame,
      gridM: 1.5,
      pixelsPerGrid: 100,
      walls,
      name: 'Scene',
      imageBase64: 'AAAA',
    });
    expect(vtt.format).toBe(0.3);
    expect(vtt.resolution.map_size).toEqual({ x: 200, y: 100 });
    expect(vtt.line_of_sight.length).toBe(walls.segments.length);
    // y is flipped: the top of the frame is grid y = 0.
    const top = vtt.line_of_sight.flat().reduce((m, p) => Math.min(m, p.y), Infinity);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(vtt.image).toBe('AAAA');
    const scene = foundryScene({ frame, gridM: 1.5, pixelsPerGrid: 100, walls, name: 'Scene' });
    expect(scene.width).toBe(20000);
    expect(scene.height).toBe(10000);
    expect(scene.walls.length).toBe(walls.segments.length);
    expect(scene.walls[0]!.c.every((v) => Number.isInteger(v))).toBe(true);
    expect(scene.grid.size).toBe(100);
  });
});

describe('svg and geojson', () => {
  it('renders an SVG with every layer, labels and GM notes hidden in player mode', () => {
    const m = model(grid(4));
    const svg = renderSvg(m, atlas, { pxPerM: 2 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1080"');
    for (const cls of [
      'water',
      'rivers',
      'patches',
      'streets',
      'rail',
      'buildings',
      'facilities',
      'labels',
      'annotations',
    ])
      expect(svg).toContain(`class="${cls}"`);
    expect(svg).toContain('High Street');
    expect(svg).toContain('OLD TOWN');
    expect(svg).toContain('Deep Ones below');
    expect(svg).toContain('Harbour');
    const player = renderSvg(m, atlas, { pxPerM: 2, player: true });
    expect(player).not.toContain('Deep Ones below');
    expect(player).toContain('Harbour');
    // Sanborn colours buildings by material.
    const sb = renderSvg(m, sanborn, { pxPerM: 2 });
    expect(sb).toContain(sanborn.buildings!.materials!.brick!);
    expect(sb).toContain(sanborn.buildings!.materials!.timber!);
  });

  it('exports GeoJSON with a declared planar CRS and a layer per feature, and CSV for the directory', () => {
    const m = model(grid(2));
    const gj = exportGeoJson(m, { player: true });
    expect(gj.crs).toEqual({ type: 'name', properties: { name: 'citygen:planar-metres' } });
    expect(gj.features.some((f) => f.properties.layer === 'buildings')).toBe(true);
    expect(gj.features.some((f) => f.properties.layer === 'annotations' && f.properties.gmOnly)).toBe(false);
    expect(gj.features.some((f) => f.properties.layer === 'annotations')).toBe(true);
    const csv = directoryCsv(
      [
        { name: 'The "Crown"', use: 'pub', address: '3 High Street' },
        { name: 'Smith, J', use: 'residential' },
      ],
      ['name', 'use', 'address'],
    );
    expect(csv.split('\n')[0]).toBe('name,use,address');
    expect(csv).toContain('"The ""Crown""",pub,3 High Street');
    expect(csv).toContain('"Smith, J",residential,');
  });
});
