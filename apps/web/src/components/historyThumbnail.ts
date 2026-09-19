import type { MapDocument } from '@citygen/core';

/**
 * A small sketch of what has been drawn by hand at one point in the history: the region as a
 * frame, the settlements as dots and every authored feature and annotation in its place. It is
 * a picture of the edits, not a render of the map, which is what makes it cheap enough to draw
 * one per history entry on the main thread when the menu opens.
 */
export function historyThumbnail(
  doc: MapDocument,
  settlements: { center: [number, number]; radiusM: number }[],
  width = 96,
  height = 64,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const { widthM, heightM } = doc.spec.extent;
  const scale = Math.min(width / widthM, height / heightM);
  const px = (x: number) => width / 2 + x * scale;
  const py = (y: number) => height / 2 - y * scale;

  ctx.fillStyle = '#f5f2ea';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d6cfc0';
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  // The towns, so an edit can be placed at a glance.
  ctx.fillStyle = '#cfc6b4';
  for (const s of settlements) {
    const r = Math.max(1.5, s.radiusM * scale);
    ctx.beginPath();
    ctx.arc(px(s.center[0]), py(s.center[1]), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // What was drawn by hand, in the editor's own colour.
  ctx.strokeStyle = '#1d6fb8';
  ctx.fillStyle = 'rgba(29, 111, 184, 0.35)';
  ctx.lineWidth = 1;
  const drawRing = (ring: number[][], fill: boolean) => {
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(px(p[0]!), py(p[1]!)) : ctx.moveTo(px(p[0]!), py(p[1]!))));
    if (fill) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  };
  for (const f of doc.authored.features) {
    const g = f.geometry;
    if (g.type === 'LineString') drawRing(g.coordinates as number[][], false);
    else if (g.type === 'Polygon') drawRing(g.coordinates[0] as number[][], true);
    else if (g.type === 'Point') {
      ctx.beginPath();
      ctx.arc(px(g.coordinates[0]!), py(g.coordinates[1]!), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Annotations in the annotation colour, so a label reads differently from a street.
  ctx.strokeStyle = '#b91c1c';
  ctx.fillStyle = '#b91c1c';
  for (const a of doc.annotations) {
    const g = a.geometry;
    if (g.type === 'Point') {
      ctx.beginPath();
      ctx.arc(px(g.coordinates[0]!), py(g.coordinates[1]!), 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (g.type === 'LineString') drawRing(g.coordinates as number[][], false);
    else if (g.type === 'Polygon') drawRing(g.coordinates[0] as number[][], false);
  }
  return canvas.toDataURL('image/png');
}
