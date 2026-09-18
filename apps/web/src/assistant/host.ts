import type {
  AreaDescription,
  FindQuery,
  FoundFeature,
  GeneratedHit,
  RegionSummary,
  SettlementSummary,
  Snapshot,
  ToolHost,
} from '@citygen/assistant';
import type { Command } from '@citygen/editor';
import { CULTURE_PACKS } from '@citygen/core';
import { engine } from '../engine/client.js';
import { newId, useApp } from '../store.js';
import { exportPng } from '../export/exports.js';

/**
 * The assistant's view of the running app: commands go through the store's
 * bus (so they land in the shared undo history), reads go to the engine
 * worker, and snapshots use the hidden export map.
 */
export class WebHost implements ToolHost {
  document() {
    return useApp.getState().document;
  }

  dispatch(command: Command): { warnings: string[] } {
    const s = useApp.getState();
    const before = s.history.length;
    s.dispatch(command);
    const after = useApp.getState();
    if (after.error && after.history.length === before) throw new Error(after.error);
    return { warnings: after.warnings };
  }

  historyLength(): number {
    return useApp.getState().history.length;
  }
  undo(): boolean {
    const s = useApp.getState();
    if (!s.canUndo) return false;
    s.undo();
    return true;
  }
  redo(): boolean {
    const s = useApp.getState();
    if (!s.canRedo) return false;
    s.redo();
    return true;
  }
  newId(prefix: string): string {
    return newId(prefix);
  }

  /** Wait until the engine has caught up with the document (bounded). */
  async settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    if (useApp.getState().status !== 'generating') return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve();
      }, 120_000);
      const unsub = useApp.subscribe((s) => {
        if (s.status !== 'generating') {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
  }

  async regionSummary(): Promise<RegionSummary> {
    await this.settle();
    const s = useApp.getState();
    const doc = s.document;
    const stats = s.stats;
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
        ...(doc.spec.settlements.find((x) => x.id === t.id)?.culture
          ? { culture: doc.spec.settlements.find((x) => x.id === t.id)!.culture! }
          : {}),
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
      authored: { count: doc.authored.features.length, byLayer },
      annotations: doc.annotations.map((a) => ({ id: a.id, kind: a.kind, text: a.text, gmOnly: a.gmOnly })),
      overrides: doc.overrides.length,
      warnings: [
        ...(s.warnings ?? []),
        ...(stats?.facilities.failures ?? []).map(
          (f) => `${f.type} for ${f.settlement ?? 'region'}: ${f.reason}`,
        ),
      ],
    };
  }

  async settlementSummary(id: string): Promise<SettlementSummary | null> {
    await this.settle();
    return engine().settlementSummary(id);
  }

  async describeArea(x: number, y: number, radiusM: number): Promise<AreaDescription> {
    await this.settle();
    const info = await engine().inspect(x, y);
    const bbox: [number, number, number, number] = [x - radiusM, y - radiusM, x + radiusM, y + radiusM];
    const near = (await engine().find({ bbox, limit: 200 }))
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
    return engine().find(query);
  }

  async snapshot(
    bbox: [number, number, number, number],
    options: { theme?: string; layers?: string[]; maxPx?: number },
  ): Promise<Snapshot | null> {
    if (!window.__citygenMap) return null;
    await this.settle();
    const [minX, minY, maxX, maxY] = bbox;
    const maxPx = options.maxPx ?? 1024;
    const pxPerM = Math.min(1, maxPx / Math.max(maxX - minX, maxY - minY));
    const png = await exportPng({
      frame: { minX, minY, maxX, maxY },
      pxPerM,
      player: false,
      gridM: 1.5,
      pixelsPerGrid: 100,
      name: 'snapshot',
      ...(options.theme ? { themeId: options.theme } : {}),
    });
    return { pngBase64: png.dataUrl.split(',')[1] ?? '', width: png.width, height: png.height };
  }

  async generatedAt(x: number, y: number, toleranceM: number): Promise<GeneratedHit | null> {
    await this.settle();
    const hit = await engine().generatedAt(x, y, toleranceM);
    return hit
      ? {
          id: hit.id,
          layer: hit.layer,
          geometry: hit.geometry as GeneratedHit['geometry'],
          properties: hit.properties,
        }
      : null;
  }

  freezeGenerated(hit: GeneratedHit): string {
    const before = this.document().authored.features.map((f) => f.id);
    const s = useApp.getState();
    // Reuse the editor's freeze path so the result matches a manual freeze.
    useApp.setState({ generatedHit: hit as never });
    s.freezeGenerated();
    const after = this.document().authored.features.find((f) => !before.includes(f.id));
    if (!after) throw new Error('freeze produced no feature');
    return after.id;
  }
}
