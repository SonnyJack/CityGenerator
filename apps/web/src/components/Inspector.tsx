import { useState } from 'react';
import { useApp } from '../store.js';
import { InteriorPanel } from './InteriorPanel.js';
import { useT } from '../i18n/index.js';

/** "Why is this here?": what the engine knows about the clicked point. */
const UTILITY_KIND_LABELS: Record<string, string> = {
  waterMain: 'water main',
  gasMain: 'gas main',
  powerLine: 'power line',
  sewer: 'sewer',
  pipeline: 'pipeline',
  canal: 'canal',
  trunk: 'trunk main',
  distribution: 'distribution main',
  transmission: 'transmission line',
  branch: 'branch sewer',
  oil: 'oil pipeline',
  cut: 'canal cut',
  reservoir: 'reservoir',
  waterTower: 'water tower',
  substation: 'substation',
  pylon: 'pylon',
  outfall: 'sewer outfall',
  sewageWorks: 'sewage works',
  lock: 'canal lock',
  canalBasin: 'canal basin',
  gridSupply: 'grid supply',
};

export function Inspector() {
  const t = useT();
  const inspection = useApp((s) => s.inspection);
  const clear = useApp((s) => s.clearInspection);
  const dispatch = useApp((s) => s.dispatch);
  const [plans, setPlans] = useState<{ id: string; name: string } | null>(null);
  if (!inspection) return null;
  const i = inspection;
  return (
    <aside className="rounded border border-stone-300 bg-white/95 p-3 text-xs shadow" data-testid="inspector">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">{t('Inspector')}</span>
        <button
          className="rounded px-1 text-stone-500 hover:bg-stone-100"
          aria-label={t('Close inspector')}
          onClick={clear}
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-stone-700">
        <dt>{t('Position')}</dt>
        <dd className="font-mono">
          {i.x.toFixed(0)}, {i.y.toFixed(0)} m
        </dd>
        <dt>{t('Elevation')}</dt>
        <dd className="font-mono">
          {i.elevationM.toFixed(1)} m · slope {(i.slope * 100).toFixed(0)} %
        </dd>
        <dt>{t('Ground')}</dt>
        <dd>{i.water === 'land' ? i.landcover : i.water}</dd>
        <dt>{t('Wealth')}</dt>
        <dd>
          {i.wealthClass} <span className="font-mono text-stone-500">({i.wealth.toFixed(2)})</span>
        </dd>
        <dt>{t('Density')}</dt>
        <dd>
          {i.densityClass} <span className="font-mono text-stone-500">({i.density.toFixed(2)})</span>
        </dd>
        {i.settlement && (
          <>
            <dt>{t('Settlement')}</dt>
            <dd>
              {i.settlement.name ?? i.settlement.id} · {i.settlement.kind} ·{' '}
              {i.settlement.population.toLocaleString()}
            </dd>
          </>
        )}
        {i.facility && (
          <>
            <dt>{t('Facility')}</dt>
            <dd data-testid="inspector-facility">
              {i.facility.name}
              {i.facility.part ? ` · ${i.facility.part.name ?? i.facility.part.kind}` : ''}
              {i.facility.pinned ? ' · pinned' : ''}
              {i.facility.outcome !== 'placed' ? ` · ${i.facility.outcome}` : ''}
              {` · ${i.facility.opened}–${i.facility.closed ?? ''}`}
              {i.facility.closed !== undefined ? ' (closed)' : ''}
              {i.facility.part?.interior && (
                <>
                  {' '}
                  <button
                    className="rounded border border-stone-300 bg-white px-1 text-[11px] hover:bg-stone-100"
                    onClick={() =>
                      setPlans({
                        id: i.facility!.part!.id,
                        name: `${i.facility!.name} · ${i.facility!.part!.name ?? i.facility!.part!.kind}`,
                      })
                    }
                  >
                    {t('Floor plans')}
                  </button>
                </>
              )}
            </dd>
            <dt>{t('Footprint')}</dt>
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
                  title={t('Keep this facility exactly here across regeneration')}
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
                  {t('Pin here')}
                </button>
              )}
              <button
                className={btn}
                title={t('Remove this facility (undoable)')}
                onClick={() => {
                  dispatch({ type: 'override.add', override: { op: 'remove', target: i.facility!.id } });
                  clear();
                }}
              >
                {t('Remove')}
              </button>
            </dd>
          </>
        )}
        {i.building && (
          <>
            <dt>{t('Building')}</dt>
            <dd data-testid="inspector-building">
              {i.building.name}
              {i.building.address ? ` · ${i.building.address}` : ''}
            </dd>
            <dt />
            <dd className="text-stone-600">
              {i.building.useLabel} · {i.building.kindLabel} · {i.building.material} · {i.building.floors}{' '}
              {t(i.building.floors === 1 ? 'floor' : 'floors')}
              {i.building.built ? ` · ${t('built {year}', { year: i.building.built })}` : ''}
              {i.building.state && i.building.state !== 'sound' ? ` · ${i.building.state}` : ''}{' '}
              <button
                className="rounded border border-stone-300 bg-white px-1 text-[11px] hover:bg-stone-100"
                onClick={() =>
                  setPlans({ id: i.building!.id, name: i.building!.name || i.building!.kindLabel })
                }
              >
                {t('Floor plans')}
              </button>
            </dd>
          </>
        )}
        {i.utilities && i.utilities.length > 0 && (
          <>
            <dt>{t('Services')}</dt>
            <dd className="text-stone-600" data-testid="inspector-utilities">
              {i.utilities
                .map(
                  (u) =>
                    `${t(UTILITY_KIND_LABELS[u.kind] ?? UTILITY_KIND_LABELS[u.class] ?? u.kind)}${
                      u.status === 'disused' ? ` (${t('disused')})` : ''
                    }${u.gmOnly ? ` · ${t('GM only')}` : ''}`,
                )
                .join(' · ')}
            </dd>
          </>
        )}
        {i.patch && (
          <>
            <dt>{t('Zone')}</dt>
            <dd data-testid="inspector-zone">
              {i.patch.ward}
              {i.patch.district ? ` · ${i.patch.district}` : ''}
              {i.patch.ring > 0 ? ` · ring ${i.patch.ring}` : i.patch.inner ? ' · old town' : ' · outskirts'}
            </dd>
            <dt>{t('Why')}</dt>
            <dd className="text-stone-600">{i.patch.why}</dd>
          </>
        )}
      </dl>
      {plans && (
        <InteriorPanel
          key={plans.id}
          buildingId={plans.id}
          name={plans.name}
          onClose={() => setPlans(null)}
        />
      )}
    </aside>
  );
}

const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100';
