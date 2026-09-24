import {
  Marker,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import {
  METERS_PER_DEGREE,
  geometryToLonLat,
  lonLatToMeters,
  metersToLonLat,
  type MapDocument,
} from '@citygen/core';
import { strokePolygon, type Modifiers, type ToolId } from '@citygen/editor';
import { tools, useApp } from '../store.js';

export const AUTHORED_SOURCE = 'authored';
export const OVERLAY_SOURCE = 'editor';
export const ANNOTATION_SOURCE = 'annotations';

const SHORTCUTS: Record<string, ToolId> = {
  h: 'navigate',
  v: 'select',
  s: 'lasso',
  l: 'line',
  p: 'polygon',
  r: 'rectangle',
  o: 'point',
  f: 'facility',
  b: 'brush',
  n: 'annotate',
};

type XY = [number, number];
type Fc = FeatureCollection<Geometry, Record<string, unknown>>;

/** Metres per screen pixel at the map's current zoom (512 px world tiles, synthetic CRS). */
function metresPerPixel(map: MapLibreMap): number {
  return (METERS_PER_DEGREE * 360) / (512 * 2 ** map.getZoom());
}

function toXY(e: MapMouseEvent | MapTouchEvent): XY {
  return lonLatToMeters([e.lngLat.lng, e.lngLat.lat]);
}

function mods(e: MapMouseEvent | MapTouchEvent): Modifiers {
  const o = e.originalEvent as MouseEvent | TouchEvent;
  return { shift: o.shiftKey, alt: o.altKey, ctrl: o.ctrlKey || o.metaKey };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function circle(c: XY, r: number): Geometry {
  return { type: 'Polygon', coordinates: [strokePolygon([c], r).concat([strokePolygon([c], r)[0]!])] };
}

/** The triangle at the tip of an arrow annotation, `sizeM` long, on its last segment. */
function arrowHead(pts: XY[], sizeM: number): XY[] | null {
  if (pts.length < 2) return null;
  const tip = pts[pts.length - 1]!;
  const back = pts[pts.length - 2]!;
  const ang = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
  const wing = 0.42;
  const a: XY = [tip[0] - Math.cos(ang - wing) * sizeM, tip[1] - Math.sin(ang - wing) * sizeM];
  const b: XY = [tip[0] - Math.cos(ang + wing) * sizeM, tip[1] - Math.sin(ang + wing) * sizeM];
  return [tip, a, b, tip];
}

/**
 * Connects the map to the editor: routes pointer and keyboard events to the tool
 * controller, keeps the authored/overlay/annotation GeoJSON sources in sync with
 * the document and renders text annotations as DOM markers.
 */
export function attachEditor(map: MapLibreMap): () => void {
  const markers = new Map<
    string,
    { marker: Marker; el: HTMLDivElement; text: string; kind: string; selected: boolean }
  >();
  let hover: Feature<Geometry, Record<string, unknown>> | null = null;
  let downAt: { x: number; y: number } | null = null;
  let lastCursor: XY | null = null;

  const setData = (id: string, data: Fc) => {
    const src = map.getSource(id) as GeoJSONSource | undefined;
    src?.setData(data);
  };

  function refresh() {
    const s = useApp.getState();
    const doc = s.document;
    const selected = new Set(s.selection);
    const authored: Fc = {
      type: 'FeatureCollection',
      features: doc.authored.features.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: geometryToLonLat(tools.previewGeometry(f.id) ?? f.geometry),
        properties: { ...f.properties, id: f.id },
      })),
    };
    setData(AUTHORED_SOURCE, authored);

    const overlay: Fc['features'] = [];
    for (const f of doc.authored.features) {
      if (!selected.has(f.id)) continue;
      overlay.push({
        type: 'Feature',
        geometry: geometryToLonLat(tools.previewGeometry(f.id) ?? f.geometry),
        properties: { role: 'selection' },
      });
    }
    if (s.tool === 'select') {
      for (const h of tools.handles()) {
        overlay.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: metersToLonLat(h.p) },
          properties: { role: 'handle' },
        });
      }
    }
    if (tools.draft.geometry)
      overlay.push({
        type: 'Feature',
        geometry: geometryToLonLat(tools.draft.geometry),
        properties: { role: 'draft' },
      });
    // Alignment guides: a long line on the axis that lined up, clipped to the pair of boxes.
    for (const g of tools.draft.guides) {
      const pad = 40;
      const a: [number, number] = g.axis === 'x' ? [g.value, g.from - pad] : [g.from - pad, g.value];
      const b: [number, number] = g.axis === 'x' ? [g.value, g.to + pad] : [g.to + pad, g.value];
      overlay.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [metersToLonLat(a), metersToLonLat(b)] },
        properties: { role: 'guide' },
      });
    }
    if (tools.draft.brushRadiusM && (tools.draft.cursor ?? lastCursor)) {
      overlay.push({
        type: 'Feature',
        geometry: geometryToLonLat(circle(tools.draft.cursor ?? lastCursor!, tools.draft.brushRadiusM)),
        properties: { role: 'brush' },
      });
    }
    if (hover && !selected.has(String(hover.id))) overlay.push({ ...hover, properties: { role: 'hover' } });
    if (s.selectedAnnotation) {
      const a = doc.annotations.find((x) => x.id === s.selectedAnnotation);
      if (a && a.geometry.type !== 'Point')
        overlay.push({
          type: 'Feature',
          geometry: geometryToLonLat(a.geometry),
          properties: { role: 'selection' },
        });
    }
    setData(OVERLAY_SOURCE, { type: 'FeatureCollection', features: overlay });

    const annotations: Fc['features'] = [];
    for (const a of doc.annotations) {
      if (a.geometry.type === 'Point') continue;
      annotations.push({
        type: 'Feature',
        id: a.id,
        geometry: geometryToLonLat(a.geometry),
        properties: { kind: a.kind, text: a.text, id: a.id },
      });
      // An arrow's head is a small triangle on its last segment, drawn as its own polygon.
      if (a.kind === 'arrow' && a.geometry.type === 'LineString') {
        const pts = a.geometry.coordinates as [number, number][];
        const head = arrowHead(pts, 26 * metresPerPixel(map));
        if (head)
          annotations.push({
            type: 'Feature',
            id: `${a.id}-head`,
            geometry: geometryToLonLat({ type: 'Polygon', coordinates: [head] }),
            properties: { kind: 'arrowhead', id: a.id },
          });
      }
    }
    setData(ANNOTATION_SOURCE, { type: 'FeatureCollection', features: annotations });
    syncMarkers(doc, s.selectedAnnotation, doc.ui?.layers?.annotations !== false);
  }

  function syncMarkers(doc: MapDocument, selectedId: string | undefined, visible: boolean) {
    const seen = new Set<string>();
    for (const a of doc.annotations) {
      const pos: XY | null =
        a.geometry.type === 'Point'
          ? [a.geometry.coordinates[0]!, a.geometry.coordinates[1]!]
          : a.kind === 'handoutFrame' && a.geometry.type === 'Polygon'
            ? [a.geometry.coordinates[0]![0]![0]!, a.geometry.coordinates[0]![0]![1]!]
            : null;
      if (!pos || !visible) continue;
      seen.add(a.id);
      let m = markers.get(a.id);
      const selected = a.id === selectedId;
      if (!m) {
        const el = document.createElement('div');
        el.dataset.testid = 'annotation-marker';
        el.dataset.annotationId = a.id;
        const marker = new Marker({
          element: el,
          draggable: a.geometry.type === 'Point',
          anchor: a.kind === 'handoutFrame' ? 'bottom-left' : 'center',
        });
        marker.setLngLat(metersToLonLat(pos)).addTo(map);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          useApp.getState().selectAnnotation(a.id);
        });
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          useApp.getState().dispatch({
            type: 'annotation.update',
            id: a.id,
            patch: { geometry: { type: 'Point', coordinates: lonLatToMeters([ll.lng, ll.lat]) } },
          });
        });
        m = { marker, el, text: '', kind: '', selected: !selected };
        markers.set(a.id, m);
      } else {
        const ll = m.marker.getLngLat();
        const cur = lonLatToMeters([ll.lng, ll.lat]);
        if (Math.hypot(cur[0] - pos[0], cur[1] - pos[1]) > 0.01) m.marker.setLngLat(metersToLonLat(pos));
      }
      if (m.text !== a.text || m.kind !== a.kind || m.selected !== selected) {
        m.text = a.text;
        m.kind = a.kind;
        m.selected = selected;
        // Keep MapLibre's own marker class; only our annotation classes change.
        for (const c of [...m.el.classList])
          if (c.startsWith('citygen-') || c.startsWith('is-')) m.el.classList.remove(c);
        m.el.classList.add('citygen-annotation', `citygen-annotation-${a.kind}`);
        if (selected) m.el.classList.add('is-selected');
        if (a.gmOnly) m.el.classList.add('is-gm');
        m.el.textContent = a.kind === 'marker' ? '' : a.text;
        m.el.title = a.gmOnly ? `GM only: ${a.text}` : a.text;
      }
    }
    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        m.marker.remove();
        markers.delete(id);
      }
    }
  }

  function applyTool(tool: ToolId) {
    const canvas = map.getCanvas();
    canvas.style.cursor = tool === 'navigate' ? '' : tool === 'select' ? 'default' : 'crosshair';
    if (tool === 'navigate') {
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
    } else {
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
    }
    hover = null;
  }

  const onDown = (e: MapMouseEvent | MapTouchEvent) => {
    // Pressing on the map takes the keyboard with it. Chromium does this by itself, but WebKit
    // leaves the focus on the last form control used, so the next tool shortcut would be typed
    // into a dropdown or a field instead of switching the tool.
    const canvas = map.getCanvas();
    if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
    const s = useApp.getState();
    if (s.tool === 'navigate') return;
    if ('button' in e.originalEvent && e.originalEvent.button !== 0) return;
    tools.hitToleranceM = 6 * metresPerPixel(map);
    downAt = { x: e.point.x, y: e.point.y };
    if (tools.pointerDown(toXY(e), mods(e))) e.preventDefault();
  };
  const onMove = (e: MapMouseEvent | MapTouchEvent) => {
    const s = useApp.getState();
    if (s.tool === 'navigate') return;
    tools.hitToleranceM = 6 * metresPerPixel(map);
    const p = toXY(e);
    lastCursor = p;
    if (tools.pointerMove(p, mods(e))) return;
    if (s.tool === 'select' || s.tool === 'lasso') {
      const f = tools.hit(p);
      const next = f
        ? ({ type: 'Feature', id: f.id, geometry: geometryToLonLat(f.geometry), properties: {} } as Feature<
            Geometry,
            Record<string, unknown>
          >)
        : null;
      if ((next?.id ?? null) !== (hover?.id ?? null)) {
        hover = next;
        map.getCanvas().style.cursor = next ? 'pointer' : 'default';
        refresh();
      }
    }
  };
  const onUp = (e: MapMouseEvent | MapTouchEvent) => {
    const s = useApp.getState();
    const p = toXY(e);
    const wasClick = downAt && Math.hypot(e.point.x - downAt.x, e.point.y - downAt.y) < 3;
    downAt = null;
    if (s.tool === 'navigate') {
      if (wasClick) s.inspect(p[0], p[1]);
      return;
    }
    tools.pointerUp(p, mods(e));
    if (s.tool === 'select' && wasClick) {
      if (tools.selection.size === 0) {
        s.selectAnnotation(undefined);
        s.probeGenerated(p[0], p[1], tools.hitToleranceM);
        s.inspect(p[0], p[1]);
      } else {
        s.clearInspection();
      }
    }
  };
  const onDblClick = (e: MapMouseEvent) => {
    const s = useApp.getState();
    if (s.tool === 'line' || s.tool === 'polygon') {
      e.preventDefault();
      tools.finish();
    } else if (s.tool === 'select') {
      e.preventDefault();
      tools.insertVertexAt(toXY(e));
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const s = useApp.getState();
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      s.redo();
      return;
    }
    if (!meta && !e.altKey && SHORTCUTS[e.key.toLowerCase()] && !e.repeat) {
      s.setTool(SHORTCUTS[e.key.toLowerCase()]!);
      return;
    }
    if (e.key === 'Escape' && s.selectedAnnotation) {
      s.selectAnnotation(undefined);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedAnnotation && s.tool === 'select') {
      s.dispatch({ type: 'annotation.remove', ids: [s.selectedAnnotation] });
      return;
    }
    if (e.key.startsWith('Arrow') && s.tool === 'select' && tools.selection.size) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * metresPerPixel(map);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
      tools.moveSelection(dx, dy);
      return;
    }
    if (tools.keyDown(e.key)) e.preventDefault();
  };

  map.on('mousedown', onDown);
  map.on('mousemove', onMove);
  map.on('mouseup', onUp);
  map.on('touchstart', onDown);
  map.on('touchmove', onMove);
  map.on('touchend', onUp);
  map.on('dblclick', onDblClick);
  map.on('style.load', refresh);
  window.addEventListener('keydown', onKey);

  let lastTool: ToolId | null = null;
  const unsubscribe = useApp.subscribe((s) => {
    if (s.tool !== lastTool) {
      lastTool = s.tool;
      applyTool(s.tool);
    }
    refresh();
  });
  applyTool(useApp.getState().tool);
  if (map.isStyleLoaded()) refresh();

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKey);
    map.off('mousedown', onDown);
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    map.off('touchstart', onDown);
    map.off('touchmove', onMove);
    map.off('touchend', onUp);
    map.off('dblclick', onDblClick);
    map.off('style.load', refresh);
    for (const m of markers.values()) m.marker.remove();
    markers.clear();
  };
}
