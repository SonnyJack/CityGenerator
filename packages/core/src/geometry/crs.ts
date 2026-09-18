import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

/**
 * Synthetic CRS for MapLibre. Model coordinates are planar metres with the
 * origin at the region centre, x east, y north. MapLibre needs lon/lat in Web
 * Mercator; we place the origin at (0°, 0°) where Mercator is conformal and
 * distortion over a 60 km region is negligible, and scale by the metres per
 * degree at the equator.
 */

export const METERS_PER_DEGREE = 111_319.490_793;

export function metersToLonLat([x, y]: readonly number[]): [number, number] {
  return [x! / METERS_PER_DEGREE, y! / METERS_PER_DEGREE];
}

export function lonLatToMeters([lon, lat]: readonly number[]): [number, number] {
  return [lon! * METERS_PER_DEGREE, lat! * METERS_PER_DEGREE];
}

function mapPositions(coords: unknown, fn: (p: Position) => Position): unknown {
  if (typeof (coords as Position)[0] === 'number') return fn(coords as Position);
  return (coords as unknown[]).map((c) => mapPositions(c, fn));
}

export function geometryToLonLat<G extends Geometry>(geometry: G): G {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(geometryToLonLat) } as G;
  }
  return { ...geometry, coordinates: mapPositions(geometry.coordinates, (p) => metersToLonLat(p)) } as G;
}

export function featureToLonLat<G extends Geometry, P>(feature: Feature<G, P>): Feature<G, P> {
  return { ...feature, geometry: geometryToLonLat(feature.geometry) };
}

export function collectionToLonLat<G extends Geometry, P>(
  fc: FeatureCollection<G, P>,
): FeatureCollection<G, P> {
  return { ...fc, features: fc.features.map(featureToLonLat) };
}

/** Approximate MapLibre zoom at which one metre spans `pixelsPerMeter` pixels (at the equator, 512 px tiles). */
export function zoomForScale(pixelsPerMeter: number): number {
  const metersPerPixelAtZ0 = (2 * Math.PI * 6_378_137) / 512;
  return Math.log2(metersPerPixelAtZ0 * pixelsPerMeter);
}
