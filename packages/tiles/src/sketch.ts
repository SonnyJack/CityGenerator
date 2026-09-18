import { Simplex2, fbm } from '@citygen/core';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

/**
 * Hand-drawn look for the ink theme: vertices are displaced by a smooth noise
 * field that depends only on world position, so shared boundaries between
 * adjacent polygons move together and stay watertight.
 */
export interface SketchOptions {
  /** Displacement amplitude in metres. */
  amplitudeM: number;
  /** Wavelength of the wobble in metres. */
  wavelengthM: number;
  /** Resample long segments so the wobble is visible on straight edges. */
  maxSegmentM?: number;
}

export function createSketch(seed: string, options: SketchOptions) {
  const nx = new Simplex2(`${seed}/sketch-x`);
  const ny = new Simplex2(`${seed}/sketch-y`);
  const { amplitudeM, wavelengthM } = options;
  const maxSeg = options.maxSegmentM ?? wavelengthM / 2;
  const displace = (p: Position): Position => {
    const [x, y] = p as [number, number];
    return [
      x + fbm(nx, x / wavelengthM, y / wavelengthM, { octaves: 2 }) * amplitudeM,
      y + fbm(ny, x / wavelengthM + 31.7, y / wavelengthM - 12.3, { octaves: 2 }) * amplitudeM,
    ];
  };
  const line = (pts: Position[]): Position[] => {
    const out: Position[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) {
        const q = pts[i - 1]!;
        const d = Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
        const steps = Math.min(64, Math.floor(d / maxSeg));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          out.push(displace([q[0]! + (p[0]! - q[0]!) * t, q[1]! + (p[1]! - q[1]!) * t]));
        }
      }
      out.push(displace(p));
    }
    return out;
  };
  const geometry = <G extends Geometry>(g: G): G => {
    switch (g.type) {
      case 'Point':
        return { ...g, coordinates: displace(g.coordinates) };
      case 'MultiPoint':
        return { ...g, coordinates: g.coordinates.map(displace) };
      case 'LineString':
        return { ...g, coordinates: line(g.coordinates) };
      case 'MultiLineString':
        return { ...g, coordinates: g.coordinates.map(line) };
      case 'Polygon':
        return { ...g, coordinates: g.coordinates.map(line) };
      case 'MultiPolygon':
        return { ...g, coordinates: g.coordinates.map((poly) => poly.map(line)) };
      default:
        return g;
    }
  };
  return {
    feature<G extends Geometry, P>(f: Feature<G, P>): Feature<G, P> {
      return { ...f, geometry: geometry(f.geometry) };
    },
    collection<G extends Geometry, P>(fc: FeatureCollection<G, P>): FeatureCollection<G, P> {
      return { ...fc, features: fc.features.map((f) => this.feature(f)) };
    },
  };
}
