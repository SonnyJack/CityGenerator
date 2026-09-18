/**
 * Pack registries: a JSON index, hosted anywhere, that lists culture packs,
 * feature types and example documents. The web app's Gallery and the
 * `citygen packs` command read the same format.
 *
 * ```json
 * {
 *   "name": "Miskatonic packs",
 *   "description": "…",
 *   "packs": [{ "file": "lowlands.json", "name": "Lowlands", "kind": "culturePack", "description": "…" }],
 *   "documents": [{ "file": "arkham.citygen.json", "name": "Arkham, 1925", "seed": "arkham", "year": 1925 }]
 * }
 * ```
 *
 * `file` is resolved against the index URL; `url` may be given instead for
 * an absolute location. A bare array of pack entries, or of document
 * entries (with a `seed`), is accepted too.
 */
export interface RegistryPack {
  url: string;
  name: string;
  kind: 'culturePack' | 'featureType';
  description: string;
  author?: string;
}

export interface RegistryDocument {
  url: string;
  name: string;
  description: string;
  seed?: string;
  year?: number;
  culture?: string;
}

export interface Registry {
  /** The index URL. */
  url: string;
  name: string;
  description: string;
  packs: RegistryPack[];
  documents: RegistryDocument[];
}

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function resolve(entry: Raw, base: string): string | null {
  const url = str(entry.url) || str(entry.file);
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

function pack(entry: unknown, base: string): RegistryPack | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Raw;
  const url = resolve(e, base);
  const kind = e.kind === 'featureType' ? 'featureType' : e.kind === 'culturePack' ? 'culturePack' : null;
  if (!url || !kind) return null;
  return {
    url,
    kind,
    name: str(e.name, url.split('/').pop() ?? url),
    description: str(e.description),
    ...(str(e.author) ? { author: str(e.author) } : {}),
  };
}

function document(entry: unknown, base: string): RegistryDocument | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Raw;
  const url = resolve(e, base);
  if (!url) return null;
  return {
    url,
    name: str(e.name, url.split('/').pop() ?? url),
    description: str(e.description),
    ...(str(e.seed) ? { seed: str(e.seed) } : {}),
    ...(typeof e.year === 'number' ? { year: e.year } : {}),
    ...(str(e.culture) ? { culture: str(e.culture) } : {}),
  };
}

const compact = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);

/** Parse a registry index; throws on malformed JSON, tolerates unknown entries. */
export function parseRegistry(text: string, url: string, fallbackName?: string): Registry {
  const json: unknown = JSON.parse(text);
  const name = fallbackName ?? new URL(url).host;
  if (Array.isArray(json)) {
    // A bare list: packs when entries carry a kind, documents otherwise.
    const packs = compact(json.map((e) => pack(e, url)));
    const documents = packs.length ? [] : compact(json.map((e) => document(e, url)));
    return { url, name, description: '', packs, documents };
  }
  if (!json || typeof json !== 'object') throw new Error('registry index must be an object or an array');
  const j = json as Raw;
  return {
    url,
    name: str(j.name, name),
    description: str(j.description),
    packs: Array.isArray(j.packs) ? compact(j.packs.map((e) => pack(e, url))) : [],
    documents: Array.isArray(j.documents) ? compact(j.documents.map((e) => document(e, url))) : [],
  };
}

/** Fetch and parse a registry index. */
export async function fetchRegistry(
  url: string,
  fetchImpl: typeof fetch = fetch,
  fallbackName?: string,
): Promise<Registry> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseRegistry(await res.text(), url, fallbackName);
}
