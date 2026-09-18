import { METERS_PER_DEGREE, Simplex2, WATER, fbm, type TerrainOutput } from '@citygen/core';
import { encodePng } from './png.js';

/**
 * Terrain-RGB ("terrarium") raster tiles for MapLibre hillshade and 3-D
 * terrain. Each pixel samples the base heightmap bicubically and adds a
 * band-limited detail noise that is a function of world position only, so
 * neighbouring tiles agree at their shared edges without any stitching.
 */

export interface DemSampler {
  heightAt(x: number, y: number): number;
}

const DETAIL_WAVELENGTH_M = 220;

export function createDemSampler(terrain: TerrainOutput, seed: string): DemSampler {
  const detail = new Simplex2(`${seed}/dem-detail`);
  const { height, water, slope } = terrain;
  const { width, height: rows } = height;
  const halfW = ((width - 1) * height.cellSizeM) / 2;
  const halfH = ((rows - 1) * height.cellSizeM) / 2;
  const FADE_M = 1500;
  return {
    heightAt(x, y) {
      // Outside the region, fade the edge height to sea level so tiles beyond the map stay flat.
      const outside = Math.max(Math.abs(x) - halfW, Math.abs(y) - halfH, 0);
      if (outside > 0) {
        const edge = height.sampleCubic(x, y);
        const t = Math.min(1, outside / FADE_M);
        return edge * (1 - t) * (1 - t) + terrain.seaLevel * (1 - (1 - t) * (1 - t));
      }
      const base = height.sampleCubic(x, y);
      const col = Math.min(Math.max(Math.round(height.col(x)), 0), width - 1);
      const row = Math.min(Math.max(Math.round(height.row(y)), 0), rows - 1);
      const i = row * width + col;
      const w = water[i]!;
      if (w === WATER.sea || w === WATER.lake) return base;
      const s = slope[i]!;
      const amplitude = 1.5 + Math.min(s, 0.5) * 16;
      const n = fbm(detail, x / DETAIL_WAVELENGTH_M, y / DETAIL_WAVELENGTH_M, {
        octaves: 3,
        persistence: 0.5,
      });
      // Fade the detail out near the water line so shores stay clean.
      const shore = Math.min(1, (base - terrain.seaLevel) / 6);
      return base + n * amplitude * Math.max(0, shore);
    },
  };
}

/** Web Mercator tile bounds in the synthetic CRS (metres). */
export function tileBoundsMeters(
  z: number,
  x: number,
  y: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const n = 2 ** z;
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return {
    minX: lonW * METERS_PER_DEGREE,
    maxX: lonE * METERS_PER_DEGREE,
    minY: latS * METERS_PER_DEGREE,
    maxY: latN * METERS_PER_DEGREE,
  };
}

/** Latitude (degrees) for a fractional Mercator tile row. */
function latForRow(z: number, yFrac: number): number {
  const n = 2 ** z;
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * yFrac) / n))) * 180) / Math.PI;
}

/** Heights (metres) for a tile, row-major with the top row first. */
export function sampleDemTile(
  sampler: DemSampler,
  z: number,
  x: number,
  y: number,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size);
  const n = 2 ** z;
  for (let py = 0; py < size; py++) {
    const lat = latForRow(z, y + (py + 0.5) / size);
    const wy = lat * METERS_PER_DEGREE;
    for (let px = 0; px < size; px++) {
      const lon = ((x + (px + 0.5) / size) / n) * 360 - 180;
      out[py * size + px] = sampler.heightAt(lon * METERS_PER_DEGREE, wy);
    }
  }
  return out;
}

/** Encode heights in the terrarium scheme: h = (R * 256 + G + B / 256) - 32768. */
export function encodeTerrarium(heights: Float32Array, size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(65535.996, heights[i]! + 32768));
    const whole = Math.floor(v);
    rgba[i * 4] = whole >> 8;
    rgba[i * 4 + 1] = whole & 255;
    rgba[i * 4 + 2] = Math.floor((v - whole) * 256);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export function decodeTerrarium(rgba: Uint8Array, index: number): number {
  return rgba[index * 4]! * 256 + rgba[index * 4 + 1]! + rgba[index * 4 + 2]! / 256 - 32768;
}

/** A complete Terrain-RGB PNG tile. Returns null for tiles entirely outside the region. */
export async function demTilePng(
  sampler: DemSampler,
  extent: { widthM: number; heightM: number },
  z: number,
  x: number,
  y: number,
  size = 256,
): Promise<Uint8Array | null> {
  const b = tileBoundsMeters(z, x, y);
  const margin = 2000;
  if (b.maxX < -extent.widthM / 2 - margin || b.minX > extent.widthM / 2 + margin) return null;
  if (b.maxY < -extent.heightM / 2 - margin || b.minY > extent.heightM / 2 + margin) return null;
  const heights = sampleDemTile(sampler, z, x, y, size);
  return encodePng(size, size, encodeTerrarium(heights, size));
}
