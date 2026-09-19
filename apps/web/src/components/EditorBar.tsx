import { useState } from 'react';
import { FEATURE_TYPES, type AuthoredLayer } from '@citygen/core';
import type { BrushKind, ToolId } from '@citygen/editor';
import { useApp } from '../store.js';
import { useT } from '../i18n/index.js';

const TOOLS: { id: ToolId; label: string; key: string; hint: string }[] = [
  { id: 'navigate', label: 'Pan', key: 'H', hint: 'Pan and zoom; click to inspect' },
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    hint: 'Click or drag a box to select; drag to move; drag handles to edit vertices; double-click a segment to add a vertex',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    key: 'S',
    hint: 'Drag a loop around what you want; Shift adds to the selection',
  },
  {
    id: 'line',
    label: 'Line',
    key: 'L',
    hint: 'Click to add vertices; double-click, Enter or click the last vertex to finish',
  },
  {
    id: 'polygon',
    label: 'Polygon',
    key: 'P',
    hint: 'Click to add vertices; Enter or double-click to close',
  },
  { id: 'rectangle', label: 'Rectangle', key: 'R', hint: 'Drag a rectangle' },
  { id: 'point', label: 'Point', key: 'O', hint: 'Click to place a point of interest' },
  {
    id: 'facility',
    label: 'Facility',
    key: 'F',
    hint: 'Drag the ground a works, a port or an institution stands on; it is laid out inside it',
  },
  {
    id: 'brush',
    label: 'Brush',
    key: 'B',
    hint: 'Paint terrain, wealth, density or zones; erase or re-roll',
  },
  {
    id: 'annotate',
    label: 'Annotate',
    key: 'N',
    hint: 'Click to place a label, marker, GM note or handout frame',
  },
];

const LINE_LAYERS: { id: AuthoredLayer; label: string; kinds: string[]; widthM: number }[] = [
  {
    id: 'street',
    label: 'Street',
    kinds: ['local', 'main', 'avenue', 'lane', 'alley', 'motorway'],
    widthM: 8,
  },
  { id: 'rail', label: 'Railway', kinds: ['mainline', 'branch', 'siding', 'yard'], widthM: 5 },
  { id: 'tram', label: 'Tram', kinds: ['tram'], widthM: 4 },
  { id: 'water', label: 'Canal / stream', kinds: ['canal', 'stream', 'drain'], widthM: 6 },
  { id: 'wall', label: 'Wall', kinds: ['wall', 'fence', 'quay'], widthM: 3 },
];

const AREA_LAYERS: { id: AuthoredLayer; label: string; kinds: string[] }[] = [
  {
    id: 'building',
    label: 'Building',
    kinds: ['house', 'warehouse', 'church', 'hall', 'factory', 'station', 'mansion', 'shop', 'ruin'],
  },
  {
    id: 'facility',
    label: 'Facility',
    kinds: [
      'railYard',
      'containerPort',
      'dryDock',
      'industrialEstate',
      'airfield',
      'cemetery',
      'stadium',
      'hospital',
      'university',
      'market',
    ],
  },
  { id: 'zone', label: 'Zone', kinds: WARD_IDS() },
  { id: 'vegetation', label: 'Vegetation', kinds: ['wood', 'park', 'orchard', 'marsh'] },
  { id: 'water', label: 'Water', kinds: ['pond', 'lake', 'basin', 'harbour'] },
];

const POINT_LAYERS: { id: AuthoredLayer; label: string; kinds: string[] }[] = [
  {
    id: 'poi',
    label: 'Point of interest',
    kinds: ['landmark', 'well', 'shrine', 'monument', 'lamp', 'tree', 'clue'],
  },
  { id: 'facility', label: 'Facility marker', kinds: ['station', 'lighthouse', 'mine', 'quarry', 'mill'] },
];

function WARD_IDS(): string[] {
  return [
    'plaza',
    'market',
    'craftsmen',
    'merchant',
    'patriciate',
    'slum',
    'fishing',
    'military',
    'cathedral',
    'castle',
    'park',
    'gate',
    'farm',
    'common',
    'cbd',
    'retailStrip',
    'rowhouse',
    'tenement',
    'streetcarSuburb',
    'gardenSuburb',
    'suburb',
    'culDeSac',
    'apartment',
    'towerEstate',
    'warehouse',
  ];
}

const BRUSHES: { id: BrushKind; label: string; unit: string; min: number; max: number; step: number }[] = [
  { id: 'raise', label: 'Raise terrain', unit: 'm', min: 1, max: 200, step: 1 },
  { id: 'lower', label: 'Lower terrain', unit: 'm', min: 1, max: 200, step: 1 },
  { id: 'smooth', label: 'Smooth terrain', unit: '', min: 0.1, max: 1, step: 0.1 },
  { id: 'flatten', label: 'Flatten to level', unit: 'm', min: -50, max: 1000, step: 1 },
  { id: 'water', label: 'Carve water', unit: 'm', min: 0.5, max: 30, step: 0.5 },
  { id: 'wealth', label: 'Wealth ±', unit: '', min: -1, max: 1, step: 0.05 },
  { id: 'density', label: 'Density ±', unit: '', min: -1, max: 1, step: 0.05 },
  { id: 'condition', label: 'Condition ± (repair / decay)', unit: '', min: -1, max: 1, step: 0.05 },
  { id: 'zone', label: 'Zone', unit: '', min: 0, max: 0, step: 0 },
  { id: 'vegetation', label: 'Land cover', unit: '', min: 0, max: 0, step: 0 },
  { id: 'year', label: 'Built year ± (earlier / later)', unit: 'years', min: -400, max: 400, step: 5 },
  { id: 'erase', label: 'Erase authored', unit: '', min: 0, max: 0, step: 0 },
  { id: 'reroll', label: 'Re-roll blocks', unit: '', min: 0, max: 0, step: 0 },
];

/** Floating tool strip with the active tool's options. */
export function EditorBar() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const o = useApp((s) => s.toolOptions);
  const setOptions = useApp((s) => s.setToolOptions);
  const active = TOOLS.find((t) => t.id === tool)!;

  const kindsFor = (): string[] => {
    if (tool === 'line') return LINE_LAYERS.find((l) => l.id === o.layer)?.kinds ?? [];
    if (tool === 'polygon' || tool === 'rectangle')
      return AREA_LAYERS.find((l) => l.id === o.layer)?.kinds ?? [];
    if (tool === 'point') return POINT_LAYERS.find((l) => l.id === o.layer)?.kinds ?? [];
    return [];
  };

  const setLayer = (layer: AuthoredLayer) => {
    const line = LINE_LAYERS.find((l) => l.id === layer);
    const kinds =
      (line ?? AREA_LAYERS.find((l) => l.id === layer) ?? POINT_LAYERS.find((l) => l.id === layer))?.kinds ??
      [];
    setOptions({ layer, kind: kinds[0] ?? o.kind, ...(line ? { widthM: line.widthM } : {}) });
  };

  const layerChoices =
    tool === 'line'
      ? LINE_LAYERS
      : tool === 'point'
        ? POINT_LAYERS
        : tool === 'polygon' || tool === 'rectangle'
          ? AREA_LAYERS
          : null;
  const validLayer = layerChoices?.some((l) => l.id === o.layer) ?? true;
  if (layerChoices && !validLayer) {
    // Switch to a layer the tool can draw (the controller keeps one shared option set).
    queueMicrotask(() => setLayer(layerChoices[0]!.id));
  }
  const brush = BRUSHES.find((b) => b.id === o.brush)!;

  return (
    <div
      className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-20rem)] flex-col gap-1"
      data-testid="editor-bar"
    >
      <div
        className="flex flex-wrap gap-1 rounded border border-stone-300 bg-white/95 p-1 shadow"
        role="toolbar"
        aria-label={t('Tools')}
      >
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            className={`rounded px-2 py-1 text-xs ${tool === tl.id ? 'bg-blue-600 text-white' : 'hover:bg-stone-100'}`}
            title={`${t(tl.hint)} (${tl.key})`}
            aria-pressed={tool === tl.id}
            aria-label={t('{label} tool', { label: t(tl.label) })}
            onClick={() => setTool(tl.id)}
          >
            {t(tl.label)}
          </button>
        ))}
      </div>
      {tool !== 'navigate' && (
        <div
          className="flex flex-wrap items-center gap-2 rounded border border-stone-300 bg-white/95 px-2 py-1 text-xs shadow"
          data-testid="tool-options"
        >
          {layerChoices && (
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Layer')}</span>
              <select
                aria-label={t('Layer')}
                className={sel}
                value={validLayer ? o.layer : layerChoices[0]!.id}
                onChange={(e) => setLayer(e.target.value as AuthoredLayer)}
              >
                {layerChoices.map((l) => (
                  <option key={l.id} value={l.id}>
                    {t(l.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {layerChoices && kindsFor().length > 0 && (
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Kind')}</span>
              <select
                aria-label={t('Kind')}
                className={sel}
                value={o.kind}
                onChange={(e) => setOptions({ kind: e.target.value })}
              >
                {kindsFor().map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tool === 'line' && (
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Width')}</span>
              <input
                aria-label={t('Width (m)')}
                type="number"
                min={1}
                max={200}
                step={1}
                className={num}
                value={o.widthM}
                onChange={(e) => setOptions({ widthM: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span className="text-stone-500">m</span>
            </label>
          )}
          {tool === 'brush' && (
            <>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Brush')}</span>
                <select
                  aria-label={t('Brush')}
                  className={sel}
                  value={o.brush}
                  onChange={(e) =>
                    setOptions({
                      brush: e.target.value as BrushKind,
                      brushAmount: defaultAmount(e.target.value as BrushKind),
                    })
                  }
                >
                  {BRUSHES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {t(b.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Radius')}</span>
                <input
                  aria-label={t('Brush radius (m)')}
                  type="range"
                  min={10}
                  max={2000}
                  step={10}
                  value={o.brushRadiusM}
                  onChange={(e) => setOptions({ brushRadiusM: Number(e.target.value) })}
                />
                <span className="w-12 font-mono">{o.brushRadiusM} m</span>
              </label>
              {brush.max > brush.min && (
                <label className="flex items-center gap-1">
                  <span className="text-stone-600">{t('Amount')}</span>
                  <input
                    aria-label={t('Brush amount')}
                    type="number"
                    min={brush.min}
                    max={brush.max}
                    step={brush.step}
                    className={num}
                    value={o.brushAmount}
                    onChange={(e) => setOptions({ brushAmount: Number(e.target.value) })}
                  />
                  <span className="text-stone-500">{brush.unit}</span>
                </label>
              )}
              {o.brush === 'vegetation' && (
                <label className="flex items-center gap-1">
                  <span className="text-stone-600">{t('Cover')}</span>
                  <select
                    aria-label={t('Cover class')}
                    className={sel}
                    value={o.cover}
                    onChange={(e) => setOptions({ cover: e.target.value })}
                  >
                    {COVERS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {o.brush === 'zone' && (
                <label className="flex items-center gap-1">
                  <span className="text-stone-600">{t('Ward')}</span>
                  <select
                    aria-label={t('Zone ward')}
                    className={sel}
                    value={o.zoneWard}
                    onChange={(e) => setOptions({ zoneWard: e.target.value })}
                  >
                    {WARD_IDS().map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {tool === 'facility' && (
            <>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Type')}</span>
                <select
                  aria-label={t('Facility type')}
                  className={sel}
                  value={o.facilityType}
                  onChange={(e) => setOptions({ facilityType: e.target.value })}
                >
                  {FEATURE_TYPES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Size')}</span>
                <select
                  aria-label={t('Facility size')}
                  className={sel}
                  value={o.facilitySize}
                  onChange={(e) =>
                    setOptions({ facilitySize: e.target.value as 'small' | 'medium' | 'large' })
                  }
                >
                  <option value="small">{t('small')}</option>
                  <option value="medium">{t('medium')}</option>
                  <option value="large">{t('large')}</option>
                </select>
              </label>
            </>
          )}
          {tool === 'annotate' && (
            <>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Kind')}</span>
                <select
                  aria-label={t('Annotation kind')}
                  className={sel}
                  value={o.annotation}
                  onChange={(e) => setOptions({ annotation: e.target.value as typeof o.annotation })}
                >
                  <option value="label">{t('Label')}</option>
                  <option value="marker">{t('Marker')}</option>
                  <option value="arrow">{t('Arrow')}</option>
                  <option value="note">{t('GM note')}</option>
                  <option value="handoutFrame">{t('Handout frame')}</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-stone-600">{t('Text')}</span>
                <input
                  aria-label={t('Annotation text')}
                  className="w-40 rounded border border-stone-300 px-1 py-0.5"
                  value={o.text}
                  onChange={(e) => setOptions({ text: e.target.value })}
                />
              </label>
            </>
          )}
          {(tool === 'select' || tool === 'lasso') && <SelectOptions />}
          {(tool === 'line' ||
            tool === 'polygon' ||
            tool === 'rectangle' ||
            tool === 'point' ||
            tool === 'select' ||
            tool === 'lasso') && (
            <>
              <label
                className="flex items-center gap-1"
                title={t('Snap to vertices of other authored features')}
              >
                <input
                  type="checkbox"
                  aria-label={t('Snap to vertices')}
                  checked={o.snapToVertices}
                  onChange={(e) => setOptions({ snapToVertices: e.target.checked })}
                />
                {t('Vertices')}
              </label>
              <label
                className="flex items-center gap-1"
                title={t('Constrain segments to 15° steps (or hold Shift)')}
              >
                <input
                  type="checkbox"
                  aria-label={t('Snap angles')}
                  checked={o.snapAngles}
                  onChange={(e) => setOptions({ snapAngles: e.target.checked })}
                />
                {t('Angles')}
              </label>
              <label
                className="flex items-center gap-1"
                title={t('Line up with the edges and centres of what is already drawn')}
              >
                <input
                  type="checkbox"
                  aria-label={t('Alignment guides')}
                  checked={o.snapAlign}
                  onChange={(e) => setOptions({ snapAlign: e.target.checked })}
                />
                {t('Align')}
              </label>
              <label
                className="flex items-center gap-1"
                title={t('Snap to a metre grid (0 = off); hold Alt to bypass snapping')}
              >
                <span className="text-stone-600">{t('Grid')}</span>
                <input
                  aria-label={t('Snap grid (m)')}
                  type="number"
                  min={0}
                  max={1000}
                  step={5}
                  className={num}
                  value={o.snapGridM}
                  onChange={(e) => setOptions({ snapGridM: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </>
          )}
          <span className="text-stone-500">{t(active.hint)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Options shared by the select and lasso tools: what a box or a loop takes in, and a query
 * that selects everything matching a layer, a kind or a name, optionally only what is in view.
 */
function SelectOptions() {
  const t = useT();
  const o = useApp((s) => s.toolOptions);
  const setOptions = useApp((s) => s.setToolOptions);
  const selectByQuery = useApp((s) => s.selectByQuery);
  const selection = useApp((s) => s.selection);
  const [layer, setLayer] = useState<'' | AuthoredLayer>('');
  const [text, setText] = useState('');
  const [inView, setInView] = useState(true);

  return (
    <>
      <label className="flex items-center gap-1" title={t('What a box or a loop takes in')}>
        <span className="text-stone-600">{t('Takes')}</span>
        <select
          aria-label={t('Selection mode')}
          className={sel}
          value={o.selectMode}
          onChange={(e) => setOptions({ selectMode: e.target.value as 'contains' | 'intersects' })}
        >
          <option value="contains">{t('enclosed')}</option>
          <option value="intersects">{t('touched')}</option>
        </select>
      </label>
      <span className="flex items-center gap-1" data-testid="select-query">
        <span className="text-stone-600">{t('Find')}</span>
        <select
          aria-label={t('Query layer')}
          className={sel}
          value={layer}
          onChange={(e) => setLayer(e.target.value as '' | AuthoredLayer)}
        >
          <option value="">{t('any layer')}</option>
          {ALL_LAYERS.map((l) => (
            <option key={l.id} value={l.id}>
              {t(l.label)}
            </option>
          ))}
        </select>
        <input
          aria-label={t('Query text')}
          placeholder={t('kind or name')}
          className="w-28 rounded border border-stone-300 px-1 py-0.5"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="flex items-center gap-1" title={t('Only what lies wholly in the current view')}>
          <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} />
          {t('in view')}
        </label>
        <button
          className="rounded border border-stone-300 bg-white px-2 py-0.5 hover:bg-stone-100"
          onClick={() => selectByQuery({ layer: layer || undefined, text: text || undefined, inView })}
        >
          {t('Select')}
        </button>
        <span className="text-stone-500">{t('{n} selected', { n: selection.length })}</span>
      </span>
    </>
  );
}

/** Land covers the vegetation brush paints (water is the terrain's, not the brush's). */
const COVERS: { id: string; label: string }[] = [
  { id: 'forest', label: 'Woods' },
  { id: 'open', label: 'Open ground' },
  { id: 'farmland', label: 'Farmland' },
  { id: 'marsh', label: 'Marsh' },
  { id: 'sand', label: 'Sand' },
  { id: 'rock', label: 'Rock' },
  { id: 'snow', label: 'Snow' },
  { id: 'mangrove', label: 'Mangrove' },
];

const ALL_LAYERS: { id: AuthoredLayer; label: string }[] = [
  ...LINE_LAYERS.map((l) => ({ id: l.id, label: l.label })),
  ...AREA_LAYERS.map((l) => ({ id: l.id, label: l.label })),
  { id: 'poi', label: 'Point of interest' },
];

function defaultAmount(brush: BrushKind): number {
  switch (brush) {
    case 'raise':
    case 'lower':
      return 15;
    case 'smooth':
      return 0.6;
    case 'flatten':
      return 20;
    case 'water':
      return 4;
    case 'wealth':
    case 'density':
      return 0.3;
    case 'condition':
      return -0.4;
    case 'year':
      return -40;
    default:
      return 0;
  }
}

const sel = 'rounded border border-stone-300 bg-white px-1 py-0.5';
const num = 'w-16 rounded border border-stone-300 px-1 py-0.5 font-mono';
