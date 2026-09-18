import { describe, expect, it } from 'vitest';
import { eraForYear, eraForYearInterpolated, eras, Registry, eraProfileSchema } from '../src/index.js';

describe('era profiles', () => {
  it('selects the nearest earlier profile', () => {
    expect(eraForYear(1925).id).toBe('era-1925');
    expect(eraForYear(1930).id).toBe('era-1925');
    expect(eraForYear(1100).id).toBe('era-1100');
    expect(eraForYear(1050).id).toBe('era-1100');
    expect(eraForYear(2020).id).toBe('era-2020');
    expect(eraForYear(2050).id).toBe('era-2020');
  });

  it('lists profiles in a deterministic order', () => {
    expect(eras.all().map((e) => e.id)).toEqual([
      'era-1100',
      'era-1400',
      'era-1650',
      'era-1780',
      'era-1850',
      'era-1890',
      'era-1925',
      'era-1955',
      'era-1985',
      'era-2020',
    ]);
  });

  it('interpolates numeric fields between profiles', () => {
    const mid = eraForYearInterpolated(1940);
    expect(mid.year).toBe(1925);
    expect(mid.densityPerKm2).toBeGreaterThan(5000);
    expect(mid.densityPerKm2).toBeLessThan(7000);
    expect(mid.ringPattern).toBe('streetcar');
  });

  it('rejects duplicates and invalid entries', () => {
    const r = new Registry('era profile', eraProfileSchema);
    r.register(eras.get('era-1925'));
    expect(() => r.register(eras.get('era-1925'))).toThrow(/already registered/);
    expect(() => r.register({ id: 'bad' })).toThrow();
  });
});
