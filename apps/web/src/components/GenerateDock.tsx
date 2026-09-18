import { useState } from 'react';
import { biomeIdSchema, terrainPresetSchema } from '@citygen/core';
import { biomes } from '@citygen/features';
import { DENSITY_CLASS_NAMES, WEALTH_CLASS_NAMES, themeById, themes, type LayerGroup } from '@citygen/themes';
import { eraForYear } from '@citygen/features';
import { randomSeed, useApp } from '../store.js';
import { SettlementsPanel } from './SettlementsPanel.js';

const PRESET_LABELS: Record<string, string> = {
  plains: 'Plains',
  coast: 'Coast',
  bay: 'Bay',
  riverValley: 'River valley',
  hills: 'Hills',
  archipelago: 'Archipelago',
  delta: 'Delta',
  estuary: 'Estuary',
  custom: 'Custom (imported)',
};

const LAYER_GROUPS: { id: LayerGroup; label: string }[] = [
  { id: 'relief', label: 'Elevation tint' },
  { id: 'hillshade', label: 'Hillshade' },
  { id: 'landcover', label: 'Land cover' },
  { id: 'water', label: 'Water' },
  { id: 'rivers', label: 'Rivers' },
  { id: 'contours', label: 'Contours' },
  { id: 'graticule', label: 'Grid (1 km)' },
  { id: 'settlements', label: 'Settlements' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'parcels', label: 'Parcels' },
  { id: 'rail', label: 'Railways & trams' },
  { id: 'stations', label: 'Stations' },
  { id: 'authored', label: 'Your features' },
  { id: 'edits', label: 'Brush strokes' },
  { id: 'annotations', label: 'Annotations' },
];

/** A slider that dispatches on release (and on keyboard steps) rather than every pixel. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  // Track the committed value; when it changes from outside (undo, import), adopt it.
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setLocal(value);
  }
  return (
    <label className="block text-xs">
      <span className="flex justify-between text-stone-600">
        <span>{label}</span>
        <span className="font-mono">{format ? format(local) : local}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => local !== value && onCommit(local)}
        onKeyUp={() => local !== value && onCommit(local)}
        onBlur={() => local !== value && onCommit(local)}
      />
    </label>
  );
}

export function GenerateDock() {
  const doc = useApp((s) => s.document);
  const dispatch = useApp((s) => s.dispatch);
  const stats = useApp((s) => s.stats);
  const regenerate = useApp((s) => s.regenerate);
  const reseeds = doc.overrides.filter((o) => o.op === 'reseed').length;
  const t = doc.spec.terrain;
  const patch = (path: string, value: unknown) =>
    dispatch({ type: 'spec.patch', ops: [{ op: 'replace', path, value }] });
  const ui = doc.ui ?? { theme: 'atlas', layers: {}, terrain3d: false };

  return (
    <aside
      className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-stone-300 bg-stone-50 p-3 text-sm"
      data-testid="generate-dock"
    >
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Region</h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Seed</span>
          <input
            aria-label="Seed"
            className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 font-mono"
            value={doc.spec.seed}
            onChange={(e) => e.target.value && dispatch({ type: 'spec.setSeed', seed: e.target.value })}
          />
          <button
            className={btn}
            title="Random seed"
            onClick={() => dispatch({ type: 'spec.setSeed', seed: randomSeed() })}
          >
            ⟳
          </button>
        </label>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Layout</span>
          <button
            className={btn}
            title="Keep the terrain and your features; re-roll settlements, roads and buildings"
            onClick={() => regenerate('region')}
            data-testid="regenerate-region"
          >
            Regenerate settlements
          </button>
          {reseeds > 0 && (
            <button
              className={btn}
              title="Undo all regenerations"
              onClick={() => dispatch({ type: 'override.clear', op: 'reseed' })}
            >
              Reset ({reseeds})
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Size</span>
          <select
            aria-label="Region size"
            className={sel}
            value={doc.spec.extent.widthM}
            onChange={(e) => {
              const m = Number(e.target.value);
              dispatch({
                type: 'spec.patch',
                ops: [
                  { op: 'replace', path: '/extent', value: { widthM: m, heightM: Math.round(m * 0.75) } },
                ],
              });
            }}
          >
            {[8000, 12000, 20000, 30000, 45000, 60000].map((m) => (
              <option key={m} value={m}>
                {m / 1000} × {Math.round(m * 0.75) / 1000} km
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Biome</span>
          <select
            aria-label="Biome"
            className={sel}
            value={doc.spec.biome}
            onChange={(e) => patch('/biome', e.target.value)}
          >
            {biomeIdSchema.options.map((id) => (
              <option key={id} value={id}>
                {biomes.get(id).name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Terrain</h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Preset</span>
          <select
            aria-label="Terrain preset"
            className={sel}
            value={t.preset}
            onChange={(e) => patch('/terrain/preset', e.target.value)}
          >
            {terrainPresetSchema.options.map((id) => (
              <option key={id} value={id}>
                {PRESET_LABELS[id] ?? id}
              </option>
            ))}
          </select>
        </label>
        <Slider
          label="Relief"
          value={t.relief}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/terrain/relief', v)}
        />
        <Slider
          label="Roughness"
          value={t.roughness}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/terrain/roughness', v)}
        />
        <Slider
          label="Erosion"
          value={t.erosion}
          min={0}
          max={1}
          step={0.1}
          onCommit={(v) => patch('/terrain/erosion', v)}
        />
        <Slider
          label="Sea level"
          value={t.seaLevel}
          min={-60}
          max={120}
          step={2}
          format={(v) => `${v} m`}
          onCommit={(v) => patch('/terrain/seaLevel', v)}
        />
        <Slider
          label="Major rivers"
          value={t.rivers.major}
          min={0}
          max={4}
          step={1}
          onCommit={(v) => patch('/terrain/rivers/major', v)}
        />
        <Slider
          label="Minor rivers"
          value={t.rivers.minor}
          min={0}
          max={8}
          step={1}
          onCommit={(v) => patch('/terrain/rivers/minor', v)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Year</h2>
        <Slider
          label={`Year · ${eraForYear(doc.spec.year).name}`}
          value={doc.spec.year}
          min={1100}
          max={2020}
          step={5}
          onCommit={(v) => dispatch({ type: 'year.set', year: Math.round(v) })}
        />
      </section>

      <SettlementsPanel />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Society</h2>
        <Slider
          label="Inequality"
          value={doc.spec.society.inequality}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/society/inequality', v)}
        />
        <Slider
          label="Wealth baseline"
          value={doc.spec.society.wealth.baseline}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/society/wealth/baseline', v)}
        />
        <Slider
          label="Wealth contrast"
          value={doc.spec.society.wealth.gradient}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/society/wealth/gradient', v)}
        />
        <Slider
          label="Density baseline"
          value={doc.spec.society.density.baseline}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/society/density/baseline', v)}
        />
        <Slider
          label="Density contrast"
          value={doc.spec.society.density.gradient}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => patch('/society/density/gradient', v)}
        />
        <div className="space-y-1">
          {(['wealth', 'density'] as const).map((field) => {
            const on = ui.layers[field] === true;
            const names = field === 'wealth' ? WEALTH_CLASS_NAMES : DENSITY_CLASS_NAMES;
            const colours = themeById(ui.theme).overlays[field];
            return (
              <div key={field}>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`${field} overlay`}
                    checked={on}
                    onChange={(e) => dispatch({ type: 'ui.set', layers: { [field]: e.target.checked } })}
                  />
                  {field === 'wealth' ? 'Wealth overlay' : 'Density overlay'}
                </label>
                {on && (
                  <ul className="mt-1 flex flex-wrap gap-1" data-testid={`legend-${field}`}>
                    {names.map((n, i) => (
                      <li key={n} className="flex items-center gap-1 text-[10px] text-stone-600">
                        <span
                          className="inline-block h-3 w-3 rounded-sm border border-stone-300"
                          style={{ background: colours[i] }}
                        />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2" data-testid="networks">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Networks</h2>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Railways"
            checked={doc.spec.networks.rail.enabled}
            onChange={(e) => patch('/networks/rail/enabled', e.target.checked)}
          />
          Railways and trams (from the 1840s; branch lines close after the 1960s)
        </label>
        <Slider
          label="Mainlines leaving the region"
          value={doc.spec.networks.rail.mainlines}
          min={0}
          max={4}
          step={1}
          onCommit={(v) => patch('/networks/rail/mainlines', v)}
        />
        {stats && stats.rail.trackKm > 0 && (
          <p className="text-[11px] text-stone-500" data-testid="rail-stats">
            {stats.rail.trackKm.toFixed(0)} km of track · {stats.rail.stations} stations · {stats.rail.yards}{' '}
            yards · {stats.rail.tunnels} tunnels · {stats.rail.viaducts} viaducts · max gradient{' '}
            {(stats.rail.maxGradient * 100).toFixed(1)} %
            {stats.rail.tramLines > 0 &&
              ` · ${stats.rail.tramLines} tram lines, ${stats.rail.tramKm.toFixed(0)} km`}
            {stats.rail.disusedKm > 0 && ` · ${stats.rail.disusedKm.toFixed(0)} km disused`}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">View</h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-16 text-stone-600">Theme</span>
          <select
            aria-label="Theme"
            className={sel}
            value={ui.theme}
            onChange={(e) => dispatch({ type: 'ui.set', theme: e.target.value })}
          >
            {Object.values(themes).map((th) => (
              <option key={th.id} value={th.id}>
                {th.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="3D terrain"
            checked={ui.terrain3d}
            onChange={(e) => dispatch({ type: 'ui.set', terrain3d: e.target.checked })}
          />
          3D terrain (drag with right mouse to tilt)
        </label>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {LAYER_GROUPS.map((g) => (
            <label key={g.id} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                aria-label={g.label}
                checked={ui.layers[g.id] !== false}
                onChange={(e) => dispatch({ type: 'ui.set', layers: { [g.id]: e.target.checked } })}
              />
              {g.label}
            </label>
          ))}
        </div>
      </section>

      {stats && (
        <section className="space-y-1 text-xs text-stone-600" data-testid="terrain-stats">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Terrain stats</h2>
          <div className="grid grid-cols-2 gap-x-2">
            <span>Cells</span>
            <span className="font-mono">
              {stats.terrain.cells.toLocaleString()} @ {stats.terrain.cellSizeM} m
            </span>
            <span>Elevation</span>
            <span className="font-mono">
              {stats.terrain.minM.toFixed(0)} … {stats.terrain.maxM.toFixed(0)} m
            </span>
            <span>Land</span>
            <span className="font-mono">{(stats.terrain.landFraction * 100).toFixed(0)} %</span>
            <span>Rivers</span>
            <span className="font-mono">{stats.terrain.riverKm.toFixed(0)} km</span>
            <span>Lakes</span>
            <span className="font-mono">{stats.terrain.lakes}</span>
            <span>Contours</span>
            <span className="font-mono">every {stats.terrain.contourIntervalM} m</span>
            <span>Era</span>
            <span className="font-mono">{stats.era.name}</span>
            <span>Settlements</span>
            <span className="font-mono">{stats.settlements.length}</span>
            <span>Blocks</span>
            <span className="font-mono">{stats.blocks.toLocaleString()}</span>
            <span>Roads</span>
            <span className="font-mono">{stats.roads.roadKm.toFixed(0)} km</span>
            <span>Rail</span>
            <span className="font-mono">
              {stats.rail.trackKm.toFixed(0)} km · {stats.rail.stations} stn
            </span>
            <span>Generated in</span>
            <span className="font-mono">{stats.totalMs.toFixed(0)} ms</span>
          </div>
        </section>
      )}
    </aside>
  );
}

const btn = 'rounded border border-stone-300 bg-white px-2 py-1 hover:bg-stone-100';
const sel = 'min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1';
