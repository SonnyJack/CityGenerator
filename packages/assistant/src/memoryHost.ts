import { createDocument, type MapDocument } from '@citygen/core';
import { CommandBus, type Command } from '@citygen/editor';
import type {
  AreaDescription,
  FacilityBrief,
  FindQuery,
  FoundFeature,
  GeneratedHit,
  RegionSummary,
  SettlementBrief,
  SettlementSummary,
  ToolHost,
} from './host.js';
import { centroid } from './execute.js';

/**
 * An in-memory host for tests and the evaluation set: a real command bus over
 * a real document, with a small fixed "world" standing in for the engine.
 * Summaries merge the fixture with what the document says, so edits show up
 * in later reads.
 */
export interface MemoryWorld {
  regionName: string;
  era: string;
  settlements: (Omit<SettlementBrief, 'districts'> & {
    districts: { id: string; name: string; ward?: string; center: [number, number] }[];
  })[];
  facilities: FacilityBrief[];
  rivers: string[];
  stations: { id: string; name: string; settlement: string; center: [number, number] }[];
  buildings: {
    id: string;
    name: string;
    kind: string;
    use: string;
    address: string;
    settlement: string;
    center: [number, number];
    ring: [number, number][];
  }[];
  streets: {
    id: string;
    name: string;
    class: string;
    settlement: string;
    center: [number, number];
    line: [number, number][];
  }[];
}

export const DEFAULT_WORLD: MemoryWorld = {
  regionName: 'Greyton',
  era: 'Classic',
  rivers: ['Miskatonic River', 'Cold Brook'],
  settlements: [
    {
      id: 'city',
      name: 'New Boston',
      kind: 'city',
      population: 42000,
      center: [1200, -800],
      radiusM: 1900,
      walled: false,
      districts: [
        { id: 'city-core', name: 'Old Town', ward: 'market', center: [1200, -800] },
        { id: 'city-port', name: 'The Docks', ward: 'port', center: [1900, -1400] },
        { id: 'city-north', name: 'North End', ward: 'residential', center: [1100, 300] },
      ],
    },
    {
      id: 'village',
      name: 'Martin’s Corner',
      kind: 'village',
      population: 900,
      center: [-4200, 2600],
      radiusM: 350,
      walled: false,
      districts: [{ id: 'village-core', name: 'The Green', center: [-4200, 2600] }],
    },
  ],
  facilities: [
    {
      id: 'city-port-1',
      type: 'port',
      name: 'New Boston Port',
      settlement: 'city',
      center: [2000, -1500],
      pinned: false,
      outcome: 'placed',
    },
    {
      id: 'city-gasworks-1',
      type: 'gasworks',
      name: 'Gasworks',
      settlement: 'city',
      center: [2300, -300],
      pinned: false,
      outcome: 'placed',
    },
    {
      id: 'city-hospital-1',
      type: 'institution.hospital',
      name: 'Mercy Hospital',
      settlement: 'city',
      center: [-200, -500],
      pinned: false,
      outcome: 'placed',
    },
  ],
  stations: [{ id: 'st-city', name: 'New Boston Central', settlement: 'city', center: [800, -1300] }],
  buildings: [
    {
      id: 'b-1',
      name: 'The Gilman House',
      kind: 'townhouse',
      use: 'hotel',
      address: '12 Water Street',
      settlement: 'city',
      center: [1250, -850],
      ring: [
        [1240, -860],
        [1260, -860],
        [1260, -840],
        [1240, -840],
      ],
    },
    {
      id: 'b-2',
      name: 'Rice Bank Co.',
      kind: 'commercial',
      use: 'bank',
      address: '13 School Street',
      settlement: 'city',
      center: [1180, -780],
      ring: [
        [1170, -790],
        [1190, -790],
        [1190, -770],
        [1170, -770],
      ],
    },
    {
      id: 'b-3',
      name: 'The meeting house',
      kind: 'church',
      use: 'church',
      address: '1 The Green',
      settlement: 'village',
      center: [-4210, 2610],
      ring: [
        [-4220, 2600],
        [-4200, 2600],
        [-4200, 2620],
        [-4220, 2620],
      ],
    },
  ],
  streets: [
    {
      id: 's-1',
      name: 'Water Street',
      class: 'artery',
      settlement: 'city',
      center: [1300, -900],
      line: [
        [1000, -900],
        [1600, -900],
      ],
    },
    {
      id: 's-2',
      name: 'School Street',
      class: 'street',
      settlement: 'city',
      center: [1180, -700],
      line: [
        [1180, -900],
        [1180, -500],
      ],
    },
  ],
};

export class MemoryHost implements ToolHost {
  readonly bus: CommandBus;
  readonly world: MemoryWorld;
  private ids = 0;
  private hidden = new Set<string>();

  constructor(options: { document?: MapDocument; world?: MemoryWorld; seed?: string } = {}) {
    this.world = options.world ?? DEFAULT_WORLD;
    this.bus = new CommandBus(
      options.document ??
        createDocument({
          now: '2026-01-01T00:00:00.000Z',
          seed: options.seed ?? 'eval',
          name: 'Eval region',
        }),
      { now: () => '2026-01-01T00:00:00.000Z' },
    );
  }

  document(): MapDocument {
    return this.bus.document;
  }
  dispatch(command: Command): { warnings: string[] } {
    const r = this.bus.dispatch(command);
    return { warnings: r.warnings };
  }
  historyLength(): number {
    return this.bus.history.length;
  }
  undo(): boolean {
    return this.bus.undo();
  }
  redo(): boolean {
    return this.bus.redo();
  }
  newId(prefix: string): string {
    return `${prefix}-${++this.ids}`;
  }
  async settle(): Promise<void> {}

  private renames(): Map<string, string> {
    const m = new Map<string, string>();
    for (const o of this.document().overrides)
      if (o.op === 'setProperty' && o.key === 'name') m.set(o.target, String(o.value));
    return m;
  }
  private removed(): Set<string> {
    const s = new Set<string>();
    for (const o of this.document().overrides) if (o.op === 'remove' || o.op === 'suppress') s.add(o.target);
    return s;
  }

  private settlements(): SettlementBrief[] {
    const doc = this.document();
    const renames = this.renames();
    const fixture = this.world.settlements.map((s) => ({ ...s, name: renames.get(s.id) ?? s.name }));
    const specced = doc.spec.settlements.map((s) => {
      const base = fixture.find((f) => f.id === s.id);
      return {
        id: s.id,
        name: s.name ?? base?.name ?? s.id,
        kind: s.kind,
        population: s.population,
        center: s.site?.center ?? base?.center ?? [0, 0],
        radiusM: base?.radiusM ?? Math.sqrt(s.population) * 8,
        walled: base?.walled ?? false,
        ...(s.culture ? { culture: s.culture } : {}),
      } as SettlementBrief;
    });
    const ids = new Set(specced.map((s) => s.id));
    return [...specced, ...fixture.filter((f) => !ids.has(f.id)).map(({ districts: _d, ...s }) => s)];
  }

  private facilities(): FacilityBrief[] {
    const doc = this.document();
    const renames = this.renames();
    const removed = this.removed();
    const pins = new Map<string, [number, number]>();
    for (const o of doc.overrides) if (o.op === 'pin') pins.set(o.target, [o.x, o.y]);
    const requested: FacilityBrief[] = [
      ...doc.spec.features.map((f) => ({ f, settlement: null as string | null })),
      ...doc.spec.settlements.flatMap((s) =>
        s.features.map((f) => ({ f, settlement: s.id as string | null })),
      ),
    ].map(({ f, settlement }) => ({
      id: f.id,
      type: f.type,
      name: renames.get(f.id) ?? `${f.type} (requested)`,
      settlement,
      center: f.pin ? [f.pin.x, f.pin.y] : [0, 0],
      pinned: !!f.pin,
      outcome: 'placed',
    }));
    return [...this.world.facilities, ...requested]
      .filter((f) => !removed.has(f.id))
      .map((f) => ({
        ...f,
        name: renames.get(f.id) ?? f.name,
        ...(pins.has(f.id) ? { center: pins.get(f.id)!, pinned: true } : {}),
      }));
  }

  async regionSummary(): Promise<RegionSummary> {
    const doc = this.document();
    const byLayer: Record<string, number> = {};
    for (const f of doc.authored.features)
      byLayer[f.properties.layer] = (byLayer[f.properties.layer] ?? 0) + 1;
    return {
      name: doc.meta.name,
      regionName: this.world.regionName,
      seed: doc.spec.seed,
      year: doc.spec.year,
      era: this.world.era,
      culture: doc.spec.culture,
      biome: doc.spec.biome,
      extentM: { width: doc.spec.extent.widthM, height: doc.spec.extent.heightM },
      terrain: {
        preset: doc.spec.terrain.preset,
        seaLevelM: doc.spec.terrain.seaLevel,
        rivers: this.world.rivers,
      },
      settlements: this.settlements(),
      facilities: this.facilities(),
      rail: { stations: this.world.stations.length, trackKm: 38, tramLines: 1 },
      authored: { count: doc.authored.features.length, byLayer },
      annotations: doc.annotations.map((a) => ({ id: a.id, kind: a.kind, text: a.text, gmOnly: a.gmOnly })),
      overrides: doc.overrides.length,
      warnings: [],
    };
  }

  async settlementSummary(id: string): Promise<SettlementSummary | null> {
    const s = this.settlements().find((x) => x.id === id);
    if (!s) return null;
    const w = this.world.settlements.find((x) => x.id === id);
    const businesses = this.world.buildings
      .filter((b) => b.settlement === id)
      .map((b) => ({ name: b.name, use: b.use, address: b.address }));
    return {
      ...s,
      ways: w ? 40 : 4,
      districts: w?.districts.length ?? 0,
      districtList: w?.districts ?? [],
      facilities: this.facilities().filter((f) => f.settlement === id),
      stations: this.world.stations
        .filter((x) => x.settlement === id)
        .map(({ id: sid, name, center }) => ({ id: sid, name, center })),
      premises: w ? 1200 : 40,
      businesses,
      wealth: 'middling',
      density: 'dense',
    };
  }

  async describeArea(x: number, y: number, radiusM: number): Promise<AreaDescription> {
    const near = (await this.findFeatures({ limit: 500 }))
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        distanceM: Math.hypot(f.center[0] - x, f.center[1] - y),
      }))
      .filter((f) => f.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
    const settlement = this.settlements().find(
      (s) => Math.hypot(s.center[0] - x, s.center[1] - y) <= s.radiusM,
    );
    const b = this.world.buildings.find(
      (bb) => Math.hypot(bb.center[0] - x, bb.center[1] - y) < 15 && !this.hidden.has(bb.id),
    );
    return {
      x,
      y,
      elevationM: 12 + Math.round(y / 100),
      slope: 0.02,
      ground: x > 2400 ? 'water' : 'grass',
      settlement: settlement ? { id: settlement.id, name: settlement.name } : null,
      ...(settlement ? { ward: 'residential', wealth: 'middling', density: 'dense' } : {}),
      ...(b ? { building: { id: b.id, name: b.name, kind: b.kind, use: b.use, address: b.address } } : {}),
      nearby: near.slice(0, 12),
    };
  }

  async findFeatures(query: FindQuery): Promise<FoundFeature[]> {
    const renames = this.renames();
    const removed = this.removed();
    const doc = this.document();
    const all: FoundFeature[] = [
      ...this.settlements().map((s) => ({ id: s.id, kind: 'settlement', name: s.name, center: s.center })),
      ...this.facilities().map((f) => ({
        id: f.id,
        kind: 'facility',
        name: f.name,
        center: f.center,
        settlement: f.settlement,
      })),
      ...this.world.buildings.map((b) => ({
        id: b.id,
        kind: 'building',
        name: renames.get(b.id) ?? b.name,
        center: b.center,
        settlement: b.settlement,
        properties: { use: b.use, address: b.address },
      })),
      ...this.world.streets.map((s) => ({
        id: s.id,
        kind: 'street',
        name: renames.get(s.id) ?? s.name,
        center: s.center,
        settlement: s.settlement,
        properties: { class: s.class },
      })),
      ...this.world.settlements.flatMap((s) =>
        s.districts.map((d) => ({
          id: d.id,
          kind: 'district',
          name: d.name,
          center: d.center,
          settlement: s.id,
        })),
      ),
      ...this.world.stations.map((s) => ({
        id: s.id,
        kind: 'station',
        name: s.name,
        center: s.center,
        settlement: s.settlement,
      })),
      ...doc.annotations.map((a) => ({
        id: a.id,
        kind: 'annotation',
        name: a.text,
        center: centroid(a.geometry as never),
      })),
      ...doc.authored.features.map((f) => ({
        id: f.id,
        kind: 'authored',
        name: String(f.properties.name ?? f.properties.layer),
        center: centroid(f.geometry as never),
        properties: { layer: f.properties.layer, origin: f.properties.origin },
      })),
    ].filter((f) => !removed.has(f.id));
    const name = query.name?.toLowerCase();
    return all
      .filter((f) => !query.kind || f.kind === query.kind)
      .filter(
        (f) =>
          !name ||
          f.name.toLowerCase().includes(name) ||
          String(f.properties?.address ?? '')
            .toLowerCase()
            .includes(name),
      )
      .filter((f) => !query.settlement || f.settlement === query.settlement || f.id === query.settlement)
      .filter(
        (f) =>
          !query.bbox ||
          (f.center[0] >= query.bbox[0] &&
            f.center[0] <= query.bbox[2] &&
            f.center[1] >= query.bbox[1] &&
            f.center[1] <= query.bbox[3]),
      )
      .slice(0, query.limit ?? 50);
  }

  async snapshot(): Promise<null> {
    return null;
  }

  async generatedAt(x: number, y: number, toleranceM: number): Promise<GeneratedHit | null> {
    const b = this.world.buildings.find(
      (bb) => Math.hypot(bb.center[0] - x, bb.center[1] - y) <= 12 + toleranceM,
    );
    if (!b) return null;
    return {
      id: b.id,
      layer: 'buildings',
      geometry: { type: 'Polygon', coordinates: [[...b.ring, b.ring[0]!]] },
      properties: { kind: b.kind, name: b.name, floors: 3 },
    };
  }

  freezeGenerated(hit: GeneratedHit): string {
    const id = this.newId('frozen');
    this.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id,
          geometry: hit.geometry as never,
          properties: {
            layer: hit.layer === 'buildings' ? 'building' : hit.layer === 'streets' ? 'street' : 'zone',
            origin: 'frozen',
            frozenFrom: hit.id,
            ...(typeof hit.properties.kind === 'string' ? { kind: hit.properties.kind } : {}),
          },
        },
      ],
    });
    return id;
  }
}
