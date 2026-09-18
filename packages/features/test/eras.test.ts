import { describe, expect, it } from 'vitest';
import { eraForYear, eras, Registry, eraProfileSchema } from '../src/index.js';

describe('era profiles', () => {
  it('selects the nearest earlier profile', () => {
    expect(eraForYear(1925).id).toBe('era-1925');
    expect(eraForYear(1930).id).toBe('era-1925');
    expect(eraForYear(1100).id).toBe('era-1400');
    expect(eraForYear(2020).id).toBe('era-1985');
  });

  it('lists profiles in a deterministic order', () => {
    expect(eras.all().map((e) => e.id)).toEqual(['era-1400', 'era-1890', 'era-1925', 'era-1985']);
  });

  it('rejects duplicates and invalid entries', () => {
    const r = new Registry('era profile', eraProfileSchema);
    r.register(eras.get('era-1925'));
    expect(() => r.register(eras.get('era-1925'))).toThrow(/already registered/);
    expect(() => r.register({ id: 'bad' })).toThrow();
  });
});
