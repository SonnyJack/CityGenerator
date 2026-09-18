import {
  CULTURE_PACKS,
  createDocument,
  parseDocument,
  serializeDocument,
  type MapDocument,
} from '@citygen/core';
import { CommandBus, type Command } from '@citygen/editor';
import { createEngine, type EngineApi, type EngineStats } from '@citygen/engine';
import type {
  AreaDescription,
  FindQuery,
  FoundFeature,
  GeneratedHit,
  RegionSummary,
  SettlementSummary,
  ToolHost,
} from '@citygen/assistant';

const GENERATING_LAYERS = new Set([
  'street',
  'rail',
  'tram',
  'water',
  'wall',
  'zone',
  'building',
  'facility',
  'vegetation',
  'terrainEdit',
  'fieldEdit',
]);

function engineKey(doc: MapDocument): string {
  const authored = doc.authored.features
    .filter((f) => GENERATING_LAYERS.has(f.properties.layer))
    .map((f) => {
      const { name: _name, ...rest } = f.properties;
      return [f.id, f.geometry, rest];
    });
  return JSON.stringify([doc.spec, authored, doc.overrides]);
}

/**
 * A tool host for the command line and the MCP server: a command bus over a
 * document on disk and a headless engine that regenerates when the document
 * changes. The same tools the browser assistant uses run here unchanged.
 */
export class EngineHost implements ToolHost {
  readonly engine: EngineApi = createEngine();
  bus: CommandBus;
  path: string | null = null;
  stats: EngineStats | null = null;
  private generatedKey = '';
  private ids = 0;
  private warnings: string[] = [];

  constructor(doc?: MapDocument) {
    this.bus = new CommandBus(doc ?? createDocument({ now: new Date().toISOString(), seed: 'arkham' }), {
      now: () => new Date().toISOString(),
    });
  }

  static async open(path: string): Promise<EngineHost> {
    const { readFile } = await import('node:fs/promises');
    const host = new EngineHost(parseDocument(await readFile(path, 'utf8')));
    host.path = path;
    return host;
  }

  async save(path = this.path): Promise<string> {
    if (!path) throw new Error('no path to save to');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, serializeDocument(this.document()));
    this.path = path;
    return path;
  }

  load(doc: MapDocument): void {
    this.bus.load(doc);
  }

  document(): MapDocument {
    return this.bus.document;
  }
  dispatch(command: Command): { warnings: string[] } {
    const r = this.bus.dispatch(command);
    this.warnings = r.warnings;
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
    return `${prefix}-${Date.now().toString(36)}-${++this.ids}`;
  }

  /** Regenerate when the generating parts of the document changed. */
  async settle(): Promise<void> {
    const doc = this.document();
    const key = engineKey(doc);
    if (key === this.generatedKey && this.stats) return;
    const { stats } = await this.engine.setDocument(doc, { sketch: false });
    this.stats = stats;
    this.generatedKey = key;
  }

  async regionSummary(): Promise<RegionSummary> {
    await this.settle();
    const doc = this.document();
    const stats = this.stats;
    const byLayer: Record<string, number> = {};
    for (const f of doc.authored.features)
      byLayer[f.properties.layer] = (byLayer[f.properties.layer] ?? 0) + 1;
    const cultureName = CULTURE_PACKS.find((c) => c.id === doc.spec.culture)?.name ?? doc.spec.culture;
    return {
      name: doc.meta.name,
      regionName: stats?.regionName ?? doc.meta.name,
      seed: doc.spec.seed,
      year: doc.spec.year,
      anchorYear: doc.spec.anchorYear,
      events: doc.spec.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        year: e.year,
        center: e.center,
        radiusM: e.radiusM,
      })),
      era: stats?.era.name ?? '',
      culture: `${doc.spec.culture} (${cultureName})`,
      biome: doc.spec.biome,
      extentM: { width: doc.spec.extent.widthM, height: doc.spec.extent.heightM },
      terrain: {
        preset: doc.spec.terrain.preset,
        seaLevelM: doc.spec.terrain.seaLevel,
        ...(stats ? { maxElevationM: Math.round(stats.terrain.maxM) } : {}),
        rivers: stats?.riverNames ?? [],
      },
      settlements: (stats?.settlements ?? []).map((t) => ({
        id: t.id,
        name: t.name ?? t.id,
        kind: t.kind,
        population: t.population,
        center: t.center,
        radiusM: t.radiusM,
        walled: t.walled,
        districts: t.districts,
      })),
      facilities: (stats?.facilities.list ?? []).map((f) => ({
        id: f.id,
        type: f.type,
        name: f.name,
        settlement: f.settlement,
        center: f.center,
        pinned: f.pinned,
        outcome: f.outcome,
      })),
      rail: {
        stations: stats?.rail.stations ?? 0,
        trackKm: stats?.rail.trackKm ?? 0,
        tramLines: stats?.rail.tramLines ?? 0,
      },
      roads: { roadKm: stats?.roads?.roadKm },
      ...(stats?.utilities
        ? {
            utilities: {
              waterKm: stats.utilities.waterKm,
              gasKm: stats.utilities.gasKm,
              powerKm: stats.utilities.powerKm,
              sewerKm: stats.utilities.sewerKm,
              pipelineKm: stats.utilities.pipelineKm,
              canalKm: stats.utilities.canalKm,
            },
          }
        : {}),
      authored: { count: doc.authored.features.length, byLayer },
      annotations: doc.annotations.map((a) => ({ id: a.id, kind: a.kind, text: a.text, gmOnly: a.gmOnly })),
      overrides: doc.overrides.length,
      warnings: [
        ...this.warnings,
        ...(stats?.facilities.failures ?? []).map(
          (f) => `${f.type} for ${f.settlement ?? 'region'}: ${f.reason}`,
        ),
      ],
    };
  }

  async settlementSummary(id: string): Promise<SettlementSummary | null> {
    await this.settle();
    return this.engine.settlementSummary(id);
  }

  async describeArea(x: number, y: number, radiusM: number): Promise<AreaDescription> {
    await this.settle();
    const info = await this.engine.inspect(x, y);
    const bbox: [number, number, number, number] = [x - radiusM, y - radiusM, x + radiusM, y + radiusM];
    const near = (await this.engine.find({ bbox, limit: 200 }))
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        distanceM: Math.round(Math.hypot(f.center[0] - x, f.center[1] - y)),
      }))
      .filter((f) => f.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 15);
    if (!info) return { x, y, nearby: near };
    return {
      x,
      y,
      elevationM: Math.round(info.elevationM * 10) / 10,
      slope: Math.round(info.slope * 1000) / 1000,
      ground: info.water === 'land' ? info.landcover : info.water,
      settlement: info.settlement
        ? { id: info.settlement.id, name: info.settlement.name ?? info.settlement.id }
        : null,
      ...(info.patch?.district ? { district: info.patch.district } : {}),
      ...(info.patch ? { ward: info.patch.ward, why: info.patch.why } : {}),
      wealth: info.wealthClass,
      density: info.densityClass,
      ...(info.building
        ? {
            building: {
              id: info.building.id,
              name: info.building.name,
              kind: info.building.kindLabel,
              use: info.building.useLabel,
              ...(info.building.address ? { address: info.building.address } : {}),
              material: info.building.material,
            },
          }
        : {}),
      ...(info.facility
        ? { facility: { id: info.facility.id, name: info.facility.name, type: info.facility.type } }
        : {}),
      nearby: near,
    };
  }

  async findFeatures(query: FindQuery): Promise<FoundFeature[]> {
    await this.settle();
    return this.engine.find(query);
  }

  async snapshot(): Promise<null> {
    return null; // no renderer without a browser
  }

  async generatedAt(x: number, y: number, toleranceM: number): Promise<GeneratedHit | null> {
    await this.settle();
    const hit = await this.engine.generatedAt(x, y, toleranceM);
    return hit
      ? {
          id: hit.id,
          layer: hit.layer,
          geometry: hit.geometry as GeneratedHit['geometry'],
          properties: hit.properties,
        }
      : null;
  }

  async interior(buildingId: string) {
    await this.settle();
    return this.engine.interior(buildingId);
  }

  freezeGenerated(hit: GeneratedHit): string {
    const id = this.newId('frozen');
    const layer = hit.layer === 'buildings' ? 'building' : hit.layer === 'streets' ? 'street' : 'zone';
    const kind =
      typeof hit.properties.kind === 'string'
        ? hit.properties.kind
        : typeof hit.properties.ward === 'string'
          ? hit.properties.ward
          : typeof hit.properties.class === 'string'
            ? hit.properties.class
            : undefined;
    this.dispatch({
      type: 'authored.add',
      features: [
        {
          type: 'Feature',
          id,
          geometry: hit.geometry as never,
          properties: {
            layer,
            origin: 'frozen',
            frozenFrom: hit.id,
            ...(kind ? { kind } : {}),
            ...(typeof hit.properties.floors === 'number' ? { floors: hit.properties.floors } : {}),
          },
        },
      ],
    });
    return id;
  }
}
