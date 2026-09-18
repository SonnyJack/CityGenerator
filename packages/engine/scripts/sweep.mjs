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
import { createDocument, CULTURE_PACKS } from '@citygen/core';
import { createEngine } from '../dist/index.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const quick = args.includes('--quick');
const extent = flag('extent', 12_000);
const budgetMs = flag('budget', 20_000);

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

const problems = [];
const rows = [];
for (const run of runs) {
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
    for (const st of stats.settlements)
      if (st.blocks === 0 && st.population > 300) invariants.push(`${st.id} has no blocks`);
    if (invariants.length) problems.push(`${run.name}: ${invariants.join('; ')}`);
    const line = `${run.name.padEnd(48)} ${ms.toFixed(0).padStart(6)} ms  ${stats.settlements.length}s ${stats.blocks}bl ${stats.facilities.placed}/${stats.facilities.failed}fac ${stats.rail.trackKm.toFixed(0)}rail ${stats.utilities.powerKm.toFixed(0)}pw ${stats.utilities.canalKm.toFixed(0)}cn waste ${stats.facilities.wasteland.overall.toFixed(2)}${queries}`;
    rows.push(line);
    console.log(line);
  } catch (e) {
    const msg = `${run.name}: ERROR ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    problems.push(msg);
    console.log(msg);
  }
}
console.log(`\n${runs.length} runs, ${problems.length} problems`);
for (const p of problems) console.log(` - ${p}`);
process.exit(problems.length ? 1 : 0);
