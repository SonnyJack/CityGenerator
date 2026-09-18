import { tools, useApp } from '../store.js';

/** Selected authored features or annotation: attributes and transforms. */
export function PropertiesPanel() {
  const doc = useApp((s) => s.document);
  const selection = useApp((s) => s.selection);
  const selectedAnnotation = useApp((s) => s.selectedAnnotation);
  const generatedHit = useApp((s) => s.generatedHit);
  const dispatch = useApp((s) => s.dispatch);
  const freeze = useApp((s) => s.freezeGenerated);
  const suppress = useApp((s) => s.suppressGenerated);
  const selectAnnotation = useApp((s) => s.selectAnnotation);
  const clearInspection = useApp((s) => s.clearInspection);

  const features = doc.authored.features.filter((f) => selection.includes(f.id));
  const annotation = selectedAnnotation
    ? doc.annotations.find((a) => a.id === selectedAnnotation)
    : undefined;

  if (annotation) {
    return (
      <aside className={panel} data-testid="properties">
        <Header title={`Annotation · ${annotation.kind}`} onClose={() => selectAnnotation(undefined)} />
        <label className="block">
          <span className="text-stone-600">Text</span>
          <textarea
            aria-label="Annotation text"
            className="mt-0.5 w-full rounded border border-stone-300 px-1 py-0.5"
            rows={2}
            value={annotation.text}
            onChange={(e) =>
              dispatch({ type: 'annotation.update', id: annotation.id, patch: { text: e.target.value } })
            }
          />
        </label>
        <label className="mt-1 flex items-center gap-1">
          <input
            type="checkbox"
            checked={annotation.gmOnly}
            onChange={(e) =>
              dispatch({ type: 'annotation.update', id: annotation.id, patch: { gmOnly: e.target.checked } })
            }
          />
          GM only (hidden on player handouts)
        </label>
        <div className="mt-2 flex gap-1">
          <button
            className={btn}
            onClick={() => dispatch({ type: 'annotation.remove', ids: [annotation.id] })}
          >
            Delete
          </button>
        </div>
      </aside>
    );
  }

  if (!features.length) {
    if (!generatedHit) return null;
    const p = generatedHit.properties;
    const what =
      generatedHit.layer === 'buildings' ? 'building' : generatedHit.layer === 'streets' ? 'street' : 'block';
    return (
      <aside className={panel} data-testid="properties">
        <Header title={`Generated ${what}`} onClose={clearInspection} />
        <div className="text-stone-600">
          {typeof p.kind === 'string' && <span>{p.kind} · </span>}
          {typeof p.ward === 'string' && <span>{p.ward} · </span>}
          {typeof p.floors === 'number' && <span>{p.floors} floors · </span>}
          <span className="font-mono">{generatedHit.id}</span>
        </div>
        <p className="mt-1 text-stone-500">
          Frozen features become yours: they keep their shape across reseeds and year changes.
        </p>
        <div className="mt-2 flex gap-1">
          <button className={btn} onClick={freeze} data-testid="freeze">
            Freeze
          </button>
          {generatedHit.layer === 'buildings' && (
            <button className={btn} onClick={suppress} data-testid="suppress">
              Remove
            </button>
          )}
        </div>
      </aside>
    );
  }

  const one = features.length === 1 ? features[0]! : null;
  const sameLayer = features.every((f) => f.properties.layer === features[0]!.properties.layer);
  const layer = features[0]!.properties.layer;
  const hasWidth = ['street', 'rail', 'tram', 'water', 'wall'].includes(layer) && sameLayer;
  const isStroke =
    (layer === 'terrainEdit' ||
      layer === 'fieldEdit' ||
      (layer === 'zone' && one?.geometry.type === 'LineString')) &&
    sameLayer;
  const setProps = (patch: Record<string, unknown>) => tools.setSelectionProperties(patch);

  return (
    <aside className={panel} data-testid="properties">
      <Header
        title={
          one
            ? `${labelFor(one.properties.layer)}${one.properties.origin === 'frozen' ? ' (frozen)' : ''}`
            : `${features.length} features`
        }
        onClose={() => {
          tools.selection.clear();
          useApp.getState().dispatchEditorChanged?.();
        }}
      />
      <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1">
        {one && (
          <>
            <span className="text-stone-600">Name</span>
            <input
              aria-label="Feature name"
              className={input}
              value={one.properties.name ?? ''}
              onChange={(e) => setProps({ name: e.target.value || undefined })}
            />
          </>
        )}
        <span className="text-stone-600">Kind</span>
        <input
          aria-label="Feature kind"
          className={input}
          value={one ? (one.properties.kind ?? '') : commonValue(features.map((f) => f.properties.kind))}
          onChange={(e) => setProps({ kind: e.target.value || undefined })}
        />
        {hasWidth && (
          <>
            <span className="text-stone-600">Width</span>
            <input
              aria-label="Feature width (m)"
              type="number"
              min={1}
              className={input}
              value={numberOr(
                features.map((f) => f.properties.widthM),
                8,
              )}
              onChange={(e) => setProps({ widthM: Math.max(1, Number(e.target.value) || 1) })}
            />
          </>
        )}
        {isStroke && (
          <>
            <span className="text-stone-600">Radius</span>
            <input
              aria-label="Stroke radius (m)"
              type="number"
              min={5}
              className={input}
              value={numberOr(
                features.map((f) => f.properties.radiusM),
                100,
              )}
              onChange={(e) => setProps({ radiusM: Math.max(5, Number(e.target.value) || 5) })}
            />
            {layer === 'terrainEdit' && (
              <>
                <span className="text-stone-600">Amount</span>
                <input
                  aria-label="Stroke amount"
                  type="number"
                  className={input}
                  value={numberOr(
                    features.map((f) => f.properties.amount),
                    10,
                  )}
                  onChange={(e) => setProps({ amount: Number(e.target.value) || 0 })}
                />
              </>
            )}
            {layer === 'fieldEdit' && (
              <>
                <span className="text-stone-600">Delta</span>
                <input
                  aria-label="Stroke delta"
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  className={input}
                  value={numberOr(
                    features.map((f) => f.properties.delta),
                    0.3,
                  )}
                  onChange={(e) =>
                    setProps({ delta: Math.max(-1, Math.min(1, Number(e.target.value) || 0)) })
                  }
                />
              </>
            )}
          </>
        )}
        {one && layer === 'building' && (
          <>
            <span className="text-stone-600">Floors</span>
            <input
              aria-label="Floors"
              type="number"
              min={1}
              max={120}
              className={input}
              value={typeof one.properties.floors === 'number' ? one.properties.floors : ''}
              onChange={(e) => setProps({ floors: e.target.value ? Number(e.target.value) : undefined })}
            />
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Transforms">
        <button
          className={btn}
          title="Rotate 15° anticlockwise"
          onClick={() => tools.transformSelection('rotate', Math.PI / 12)}
        >
          ↺ 15°
        </button>
        <button
          className={btn}
          title="Rotate 15° clockwise"
          onClick={() => tools.transformSelection('rotate', -Math.PI / 12)}
        >
          ↻ 15°
        </button>
        <button className={btn} title="Scale up 10 %" onClick={() => tools.transformSelection('scale', 1.1)}>
          +10 %
        </button>
        <button
          className={btn}
          title="Scale down 10 %"
          onClick={() => tools.transformSelection('scale', 1 / 1.1)}
        >
          −10 %
        </button>
        <button className={btn} title="Mirror left–right" onClick={() => tools.transformSelection('mirrorX')}>
          Mirror ↔
        </button>
        <button className={btn} title="Mirror top–bottom" onClick={() => tools.transformSelection('mirrorY')}>
          Mirror ↕
        </button>
        <button
          className={btn}
          title="Delete (Del)"
          onClick={() => tools.deleteSelection()}
          data-testid="delete-selection"
        >
          Delete
        </button>
      </div>
      {one?.properties.origin === 'frozen' && (
        <p className="mt-1 text-stone-500">
          Frozen from <span className="font-mono">{one.properties.frozenFrom}</span>. Deleting it lets the
          generator place something there again.
        </p>
      )}
      <p className="mt-1 text-stone-500">
        Arrow keys nudge by a pixel (Shift: ten). Double-click a segment to add a vertex; drag a handle to
        move it.
      </p>
    </aside>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="font-semibold">{title}</span>
      <button
        className="rounded px-1 text-stone-500 hover:bg-stone-100"
        aria-label="Close properties"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

function labelFor(layer: string): string {
  return (
    {
      street: 'Street',
      rail: 'Railway',
      tram: 'Tram line',
      water: 'Water',
      wall: 'Wall',
      zone: 'Zone',
      building: 'Building',
      facility: 'Facility',
      poi: 'Point of interest',
      vegetation: 'Vegetation',
      terrainEdit: 'Terrain stroke',
      fieldEdit: 'Field stroke',
    }[layer] ?? layer
  );
}

function commonValue(values: (string | undefined)[]): string {
  const first = values[0];
  return values.every((v) => v === first) ? (first ?? '') : '';
}

function numberOr(values: unknown[], fallback: number): number {
  const first = values[0];
  return values.every((v) => v === first) && typeof first === 'number' ? first : fallback;
}

const panel = 'rounded border border-stone-300 bg-white/95 p-3 text-xs shadow';
const btn = 'rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100';
const input = 'w-full rounded border border-stone-300 px-1 py-0.5';
