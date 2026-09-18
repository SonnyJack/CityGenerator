import { mapDocumentSchema, type MapDocument } from './schema.js';
import { migrateDocument } from './migrate.js';

export class DocumentValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid document:\n${issues.join('\n')}`);
    this.name = 'DocumentValidationError';
    this.issues = issues;
  }
}

/** Parse, migrate and validate a document from JSON text. */
export function parseDocument(text: string): MapDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DocumentValidationError([`Not valid JSON: ${(e as Error).message}`]);
  }
  return validateDocument(migrateDocument(raw));
}

/** Validate an already-parsed, current-version document object. */
export function validateDocument(raw: unknown): MapDocument {
  const result = mapDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new DocumentValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Serialise a document to JSON text (pretty-printed for diff-friendliness). */
export function serializeDocument(doc: MapDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}
