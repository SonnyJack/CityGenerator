import type { FloorPlan, Interior } from '@citygen/core';
import type { Theme } from '@citygen/themes';
import { universalVtt, type UniversalVtt } from './vtt.js';
import type { Frame } from './model.js';

/**
 * Floor plans as handouts: an SVG per floor (rooms, walls, doors, windows,
 * labels) and a Universal VTT scene with the walls as line of sight and the
 * doors as portals, at a 1.5 m (5 ft) grid.
 */
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function interiorFrame(interior: Interior, marginM = 1): Frame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of interior.footprint) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX: minX - marginM, minY: minY - marginM, maxX: maxX + marginM, maxY: maxY + marginM };
}

export interface InteriorSvgOptions {
  pxPerM: number;
  /** Player version: no room labels for blind rooms? Labels are kept; GM notes are not part of plans. */
  labels?: boolean;
  theme?: Pick<Theme, 'palette'>;
}

/** SVG of one floor, y up in metres mapped to y down in pixels. */
export function interiorSvg(interior: Interior, floor: number, options: InteriorSvgOptions): string {
  const plan = interior.floors[floor];
  if (!plan) throw new Error(`no floor ${floor}`);
  const frame = interiorFrame(interior);
  const k = options.pxPerM;
  const W = Math.ceil((frame.maxX - frame.minX) * k);
  const H = Math.ceil((frame.maxY - frame.minY) * k);
  const tx = (x: number, y: number): [number, number] => [(x - frame.minX) * k, (frame.maxY - y) * k];
  const bg = options.theme?.palette.background ?? '#f7f4ec';
  const ink = options.theme?.palette.ink ?? '#2b2b2b';
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  // A faint 1 m grid.
  parts.push(`<g stroke="${ink}" stroke-opacity="0.08" stroke-width="0.5">`);
  for (let x = Math.ceil(frame.minX); x <= frame.maxX; x++) {
    const [px] = tx(x, 0);
    parts.push(`<line x1="${num(px)}" y1="0" x2="${num(px)}" y2="${H}"/>`);
  }
  for (let y = Math.ceil(frame.minY); y <= frame.maxY; y++) {
    const [, py] = tx(0, y);
    parts.push(`<line x1="0" y1="${num(py)}" x2="${W}" y2="${num(py)}"/>`);
  }
  parts.push('</g>');
  const path = (ring: [number, number][]) =>
    ring.map((p, i) => `${i ? 'L' : 'M'}${tx(p[0], p[1]).map(num).join(' ')}`).join(' ') + ' Z';
  parts.push(`<g class="rooms" fill="#ffffff" fill-opacity="0.85" stroke="none">`);
  for (const r of plan.rooms) parts.push(`<path d="${path(r.ring)}"/>`);
  parts.push('</g>');
  parts.push(`<g class="walls" stroke="${ink}" stroke-linecap="square">`);
  for (const w of plan.walls) {
    const [x1, y1] = tx(w.a[0], w.a[1]);
    const [x2, y2] = tx(w.b[0], w.b[1]);
    parts.push(
      `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke-width="${num(Math.max(1, (w.exterior ? 0.3 : 0.15) * k))}"/>`,
    );
  }
  parts.push('</g>');
  parts.push(`<g class="windows" stroke="#5b8bb5" stroke-width="${num(Math.max(1, 0.12 * k))}">`);
  for (const w of plan.windows) {
    const dx = w.wall[1][0] - w.wall[0][0];
    const dy = w.wall[1][1] - w.wall[0][1];
    const l = Math.hypot(dx, dy) || 1;
    const [x1, y1] = tx(w.at[0] - (dx / l) * (w.widthM / 2), w.at[1] - (dy / l) * (w.widthM / 2));
    const [x2, y2] = tx(w.at[0] + (dx / l) * (w.widthM / 2), w.at[1] + (dy / l) * (w.widthM / 2));
    parts.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`);
  }
  parts.push('</g>');
  parts.push(`<g class="doors" fill="none" stroke="${ink}" stroke-width="${num(Math.max(0.8, 0.06 * k))}">`);
  for (const d of plan.doors) {
    // A door leaf drawn as a quarter arc from the hinge.
    const dx = d.wall[1][0] - d.wall[0][0];
    const dy = d.wall[1][1] - d.wall[0][1];
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const hinge: [number, number] = [d.at[0] - ux * (d.widthM / 2), d.at[1] - uy * (d.widthM / 2)];
    const nx = -uy;
    const ny = ux;
    const tip: [number, number] = [hinge[0] + nx * d.widthM, hinge[1] + ny * d.widthM];
    const end: [number, number] = [d.at[0] + ux * (d.widthM / 2), d.at[1] + uy * (d.widthM / 2)];
    const [hx, hy] = tx(hinge[0], hinge[1]);
    const [tX, tY] = tx(tip[0], tip[1]);
    const [ex, ey] = tx(end[0], end[1]);
    const r = num(d.widthM * k);
    parts.push(
      `<path d="M${num(hx)} ${num(hy)} L${num(tX)} ${num(tY)} A${r} ${r} 0 0 1 ${num(ex)} ${num(ey)}"/>`,
    );
  }
  parts.push('</g>');
  if (options.labels !== false) {
    parts.push(
      `<g class="labels" fill="${ink}" text-anchor="middle" font-size="${num(Math.max(7, 0.55 * k))}">`,
    );
    for (const r of plan.rooms) {
      const c = r.ring.reduce((a, p) => [a[0] + p[0] / r.ring.length, a[1] + p[1] / r.ring.length], [0, 0]);
      const [x, y] = tx(c[0]!, c[1]!);
      parts.push(`<text x="${num(x)}" y="${num(y)}">${esc(r.name)}</text>`);
      parts.push(
        `<text x="${num(x)}" y="${num(y + Math.max(8, 0.6 * k))}" font-size="${num(Math.max(6, 0.4 * k))}" fill-opacity="0.6">${num(r.areaM2)} m²</text>`,
      );
    }
    parts.push('</g>');
  }
  parts.push(
    `<text x="${num(0.3 * k)}" y="${num(H - 0.3 * k)}" font-size="${num(Math.max(7, 0.5 * k))}" fill="${ink}" fill-opacity="0.7">${esc(plan.name)} · 1 m grid</text>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}

export interface InteriorVttOptions {
  gridM?: number;
  pixelsPerGrid?: number;
  imageBase64?: string;
  name?: string;
}

/** Universal VTT of one floor: walls as line of sight, doors as portals. */
export function interiorVtt(
  interior: Interior,
  floor: number,
  options: InteriorVttOptions = {},
): UniversalVtt {
  const plan = interior.floors[floor];
  if (!plan) throw new Error(`no floor ${floor}`);
  const frame = interiorFrame(interior);
  const gridM = options.gridM ?? 1.5;
  const base = universalVtt({
    frame,
    gridM,
    pixelsPerGrid: options.pixelsPerGrid ?? 100,
    walls: {
      segments: plan.walls.map((w) => [w.a[0], w.a[1], w.b[0], w.b[1]] as [number, number, number, number]),
      warnings: [],
      mode: 'buildings',
      rawCount: plan.walls.length,
    },
    name: options.name ?? `${interior.id} ${plan.name}`,
    ...(options.imageBase64 ? { imageBase64: options.imageBase64 } : {}),
  });
  const g = (x: number, y: number) => ({ x: (x - frame.minX) / gridM, y: (frame.maxY - y) / gridM });
  base.portals = plan.doors.map((d) => {
    const dx = d.wall[1][0] - d.wall[0][0];
    const dy = d.wall[1][1] - d.wall[0][1];
    const l = Math.hypot(dx, dy) || 1;
    const a = g(d.at[0] - (dx / l) * (d.widthM / 2), d.at[1] - (dy / l) * (d.widthM / 2));
    const b = g(d.at[0] + (dx / l) * (d.widthM / 2), d.at[1] + (dy / l) * (d.widthM / 2));
    return {
      position: g(d.at[0], d.at[1]),
      bounds: [a, b],
      rotation: Math.atan2(-dy, dx),
      closed: true,
      freestanding: false,
    };
  });
  return base;
}

export type { FloorPlan };
