import { DOCUMENT_VERSION } from './schema.js';

/**
 * Document migrations. Each migration upgrades from version N to N+1 and must
 * be pure. Migrations are applied in order until the current version is reached.
 *
 * Version history:
 *  1 — pre-release draft: `{ format, version: 1, spec: CitySpec }` with a flat
 *      spec (`seed`, `extent`, `era`, `name`), no authored geometry.
 *  2 — MapDocument: meta + RegionSpec + authored + overrides + annotations.
 */

export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

const ERA_TO_YEAR: Record<string, number> = {
  medieval: 1400,
  renaissance: 1650,
  industrial: 1850,
  modern: 1985,
  nearFuture: 2050,
};

export const migrations: Record<number, Migration> = {
  1: (doc) => {
    const spec = (doc.spec ?? {}) as Record<string, unknown>;
    const era = typeof spec.era === 'string' ? spec.era : 'modern';
    const now = typeof doc.created === 'string' ? doc.created : '1970-01-01T00:00:00.000Z';
    const { era: _era, name: _name, ...rest } = spec;
    return {
      format: 'citygen',
      version: 2,
      meta: {
        name: typeof spec.name === 'string' ? spec.name : 'Untitled region',
        created: now,
        modified: now,
        app: 'citygenerator',
      },
      spec: { ...rest, year: ERA_TO_YEAR[era] ?? 1985 },
      authored: { type: 'FeatureCollection', features: [] },
      overrides: [],
      annotations: [],
    };
  },
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Upgrade a raw parsed document object to the current version (does not validate). */
export function migrateDocument(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError('Document must be a JSON object');
  }
  let doc = raw as Record<string, unknown>;
  if (doc.format !== 'citygen')
    throw new MigrationError('Not a CityGenerator document (missing "format": "citygen")');
  let version = typeof doc.version === 'number' ? doc.version : 1;
  if (version > DOCUMENT_VERSION) {
    throw new MigrationError(
      `Document version ${version} is newer than this app supports (${DOCUMENT_VERSION})`,
    );
  }
  while (version < DOCUMENT_VERSION) {
    const step = migrations[version];
    if (!step) throw new MigrationError(`No migration from version ${version}`);
    doc = step(doc);
    version = typeof doc.version === 'number' ? doc.version : version + 1;
  }
  return doc;
}
