import { describe, expect, it } from 'vitest';
import {
  clearAlongLines,
  settleTownOverlaps,
  stopAtTowns,
  type BlockRecipe,
  type TownOutput,
} from '../src/index.js';

type Pt = [number, number];
const square = (x: number, y: number, s: number): Pt[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

/** A town of square patches, each with its block (the patch itself, for simplicity). */
function town(id: string, squares: { n: number; at: Pt; size: number; built: number }[]): TownOutput {
  const patches = squares.map((q) => ({
    type: 'Feature' as const,
    id: `${id}-patch-${q.n}`,
    geometry: { type: 'Polygon' as const, coordinates: [[...square(q.at[0], q.at[1], q.size), q.at]] },
    properties: { settlement: id, ward: 'rowhouse', inner: true, ring: 0, why: '', built: q.built },
  }));
  const blocks: BlockRecipe[] = squares.map((q) => ({
    id: `${id}-b${q.n}`,
    settlementId: id,
    ring: square(q.at[0], q.at[1], q.size),
    ward: 'rowhouse',
    areaM2: q.size * q.size,
    seed: `${id}/${q.n}`,
    elevationM: 0,
    builtYear: q.built,
  }));
  return { id, blocks, patches: { type: 'FeatureCollection', features: patches } } as unknown as TownOutput;
}

describe('towns that grow into each other', () => {
  it('leave the older ground as it was and clear or drop the newer', () => {
    const village = town('v', [{ n: 0, at: [0, 0], size: 100, built: 1300 }]);
    const city = town('c', [
      // Runs onto the village's square by 20 m: cleared there, kept elsewhere.
      { n: 1, at: [80, 0], size: 100, built: 1890 },
      // Stands on it: dropped with its patch.
      { n: 2, at: [10, 10], size: 60, built: 1890 },
      // Clear of it: untouched.
      { n: 3, at: [300, 0], size: 100, built: 1890 },
    ]);
    const [c, v] = settleTownOverlaps([city, village]);
    // The village is older everywhere, so it is untouched, whatever order the towns come in.
    expect(v).toBe(village);
    expect(c!.blocks.map((b) => b.id)).toEqual(['c-b1', 'c-b3']);
    expect(c!.patches.features.map((f) => f.id)).toEqual(['c-patch-1', 'c-patch-3']);
    expect(c!.blocks[0]!.clear).toHaveLength(1);
    expect(c!.blocks[1]!.clear).toBeUndefined();
    // The drawn patch is cut back to the village's edge.
    const xs = c!.patches.features[0]!.geometry.coordinates[0]!.map((p) => p[0]!);
    expect(Math.min(...xs)).toBeCloseTo(100);
    // Towns that do not touch are returned as they were.
    const far = town('f', [{ n: 0, at: [5000, 0], size: 100, built: 1500 }]);
    const [a, b] = settleTownOverlaps([village, far]);
    expect(a).toBe(village);
    expect(b).toBe(far);
  });
});

describe('lines through towns', () => {
  const t = town('t', [
    { n: 0, at: [0, 0], size: 100, built: 1300 },
    { n: 1, at: [300, 0], size: 100, built: 1300 },
  ]);

  it('clear the buildings in a railway corridor and leave the blocks it misses alone', () => {
    const [cleared] = clearAlongLines(
      [t],
      [
        {
          points: [
            [-50, 50],
            [150, 50],
          ],
          halfWidthM: 5,
        },
      ],
    );
    expect(cleared!.blocks[0]!.clear).toHaveLength(1);
    expect(cleared!.blocks[1]!.clear).toBeUndefined();
    // The blocks themselves stay: the line takes its bed out of them, not the whole block.
    expect(cleared!.blocks.map((b) => b.ring)).toEqual(t.blocks.map((b) => b.ring));
    // No line, or a line clear of the town: the town comes back as it was.
    expect(clearAlongLines([t], [])[0]).toBe(t);
    expect(
      clearAlongLines(
        [t],
        [
          {
            points: [
              [0, 500],
              [400, 500],
            ],
            halfWidthM: 5,
          },
        ],
      )[0],
    ).toBe(t);
  });

  it('stop a road at the built-up ground and carry on past it', () => {
    const road = {
      id: 'r1',
      geometry: {
        coordinates: [
          [-200, 50],
          [600, 50],
        ],
      },
      properties: { class: 'main' },
    };
    const runs = stopAtTowns([road], [t]);
    // Outside, between the two patches, and beyond: three runs, the first keeping the id.
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r1#1', 'r1#2']);
    expect(runs[0]!.geometry.coordinates.at(-1)![0]).toBeLessThan(5);
    expect(runs[1]!.geometry.coordinates[0]![0]).toBeGreaterThan(95);
    expect(runs.every((r) => r.properties === road.properties)).toBe(true);
    // A road that misses the town is returned as it was.
    const clear = {
      ...road,
      geometry: {
        coordinates: [
          [-200, 500],
          [600, 500],
        ],
      },
    };
    expect(stopAtTowns([clear], [t])[0]).toBe(clear);
  });
});
