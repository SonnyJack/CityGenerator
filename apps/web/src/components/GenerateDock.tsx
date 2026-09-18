import { useEffect, useRef, useState } from 'react';
import { CULTURE_PACKS, biomeIdSchema, terrainPresetSchema } from '@citygen/core';
import { biomes } from '@citygen/features';
import {
  AGE_STOPS,
  DENSITY_CLASS_NAMES,
  WEALTH_CLASS_NAMES,
  themeById,
  themes,
  type LayerGroup,
} from '@citygen/themes';
import { eraForYear } from '@citygen/features';
import { randomSeed, useApp } from '../store.js';
import { EventsPanel } from './EventsPanel.js';
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
  { id: 'facilities', label: 'Facilities' },
  { id: 'labels', label: 'Names' },
  { id: 'pois', label: 'Premises' },
  { id: 'authored', label: 'Your features' },
  { id: 'edits', label: 'Brush strokes' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'events', label: 'Disasters' },
];

/** A slider that dispatches on release (and on keyboard steps) rather than every pixel. */
/** Play the timeline: step the year forward while the engine keeps up. */
function TimelinePlayer() {
  const year = useApp((s) => s.document.spec.year);
  const status = useApp((s) => s.status);
  const dispatch = useApp((s) => s.dispatch);
  const [playing, setPlaying] = useState(false);
  const [from, setFrom] = useState(1850);
  const [to, setTo] = useState(2020);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || status !== 'idle') return;
    timer.current = window.setTimeout(() => {
      if (year >= to) setPlaying(false);
      else dispatch({ type: 'year.set', year: Math.min(to, year + 5) });
    }, 250);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [playing, status, year, to, dispatch]);
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="timeline-player">
      <button
        className="rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100"
        onClick={() => {
          if (playing) setPlaying(false);
          else {
            if (year >= to) dispatch({ type: 'year.set', year: from });
            setPlaying(true);
          }
        }}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <label className="flex items-center gap-1">
        <span className="text-stone-600">from</span>
        <input
          aria-label="Play from"
          type="number"
          className="w-16 rounded border border-stone-300 px-1"
          value={from}
          min={1100}
          max={2100}
          step={5}
          onChange={(e) => setFrom(Number(e.target.value))}
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-stone-600">to</span>
        <input
          aria-label="Play to"
          type="number"
          className="w-16 rounded border border-stone-300 px-1"
          value={to}
          min={1100}
          max={2100}
          step={5}
          onChange={(e) => setTo(Number(e.target.value))}
        />
      </label>
      <span className="text-stone-500">{playing ? `${year}…` : ''}</span>
    </div>
  );
}

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
          <span className="w-16 text-stone-600">Culture</span>
          <select
            aria-label="Culture"
            className={sel}
            value={doc.spec.culture}
            onChange={(e) => patch('/culture', e.target.value)}
          >
            {CULTURE_PACKS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {stats && (
          <p className="text-[11px] text-stone-500" data-testid="region-name">
            {stats.regionName} · {CULTURE_PACKS.find((c) => c.id === stats.culture)?.name ?? stats.culture}
          </p>
        )}
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

      <section className="space-y-2" data-testid="timeline">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Timeline</h2>
        <Slider
          label={`Year · ${eraForYear(doc.spec.year).name}`}
          value={doc.spec.year}
          min={1100}
          max={2100}
          step={5}
          onCommit={(v) => dispatch({ type: 'year.set', year: Math.round(v) })}
        />
        <TimelinePlayer />
        <p className="text-[11px] text-stone-500">
          Populations are as of {doc.spec.anchorYear}; the slider moves along that history.{' '}
          {doc.spec.anchorYear !== doc.spec.year && (
            <button
              className="underline"
              onClick={() => patch('/anchorYear', doc.spec.year)}
              title="Treat the settlement populations as this year's"
            >
              Make {doc.spec.year} the design year
            </button>
          )}
        </p>
      </section>

      <SettlementsPanel />

      <EventsPanel />

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

      <section className="space-y-2" data-testid="facilities">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Facilities</h2>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Default facilities"
            checked={doc.spec.defaultFacilities}
            onChange={(e) => patch('/defaultFacilities', e.target.checked)}
          />
          Ports, industry and institutions from settlement kind, size and year
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Scale compression"
            checked={doc.spec.scaleCompression}
            onChange={(e) => patch('/scaleCompression', e.target.checked)}
          />
          Compress large facilities for playability (inspector shows true scale)
        </label>
        {stats && (
          <div className="text-[11px] text-stone-600" data-testid="facility-stats">
            <p>
              {stats.facilities.placed} placed
              {Object.entries(stats.facilities.byCategory)
                .map(([k, v]) => ` · ${v} ${k}`)
                .join('')}
              {' · wasteland '}
              {(stats.facilities.wasteland.overall * 100).toFixed(1)} %
            </p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
              {stats.facilities.list.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">
                    {f.name}
                    {f.settlement ? ` · ${f.settlement}` : ''}
                    {f.pinned ? ' · pinned' : ''}
                    {f.outcome !== 'placed' ? ` · ${f.outcome}` : ''}
                  </span>
                  <button
                    className="px-1 text-stone-400 hover:text-red-700"
                    aria-label={`Remove ${f.name} at ${f.settlement ?? 'region'}`}
                    title="Remove this facility"
                    onClick={() =>
                      dispatch({ type: 'override.add', override: { op: 'remove', target: f.id } })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {stats.facilities.failures.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-amber-800" data-testid="facility-failures">
                {stats.facilities.failures.map((f) => (
                  <li key={f.id}>{f.reason}</li>
                ))}
              </ul>
            )}
            {doc.overrides.some((o) => o.op === 'remove' || o.op === 'pin') && (
              <button
                className={`${btn} mt-1`}
                onClick={() => {
                  dispatch({ type: 'override.clear', op: 'remove' });
                  dispatch({ type: 'override.clear', op: 'pin' });
                }}
              >
                Restore removed and unpin
              </button>
            )}
          </div>
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
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="3D buildings"
            checked={ui.layers.buildings3d === true}
            onChange={(e) => dispatch({ type: 'ui.set', layers: { buildings3d: e.target.checked } })}
          />
          3D buildings (extruded by floors)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Age overlay"
            checked={ui.layers.age === true}
            onChange={(e) => dispatch({ type: 'ui.set', layers: { age: e.target.checked } })}
          />
          Building age overlay
        </label>
        {ui.layers.age === true && (
          <ul className="flex flex-wrap gap-1 text-[10px]" data-testid="legend-age">
            {AGE_STOPS.map(([year, colour]) => (
              <li key={year} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colour }} />
                {year}
              </li>
            ))}
          </ul>
        )}
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
