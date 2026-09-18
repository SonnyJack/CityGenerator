import type { Geometry } from 'geojson';
import type { AuthoredFeature, AuthoredLayer, MapDocument } from '@citygen/core';
import type { Command } from './commands.js';
import {
  distToGeometry,
  featureBBox,
  insertVertex,
  mirror,
  removeVertex,
  rotate,
  scale,
  setVertex,
  translate,
  vertices,
  type XY,
} from './geometry.js';

/**
 * Framework-agnostic editing tools. The host feeds pointer events in world
 * metres; the controller keeps tool state, produces draft geometry for
 * rendering, and emits commands for the command bus. Snapping considers
 * authored vertices, an optional grid and, when asked, 15° angle steps.
 */

export type ToolId =
  'navigate' | 'select' | 'line' | 'polygon' | 'rectangle' | 'point' | 'brush' | 'annotate';

export type BrushKind =
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'water'
  | 'wealth'
  | 'density'
  | 'condition'
  | 'zone'
  | 'erase'
  | 'reroll';

export interface ToolOptions {
  /** Layer for line/polygon/point tools. */
  layer: AuthoredLayer;
  /** Kind within the layer (street class, zone ward, poi type…). */
  kind: string;
  widthM: number;
  brush: BrushKind;
  brushRadiusM: number;
  /** Metres for terrain ops, delta in [-1,1] for fields, strength for smooth. */
  brushAmount: number;
  zoneWard: string;
  annotation: 'label' | 'marker' | 'note' | 'handoutFrame';
  text: string;
  snapGridM: number;
  snapToVertices: boolean;
  snapAngles: boolean;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  layer: 'street',
  kind: 'local',
  widthM: 8,
  brush: 'raise',
  brushRadiusM: 150,
  brushAmount: 15,
  zoneWard: 'park',
  annotation: 'label',
  text: 'Label',
  snapGridM: 0,
  snapToVertices: true,
  snapAngles: false,
};

export interface Modifiers {
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export interface DraftState {
  /** In-progress geometry for the host to render (world metres). */
  geometry: Geometry | null;
  /** Cursor position after snapping. */
  cursor: XY | null;
  /** Brush footprint radius for rendering. */
  brushRadiusM: number | null;
}

export interface VertexHandle {
  featureId: string;
  ring: number;
  index: number;
  p: XY;
}

export interface ToolHost {
  document(): MapDocument;
  dispatch(command: Command): void;
  /** Called after every state change so the host can re-render drafts/handles. */
  changed(): void;
  /** Deterministic-enough ids for new features (the host may use the platform RNG). */
  newId(prefix: string): string;
  /** Hit-test generated features under the cursor (optional; used for freeze/suppress). */
  generatedAt?(p: XY): GeneratedFeature | null;
}

export interface GeneratedFeature {
  layer: string;
  id: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
}

export class ToolController {
  tool: ToolId = 'navigate';
  options: ToolOptions = { ...DEFAULT_TOOL_OPTIONS };
  selection = new Set<string>();
  draft: DraftState = { geometry: null, cursor: null, brushRadiusM: null };
  private preview: Map<string, AuthoredFeature['geometry']> = new Map();
  /** World-metre tolerance for hit tests; the host sets it from the current zoom. */
  hitToleranceM = 6;

  private points: XY[] = [];
  private dragging:
    | null
    | { kind: 'move'; start: XY; last: XY; moved: boolean }
    | { kind: 'vertex'; handle: VertexHandle; moved: boolean }
    | { kind: 'box'; start: XY }
    | { kind: 'rect'; start: XY }
    | { kind: 'brush'; points: XY[] } = null;

  constructor(private readonly host: ToolHost) {}

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.points = [];
    this.dragging = null;
    this.draft = {
      geometry: null,
      cursor: null,
      brushRadiusM: tool === 'brush' ? this.options.brushRadiusM : null,
    };
    this.host.changed();
  }

  setOptions(patch: Partial<ToolOptions>): void {
    this.options = { ...this.options, ...patch };
    if (this.tool === 'brush') this.draft.brushRadiusM = this.options.brushRadiusM;
    this.host.changed();
  }

  /** Drop selection ids that no longer exist (after undo/redo, import or a remote edit). */
  reconcile(): void {
    const doc = this.host.document();
    const ids = new Set(doc.authored.features.map((f) => f.id));
    let changed = false;
    for (const id of this.selection) {
      if (!ids.has(id)) {
        this.selection.delete(id);
        changed = true;
      }
    }
    for (const id of this.preview.keys()) if (!ids.has(id)) this.preview.delete(id);
    if (changed) this.host.changed();
  }

  /** Selected authored features. */
  selected(): AuthoredFeature[] {
    const doc = this.host.document();
    return doc.authored.features.filter((f) => this.selection.has(f.id));
  }

  /** Vertex handles of the selected features (select tool only). */
  handles(): VertexHandle[] {
    if (this.tool !== 'select') return [];
    const out: VertexHandle[] = [];
    for (const f of this.selected())
      for (const v of vertices(f.geometry))
        out.push({ featureId: f.id, ring: v.ring, index: v.index, p: v.p });
    return out;
  }

  // --- Snapping ---------------------------------------------------------------

  snap(p: XY, mods: Modifiers = {}, exclude?: string): XY {
    let out: XY = [p[0], p[1]];
    if (mods.alt) return out;
    if (this.options.snapToVertices) {
      let best: XY | null = null;
      let bestD = this.hitToleranceM * 1.5;
      for (const f of this.host.document().authored.features) {
        if (f.id === exclude || f.properties.layer === 'terrainEdit' || f.properties.layer === 'fieldEdit')
          continue;
        for (const v of vertices(f.geometry)) {
          const d = Math.hypot(v.p[0] - p[0], v.p[1] - p[1]);
          if (d < bestD) {
            bestD = d;
            best = v.p;
          }
        }
      }
      if (best) return best;
    }
    if (this.options.snapGridM > 0) {
      const g = this.options.snapGridM;
      out = [Math.round(out[0] / g) * g, Math.round(out[1] / g) * g];
    }
    if ((this.options.snapAngles || mods.shift) && this.points.length) {
      const last = this.points[this.points.length - 1]!;
      const dx = out[0] - last[0];
      const dy = out[1] - last[1];
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const step = Math.PI / 12;
        const a = Math.round(Math.atan2(dy, dx) / step) * step;
        out = [last[0] + Math.cos(a) * len, last[1] + Math.sin(a) * len];
      }
    }
    return out;
  }

  // --- Hit testing --------------------------------------------------------------

  hit(p: XY): AuthoredFeature | null {
    const doc = this.host.document();
    let best: AuthoredFeature | null = null;
    let bestD = Infinity;
    for (const f of doc.authored.features) {
      if (f.properties.layer === 'terrainEdit' || f.properties.layer === 'fieldEdit') continue;
      const d = distToGeometry(p, f.geometry);
      const tol = f.geometry.type === 'Polygon' ? 0 : this.hitToleranceM;
      if (d <= tol && d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  private handleAt(p: XY): VertexHandle | null {
    let best: VertexHandle | null = null;
    let bestD = this.hitToleranceM * 1.5;
    for (const h of this.handles()) {
      const d = Math.hypot(h.p[0] - p[0], h.p[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  // --- Pointer events -------------------------------------------------------------

  /** Returns true when the event was consumed (the host should not pan the map). */
  pointerDown(raw: XY, mods: Modifiers = {}): boolean {
    this.reconcile();
    const p = this.snap(raw, mods);
    switch (this.tool) {
      case 'navigate':
        return false;
      case 'select': {
        const handle = this.handleAt(raw);
        if (handle) {
          this.dragging = { kind: 'vertex', handle, moved: false };
          return true;
        }
        const f = this.hit(raw);
        if (f) {
          if (mods.shift) {
            if (this.selection.has(f.id)) this.selection.delete(f.id);
            else this.selection.add(f.id);
          } else if (!this.selection.has(f.id)) {
            this.selection = new Set([f.id]);
          }
          this.dragging = { kind: 'move', start: p, last: p, moved: false };
          this.host.changed();
          return true;
        }
        if (!mods.shift) this.selection.clear();
        this.dragging = { kind: 'box', start: raw };
        this.host.changed();
        return true;
      }
      case 'line':
      case 'polygon': {
        const last = this.points[this.points.length - 1];
        if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < this.hitToleranceM) {
          this.finish();
          return true;
        }
        this.points.push(p);
        this.updateDraft(p);
        return true;
      }
      case 'rectangle':
        this.dragging = { kind: 'rect', start: p };
        return true;
      case 'point':
        this.commitPoint(p);
        return true;
      case 'brush':
        this.dragging = { kind: 'brush', points: [p] };
        this.draft = {
          geometry: { type: 'LineString', coordinates: [p, p] },
          cursor: p,
          brushRadiusM: this.options.brushRadiusM,
        };
        this.host.changed();
        return true;
      case 'annotate':
        this.commitAnnotation(p);
        return true;
      default:
        return false;
    }
  }

  pointerMove(raw: XY, mods: Modifiers = {}): boolean {
    const p = this.snap(
      raw,
      mods,
      this.dragging?.kind === 'vertex' ? this.dragging.handle.featureId : undefined,
    );
    if (this.dragging) {
      switch (this.dragging.kind) {
        case 'move': {
          const dx = p[0] - this.dragging.last[0];
          const dy = p[1] - this.dragging.last[1];
          if (dx || dy) {
            this.dragging.last = p;
            this.dragging.moved = true;
            this.previewMove(dx, dy);
          }
          return true;
        }
        case 'vertex': {
          this.dragging.moved = true;
          this.previewVertex(this.dragging.handle, p);
          return true;
        }
        case 'box':
          this.draft = { geometry: rectGeometry(this.dragging.start, raw), cursor: raw, brushRadiusM: null };
          this.host.changed();
          return true;
        case 'rect':
          this.draft = { geometry: rectGeometry(this.dragging.start, p), cursor: p, brushRadiusM: null };
          this.host.changed();
          return true;
        case 'brush': {
          const last = this.dragging.points[this.dragging.points.length - 1]!;
          if (Math.hypot(last[0] - p[0], last[1] - p[1]) > this.options.brushRadiusM * 0.25)
            this.dragging.points.push(p);
          this.draft = {
            geometry: {
              type: 'LineString',
              coordinates: this.dragging.points.length > 1 ? this.dragging.points : [p, p],
            },
            cursor: p,
            brushRadiusM: this.options.brushRadiusM,
          };
          this.host.changed();
          return true;
        }
      }
    }
    if (this.tool === 'line' || this.tool === 'polygon') {
      this.updateDraft(p);
      return true;
    }
    if (this.tool === 'brush') {
      this.draft = { geometry: null, cursor: p, brushRadiusM: this.options.brushRadiusM };
      this.host.changed();
      return true;
    }
    return false;
  }

  pointerUp(raw: XY, mods: Modifiers = {}): boolean {
    const d = this.dragging;
    if (!d) return false;
    this.dragging = null;
    switch (d.kind) {
      case 'move':
        if (d.moved) this.commitPreview();
        else this.discardPreview();
        return true;
      case 'vertex':
        if (d.moved) this.commitPreview();
        else this.discardPreview();
        return true;
      case 'box': {
        const box = normalizeBox(d.start, raw);
        if (box.maxX - box.minX > this.hitToleranceM && box.maxY - box.minY > this.hitToleranceM) {
          for (const f of this.host.document().authored.features) {
            if (f.properties.layer === 'terrainEdit' || f.properties.layer === 'fieldEdit') continue;
            const b = featureBBox(f);
            if (b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY)
              this.selection.add(f.id);
          }
        }
        this.draft = { geometry: null, cursor: null, brushRadiusM: null };
        this.host.changed();
        return true;
      }
      case 'rect': {
        const p = this.snap(raw, mods);
        const g = rectGeometry(d.start, p);
        this.draft = { geometry: null, cursor: null, brushRadiusM: null };
        if (g && Math.abs((p[0] - d.start[0]) * (p[1] - d.start[1])) > 4)
          this.commitFeature(g, this.options.layer === 'street' ? 'building' : this.options.layer);
        else this.host.changed();
        return true;
      }
      case 'brush':
        this.commitBrush(d.points);
        this.draft = { geometry: null, cursor: raw, brushRadiusM: this.options.brushRadiusM };
        this.host.changed();
        return true;
    }
    return false;
  }

  /** Double-click or Enter finishes a line/polygon; Escape cancels; Delete removes the selection. */
  keyDown(key: string): boolean {
    if (key === 'Escape') {
      this.points = [];
      this.discardPreview();
      this.draft = {
        geometry: null,
        cursor: null,
        brushRadiusM: this.tool === 'brush' ? this.options.brushRadiusM : null,
      };
      this.host.changed();
      return true;
    }
    if (key === 'Enter' && (this.tool === 'line' || this.tool === 'polygon')) {
      this.finish();
      return true;
    }
    if ((key === 'Delete' || key === 'Backspace') && this.tool === 'select' && this.selection.size) {
      this.deleteSelection();
      return true;
    }
    return false;
  }

  finish(): void {
    const pts = this.points;
    this.points = [];
    this.draft = { geometry: null, cursor: null, brushRadiusM: null };
    if (this.tool === 'line' && pts.length >= 2)
      this.commitFeature({ type: 'LineString', coordinates: pts }, this.options.layer);
    else if (this.tool === 'polygon' && pts.length >= 3)
      this.commitFeature({ type: 'Polygon', coordinates: [[...pts, pts[0]!]] }, this.options.layer);
    else this.host.changed();
  }

  // --- Selection operations ----------------------------------------------------------

  deleteSelection(): void {
    const ids = [...this.selection];
    if (!ids.length) return;
    this.selection.clear();
    this.host.dispatch({ type: 'authored.remove', ids });
    this.host.changed();
  }

  transformSelection(op: 'rotate' | 'scale' | 'mirrorX' | 'mirrorY', amount = 0): void {
    const feats = this.selected();
    if (!feats.length) return;
    // Transform around the centroid of the whole selection so groups keep their arrangement.
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const f of feats) {
      const b = featureBBox(f);
      sx += (b.minX + b.maxX) / 2;
      sy += (b.minY + b.maxY) / 2;
      n++;
    }
    const about: XY = [sx / n, sy / n];
    for (const f of feats) {
      const g =
        op === 'rotate'
          ? rotate(f.geometry, amount, about)
          : op === 'scale'
            ? scale(f.geometry, amount, about)
            : op === 'mirrorX'
              ? mirror(f.geometry, 'x', about)
              : mirror(f.geometry, 'y', about);
      this.host.dispatch({ type: 'authored.update', id: f.id, geometry: g as AuthoredFeature['geometry'] });
    }
    this.host.changed();
  }

  moveSelection(dx: number, dy: number): void {
    for (const f of this.selected()) {
      this.host.dispatch({
        type: 'authored.update',
        id: f.id,
        geometry: translate(f.geometry, dx, dy) as AuthoredFeature['geometry'],
      });
    }
    this.host.changed();
  }

  setSelectionProperties(patch: Record<string, unknown>): void {
    for (const f of this.selected())
      this.host.dispatch({ type: 'authored.update', id: f.id, properties: patch as never });
    this.host.changed();
  }

  /** Insert a vertex on the nearest segment of the (single) selected line or polygon. */
  insertVertexAt(p: XY): boolean {
    const feats = this.selected();
    if (feats.length !== 1) return false;
    const f = feats[0]!;
    const g = f.geometry;
    const rings = g.type === 'LineString' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates : null;
    if (!rings) return false;
    type Best = { ring: number; index: number; d: number };
    let bestRef: Best | null = null;
    rings.forEach((r, ri) => {
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]!;
        const b = r[i]!;
        const dx = b[0]! - a[0]!;
        const dy = b[1]! - a[1]!;
        const len2 = dx * dx + dy * dy;
        const t =
          len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]!) * dx + (p[1] - a[1]!) * dy) / len2));
        const d = Math.hypot(p[0] - (a[0]! + t * dx), p[1] - (a[1]! + t * dy));
        if (!bestRef || d < bestRef.d) bestRef = { ring: ri, index: i - 1, d };
      }
    });
    const best = bestRef as Best | null;
    if (!best || best.d > this.hitToleranceM * 2) return false;
    this.host.dispatch({
      type: 'authored.update',
      id: f.id,
      geometry: insertVertex(g, best.ring, best.index, p) as AuthoredFeature['geometry'],
    });
    this.host.changed();
    return true;
  }

  removeVertexAt(p: XY): boolean {
    const h = this.handleAt(p);
    if (!h) return false;
    const f = this.selected().find((x) => x.id === h.featureId);
    if (!f) return false;
    const g = removeVertex(f.geometry, h.ring, h.index);
    if (g === f.geometry) return false;
    this.host.dispatch({ type: 'authored.update', id: f.id, geometry: g as AuthoredFeature['geometry'] });
    this.host.changed();
    return true;
  }

  /** Freeze a generated feature under the cursor into an authored one (kept across regeneration). */
  freezeAt(p: XY): string | null {
    const gen = this.host.generatedAt?.(p);
    return gen ? this.freezeGenerated(gen) : null;
  }

  /** Freeze a generated feature the host already looked up (e.g. asynchronously in a worker). */
  freezeGenerated(gen: GeneratedFeature): string {
    const layer: AuthoredLayer =
      gen.layer === 'buildings'
        ? 'building'
        : gen.layer === 'patches'
          ? 'zone'
          : gen.layer === 'streets'
            ? 'street'
            : 'facility';
    const id = this.host.newId('frozen');
    const kind =
      typeof gen.properties.kind === 'string'
        ? gen.properties.kind
        : typeof gen.properties.ward === 'string'
          ? gen.properties.ward
          : typeof gen.properties.class === 'string'
            ? gen.properties.class
            : undefined;
    this.host.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id,
          geometry: gen.geometry as AuthoredFeature['geometry'],
          properties: {
            layer,
            origin: 'frozen',
            frozenFrom: gen.id,
            ...(kind ? { kind } : {}),
            ...(typeof gen.properties.floors === 'number' ? { floors: gen.properties.floors } : {}),
          },
        },
      ],
    });
    this.selection = new Set([id]);
    this.host.changed();
    return id;
  }

  // --- Internals ----------------------------------------------------------------------

  /** Geometry to render for a feature while a drag is in progress. */
  previewGeometry(id: string): AuthoredFeature['geometry'] | undefined {
    return this.preview.get(id);
  }

  private previewMove(dx: number, dy: number): void {
    for (const f of this.selected()) {
      const base = this.preview.get(f.id) ?? f.geometry;
      this.preview.set(f.id, translate(base, dx, dy) as AuthoredFeature['geometry']);
    }
    this.host.changed();
  }

  private previewVertex(h: VertexHandle, p: XY): void {
    const f = this.selected().find((x) => x.id === h.featureId);
    if (!f) return;
    this.preview.set(f.id, setVertex(f.geometry, h.ring, h.index, p) as AuthoredFeature['geometry']);
    this.host.changed();
  }

  private commitPreview(): void {
    for (const [id, geometry] of this.preview) this.host.dispatch({ type: 'authored.update', id, geometry });
    this.preview.clear();
    this.host.changed();
  }

  private discardPreview(): void {
    this.preview.clear();
    this.host.changed();
  }

  private updateDraft(cursor: XY): void {
    const pts = [...this.points, cursor];
    let geometry: Geometry | null = null;
    if (this.tool === 'line' && pts.length >= 2) geometry = { type: 'LineString', coordinates: pts };
    else if (this.tool === 'polygon' && pts.length >= 3)
      geometry = { type: 'Polygon', coordinates: [[...pts, pts[0]!]] };
    else if (pts.length >= 2) geometry = { type: 'LineString', coordinates: pts };
    this.draft = { geometry, cursor, brushRadiusM: null };
    this.host.changed();
  }

  private commitFeature(geometry: Geometry, layer: AuthoredLayer): void {
    const id = this.host.newId(layer);
    const props: Record<string, unknown> = { layer, origin: 'authored', kind: this.options.kind };
    if (layer === 'street' || layer === 'rail' || layer === 'tram' || layer === 'water' || layer === 'wall')
      props.widthM = this.options.widthM;
    this.host.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id,
          geometry: geometry as AuthoredFeature['geometry'],
          properties: props as AuthoredFeature['properties'],
        },
      ],
    });
    this.selection = new Set([id]);
    this.host.changed();
  }

  private commitPoint(p: XY): void {
    this.commitFeature(
      { type: 'Point', coordinates: p },
      this.options.layer === 'street' ? 'poi' : this.options.layer,
    );
  }

  private commitBrush(points: XY[]): void {
    const o = this.options;
    const line: Geometry =
      points.length > 1
        ? { type: 'LineString', coordinates: points }
        : { type: 'Point', coordinates: points[0]! };
    if (o.brush === 'erase') {
      const ids = new Set<string>();
      for (const f of this.host.document().authored.features) {
        for (const q of points) if (distToGeometry(q, f.geometry) <= o.brushRadiusM) ids.add(f.id);
      }
      if (ids.size) {
        this.host.dispatch({ type: 'authored.remove', ids: [...ids] });
        for (const id of ids) this.selection.delete(id);
      }
      return;
    }
    if (o.brush === 'reroll') {
      const polygon = strokePolygon(points, o.brushRadiusM);
      this.host.dispatch({
        type: 'override.add',
        override: { op: 'reroll', polygon, salt: this.host.newId('salt') },
      });
      return;
    }
    const id = this.host.newId('brush');
    let props: Record<string, unknown>;
    if (o.brush === 'wealth' || o.brush === 'density' || o.brush === 'condition') {
      props = {
        layer: 'fieldEdit',
        origin: 'authored',
        field: o.brush,
        radiusM: o.brushRadiusM,
        delta: Math.max(-1, Math.min(1, o.brushAmount)),
      };
    } else if (o.brush === 'zone') {
      props = { layer: 'zone', origin: 'authored', kind: o.zoneWard, radiusM: o.brushRadiusM };
    } else {
      props = {
        layer: 'terrainEdit',
        origin: 'authored',
        op: o.brush,
        radiusM: o.brushRadiusM,
        amount: o.brushAmount,
      };
    }
    this.host.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id,
          geometry: line as AuthoredFeature['geometry'],
          properties: props as AuthoredFeature['properties'],
        },
      ],
    });
  }

  private commitAnnotation(p: XY): void {
    const o = this.options;
    const id = this.host.newId('note');
    const geometry: Geometry =
      o.annotation === 'handoutFrame'
        ? {
            type: 'Polygon',
            coordinates: [
              [
                [p[0] - 500, p[1] - 350],
                [p[0] + 500, p[1] - 350],
                [p[0] + 500, p[1] + 350],
                [p[0] - 500, p[1] + 350],
                [p[0] - 500, p[1] - 350],
              ],
            ],
          }
        : { type: 'Point', coordinates: p };
    this.host.dispatch({
      type: 'annotation.add',
      annotation: {
        id,
        kind: o.annotation,
        geometry: geometry as AuthoredFeature['geometry'],
        text: o.text,
        gmOnly: o.annotation === 'note',
      },
    });
    this.host.changed();
  }
}

function rectGeometry(a: XY, b: XY): Geometry | null {
  if (a[0] === b[0] || a[1] === b[1]) return null;
  const { minX, minY, maxX, maxY } = normalizeBox(a, b);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  };
}

function normalizeBox(a: XY, b: XY) {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

/** A polygon around a stroke (capsule approximation by sampled circles). */
export function strokePolygon(points: XY[], radiusM: number): [number, number][] {
  if (points.length === 1) {
    const [cx, cy] = points[0]!;
    const out: [number, number][] = [];
    for (let k = 0; k < 16; k++)
      out.push([
        cx + Math.cos((k / 16) * Math.PI * 2) * radiusM,
        cy + Math.sin((k / 16) * Math.PI * 2) * radiusM,
      ]);
    return out;
  }
  // Left side forward, right side backward.
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * radiusM;
    const ny = (dx / len) * radiusM;
    left.push([points[i]![0] + nx, points[i]![1] + ny]);
    right.push([points[i]![0] - nx, points[i]![1] - ny]);
  }
  return [...left, ...right.reverse()];
}
