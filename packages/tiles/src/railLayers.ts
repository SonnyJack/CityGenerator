import type { FeatureCollection, Geometry, LineString, Point } from 'geojson';
import type { CrossingProps, RailOutput, RoadsOutput, TrackProps, TramOutput } from '@citygen/core';
import { railCrossings } from '@citygen/core';
import type { TileLayerInput } from './builder.js';

type AnyFc = FeatureCollection<Geometry, Record<string, unknown>>;

/**
 * Eager vector layers for the railway and trams: tracks (rail and tram lines
 * together, distinguished by `class`), stations and stops, yards and depots,
 * and the crossings where tracks meet regional roads or town streets.
 */
export function railLayers(
  rail: RailOutput | null,
  trams: TramOutput[],
  roads: RoadsOutput | null,
  extraTracks: FeatureCollection<LineString, TrackProps> | null = null,
): TileLayerInput[] {
  const tracks: AnyFc['features'] = [
    ...((rail?.tracks.features ?? []) as unknown as AnyFc['features']),
    ...((extraTracks?.features ?? []) as unknown as AnyFc['features']),
    ...trams.flatMap((t) => t.lines.features as unknown as AnyFc['features']),
  ];
  const stations: AnyFc['features'] = [
    ...((rail?.stations.features ?? []) as unknown as AnyFc['features']),
    ...trams.flatMap((t) => t.stops.features as unknown as AnyFc['features']),
  ];
  const structures: AnyFc['features'] = [
    ...((rail?.structures.features ?? []) as unknown as AnyFc['features']),
    ...trams.flatMap((t) => t.structures.features as unknown as AnyFc['features']),
  ];
  const crossings: FeatureCollection<Point, CrossingProps>['features'] = [
    ...trams.flatMap((t) => t.crossings.features),
    ...(rail && roads
      ? railCrossings(rail.tracks, roads.roads.features as unknown as never[], { minSpacingM: 40 }).features
      : []),
  ];
  const portals = (rail?.portals.features ?? []) as unknown as AnyFc['features'];
  return [
    { name: 'rail', features: { type: 'FeatureCollection', features: tracks }, minZoom: 8 },
    { name: 'stations', features: { type: 'FeatureCollection', features: stations }, minZoom: 9 },
    { name: 'railStructures', features: { type: 'FeatureCollection', features: structures }, minZoom: 11 },
    {
      name: 'crossings',
      features: {
        type: 'FeatureCollection',
        features: [...(crossings as unknown as AnyFc['features']), ...portals],
      },
      minZoom: 12,
    },
  ];
}

export type RailLine = LineString;
