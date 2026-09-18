/**
 * Imported heightmaps live in the document as a base64 grid of 16-bit
 * samples scaled between minM and maxM (south row first), which keeps a
 * 1024 × 1024 grid under 3 MB and needs no image decoder in the engine.
 */
export interface HeightmapSpec {
  width: number;
  height: number;
  minM: number;
  maxM: number;
  data: string;
  source?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Pack metres into the document form (16-bit, little-endian). */
export function encodeHeightmap(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  options: { minM?: number; maxM?: number; source?: string } = {},
): HeightmapSpec {
  if (heights.length !== width * height) throw new RangeError('heightmap size mismatch');
  let minM = options.minM ?? Infinity;
  let maxM = options.maxM ?? -Infinity;
  if (options.minM === undefined || options.maxM === undefined)
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]!;
      if (options.minM === undefined && h < minM) minM = h;
      if (options.maxM === undefined && h > maxM) maxM = h;
    }
  if (!Number.isFinite(minM) || !Number.isFinite(maxM)) {
    minM = 0;
    maxM = 1;
  }
  if (maxM <= minM) maxM = minM + 1;
  const u16 = new Uint16Array(width * height);
  for (let i = 0; i < u16.length; i++) {
    const t = (heights[i]! - minM) / (maxM - minM);
    u16[i] = Math.round(Math.min(1, Math.max(0, t)) * 65535);
  }
  const bytes = new Uint8Array(u16.length * 2);
  for (let i = 0; i < u16.length; i++) {
    bytes[i * 2] = u16[i]! & 0xff;
    bytes[i * 2 + 1] = u16[i]! >> 8;
  }
  return {
    width,
    height,
    minM,
    maxM,
    data: bytesToBase64(bytes),
    ...(options.source ? { source: options.source } : {}),
  };
}

/** Unpack to metres (row-major, south row first). */
export function decodeHeightmap(spec: HeightmapSpec): Float32Array {
  const bytes = base64ToBytes(spec.data);
  const n = spec.width * spec.height;
  if (bytes.length < n * 2) throw new RangeError('heightmap data is too short');
  const out = new Float32Array(n);
  const span = spec.maxM - spec.minM;
  for (let i = 0; i < n; i++)
    out[i] = spec.minM + ((bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)) / 65535) * span;
  return out;
}

/**
 * Heights from image pixels: 8-bit RGBA (a grey image, or Terrain-RGB when
 * `terrainRgb`), rows top-first as canvases give them; the result is south
 * row first as the engine wants.
 */
export function heightmapFromPixels(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: { minM: number; maxM: number; terrainRgb?: boolean; source?: string },
): HeightmapSpec {
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const value = options.terrainRgb
        ? -10000 + (r * 65536 + g * 256 + b) * 0.1
        : options.minM + ((r + g + b) / 3 / 255) * (options.maxM - options.minM);
      heights[(height - 1 - y) * width + x] = value;
    }
  return encodeHeightmap(
    heights,
    width,
    height,
    options.terrainRgb
      ? { ...(options.source ? { source: options.source } : {}) }
      : { minM: options.minM, maxM: options.maxM, ...(options.source ? { source: options.source } : {}) },
  );
}
