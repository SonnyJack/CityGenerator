import { describe, expect, it } from 'vitest';
import { createDocument } from '@citygen/core';
import { CommandBus, CommandError } from '../src/index.js';

const NOW = '2026-09-18T00:00:00.000Z';
const bus = () =>
  new CommandBus(createDocument({ now: NOW, seed: 'bus' }), { now: () => '2026-09-18T01:00:00.000Z' });

describe('CommandBus', () => {
  it('applies commands immutably and records history', () => {
    const b = bus();
    const before = b.document;
    b.dispatch({ type: 'meta.rename', name: 'Arkham' });
    expect(b.document.meta.name).toBe('Arkham');
    expect(before.meta.name).toBe('Untitled region');
    expect(b.document.meta.modified).toBe('2026-09-18T01:00:00.000Z');
    expect(b.canUndo).toBe(true);
  });

  it('undoes and redoes with inverse patches', () => {
    const b = bus();
    b.dispatch({ type: 'year.set', year: 1890 });
    b.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id: 'road-1',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [10, 10],
            ],
          },
          properties: { layer: 'street', origin: 'authored' },
        },
      ],
    });
    expect(b.document.authored.features).toHaveLength(1);
    expect(b.undo()).toBe(true);
    expect(b.document.authored.features).toHaveLength(0);
    expect(b.document.spec.year).toBe(1890);
    expect(b.undo()).toBe(true);
    expect(b.document.spec.year).toBe(1925);
    expect(b.undo()).toBe(false);
    expect(b.redo()).toBe(true);
    expect(b.document.spec.year).toBe(1890);
    expect(b.redo()).toBe(true);
    expect(b.document.authored.features).toHaveLength(1);
    expect(b.redo()).toBe(false);
  });

  it('clears redo on a new command', () => {
    const b = bus();
    b.dispatch({ type: 'year.set', year: 1890 });
    b.undo();
    b.dispatch({ type: 'year.set', year: 1955 });
    expect(b.canRedo).toBe(false);
  });

  it('rejects invalid commands and leaves the document unchanged', () => {
    const b = bus();
    expect(() => b.dispatch({ type: 'year.set', year: 900 })).toThrow(CommandError);
    expect(() => b.dispatch({ type: 'nope' })).toThrow(CommandError);
    expect(() => b.dispatch({ type: 'authored.remove', ids: [] })).toThrow(CommandError);
    expect(b.document.spec.year).toBe(1925);
    expect(b.canUndo).toBe(false);
  });

  it('rejects commands whose result would be invalid', () => {
    const b = bus();
    expect(() =>
      b.dispatch({ type: 'spec.patch', ops: [{ op: 'replace', path: '/extent/widthM', value: -5 }] }),
    ).toThrow();
    expect(b.document.spec.extent.widthM).toBe(20_000);
  });

  it('patches the spec with JSON Patch', () => {
    const b = bus();
    b.dispatch({ type: 'spec.patch', ops: [{ op: 'replace', path: '/terrain/preset', value: 'bay' }] });
    expect(b.document.spec.terrain.preset).toBe('bay');
  });

  it('adds, updates and removes settlements', () => {
    const b = bus();
    b.dispatch({
      type: 'settlement.add',
      settlement: {
        id: 'arkham',
        kind: 'city',
        population: 20000,
        layout: { streetPattern: 'organic' },
        features: [],
      },
    });
    b.dispatch({ type: 'settlement.update', id: 'arkham', patch: { population: 25000, name: 'Arkham' } });
    expect(b.document.spec.settlements[0]!.population).toBe(25000);
    expect(b.document.spec.settlements[0]!.name).toBe('Arkham');
    expect(() =>
      b.dispatch({
        type: 'settlement.add',
        settlement: {
          id: 'arkham',
          kind: 'town',
          population: 1,
          layout: { streetPattern: 'mixed' },
          features: [],
        },
      }),
    ).toThrow(/already exists/);
    b.dispatch({ type: 'settlement.remove', id: 'arkham' });
    expect(b.document.spec.settlements).toHaveLength(0);
    b.undo();
    expect(b.document.spec.settlements).toHaveLength(1);
  });

  it('sets presentation state without history', () => {
    const b = bus();
    b.dispatch({ type: 'ui.set', theme: 'ink', layers: { contours: false } });
    expect(b.document.ui?.theme).toBe('ink');
    expect(b.document.ui?.layers.contours).toBe(false);
    expect(b.canUndo).toBe(false);
  });

  it('keeps viewport changes out of history', () => {
    const b = bus();
    b.dispatch({ type: 'viewport.set', viewport: { center: [0, 0], zoom: 10, bearing: 0, pitch: 0 } });
    expect(b.canUndo).toBe(false);
    expect(b.document.viewport?.zoom).toBe(10);
  });

  it('notifies subscribers', () => {
    const b = bus();
    const kinds: string[] = [];
    b.subscribe((_d, e) => kinds.push(e.kind));
    b.dispatch({ type: 'year.set', year: 1890 });
    b.undo();
    b.redo();
    b.load(createDocument({ now: NOW }));
    expect(kinds).toEqual(['command', 'undo', 'redo', 'load']);
  });
});
