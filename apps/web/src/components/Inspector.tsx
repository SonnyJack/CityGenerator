import { useApp } from '../store.js';

/** "Why is this here?": what the engine knows about the clicked point. */
export function Inspector() {
  const inspection = useApp((s) => s.inspection);
  const clear = useApp((s) => s.clearInspection);
  if (!inspection) return null;
  const i = inspection;
  return (
    <aside className="rounded border border-stone-300 bg-white/95 p-3 text-xs shadow" data-testid="inspector">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">Inspector</span>
        <button
          className="rounded px-1 text-stone-500 hover:bg-stone-100"
          aria-label="Close inspector"
          onClick={clear}
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-stone-700">
        <dt>Position</dt>
        <dd className="font-mono">
          {i.x.toFixed(0)}, {i.y.toFixed(0)} m
        </dd>
        <dt>Elevation</dt>
        <dd className="font-mono">
          {i.elevationM.toFixed(1)} m · slope {(i.slope * 100).toFixed(0)} %
        </dd>
        <dt>Ground</dt>
        <dd>{i.water === 'land' ? i.landcover : i.water}</dd>
        <dt>Wealth</dt>
        <dd>
          {i.wealthClass} <span className="font-mono text-stone-500">({i.wealth.toFixed(2)})</span>
        </dd>
        <dt>Density</dt>
        <dd>
          {i.densityClass} <span className="font-mono text-stone-500">({i.density.toFixed(2)})</span>
        </dd>
        {i.settlement && (
          <>
            <dt>Settlement</dt>
            <dd>
              {i.settlement.name ?? i.settlement.id} · {i.settlement.kind} ·{' '}
              {i.settlement.population.toLocaleString()}
            </dd>
          </>
        )}
        {i.patch && (
          <>
            <dt>Zone</dt>
            <dd data-testid="inspector-zone">
              {i.patch.ward}
              {i.patch.ring > 0 ? ` · ring ${i.patch.ring}` : i.patch.inner ? ' · old town' : ' · outskirts'}
            </dd>
            <dt>Why</dt>
            <dd className="text-stone-600">{i.patch.why}</dd>
          </>
        )}
      </dl>
    </aside>
  );
}
