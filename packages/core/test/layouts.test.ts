import { describe, expect, it } from 'vitest';
import { FEATURE_TYPES, Rng, type FeatureSize, type LocalPart } from '../src/index.js';

/** The local (u, v) points a part covers: corners, circle extremes, line and polygon vertices. */
function extentOf(p: LocalPart): [number, number][] {
  switch (p.shape) {
    case 'rect': {
      const a = p.angle ?? 0;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([du, dv]) => {
        const x = (du! * p.lengthM) / 2;
        const y = (dv! * p.widthM) / 2;
        return [p.u + x * c - y * s, p.v + x * s + y * c] as [number, number];
      });
    }
    case 'circle':
      return [
        [p.u - p.radiusM, p.v],
        [p.u + p.radiusM, p.v],
        [p.u, p.v - p.radiusM],
        [p.u, p.v + p.radiusM],
      ];
    case 'point':
      return [[p.u, p.v]];
    default:
      return p.points;
  }
}

/** Parts built out over the water from a waterside front, which may reach past that edge. */
const SEAWARD = new Set(['pier', 'breakwater', 'berth', 'dock', 'slipway', 'basin', 'crane', 'ramp']);

describe('facility layouts', () => {
  it('keep every part inside the ground they were given, at every size, scale and year', () => {
    const problems: string[] = [];
    for (const type of FEATURE_TYPES) {
      const waterside = type.orientation === 'alignCoast' || type.orientation === 'alignRiver';
      const years = [type.years[0], 1890, 1925, 2020].filter((y) => y >= type.years[0] && y <= type.years[1]);
      for (const size of ['small', 'medium', 'large'] as FeatureSize[])
        for (const compression of [1, 0.6, 0.5 * 0.6])
          for (const year of years) {
            const [L0, W0] = type.footprint(size, { population: 20_000, year });
            const L = L0 * compression;
            const W = W0 * compression;
            const parts = type.layout({
              size,
              year,
              lengthM: L,
              widthM: W,
              compression,
              rng: new Rng(`${type.id}/${size}/${compression}/${year}`),
              host: null,
              front: waterside ? 'sea' : type.orientation === 'alignRail' ? 'rail' : 'town',
            });
            for (const p of parts) {
              if (waterside && SEAWARD.has(p.kind)) continue;
              const out = extentOf(p).filter(([u, v]) => Math.abs(u) > L / 2 + 1 || Math.abs(v) > W / 2 + 1);
              if (out.length)
                problems.push(
                  `${type.id} ${size} ×${compression} ${year}: ${p.kind}${p.name ? ` (${p.name})` : ''} reaches ${out
                    .map(([u, v]) => `(${u.toFixed(0)}, ${v.toFixed(0)})`)
                    .join(' ')} outside ${L.toFixed(0)}×${W.toFixed(0)}`,
                );
            }
          }
    }
    expect(problems).toEqual([]);
  });
});
