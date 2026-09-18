import { describe, expect, it } from 'vitest';
import { area, contentHash, generateInterior, pointInRing, type Ring } from '../src/index.js';

const rect = (w: number, h: number, x = 0, y = 0): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
// An L-shaped footprint.
const ell: Ring = [
  [0, 0],
  [14, 0],
  [14, 9],
  [8, 9],
  [8, 15],
  [0, 15],
];

function connected(rooms: { id: string; connects: string[] }[]): boolean {
  if (!rooms.length) return true;
  const seen = new Set([rooms[0]!.id]);
  const queue = [rooms[0]!.id];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  while (queue.length) {
    const cur = byId.get(queue.shift()!)!;
    for (const o of cur.connects) {
      if (o === 'outside' || seen.has(o)) continue;
      seen.add(o);
      queue.push(o);
    }
  }
  return seen.size === rooms.length;
}

describe('building interiors', () => {
  it('cuts a house into rooms that tile the footprint, connected from a front door, with windows on outside walls', () => {
    const house = generateInterior({
      id: 'h1',
      footprint: rect(9, 12),
      floors: 2,
      use: 'residential',
      kind: 'house',
      year: 1925,
    });
    expect(house.floors).toHaveLength(2);
    for (const f of house.floors) {
      const sum = f.rooms.reduce((s, r) => s + area(r.ring), 0);
      expect(Math.abs(sum - 108)).toBeLessThan(0.5);
      for (const r of f.rooms) expect(area(r.ring)).toBeGreaterThan(3);
      expect(connected(f.rooms)).toBe(true);
      expect(f.windows.length).toBeGreaterThan(3);
      for (const w of f.windows)
        expect(w.at[0] === 0 || w.at[0] === 9 || w.at[1] === 0 || w.at[1] === 12).toBe(true);
      expect(f.walls.some((w) => w.exterior)).toBe(true);
      expect(f.walls.some((w) => !w.exterior)).toBe(true);
    }
    const ground = house.floors[0]!;
    expect(ground.doors.filter((d) => d.exterior)).toHaveLength(1);
    expect(ground.rooms.map((r) => r.name)).toEqual(
      expect.arrayContaining(['parlour', 'kitchen', 'hall and stairs']),
    );
    expect(house.floors[1]!.rooms.some((r) => r.name.includes('bedroom'))).toBe(true);
    expect(house.floors[1]!.doors.filter((d) => d.exterior)).toHaveLength(0);
    // The stairs sit in the same place on both floors.
    expect(contentHash(ground.rooms.find((r) => r.id.endsWith('stairs'))!.ring)).toBe(
      contentHash(house.floors[1]!.rooms.find((r) => r.id.endsWith('stairs'))!.ring),
    );
    // The front door is on the longest (street) edge.
    const door = ground.doors.find((d) => d.exterior)!;
    expect(Math.min(Math.abs(door.at[0]), Math.abs(door.at[0] - 9))).toBeLessThan(0.01);
    // Every door lies on a wall of both rooms it joins.
    for (const d of ground.doors.filter((x) => !x.exterior)) {
      const from = ground.rooms.find((r) => r.id === d.from)!;
      const to = ground.rooms.find((r) => r.id === d.to)!;
      const near = (r: Ring) =>
        r.some((p, i) => {
          const q = r[(i + 1) % r.length]!;
          const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
          const t = ((d.at[0] - p[0]) * (q[0] - p[0]) + (d.at[1] - p[1]) * (q[1] - p[1])) / (l * l);
          const cx = p[0] + (q[0] - p[0]) * Math.max(0, Math.min(1, t));
          const cy = p[1] + (q[1] - p[1]) * Math.max(0, Math.min(1, t));
          return Math.hypot(cx - d.at[0], cy - d.at[1]) < 0.1;
        });
      expect(near(from.ring) && near(to.ring)).toBe(true);
    }
  });

  it('is deterministic and follows the use: a pub, a bank, a church and a tenement', () => {
    const a = generateInterior({
      id: 'p',
      footprint: rect(12, 16),
      floors: 3,
      use: 'pub',
      kind: 'shophouse',
      year: 1890,
    });
    const b = generateInterior({
      id: 'p',
      footprint: rect(12, 16),
      floors: 3,
      use: 'pub',
      kind: 'shophouse',
      year: 1890,
    });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(a.floors[0]!.rooms.map((r) => r.name)).toEqual(
      expect.arrayContaining(['public bar', 'saloon bar', 'kitchen']),
    );
    expect(a.floors[1]!.rooms.filter((r) => r.name.startsWith('guest room')).length).toBeGreaterThan(1);
    const bank = generateInterior({
      id: 'b',
      footprint: rect(18, 14),
      floors: 2,
      use: 'bank',
      kind: 'commercial',
      year: 1925,
    });
    const strong = bank.floors[0]!.rooms.find((r) => r.name === 'strongroom')!;
    expect(strong).toBeDefined();
    expect(bank.floors[0]!.windows.some((w) => w.room === strong.id)).toBe(false);
    const church = generateInterior({
      id: 'c',
      footprint: rect(12, 30),
      floors: 3,
      use: 'church',
      kind: 'church',
      year: 1650,
    });
    expect(church.floors).toHaveLength(1);
    expect(church.floors[0]!.rooms.map((r) => r.name)).toEqual(
      expect.arrayContaining(['nave', 'chancel', 'porch']),
    );
    const nave = church.floors[0]!.rooms.find((r) => r.name === 'nave')!;
    expect(nave.areaM2).toBeGreaterThan(church.floors[0]!.rooms.find((r) => r.name === 'vestry')!.areaM2 * 3);
    const tenement = generateInterior({
      id: 't',
      footprint: rect(16, 20),
      floors: 5,
      use: 'residential',
      kind: 'tenement',
      year: 1900,
    });
    expect(tenement.floors).toHaveLength(5);
    expect(tenement.floors[2]!.rooms.some((r) => /^flat [A-Z] living room$/.test(r.name))).toBe(true);
  });

  it('handles concave and tiny footprints without gaps or crashes', () => {
    const shop = generateInterior({
      id: 'l',
      footprint: ell,
      floors: 2,
      use: 'cornerShop',
      kind: 'shophouse',
      year: 1910,
    });
    for (const f of shop.floors) {
      const sum = f.rooms.reduce((s, r) => s + area(r.ring), 0);
      expect(Math.abs(sum - area(ell))).toBeLessThan(1);
      expect(connected(f.rooms)).toBe(true);
      for (const r of f.rooms) {
        const c = r.ring.reduce((a, p) => [a[0] + p[0] / r.ring.length, a[1] + p[1] / r.ring.length], [0, 0]);
        expect(pointInRing(c[0]!, c[1]!, ell)).toBe(true);
      }
    }
    const shack = generateInterior({
      id: 's',
      footprint: rect(3, 4),
      floors: 1,
      use: 'residential',
      kind: 'shack',
      year: 1850,
    });
    expect(shack.floors[0]!.rooms.length).toBeGreaterThanOrEqual(1);
    expect(shack.floors[0]!.doors.some((d) => d.exterior)).toBe(true);
  });
});
