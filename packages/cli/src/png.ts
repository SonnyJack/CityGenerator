import { inflateSync } from 'node:zlib';

/**
 * A small PNG decoder for heightmaps: non-interlaced, 8- or 16-bit, grey,
 * grey+alpha, RGB or RGBA. Returns 8-bit RGBA plus, for 16-bit greys, the
 * full-precision samples.
 */
export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** 16-bit grey samples when the file has them (row-major, top row first). */
  grey16?: Uint16Array;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colour = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = bytes[pos + 16]!;
      colour = bytes[pos + 17]!;
      interlace = bytes[pos + 20]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height) throw new Error('PNG without IHDR');
  if (interlace) throw new Error('interlaced PNGs are not supported');
  if (![0, 2, 4, 6].includes(colour))
    throw new Error(`unsupported PNG colour type ${colour} (palettes are not supported)`);
  if (depth !== 8 && depth !== 16) throw new Error(`unsupported PNG bit depth ${depth}`);
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : 4;
  const bpp = (channels * depth) / 8;
  const stride = width * bpp;
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  const raw = inflateSync(joined);
  const out = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const grey16 = colour === 0 && depth === 16 ? new Uint16Array(width * height) : undefined;
  for (let i = 0; i < width * height; i++) {
    const base = i * bpp;
    const sample = (ch: number) => (depth === 8 ? out[base + ch]! : out[base + ch * 2]!);
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    if (colour === 0 || colour === 4) {
      r = g = b = sample(0);
      if (colour === 4) a = sample(1);
      if (grey16) grey16[i] = (out[base]! << 8) | out[base + 1]!;
    } else {
      r = sample(0);
      g = sample(1);
      b = sample(2);
      if (colour === 6) a = sample(3);
    }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba, ...(grey16 ? { grey16 } : {}) };
}
