import type { MapDocument } from '@citygen/core';
import type { Command } from '@citygen/editor';

/**
 * What the assistant needs from the application. The web app implements it
 * over the store, the engine worker and the map; tests and the evaluation
 * runner implement it in memory. Nothing here touches the DOM.
 */

export interface SettlementBrief {
  id: string;
  name: string;
  kind: string;
  population: number;
  /** Centre in model metres (x east, y north, origin at the region centre). */
  center: [number, number];
  radiusM: number;
  walled?: boolean;
  culture?: string;
  districts?: number;
}

export interface FacilityBrief {
  id: string;
  type: string;
  name: string;
  settlement: string | null;
  center: [number, number];
  pinned: boolean;
  outcome: string;
}

export interface RegionSummary {
  name: string;
  regionName: string;
  seed: string;
  year: number;
  anchorYear?: number;
  events?: { id: string; kind: string; year: number; center: [number, number]; radiusM: number }[];
  era: string;
  culture: string;
  biome: string;
  extentM: { width: number; height: number };
  terrain: { preset: string; seaLevelM: number; maxElevationM?: number; rivers: string[] };
  settlements: SettlementBrief[];
  facilities: FacilityBrief[];
  rail: { stations: number; trackKm: number; tramLines?: number };
  roads?: { roadKm?: number };
  authored: { count: number; byLayer: Record<string, number> };
  annotations: { id: string; kind: string; text: string; gmOnly: boolean }[];
  overrides: number;
  warnings: string[];
}

export interface SettlementSummary extends SettlementBrief {
  founded?: number;
  streetPattern?: string;
  ways: number;
  districts: number;
  districtList: { id: string; name: string; ward?: string; center: [number, number] }[];
  facilities: FacilityBrief[];
  stations: { id: string; name: string; center: [number, number] }[];
  premises: number;
  businesses: { name: string; use: string; address?: string }[];
  wealth?: string;
  density?: string;
}

export interface AreaDescription {
  x: number;
  y: number;
  elevationM?: number;
  slope?: number;
  ground?: string;
  settlement?: { id: string; name: string } | null;
  district?: string;
  ward?: string;
  zone?: string;
  wealth?: string;
  density?: string;
  why?: string;
  building?: { id: string; name: string; kind: string; use: string; address?: string; material?: string };
  facility?: { id: string; name: string; type: string };
  street?: { id: string; name: string; class?: string };
  nearby: { id: string; kind: string; name: string; distanceM: number }[];
}

export interface FindQuery {
  kind?:
    'settlement' | 'facility' | 'building' | 'street' | 'district' | 'station' | 'annotation' | 'authored';
  name?: string;
  settlement?: string;
  bbox?: [number, number, number, number];
  limit?: number;
}

export interface FoundFeature {
  id: string;
  kind: string;
  name: string;
  center: [number, number];
  settlement?: string | null;
  properties?: Record<string, unknown>;
}

export interface GeneratedHit {
  id: string;
  layer: 'buildings' | 'streets' | 'patches';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

export interface Snapshot {
  pngBase64: string;
  width: number;
  height: number;
}

export interface ToolHost {
  document(): MapDocument;
  /** Apply a validated command. Throws on schema or apply errors. */
  dispatch(command: Command): { warnings: string[] };
  historyLength(): number;
  undo(): boolean;
  redo(): boolean;
  newId(prefix: string): string;
  /** Wait for the engine to finish regenerating after edits (no-op in memory). */
  settle(): Promise<void>;
  regionSummary(): Promise<RegionSummary>;
  settlementSummary(id: string): Promise<SettlementSummary | null>;
  describeArea(x: number, y: number, radiusM: number): Promise<AreaDescription>;
  findFeatures(query: FindQuery): Promise<FoundFeature[]>;
  /** PNG of a bbox in model metres; null when rendering is not available. */
  snapshot(
    bbox: [number, number, number, number],
    options: { theme?: string; layers?: string[]; maxPx?: number },
  ): Promise<Snapshot | null>;
  generatedAt(x: number, y: number, toleranceM: number): Promise<GeneratedHit | null>;
  /** Turn a generated feature into an authored (frozen) one; returns its new id. */
  freezeGenerated(hit: GeneratedHit): string;
}
