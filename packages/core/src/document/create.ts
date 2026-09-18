import { mapDocumentSchema, type MapDocument, type RegionSpec } from './schema.js';

export interface CreateDocumentOptions {
  seed?: string;
  name?: string;
  year?: number;
  widthM?: number;
  heightM?: number;
  /** ISO timestamp; supplied by the caller so the engine never reads the clock. */
  now: string;
  spec?: Partial<RegionSpec>;
}

/** A new document with sensible defaults. */
export function createDocument(options: CreateDocumentOptions): MapDocument {
  const seed = options.seed ?? 'arkham';
  const spec = {
    seed,
    extent: { widthM: options.widthM ?? 20_000, heightM: options.heightM ?? 20_000 },
    year: options.year ?? 1925,
    ...options.spec,
  };
  return mapDocumentSchema.parse({
    format: 'citygen',
    version: 2,
    meta: {
      name: options.name ?? 'Untitled region',
      created: options.now,
      modified: options.now,
      app: 'citygenerator',
    },
    spec,
  });
}
