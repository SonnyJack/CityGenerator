/* global process, console, performance */
/**
 * Headless matrix sweep: every terrain preset × era, cultures and biomes in
 * rotation, plus a handful of edge cases. Each run generates a region, then
 * exercises the queries the app and the assistant use (find, summary,
 * directory, inspect, interior, export). Prints one line per run and a
 * summary of failures, budget overruns and invariant breaches.
 *
 *   node packages/engine/scripts/sweep.mjs [--quick] [--extent 12000] [--budget 20000]
 */
import {
  ccw,
  convexHull,
  convexOverlapArea,
  createDocument,
  CULTURE_PACKS,
  pointInRing,
} from '@citygen/core';
import { createEngine } from '../dist/index.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const quick = args.includes('--quick');
// --range a-b runs a slice of the matrix (zero-based, end exclusive), so long sweeps can go in chunks.
const rangeArg = args[args.indexOf('--range') + 1];
const range = args.includes('--range') && rangeArg ? rangeArg.split('-').map(Number) : null;
const extent = flag('extent', 12_000);
const budgetMs = flag('budget', 25_000);

const PRESETS = ['plains', 'coast', 'bay', 'riverValley', 'hills', 'archipelago', 'delta', 'estuary'];
const YEARS = quick ? [1780, 1925, 2020] : [1650, 1780, 1850, 1890, 1925, 1955, 1985, 2020];
const CULTURES = CULTURE_PACKS.map((p) => p.id);
const BIOMES = [
  'temperateMaritime',
  'temperateContinental',
  'mediterranean',
  'boreal',
  'subarctic',
  'steppe',
  'desert',
  'semiArid',
  'subtropicalHumid',
  'tropicalMonsoon',
  'tropicalRainforest',
];

/** @type {{ name: string, doc: import('@citygen/core').MapDocument }[]} */
const runs = [];
let k = 0;
for (const preset of PRESETS)
  for (const year of YEARS) {
    const culture = CULTURES[k % CULTURES.length];
    const biome = BIOMES[k % BIOMES.length];
    k++;
    runs.push({
      name: `${preset}/${year}/${culture}/${biome}`,
      doc: createDocument({
        now: '2026-01-01T00:00:00.000Z',
        seed: `sweep-${preset}-${year}`,
        year,
        widthM: extent,
        heightM: extent * 0.75,
        spec: { terrain: { preset }, culture, biome, networks: { water: { canals: true } } },
      }),
    });
  }
// Edge cases.
const edge = (name, opts) =>
  runs.push({ name, doc: createDocument({ now: '2026-01-01T00:00:00.000Z', ...opts }) });
edge('tiny/1925', { seed: 'tiny', widthM: 3_000, heightM: 3_000 });
edge('medieval/1100', {
  seed: 'medieval',
  year: 1100,
  widthM: 10_000,
  heightM: 8_000,
  spec: { culture: 'england' },
});
edge('future/2100', { seed: 'future', year: 2100, widthM: 10_000, heightM: 8_000 });
edge('highsea/1925', {
  seed: 'highsea',
  widthM: 10_000,
  heightM: 8_000,
  spec: { terrain: { preset: 'coast', seaLevel: 0.7 } },
});
edge('flat/1925', {
  seed: 'flat',
  widthM: 10_000,
  heightM: 8_000,
  spec: { terrain: { preset: 'plains', relief: 0, roughness: 0 } },
});
edge('rugged/1925', {
  seed: 'rugged',
  widthM: 10_000,
  heightM: 8_000,
  spec: { terrain: { preset: 'hills', relief: 1, roughness: 1 } },
});
edge('metropolis/2020', {
  seed: 'metro',
  year: 2020,
  widthM: 16_000,
  heightM: 12_000,
  spec: {
    settlements: [
      {
        id: 'big',
        kind: 'metropolis',
        population: 900_000,
        layout: { streetPattern: 'mixed' },
        features: [],
      },
    ],
    settlementPolicy: { count: [1, 1], kinds: {} },
  },
});
edge('decline/1955', {
  seed: 'decline',
  year: 1955,
  widthM: 10_000,
  heightM: 8_000,
  spec: {
    anchorYear: 1890,
    settlements: [
      {
        id: 'port',
        kind: 'portTown',
        population: 9_000,
        layout: { streetPattern: 'mixed' },
        features: [],
        growth: [{ year: 1955, population: 2_500 }],
      },
    ],
    settlementPolicy: { count: [1, 1], kinds: {} },
    events: [{ id: 'flood-1938', kind: 'flood', year: 1938, center: [0, 0], radiusM: 1500, severity: 0.8 }],
  },
});
if (!quick) edge('large/1925', { seed: 'large', widthM: 40_000, heightM: 30_000 });

/** Rings of a polygon feature's outer boundaries. */
const outer = (g) =>
  g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
const boxOf = (r) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of r) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
};
const meet = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
/** Overlap of two rings, sampled on a grid over their common box (exact enough for a check). */
function sampledOverlap(r1, r2, step) {
  const a = boxOf(r1);
  const b = boxOf(r2);
  let n = 0;
  for (let y = Math.max(a.minY, b.minY) + step / 2; y < Math.min(a.maxY, b.maxY); y += step)
    for (let x = Math.max(a.minX, b.minX) + step / 2; x < Math.min(a.maxX, b.maxX); x += step)
      if (pointInRing(x, y, r1) && pointInRing(x, y, r2)) n++;
  return n * step * step;
}
/** Pairs of items whose boxes meet, through a coarse grid. */
function nearPairs(items, cell) {
  const grid = new Map();
  items.forEach((it, i) => {
    for (let gx = Math.floor(it.box.minX / cell); gx <= Math.floor(it.box.maxX / cell); gx++)
      for (let gy = Math.floor(it.box.minY / cell); gy <= Math.floor(it.box.maxY / cell); gy++) {
        const k = `${gx},${gy}`;
        (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
      }
  });
  const seen = new Set();
  const out = [];
  for (const list of grid.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const [i, j] = list[x] < list[y] ? [list[x], list[y]] : [list[y], list[x]];
        const k = i * 1e6 + j;
        if (seen.has(k) || !meet(items[i].box, items[j].box)) continue;
        seen.add(k);
        out.push([items[i], items[j]]);
      }
  return out;
}
// Parts built out over the water from a waterside works.
const SEAWARD = new Set(['pier', 'breakwater', 'berth', 'dock', 'slipway', 'basin', 'crane', 'ramp']);
/**
 * Nothing stands on anything else: blocks do not overlap (the old core, the gate suburbs and each
 * ring keep to their own ground), buildings of different blocks do not overlap, no town building
 * stands on a works' ground, a works' parts stay on its ground (bar what is built out over the
 * water), and no main line or regional road runs through a works.
 */
function overlapFindings(model) {
  const found = [];
  const blocks = model.patches.features
    .filter((f) => f.properties?.ward !== 'farm')
    .flatMap((f) => outer(f.geometry).map((r) => ({ r, box: boxOf(r), id: f.id })));
  const bad = nearPairs(blocks, 150).filter(([a, b]) => sampledOverlap(a.r, b.r, 2) > 20);
  if (bad.length) found.push(`${bad.length} overlapping blocks (${bad[0][0].id} × ${bad[0][1].id})`);
  const buildings = model.buildings.features.flatMap((f) =>
    outer(f.geometry).map((r) => ({
      r,
      hull: ccw(convexHull(r.slice(0, -1))),
      box: boxOf(r),
      block: f.properties?.block,
    })),
  );
  const clash = nearPairs(buildings, 60).filter(
    ([a, b]) => a.block !== b.block && convexOverlapArea(a.r.slice(0, -1), b.hull) > 4,
  );
  if (clash.length) found.push(`${clash.length} overlapping buildings of different blocks`);
  const grounds = model.facilities.features.flatMap((f) =>
    outer(f.geometry).map((r) => ({
      r,
      hull: ccw(convexHull(r.slice(0, -1))),
      box: boxOf(r),
      id: f.properties?.id,
      type: f.properties?.type,
    })),
  );
  let onGround = 0;
  for (const b of buildings)
    for (const g of grounds)
      if (meet(b.box, g.box) && convexOverlapArea(b.r.slice(0, -1), g.hull) > 0.5) onGround++;
  if (onGround) found.push(`${onGround} town buildings on a works' ground`);
  let partsOut = 0;
  for (const part of model.facilityParts.features) {
    if (SEAWARD.has(part.properties?.kind) || part.geometry.type !== 'Polygon') continue;
    const g = grounds.find((x) => x.id === part.properties?.feature);
    if (!g) continue;
    const r = part.geometry.coordinates[0];
    // A vertex more than 2 m outside the ground (inside it, or on it within that margin, is fine).
    const grown = (x, y) =>
      pointInRing(x, y, g.r) ||
      g.r.some((p, i) => {
        const q = g.r[(i + 1) % g.r.length];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy) <= 2;
      });
    if (r.some(([x, y]) => !grown(x, y))) partsOut++;
  }
  if (partsOut) found.push(`${partsOut} works' parts outside their ground`);
  const lines = [
    ...model.roads.features.filter((f) => f.properties?.mode !== 'tunnel'),
    ...model.rail.features.filter(
      (f) =>
        !['tunnel', 'subway'].includes(f.properties?.mode) &&
        ['mainline', 'branch', 'junction', 'disused', 'suburban'].includes(f.properties?.class),
    ),
  ];
  const crossed = new Set();
  for (const l of lines) {
    const c = l.geometry.coordinates;
    for (let i = 1; i < c.length; i++)
      for (const g of grounds) {
        // A works' own access road starts at its gate.
        if (l.properties?.from === g.id) continue;
        const mid = [(c[i - 1][0] + c[i][0]) / 2, (c[i - 1][1] + c[i][1]) / 2];
        if (pointInRing(mid[0], mid[1], g.r) || pointInRing(c[i][0], c[i][1], g.r)) crossed.add(g.type);
      }
  }
  if (crossed.size) found.push(`a line runs through ${[...crossed].join(', ')}`);
  return found;
}

const problems = [];
const rows = [];
const selected = range ? runs.slice(range[0], range[1]) : runs;
for (const run of selected) {
  const engine = createEngine();
  const t0 = performance.now();
  try {
    const { version, stats } = await engine.setDocument(run.doc, { sketch: false });
    const ms = performance.now() - t0;
    const s = stats.settlements[0];
    let queries = '';
    if (s) {
      const found = await engine.find({ kind: 'facility', limit: 5 });
      const summary = await engine.settlementSummary(s.id);
      const { entries } = await engine.directory(s.id, '', 3);
      let interiorRooms = 0;
      for (const e of entries) {
        const plan = await engine.interior(e.id);
        if (plan) interiorRooms += plan.floors.reduce((a, f) => a + f.rooms.length, 0);
        const info = await engine.inspect(e.center[0], e.center[1]);
        if (!info) problems.push(`${run.name}: inspect returned null at a building`);
      }
      const part = found.flatMap((f) => f.properties?.parts ?? [])[0];
      if (part) {
        const plan = await engine.interior(part.id);
        if (!plan) problems.push(`${run.name}: no plan for facility part ${part.id}`);
      }
      const frame = {
        minX: s.center[0] - 300,
        minY: s.center[1] - 300,
        maxX: s.center[0] + 300,
        maxY: s.center[1] + 300,
      };
      const model = await engine.exportFrame(frame);
      const tile = await engine.getTile(version, 12, 2048, 2048);
      // Terrain fit: no building over the drawn water, no road or track vertex over the sea or a lake.
      const corners = model.buildings.features.flatMap((b) =>
        b.geometry.coordinates[0].map((p) => [p[0], p[1]]),
      );
      const wetCorners = (await engine.landCheck(corners, { rivers: 'water' })).filter((ok) => !ok).length;
      // Carried track (a viaduct across an inlet, a bridge, a tunnel) may cross water; the rest may not.
      const carried = new Set(['viaduct', 'elevated', 'tunnel', 'subway']);
      const routeVertices = [
        ...model.roads.features,
        ...model.rail.features.filter((f) => !carried.has(f.properties?.mode)),
      ].flatMap((l) => l.geometry.coordinates.slice(1, -1).map((p) => [p[0], p[1]]));
      const wetVertices = (await engine.landCheck(routeVertices, { rivers: 'land', aboveSea: false })).filter(
        (ok) => !ok,
      ).length;
      if (wetCorners) problems.push(`${run.name}: ${wetCorners} building corners over water`);
      // The whole of the largest town, for the overlap audit.
      const big = stats.settlements.reduce((a, b) => (b.population > a.population ? b : a), s);
      const reach = Math.min(1500, 250 + Math.sqrt(big.population) * 9);
      const whole = await engine.exportFrame({
        minX: big.center[0] - reach,
        minY: big.center[1] - reach,
        maxX: big.center[0] + reach,
        maxY: big.center[1] + reach,
      });
      for (const f of overlapFindings(whole)) problems.push(`${run.name}: ${f}`);
      if (wetVertices) problems.push(`${run.name}: ${wetVertices} route vertices over water`);
      queries = ` q:${found.length}f ${summary?.premises ?? 0}p ${entries.length}b ${interiorRooms}r ${model.buildings.features.length}xb ${tile ? tile.byteLength : 0}t`;
      if (summary && summary.premises === 0 && s.population > 1000)
        problems.push(`${run.name}: no premises in ${s.id}`);
    } else if (run.doc.spec.year >= 1500) problems.push(`${run.name}: no settlements`);
    const invariants = [];
    if (stats.rail.maxGradient > 0.0351)
      invariants.push(`rail gradient ${stats.rail.maxGradient.toFixed(3)}`);
    if (stats.facilities.wasteland.overall > 0.6)
      invariants.push(`wasteland ${stats.facilities.wasteland.overall.toFixed(2)}`);
    if (
      stats.facilities.failed > stats.facilities.placed &&
      stats.facilities.failed > 3 &&
      run.doc.spec.extent.widthM >= 6_000
    )
      invariants.push(`facilities failed ${stats.facilities.failed}/${stats.facilities.placed}`);
    if (ms > budgetMs) invariants.push(`slow ${ms.toFixed(0)} ms`);
    for (const st of stats.settlements) {
      if (st.blocks === 0 && st.population > 300) invariants.push(`${st.id} has no blocks`);
      // Terrain fit: a core mostly on steep ground means the fill found no gentler ground to take.
      if (
        st.steepShare > 0.75 &&
        st.population > 1000 &&
        run.doc.spec.terrain.roughness < 1 &&
        run.doc.spec.extent.widthM >= 6_000
      )
        invariants.push(`${st.id} core ${(st.steepShare * 100).toFixed(0)}% steep`);
    }
    if (invariants.length) problems.push(`${run.name}: ${invariants.join('; ')}`);
    const rss = `${(process.memoryUsage().rss / 1048576).toFixed(0)}M`;
    const line = `${run.name.padEnd(48)} ${ms.toFixed(0).padStart(6)} ms ${rss.padStart(6)} ${stats.settlements.length}s ${stats.blocks}bl ${stats.facilities.placed}/${stats.facilities.failed}fac ${stats.rail.trackKm.toFixed(0)}rail ${stats.utilities.powerKm.toFixed(0)}pw ${stats.utilities.canalKm.toFixed(0)}cn waste ${stats.facilities.wasteland.overall.toFixed(2)} steep ${(Math.max(0, ...stats.settlements.map((t) => t.steepShare)) * 100).toFixed(0)}%${queries}`;
    rows.push(line);
    console.log(line);
  } catch (e) {
    const msg = `${run.name}: ERROR ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    problems.push(msg);
    console.log(msg);
  }
}
console.log(`\n${selected.length} runs, ${problems.length} problems`);
for (const p of problems) console.log(` - ${p}`);
process.exit(problems.length ? 1 : 0);
