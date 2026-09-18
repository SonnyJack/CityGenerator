import { describe, expect, it } from 'vitest';
import {
  decodeHeightmap,
  encodeHeightmap,
  heightmapFromPixels,
  importOsm,
  parseOsmXml,
  parseOverpassJson,
} from '../src/index.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  <node id="1" lat="42.0000" lon="-71.0000"/>
  <node id="2" lat="42.0010" lon="-71.0000"/>
  <node id="3" lat="42.0010" lon="-70.9990"><tag k="railway" v="station"/><tag k="name" v="Arkham Central"/></node>
  <node id="4" lat="42.0000" lon="-70.9990"/>
  <node id="5" lat="42.0002" lon="-70.9998"/>
  <node id="6" lat="42.0002" lon="-70.9996"/>
  <node id="7" lat="42.0004" lon="-70.9996"/>
  <node id="8" lat="42.0004" lon="-70.9998"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="High &amp; Main Street"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
  <way id="12"><nd ref="1"/><nd ref="4"/><tag k="railway" v="rail"/></way>
  <way id="13"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="building" v="house"/><tag k="building:levels" v="3"/></way>
  <way id="14"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="natural" v="water"/></way>
  <way id="15"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way>
</osm>`;

describe('OSM import', () => {
  it('parses XML and maps highways, rail, buildings, water and named nodes', () => {
    const data = parseOsmXml(XML);
    expect(data.nodes.size).toBe(8);
    expect(data.ways).toHaveLength(6);
    const r = importOsm(XML);
    expect(r.counts).toEqual({ street: 2, rail: 1, building: 1, water: 1, poi: 1 });
    expect(r.skipped).toBe(1);
    const street = r.features.find((f) => f.id === 'osm-w10')!;
    expect(street.properties).toMatchObject({
      layer: 'street',
      kind: 'artery',
      widthM: 14,
      name: 'High & Main Street',
    });
    const building = r.features.find((f) => f.id === 'osm-w13')!;
    expect(building.geometry.type).toBe('Polygon');
    expect(building.properties).toMatchObject({ layer: 'building', kind: 'house', floors: 3 });
    // The projection is local: roughly 111 m per 0.001° of latitude, centred on the data.
    const [a, b] = (street.geometry as { coordinates: number[][] }).coordinates;
    expect(Math.abs(b![1]! - a![1]!)).toBeCloseTo(111.3, 0);
    expect(Math.abs(r.centre[0] - 42.0005)).toBeLessThan(1e-6);
    expect(r.bboxM[2] - r.bboxM[0]).toBeGreaterThan(80);
    const station = r.features.find((f) => f.id === 'osm-n3')!;
    expect(station.properties).toMatchObject({ layer: 'poi', kind: 'station', name: 'Arkham Central' });
  });
  it('parses Overpass JSON', () => {
    const json = {
      elements: [
        { type: 'node', id: 1, lat: 0, lon: 0 },
        { type: 'node', id: 2, lat: 0.001, lon: 0 },
        { type: 'way', id: 5, nodes: [1, 2], tags: { highway: 'tertiary' } },
      ],
    };
    const r = importOsm(JSON.stringify(json));
    expect(parseOverpassJson(json).ways).toHaveLength(1);
    expect(r.features[0]!.properties).toMatchObject({ layer: 'street', kind: 'collector' });
  });
});

describe('heightmap import', () => {
  it('round-trips heights through 16-bit base64 and reads pixels south row first', () => {
    const w = 4;
    const h = 3;
    const heights = Array.from({ length: w * h }, (_, i) => i * 10 - 20);
    const spec = encodeHeightmap(heights, w, h);
    expect(spec.minM).toBe(-20);
    expect(spec.maxM).toBe(90);
    const back = decodeHeightmap(spec);
    for (let i = 0; i < heights.length; i++) expect(back[i]).toBeCloseTo(heights[i]!, 1);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) rgba.set([y * 100, y * 100, y * 100, 255], (y * w + x) * 4);
    const fromImage = decodeHeightmap(heightmapFromPixels(rgba, w, h, { minM: 0, maxM: 255 }));
    // The top image row (y = 0, dark) becomes the last (north) row.
    expect(fromImage[0]).toBeCloseTo(200, 0);
    expect(fromImage[(h - 1) * w]).toBeCloseTo(0, 0);
    expect(() => encodeHeightmap([1, 2], 2, 2)).toThrow();
  });
});

describe('pack registries', () => {
  it('parses object and bare-array indexes and resolves files against the index URL', async () => {
    const { parseRegistry, fetchRegistry } = await import('../src/index.js');
    const base = 'https://packs.example/dir/index.json';
    const full = parseRegistry(
      JSON.stringify({
        name: 'Example packs',
        description: 'd',
        packs: [
          { file: 'lowlands.json', name: 'Lowlands', kind: 'culturePack', description: 'x', author: 'a' },
          { url: 'https://other.example/cannery.json', name: 'Cannery', kind: 'featureType' },
          { file: 'bad.json', name: 'No kind' },
        ],
        documents: [{ file: '../docs/arkham.citygen.json', name: 'Arkham', seed: 'arkham', year: 1925 }],
      }),
      base,
    );
    expect(full.name).toBe('Example packs');
    expect(full.packs.map((p) => p.url)).toEqual([
      'https://packs.example/dir/lowlands.json',
      'https://other.example/cannery.json',
    ]);
    expect(full.packs[0]!.author).toBe('a');
    expect(full.documents[0]!.url).toBe('https://packs.example/docs/arkham.citygen.json');
    expect(full.documents[0]!.year).toBe(1925);
    const packs = parseRegistry('[{"file":"a.json","name":"A","kind":"culturePack"}]', base);
    expect(packs.name).toBe('packs.example');
    expect(packs.packs).toHaveLength(1);
    expect(packs.documents).toHaveLength(0);
    const docs = parseRegistry('[{"file":"t.citygen.json","name":"T","seed":"t"}]', base, 'Gallery');
    expect(docs.name).toBe('Gallery');
    expect(docs.documents[0]!.seed).toBe('t');
    expect(() => parseRegistry('42', base)).toThrow();
    const fetched = await fetchRegistry(
      base,
      (async () => new Response('{"packs":[]}', { status: 200 })) as unknown as typeof fetch,
    );
    expect(fetched.packs).toEqual([]);
    await expect(
      fetchRegistry(base, (async () => new Response('', { status: 404 })) as unknown as typeof fetch),
    ).rejects.toThrow('404');
  });
});
