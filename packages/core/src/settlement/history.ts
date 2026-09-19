/**
 * One history per settlement: a population curve anchored at the document's
 * anchor year (where the spec's population applies), so the year slider moves
 * along a fixed timeline instead of rescaling the past. Towns do not shrink
 * physically: the built-up radius follows the running peak population.
 */
export interface GrowthPoint {
  year: number;
  population: number;
}

export interface SettlementHistory {
  founded: number;
  anchorYear: number;
  anchorPopulation: number;
  /** Explicit timeline from the spec; when present it is interpolated log-linearly. */
  points?: GrowthPoint[];
}

/** Persons per km² of built-up area by year (dense cores in early eras, sprawl later). */
export function urbanDensity(year: number): number {
  if (year < 1800) return 13_000;
  if (year < 1900) return 10_000;
  if (year < 1950) return 7_000;
  if (year < 1990) return 4_500;
  return 3_500;
}

export function radiusForPopulation(population: number, year: number): number {
  const areaM2 = (population / urbanDensity(year)) * 1e6;
  return Math.max(120, Math.sqrt(areaM2 / Math.PI));
}

function curve(h: SettlementHistory, t: number): number {
  if (t < h.founded) return 0;
  if (h.anchorYear <= h.founded) return h.anchorPopulation;
  if (t <= h.anchorYear) {
    // Slow early growth, fast late growth, 8 % of the anchor population at founding.
    const s = (t - h.founded) / (h.anchorYear - h.founded);
    return Math.max(30, h.anchorPopulation * (0.08 + 0.92 * s * s));
  }
  // Beyond the anchor: steady growth, capped at double.
  return h.anchorPopulation * Math.min(2, 1 + 0.008 * (t - h.anchorYear));
}

/** Population at year t along the settlement's history. */
export function populationAt(h: SettlementHistory, t: number): number {
  const pts = h.points?.length
    ? [...h.points, { year: h.anchorYear, population: h.anchorPopulation }].sort((a, b) => a.year - b.year)
    : null;
  if (!pts) return Math.round(curve(h, t));
  if (t < h.founded) return 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (t <= first.year) {
    // Before the first point: the anchored curve, scaled to meet it.
    const base = curve({ ...h, anchorYear: first.year, anchorPopulation: first.population }, t);
    return Math.round(base);
  }
  if (t >= last.year) return Math.round(last.population * Math.min(2, 1 + 0.008 * (t - last.year)));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.year) {
      const f = (t - a.year) / Math.max(1, b.year - a.year);
      const la = Math.log(Math.max(1, a.population));
      const lb = Math.log(Math.max(1, b.population));
      return Math.round(Math.exp(la + (lb - la) * f));
    }
  }
  return Math.round(last.population);
}

const STEP = 5;

interface Table {
  years: number[];
  population: number[];
  peak: number[];
  peakYear: number[];
  radius: number[];
}

// One table per history object: population, running peak and radius every five years from the
// founding to 2100, so the stages can ask about any year without re-walking the curve.
const tables = new WeakMap<SettlementHistory, Table>();

function tableOf(h: SettlementHistory): Table {
  let t = tables.get(h);
  if (t) return t;
  const years: number[] = [];
  const population: number[] = [];
  const peak: number[] = [];
  const peakYear: number[] = [];
  const radius: number[] = [];
  let best = 0;
  let bestYear = h.founded;
  for (let y = h.founded; y <= 2100; y += STEP) {
    const p = populationAt(h, y);
    if (p > best) {
      best = p;
      bestYear = y;
    }
    years.push(y);
    population.push(p);
    peak.push(best);
    peakYear.push(bestYear);
    radius.push(radiusForPopulation(best, y));
  }
  t = { years, population, peak, peakYear, radius };
  tables.set(h, t);
  return t;
}

/** Highest population reached up to year t, and when. */
export function peakUntil(h: SettlementHistory, t: number): { population: number; year: number } {
  const tab = tableOf(h);
  if (t < h.founded) return { population: 0, year: h.founded };
  const i = Math.min(tab.years.length - 1, Math.floor((t - h.founded) / STEP));
  let best = { population: tab.peak[i]!, year: tab.peakYear[i]! };
  const p = populationAt(h, t);
  if (p > best.population) best = { population: p, year: t };
  return best;
}

/** Built-up radius at year t: from the peak population so far (towns do not shrink). */
export function radiusAt(h: SettlementHistory, t: number): number {
  const peak = peakUntil(h, t);
  return radiusForPopulation(peak.population, t);
}

/** Largest built-up radius the settlement ever reaches (the table runs to 2100): the footprint is sized to it so a block's shape does not depend on the year. */
export function maxRadius(h: SettlementHistory): number {
  const tab = tableOf(h);
  return Math.max(
    radiusForPopulation(h.anchorPopulation, h.anchorYear),
    tab.radius[tab.radius.length - 1] ?? 0,
  );
}

/** First year (in 5-year steps from `from`) at which the built-up radius reaches d; `to` when never. */
export function yearForRadius(h: SettlementHistory, d: number, from: number, to: number): number {
  if (to <= from) return from;
  const tab = tableOf(h);
  for (let y = from; y <= to; y += STEP) {
    const i = Math.floor((y - h.founded) / STEP);
    const r = i >= 0 && i < tab.years.length && tab.years[i] === y ? tab.radius[i]! : radiusAt(h, y);
    if (r >= d) return y;
  }
  return to;
}
