import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { createDocument, serializeDocument } from '@citygen/core';
import { EngineHost } from './host.js';
import { writeExport, type ExportFormat } from './exports.js';

export { EngineHost } from './host.js';
export { writeExport, resolveFrame, type ExportSpec, type ExportFormat } from './exports.js';
export { createMcpServer, serveMcp, type McpOptions } from './mcp.js';

function parseFrame(s: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const v = s.split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)))
    throw new Error('frame must be minX,minY,maxX,maxY in metres');
  return { minX: v[0]!, minY: v[1]!, maxX: v[2]!, maxY: v[3]! };
}

/** Build the command line; `out` receives what the commands print (stdout by default). */
export function buildCli(out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Command {
  const program = new Command('citygen')
    .description('Procedural regions for tabletop maps, headless.')
    .exitOverride();
  program.configureOutput({ writeOut: (s) => out(s.trimEnd()), writeErr: (s) => out(s.trimEnd()) });

  program
    .command('new')
    .description('Write a new document')
    .requiredOption('-o, --out <file>', 'document path (.citygen.json)')
    .option('--seed <seed>', 'seed (default: a random one)')
    .option('--year <year>', 'year', (v) => Number(v), 1925)
    .option('--width <km>', 'width in km', (v) => Number(v), 20)
    .option('--height <km>', 'height in km', (v) => Number(v), 20)
    .option('--name <name>', 'document name', 'Untitled region')
    .action(
      async (o: {
        out: string;
        seed?: string;
        year: number;
        width: number;
        height: number;
        name: string;
      }) => {
        const seed = o.seed ?? `region-${Date.now().toString(36)}`;
        const doc = createDocument({
          now: new Date().toISOString(),
          seed,
          year: o.year,
          widthM: o.width * 1000,
          heightM: o.height * 1000,
          name: o.name,
        });
        await writeFile(o.out, serializeDocument(doc));
        out(`${o.out}: seed ${seed}, ${o.width} × ${o.height} km, ${o.year}`);
      },
    );

  program
    .command('generate <doc>')
    .description('Run the pipeline and print the region statistics')
    .option('--year <year>', 'override the year (and save it with --save)', (v) => Number(v))
    .option('--save', 'save the document after applying --year')
    .option('--json', 'print the full statistics as JSON')
    .action(async (path: string, o: { year?: number; save?: boolean; json?: boolean }) => {
      const host = await EngineHost.open(path);
      if (o.year) host.dispatch({ type: 'year.set', year: o.year });
      await host.settle();
      const s = host.stats!;
      if (o.json) out(JSON.stringify(s, null, 2));
      else {
        out(
          `${s.regionName} (${host.document().spec.seed}) in ${s.era.year} · ${s.era.name} · ${(s.totalMs / 1000).toFixed(1)} s`,
        );
        for (const t of s.settlements)
          out(
            `  ${t.id}: ${t.name ?? ''} ${t.kind} pop ${t.population} blocks ${t.blocks}${t.walled ? ' walled' : ''}`,
          );
        out(
          `  facilities ${s.facilities.placed} placed, ${s.facilities.failed} failed · rail ${s.rail.stations} stations ${Math.round(s.rail.trackKm)} km`,
        );
      }
      if (o.save) out(`saved ${await host.save()}`);
    });

  program
    .command('export <doc>')
    .description('Export a frame as SVG, GeoJSON, glTF, or the directory as CSV')
    .option('--frame <minX,minY,maxX,maxY>', 'frame in metres')
    .option('--settlement <id>', 'centre the frame on a settlement (default: the largest)')
    .option('--radius <m>', 'half-size of the frame around the settlement', (v) => Number(v))
    .option('--theme <id>', 'theme for SVG', 'atlas')
    .option('--player', 'player version (no GM notes)')
    .option('--px-per-m <n>', 'SVG scale', (v) => Number(v), 1)
    .option('--svg <file>')
    .option('--geojson <file>')
    .option('--glb <file>')
    .option('--csv <file>')
    .action(
      async (
        path: string,
        o: {
          frame?: string;
          settlement?: string;
          radius?: number;
          theme: string;
          player?: boolean;
          pxPerM: number;
          svg?: string;
          geojson?: string;
          glb?: string;
          csv?: string;
        },
      ) => {
        const host = await EngineHost.open(path);
        const spec = {
          ...(o.frame ? { frame: parseFrame(o.frame) } : {}),
          ...(o.settlement ? { settlement: o.settlement } : {}),
          ...(o.radius ? { radiusM: o.radius } : {}),
          theme: o.theme,
          player: !!o.player,
          pxPerM: o.pxPerM,
        };
        const jobs: [ExportFormat, string | undefined][] = [
          ['svg', o.svg],
          ['geojson', o.geojson],
          ['glb', o.glb],
          ['csv', o.csv],
        ];
        let n = 0;
        for (const [format, file] of jobs) {
          if (!file) continue;
          out(await writeExport(host, format, file, spec));
          n++;
        }
        if (!n) out('nothing to export: pass --svg, --geojson, --glb or --csv');
      },
    );

  program
    .command('directory <doc>')
    .description('Print the business and resident directory as CSV')
    .option('--settlement <id>')
    .option('--query <text>', 'filter', '')
    .option('--limit <n>', 'rows', (v) => Number(v), 200)
    .action(async (path: string, o: { settlement?: string; query: string; limit: number }) => {
      const host = await EngineHost.open(path);
      await host.settle();
      const { total, entries } = await host.engine.directory(o.settlement ?? null, o.query, o.limit);
      out('id,settlement,name,use,kind,material,floors,address,ward');
      for (const e of entries)
        out(
          [e.id, e.settlement, e.name, e.useLabel, e.kindLabel, e.material, e.floors, e.address ?? '', e.ward]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        );
      out(`# ${entries.length} of ${total}`);
    });

  program
    .command('import <doc>')
    .description('Import OpenStreetMap data as authored features, or a PNG heightmap as the terrain')
    .option('--osm <file>', '.osm XML or Overpass JSON')
    .option('--no-buildings', 'skip OSM buildings')
    .option('--heightmap <file>', 'grey or Terrain-RGB PNG')
    .option('--min <m>', 'height of black (grey PNGs)', (v) => Number(v), 0)
    .option('--max <m>', 'height of white (grey PNGs)', (v) => Number(v), 500)
    .option('--terrain-rgb', 'decode Mapbox Terrain-RGB instead of grey')
    .option('-o, --out <file>', 'write to another document')
    .action(
      async (
        path: string,
        o: {
          osm?: string;
          buildings: boolean;
          heightmap?: string;
          min: number;
          max: number;
          terrainRgb?: boolean;
          out?: string;
        },
      ) => {
        const { readFile } = await import('node:fs/promises');
        const host = await EngineHost.open(path);
        if (o.osm) {
          const { importOsm } = await import('@citygen/import');
          const r = importOsm(await readFile(o.osm, 'utf8'), { buildings: o.buildings });
          if (r.features.length) host.dispatch({ type: 'authored.add', features: r.features });
          out(
            `${o.osm}: ${r.features.length} features (${Object.entries(r.counts)
              .map(([k, v]) => `${k} ${v}`)
              .join(
                ', ',
              )}), ${r.skipped} skipped; centre ${r.centre[0].toFixed(5)}, ${r.centre[1].toFixed(5)}`,
          );
        }
        if (o.heightmap) {
          const { decodePng } = await import('./png.js');
          const { heightmapFromPixels, encodeHeightmap } = await import('@citygen/core');
          const png = decodePng(new Uint8Array(await readFile(o.heightmap)));
          let spec;
          if (png.grey16 && !o.terrainRgb) {
            const heights = new Float32Array(png.width * png.height);
            for (let y = 0; y < png.height; y++)
              for (let x = 0; x < png.width; x++)
                heights[(png.height - 1 - y) * png.width + x] =
                  o.min + (png.grey16[y * png.width + x]! / 65535) * (o.max - o.min);
            spec = encodeHeightmap(heights, png.width, png.height, {
              minM: o.min,
              maxM: o.max,
              source: o.heightmap,
            });
          } else
            spec = heightmapFromPixels(png.rgba, png.width, png.height, {
              minM: o.min,
              maxM: o.max,
              terrainRgb: !!o.terrainRgb,
              source: o.heightmap,
            });
          host.dispatch({
            type: 'spec.patch',
            ops: [{ op: 'add', path: '/terrain/importedHeightmap', value: spec }],
          });
          out(`${o.heightmap}: ${png.width} × ${png.height} heights, ${spec.minM} to ${spec.maxM} m`);
        }
        out(`saved ${await host.save(o.out ?? path)}`);
      },
    );

  program
    .command('interior <doc>')
    .description('Floor plans of a building: rooms as text, an SVG per floor, or a Universal VTT scene')
    .requiredOption(
      '--building <id>',
      'building id (see `directory`) or facility part id (see `find_features` over MCP)',
    )
    .option('--floor <n>', 'floor index, 0 = ground (default: all for SVG, 0 for VTT)', (v) => Number(v))
    .option('--svg <file>', 'SVG path; with several floors, -1, -2… is inserted before the extension')
    .option('--uvtt <file>', 'Universal VTT path (walls and doors; no image without a browser)')
    .option('--px-per-m <n>', 'SVG scale', (v) => Number(v), 40)
    .action(
      async (
        path: string,
        o: { building: string; floor?: number; svg?: string; uvtt?: string; pxPerM: number },
      ) => {
        const host = await EngineHost.open(path);
        const plan = await host.interior(o.building);
        if (!plan) throw new Error(`no generated building or facility part ${o.building}`);
        const { interiorSvg, interiorVtt } = await import('@citygen/export');
        const { writeFile } = await import('node:fs/promises');
        const floors = o.floor !== undefined ? plan.floors.filter((f) => f.floor === o.floor) : plan.floors;
        for (const f of floors) {
          out(
            `${f.name}: ${f.rooms.map((r) => `${r.name} (${r.areaM2} m²)`).join(', ')} · ${f.doors.length} doors, ${f.windows.length} windows`,
          );
          if (o.svg) {
            const file = floors.length > 1 ? o.svg.replace(/(\.svg)?$/i, `-${f.floor + 1}$1`) : o.svg;
            await writeFile(file, interiorSvg(plan, f.floor, { pxPerM: o.pxPerM }));
            out(`  ${file}`);
          }
        }
        if (o.uvtt) {
          const floor = o.floor ?? 0;
          await writeFile(
            o.uvtt,
            JSON.stringify(interiorVtt(plan, floor, { name: `${o.building} floor ${floor + 1}` })),
          );
          out(`${o.uvtt}: walls and doors of floor ${floor + 1} (add the SVG as the image in your VTT)`);
        }
      },
    );

  program
    .command('packs <index>')
    .description('List a pack registry (a hosted index.json), or add one of its packs to a document')
    .option('--doc <file>', 'document to add the pack to')
    .option('--add <name>', 'pack name (or URL) from the registry to add; needs --doc')
    .option('-o, --out <file>', 'write to another document')
    .action(async (index: string, o: { doc?: string; add?: string; out?: string }) => {
      const { fetchRegistry } = await import('@citygen/import');
      const reg = await fetchRegistry(index);
      if (!o.add) {
        out(`${reg.name}${reg.description ? ` — ${reg.description}` : ''}`);
        for (const p of reg.packs)
          out(`${p.kind}\t${p.name}\t${p.url}${p.description ? `\t${p.description}` : ''}`);
        for (const d of reg.documents)
          out(`document\t${d.name}\t${d.url}${d.description ? `\t${d.description}` : ''}`);
        if (!reg.packs.length && !reg.documents.length) out('(empty registry)');
        return;
      }
      if (!o.doc) throw new Error('--add needs --doc');
      const pack = reg.packs.find((p) => p.name === o.add || p.url === o.add);
      if (!pack) throw new Error(`no pack "${o.add}" in ${reg.name}`);
      const res = await fetch(pack.url);
      if (!res.ok) throw new Error(`${pack.url}: HTTP ${res.status}`);
      const host = await EngineHost.open(o.doc);
      const { culturePackSchema, customFeatureTypeSchema } = await import('@citygen/core');
      const json: unknown = JSON.parse(await res.text());
      const doc = host.document();
      if (pack.kind === 'culturePack') {
        const parsed = culturePackSchema.parse(json);
        const idx = doc.spec.customCulturePacks.findIndex((p) => p.id === parsed.id);
        host.dispatch({
          type: 'spec.patch',
          ops: [
            idx >= 0
              ? { op: 'replace', path: `/customCulturePacks/${idx}`, value: parsed }
              : { op: 'add', path: '/customCulturePacks/-', value: parsed },
          ],
        });
        out(`added culture pack ${parsed.id} (${parsed.name})`);
      } else {
        const parsed = customFeatureTypeSchema.parse(json);
        const idx = doc.spec.customFeatureTypes.findIndex((t) => t.id === parsed.id);
        host.dispatch({
          type: 'spec.patch',
          ops: [
            idx >= 0
              ? { op: 'replace', path: `/customFeatureTypes/${idx}`, value: parsed }
              : { op: 'add', path: '/customFeatureTypes/-', value: parsed },
          ],
        });
        out(`added feature type ${parsed.id} (${parsed.name})`);
      }
      out(`saved ${await host.save(o.out ?? o.doc)}`);
    });

  program
    .command('mcp')
    .description('Serve the assistant tools over MCP on stdio')
    .option('--doc <file>', 'document to open')
    .option('--autosave', 'save after every change')
    .action(async (o: { doc?: string; autosave?: boolean }) => {
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      await (
        await import('./mcp.js')
      ).serveMcp(new StdioServerTransport(), {
        ...(o.doc ? { path: o.doc } : {}),
        ...(o.autosave ? { autosave: true } : {}),
      });
      process.stderr.write(`citygen MCP server ready${o.doc ? ` on ${o.doc}` : ''}\n`);
    });

  return program;
}

export async function main(argv: string[], out?: (line: string) => void): Promise<void> {
  await buildCli(out).parseAsync(argv, { from: 'user' });
}
