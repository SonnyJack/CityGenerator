import { useState } from 'react';
import type { RegionEvent } from '@citygen/core';
import { newId, useApp } from '../store.js';

const KIND_LABELS: Record<RegionEvent['kind'], string> = { fire: 'Fire', storm: 'Storm', flood: 'Flood' };

/**
 * Disasters on the timeline. Each is a circle at a point with a year; the
 * town stage marks the blocks it touched (fires rebuild, storms damage, floods
 * drown low ground for their duration) and the map draws it while it lasts.
 */
export function EventsPanel() {
  const events = useApp((s) => s.document.spec.events);
  const year = useApp((s) => s.document.spec.year);
  const dispatch = useApp((s) => s.dispatch);
  const [kind, setKind] = useState<RegionEvent['kind']>('fire');
  const [radiusM, setRadiusM] = useState(400);
  const [magnitude, setMagnitude] = useState(0.7);
  const [levelM, setLevelM] = useState(3);
  const [duration, setDuration] = useState(2);

  function add() {
    const map = window.__citygenMap;
    const c = map?.getCenter();
    const center: [number, number] = c ? [c.lng * 111319.490793, c.lat * 111319.490793] : [0, 0];
    const event: RegionEvent = {
      id: newId('event'),
      kind,
      year,
      center: [Math.round(center[0]), Math.round(center[1])],
      radiusM,
      magnitude,
      durationYears: kind === 'flood' ? duration : 1,
      ...(kind === 'flood' ? { levelM } : {}),
    };
    dispatch({ type: 'spec.patch', ops: [{ op: 'add', path: '/events/-', value: event }] });
  }

  const sel = 'rounded border border-stone-300 bg-white px-1 py-0.5 text-xs';
  return (
    <section className="space-y-2" data-testid="events">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Disasters</h2>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <select
          aria-label="Disaster type"
          className={sel}
          value={kind}
          onChange={(e) => setKind(e.target.value as RegionEvent['kind'])}
        >
          {(Object.keys(KIND_LABELS) as RegionEvent['kind'][]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <span className="text-stone-600">radius</span>
          <input
            aria-label="Event radius"
            type="number"
            className="w-16 rounded border border-stone-300 px-1"
            value={radiusM}
            min={50}
            max={20000}
            step={50}
            onChange={(e) => setRadiusM(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-stone-600">severity</span>
          <input
            aria-label="Event severity"
            type="number"
            className="w-14 rounded border border-stone-300 px-1"
            value={magnitude}
            min={0}
            max={1}
            step={0.1}
            onChange={(e) => setMagnitude(Number(e.target.value))}
          />
        </label>
        {kind === 'flood' && (
          <>
            <label className="flex items-center gap-1">
              <span className="text-stone-600">level m</span>
              <input
                aria-label="Flood level"
                type="number"
                className="w-14 rounded border border-stone-300 px-1"
                value={levelM}
                step={0.5}
                onChange={(e) => setLevelM(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-stone-600">years</span>
              <input
                aria-label="Flood years"
                type="number"
                className="w-14 rounded border border-stone-300 px-1"
                value={duration}
                min={1}
                max={200}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
          </>
        )}
        <button
          className="rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100"
          onClick={add}
          title="At the centre of the map view, in the current year"
        >
          + Add at map centre in {year}
        </button>
      </div>
      {events.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-stone-600" data-testid="events-list">
          {events.map((e, i) => (
            <li key={e.id} className="flex items-center justify-between gap-1">
              <span>
                {KIND_LABELS[e.kind]} of {e.year}
                {e.kind === 'flood' ? ` (${e.durationYears} y, ${e.levelM ?? '?'} m)` : ''} · {e.radiusM} m at{' '}
                {e.center[0]}, {e.center[1]}
                {e.year > year ? ' · not yet' : ''}
              </span>
              <button
                className="rounded px-1 text-stone-500 hover:bg-stone-100"
                aria-label={`Remove ${KIND_LABELS[e.kind]} of ${e.year}`}
                onClick={() =>
                  dispatch({ type: 'spec.patch', ops: [{ op: 'remove', path: `/events/${i}` }] })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
