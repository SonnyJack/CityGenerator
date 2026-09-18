import type { AuthoredFeature } from '@citygen/core';

/**
 * OpenStreetMap import: an .osm XML extract or Overpass JSON becomes
 * authored features in model metres (a local equirectangular projection
 * around the data's centre), so a real town can seed a document and the
 * generator fills in what the data lacks.
 */
export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}
export interface OsmWay {
  id: string;
  nodes: string[];
  tags: Record<string, string>;
}
export interface OsmData {
  nodes: Map<string, OsmNode>;
  ways: OsmWay[];
}

const METRES_PER_DEGREE = 111_319.490793;

/** Parse .osm XML (nodes and ways with tags; relations are ignored). */
export function parseOsmXml(xml: string): OsmData {
  const nodes = new Map<string, OsmNode>();
  const ways: OsmWay[] = [];
  const attr = (s: string, name: string): string | undefined => {
    const m = s.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? unescapeXml(m[1]!) : undefined;
  };
  const tagsOf = (body: string): Record<string, string> => {
    const tags: Record<string, string> = {};
    for (const m of body.matchAll(/<tag\s+([^>]*)\/?>/g)) {
      const k = attr(m[1]!, 'k');
      const v = attr(m[1]!, 'v');
      if (k !== undefined && v !== undefined) tags[k] = v;
    }
    return tags;
  };
  for (const m of xml.matchAll(/<node\s+([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const head = m[1]!;
    const id = attr(head, 'id');
    const lat = Number(attr(head, 'lat'));
    const lon = Number(attr(head, 'lon'));
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodes.set(id, { id, lat, lon, tags: m[3] ? tagsOf(m[3]) : {} });
  }
  for (const m of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[1]!, 'id');
    if (!id) continue;
    const body = m[2]!;
    const refs = [...body.matchAll(/<nd\s+ref="([^"]+)"/g)].map((x) => x[1]!);
    ways.push({ id, nodes: refs, tags: tagsOf(body) });
  }
  return { nodes, ways };
}

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Parse Overpass API JSON (`{ elements: [...] }`). */
export function parseOverpassJson(json: unknown): OsmData {
  const nodes = new Map<string, OsmNode>();
  const ways: OsmWay[] = [];
  const elements = (json as { elements?: unknown[] })?.elements ?? [];
  for (const e of elements as Record<string, unknown>[]) {
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number')
      nodes.set(String(e.id), {
        id: String(e.id),
        lat: e.lat,
        lon: e.lon,
        tags: (e.tags as Record<string, string>) ?? {},
      });
    else if (e.type === 'way' && Array.isArray(e.nodes))
      ways.push({
        id: String(e.id),
        nodes: (e.nodes as (number | string)[]).map(String),
        tags: (e.tags as Record<string, string>) ?? {},
      });
  }
  return { nodes, ways };
}

/** Parse either format from text. */
export function parseOsm(text: string): OsmData {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return parseOverpassJson(JSON.parse(trimmed));
  return parseOsmXml(text);
}

export interface OsmImportOptions {
  /** Projection centre [lat, lon]; defaults to the centre of the data's bounding box. */
  centre?: [number, number];
  /** Prefix for feature ids (default 'osm'). */
  idPrefix?: string;
  /** Skip buildings (they can number in the tens of thousands). */
  buildings?: boolean;
}

export interface OsmImportResult {
  features: AuthoredFeature[];
  centre: [number, number];
  /** Extent of the imported features in metres (from the centre). */
  bboxM: [number, number, number, number];
  counts: Record<string, number>;
  skipped: number;
}

/** Convert parsed data to authored features. */
export function osmToAuthored(data: OsmData, options: OsmImportOptions = {}): OsmImportResult {
  const nodes = [...data.nodes.values()];
  if (!nodes.length)
    return { features: [], centre: [0, 0], bboxM: [0, 0, 0, 0], counts: {}, skipped: data.ways.length };
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const n of nodes) {
    minLat = Math.min(minLat, n.lat);
    maxLat = Math.max(maxLat, n.lat);
    minLon = Math.min(minLon, n.lon);
    maxLon = Math.max(maxLon, n.lon);
  }
  const centre = options.centre ?? ([(minLat + maxLat) / 2, (minLon + maxLon) / 2] as [number, number]);
  const cosLat = Math.cos((centre[0] * Math.PI) / 180);
  const project = (n: OsmNode): [number, number] => [
    Math.round((n.lon - centre[1]) * METRES_PER_DEGREE * cosLat * 100) / 100,
    Math.round((n.lat - centre[0]) * METRES_PER_DEGREE * 100) / 100,
  ];
  const prefix = options.idPrefix ?? 'osm';
  const features: AuthoredFeature[] = [];
  const counts: Record<string, number> = {};
  let skipped = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const push = (f: AuthoredFeature) => {
    features.push(f);
    counts[f.properties.layer] = (counts[f.properties.layer] ?? 0) + 1;
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        minX = Math.min(minX, c[0] as number);
        maxX = Math.max(maxX, c[0] as number);
        minY = Math.min(minY, c[1] as number);
        maxY = Math.max(maxY, c[1] as number);
      } else if (Array.isArray(c)) c.forEach(walk);
    };
    walk((f.geometry as { coordinates: unknown }).coordinates);
  };
  for (const w of data.ways) {
    const pts = w.nodes
      .map((id) => data.nodes.get(id))
      .filter((n): n is OsmNode => !!n)
      .map(project);
    if (pts.length < 2) {
      skipped++;
      continue;
    }
    const closed =
      pts.length >= 4 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1];
    const t = w.tags;
    const name = t.name;
    const id = `${prefix}-w${w.id}`;
    const line = (layer: AuthoredFeature['properties']['layer'], props: Record<string, unknown>) =>
      push({
        type: 'Feature',
        id,
        geometry: { type: 'LineString', coordinates: pts },
        properties: {
          layer,
          origin: 'authored',
          ...(name ? { name } : {}),
          ...props,
        } as AuthoredFeature['properties'],
      });
    const polygon = (layer: AuthoredFeature['properties']['layer'], props: Record<string, unknown>) =>
      push({
        type: 'Feature',
        id,
        geometry: { type: 'Polygon', coordinates: [pts] },
        properties: {
          layer,
          origin: 'authored',
          ...(name ? { name } : {}),
          ...props,
        } as AuthoredFeature['properties'],
      });
    if (t.highway) {
      const h = t.highway;
      const kind = ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link'].includes(h)
        ? 'artery'
        : ['secondary', 'tertiary', 'secondary_link', 'tertiary_link'].includes(h)
          ? 'collector'
          : ['residential', 'unclassified', 'living_street', 'service', 'road', 'pedestrian'].includes(h)
            ? 'local'
            : null;
      if (!kind) {
        skipped++;
        continue;
      }
      line('street', { kind, widthM: kind === 'artery' ? 14 : kind === 'collector' ? 10 : 7, osm: h });
    } else if (t.railway && ['rail', 'light_rail', 'narrow_gauge', 'subway'].includes(t.railway))
      line('rail', { kind: t.railway === 'rail' ? 'mainline' : 'branch', osm: t.railway });
    else if (t.railway === 'tram') line('tram', { osm: 'tram' });
    else if (t.building && closed && options.buildings !== false) {
      const levels = Number(t['building:levels']);
      const b = t.building;
      const kind = [
        'house',
        'residential',
        'detached',
        'semidetached_house',
        'terrace',
        'apartments',
      ].includes(b)
        ? 'house'
        : ['industrial', 'warehouse', 'factory'].includes(b)
          ? 'warehouse'
          : ['church', 'chapel', 'cathedral', 'temple', 'mosque', 'synagogue'].includes(b)
            ? 'church'
            : ['retail', 'commercial', 'office'].includes(b)
              ? 'shop'
              : 'building';
      polygon('building', {
        kind,
        floors: Number.isFinite(levels) && levels > 0 ? Math.round(levels) : 2,
        osm: b,
      });
    } else if (
      closed &&
      (t.natural === 'water' || t.water || t.waterway === 'riverbank' || t.landuse === 'reservoir')
    )
      polygon('water', { osm: t.natural ?? t.water ?? 'water' });
    else if (t.waterway === 'canal')
      line('water', { kind: 'canal', widthM: Number(t.width) || 12, osm: 'canal' });
    else if (closed && (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub'))
      polygon('vegetation', { kind: 'forest', osm: t.natural ?? t.landuse });
    else if (
      closed &&
      (t.leisure === 'park' ||
        t.leisure === 'garden' ||
        t.landuse === 'grass' ||
        t.landuse === 'recreation_ground')
    )
      polygon('zone', { kind: 'park', osm: t.leisure ?? t.landuse });
    else if (closed && t.landuse === 'industrial') polygon('zone', { kind: 'industrial', osm: 'industrial' });
    else if (closed && (t.landuse === 'cemetery' || t.amenity === 'grave_yard'))
      polygon('zone', { kind: 'cemetery', osm: 'cemetery' });
    else if (closed && t.landuse === 'farmland') polygon('zone', { kind: 'farm', osm: 'farmland' });
    else if (closed && t.barrier === 'city_wall') line('wall', { osm: 'city_wall' });
    else if (!closed && (t.barrier === 'city_wall' || t.historic === 'citywalls'))
      line('wall', { osm: 'city_wall' });
    else skipped++;
  }
  for (const n of nodes) {
    const t = n.tags;
    const kind =
      t.railway === 'station'
        ? 'station'
        : t.amenity === 'place_of_worship'
          ? 'church'
          : t.tourism || t.amenity
            ? (t.amenity ?? t.tourism)
            : null;
    if (!kind || !t.name) continue;
    push({
      type: 'Feature',
      id: `${prefix}-n${n.id}`,
      geometry: { type: 'Point', coordinates: project(n) },
      properties: { layer: 'poi', origin: 'authored', kind, name: t.name } as AuthoredFeature['properties'],
    });
  }
  return {
    features,
    centre,
    bboxM: features.length ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
    counts,
    skipped,
  };
}

/** Parse and convert in one call. */
export function importOsm(text: string, options: OsmImportOptions = {}): OsmImportResult {
  return osmToAuthored(parseOsm(text), options);
}
