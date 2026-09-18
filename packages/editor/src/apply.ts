import { applyPatch, type Operation } from 'fast-json-patch';
import { validateDocument, type MapDocument } from '@citygen/core';
import type { Command } from './commands.js';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface ApplyResult {
  document: MapDocument;
  /** Human-readable notes for the UI and the assistant (e.g. ids created). */
  warnings: string[];
}

/**
 * Pure application of a command to a document. Returns a new document; the
 * input is not mutated. `now` is passed in so the engine never reads the clock.
 */
export function applyCommand(doc: MapDocument, command: Command, now: string): ApplyResult {
  const next: MapDocument = structuredClone(doc);
  const warnings: string[] = [];

  switch (command.type) {
    case 'meta.rename':
      next.meta.name = command.name;
      break;
    case 'spec.patch': {
      const result = applyPatch(next.spec, command.ops as Operation[], true, true);
      next.spec = result.newDocument;
      break;
    }
    case 'spec.setSeed':
      next.spec.seed = command.seed;
      break;
    case 'year.set':
      next.spec.year = command.year;
      break;
    case 'authored.add': {
      const existing = new Set(next.authored.features.map((f) => f.id));
      for (const f of command.features) {
        if (existing.has(f.id)) throw new CommandError(`Authored feature "${f.id}" already exists`);
        existing.add(f.id);
        next.authored.features.push(f);
      }
      break;
    }
    case 'authored.update': {
      const f = next.authored.features.find((x) => x.id === command.id);
      if (!f) throw new CommandError(`Authored feature "${command.id}" not found`);
      if (command.geometry) f.geometry = command.geometry;
      if (command.properties) Object.assign(f.properties, command.properties);
      break;
    }
    case 'authored.remove': {
      const ids = new Set(command.ids);
      const before = next.authored.features.length;
      next.authored.features = next.authored.features.filter((f) => !ids.has(f.id));
      if (next.authored.features.length === before)
        warnings.push('No authored features matched the given ids');
      break;
    }
    case 'annotation.add':
      if (next.annotations.some((a) => a.id === command.annotation.id)) {
        throw new CommandError(`Annotation "${command.annotation.id}" already exists`);
      }
      next.annotations.push(command.annotation);
      break;
    case 'annotation.remove': {
      const ids = new Set(command.ids);
      next.annotations = next.annotations.filter((a) => !ids.has(a.id));
      break;
    }
    case 'viewport.set':
      next.viewport = command.viewport;
      break;
    case 'ui.set': {
      const ui = next.ui ?? { theme: 'atlas', layers: {}, terrain3d: false };
      if (command.theme !== undefined) ui.theme = command.theme;
      if (command.layers) ui.layers = { ...ui.layers, ...command.layers };
      if (command.terrain3d !== undefined) ui.terrain3d = command.terrain3d;
      next.ui = ui;
      break;
    }
    default: {
      const exhaustive: never = command;
      throw new CommandError(`Unknown command ${JSON.stringify(exhaustive)}`);
    }
  }

  next.meta.modified = now;
  // Validate the result so no command can leave the document in an invalid state.
  return { document: validateDocument(next), warnings };
}
