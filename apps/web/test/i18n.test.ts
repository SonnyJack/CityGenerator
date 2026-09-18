import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, translate } from '../src/i18n/index.js';

/** Every key the components ask `t()` for, found the same way a translator would: by reading the source. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const dirs = [join(__dirname, '../src/components'), join(__dirname, '../src/import')];
  const files = dirs.flatMap((d) => readdirSync(d).map((f) => join(d, f))).filter((f) => /\.tsx?$/.test(f));
  for (const file of files) {
    const s = readFileSync(file, 'utf8');
    for (const m of s.matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]!.replace(/\\'/g, "'"));
    for (const m of s.matchAll(/(?<![\w.])t\(\s*"([^"]*)"/g)) keys.add(m[1]!);
    for (const m of s.matchAll(/(?<![\w.])t\([^)]*?\?\s*'([^']*)'\s*:\s*'([^']*)'/g)) {
      keys.add(m[1]!);
      keys.add(m[2]!);
    }
    // Label tables rendered through t(...).
    if (/(EditorBar|GenerateDock|SettlementsPanel|EventsPanel)\.tsx$/.test(file)) {
      for (const m of s.matchAll(/\b(label|hint): '((?:[^'\\]|\\.)*)'/g)) keys.add(m[2]!);
    }
    if (/(GenerateDock|SettlementsPanel|EventsPanel)\.tsx$/.test(file)) {
      for (const m of s.matchAll(/^\s+\w+: '([A-Z][^']*)',$/gm)) keys.add(m[1]!);
      for (const m of s.matchAll(/KIND_LABELS[^=]*= \{([^}]*)\}/g))
        for (const k of m[1]!.matchAll(/'([^']*)'/g)) keys.add(k[1]!);
    }
    // Built-in registry names are translated when rendered.
    if (/GalleryPanel\.tsx$/.test(file)) for (const m of s.matchAll(/name: '([^']+)' \}/g)) keys.add(m[1]!);
  }
  keys.delete('');
  return keys;
}

describe('localisation', () => {
  const keys = usedKeys();
  it('finds the strings the UI asks for', () => {
    expect(keys.size).toBeGreaterThan(300);
    expect(keys.has('Gallery')).toBe(true);
    expect(keys.has('Remove {name} at {place}')).toBe(true);
  });
  for (const [locale, dict] of Object.entries(DICTIONARIES)) {
    it(`${locale} covers every UI string and nothing else`, () => {
      const missing = [...keys].filter((k) => !(k in dict));
      const stale = Object.keys(dict).filter((k) => !keys.has(k));
      expect(missing).toEqual([]);
      expect(stale).toEqual([]);
      // Placeholders survive translation.
      for (const [k, v] of Object.entries(dict)) {
        const want = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const got = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect({ key: k, placeholders: got }).toEqual({ key: k, placeholders: want });
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });
  }
  it('translates with placeholders and falls back to English', () => {
    expect(translate('fr', 'Remove {name} at {place}', { name: 'Port', place: 'Arkham' })).toBe(
      'Retirer Port à Arkham',
    );
    expect(translate('de', 'Gallery')).toBe('Galerie');
    expect(translate('es', 'No such key {x}', { x: 1 })).toBe('No such key 1');
    expect(translate('en', 'Gallery')).toBe('Gallery');
  });
});
