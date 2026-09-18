import type { Rng } from '../random/rng.js';

/**
 * Preset shape functions give each terrain preset its large-scale form. They
 * take normalised coordinates u, v in [-1, 1] (u east, v north) and return a
 * base height in [-1, 1] where negative values are below sea level. Noise is
 * added on top by the terrain stage.
 */

export type TerrainPresetId =
  'plains' | 'coast' | 'bay' | 'riverValley' | 'hills' | 'archipelago' | 'delta' | 'estuary' | 'custom';

export interface PresetShape {
  /** Base height field in [-1, 1]. */
  base: (u: number, v: number) => number;
  /** How strongly noise contributes (0..1). */
  noiseWeight: number;
  /** Ridge weight for the fBm (0..1). */
  ridged: number;
  /** Does this preset normally contain sea? Influences bathymetry and coast handling. */
  hasSea: boolean;
  /** Vertical scale multiplier applied to the relief parameter. */
  reliefScale: number;
}

/** Rotate (u, v) so that the sea lies to the chosen compass side. */
function orient(u: number, v: number, side: number): [number, number] {
  switch (side & 3) {
    case 0:
      return [u, v]; // sea to the south
    case 1:
      return [-v, u]; // sea to the east
    case 2:
      return [-u, -v]; // sea to the north
    default:
      return [v, -u]; // sea to the west
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Build the preset's shape from the seed (which picks the sea side and a few offsets). */
export function presetShape(id: TerrainPresetId, rng: Rng): PresetShape {
  const side = rng.int(0, 3);
  const jitter = rng.range(-0.25, 0.25);
  switch (id) {
    case 'plains':
      return { base: () => 0.25, noiseWeight: 0.35, ridged: 0, hasSea: false, reliefScale: 0.35 };
    case 'hills':
      return { base: () => 0.35, noiseWeight: 1, ridged: 0.6, hasSea: false, reliefScale: 1 };
    case 'coast':
      return {
        base: (u, v) => {
          const [, y] = orient(u, v, side);
          // Sea in the southern third, land rising gently to the north.
          return smoothstep(-0.45 + jitter * 0.4, 0.6, y) * 0.9 - 0.35;
        },
        noiseWeight: 0.6,
        ridged: 0.2,
        hasSea: true,
        reliefScale: 0.7,
      };
    case 'bay':
      return {
        base: (u, v) => {
          const [x, y] = orient(u, v, side);
          const coast = smoothstep(-0.7, 0.5, y) * 0.9 - 0.35;
          // A lobe of sea intruding from the coast edge.
          const lobe = Math.exp(-((x - jitter) ** 2) / 0.18) * smoothstep(0.35, -0.9, y);
          return coast - lobe * 0.9;
        },
        noiseWeight: 0.55,
        ridged: 0.2,
        hasSea: true,
        reliefScale: 0.7,
      };
    case 'estuary':
      return {
        base: (u, v) => {
          const [x, y] = orient(u, v, side);
          const coast = smoothstep(-0.8, 0.6, y) * 0.9 - 0.3;
          // Funnel: wide at the sea edge, narrowing inland.
          const halfWidth = 0.05 + 0.3 * smoothstep(0.7, -1, y);
          const channel = Math.exp(-((x - jitter) ** 2) / (halfWidth * halfWidth)) * smoothstep(0.9, -1, y);
          return coast - channel * 0.7;
        },
        noiseWeight: 0.5,
        ridged: 0.15,
        hasSea: true,
        reliefScale: 0.6,
      };
    case 'delta':
      return {
        base: (u, v) => {
          const [, y] = orient(u, v, side);
          // Very flat low land near the sea; the river system does the rest.
          return smoothstep(-0.55, 0.9, y) * 0.5 - 0.2;
        },
        noiseWeight: 0.3,
        ridged: 0,
        hasSea: true,
        reliefScale: 0.3,
      };
    case 'riverValley':
      return {
        base: (u, v) => {
          const [x] = orient(u, v, side);
          // A broad valley through the middle, high ground either side.
          return 0.7 - Math.exp(-((x - jitter) ** 2) / 0.25) * 0.55;
        },
        noiseWeight: 0.7,
        ridged: 0.5,
        hasSea: false,
        reliefScale: 1,
      };
    case 'archipelago':
      return {
        base: () => -0.35,
        noiseWeight: 1.2,
        ridged: 0.1,
        hasSea: true,
        reliefScale: 0.6,
      };
    case 'custom':
    default:
      return { base: () => 0.2, noiseWeight: 0.5, ridged: 0.2, hasSea: false, reliefScale: 0.6 };
  }
}
