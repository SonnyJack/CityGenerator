import { settlementKindSchema, type SettlementKind } from '@citygen/core';
import { CULTURE_PACKS, DEFAULT_POPULATION, FEATURE_TYPES } from '@citygen/core';
import { useApp } from '../store.js';

const KIND_LABELS: Record<SettlementKind, string> = {
  metropolis: 'Metropolis',
  city: 'City',
  town: 'Town',
  village: 'Village',
  hamlet: 'Hamlet',
  portTown: 'Port town',
  fishingVillage: 'Fishing village',
  millTown: 'Mill town',
  miningTown: 'Mining town',
  resort: 'Resort',
  universityTown: 'University town',
  suburb: 'Suburb',
  industrialSatellite: 'Industrial satellite',
};

/** Explicit settlement list; when empty, the settlement policy draws one. */
export function SettlementsPanel() {
  const settlements = useApp((s) => s.document.spec.settlements);
  const doc = useApp((s) => s.document);
  const policy = useApp((s) => s.document.spec.settlementPolicy);
  const stats = useApp((s) => s.stats);
  const dispatch = useApp((s) => s.dispatch);
  const regenerate = useApp((s) => s.regenerate);

  function add() {
    const n = settlements.length + 1;
    let id = `settlement-${n}`;
    while (settlements.some((s) => s.id === id)) id = `${id}x`;
    dispatch({
      type: 'settlement.add',
      settlement: {
        id,
        kind: n === 1 ? 'city' : 'village',
        population: n === 1 ? DEFAULT_POPULATION.city : DEFAULT_POPULATION.village,
        layout: { streetPattern: 'organic' },
        features: [],
      },
    });
  }

  return (
    <section className="space-y-2" data-testid="settlements-panel">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Settlements</h2>
      {settlements.length === 0 && (
        <div className="space-y-1 text-xs text-stone-600">
          <p>
            Automatic: a city and {policy.count[0]}–{policy.count[1]} smaller places.
          </p>
          <label className="flex items-center gap-2">
            <span className="w-16">Count</span>
            <input
              aria-label="Settlement count"
              type="range"
              min={1}
              max={14}
              value={policy.count[1]}
              onChange={(e) => {
                const hi = Number(e.target.value);
                dispatch({
                  type: 'spec.patch',
                  ops: [
                    {
                      op: 'replace',
                      path: '/settlementPolicy/count',
                      value: [Math.min(policy.count[0], hi), hi],
                    },
                  ],
                });
              }}
            />
            <span className="font-mono">{policy.count[1]}</span>
          </label>
        </div>
      )}
      <ul className="space-y-1">
        {settlements.map((s) => {
          const live = stats?.settlements.find((x) => x.id === s.id);
          return (
            <li
              key={s.id}
              className="rounded border border-stone-200 bg-white p-1.5 text-xs"
              data-testid="settlement-row"
            >
              <div className="flex items-center gap-1">
                <input
                  aria-label={`Name of ${s.id}`}
                  className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-0.5"
                  placeholder={s.id}
                  value={s.name ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'settlement.update',
                      id: s.id,
                      patch: { name: e.target.value || undefined },
                    })
                  }
                />
                <button
                  className="rounded border border-stone-300 px-1.5 py-0.5 hover:bg-stone-100"
                  aria-label={`Regenerate ${s.id}`}
                  title="Re-roll this settlement's layout"
                  onClick={() => regenerate(s.id)}
                >
                  ⟳
                </button>
                <button
                  className="rounded border border-stone-300 px-1.5 py-0.5 hover:bg-stone-100"
                  aria-label={`Remove ${s.id}`}
                  onClick={() => dispatch({ type: 'settlement.remove', id: s.id })}
                >
                  ×
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <select
                  aria-label={`Kind of ${s.id}`}
                  className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1 py-0.5"
                  value={s.kind}
                  onChange={(e) => {
                    const kind = e.target.value as SettlementKind;
                    dispatch({
                      type: 'settlement.update',
                      id: s.id,
                      patch: { kind, population: DEFAULT_POPULATION[kind] },
                    });
                  }}
                >
                  {settlementKindSchema.options.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Culture of ${s.id}`}
                  className="w-24 rounded border border-stone-300 bg-white px-1 py-0.5"
                  value={s.culture ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'settlement.update',
                      id: s.id,
                      patch: { culture: e.target.value || undefined },
                    })
                  }
                >
                  <option value="">region culture</option>
                  {CULTURE_PACKS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Population of ${s.id}`}
                  type="number"
                  min={20}
                  step={100}
                  className="w-20 rounded border border-stone-300 px-1 py-0.5 font-mono"
                  value={s.population}
                  onChange={(e) => {
                    const population = Number(e.target.value);
                    if (population >= 1)
                      dispatch({ type: 'settlement.update', id: s.id, patch: { population } });
                  }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                {s.features.map((f) => (
                  <span
                    key={f.id}
                    className="flex items-center gap-0.5 rounded border border-stone-200 bg-stone-50 px-1"
                  >
                    {FEATURE_TYPES.find((t) => t.id === f.type)?.name ?? f.type}
                    {f.size && f.size !== 'medium' ? ` (${f.size})` : ''}
                    <button
                      className="text-stone-400 hover:text-red-700"
                      aria-label={`Remove ${f.type} from ${s.id}`}
                      onClick={() =>
                        dispatch({
                          type: 'settlement.update',
                          id: s.id,
                          patch: { features: s.features.filter((x) => x.id !== f.id) },
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  aria-label={`Add facility to ${s.id}`}
                  className="rounded border border-stone-300 bg-white px-1 py-0.5"
                  value=""
                  onChange={(e) => {
                    const type = e.target.value;
                    if (!type) return;
                    const custom = doc.spec.customFeatureTypes.find((c) => c.id === type);
                    void custom;
                    let id = `${s.id}:${type}`;
                    let n = 2;
                    while (s.features.some((x) => x.id === id)) id = `${s.id}:${type}#${n++}`;
                    dispatch({
                      type: 'settlement.update',
                      id: s.id,
                      patch: { features: [...s.features, { id, type, size: 'medium', lock: false }] },
                    });
                  }}
                >
                  <option value="">+ facility…</option>
                  {[
                    ...FEATURE_TYPES.map((t) => ({ id: t.id, name: t.name })),
                    ...doc.spec.customFeatureTypes.map((t) => ({ id: t.id, name: `${t.name} (custom)` })),
                  ].map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              {live && (
                <div className="mt-1 text-[11px] text-stone-500">
                  {live.patches} patches · {live.blocks} blocks{live.walled ? ' · walled' : ''} · r{' '}
                  {live.radiusM.toFixed(0)} m
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100"
        onClick={add}
      >
        + Add settlement
      </button>
      {stats && settlements.length === 0 && stats.settlements.length > 0 && (
        <ul className="text-[11px] text-stone-500">
          {stats.settlements.map((s) => (
            <li key={s.id}>
              {KIND_LABELS[s.kind as SettlementKind] ?? s.kind} · {s.population.toLocaleString()} · {s.blocks}{' '}
              blocks{s.walled ? ' · walled' : ''} · founded {s.founded}
              {s.peakPopulation > s.population * 1.03
                ? ` · peak ${s.peakPopulation.toLocaleString()} in ${s.peakYear}, ${s.abandonedBlocks} blocks abandoned`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
