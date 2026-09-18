import { useApp } from '../store.js';

/** "Why is this here?": what the engine knows about the clicked point. */
export function Inspector() {
  const inspection = useApp((s) => s.inspection);
  const clear = useApp((s) => s.clearInspection);
  const dispatch = useApp((s) => s.dispatch);
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
        {i.facility && (
          <>
            <dt>Facility</dt>
            <dd data-testid="inspector-facility">
              {i.facility.name}
              {i.facility.part ? ` · ${i.facility.part.name ?? i.facility.part.kind}` : ''}
              {i.facility.pinned ? ' · pinned' : ''}
              {i.facility.outcome !== 'placed' ? ` · ${i.facility.outcome}` : ''}
            </dd>
            <dt>Footprint</dt>
            <dd className="font-mono">
              {i.facility.lengthM.toFixed(0)} × {i.facility.widthM.toFixed(0)} m
              {Math.abs(i.facility.realLengthM - i.facility.lengthM) > 1 &&
                ` (${i.facility.realLengthM.toFixed(0)} × ${i.facility.realWidthM.toFixed(0)} m at true scale)`}
            </dd>
            <dt />
            <dd className="flex gap-1">
              {!i.facility.pinned && (
                <button
                  className={btn}
                  title="Keep this facility exactly here across regeneration"
                  onClick={() =>
                    dispatch({
                      type: 'override.add',
                      override: {
                        op: 'pin',
                        target: i.facility!.id,
                        x: i.facility!.center[0],
                        y: i.facility!.center[1],
                        rotation: i.facility!.rotation,
                      },
                    })
                  }
                >
                  Pin here
                </button>
              )}
              <button
                className={btn}
                title="Remove this facility (undoable)"
                onClick={() => {
                  dispatch({ type: 'override.add', override: { op: 'remove', target: i.facility!.id } });
                  clear();
                }}
              >
                Remove
              </button>
            </dd>
          </>
        )}
        {i.building && (
          <>
            <dt>Building</dt>
            <dd data-testid="inspector-building">
              {i.building.name}
              {i.building.address ? ` · ${i.building.address}` : ''}
            </dd>
            <dt />
            <dd className="text-stone-600">
              {i.building.useLabel} · {i.building.kindLabel} · {i.building.material} · {i.building.floors}{' '}
              {i.building.floors === 1 ? 'floor' : 'floors'}
            </dd>
          </>
        )}
        {i.patch && (
          <>
            <dt>Zone</dt>
            <dd data-testid="inspector-zone">
              {i.patch.ward}
              {i.patch.district ? ` · ${i.patch.district}` : ''}
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

const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100';
