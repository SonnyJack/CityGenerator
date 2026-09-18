import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { atlas, ink, compileStyle, themes } from '../src/index.js';

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

  it('honours layer visibility overrides', () => {
    const style = compileStyle(atlas, { ...options, layers: { hillshade: false, contours: false } });
    const hill = style.layers.find((l) => l.id === 'hillshade')!;
    expect(hill.layout?.visibility).toBe('none');
    const rivers = style.layers.find((l) => l.id === 'rivers')!;
    expect(rivers.layout?.visibility).toBe('visible');
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
