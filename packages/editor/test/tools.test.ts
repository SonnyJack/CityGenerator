import { beforeEach, describe, expect, it } from 'vitest';
import { createDocument, type MapDocument } from '@citygen/core';
import { CommandBus, ToolController, strokePolygon, type ToolHost } from '../src/index.js';

const NOW = '2026-09-18T00:00:00.000Z';

function harness() {
  const bus = new CommandBus(createDocument({ now: NOW, seed: 'tools' }), { now: () => NOW });
  let n = 0;
  let changes = 0;
  const host: ToolHost = {
    document: () => bus.document,
    dispatch: (c) => bus.dispatch(c),
    changed: () => changes++,
    newId: (prefix) => `${prefix}-${++n}`,
    generatedAt: (p) =>
      Math.hypot(p[0] - 1000, p[1] - 1000) < 20
        ? {
            layer: 'buildings',
            id: 'gen-7',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [990, 990],
                  [1010, 990],
                  [1010, 1010],
                  [990, 1010],
                  [990, 990],
                ],
              ],
            },
            properties: { floors: 3, ward: 'merchant' },
          }
        : null,
  };
  const tools = new ToolController(host);
  return { bus, tools, doc: () => bus.document as MapDocument, changes: () => changes };
}

describe('ToolController', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('draws a street with the line tool and finishes on Enter or a repeated click', () => {
    h.tools.setTool('line');
    h.tools.setOptions({ layer: 'street', kind: 'main', widthM: 12 });
    expect(h.tools.pointerDown([0, 0])).toBe(true);
    h.tools.pointerMove([50, 5]);
    expect(h.tools.draft.geometry?.type).toBe('LineString');
    h.tools.pointerDown([100, 0]);
    h.tools.pointerDown([100, 0]); // click on the last vertex finishes
    const f = h.doc().authored.features;
    expect(f).toHaveLength(1);
    expect(f[0]!.properties).toMatchObject({ layer: 'street', kind: 'main', widthM: 12, origin: 'authored' });
    expect(f[0]!.geometry.type).toBe('LineString');
    expect(h.tools.selection.has(f[0]!.id)).toBe(true);
    expect(h.tools.draft.geometry).toBeNull();

    h.tools.pointerDown([0, 100]);
    h.tools.pointerDown([100, 100]);
    h.tools.keyDown('Enter');
    expect(h.doc().authored.features).toHaveLength(2);
    // A single point is not a line.
    h.tools.pointerDown([0, 200]);
    h.tools.keyDown('Enter');
    expect(h.doc().authored.features).toHaveLength(2);
  });

  it('draws polygons, rectangles and points and cancels on Escape', () => {
    h.tools.setTool('polygon');
    h.tools.setOptions({ layer: 'building', kind: 'warehouse' });
    h.tools.pointerDown([0, 0]);
    h.tools.pointerDown([100, 0]);
    h.tools.pointerDown([100, 100]);
    h.tools.keyDown('Enter');
    let f = h.doc().authored.features;
    expect(f).toHaveLength(1);
    expect(f[0]!.geometry.type).toBe('Polygon');
    expect((f[0]!.geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(4);

    h.tools.pointerDown([0, 0]);
    h.tools.pointerDown([100, 0]);
    h.tools.keyDown('Escape');
    h.tools.keyDown('Enter');
    expect(h.doc().authored.features).toHaveLength(1);

    h.tools.setTool('rectangle');
    h.tools.setOptions({ layer: 'street' }); // rectangles never produce streets
    h.tools.pointerDown([200, 200]);
    h.tools.pointerMove([260, 240]);
    expect(h.tools.draft.geometry?.type).toBe('Polygon');
    h.tools.pointerUp([260, 240]);
    f = h.doc().authored.features;
    expect(f).toHaveLength(2);
    expect(f[1]!.properties.layer).toBe('building');
    // Degenerate rectangle is ignored.
    h.tools.pointerDown([300, 300]);
    h.tools.pointerUp([300, 300]);
    expect(h.doc().authored.features).toHaveLength(2);

    h.tools.setTool('point');
    h.tools.setOptions({ layer: 'poi', kind: 'well' });
    h.tools.pointerDown([400, 400]);
    f = h.doc().authored.features;
    expect(f).toHaveLength(3);
    expect(f[2]!.geometry).toEqual({ type: 'Point', coordinates: [400, 400] });
  });

  it('selects, moves, box-selects, edits vertices and deletes', () => {
    h.tools.setTool('line');
    h.tools.pointerDown([0, 0]);
    h.tools.pointerDown([100, 0]);
    h.tools.keyDown('Enter');
    const id = h.doc().authored.features[0]!.id;

    h.tools.setTool('select');
    // The selection survives a tool switch so a freshly drawn feature can be edited at once.
    expect(h.tools.selection.has(id)).toBe(true);
    expect(h.tools.hit([50, 2])?.id).toBe(id);
    expect(h.tools.hit([50, 50])).toBeNull();
    // Click and drag moves the feature by the delta.
    expect(h.tools.pointerDown([50, 2])).toBe(true);
    h.tools.pointerMove([60, 22]);
    expect(h.tools.previewGeometry(id)).toBeDefined();
    h.tools.pointerUp([60, 22]);
    expect(h.tools.previewGeometry(id)).toBeUndefined();
    const g = h.doc().authored.features[0]!.geometry as { coordinates: number[][] };
    expect(g.coordinates[0]).toEqual([10, 20]);
    expect(g.coordinates[1]).toEqual([110, 20]);

    // Vertex drag: handles are exposed for the selection.
    expect(h.tools.handles()).toHaveLength(2);
    h.tools.pointerDown([110, 20]);
    h.tools.pointerMove([120, 40]);
    h.tools.pointerUp([120, 40]);
    expect((h.doc().authored.features[0]!.geometry as { coordinates: number[][] }).coordinates[1]).toEqual([
      120, 40,
    ]);

    // Insert and remove vertices.
    expect(h.tools.insertVertexAt([65, 30])).toBe(true);
    expect((h.doc().authored.features[0]!.geometry as { coordinates: number[][] }).coordinates).toHaveLength(
      3,
    );
    expect(h.tools.removeVertexAt([65, 30])).toBe(true);
    expect((h.doc().authored.features[0]!.geometry as { coordinates: number[][] }).coordinates).toHaveLength(
      2,
    );

    // Clicking empty space clears; a box drag reselects.
    h.tools.pointerDown([500, 500]);
    h.tools.pointerUp([500, 500]);
    expect(h.tools.selection.size).toBe(0);
    h.tools.pointerDown([-10, -10]);
    h.tools.pointerMove([200, 200]);
    h.tools.pointerUp([200, 200]);
    expect(h.tools.selection.has(id)).toBe(true);

    h.tools.keyDown('Delete');
    expect(h.doc().authored.features).toHaveLength(0);
    expect(h.bus.undo()).toBe(true);
    expect(h.doc().authored.features).toHaveLength(1);
  });

  it('transforms and retags the selection', () => {
    h.tools.setTool('rectangle');
    h.tools.setOptions({ layer: 'building', kind: 'house' });
    h.tools.pointerDown([0, 0]);
    h.tools.pointerUp([20, 10]);
    const id = h.doc().authored.features[0]!.id;
    h.tools.transformSelection('rotate', Math.PI / 2);
    let ring = (h.doc().authored.features[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!;
    const xs = ring.map((p) => p[0]!);
    const ys = ring.map((p) => p[1]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20);
    h.tools.transformSelection('scale', 2);
    ring = (h.doc().authored.features[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!;
    expect(Math.max(...ring.map((p) => p[1]!)) - Math.min(...ring.map((p) => p[1]!))).toBeCloseTo(40);
    h.tools.moveSelection(100, 0);
    ring = (h.doc().authored.features[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!;
    expect(Math.min(...ring.map((p) => p[0]!))).toBeCloseTo(100);
    h.tools.transformSelection('mirrorX');
    h.tools.setSelectionProperties({ kind: 'chapel', name: 'St Erasmus', floors: 2 });
    const f = h.doc().authored.features[0]!;
    expect(f.id).toBe(id);
    expect(f.properties).toMatchObject({ layer: 'building', kind: 'chapel', name: 'St Erasmus', floors: 2 });
  });

  it('snaps to grid, to vertices and to angles', () => {
    h.tools.setTool('line');
    h.tools.setOptions({ snapGridM: 10, snapToVertices: false, snapAngles: false });
    expect(h.tools.snap([13, 27])).toEqual([10, 30]);
    h.tools.setOptions({ snapGridM: 0 });
    h.tools.pointerDown([0, 0]);
    h.tools.pointerDown([100, 0]);
    h.tools.keyDown('Enter');
    h.tools.setOptions({ snapToVertices: true });
    expect(h.tools.snap([102, 3])).toEqual([100, 0]);
    expect(h.tools.snap([300, 3])).toEqual([300, 3]);
    h.tools.setOptions({ snapToVertices: false, snapAngles: true });
    h.tools.pointerDown([0, 100]);
    const p = h.tools.snap([100, 108]);
    expect(p[1]).toBeCloseTo(100);
    expect(p[0]).toBeCloseTo(100, 0);
    // Alt disables snapping.
    expect(h.tools.snap([100, 108], { alt: true })).toEqual([100, 108]);
  });

  it('brushes terrain, fields, zones, reroll and erase', () => {
    h.tools.setTool('brush');
    h.tools.setOptions({ brush: 'raise', brushRadiusM: 100, brushAmount: 25 });
    expect(h.tools.draft.brushRadiusM).toBe(100);
    h.tools.pointerDown([0, 0]);
    h.tools.pointerMove([200, 0]);
    h.tools.pointerMove([400, 0]);
    h.tools.pointerUp([400, 0]);
    let f = h.doc().authored.features;
    expect(f).toHaveLength(1);
    expect(f[0]!.properties).toMatchObject({ layer: 'terrainEdit', op: 'raise', radiusM: 100, amount: 25 });
    expect(f[0]!.geometry.type).toBe('LineString');

    h.tools.setOptions({ brush: 'wealth', brushAmount: 3 });
    h.tools.pointerDown([0, 500]);
    h.tools.pointerUp([0, 500]);
    f = h.doc().authored.features;
    expect(f[1]!.properties).toMatchObject({ layer: 'fieldEdit', field: 'wealth', delta: 1 });
    expect(f[1]!.geometry.type).toBe('Point');

    h.tools.setOptions({ brush: 'zone', zoneWard: 'park' });
    h.tools.pointerDown([0, 1000]);
    h.tools.pointerMove([300, 1000]);
    h.tools.pointerUp([300, 1000]);
    f = h.doc().authored.features;
    expect(f[2]!.properties).toMatchObject({ layer: 'zone', kind: 'park', radiusM: 100 });

    h.tools.setOptions({ brush: 'reroll' });
    h.tools.pointerDown([0, 2000]);
    h.tools.pointerUp([0, 2000]);
    expect(h.doc().overrides).toHaveLength(1);
    expect(h.doc().overrides[0]!.op).toBe('reroll');

    h.tools.setOptions({ brush: 'erase' });
    h.tools.pointerDown([0, 500]);
    h.tools.pointerUp([0, 500]);
    f = h.doc().authored.features;
    expect(f).toHaveLength(2);
    expect(f.some((x) => x.properties.layer === 'fieldEdit')).toBe(false);
  });

  it('annotates and freezes generated features', () => {
    h.tools.setTool('annotate');
    h.tools.setOptions({ annotation: 'label', text: 'Innsmouth' });
    h.tools.pointerDown([10, 10]);
    h.tools.setOptions({ annotation: 'note', text: 'Deep Ones below' });
    h.tools.pointerDown([20, 20]);
    h.tools.setOptions({ annotation: 'handoutFrame', text: 'Handout A' });
    h.tools.pointerDown([0, 0]);
    const a = h.doc().annotations;
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({ kind: 'label', text: 'Innsmouth', gmOnly: false });
    expect(a[1]).toMatchObject({ kind: 'note', gmOnly: true });
    expect(a[2]!.geometry.type).toBe('Polygon');

    expect(h.tools.freezeAt([0, 0])).toBeNull();
    const id = h.tools.freezeAt([1000, 1000]);
    expect(id).toBeTruthy();
    const f = h.doc().authored.features.find((x) => x.id === id)!;
    expect(f.properties).toMatchObject({
      layer: 'building',
      origin: 'frozen',
      frozenFrom: 'gen-7',
      kind: 'merchant',
      floors: 3,
    });
    expect(h.tools.selection.has(id!)).toBe(true);
  });

  it('builds a capsule polygon around a stroke', () => {
    const dot = strokePolygon([[0, 0]], 10);
    expect(dot).toHaveLength(16);
    expect(dot.every(([x, y]) => Math.abs(Math.hypot(x, y) - 10) < 1e-9)).toBe(true);
    const cap = strokePolygon(
      [
        [0, 0],
        [100, 0],
      ],
      10,
    );
    expect(cap.length).toBeGreaterThanOrEqual(4);
    const ys = cap.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(10);
    expect(Math.min(...ys)).toBeCloseTo(-10);
  });
});

describe('lasso, queries and alignment guides', () => {
  /** Three buildings: two in a row at y = 0, one off on its own. */
  function withBuildings() {
    const h = harness();
    const square = (x: number, y: number, s = 20): [number, number][] => [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ];
    h.bus.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id: 'a',
          geometry: { type: 'Polygon', coordinates: [square(0, 0)] },
          properties: { layer: 'building', origin: 'authored', kind: 'house', name: 'Ash Cottage' },
        },
        {
          type: 'Feature',
          id: 'b',
          geometry: { type: 'Polygon', coordinates: [square(100, 0)] },
          properties: { layer: 'building', origin: 'authored', kind: 'warehouse' },
        },
        {
          type: 'Feature',
          id: 'c',
          geometry: { type: 'Polygon', coordinates: [square(1000, 1000)] },
          properties: { layer: 'zone', origin: 'authored', kind: 'park' },
        },
      ],
    });
    return h;
  }

  it('lassoes what it encircles, and only what it encloses unless asked for what it touches', () => {
    const h = withBuildings();
    h.tools.setTool('lasso');
    // A loop around the two buildings in the row, clear of the third.
    const loop: [number, number][] = [
      [-40, -40],
      [160, -40],
      [160, 60],
      [-40, 60],
    ];
    h.tools.pointerDown(loop[0]!);
    for (const p of loop.slice(1)) h.tools.pointerMove(p);
    expect(h.tools.draft.geometry?.type).toBe('Polygon');
    h.tools.pointerUp(loop[loop.length - 1]!);
    expect([...h.tools.selection].sort()).toEqual(['a', 'b']);
    expect(h.tools.draft.geometry).toBeNull();

    // A loop that only clips the first building takes nothing while it must contain,
    // and takes it once it need only touch.
    h.tools.selection.clear();
    const clip: [number, number][] = [
      [-40, -40],
      [10, -40],
      [10, 10],
      [-40, 10],
    ];
    const run = () => {
      h.tools.pointerDown(clip[0]!);
      for (const p of clip.slice(1)) h.tools.pointerMove(p);
      h.tools.pointerUp(clip[clip.length - 1]!);
    };
    run();
    expect(h.tools.selection.size).toBe(0);
    h.tools.setOptions({ selectMode: 'intersects' });
    run();
    expect([...h.tools.selection]).toEqual(['a']);
  });

  it('selects by layer, kind, name and view, and adds to the selection when asked', () => {
    const h = withBuildings();
    expect(h.tools.selectByQuery({ layer: 'building' }).sort()).toEqual(['a', 'b']);
    expect(h.tools.selectByQuery({ kind: 'ware' })).toEqual(['b']);
    expect(h.tools.selectByQuery({ name: 'ash' })).toEqual(['a']);
    expect(h.tools.selectByQuery({ layer: 'zone' })).toEqual(['c']);
    // Each query replaces the selection unless it adds to it.
    expect([...h.tools.selection]).toEqual(['c']);
    h.tools.selectByQuery({ layer: 'building', add: true });
    expect([...h.tools.selection].sort()).toEqual(['a', 'b', 'c']);
    // Within a view: only what lies wholly inside it.
    expect(h.tools.selectByQuery({ within: { minX: -50, minY: -50, maxX: 200, maxY: 200 } }).sort()).toEqual([
      'a',
      'b',
    ]);
    expect(h.tools.selectByQuery({ layer: 'building', kind: 'nothing' })).toEqual([]);
    expect(h.tools.selection.size).toBe(0);
  });

  it('lines a moved feature up with the others and reports the guide, and Alt moves it freely', () => {
    const h = withBuildings();
    h.tools.setTool('select');
    h.tools.hitToleranceM = 6;
    h.tools.selection = new Set(['c']);
    // Drag the lone zone until its left edge is a few metres from the row's left edge.
    h.tools.pointerDown([1010, 1010]);
    h.tools.pointerMove([13, 1010]);
    const guides = h.tools.draft.guides;
    expect(guides.some((g) => g.axis === 'x' && g.value === 0)).toBe(true);
    h.tools.pointerUp([13, 1010]);
    const moved = h.doc().authored.features.find((f) => f.id === 'c')!;
    const xs = (moved.geometry as { coordinates: number[][][] }).coordinates[0]!.map((p) => p[0]!);
    expect(Math.min(...xs)).toBe(0);

    // With Alt the move is free: the feature lands where the pointer put it.
    h.tools.pointerDown([10, 1010], { alt: true });
    h.tools.pointerMove([23, 1010], { alt: true });
    expect(h.tools.draft.guides).toHaveLength(0);
    h.tools.pointerUp([23, 1010], { alt: true });
    const again = h.doc().authored.features.find((f) => f.id === 'c')!;
    const xs2 = (again.geometry as { coordinates: number[][][] }).coordinates[0]!.map((p) => p[0]!);
    expect(Math.min(...xs2)).toBe(13);
  });

  it('lines a drawn point up with what is already there', () => {
    const h = withBuildings();
    h.tools.setTool('rectangle');
    h.tools.setOptions({ layer: 'building', kind: 'house', snapToVertices: false });
    h.tools.hitToleranceM = 6;
    h.tools.pointerDown([200, 200]);
    // The far corner lands a couple of metres off the row's right edge and snaps onto it.
    h.tools.pointerMove([118, 260]);
    expect(h.tools.draft.guides.some((g) => g.axis === 'x' && g.value === 120)).toBe(true);
    h.tools.pointerUp([118, 260]);
    const drawn = h.doc().authored.features.find((f) => f.id.startsWith('building'))!;
    const xs = (drawn.geometry as { coordinates: number[][][] }).coordinates[0]!.map((p) => p[0]!);
    expect(Math.min(...xs)).toBe(120);
    // Switching alignment off leaves the drawn point alone.
    h.tools.setOptions({ snapAlign: false });
    h.tools.pointerDown([300, 300]);
    h.tools.pointerMove([118, 360]);
    expect(h.tools.draft.guides).toHaveLength(0);
  });
});

describe('the vegetation and year brushes and the arrow annotation', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('paints a land cover as a vegetation stroke', () => {
    h.tools.setTool('brush');
    h.tools.setOptions({ brush: 'vegetation', cover: 'forest', brushRadiusM: 180 });
    h.tools.pointerDown([0, 0]);
    h.tools.pointerMove([200, 0]);
    h.tools.pointerUp([200, 0]);
    const f = h.doc().authored.features[0]!;
    expect(f.properties).toMatchObject({ layer: 'vegetation', kind: 'forest', radiusM: 180 });
    expect(f.geometry.type).toBe('LineString');
  });

  it('records a year stroke in years, not as a fraction', () => {
    h.tools.setTool('brush');
    h.tools.setOptions({ brush: 'year', brushAmount: -45, brushRadiusM: 300 });
    h.tools.pointerDown([0, 0]);
    h.tools.pointerMove([100, 100]);
    h.tools.pointerUp([100, 100]);
    const f = h.doc().authored.features[0]!;
    expect(f.properties).toMatchObject({ layer: 'fieldEdit', field: 'year', delta: -45, radiusM: 300 });
  });

  it('drags an arrow annotation and ignores a click that goes nowhere', () => {
    h.tools.setTool('annotate');
    h.tools.setOptions({ annotation: 'arrow', text: 'this way' });
    h.tools.hitToleranceM = 6;
    h.tools.pointerDown([0, 0]);
    h.tools.pointerMove([300, 120]);
    expect(h.tools.draft.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [300, 120],
      ],
    });
    h.tools.pointerUp([300, 120]);
    const a = h.doc().annotations[0]!;
    expect(a.kind).toBe('arrow');
    expect(a.text).toBe('this way');
    expect(a.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [300, 120],
      ],
    });
    expect(h.tools.draft.geometry).toBeNull();
    // A click with no drag has no direction, so it makes no arrow.
    h.tools.pointerDown([500, 500]);
    h.tools.pointerUp([502, 500]);
    expect(h.doc().annotations).toHaveLength(1);
  });
});

describe('locked layers', () => {
  function withTwoLayers() {
    const h = harness();
    h.bus.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id: 'street-1',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [200, 0],
            ],
          },
          properties: { layer: 'street', origin: 'authored', kind: 'main' },
        },
        {
          type: 'Feature',
          id: 'house-1',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 20],
                [40, 20],
                [40, 60],
                [0, 60],
                [0, 20],
              ],
            ],
          },
          properties: { layer: 'building', origin: 'authored', kind: 'house' },
        },
      ],
    });
    return h;
  }

  it('passes over a locked layer when hit-testing, selecting, querying and erasing', () => {
    const h = withTwoLayers();
    h.tools.setTool('select');
    h.tools.hitToleranceM = 6;
    expect(h.tools.hit([100, 0])?.id).toBe('street-1');
    h.tools.setLocked('street', true);
    expect(h.tools.hit([100, 0])).toBeNull();
    expect(h.tools.selectByQuery({})).toEqual(['house-1']);
    // A box over both takes only the unlocked one.
    h.tools.selection.clear();
    h.tools.pointerDown([-50, -50]);
    h.tools.pointerMove([260, 120]);
    h.tools.pointerUp([260, 120]);
    expect([...h.tools.selection]).toEqual(['house-1']);
    // The erase brush leaves the locked street standing.
    h.tools.setTool('brush');
    h.tools.setOptions({ brush: 'erase', brushRadiusM: 400 });
    h.tools.pointerDown([100, 20]);
    h.tools.pointerUp([100, 20]);
    const left = h.doc().authored.features.map((f) => f.id);
    expect(left).toEqual(['street-1']);
    // Unlocking brings it back within reach.
    h.tools.setLocked('street', false);
    h.tools.setTool('select');
    expect(h.tools.hit([100, 0])?.id).toBe('street-1');
  });

  it('drops a locked layer from the selection when it is locked', () => {
    const h = withTwoLayers();
    h.tools.setTool('select');
    h.tools.selectByQuery({});
    expect(h.tools.selection.size).toBe(2);
    h.tools.setLocked('building', true);
    expect([...h.tools.selection]).toEqual(['street-1']);
  });
});

describe('the facility tool', () => {
  it('asks for a facility on the ground it was drawn on, pinned to that footprint', () => {
    const h = harness();
    h.tools.setTool('facility');
    h.tools.setOptions({ facilityType: 'industry.gasworks', facilitySize: 'large' });
    // A rectangle 400 m east-west by 200 m north-south.
    h.tools.pointerDown([-200, -100]);
    h.tools.pointerMove([200, 100]);
    h.tools.pointerUp([200, 100]);
    const spec = h.doc().spec.features;
    expect(spec).toHaveLength(1);
    expect(spec[0]).toMatchObject({ type: 'industry.gasworks', size: 'large', lock: true });
    const pin = h.doc().overrides.find((o) => o.op === 'pin')!;
    expect(pin).toMatchObject({ target: spec[0]!.id, x: 0, y: 0, lengthM: 400, widthM: 200, rotation: 0 });

    // A tall rectangle is the same works turned a quarter: the long side is its length.
    h.tools.pointerDown([1000, 0]);
    h.tools.pointerMove([1100, 600]);
    h.tools.pointerUp([1100, 600]);
    const second = h.doc().overrides.filter((o) => o.op === 'pin')[1]!;
    expect(second).toMatchObject({ lengthM: 600, widthM: 100 });
    expect((second as { rotation: number }).rotation).toBeCloseTo(Math.PI / 2, 6);

    // A click with no drag asks for nothing.
    h.tools.pointerDown([3000, 3000]);
    h.tools.pointerUp([3000, 3000]);
    expect(h.doc().spec.features).toHaveLength(2);
  });

  it('gives the facility to the settlement it was drawn in, when the host knows one', () => {
    const bus = new CommandBus(createDocument({ now: NOW, seed: 'facility' }), { now: () => NOW });
    bus.dispatch({
      type: 'settlement.add',
      settlement: {
        id: 'arkham',
        kind: 'town',
        population: 9000,
        layout: { streetPattern: 'mixed' },
        features: [],
      },
    });
    let n = 0;
    const tools = new ToolController({
      document: () => bus.document,
      dispatch: (c) => bus.dispatch(c),
      changed: () => {},
      newId: (p) => `${p}-${++n}`,
      settlementAt: (p) => (Math.hypot(p[0], p[1]) < 500 ? 'arkham' : null),
    });
    tools.setTool('facility');
    tools.setOptions({ facilityType: 'institution.hospital' });
    tools.pointerDown([-100, -50]);
    tools.pointerMove([100, 50]);
    tools.pointerUp([100, 50]);
    // The request says which settlement it belongs to, so a town the region generated can
    // own a hand-drawn works without being written into the spec.
    expect(bus.document.spec.features).toHaveLength(1);
    expect(bus.document.spec.features[0]).toMatchObject({
      type: 'institution.hospital',
      settlement: 'arkham',
    });
    expect(bus.document.overrides[0]).toMatchObject({
      op: 'pin',
      target: bus.document.spec.features[0]!.id,
    });
    // Drawn out in the region, it stands on its own.
    tools.pointerDown([5000, 5000]);
    tools.pointerMove([5200, 5100]);
    tools.pointerUp([5200, 5100]);
    expect(bus.document.spec.features).toHaveLength(2);
    expect(bus.document.spec.features[1]!.settlement).toBeUndefined();
  });
});
