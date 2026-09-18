import { WATER, type TerrainOutput } from '@citygen/core';

/**
 * A small RGBA rendering of a terrain: hypsometric tint with hillshade, water
 * in blue. Used for the variations strip; no DOM required.
 */
export function renderThumbnail(terrain: TerrainOutput, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const { height: hm, water, seaLevel } = terrain;
  const halfW = ((hm.width - 1) * hm.cellSizeM) / 2;
  const halfH = ((hm.height - 1) * hm.cellSizeM) / 2;
  const maxM = Math.max(terrain.stats.maxM, seaLevel + 1);
  const light = [-0.6, 0.6, 0.55];
  const len = Math.hypot(light[0]!, light[1]!, light[2]!);
  const lx = light[0]! / len;
  const ly = light[1]! / len;
  const lz = light[2]! / len;
  const stepM = (2 * halfW) / width;
  for (let py = 0; py < height; py++) {
    const wy = halfH - ((py + 0.5) / height) * 2 * halfH;
    for (let px = 0; px < width; px++) {
      const wx = -halfW + ((px + 0.5) / width) * 2 * halfW;
      const col = Math.min(Math.max(Math.round(hm.col(wx)), 0), hm.width - 1);
      const row = Math.min(Math.max(Math.round(hm.row(wy)), 0), hm.height - 1);
      const w = water[row * hm.width + col]!;
      const h = hm.sample(wx, wy);
      let r: number;
      let g: number;
      let b: number;
      if (w === WATER.sea || w === WATER.lake) {
        const depth = Math.min(1, Math.max(0, (seaLevel - h) / 60));
        r = 150 - depth * 60;
        g = 190 - depth * 60;
        b = 220 - depth * 40;
      } else {
        const t = Math.min(1, Math.max(0, (h - seaLevel) / (maxM - seaLevel)));
        // Green lowlands → tan uplands → grey peaks.
        if (t < 0.5) {
          const u = t / 0.5;
          r = 166 + (206 - 166) * u;
          g = 196 + (186 - 196) * u;
          b = 140 + (130 - 140) * u;
        } else {
          const u = (t - 0.5) / 0.5;
          r = 206 + (225 - 206) * u;
          g = 186 + (222 - 186) * u;
          b = 130 + (218 - 130) * u;
        }
        const dzdx = (hm.sample(wx + stepM, wy) - hm.sample(wx - stepM, wy)) / (2 * stepM);
        const dzdy = (hm.sample(wx, wy + stepM) - hm.sample(wx, wy - stepM)) / (2 * stepM);
        const nl = Math.hypot(dzdx, dzdy, 1);
        const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / nl);
        const k = 0.55 + 0.6 * shade;
        r *= k;
        g *= k;
        b *= k;
      }
      const i = (py * width + px) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
