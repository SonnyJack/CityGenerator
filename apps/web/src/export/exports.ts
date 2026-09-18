import { Map as MapLibreMap } from 'maplibre-gl';
import { metersToLonLat } from '@citygen/core';
import { compileStyle, themeById, type LayerGroup } from '@citygen/themes';
import {
  buildWalls,
  directoryCsv,
  exportGeoJson,
  foundryScene,
  renderSvg,
  universalVtt,
  type ExportModel,
  type Frame,
} from '@citygen/export';
import { engine } from '../engine/client.js';
import { useApp } from '../store.js';
import { ANNOTATION_SOURCE, AUTHORED_SOURCE, OVERLAY_SOURCE } from '../components/editorMap.js';
import { GLYPHS_URL } from '../components/MapView.js';

/**
 * Export pipeline used by the export panel and the test API: a frame in
 * metres becomes SVG, GeoJSON, PNG (rendered by a hidden MapLibre map),
 * Universal VTT or a Foundry scene, with a player option that hides GM notes.
 */
export interface ExportRequest {
  frame: Frame;
  /** Pixels per metre for PNG and SVG. */
  pxPerM: number;
  player: boolean;
  /** Metres per grid square for VTT formats. */
  gridM: number;
  pixelsPerGrid: number;
  name: string;
  themeId?: string;
}

export const VTT_PRESETS: {
  id: string;
  label: string;
  pixelsPerGrid: number;
  gridM: number;
  note: string;
}[] = [
  {
    id: 'foundry',
    label: 'Foundry VTT (100 px / 5 ft)',
    pixelsPerGrid: 100,
    gridM: 1.5,
    note: 'Standard Foundry scene scale',
  },
  { id: 'roll20', label: 'Roll20 (70 px / 5 ft)', pixelsPerGrid: 70, gridM: 1.5, note: 'Roll20 page units' },
  {
    id: 'handout',
    label: 'Handout (300 dpi, 1:2500)',
    pixelsPerGrid: 18,
    gridM: 1.5,
    note: 'Print handout at 300 dpi',
  },
];

export function currentViewFrame(): Frame | null {
  const map = window.__citygenMap;
  if (!map) return null;
  const b = map.getBounds();
  const sw = [b.getWest() * 111319.490793, b.getSouth() * 111319.490793];
  const ne = [b.getEast() * 111319.490793, b.getNorth() * 111319.490793];
  return { minX: sw[0]!, minY: sw[1]!, maxX: ne[0]!, maxY: ne[1]! };
}

/** Frames from the document's handout-frame annotations. */
export function handoutFrames(): { id: string; text: string; frame: Frame }[] {
  return useApp
    .getState()
    .document.annotations.filter((a) => a.kind === 'handoutFrame' && a.geometry.type === 'Polygon')
    .map((a) => {
      const ring = (a.geometry as { coordinates: number[][][] }).coordinates[0]!;
      const xs = ring.map((p) => p[0]!);
      const ys = ring.map((p) => p[1]!);
      return {
        id: a.id,
        text: a.text,
        frame: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      };
    });
}

/**
 * The worker's copy of the document is refreshed on generation, but
 * annotations and authored features can change without regenerating, so the
 * export model takes them from the live document.
 */
export async function frameModel(frame: Frame): Promise<ExportModel> {
  const model = await engine().exportFrame(frame);
  const doc = useApp.getState().document;
  return {
    ...model,
    authored: { type: 'FeatureCollection', features: doc.authored.features as never },
    annotations: {
      type: 'FeatureCollection',
      features: doc.annotations.map((a) => ({
        type: 'Feature' as const,
        id: a.id,
        geometry: a.geometry as never,
        properties: { kind: a.kind, text: a.text, gmOnly: a.gmOnly },
      })),
    },
  };
}

export async function exportSvg(req: ExportRequest): Promise<string> {
  const model = await frameModel(req.frame);
  return renderSvg(model, themeById(req.themeId ?? useApp.getState().document.ui?.theme), {
    pxPerM: req.pxPerM,
    player: req.player,
  });
}

export async function exportGeoJsonText(req: ExportRequest): Promise<string> {
  const model = await frameModel(req.frame);
  return JSON.stringify(exportGeoJson(model, { player: req.player }));
}

export async function exportWalls(req: ExportRequest, maxSegments = 4000) {
  const model = await engine().exportFrame(req.frame);
  return buildWalls(model.buildings, model.blocks, req.frame, { maxSegments });
}

/** Render the frame with a hidden map. Resolves to a PNG data URL; size is capped at 8192 px. */
export async function exportPng(
  req: ExportRequest,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const doc = useApp.getState().document;
  const w = req.frame.maxX - req.frame.minX;
  const h = req.frame.maxY - req.frame.minY;
  const scale = Math.min(req.pxPerM, 8192 / Math.max(w, h));
  const width = Math.max(64, Math.round(w * scale));
  const height = Math.max(64, Math.round(h * scale));
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(container);
  const layers = { ...(doc.ui?.layers ?? {}) } as Partial<Record<LayerGroup, boolean>>;
  const style = compileStyle(themeById(req.themeId ?? doc.ui?.theme), {
    sourceId: 'citygen',
    tileUrl: `citygen://tiles/{z}/{x}/{y}?v=${useApp.getState().tileVersion}`,
    demSourceId: 'citygen-dem',
    demTileUrl: `citygen://dem/{z}/{x}/{y}?v=${useApp.getState().tileVersion}`,
    layers,
    glyphs: GLYPHS_URL,
    player: req.player,
    editor: {
      authoredSourceId: AUTHORED_SOURCE,
      overlaySourceId: OVERLAY_SOURCE,
      annotationSourceId: ANNOTATION_SOURCE,
    },
  });
  const map = new MapLibreMap({
    container,
    style,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false },
    fadeDuration: 0,
    pixelRatio: 1,
  });
  try {
    await new Promise<void>((resolve) => map.once('load', () => resolve()));
    // Authored features and annotations from the live document.
    const live = window.__citygenMap;
    for (const id of [AUTHORED_SOURCE, ANNOTATION_SOURCE]) {
      const src = live?.getSource(id) as { _data?: unknown } | undefined;
      const data = src?._data;
      if (data) (map.getSource(id) as { setData(d: unknown): void } | undefined)?.setData(data);
    }
    const [w0, s0] = metersToLonLat([req.frame.minX, req.frame.minY]);
    const [e0, n0] = metersToLonLat([req.frame.maxX, req.frame.maxY]);
    map.fitBounds([w0, s0, e0, n0], { padding: 0, duration: 0 });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (map.loaded() && map.areTilesLoaded()) resolve();
        else map.once('idle', check);
      };
      map.once('idle', check);
    });
    // One more frame so symbols settle.
    await new Promise<void>((resolve) => {
      map.once('render', () => resolve());
      map.triggerRepaint();
    });
    const dataUrl = map.getCanvas().toDataURL('image/png');
    return { dataUrl, width, height };
  } finally {
    map.remove();
    container.remove();
  }
}

export async function exportUniversalVtt(
  req: ExportRequest,
): Promise<{ json: string; warnings: string[]; segments: number; mode: string }> {
  const walls = await exportWalls(req);
  const png = await exportPng({ ...req, pxPerM: req.pixelsPerGrid / req.gridM });
  const vtt = universalVtt({
    frame: req.frame,
    gridM: req.gridM,
    pixelsPerGrid: req.pixelsPerGrid,
    walls,
    name: req.name,
    imageBase64: png.dataUrl.split(',')[1] ?? '',
  });
  return {
    json: JSON.stringify(vtt),
    warnings: walls.warnings,
    segments: walls.segments.length,
    mode: walls.mode,
  };
}

export async function exportFoundry(
  req: ExportRequest,
): Promise<{ json: string; warnings: string[]; segments: number; mode: string }> {
  const walls = await exportWalls(req);
  const scene = foundryScene({
    frame: req.frame,
    gridM: req.gridM,
    pixelsPerGrid: req.pixelsPerGrid,
    walls,
    name: req.name,
    imageSrc: `${slug(req.name)}.png`,
  });
  return {
    json: JSON.stringify(scene),
    warnings: walls.warnings,
    segments: walls.segments.length,
    mode: walls.mode,
  };
}

export async function exportDirectoryCsv(settlement: string | null): Promise<string> {
  const { entries } = await engine().directory(settlement, '', 100_000);
  return directoryCsv(entries as unknown as Record<string, unknown>[], [
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
}

export function slug(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

export function downloadText(text: string, filename: string, type = 'text/plain'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
