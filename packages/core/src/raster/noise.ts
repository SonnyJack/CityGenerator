import { Rng } from '../random/rng.js';

/**
 * 2-D simplex noise with a seeded permutation table. Output is in [-1, 1].
 * Implemented locally (rather than via a dependency) so the golden hashes do
 * not move when a package updates its constants.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export class Simplex2 {
  private readonly perm = new Uint8Array(512);

  constructor(seed: string) {
    const rng = new Rng(`${seed}/simplex`);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  noise(xin: number, yin: number): number {
    const perm = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = GRAD[perm[ii + perm[jj]!]! & 7]!;
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]!]! & 7]!;
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]!]! & 7]!;
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }
}

export interface FbmOptions {
  octaves?: number;
  /** Amplitude ratio between octaves. */
  persistence?: number;
  /** Frequency ratio between octaves. */
  lacunarity?: number;
  /** 0 = smooth fBm, 1 = fully ridged (mountain-like). */
  ridged?: number;
}

/** Fractional Brownian motion built on a Simplex2 instance; input in noise units, output roughly in [-1, 1]. */
export function fbm(noise: Simplex2, x: number, y: number, options: FbmOptions = {}): number {
  const octaves = options.octaves ?? 5;
  const persistence = options.persistence ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const ridged = options.ridged ?? 0;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let v = noise.noise(x * freq, y * freq);
    if (ridged > 0) {
      const r = 1 - Math.abs(v);
      v = v * (1 - ridged) + (r * r * 2 - 1) * ridged;
    }
    sum += v * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Domain-warped fBm: the sample position is displaced by a second noise field. */
export function warpedFbm(
  noise: Simplex2,
  warp: Simplex2,
  x: number,
  y: number,
  warpStrength: number,
  options: FbmOptions = {},
): number {
  const wx = fbm(warp, x + 5.2, y + 1.3, { octaves: 3 });
  const wy = fbm(warp, x + 17.7, y + 9.2, { octaves: 3 });
  return fbm(noise, x + wx * warpStrength, y + wy * warpStrength, options);
}
