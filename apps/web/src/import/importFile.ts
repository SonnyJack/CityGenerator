import {
  culturePackSchema,
  customFeatureTypeSchema,
  heightmapFromPixels,
  type HeightmapSpec,
} from '@citygen/core';
import { importOsm } from '@citygen/import';
import { useApp } from '../store.js';

/**
 * One entry point for everything the Import button accepts: a .citygen.json
 * document, OpenStreetMap data (.osm XML or Overpass JSON), a culture pack
 * or a custom feature type (JSON), and a PNG heightmap (through a small
 * dialog for the height range).
 */
export type ImportKind = 'document' | 'osm' | 'culturePack' | 'featureType' | 'heightmap' | 'unknown';

export interface ImportReport {
  kind: ImportKind;
  message: string;
  ok: boolean;
}

export function detectKind(name: string, text: string): ImportKind {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(lower)) return 'heightmap';
  const t = text.trimStart();
  if (lower.endsWith('.osm') || t.startsWith('<?xml') || t.startsWith('<osm')) return 'osm';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      if (j.format === 'citygen') return 'document';
      if (Array.isArray(j.elements)) return 'osm';
      if (j.naming && j.conventions) return 'culturePack';
      if (j.footprint && j.parts) return 'featureType';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

/** Import text content; heightmaps go through `importHeightmap` instead. */
export function importText(name: string, text: string): ImportReport {
  const kind = detectKind(name, text);
  const { dispatch, importJson } = useApp.getState();
  try {
    switch (kind) {
      case 'document':
        importJson(text);
        return { kind, ok: true, message: `Opened ${name}` };
      case 'osm': {
        const r = importOsm(text, { idPrefix: `osm-${Date.now().toString(36)}` });
        if (!r.features.length)
          return { kind, ok: false, message: `${name}: no streets, railways, buildings or water found` };
        dispatch({ type: 'authored.add', features: r.features });
        const counts = Object.entries(r.counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ');
        return {
          kind,
          ok: true,
          message: `${name}: ${r.features.length} features (${counts}), centre ${r.centre[0].toFixed(4)}, ${r.centre[1].toFixed(4)}`,
        };
      }
      case 'culturePack': {
        const pack = culturePackSchema.parse(JSON.parse(text));
        const doc = useApp.getState().document;
        const idx = doc.spec.customCulturePacks.findIndex((p) => p.id === pack.id);
        dispatch({
          type: 'spec.patch',
          ops: [
            idx >= 0
              ? { op: 'replace', path: `/customCulturePacks/${idx}`, value: pack }
              : { op: 'add', path: '/customCulturePacks/-', value: pack },
          ],
        });
        return {
          kind,
          ok: true,
          message: `Culture pack “${pack.name}” (${pack.id}) ${idx >= 0 ? 'replaced' : 'added'}; pick it under Culture`,
        };
      }
      case 'featureType': {
        const type = customFeatureTypeSchema.parse(JSON.parse(text));
        const doc = useApp.getState().document;
        const idx = doc.spec.customFeatureTypes.findIndex((t) => t.id === type.id);
        dispatch({
          type: 'spec.patch',
          ops: [
            idx >= 0
              ? { op: 'replace', path: `/customFeatureTypes/${idx}`, value: type }
              : { op: 'add', path: '/customFeatureTypes/-', value: type },
          ],
        });
        return {
          kind,
          ok: true,
          message: `Feature type “${type.name}” (${type.id}) ${idx >= 0 ? 'replaced' : 'added'}; request it from a settlement`,
        };
      }
      case 'heightmap':
        return { kind, ok: false, message: 'Use the heightmap dialog for images' };
      default:
        return {
          kind,
          ok: false,
          message: `${name}: not a CityGenerator document, OSM extract, culture pack or feature type`,
        };
    }
  } catch (e) {
    return { kind, ok: false, message: `${name}: ${(e as Error).message}` };
  }
}

/** Decode an image file to RGBA pixels (top row first). */
export async function imagePixels(
  file: Blob,
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return { width: bitmap.width, height: bitmap.height, rgba: data };
}

/** Put pixels into the document as the imported terrain. */
export function importHeightmap(
  pixels: { width: number; height: number; rgba: ArrayLike<number> },
  options: { minM: number; maxM: number; terrainRgb?: boolean; source?: string },
): ImportReport {
  const { dispatch, document: doc } = useApp.getState();
  const spec: HeightmapSpec = heightmapFromPixels(pixels.rgba, pixels.width, pixels.height, options);
  dispatch({
    type: 'spec.patch',
    ops: [
      {
        op: doc.spec.terrain.importedHeightmap ? 'replace' : 'add',
        path: '/terrain/importedHeightmap',
        value: spec,
      },
    ],
  });
  return {
    kind: 'heightmap',
    ok: true,
    message: `Terrain from ${options.source ?? 'image'}: ${pixels.width} × ${pixels.height}, ${Math.round(spec.minM)} to ${Math.round(spec.maxM)} m`,
  };
}

export function clearHeightmap(): void {
  const { dispatch, document: doc } = useApp.getState();
  if (doc.spec.terrain.importedHeightmap)
    dispatch({ type: 'spec.patch', ops: [{ op: 'remove', path: '/terrain/importedHeightmap' }] });
}

/** Fetch a document (or any importable text) from a URL, e.g. a raw gist. */
export async function importFromUrl(url: string): Promise<ImportReport> {
  const res = await fetch(url);
  if (!res.ok) return { kind: 'unknown', ok: false, message: `${url}: HTTP ${res.status}` };
  return importText(url.split('/').pop() || url, await res.text());
}
