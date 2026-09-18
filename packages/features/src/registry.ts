import type { z } from 'zod';

/**
 * The feature library is data: every entry is validated by schema and looked
 * up by id. Phase 0 defines the registry and the era-profile shape so later
 * phases add JSON files rather than code paths. Zone profiles, feature types,
 * biome packs and culture packs follow the same pattern (DESIGN §6.3, §6.5, §7).
 */

export class Registry<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(
    readonly kind: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  register(raw: unknown): T {
    const item = this.schema.parse(raw);
    if (this.items.has(item.id)) throw new Error(`${this.kind} "${item.id}" is already registered`);
    this.items.set(item.id, item);
    return item;
  }

  get(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown ${this.kind} "${id}"`);
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Items in stable (sorted id) order, so iteration is deterministic. */
  all(): T[] {
    return [...this.items.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
