import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { atlas, ink, compileStyle, themes, AUTHORED_STYLE_LAYERS } from '../src/index.js';

const options = {
  sourceId: 'citygen',
  tileUrl: 'citygen://tiles/{z}/{x}/{y}',
  demSourceId: 'citygen-dem',
  demTileUrl: 'citygen://dem/{z}/{x}/{y}',
};

describe('compileStyle', () => {
  it('produces valid MapLibre styles for every theme', () => {
    for (const theme of Object.values(themes)) {
      const style = compileStyle(theme, options);
      const errors = validateStyleMin(style);
      expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
      const ids = style.layers.map((l) => l.id);
      for (const id of [
        'hillshade',
        'water-fill',
        'rivers',
        'contours-major',
        'landcover-forest',
        'region-outline',
      ]) {
        expect(ids).toContain(id);
      }
    }
  });

  it('adds editor sources and layers that validate in both themes', () => {
    for (const theme of Object.values(themes)) {
      const style = compileStyle(theme, {
        ...options,
        editor: {
          authoredSourceId: 'authored',
          overlaySourceId: 'editor',
          annotationSourceId: 'annotations',
        },
      });
      const errors = validateStyleMin(style);
      expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
      expect(Object.keys(style.sources)).toEqual(
        expect.arrayContaining(['authored', 'editor', 'annotations']),
      );
      const ids = style.layers.map((l) => l.id);
      for (const id of [
        'authored-lines',
        'authored-buildings',
        'authored-zones',
        'authored-strokes',
        'editor-handles',
        'editor-selection-line',
        'annotation-frames',
      ])
        expect(ids).toContain(id);
      // Editor overlay renders above everything else.
      expect(ids[ids.length - 1]).toBe('editor-hover');
    }
    // Without editor sources the tile style carries no authored layers.
    expect(compileStyle(atlas, options).layers.some((l) => l.id.startsWith('authored'))).toBe(false);
  });

  it('styles railways, stations and trams in both themes', () => {
    for (const theme of Object.values(themes)) {
      const style = compileStyle(theme, options);
      expect(validateStyleMin(style)).toEqual([]);
      const ids = style.layers.map((l) => l.id);
      for (const id of [
        'rail-track',
        'rail-tunnel',
        'rail-viaduct-casing',
        'rail-subway',
        'rail-disused',
        'tram-line',
        'stations',
        'tram-stops',
        'rail-structures',
        'rail-crossings',
      ])
        expect(ids).toContain(id);
      // Rail draws above streets and buildings, below society overlays.
      expect(ids.indexOf('rail-track')).toBeGreaterThan(ids.indexOf('streets'));
      expect(ids.indexOf('rail-track')).toBeLessThan(ids.indexOf('overlay-wealth'));
    }
    const hidden = compileStyle(atlas, { ...options, layers: { rail: false } }).layers.find(
      (l) => l.id === 'rail-track',
    )!;
    expect(hidden.layout?.visibility).toBe('none');
  });

  it('styles facilities and their parts in both themes', () => {
    for (const theme of Object.values(themes)) {
      const style = compileStyle(theme, options);
      expect(validateStyleMin(style)).toEqual([]);
      const ids = style.layers.map((l) => l.id);
      for (const id of [
        'facilities',
        'facility-grounds',
        'facility-buildings',
        'facility-tanks',
        'facility-points',
        'facility-tracks',
        'access-roads',
      ])
        expect(ids).toContain(id);
      expect(ids.indexOf('facility-buildings')).toBeLessThan(ids.indexOf('rail-track'));
    }
  });

  it('keeps society overlays hidden unless enabled', () => {
    const off = compileStyle(atlas, options).layers.find((l) => l.id === 'overlay-wealth')!;
    expect(off.layout?.visibility).toBe('none');
    const on = compileStyle(atlas, { ...options, layers: { wealth: true } }).layers.find(
      (l) => l.id === 'overlay-wealth',
    )!;
    expect(on.layout?.visibility).toBe('visible');
  });

  it('honours layer visibility overrides', () => {
    const style = compileStyle(atlas, { ...options, layers: { hillshade: false, contours: false } });
    const hill = style.layers.find((l) => l.id === 'hillshade')!;
    expect(hill.layout?.visibility).toBe('none');
    const rivers = style.layers.find((l) => l.id === 'rivers')!;
    expect(rivers.layout?.visibility).toBe('visible');
  });

  it('fades and reorders the authored layers as the editor asks, and stays valid', () => {
    const editor = {
      authoredSourceId: 'authored',
      overlaySourceId: 'editor',
      annotationSourceId: 'annotations',
    };
    const plain = compileStyle(atlas, { ...options, editor });
    const styled = compileStyle(atlas, {
      ...options,
      editor,
      authored: { opacity: { street: 0.25, zone: 0 }, order: ['building', 'facility', 'street'] },
    });
    expect(validateStyleMin(styled)).toEqual([]);
    // Every authored style layer is still there, and only those moved.
    const ids = (s: typeof plain) => s.layers.map((l) => l.id);
    expect([...ids(styled)].sort()).toEqual([...ids(plain)].sort());
    const authoredIds = new Set(AUTHORED_STYLE_LAYERS.map((l) => l.id));
    expect(ids(styled).filter((i) => !authoredIds.has(i))).toEqual(
      ids(plain).filter((i) => !authoredIds.has(i)),
    );
    // Buildings are drawn under the streets, which the editor asked for.
    const order = ids(styled);
    expect(order.indexOf('authored-buildings')).toBeLessThan(order.indexOf('authored-lines'));
    // The fade is data-driven on the feature's own layer, so one style layer serves several.
    const lines = styled.layers.find((l) => l.id === 'authored-lines')!;
    expect(JSON.stringify(lines.paint)).toContain('0.25');
    expect(JSON.stringify(lines.paint)).toContain('match');
    // A style with nothing asked for is untouched.
    expect(compileStyle(atlas, { ...options, editor, authored: {} }).layers).toEqual(plain.layers);
  });

  it('ink theme references only patterns it defines', () => {
    const defined = new Set(ink.patterns.map((p) => p.id));
    for (const paint of Object.values(ink.landcover))
      if (paint.pattern) expect(defined.has(paint.pattern), paint.pattern).toBe(true);
    expect(defined.has('ink-water')).toBe(true);
    expect(compileStyle(ink, options).layers.some((l) => l.type === 'color-relief')).toBe(false);
    expect(compileStyle(atlas, options).layers.some((l) => l.type === 'color-relief')).toBe(true);
  });
});
