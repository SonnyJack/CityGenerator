import { describe, expect, it } from 'vitest';
import { createDocument, mapDocumentSchema, contentHash } from '@citygen/core';
import { CommandBus, ToolController, type Command, type ToolHost, type ToolId } from '../src/index.js';

/** Small deterministic generator for the fuzz test (the editor package bans Math.random). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const NOW = '2026-09-18T00:00:00.000Z';

describe('editor fuzz', () => {
  it('random command sequences keep the document valid and undo restores every step', () => {
    for (let round = 0; round < 6; round++) {
      const rnd = lcg(1000 + round);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const bus = new CommandBus(createDocument({ now: NOW, seed: `fuzz-${round}` }), { now: () => NOW });
      const hashes = [contentHash(bus.document)];
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const doc = bus.document;
        const ids = doc.authored.features.map((f) => f.id);
        const annIds = doc.annotations.map((a) => a.id);
        const choice = rnd();
        let cmd: Command;
        if (choice < 0.3 || (!ids.length && choice < 0.6)) {
          const x = rnd() * 5000;
          const y = rnd() * 5000;
          cmd = {
            type: 'authored.add',
            features: [
              {
                type: 'Feature',
                id: `f-${round}-${n++}`,
                geometry:
                  rnd() < 0.5
                    ? {
                        type: 'LineString',
                        coordinates: [
                          [x, y],
                          [x + rnd() * 300, y + rnd() * 300],
                        ],
                      }
                    : {
                        type: 'Polygon',
                        coordinates: [
                          [
                            [x, y],
                            [x + 40, y],
                            [x + 40, y + 30],
                            [x, y + 30],
                            [x, y],
                          ],
                        ],
                      },
                properties: {
                  layer: pick(['street', 'building', 'zone', 'water', 'terrainEdit'] as const),
                  origin: 'authored',
                  kind: 'k',
                },
              },
            ],
          };
        } else if (choice < 0.45) {
          cmd = {
            type: 'authored.update',
            id: pick(ids),
            properties: { name: `n${i}`, widthM: 4 + rnd() * 20 },
          };
        } else if (choice < 0.55) {
          cmd = { type: 'authored.remove', ids: [pick(ids)] };
        } else if (choice < 0.65) {
          cmd = {
            type: 'annotation.add',
            annotation: {
              id: `a-${round}-${n++}`,
              kind: pick(['label', 'marker', 'note'] as const),
              geometry: { type: 'Point', coordinates: [rnd() * 5000, rnd() * 5000] },
              text: 't',
              gmOnly: false,
            },
          };
        } else if (choice < 0.7 && annIds.length) {
          cmd = { type: 'annotation.remove', ids: [pick(annIds)] };
        } else if (choice < 0.8) {
          cmd = { type: 'year.set', year: 1100 + Math.floor(rnd() * 900) };
        } else if (choice < 0.9) {
          cmd = {
            type: 'override.add',
            override:
              rnd() < 0.5
                ? { op: 'reseed', target: 'region', salt: `s${i}` }
                : { op: 'suppress', target: `b-${i}` },
          };
        } else if (doc.overrides.length) {
          cmd = { type: 'override.remove', index: Math.floor(rnd() * doc.overrides.length) };
        } else {
          cmd = { type: 'meta.rename', name: `Region ${i}` };
        }
        bus.dispatch(cmd);
        expect(mapDocumentSchema.safeParse(bus.document).success).toBe(true);
        hashes.push(contentHash(bus.document));
      }
      // Undo all the way back, checking every intermediate state, then redo to the end.
      for (let i = hashes.length - 1; i > 0; i--) {
        expect(contentHash(bus.document)).toBe(hashes[i]);
        expect(bus.undo()).toBe(true);
      }
      expect(contentHash(bus.document)).toBe(hashes[0]);
      expect(bus.undo()).toBe(false);
      while (bus.redo()) {
        /* replay */
      }
      expect(contentHash(bus.document)).toBe(hashes[hashes.length - 1]);
    }
  });

  it('random pointer sequences through the tools never throw or corrupt the document', () => {
    const rnd = lcg(42);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const bus = new CommandBus(createDocument({ now: NOW, seed: 'fuzz-tools' }), { now: () => NOW });
    let n = 0;
    const host: ToolHost = {
      document: () => bus.document,
      dispatch: (c) => bus.dispatch(c),
      changed: () => {},
      newId: (prefix) => `${prefix}-${++n}`,
    };
    const tools = new ToolController(host);
    const toolIds: ToolId[] = [
      'navigate',
      'select',
      'line',
      'polygon',
      'rectangle',
      'point',
      'brush',
      'annotate',
    ];
    const pt = (): [number, number] => [Math.floor(rnd() * 2000), Math.floor(rnd() * 2000)];
    for (let i = 0; i < 1500; i++) {
      const r = rnd();
      if (r < 0.05) tools.setTool(pick(toolIds));
      else if (r < 0.1)
        tools.setOptions({
          layer: pick(['street', 'building', 'zone', 'rail', 'poi', 'water'] as const),
          brush: pick([
            'raise',
            'lower',
            'smooth',
            'flatten',
            'water',
            'wealth',
            'density',
            'zone',
            'erase',
            'reroll',
          ] as const),
          snapGridM: pick([0, 0, 10]),
          snapAngles: rnd() < 0.3,
          brushRadiusM: 20 + rnd() * 200,
        });
      else if (r < 0.4) tools.pointerDown(pt(), { shift: rnd() < 0.2 });
      else if (r < 0.7) tools.pointerMove(pt());
      else if (r < 0.85) tools.pointerUp(pt());
      else if (r < 0.9) tools.keyDown(pick(['Enter', 'Escape', 'Delete']));
      else if (r < 0.94)
        tools.transformSelection(
          pick(['rotate', 'scale', 'mirrorX', 'mirrorY'] as const),
          pick([Math.PI / 4, 1.5, 0.5]),
        );
      else if (r < 0.97) tools.insertVertexAt(pt());
      else if (r < 0.99) tools.removeVertexAt(pt());
      else {
        bus.undo();
        tools.reconcile();
      }
      expect(mapDocumentSchema.safeParse(bus.document).success).toBe(true);
      for (const id of tools.selection)
        expect(bus.document.authored.features.some((f) => f.id === id)).toBe(true);
    }
    expect(
      bus.document.authored.features.length + bus.document.annotations.length + bus.document.overrides.length,
    ).toBeGreaterThan(0);
  });
});
