import { Rng } from '../random/rng.js';
import {
  area,
  ccw,
  centroid,
  distToSegment,
  longestEdge,
  open,
  orientedBox,
  splitByLine,
  type Pt,
} from '../geometry/polygon.js';
import type { Ring } from '../raster/contours.js';
import { plannedFloors, programmeFor, type RoomSpec } from './programme.js';

/**
 * Floor plans from a footprint: the polygon is cut recursively to the room
 * programme's area shares (front rooms take the street side), a stair well
 * sits in the same place on every floor, doors form a spanning tree from the
 * front door, windows line the exterior walls. Deterministic per building.
 */
export interface InteriorInput {
  id: string;
  footprint: Ring;
  floors: number;
  use: string;
  kind: string;
  year: number;
  /** Street-facing edge as [a, b]; the longest edge when omitted. */
  front?: [Pt, Pt];
}

export interface Room {
  id: string;
  name: string;
  ring: Ring;
  areaM2: number;
  /** Rooms this one opens into (by id), 'outside' for the front door. */
  connects: string[];
}

export interface Door {
  from: string;
  to: string;
  at: Pt;
  /** The wall segment the door sits in. */
  wall: [Pt, Pt];
  widthM: number;
  exterior: boolean;
}

export interface Window {
  at: Pt;
  wall: [Pt, Pt];
  widthM: number;
  room: string;
}

export interface WallSegment {
  a: Pt;
  b: Pt;
  exterior: boolean;
}

export interface FloorPlan {
  floor: number;
  name: string;
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  /** Wall segments with door openings cut out (line of sight for VTTs). */
  walls: WallSegment[];
  stairs: string | null;
}

export interface Interior {
  id: string;
  footprint: Ring;
  front: [Pt, Pt];
  floorHeightM: number;
  floors: FloorPlan[];
}

const MIN_ROOM_M2 = 4;

function cutByShare(poly: Ring, shareA: number, shareB: number, axisDir: Pt): { a: Ring; b: Ring } {
  // Cut perpendicular to axisDir at the position that gives the low side the wanted share of the area.
  const total = area(poly);
  const target = (total * shareA) / (shareA + shareB);
  const proj = (p: Pt) => p[0] * axisDir[0] + p[1] * axisDir[1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    lo = Math.min(lo, proj(p));
    hi = Math.max(hi, proj(p));
  }
  const perp: Pt = [-axisDir[1], axisDir[0]];
  let a = lo;
  let b = hi;
  let best = { a: poly, b: [] as Ring };
  for (let i = 0; i < 28; i++) {
    const t = (a + b) / 2;
    const p0: Pt = [axisDir[0] * t + perp[0] * 1e4, axisDir[1] * t + perp[1] * 1e4];
    const p1: Pt = [axisDir[0] * t - perp[0] * 1e4, axisDir[1] * t - perp[1] * 1e4];
    const { left, right } = splitByLine(poly, p1, p0);
    let low: Ring = [];
    let high: Ring = [];
    for (const r of [left, right]) {
      if (r.length < 3) continue;
      if (proj(centroid(r)) < t) low = r;
      else high = r;
    }
    best = { a: low, b: high };
    const al = low.length >= 3 ? area(low) : 0;
    if (al < target) a = t;
    else b = t;
  }
  return best;
}

function nearer(ring: Ring, p: Pt): number {
  const c = centroid(ring);
  return Math.hypot(c[0] - p[0], c[1] - p[1]);
}

/** Split a polygon at reflex vertices (along the incoming edge's line) until every piece is convex. */
export function convexParts(ring: Ring, depth = 0): Ring[] {
  const r = ccw(open(ring));
  const n = r.length;
  if (n < 4 || depth > 12) return [r];
  for (let i = 0; i < n; i++) {
    const p = r[(i + n - 1) % n]!;
    const c = r[i]!;
    const q = r[(i + 1) % n]!;
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (cross < -1e-6) {
      // Reflex: extend the incoming edge p→c through c.
      const dx = c[0] - p[0];
      const dy = c[1] - p[1];
      const far: Pt = [c[0] + dx * 1e4, c[1] + dy * 1e4];
      const back: Pt = [c[0] - dx * 1e4, c[1] - dy * 1e4];
      const { left, right } = splitByLine(r, back, far);
      if (left.length >= 3 && right.length >= 3 && area(left) > 0.5 && area(right) > 0.5)
        return [...convexParts(left, depth + 1), ...convexParts(right, depth + 1)];
    }
  }
  return [r];
}

/** Recursively partition a polygon into rooms by their shares; front rooms go to the front side. */
function partition(poly: Ring, specs: RoomSpec[], frontMid: Pt, out: { spec: RoomSpec; ring: Ring }[]): void {
  if (specs.length === 1 || area(poly) < MIN_ROOM_M2 * 2) {
    const merged =
      specs.length === 1 ? specs[0]! : { ...specs[0]!, name: specs.map((s) => s.name).join(' / ') };
    out.push({ spec: merged, ring: poly });
    return;
  }
  const total = specs.reduce((s, r) => s + r.share, 0);
  let acc = 0;
  let k = 1;
  for (let i = 0; i < specs.length - 1; i++) {
    acc += specs[i]!.share;
    k = i + 1;
    if (acc >= total / 2) break;
  }
  const groupA = specs.slice(0, k);
  const groupB = specs.slice(k);
  const shareA = groupA.reduce((s, r) => s + r.share, 0);
  const shareB = groupB.reduce((s, r) => s + r.share, 0);
  const box = orientedBox(poly);
  // Which end of the axis faces the street decides where the front rooms' group goes; the cut
  // then gives that side the group's share.
  const proj = (p: Pt) => p[0] * box.axis[0] + p[1] * box.axis[1];
  const frontLow = proj(frontMid) < proj(centroid(poly));
  const aToFront = groupA.some((s) => s.front) || !groupB.some((s) => s.front);
  const aLow = aToFront ? frontLow : !frontLow;
  const cut = aLow ? cutByShare(poly, shareA, shareB, box.axis) : cutByShare(poly, shareB, shareA, box.axis);
  const ringA = aLow ? cut.a : cut.b;
  const ringB = aLow ? cut.b : cut.a;
  if (ringA.length < 3 || ringB.length < 3) {
    out.push({ spec: { ...specs[0]!, name: specs.map((s) => s.name).join(' / ') }, ring: poly });
    return;
  }
  partition(ringA, groupA, frontMid, out);
  partition(ringB, groupB, frontMid, out);
}

/** Shared wall between two rooms: the overlap of collinear edges, or null. */
function sharedWall(r1: Ring, r2: Ring): [Pt, Pt] | null {
  let best: [Pt, Pt] | null = null;
  let bestLen = 0.8;
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i]!;
    const b = r1[(i + 1) % r1.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    for (let j = 0; j < r2.length; j++) {
      const c = r2[j]!;
      const d = r2[(j + 1) % r2.length]!;
      if (distToSegment(c, a, b) > 0.05 && distToSegment(d, a, b) > 0.05) {
        // Not collinear with this edge unless both endpoints lie on the line.
        continue;
      }
      // Both c and d must lie on the infinite line of a-b.
      const cross = (p: Pt) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
      if (cross(c) > 0.05 || cross(d) > 0.05) continue;
      const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy;
      const td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy;
      const lo = Math.max(0, Math.min(tc, td));
      const hi = Math.min(len, Math.max(tc, td));
      if (hi - lo > bestLen) {
        bestLen = hi - lo;
        best = [
          [a[0] + ux * lo, a[1] + uy * lo],
          [a[0] + ux * hi, a[1] + uy * hi],
        ];
      }
    }
  }
  return best;
}

function onBoundary(a: Pt, b: Pt, footprint: Ring): boolean {
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let i = 0; i < footprint.length; i++) {
    if (distToSegment(mid, footprint[i]!, footprint[(i + 1) % footprint.length]!) < 0.05) return true;
  }
  return false;
}

/** Cut door openings out of a wall segment. */
function cutOpenings(a: Pt, b: Pt, doors: Door[]): [Pt, Pt][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const spans: [number, number][] = [];
  for (const d of doors) {
    if (distToSegment(d.at, a, b) > 0.05) continue;
    const t = (d.at[0] - a[0]) * ux + (d.at[1] - a[1]) * uy;
    spans.push([Math.max(0, t - d.widthM / 2), Math.min(len, t + d.widthM / 2)]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const out: [Pt, Pt][] = [];
  let cur = 0;
  for (const [s, e] of spans) {
    if (s > cur + 0.05)
      out.push([
        [a[0] + ux * cur, a[1] + uy * cur],
        [a[0] + ux * s, a[1] + uy * s],
      ]);
    cur = Math.max(cur, e);
  }
  if (len > cur + 0.05)
    out.push([
      [a[0] + ux * cur, a[1] + uy * cur],
      [a[0] + ux * len, a[1] + uy * len],
    ]);
  return out;
}

export function generateInterior(input: InteriorInput): Interior {
  const footprint = ccw(open(input.footprint));
  const rng = new Rng(`${input.id}/interior`);
  const total = area(footprint);
  const le = longestEdge(footprint);
  const front: [Pt, Pt] = input.front ?? [
    footprint[le.index]!,
    footprint[(le.index + 1) % footprint.length]!,
  ];
  const frontMid: Pt = [(front[0][0] + front[1][0]) / 2, (front[0][1] + front[1][1]) / 2];
  const count = plannedFloors(input.use, input.floors);
  const floorHeightM = input.year < 1900 ? 3.0 : input.year < 1960 ? 3.2 : 2.8;

  // Stair well: a fixed strip at the back for multi-storey buildings, the same on every floor.
  let stairRing: Ring | null = null;
  let body = footprint;
  if (count > 1 && total > 30) {
    const box = orientedBox(footprint);
    const stairArea = Math.min(Math.max(6, total * 0.08), 24);
    const { a, b } = cutByShare(footprint, stairArea, total - stairArea, box.axis);
    const [near, far] = nearer(a, frontMid) <= nearer(b, frontMid) ? [a, b] : [b, a];
    // The back strip: whichever piece is farther from the front, provided it is the small one.
    if (area(far) <= area(near) && far.length >= 3 && near.length >= 3) {
      stairRing = far;
      body = near;
    } else if (a.length >= 3 && b.length >= 3) {
      stairRing = area(a) < area(b) ? a : b;
      body = area(a) < area(b) ? b : a;
    }
  }

  const floors: FloorPlan[] = [];
  for (let floor = 0; floor < count; floor++) {
    const prog = programmeFor(input.use, input.kind, floor, count, area(body), input.year);
    // Shuffle the non-front rooms a little so twin houses differ.
    const specs = [...prog.rooms];
    const frontRooms = specs.filter((s) => s.front);
    const rest = specs.filter((s) => !s.front);
    const shuffled = rng.fork(`floor:${floor}`).shuffle(rest);
    const ordered = [...frontRooms, ...shuffled];
    // Merge until each room can be at least the minimum size.
    while (ordered.length > 1 && area(body) / ordered.length < MIN_ROOM_M2 * 1.5) ordered.pop();
    const pieces: { spec: RoomSpec; ring: Ring }[] = [];
    // Concave footprints are cut into convex parts first, nearest the front first; each part takes a run of
    // the programme in proportion to its area.
    const parts = convexParts(body).sort((x, y) => nearer(x, frontMid) - nearer(y, frontMid));
    if (parts.length === 1) partition(body, ordered, frontMid, pieces);
    else {
      const totalShare = ordered.reduce((s, r) => s + r.share, 0);
      const totalArea = parts.reduce((s, r) => s + area(r), 0);
      let from = 0;
      parts.forEach((part, pi) => {
        const want = (area(part) / totalArea) * totalShare;
        let acc = 0;
        let to = from;
        while (to < ordered.length && (acc < want || pi === parts.length - 1)) {
          acc += ordered[to]!.share;
          to++;
          if (pi < parts.length - 1 && acc >= want) break;
        }
        if (to === from && from < ordered.length) to = from + 1;
        const specs = ordered.slice(from, to);
        from = to;
        if (!specs.length) {
          pieces.push({ spec: { name: pi === 0 ? 'hall' : 'store', share: 1 }, ring: part });
          return;
        }
        partition(part, specs, frontMid, pieces);
      });
    }
    const rooms: Room[] = pieces.map((p, i) => ({
      id: `${input.id}/f${floor}/r${i}`,
      name: p.spec.name,
      ring: p.ring,
      areaM2: Math.round(area(p.ring) * 10) / 10,
      connects: [],
    }));
    let stairs: string | null = null;
    if (stairRing) {
      rooms.push({
        id: `${input.id}/f${floor}/stairs`,
        name: floor === 0 ? 'hall and stairs' : 'landing and stairs',
        ring: stairRing,
        areaM2: Math.round(area(stairRing) * 10) / 10,
        connects: [],
      });
      stairs = rooms[rooms.length - 1]!.id;
    }
    // Doors: front door on the ground floor into the front-most room; then a spanning tree over shared walls.
    const doors: Door[] = [];
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const frontRoom = rooms.reduce(
      (best, r) => (nearer(r.ring, frontMid) < nearer(best.ring, frontMid) ? r : best),
      rooms[0]!,
    );
    if (floor === 0) {
      // The front door sits on the room's edge nearest the front-edge midpoint.
      let bestEdge: [Pt, Pt] | null = null;
      let bestD = Infinity;
      for (let i = 0; i < frontRoom.ring.length; i++) {
        const a = frontRoom.ring[i]!;
        const b = frontRoom.ring[(i + 1) % frontRoom.ring.length]!;
        if (!onBoundary(a, b, footprint)) continue;
        const d = distToSegment(frontMid, a, b);
        if (d < bestD) {
          bestD = d;
          bestEdge = [a, b];
        }
      }
      if (bestEdge) {
        const at: Pt = [(bestEdge[0][0] + bestEdge[1][0]) / 2, (bestEdge[0][1] + bestEdge[1][1]) / 2];
        doors.push({ from: 'outside', to: frontRoom.id, at, wall: bestEdge, widthM: 1.1, exterior: true });
        frontRoom.connects.push('outside');
      }
    }
    // Adjacency and spanning tree (BFS from the stairs on upper floors, from the front room below).
    const adj = new Map<string, { other: string; wall: [Pt, Pt] }[]>();
    for (const r of rooms) adj.set(r.id, []);
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        const w = sharedWall(rooms[i]!.ring, rooms[j]!.ring);
        if (!w) continue;
        adj.get(rooms[i]!.id)!.push({ other: rooms[j]!.id, wall: w });
        adj.get(rooms[j]!.id)!.push({ other: rooms[i]!.id, wall: [w[1], w[0]] });
      }
    const start = floor > 0 && stairs ? stairs : frontRoom.id;
    const seen = new Set<string>([start]);
    const queue = [start];
    // Halls, corridors and passages connect to everything they touch; other rooms take one door.
    const hub = (id: string) => /hall|corridor|passage|lobby|stair|landing|foyer/.test(byId.get(id)!.name);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const { other, wall } of adj.get(cur)!) {
        if (seen.has(other)) continue;
        seen.add(other);
        const at: Pt = [(wall[0][0] + wall[1][0]) / 2, (wall[0][1] + wall[1][1]) / 2];
        doors.push({ from: cur, to: other, at, wall, widthM: 0.9, exterior: false });
        byId.get(cur)!.connects.push(other);
        byId.get(other)!.connects.push(cur);
        if (hub(other)) queue.unshift(other);
        else queue.push(other);
      }
    }
    // Rooms left unreached share no wall long enough: open a door on the longest contact anyway.
    for (const r of rooms)
      if (!seen.has(r.id)) {
        const s = seen.values().next().value as string;
        const w = sharedWall(r.ring, byId.get(s)!.ring) ?? [r.ring[0]!, r.ring[1]!];
        doors.push({
          from: s,
          to: r.id,
          at: [(w[0][0] + w[1][0]) / 2, (w[0][1] + w[1][1]) / 2],
          wall: w,
          widthM: 0.9,
          exterior: false,
        });
        r.connects.push(s);
        seen.add(r.id);
      }
    // Windows along exterior walls, about every 3 m, not where a door is.
    const windows: Window[] = [];
    for (const r of rooms) {
      const spec = pieces.find((p) => p.ring === r.ring)?.spec;
      if (spec?.blind) continue;
      for (let i = 0; i < r.ring.length; i++) {
        const a = r.ring[i]!;
        const b = r.ring[(i + 1) % r.ring.length]!;
        if (!onBoundary(a, b, footprint)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.floor(len / 3);
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n) * len;
          const at: Pt = [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
          if (doors.some((d) => Math.hypot(d.at[0] - at[0], d.at[1] - at[1]) < 1.2)) continue;
          windows.push({ at, wall: [a, b], widthM: 1, room: r.id });
        }
      }
    }
    // Walls: every room edge once, with door openings cut out.
    const walls: WallSegment[] = [];
    const seenWalls = new Set<string>();
    const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    for (const r of rooms)
      for (let i = 0; i < r.ring.length; i++) {
        const a = r.ring[i]!;
        const b = r.ring[(i + 1) % r.ring.length]!;
        const k1 = `${key(a)}|${key(b)}`;
        const k2 = `${key(b)}|${key(a)}`;
        if (seenWalls.has(k1) || seenWalls.has(k2)) continue;
        seenWalls.add(k1);
        const exterior = onBoundary(a, b, footprint);
        for (const [p, q] of cutOpenings(a, b, doors)) walls.push({ a: p, b: q, exterior });
      }
    floors.push({ floor, name: prog.name, rooms, doors, windows, walls, stairs });
  }
  return { id: input.id, footprint, front, floorHeightM, floors };
}
