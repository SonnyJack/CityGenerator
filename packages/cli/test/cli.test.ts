import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { main, serveMcp } from '../src/index.js';

describe('citygen command line', () => {
  it('creates, generates and exports a region headlessly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'citygen-'));
    const doc = join(dir, 'test.citygen.json');
    const lines: string[] = [];
    const out = (l: string) => lines.push(l);
    await main(
      ['new', '-o', doc, '--seed', 'cli-test', '--width', '6', '--height', '6', '--year', '1890'],
      out,
    );
    expect(lines[0]).toContain('cli-test');
    await main(['generate', doc, '--json'], out);
    const stats = JSON.parse(lines.slice(1).join('\n')) as {
      settlements: { id: string }[];
      era: { year: number };
    };
    expect(stats.era.year).toBe(1890);
    expect(stats.settlements.length).toBeGreaterThan(0);
    lines.length = 0;
    const svg = join(dir, 'town.svg');
    const geo = join(dir, 'town.geojson');
    const glb = join(dir, 'town.glb');
    const csv = join(dir, 'directory.csv');
    await main(
      [
        'export',
        doc,
        '--radius',
        '300',
        '--svg',
        svg,
        '--geojson',
        geo,
        '--glb',
        glb,
        '--csv',
        csv,
        '--theme',
        'ink',
      ],
      out,
    );
    expect(lines).toHaveLength(4);
    expect((await readFile(svg, 'utf8')).startsWith('<svg')).toBe(true);
    expect(JSON.parse(await readFile(geo, 'utf8')).type).toBe('FeatureCollection');
    expect((await stat(glb)).size).toBeGreaterThan(1000);
    expect((await readFile(csv, 'utf8')).split('\n')[0]).toContain('name');
    lines.length = 0;
    await main(['directory', doc, '--limit', '5'], out);
    expect(lines[0]).toContain('id,settlement,name');
    expect(lines.at(-1)).toMatch(/^# 5 of \d+/);
    lines.length = 0;
    await main(['generate', doc, '--year', '1955', '--save'], out);
    expect(JSON.parse(await readFile(doc, 'utf8')).spec.year).toBe(1955);
  });

  it('lists a hosted pack registry and adds a pack to a document', async () => {
    const { createServer } = await import('node:http');
    const { readFile: read } = await import('node:fs/promises');
    const lowlands = await read(
      new URL('../../../apps/web/public/plugins/lowlands.json', import.meta.url),
      'utf8',
    );
    const cannery = await read(
      new URL('../../../apps/web/public/plugins/cannery.json', import.meta.url),
      'utf8',
    );
    const server = createServer((req, res) => {
      const body =
        req.url === '/packs/index.json'
          ? JSON.stringify({
              name: 'Test registry',
              packs: [
                { file: 'lowlands.json', name: 'Lowlands', kind: 'culturePack', description: 'Dutch' },
                { file: 'cannery.json', name: 'Cannery', kind: 'featureType' },
              ],
              documents: [{ file: '../gallery/x.citygen.json', name: 'X', seed: 'x' }],
            })
          : req.url === '/packs/lowlands.json'
            ? lowlands
            : req.url === '/packs/cannery.json'
              ? cannery
              : null;
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(body ?? '');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const index = `http://127.0.0.1:${port}/packs/index.json`;
    try {
      const dir = await mkdtemp(join(tmpdir(), 'citygen-packs-'));
      const doc = join(dir, 'r.citygen.json');
      const lines: string[] = [];
      const out = (l: string) => lines.push(l);
      await main(['new', '-o', doc, '--seed', 'packs', '--width', '4', '--height', '4'], out);
      lines.length = 0;
      await main(['packs', index], out);
      expect(lines[0]).toBe('Test registry');
      expect(lines[1]).toContain(
        `culturePack\tLowlands\thttp://127.0.0.1:${port}/packs/lowlands.json\tDutch`,
      );
      expect(lines[3]).toContain(`document\tX\thttp://127.0.0.1:${port}/gallery/x.citygen.json`);
      lines.length = 0;
      await main(['packs', index, '--doc', doc, '--add', 'Lowlands'], out);
      await main(['packs', index, '--doc', doc, '--add', 'Cannery'], out);
      expect(lines[0]).toContain('added culture pack');
      expect(lines[2]).toContain('added feature type');
      const saved = JSON.parse(await readFile(doc, 'utf8')) as {
        spec: { customCulturePacks: { id: string }[]; customFeatureTypes: { id: string }[] };
      };
      expect(saved.spec.customCulturePacks).toHaveLength(1);
      expect(saved.spec.customFeatureTypes).toHaveLength(1);
      // Adding again replaces rather than duplicates.
      await main(['packs', index, '--doc', doc, '--add', 'Lowlands'], out);
      expect((JSON.parse(await readFile(doc, 'utf8')) as typeof saved).spec.customCulturePacks).toHaveLength(
        1,
      );
      await expect(main(['packs', index, '--doc', doc, '--add', 'Nope'], out)).rejects.toThrow('no pack');
    } finally {
      server.close();
    }
  });

  it('serves the assistant tools over MCP', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { host } = await serveMcp(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_region_summary',
        'set_year',
        'draw',
        'new_document',
        'save_document',
        'export_frame',
      ]),
    );
    const created = await client.callTool({
      name: 'new_document',
      arguments: { seed: 'mcp-test', widthKm: 6, heightKm: 6, year: 1925 },
    });
    expect(JSON.parse((created.content as { text: string }[])[0]!.text).seed).toBe('mcp-test');
    const year = await client.callTool({ name: 'set_year', arguments: { year: 1890 } });
    expect(year.isError).toBeFalsy();
    expect(host.document().spec.year).toBe(1890);
    const summary = await client.callTool({ name: 'get_region_summary', arguments: {} });
    const text = (summary.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text).year).toBe(1890);
    expect(JSON.parse(text).settlements.length).toBeGreaterThan(0);
    const bad = await client.callTool({ name: 'set_year', arguments: { year: 'soon' } });
    expect(bad.isError).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), 'citygen-mcp-'));
    const saved = await client.callTool({
      name: 'save_document',
      arguments: { path: join(dir, 'r.citygen.json') },
    });
    expect((saved.content as { text: string }[])[0]!.text).toContain('r.citygen.json');
    const exported = await client.callTool({
      name: 'export_frame',
      arguments: { format: 'svg', path: join(dir, 'r.svg'), radiusM: 200 },
    });
    expect((exported.content as { text: string }[])[0]!.text).toContain('SVG');
    await client.close();
  });
});

describe('citygen import', () => {
  it('imports OSM data and a PNG heightmap into a document', async () => {
    const { encodePng } = await import('@citygen/tiles');
    const { writeFile } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'citygen-import-'));
    const doc = join(dir, 'r.citygen.json');
    const lines: string[] = [];
    const out = (l: string) => lines.push(l);
    await main(['new', '-o', doc, '--seed', 'imp', '--width', '4', '--height', '4'], out);
    const osm = join(dir, 'town.osm');
    await writeFile(
      osm,
      `<osm><node id="1" lat="42" lon="-71"/><node id="2" lat="42.002" lon="-71"/><node id="3" lat="42.002" lon="-70.998"/>
       <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Main Street"/></way>
       <way id="2"><nd ref="2"/><nd ref="3"/><tag k="railway" v="rail"/></way></osm>`,
    );
    // A 16 × 16 grey ramp: dark in the north-west, bright in the south-east.
    const w = 16;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        rgba.set(
          [
            Math.round(((x + y) / 30) * 255),
            Math.round(((x + y) / 30) * 255),
            Math.round(((x + y) / 30) * 255),
            255,
          ],
          (y * w + x) * 4,
        );
    const png = join(dir, 'h.png');
    await writeFile(png, await encodePng(w, w, rgba));
    await main(['import', doc, '--osm', osm, '--heightmap', png, '--min', '-50', '--max', '300'], out);
    expect(lines[1]).toContain('2 features');
    expect(lines[2]).toContain('16 × 16 heights');
    const saved = JSON.parse(await readFile(doc, 'utf8')) as {
      authored: { features: { properties: { layer: string } }[] };
      spec: { terrain: { importedHeightmap: { width: number; minM: number } } };
    };
    expect(saved.authored.features.map((f) => f.properties.layer).sort()).toEqual(['rail', 'street']);
    expect(saved.spec.terrain.importedHeightmap.width).toBe(16);
    expect(saved.spec.terrain.importedHeightmap.minM).toBe(-50);
    // The engine uses the imported heights: the south-east corner is higher than the north-west.
    lines.length = 0;
    await main(['generate', doc, '--json'], out);
    const stats = JSON.parse(lines.join('\n')) as { terrain: { maxM: number; minM: number } };
    expect(stats.terrain.maxM).toBeGreaterThan(150);
    expect(stats.terrain.minM).toBeLessThan(0);
  });
});
