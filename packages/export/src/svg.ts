import type { Feature, Geometry, LineString, Point, Polygon } from 'geojson';
import type { Theme } from '@citygen/themes';
import { frameHeight, frameWidth, pixelTransform, clipToFrame, type ExportModel } from './model.js';

/**
 * SVG for a frame, drawn straight from the model with the theme's colours:
 * the same layers the map shows, in the same order, as plain paths and text,
 * so the file edits in any vector tool and prints at any size.
 */
export interface SvgOptions {
  pxPerM: number;
  /** Hide GM-only content. */
  player?: boolean;
  /** Draw street, district and facility names. */
  labels?: boolean;
}

type Props = Record<string, unknown>;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSvg(model: ExportModel, theme: Theme, options: SvgOptions): string {
  const { frame } = model;
  const k = options.pxPerM;
  const W = Math.round(frameWidth(frame) * k);
  const H = Math.round(frameHeight(frame) * k);
  const tx = pixelTransform(frame, k);
  const p = theme.palette;
  const t = theme.town;
  const parts: string[] = [];
  const num = (n: number) => (Math.round(n * 100) / 100).toString();
  const path = (g: Geometry): string => {
    const ring = (c: number[][]) =>
      c.map((q, i) => `${i ? 'L' : 'M'}${num(tx(q[0]!, q[1]!)[0])} ${num(tx(q[0]!, q[1]!)[1])}`).join('');
    switch (g.type) {
      case 'Polygon':
        return g.coordinates.map((r) => `${ring(r)}Z`).join('');
      case 'MultiPolygon':
        return g.coordinates.map((poly) => poly.map((r) => `${ring(r)}Z`).join('')).join('');
      case 'LineString':
        return ring(g.coordinates);
      case 'MultiLineString':
        return g.coordinates.map(ring).join('');
      default:
        return '';
    }
  };
  const fills = (
    fc: { features: Feature<Geometry, Props>[] },
    fill: (f: Feature<Geometry, Props>) => string,
    cls: string,
    extra = '',
  ) => {
    const clipped = clipToFrame(fc as never, frame) as { features: Feature<Geometry, Props>[] };
    if (!clipped.features.length) return;
    parts.push(`<g class="${cls}">`);
    for (const f of clipped.features)
      parts.push(`<path d="${path(f.geometry)}" fill="${fill(f)}" ${extra}/>`);
    parts.push('</g>');
  };
  const lines = (
    fc: { features: Feature<Geometry, Props>[] },
    stroke: (f: Feature<Geometry, Props>) => string,
    width: (f: Feature<Geometry, Props>) => number,
    cls: string,
    extra = '',
  ) => {
    const clipped = clipToFrame(fc as never, frame) as { features: Feature<Geometry, Props>[] };
    if (!clipped.features.length) return;
    parts.push(`<g class="${cls}" fill="none" stroke-linejoin="round" stroke-linecap="round">`);
    for (const f of clipped.features)
      parts.push(
        `<path d="${path(f.geometry)}" stroke="${stroke(f)}" stroke-width="${num(Math.max(0.3, width(f)))}" ${extra}/>`,
      );
    parts.push('</g>');
  };

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Open Sans', Arial, sans-serif">`,
  );
  parts.push(`<title>${esc(model.name)}</title>`);
  parts.push(`<rect width="100%" height="100%" fill="${p.land}"/>`);
  fills(
    model.landcover,
    (f) => theme.landcover[(f.properties.kind as keyof typeof theme.landcover) ?? 'open']?.color ?? p.land,
    'landcover',
  );
  fills(model.water, () => p.water, 'water', `stroke="${p.waterLine}" stroke-width="${num(0.8)}"`);
  lines(
    model.rivers,
    () => p.river,
    (f) => Math.max(1, ((f.properties.widthM as number) ?? 4) * k),
    'rivers',
  );
  lines(
    model.contours,
    (f) => (f.properties.major ? p.contourMajor : p.contour),
    (f) => (f.properties.major ? 0.8 : 0.4),
    'contours',
  );
  fills(model.patches, (f) => t.ward[String(f.properties.ward)] ?? p.land, 'patches');
  fills(
    model.facilities,
    () => '#ddd9d0',
    'facilities',
    `stroke="${p.inkMuted}" stroke-width="0.6" stroke-dasharray="4 2"`,
  );
  lines(
    { features: model.roads.features.filter((f) => f.properties.mode !== 'tunnel') },
    () => t.road,
    () => 2.2,
    'roads',
  );
  lines(
    { features: model.roads.features.filter((f) => f.properties.mode === 'tunnel') },
    () => t.road,
    () => 2.2,
    'roads-tunnel',
    'stroke-dasharray="4 3" stroke-opacity="0.7"',
  );
  const driven = {
    features: model.streets.features.filter((f) => f.properties.class !== 'steps'),
  };
  const steps = { features: model.streets.features.filter((f) => f.properties.class === 'steps') };
  if (t.streetCasing)
    lines(
      driven,
      () => t.streetCasing!,
      (f) => ((f.properties.class === 'artery' ? 12 : f.properties.class === 'road' ? 9 : 6) * k) / 1.2,
      'street-casing',
    );
  lines(
    driven,
    () => t.street,
    (f) => ((f.properties.class === 'artery' ? 9 : f.properties.class === 'road' ? 7 : 4) * k) / 1.2,
    'streets',
  );
  // Bridges: a bold ink bar over the water under the street.
  if (model.bridges)
    lines(
      model.bridges,
      () => p.ink,
      () => (10 * k) / 1.2,
      'bridges',
      'stroke-opacity="0.8" stroke-linecap="butt"',
    );
  // Flights of steps: thin and dashed.
  lines(
    steps,
    () => t.street,
    () => (2.5 * k) / 1.2,
    'steps',
    `stroke-dasharray="${num(2 * k)} ${num(2 * k)}"`,
  );
  lines(
    model.walls,
    () => t.wall,
    () => Math.max(1.5, 3 * k),
    'walls',
  );
  lines(
    model.rail,
    () => (theme.sketch ? p.ink : '#2f2a26'),
    (f) => (f.properties.class === 'mainline' ? 2.4 : f.properties.class === 'tram' ? 1 : 1.6),
    'rail',
    undefined,
  );
  fills(
    model.railStructures,
    () => '#d8d3ca',
    'rail-structures',
    `stroke="${p.inkMuted}" stroke-width="0.5"`,
  );
  // Utilities: works as footprints, canals as water, mains dashed per network, sewers only for the GM.
  const util = <G extends Geometry>(
    fc: { features: Feature<G, Props>[] } | undefined,
    pred: (f: Feature<G, Props>) => boolean,
  ) => ({
    features: (fc?.features ?? []).filter((f) => pred(f) && (!options.player || !f.properties.gmOnly)),
  });
  const utilColour: Record<string, string> = theme.sketch
    ? { waterMain: p.ink, gasMain: p.ink, powerLine: p.ink, sewer: p.inkMuted, pipeline: p.ink }
    : {
        waterMain: '#2f7bbf',
        gasMain: '#b8860b',
        powerLine: '#3a3a3a',
        sewer: '#7a4b2a',
        pipeline: '#8b2e2e',
      };
  fills(
    util(model.utilityAreas, () => true),
    (f) =>
      ['reservoir', 'canalBasin'].includes(String(f.properties.kind))
        ? p.water
        : f.properties.kind === 'substation'
          ? '#b9b9b9'
          : '#cdc5a9',
    'utility-areas',
    `stroke="${p.inkMuted}" stroke-width="0.5"`,
  );
  lines(
    util(model.utilities, (f) => f.properties.class === 'canal'),
    () => p.waterLine,
    () => Math.max(2, 14 * k),
    'canal-casing',
  );
  lines(
    util(model.utilities, (f) => f.properties.class === 'canal'),
    () => p.water,
    () => Math.max(1.2, 11 * k),
    'canal',
    undefined,
  );
  for (const [klass, dash] of [
    ['waterMain', '4 2'],
    ['gasMain', '2 2'],
    ['pipeline', '6 3'],
    ['sewer', '1 2'],
    ['powerLine', ''],
  ] as const)
    lines(
      util(model.utilities, (f) => f.properties.class === klass),
      () => utilColour[klass]!,
      (f) => (f.properties.kind === 'distribution' || f.properties.kind === 'branch' ? 0.6 : 1.2),
      `utility-${klass}`,
      dash ? `stroke-dasharray="${dash}"` : '',
    );
  for (const s of util(model.utilityPoints, (f) => f.properties.kind !== 'pylon').features) {
    const [x, y] = tx(s.geometry.coordinates[0]!, s.geometry.coordinates[1]!);
    parts.push(
      `<circle cx="${num(x)}" cy="${num(y)}" r="${s.properties.kind === 'waterTower' ? 3.5 : 2.5}" fill="${utilColour[String(s.properties.class)] ?? p.waterLine}" stroke="${p.background}" stroke-width="0.8"/>`,
    );
  }
  fills(
    { features: model.facilityParts.features.filter((f) => f.geometry.type === 'Polygon') },
    (f) =>
      ['building', 'shed', 'warehouse', 'hall', 'hangar', 'terminal', 'chapel'].includes(
        String(f.properties.kind),
      )
        ? t.building
        : ['dock', 'basin', 'pond', 'reservoir'].includes(String(f.properties.kind))
          ? p.water
          : '#c9c4ba',
    'facility-parts',
    `stroke="${t.buildingOutline}" stroke-width="0.4"`,
  );
  lines(
    { features: model.facilityParts.features.filter((f) => f.geometry.type === 'LineString') },
    (f) => (f.properties.kind === 'track' ? '#2f2a26' : p.inkMuted),
    () => 1,
    'facility-lines',
  );
  const buildingFill = (f: Feature<Geometry, Props>) => {
    const b = theme.buildings;
    if (b?.by === 'material' && b.materials) return b.materials[String(f.properties.material)] ?? t.building;
    if (b?.by === 'use' && b.uses) return b.uses[String(f.properties.use)] ?? t.building;
    return b?.outlineOnly ? 'none' : t.building;
  };
  fills(
    model.buildings,
    buildingFill,
    'buildings',
    `stroke="${t.buildingOutline}" stroke-width="${num(Math.max(0.3, 0.4 * k))}"`,
  );
  // Authored features.
  const authoredPolys = { features: model.authored.features.filter((f) => f.geometry.type === 'Polygon') };
  const authoredLines = {
    features: model.authored.features.filter(
      (f) =>
        f.geometry.type === 'LineString' &&
        !['terrainEdit', 'fieldEdit'].includes(String(f.properties.layer)),
    ),
  };
  fills(
    authoredPolys,
    (f) =>
      f.properties.layer === 'zone'
        ? (t.ward[String(f.properties.kind)] ?? p.inkMuted)
        : f.properties.layer === 'water'
          ? p.water
          : t.building,
    'authored',
    `stroke="${t.buildingOutline}" stroke-width="0.5" fill-opacity="${0.8}"`,
  );
  lines(
    authoredLines,
    (f) => (f.properties.layer === 'rail' ? p.ink : f.properties.layer === 'water' ? p.waterLine : t.street),
    (f) => Math.max(1, ((f.properties.widthM as number) ?? 6) * k),
    'authored-lines',
  );
  // Stations.
  for (const s of clipToFrame(model.stations, frame).features) {
    if (!['central', 'town', 'halt', 'suburban'].includes(String(s.properties.kind))) continue;
    const [x, y] = tx(s.geometry.coordinates[0]!, s.geometry.coordinates[1]!);
    parts.push(
      `<circle cx="${num(x)}" cy="${num(y)}" r="${s.properties.kind === 'central' ? 6 : 4}" fill="${p.background}" stroke="${p.ink}" stroke-width="1.5"/>`,
    );
  }
  // Labels.
  if (options.labels !== false) {
    const l = theme.labels;
    parts.push(
      `<g class="labels" text-anchor="middle" paint-order="stroke" stroke="${l.halo}" stroke-width="${num(l.haloWidth * 2)}" stroke-linejoin="round">`,
    );
    for (const d of clipToFrame(model.districts, frame).features) {
      const [x, y] = tx(d.geometry.coordinates[0]!, d.geometry.coordinates[1]!);
      parts.push(
        `<text x="${num(x)}" y="${num(y)}" font-size="12" letter-spacing="1.5" fill="${l.district}">${esc(String(d.properties.name ?? '').toUpperCase())}</text>`,
      );
    }
    for (const w of clipToFrame(model.ways, frame).features) {
      const c = w.geometry.coordinates;
      if (c.length < 2 || (w.properties.lengthM as number) < 60) continue;
      const mid = c[Math.floor(c.length / 2)]!;
      const prev = c[Math.max(0, Math.floor(c.length / 2) - 1)]!;
      const [x, y] = tx(mid[0]!, mid[1]!);
      const [px, py] = tx(prev[0]!, prev[1]!);
      let angle = (Math.atan2(y - py, x - px) * 180) / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      parts.push(
        `<text x="${num(x)}" y="${num(y)}" transform="rotate(${num(angle)} ${num(x)} ${num(y)})" font-size="${w.properties.class === 'artery' ? 10 : 8}" dy="-2" fill="${l.street}">${esc(String(w.properties.name ?? ''))}</text>`,
      );
    }
    for (const f of clipToFrame(model.facilities, frame).features) {
      const ring = f.geometry.coordinates[0]!;
      const n = ring.length - 1 || 1;
      let x = 0;
      let y = 0;
      for (let i = 0; i < n; i++) {
        x += ring[i]![0]!;
        y += ring[i]![1]!;
      }
      const [sx, sy] = tx(x / n, y / n);
      parts.push(
        `<text x="${num(sx)}" y="${num(sy)}" font-size="10" letter-spacing="1" fill="${l.facility}">${esc(String(f.properties.name ?? '').toUpperCase())}</text>`,
      );
    }
    parts.push('</g>');
  }
  // Annotations: labels always, notes only for the GM.
  parts.push(`<g class="annotations" text-anchor="middle">`);
  for (const a of clipToFrame(model.annotations, frame).features) {
    if (options.player && a.properties.gmOnly) continue;
    const kind = String(a.properties.kind);
    if (a.geometry.type === 'Point') {
      const [x, y] = tx(a.geometry.coordinates[0]!, a.geometry.coordinates[1]!);
      if (kind === 'marker')
        parts.push(
          `<circle cx="${num(x)}" cy="${num(y)}" r="5" fill="#b91c1c" stroke="#fff" stroke-width="1.5"/>`,
        );
      else if (kind === 'note')
        parts.push(
          `<rect x="${num(x - 60)}" y="${num(y - 9)}" width="120" height="18" fill="#fef3c7" stroke="#b45309"/><text x="${num(x)}" y="${num(y + 4)}" font-size="9" fill="#78350f">${esc(String(a.properties.text ?? ''))}</text>`,
        );
      else
        parts.push(
          `<text x="${num(x)}" y="${num(y)}" font-size="14" font-weight="bold" paint-order="stroke" stroke="${theme.labels.halo}" stroke-width="3" fill="${theme.labels.settlement}">${esc(String(a.properties.text ?? ''))}</text>`,
        );
    } else if (kind === 'handoutFrame' && a.geometry.type === 'Polygon') {
      parts.push(
        `<path d="${path(a.geometry)}" fill="none" stroke="#b91c1c" stroke-width="1.5" stroke-dasharray="6 3"/>`,
      );
    }
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}

export type { Polygon, LineString, Point };
