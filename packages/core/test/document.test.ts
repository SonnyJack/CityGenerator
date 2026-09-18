import { describe, expect, it } from 'vitest';
import {
  createDocument,
  documentJsonSchema,
  migrateDocument,
  parseDocument,
  serializeDocument,
  DocumentValidationError,
  MigrationError,
} from '../src/index.js';

const NOW = '2026-09-18T00:00:00.000Z';

describe('MapDocument', () => {
  it('creates a valid document with defaults', () => {
    const doc = createDocument({ now: NOW, seed: 'test' });
    expect(doc.version).toBe(3);
    expect(doc.spec.seed).toBe('test');
    expect(doc.spec.year).toBe(1925);
    expect(doc.spec.terrain.preset).toBe('coast');
    expect(doc.authored.features).toEqual([]);
  });

  it('round-trips through JSON unchanged', () => {
    const doc = createDocument({ now: NOW, seed: 'roundtrip', name: 'Round trip' });
    doc.authored.features.push({
      type: 'Feature',
      id: 'f1',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [100, 50],
        ],
      },
      properties: { layer: 'street', origin: 'authored', kind: 'local' },
    });
    const text = serializeDocument(doc);
    const back = parseDocument(text);
    expect(back).toEqual(doc);
    expect(serializeDocument(back)).toBe(text);
  });

  it('rejects invalid documents with readable issues', () => {
    expect(() => parseDocument('{"format":"citygen","version":2,"spec":{}}')).toThrow(
      DocumentValidationError,
    );
    try {
      parseDocument(
        '{"format":"citygen","version":2,"meta":{"created":"x","modified":"x"},"spec":{"seed":"","extent":{"widthM":1,"heightM":1},"year":1925}}',
      );
    } catch (e) {
      expect((e as DocumentValidationError).issues.join('\n')).toContain('spec.seed');
    }
    expect(() => parseDocument('not json')).toThrow(DocumentValidationError);
    expect(() => parseDocument('{"format":"other"}')).toThrow(MigrationError);
    expect(() => parseDocument('{"format":"citygen","version":99}')).toThrow(MigrationError);
  });

  it('migrates a version 1 draft document', () => {
    const v1 = {
      format: 'citygen',
      version: 1,
      spec: { seed: 'old', extent: { widthM: 4000, heightM: 4000 }, era: 'industrial', name: 'Old town' },
    };
    const migrated = migrateDocument(v1);
    expect(migrated.version).toBe(3);
    const doc = parseDocument(JSON.stringify(v1));
    expect(doc.spec.year).toBe(1850);
    expect(doc.spec.anchorYear).toBe(1850);
    expect(doc.spec.events).toEqual([]);
    expect(doc.meta.name).toBe('Old town');
    expect(doc.spec.seed).toBe('old');
  });

  it('exports a JSON Schema', () => {
    const schema = documentJsonSchema();
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).toContain('"seed"');
  });
});
