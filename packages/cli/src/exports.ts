import { writeFile } from 'node:fs/promises';
import { directoryCsv, exportGeoJson, exportGltf, renderSvg, type Frame } from '@citygen/export';
import { themeById } from '@citygen/themes';
import type { EngineHost } from './host.js';

export interface ExportSpec {
  frame?: Frame;
  settlement?: string;
  /** Radius around the settlement centre when no frame is given (default its built-up radius). */
  radiusM?: number;
  theme?: string;
  player?: boolean;
  pxPerM?: number;
}

/** Resolve the frame: explicit, or around a settlement (default the largest). */
export async function resolveFrame(host: EngineHost, spec: ExportSpec): Promise<Frame> {
  if (spec.frame) return spec.frame;
  await host.settle();
  const settlements = host.stats?.settlements ?? [];
  const s = spec.settlement ? settlements.find((x) => x.id === spec.settlement) : settlements[0];
  if (!s) throw new Error(spec.settlement ? `no settlement ${spec.settlement}` : 'no settlements');
  const r = spec.radiusM ?? s.radiusM;
  return { minX: s.center[0] - r, minY: s.center[1] - r, maxX: s.center[0] + r, maxY: s.center[1] + r };
}

export type ExportFormat = 'svg' | 'geojson' | 'glb' | 'csv';

/** Write one export; returns a one-line report. */
export async function writeExport(
  host: EngineHost,
  format: ExportFormat,
  path: string,
  spec: ExportSpec,
): Promise<string> {
  await host.settle();
  if (format === 'csv') {
    const { entries } = await host.engine.directory(spec.settlement ?? null, '', 1_000_000);
    const csv = directoryCsv(entries as unknown as Record<string, unknown>[], [
      'id',
      'settlement',
      'name',
      'useLabel',
      'kindLabel',
      'material',
      'floors',
      'address',
      'ward',
    ]);
    await writeFile(path, csv);
    return `${path}: ${entries.length} premises`;
  }
  const frame = await resolveFrame(host, spec);
  const model = await host.engine.exportFrame(frame);
  if (format === 'svg') {
    const svg = renderSvg(model, themeById(spec.theme), {
      pxPerM: spec.pxPerM ?? 1,
      player: spec.player ?? false,
    });
    await writeFile(path, svg);
    return `${path}: SVG of ${Math.round(frame.maxX - frame.minX)} × ${Math.round(frame.maxY - frame.minY)} m`;
  }
  if (format === 'geojson') {
    await writeFile(path, JSON.stringify(exportGeoJson(model, { player: spec.player ?? false })));
    return `${path}: GeoJSON (${model.buildings.features.length} buildings in frame)`;
  }
  const out = exportGltf(model, model.heights ?? null);
  await writeFile(path, out.glb);
  return `${path}: glTF ${out.meshes.map((m) => `${m.name} ${m.triangles} tris`).join(', ')}`;
}
