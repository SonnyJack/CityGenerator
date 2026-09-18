import type { Feature, Polygon } from 'geojson';
import { clipToFrame, frameHeight, frameWidth, type ExportModel, type Frame } from './model.js';

/**
 * glTF 2.0 binary (GLB) of a frame: a terrain mesh from the height grid,
 * buildings extruded by their floors (sitting on the terrain), and water as
 * flat sheets at sea level. Metres, y up, x east, z south (right-handed), the
 * frame's centre at the origin. One material per kind; no textures, so any
 * viewer or 3D printer slicer opens it.
 */
export interface HeightGrid {
  cols: number;
  rows: number;
  /** Metres between samples; the grid covers the frame from its south-west corner. */
  cellM: number;
  /** Row-major, south to north. */
  data: number[];
  seaLevelM: number;
}

export interface GltfOptions {
  floorHeightM?: number;
  /** Vertical exaggeration of the terrain. */
  exaggeration?: number;
  /** Include the terrain mesh (default true). */
  terrain?: boolean;
  /** Include water sheets (default true). */
  water?: boolean;
}

interface Mesh {
  name: string;
  color: [number, number, number, number];
  positions: number[];
  normals: number[];
  indices: number[];
}

const COLOURS: Record<string, [number, number, number, number]> = {
  terrain: [0.72, 0.7, 0.58, 1],
  water: [0.55, 0.7, 0.85, 1],
  building: [0.74, 0.62, 0.5, 1],
  cbd: [0.6, 0.55, 0.5, 1],
  industrial: [0.5, 0.48, 0.46, 1],
  ruin: [0.55, 0.52, 0.48, 1],
  facility: [0.62, 0.6, 0.56, 1],
};

function sampleHeight(grid: HeightGrid, frame: Frame, x: number, y: number): number {
  const fx = (x - frame.minX) / grid.cellM;
  const fy = (y - frame.minY) / grid.cellM;
  const c = Math.min(Math.max(fx, 0), grid.cols - 1);
  const r = Math.min(Math.max(fy, 0), grid.rows - 1);
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const c1 = Math.min(c0 + 1, grid.cols - 1);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const tx = c - c0;
  const ty = r - r0;
  const h = (cc: number, rr: number) => grid.data[rr * grid.cols + cc] ?? 0;
  return (h(c0, r0) * (1 - tx) + h(c1, r0) * tx) * (1 - ty) + (h(c0, r1) * (1 - tx) + h(c1, r1) * tx) * ty;
}

/** Simple ear clipping for a (possibly concave) simple polygon given as [x, y] points; returns index triples. */
export function triangulate(ring: [number, number][]): number[] {
  const n = ring.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();
  const out: number[] = [];
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) =>
    cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      const a = ring[i0]!;
      const b = ring[i1]!;
      const c = ring[i2]!;
      if (cross(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(ring[j]!, a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}

function ringOf(f: Feature<Polygon, Record<string, unknown>>): [number, number][] {
  const c = f.geometry.coordinates[0] ?? [];
  const pts = c.map((p) => [p[0]!, p[1]!] as [number, number]);
  if (pts.length > 1) {
    const a = pts[0]!;
    const z = pts[pts.length - 1]!;
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  return pts;
}

/** Build the meshes: positions in metres with the frame centre at the origin (x east, y up, z south). */
export function buildMeshes(model: ExportModel, grid: HeightGrid | null, options: GltfOptions = {}): Mesh[] {
  const frame = model.frame;
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  const ex = options.exaggeration ?? 1;
  const floorH = options.floorHeightM ?? 3.2;
  const toWorld = (x: number, y: number, h: number): [number, number, number] => [x - cx, h * ex, -(y - cy)];
  const ground = (x: number, y: number) => (grid ? sampleHeight(grid, frame, x, y) : 0);
  const meshes: Mesh[] = [];

  if (grid && options.terrain !== false) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let r = 0; r < grid.rows; r++)
      for (let c = 0; c < grid.cols; c++) {
        const x = frame.minX + c * grid.cellM;
        const y = frame.minY + r * grid.cellM;
        const h = grid.data[r * grid.cols + c] ?? 0;
        positions.push(...toWorld(x, y, h));
        // Normal from central differences.
        const hl = grid.data[r * grid.cols + Math.max(c - 1, 0)] ?? h;
        const hr = grid.data[r * grid.cols + Math.min(c + 1, grid.cols - 1)] ?? h;
        const hd = grid.data[Math.max(r - 1, 0) * grid.cols + c] ?? h;
        const hu = grid.data[Math.min(r + 1, grid.rows - 1) * grid.cols + c] ?? h;
        const nx = -((hr - hl) * ex) / (2 * grid.cellM);
        const nz = ((hu - hd) * ex) / (2 * grid.cellM);
        const len = Math.hypot(nx, 1, nz);
        normals.push(nx / len, 1 / len, nz / len);
      }
    for (let r = 0; r < grid.rows - 1; r++)
      for (let c = 0; c < grid.cols - 1; c++) {
        const i = r * grid.cols + c;
        indices.push(i, i + grid.cols, i + 1, i + 1, i + grid.cols, i + grid.cols + 1);
      }
    meshes.push({ name: 'terrain', color: COLOURS.terrain!, positions, normals, indices });
  }

  if (options.water !== false) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const level = (grid?.seaLevelM ?? 0) + 0.05;
    for (const f of clipToFrame(model.water, frame).features) {
      if (f.geometry.type !== 'Polygon') continue;
      const ring = ringOf(f as Feature<Polygon, Record<string, unknown>>);
      const tri = triangulate(ring);
      const base = positions.length / 3;
      for (const p of ring) {
        positions.push(...toWorld(p[0], p[1], level));
        normals.push(0, 1, 0);
      }
      for (const t of tri) indices.push(base + t);
    }
    if (indices.length) meshes.push({ name: 'water', color: COLOURS.water!, positions, normals, indices });
  }

  const groups = new Map<string, Mesh>();
  const prism = (
    key: string,
    ring: [number, number][],
    height: number,
    colour: [number, number, number, number],
  ) => {
    if (ring.length < 3) return;
    const m =
      groups.get(key) ??
      groups.set(key, { name: key, color: colour, positions: [], normals: [], indices: [] }).get(key)!;
    const bottom = Math.min(...ring.map((p) => ground(p[0], p[1]))) - 0.3;
    const top = Math.max(...ring.map((p) => ground(p[0], p[1]))) + height;
    // Roof.
    const tri = triangulate(ring);
    let base = m.positions.length / 3;
    for (const p of ring) {
      m.positions.push(...toWorld(p[0], p[1], top));
      m.normals.push(0, 1, 0);
    }
    for (const t of tri) m.indices.push(base + t);
    // Walls: one quad per edge with a flat normal.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      // Outward normal for a counter-clockwise ring: (dy, -dx) in x/y → (dy, 0, dx) in x/z with z south.
      const n: [number, number, number] = [dy / len, 0, dx / len];
      base = m.positions.length / 3;
      m.positions.push(
        ...toWorld(a[0], a[1], bottom),
        ...toWorld(b[0], b[1], bottom),
        ...toWorld(b[0], b[1], top),
        ...toWorld(a[0], a[1], top),
      );
      for (let k = 0; k < 4; k++) m.normals.push(...n);
      m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  const ccw = (ring: [number, number][]) => {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area >= 0 ? ring : [...ring].reverse();
  };
  for (const f of clipToFrame(model.buildings, frame).features) {
    if (f.geometry.type !== 'Polygon') continue;
    const p = f.properties;
    const state = String(p.state ?? 'sound');
    const floors = typeof p.floors === 'number' ? p.floors : 2;
    const height = state === 'ruin' ? 1.2 : floors * floorH;
    const ward = String(p.ward ?? '');
    const key =
      state === 'ruin'
        ? 'ruin'
        : ward === 'cbd'
          ? 'cbd'
          : ward === 'warehouse' || ward === 'industrial'
            ? 'industrial'
            : 'building';
    prism(key, ccw(ringOf(f as Feature<Polygon, Record<string, unknown>>)), height, COLOURS[key]!);
  }
  for (const f of clipToFrame(model.facilityParts, frame).features) {
    if (f.geometry.type !== 'Polygon') continue;
    const kind = String(f.properties.kind ?? '');
    const tall = [
      'building',
      'shed',
      'warehouse',
      'hall',
      'hangar',
      'terminal',
      'chapel',
      'gasholder',
      'tank',
      'chimney',
    ];
    if (!tall.includes(kind)) continue;
    const h = kind === 'chimney' ? 30 : kind === 'gasholder' ? 18 : kind === 'tank' ? 10 : 8;
    prism('facility', ccw(ringOf(f as Feature<Polygon, Record<string, unknown>>)), h, COLOURS.facility!);
  }
  meshes.push(...groups.values());
  return meshes;
}

/** Pack meshes into a GLB (glTF 2.0 binary). */
export function toGlb(meshes: Mesh[], name = 'CityGenerator frame'): Uint8Array {
  const bufferParts: Uint8Array[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const gltfMeshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  let byteLength = 0;
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const pushView = (bytes: Uint8Array, target: number): number => {
    const offset = byteLength;
    bufferParts.push(bytes);
    byteLength += bytes.byteLength;
    const p = pad(bytes.byteLength);
    if (p) {
      bufferParts.push(new Uint8Array(p));
      byteLength += p;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    return bufferViews.length - 1;
  };
  meshes.forEach((m, mi) => {
    if (!m.indices.length) return;
    const pos = new Float32Array(m.positions);
    const nor = new Float32Array(m.normals);
    const useShort = pos.length / 3 < 65_535;
    const idx = useShort ? new Uint16Array(m.indices) : new Uint32Array(m.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, pos[i + k]!);
        max[k] = Math.max(max[k]!, pos[i + k]!);
      }
    const pv = pushView(new Uint8Array(pos.buffer), 34962);
    const nv = pushView(new Uint8Array(nor.buffer), 34962);
    const iv = pushView(new Uint8Array(idx.buffer), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    accessors.push({
      bufferView: iv,
      componentType: useShort ? 5123 : 5125,
      count: idx.length,
      type: 'SCALAR',
    });
    const a = accessors.length - 3;
    materials.push({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: 0, roughnessFactor: 0.9 },
      doubleSided: m.name === 'water' || m.name === 'terrain',
    });
    gltfMeshes.push({
      name: m.name,
      primitives: [
        {
          attributes: { POSITION: a, NORMAL: a + 1 },
          indices: a + 2,
          material: materials.length - 1,
          mode: 4,
        },
      ],
    });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
    void mi;
  });
  const json = {
    asset: { version: '2.0', generator: 'CityGenerator' },
    scene: 0,
    scenes: [{ name, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = pad(jsonBytes.byteLength);
  const binLength = byteLength;
  const total = 12 + 8 + jsonBytes.byteLength + jsonPad + 8 + binLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.byteLength + i] = 0x20;
  let o = 20 + jsonBytes.byteLength + jsonPad;
  dv.setUint32(o, binLength, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  for (const part of bufferParts) {
    out.set(part, o);
    o += part.byteLength;
  }
  return out;
}

export interface GltfResult {
  glb: Uint8Array;
  meshes: { name: string; triangles: number; vertices: number }[];
}

export function exportGltf(
  model: ExportModel,
  grid: HeightGrid | null,
  options: GltfOptions = {},
): GltfResult {
  const meshes = buildMeshes(model, grid, options);
  return {
    glb: toGlb(
      meshes,
      `${model.name} ${Math.round(frameWidth(model.frame))}×${Math.round(frameHeight(model.frame))} m`,
    ),
    meshes: meshes.map((m) => ({
      name: m.name,
      triangles: m.indices.length / 3,
      vertices: m.positions.length / 3,
    })),
  };
}

/** Parse a GLB back into its JSON and binary chunk (for tests and viewers). */
export function parseGlb(glb: Uint8Array): { json: Record<string, unknown>; bin: Uint8Array } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Record<
    string,
    unknown
  >;
  const binOffset = 20 + jsonLength;
  const binLength = dv.getUint32(binOffset, true);
  return { json, bin: glb.subarray(binOffset + 8, binOffset + 8 + binLength) };
}
