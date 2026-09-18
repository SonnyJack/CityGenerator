import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createDocument, serializeDocument } from '@citygen/core';
import { executeTool, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type ToolName } from '@citygen/assistant';
import { EngineHost } from './host.js';
import { writeExport, type ExportFormat } from './exports.js';

/**
 * An MCP server exposing the assistant's tools over a document on disk, so
 * any MCP client (Claude Desktop, Claude Code, an IDE) can read and edit a
 * region with the same commands the browser assistant uses.
 */
export interface McpOptions {
  /** Document to open at start; a fresh one otherwise. */
  path?: string;
  /** Save after every mutating tool call. */
  autosave?: boolean;
}

export async function createMcpServer(
  options: McpOptions = {},
): Promise<{ server: McpServer; host: EngineHost }> {
  const host = options.path ? await EngineHost.open(options.path) : new EngineHost();
  const server = new McpServer({ name: 'citygen', version: '0.1.0' });
  const text = (value: unknown) => ({
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
  });

  for (const name of Object.keys(TOOL_SCHEMAS) as ToolName[]) {
    server.registerTool(
      name,
      { description: TOOL_DESCRIPTIONS[name], inputSchema: TOOL_SCHEMAS[name] as never },
      (async (args: unknown) => {
        const outcome = await executeTool(name, args ?? {}, host);
        if (
          !outcome.isError &&
          outcome.historyAfter !== outcome.historyBefore &&
          options.autosave &&
          host.path
        )
          await host.save();
        return {
          content: outcome.content.map((c) =>
            c.type === 'text'
              ? { type: 'text' as const, text: c.text }
              : { type: 'image' as const, data: c.source.data, mimeType: c.source.media_type },
          ),
          ...(outcome.isError ? { isError: true } : {}),
        };
      }) as never,
    );
  }

  server.registerTool(
    'open_document',
    {
      description: 'Open a .citygen.json document from disk and make it the current region.',
      inputSchema: z.object({ path: z.string() }) as never,
    },
    (async ({ path }: { path: string }) => {
      const opened = await EngineHost.open(path);
      host.load(opened.document());
      host.path = path;
      return text({ opened: path, name: host.document().meta.name, seed: host.document().spec.seed });
    }) as never,
  );
  server.registerTool(
    'save_document',
    {
      description: 'Save the current region to disk (to its path, or a new one).',
      inputSchema: z.object({ path: z.string().nullable().optional() }) as never,
    },
    (async ({ path }: { path?: string | null }) =>
      text({ saved: await host.save(path ?? undefined) })) as never,
  );
  server.registerTool(
    'new_document',
    {
      description: 'Start a new region: seed, year, size in km and a name.',
      inputSchema: z.object({
        seed: z.string().nullable().optional(),
        year: z.number().int().min(1100).max(2100).nullable().optional(),
        widthKm: z.number().positive().max(200).nullable().optional(),
        heightKm: z.number().positive().max(200).nullable().optional(),
        name: z.string().nullable().optional(),
      }) as never,
    },
    (async (a: {
      seed?: string | null;
      year?: number | null;
      widthKm?: number | null;
      heightKm?: number | null;
      name?: string | null;
    }) => {
      host.load(
        createDocument({
          now: new Date().toISOString(),
          seed: a.seed ?? `region-${Date.now().toString(36)}`,
          ...(a.year ? { year: a.year } : {}),
          ...(a.widthKm ? { widthM: a.widthKm * 1000 } : {}),
          ...(a.heightKm ? { heightM: a.heightKm * 1000 } : {}),
          ...(a.name ? { name: a.name } : {}),
        }),
      );
      host.path = null;
      return text({ seed: host.document().spec.seed, year: host.document().spec.year });
    }) as never,
  );
  server.registerTool(
    'export_frame',
    {
      description:
        'Export a frame to a file: svg, geojson, glb (3D) or csv (the directory). The frame is [minX, minY, maxX, maxY] in metres, or a settlement id with a radius.',
      inputSchema: z.object({
        format: z.enum(['svg', 'geojson', 'glb', 'csv']),
        path: z.string(),
        frame: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
        settlement: z.string().nullable().optional(),
        radiusM: z.number().positive().nullable().optional(),
        theme: z.string().nullable().optional(),
        player: z.boolean().nullable().optional(),
        pxPerM: z.number().positive().nullable().optional(),
      }) as never,
    },
    (async (a: {
      format: ExportFormat;
      path: string;
      frame?: number[] | null;
      settlement?: string | null;
      radiusM?: number | null;
      theme?: string | null;
      player?: boolean | null;
      pxPerM?: number | null;
    }) =>
      text(
        await writeExport(host, a.format, a.path, {
          ...(a.frame
            ? { frame: { minX: a.frame[0]!, minY: a.frame[1]!, maxX: a.frame[2]!, maxY: a.frame[3]! } }
            : {}),
          ...(a.settlement ? { settlement: a.settlement } : {}),
          ...(a.radiusM ? { radiusM: a.radiusM } : {}),
          ...(a.theme ? { theme: a.theme } : {}),
          ...(a.player ? { player: true } : {}),
          ...(a.pxPerM ? { pxPerM: a.pxPerM } : {}),
        }),
      )) as never,
  );
  server.registerTool(
    'get_document',
    { description: 'The current region as .citygen.json text.', inputSchema: z.object({}) as never },
    (async () => text(serializeDocument(host.document()))) as never,
  );
  return { server, host };
}

export async function serveMcp(
  transport: Transport,
  options: McpOptions = {},
): Promise<{ server: McpServer; host: EngineHost }> {
  const created = await createMcpServer(options);
  await created.server.connect(transport);
  return created;
}
