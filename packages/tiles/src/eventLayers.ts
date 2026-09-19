import type { Feature, Polygon } from 'geojson';
import type { TileLayerInput } from './builder.js';

export interface EventLike {
  id: string;
  kind: 'fire' | 'storm' | 'flood' | 'burst' | 'blackout' | 'explosion';
  year: number;
  center: [number, number];
  radiusM: number;
  magnitude: number;
  levelM?: number;
  durationYears: number;
}

/**
 * Overlay polygons for the disasters active at the year: a flood stays for
 * its duration, a fire or storm shows for the year it struck (and burnt ground
 * fades over the next few years).
 */
export function eventLayers(events: EventLike[], year: number): TileLayerInput[] {
  const features: Feature<Polygon, Record<string, unknown>>[] = [];
  for (const e of events) {
    const span = e.kind === 'flood' || e.kind === 'blackout' ? e.durationYears : e.kind === 'fire' ? 5 : 1;
    if (year < e.year || year >= e.year + span) continue;
    const n = 48;
    const ring: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring.push([e.center[0] + Math.cos(a) * e.radiusM, e.center[1] + Math.sin(a) * e.radiusM]);
    }
    features.push({
      type: 'Feature',
      id: `event-${e.id}`,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        kind: e.kind,
        year: e.year,
        magnitude: e.magnitude,
        since: year - e.year,
        ...(e.levelM !== undefined ? { levelM: e.levelM } : {}),
      },
    });
  }
  return [{ name: 'events', features: { type: 'FeatureCollection', features }, minZoom: 8 }];
}
