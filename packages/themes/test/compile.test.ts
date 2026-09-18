import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { atlas, ink, compileStyle } from '../src/index.js';

describe('compileStyle', () => {
  it('produces valid MapLibre styles for every theme', () => {
    for (const theme of [atlas, ink]) {
      const style = compileStyle(theme, { sourceId: 'citygen', tileUrl: 'citygen://tiles/{z}/{x}/{y}' });
      const errors = validateStyleMin(style);
      expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
      expect(style.layers.map((l) => l.id)).toContain('region-outline');
    }
  });
});
