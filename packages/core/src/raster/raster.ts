/**
 * A regular grid of Float32 values over the region, in planar metres with the
 * origin at the region centre (x east, y north). Row 0 is the southern edge so
 * that (col, row) increase with (x, y); renderers flip as needed.
 */
export interface RasterSpec {
  width: number;
  height: number;
  cellSizeM: number;
  /** World coordinate of the centre of cell (0, 0). */
  originX: number;
  originY: number;
}

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originY: number;
  readonly data: Float32Array;

  constructor(spec: RasterSpec, data?: Float32Array) {
    this.width = spec.width;
    this.height = spec.height;
    this.cellSizeM = spec.cellSizeM;
    this.originX = spec.originX;
    this.originY = spec.originY;
    this.data = data ?? new Float32Array(spec.width * spec.height);
    if (this.data.length !== this.width * this.height) throw new RangeError('Raster data length mismatch');
  }

  /** A raster covering an extent centred on the origin with roughly `targetCells` cells on the long side. */
  static forExtent(widthM: number, heightM: number, cellSizeM: number): Raster {
    const width = Math.max(2, Math.ceil(widthM / cellSizeM) + 1);
    const height = Math.max(2, Math.ceil(heightM / cellSizeM) + 1);
    return new Raster({
      width,
      height,
      cellSizeM,
      originX: -((width - 1) * cellSizeM) / 2,
      originY: -((height - 1) * cellSizeM) / 2,
    });
  }

  get spec(): RasterSpec {
    return {
      width: this.width,
      height: this.height,
      cellSizeM: this.cellSizeM,
      originX: this.originX,
      originY: this.originY,
    };
  }

  /** A new raster with the same grid and fresh data. */
  like(data?: Float32Array): Raster {
    return new Raster(this.spec, data);
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  get(col: number, row: number): number {
    return this.data[row * this.width + col]!;
  }

  set(col: number, row: number, value: number): void {
    this.data[row * this.width + col] = value;
  }

  /** World x of a column's centre. */
  x(col: number): number {
    return this.originX + col * this.cellSizeM;
  }

  y(row: number): number {
    return this.originY + row * this.cellSizeM;
  }

  /** Fractional column for a world x (may be outside the grid). */
  col(x: number): number {
    return (x - this.originX) / this.cellSizeM;
  }

  row(y: number): number {
    return (y - this.originY) / this.cellSizeM;
  }

  /** Bilinear sample at world coordinates, clamped to the grid edge. */
  sample(x: number, y: number): number {
    const fc = Math.min(Math.max(this.col(x), 0), this.width - 1);
    const fr = Math.min(Math.max(this.row(y), 0), this.height - 1);
    const c0 = Math.floor(fc);
    const r0 = Math.floor(fr);
    const c1 = Math.min(c0 + 1, this.width - 1);
    const r1 = Math.min(r0 + 1, this.height - 1);
    const tx = fc - c0;
    const ty = fr - r0;
    const a = this.get(c0, r0);
    const b = this.get(c1, r0);
    const c = this.get(c0, r1);
    const d = this.get(c1, r1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** Bicubic (Catmull–Rom) sample; smoother for upsampling. Clamped at edges. */
  sampleCubic(x: number, y: number): number {
    const fc = Math.min(Math.max(this.col(x), 0), this.width - 1);
    const fr = Math.min(Math.max(this.row(y), 0), this.height - 1);
    const c0 = Math.floor(fc);
    const r0 = Math.floor(fr);
    const tx = fc - c0;
    const ty = fr - r0;
    const rows: number[] = [0, 0, 0, 0];
    for (let j = -1; j <= 2; j++) {
      const r = Math.min(Math.max(r0 + j, 0), this.height - 1);
      const p0 = this.get(Math.min(Math.max(c0 - 1, 0), this.width - 1), r);
      const p1 = this.get(Math.min(Math.max(c0, 0), this.width - 1), r);
      const p2 = this.get(Math.min(Math.max(c0 + 1, 0), this.width - 1), r);
      const p3 = this.get(Math.min(Math.max(c0 + 2, 0), this.width - 1), r);
      rows[j + 1] = catmullRom(p0, p1, p2, p3, tx);
    }
    return catmullRom(rows[0]!, rows[1]!, rows[2]!, rows[3]!, ty);
  }

  min(): number {
    let m = Infinity;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]! < m) m = this.data[i]!;
    return m;
  }

  max(): number {
    let m = -Infinity;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]! > m) m = this.data[i]!;
    return m;
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}
