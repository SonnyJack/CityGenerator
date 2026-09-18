import { Rng } from '../random/rng.js';
import type { CulturePack, Grammar } from './schema.js';

/**
 * Deterministic names from culture-pack grammars. Every scope keeps the names
 * it has handed out so streets and districts stay unique within a settlement;
 * a colonial overlay contributes a share of the names after its year.
 */
export type StreetClass = 'artery' | 'road' | 'collector' | 'street' | 'lane';

export class NameGenerator {
  private readonly used = new Set<string>();
  private readonly rng: Rng;
  private readonly packs: { pack: CulturePack; weight: number }[];

  constructor(
    primary: CulturePack,
    seed: string,
    year: number,
    resolve: (id: string) => CulturePack | undefined,
    mix: { culture: string; weight: number }[] = [],
  ) {
    this.rng = new Rng(`${seed}/names`);
    this.packs = [{ pack: primary, weight: 1 }];
    const c = primary.colonial;
    if (c && year >= c.from && (c.to === undefined || year <= c.to)) {
      const other = resolve(c.culture);
      if (other) {
        this.packs[0]!.weight = 1 - c.share;
        this.packs.push({ pack: other, weight: c.share });
      }
    }
    for (const m of mix) {
      const other = resolve(m.culture);
      if (other && other.id !== primary.id) this.packs.push({ pack: other, weight: m.weight });
    }
  }

  /** Pick the pack a name comes from (weighted). */
  private pick(scope: string): CulturePack {
    if (this.packs.length === 1) return this.packs[0]!.pack;
    const r = this.rng.fork(scope);
    return r.weighted(
      this.packs.map((p) => p.pack),
      this.packs.map((p) => p.weight),
    );
  }

  /** Expand a grammar pattern with `{token}` parts; `given`/`family`/`suffix` are pack-level lists. */
  expand(pack: CulturePack, grammar: Grammar, rng: Rng, extra: Record<string, string[]> = {}): string {
    const pattern = rng.weighted(
      grammar.patterns,
      grammar.patterns.map(() => 1),
    );
    const out = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
      const list =
        extra[key] ??
        grammar.parts[key] ??
        (key === 'given' ? pack.naming.given : key === 'family' ? pack.naming.family : undefined);
      if (!list || !list.length) return '';
      return list[rng.int(0, list.length - 1)]!;
    });
    return out
      .replace(/\s+/g, ' ')
      .replace(/\s([,'’])/g, '$1')
      .trim();
  }

  /** A unique name for a scope, retrying the grammar and finally numbering. */
  private unique(scope: string, make: (rng: Rng) => string): string {
    for (let attempt = 0; attempt < 12; attempt++) {
      const name = make(this.rng.fork(`${scope}/${attempt}`));
      if (name && !this.used.has(name)) {
        this.used.add(name);
        return name;
      }
    }
    const base = make(this.rng.fork(`${scope}/final`));
    let n = 2;
    while (this.used.has(`${base} ${n}`)) n++;
    const name = `${base} ${n}`;
    this.used.add(name);
    return name;
  }

  settlement(id: string): string {
    const pack = this.pick(`settlement/${id}`);
    return this.unique(`settlement/${id}`, (rng) => this.expand(pack, pack.naming.settlement, rng));
  }

  street(id: string, cls: StreetClass): string {
    const pack = this.pick(`street/${id}`);
    const suffix = pack.naming.streetSuffix[cls];
    return this.unique(`street/${id}`, (rng) => this.expand(pack, pack.naming.street, rng, { suffix }));
  }

  district(id: string, context: Record<string, string[]> = {}): string {
    const pack = this.pick(`district/${id}`);
    return this.unique(`district/${id}`, (rng) => this.expand(pack, pack.naming.district, rng, context));
  }

  quarter(kind: keyof CulturePack['naming']['quarters']): string {
    const pack = this.packs[0]!.pack;
    const name = pack.naming.quarters[kind];
    this.used.add(name);
    return name;
  }

  water(id: string): string {
    const pack = this.pick(`water/${id}`);
    return this.unique(`water/${id}`, (rng) => this.expand(pack, pack.naming.water, rng));
  }

  business(id: string, trade: string): string {
    const pack = this.pick(`business/${id}`);
    return this.expand(pack, pack.naming.business, this.rng.fork(`business/${id}`), { trade: [trade] });
  }

  person(id: string): { given: string; family: string } {
    const pack = this.pick(`person/${id}`);
    const rng = this.rng.fork(`person/${id}`);
    return {
      given: pack.naming.given[rng.int(0, pack.naming.given.length - 1)]!,
      family: pack.naming.family[rng.int(0, pack.naming.family.length - 1)]!,
    };
  }

  /** The primary pack's word for a generic building kind. */
  buildingKind(kind: string): string {
    return this.packs[0]!.pack.conventions.buildingKinds[kind] ?? kind;
  }
}
