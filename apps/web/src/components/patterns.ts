import type { PatternSpec } from '@citygen/themes';

/** Rasterise a theme pattern into RGBA pixels for MapLibre `addImage`. */
export function renderPattern(
  spec: PatternSpec,
  pixelRatio: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const size = Math.round(spec.size * pixelRatio);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  ctx.lineWidth = spec.lineWidth;
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of spec.lines ?? []) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  for (const [x, y, r] of spec.dots ?? []) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const image = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}
