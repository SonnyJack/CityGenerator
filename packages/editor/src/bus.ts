import { compare, applyPatch, type Operation } from 'fast-json-patch';
import type { MapDocument } from '@citygen/core';
import { commandSchema, TRANSIENT_COMMANDS, type Command } from './commands.js';
import { applyCommand, CommandError } from './apply.js';

export interface HistoryEntry {
  command: Command;
  /** JSON Patch that turns the post-command document back into the pre-command one. */
  inverse: Operation[];
  /** JSON Patch that re-applies the command's effect. */
  forward: Operation[];
  at: string;
}

export interface CommandBusOptions {
  now: () => string;
  maxHistory?: number;
}

export type BusListener = (
  document: MapDocument,
  event: { command?: Command; kind: 'command' | 'undo' | 'redo' | 'load' },
) => void;

/**
 * Applies validated commands to a document and keeps undo/redo history as
 * inverse JSON patches, so memory grows with the size of edits rather than the
 * size of the document.
 */
export class CommandBus {
  private doc: MapDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<BusListener>();
  private readonly now: () => string;
  private readonly maxHistory: number;

  constructor(initial: MapDocument, options: CommandBusOptions) {
    this.doc = initial;
    this.now = options.now;
    this.maxHistory = options.maxHistory ?? 200;
  }

  get document(): MapDocument {
    return this.doc;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get history(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the document (open/import). Clears history. */
  load(doc: MapDocument): void {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ kind: 'load' });
  }

  /** Validate and apply a command. Throws CommandError or a validation error; the document is unchanged on failure. */
  dispatch(input: unknown): { warnings: string[] } {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      throw new CommandError(
        `Invalid command: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    const command = parsed.data;
    const before = this.doc;
    const { document: after, warnings } = applyCommand(before, command, this.now());
    if (!TRANSIENT_COMMANDS.has(command.type)) {
      this.undoStack.push({
        command,
        inverse: compare(after, before),
        forward: compare(before, after),
        at: after.meta.modified,
      });
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
      this.redoStack = [];
    }
    this.doc = after;
    this.emit({ command, kind: 'command' });
    return { warnings };
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.doc = applyPatch(structuredClone(this.doc), entry.inverse, true, true).newDocument;
    this.redoStack.push(entry);
    this.emit({ command: entry.command, kind: 'undo' });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.doc = applyPatch(structuredClone(this.doc), entry.forward, true, true).newDocument;
    this.undoStack.push(entry);
    this.emit({ command: entry.command, kind: 'redo' });
    return true;
  }

  private emit(event: { command?: Command; kind: 'command' | 'undo' | 'redo' | 'load' }): void {
    for (const l of this.listeners) l(this.doc, event);
  }
}
