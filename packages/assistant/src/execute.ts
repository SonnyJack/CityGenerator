import type { Command } from '@citygen/editor';
import { TOOL_SCHEMAS, type ToolInput, type ToolName } from './tools.js';
import type { GeneratedHit, ToolHost } from './host.js';

/** A content block the tool result carries back to the model. */
export type ResultBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

export interface ToolOutcome {
  name: ToolName;
  input: unknown;
  content: ResultBlock[];
  isError: boolean;
  /** History length before and after: an inline undo jumps back to `historyBefore`. */
  historyBefore: number;
  historyAfter: number;
  commands: Command[];
  warnings: string[];
  /** A short line for the tool card. */
  summary: string;
}

const MAX_TEXT = 60_000;

function text(value: unknown): ResultBlock[] {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return [{ type: 'text', text: s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}… [truncated]` : s }];
}

type Geometry = { type: string; coordinates: unknown };

function mapCoords(g: Geometry, f: (p: number[]) => number[]): Geometry {
  const walk = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number' ? f(c as number[]) : Array.isArray(c) ? c.map(walk) : c;
  return { ...g, coordinates: walk(g.coordinates) };
}

export function centroid(g: Geometry): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      sx += c[0] as number;
      sy += c[1] as number;
      n += 1;
    } else if (Array.isArray(c)) for (const x of c) walk(x);
  };
  walk(g.coordinates);
  return n ? [sx / n, sy / n] : [0, 0];
}

function checkFinite(g: Geometry, bounds: { halfW: number; halfH: number }): string | null {
  let bad: string | null = null;
  const walk = (c: unknown): void => {
    if (bad) return;
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const x = (c as number[])[0] ?? NaN;
      const y = (c as number[])[1] ?? NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) bad = 'coordinates must be finite numbers';
      else if (Math.abs(x) > bounds.halfW * 1.5 || Math.abs(y) > bounds.halfH * 1.5)
        bad = `point (${x}, ${y}) lies outside the region (±${bounds.halfW} × ±${bounds.halfH} m)`;
    } else if (Array.isArray(c)) for (const x of c) walk(x);
  };
  walk(g.coordinates);
  return bad;
}

/**
 * Validate a tool call and run it against the host. Every mutation goes
 * through the command bus; failures come back as error results the model can
 * read, never as exceptions.
 */
export async function executeTool(name: string, rawInput: unknown, host: ToolHost): Promise<ToolOutcome> {
  const historyBefore = host.historyLength();
  const commands: Command[] = [];
  const warnings: string[] = [];
  const base = { name: name as ToolName, input: rawInput, historyBefore, commands, warnings };
  const fail = (message: string): ToolOutcome => ({
    ...base,
    content: text({ error: message }),
    isError: true,
    historyAfter: host.historyLength(),
    summary: message,
  });
  if (!(name in TOOL_SCHEMAS)) return fail(`unknown tool ${name}`);
  const parsed = TOOL_SCHEMAS[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success)
    return fail(
      `invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  const input = parsed.data;
  const run = (command: Command): void => {
    const r = host.dispatch(command);
    commands.push(command);
    warnings.push(...r.warnings);
  };
  const ok = (value: unknown, summary: string, blocks?: ResultBlock[]): ToolOutcome => ({
    ...base,
    content: blocks ?? text(warnings.length ? { ...(value as object), warnings } : value),
    isError: false,
    historyAfter: host.historyLength(),
    summary,
  });
  const doc = () => host.document();
  const bounds = () => ({ halfW: doc().spec.extent.widthM / 2, halfH: doc().spec.extent.heightM / 2 });

  try {
    switch (name as ToolName) {
      case 'get_region_summary':
        return ok(await host.regionSummary(), 'Read the region summary');
      case 'get_settlement_summary': {
        const i = input as ToolInput<'get_settlement_summary'>;
        const s = await host.settlementSummary(i.id);
        return s ? ok(s, `Read ${s.name}`) : fail(`no settlement ${i.id}`);
      }
      case 'describe_area': {
        const i = input as ToolInput<'describe_area'>;
        return ok(
          await host.describeArea(i.x, i.y, i.radiusM ?? 150),
          `Described (${Math.round(i.x)}, ${Math.round(i.y)})`,
        );
      }
      case 'find_features': {
        const i = input as ToolInput<'find_features'>;
        const found = await host.findFeatures({
          ...(i.kind ? { kind: i.kind } : {}),
          ...(i.name ? { name: i.name } : {}),
          ...(i.settlement ? { settlement: i.settlement } : {}),
          ...(i.bbox ? { bbox: i.bbox } : {}),
          limit: i.limit ?? 50,
        });
        return ok(
          { count: found.length, features: found },
          `Found ${found.length} feature${found.length === 1 ? '' : 's'}`,
        );
      }
      case 'render_snapshot': {
        const i = input as ToolInput<'render_snapshot'>;
        const [minX, minY, maxX, maxY] = i.bbox;
        if (maxX - minX > 6000 || maxY - minY > 6000)
          return fail('snapshot bbox must be at most 6 km across');
        const shot = await host.snapshot(i.bbox, {
          ...(i.theme ? { theme: i.theme } : {}),
          ...(i.layers ? { layers: i.layers } : {}),
        });
        if (!shot) return fail('rendering is not available here');
        return ok(null, `Rendered ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} m`, [
          {
            type: 'text',
            text: `PNG ${shot.width}×${shot.height} px of bbox ${i.bbox.join(', ')} (x east, y north).`,
          },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.pngBase64 } },
        ]);
      }
      case 'get_spec':
        return ok(doc().spec, 'Read the spec');
      case 'patch_spec': {
        const i = input as ToolInput<'patch_spec'>;
        run({
          type: 'spec.patch',
          ops: i.ops.map((o) => ({
            op: o.op,
            path: o.path,
            ...(o.from ? { from: o.from } : {}),
            ...(o.value !== undefined && o.value !== null
              ? { value: o.value }
              : o.op === 'add' || o.op === 'replace'
                ? { value: o.value }
                : {}),
          })),
        });
        return ok({ applied: i.ops.length }, `Patched the spec (${i.ops.map((o) => o.path).join(', ')})`);
      }
      case 'set_year': {
        const i = input as ToolInput<'set_year'>;
        run({ type: 'year.set', year: i.year });
        return ok({ year: i.year }, `Set the year to ${i.year}`);
      }
      case 'set_theme': {
        const i = input as ToolInput<'set_theme'>;
        run({ type: 'ui.set', theme: i.theme });
        return ok({ theme: i.theme }, `Switched to the ${i.theme} theme`);
      }
      case 'regenerate': {
        const i = input as ToolInput<'regenerate'>;
        const salt = host.newId('salt');
        if (i.scope === 'area') {
          if (!i.polygon) return fail('area scope needs a polygon');
          run({
            type: 'override.add',
            override: { op: 'reroll', polygon: i.polygon.map((p) => [p[0], p[1]]), salt },
          });
          return ok({ rerolled: 'area' }, 'Re-rolled the area');
        }
        if (i.scope === 'settlement') {
          if (!i.id) return fail('settlement scope needs an id');
          run({ type: 'override.add', override: { op: 'reseed', target: i.id, salt } });
          return ok({ reseeded: i.id }, `Regenerated ${i.id}`);
        }
        run({ type: 'override.add', override: { op: 'reseed', target: 'region', salt } });
        return ok({ reseeded: 'region' }, 'Regenerated the region');
      }
      case 'draw': {
        const i = input as ToolInput<'draw'>;
        const bad = checkFinite(i.geometry as Geometry, bounds());
        if (bad) return fail(bad);
        const lineLayers = ['street', 'rail', 'tram', 'wall'];
        const polyLayers = ['building', 'zone', 'vegetation', 'facility'];
        if (lineLayers.includes(i.layer) && i.geometry.type !== 'LineString')
          return fail(`${i.layer} needs a LineString`);
        if (polyLayers.includes(i.layer) && i.geometry.type !== 'Polygon')
          return fail(`${i.layer} needs a Polygon`);
        if (i.layer === 'water' && i.geometry.type !== 'Polygon' && i.geometry.type !== 'LineString')
          return fail('water needs a Polygon (lake) or a LineString (canal)');
        if (i.layer === 'poi' && i.geometry.type !== 'Point') return fail('poi needs a Point');
        const id = host.newId(i.layer);
        const properties: Record<string, unknown> = { layer: i.layer, origin: 'authored' };
        if (i.kind) properties.kind = i.kind;
        else if (i.layer === 'street') properties.kind = 'local';
        else if (i.layer === 'water' && i.geometry.type === 'LineString') properties.kind = 'canal';
        if (i.name) properties.name = i.name;
        if (i.widthM) properties.widthM = i.widthM;
        if (i.floors) properties.floors = i.floors;
        run({
          type: 'authored.add',
          features: [{ type: 'Feature', id, geometry: i.geometry, properties } as never],
        });
        return ok({ id }, `Drew a ${i.layer}${i.name ? ` "${i.name}"` : ''}`);
      }
      case 'remove_feature': {
        const i = input as ToolInput<'remove_feature'>;
        const d = doc();
        if (d.authored.features.some((f) => f.id === i.id)) {
          run({ type: 'authored.remove', ids: [i.id] });
          return ok({ removed: i.id, kind: 'authored' }, `Removed ${i.id}`);
        }
        if (d.annotations.some((a) => a.id === i.id)) {
          run({ type: 'annotation.remove', ids: [i.id] });
          return ok({ removed: i.id, kind: 'annotation' }, `Removed annotation ${i.id}`);
        }
        const found = await host.findFeatures({ name: '', limit: 1000 });
        const hit = found.find((f) => f.id === i.id);
        if (hit?.kind === 'facility') {
          run({ type: 'override.add', override: { op: 'remove', target: i.id } });
          return ok({ removed: i.id, kind: 'facility' }, `Removed ${hit.name}`);
        }
        if (hit?.kind === 'settlement') {
          run({ type: 'settlement.remove', id: i.id });
          return ok({ removed: i.id, kind: 'settlement' }, `Removed ${hit.name}`);
        }
        run({ type: 'override.add', override: { op: 'suppress', target: i.id } });
        return ok({ removed: i.id, kind: 'generated' }, `Hid ${i.id}`);
      }
      case 'freeze': {
        const i = input as ToolInput<'freeze'>;
        const hit = await host.generatedAt(i.x, i.y, 6);
        if (!hit) return fail('nothing generated at that point');
        const id = host.freezeGenerated(hit as GeneratedHit);
        return ok(
          { id, frozenFrom: hit.id, layer: hit.layer },
          `Froze ${hit.layer.replace(/s$/, '')} ${hit.id}`,
        );
      }
      case 'unfreeze': {
        const i = input as ToolInput<'unfreeze'>;
        const f = doc().authored.features.find((x) => x.id === i.id);
        if (!f) return fail(`no authored feature ${i.id}`);
        run({ type: 'authored.remove', ids: [i.id] });
        return ok({ removed: i.id }, `Unfroze ${i.id}`);
      }
      case 'place_feature': {
        const i = input as ToolInput<'place_feature'>;
        const d = doc();
        const id = host.newId(i.type.replace(/\W+/g, '-'));
        const request = {
          id,
          type: i.type,
          ...(i.size ? { size: i.size } : {}),
          ...(i.x != null && i.y != null ? { pin: { x: i.x, y: i.y, rotation: i.rotation ?? 0 } } : {}),
          lock: i.x != null && i.y != null,
          ...(i.hint ? { hint: i.hint } : {}),
        };
        if (i.settlement) {
          const s = d.spec.settlements.find((x) => x.id === i.settlement);
          if (s) {
            run({ type: 'settlement.update', id: s.id, patch: { features: [...s.features, request] } });
          } else {
            // Automatic settlements are not in the spec; attach via the region list with a hint.
            run({
              type: 'spec.patch',
              ops: [
                {
                  op: 'add',
                  path: '/features/-',
                  value: { ...request, hint: `${i.hint ?? ''} settlement:${i.settlement}`.trim() },
                },
              ],
            });
          }
        } else run({ type: 'spec.patch', ops: [{ op: 'add', path: '/features/-', value: request }] });
        await host.settle();
        const found = await host.findFeatures({ kind: 'facility', limit: 500 });
        const placed = found.find((f) => f.id === id);
        return placed
          ? ok({ id, placed: true, center: placed.center, name: placed.name }, `Placed ${placed.name}`)
          : ok(
              { id, placed: false, note: 'requested; the engine reported no placement yet' },
              `Requested a ${i.type}`,
            );
      }
      case 'move_feature': {
        const i = input as ToolInput<'move_feature'>;
        const d = doc();
        const authored = d.authored.features.find((f) => f.id === i.id);
        if (authored) {
          const [cx, cy] = centroid(authored.geometry as Geometry);
          const dx = i.x - cx;
          const dy = i.y - cy;
          run({
            type: 'authored.update',
            id: i.id,
            geometry: mapCoords(authored.geometry as Geometry, (p) => [p[0]! + dx, p[1]! + dy]) as never,
          });
          return ok({ moved: i.id, to: [i.x, i.y] }, `Moved ${i.id}`);
        }
        const settlement = d.spec.settlements.find((s) => s.id === i.id);
        if (settlement) {
          run({ type: 'settlement.update', id: i.id, patch: { site: { center: [i.x, i.y], lock: true } } });
          return ok({ moved: i.id, to: [i.x, i.y] }, `Moved ${settlement.name ?? i.id}`);
        }
        run({
          type: 'override.add',
          override: { op: 'pin', target: i.id, x: i.x, y: i.y, rotation: i.rotation ?? 0 },
        });
        return ok(
          { moved: i.id, to: [i.x, i.y] },
          `Pinned ${i.id} at (${Math.round(i.x)}, ${Math.round(i.y)})`,
        );
      }
      case 'brush': {
        const i = input as ToolInput<'brush'>;
        const geometry: Geometry =
          i.points.length > 1
            ? { type: 'LineString', coordinates: i.points }
            : { type: 'Point', coordinates: i.points[0] };
        const bad = checkFinite(geometry, bounds());
        if (bad) return fail(bad);
        const id = host.newId('brush');
        let properties: Record<string, unknown>;
        if (i.kind === 'wealth' || i.kind === 'density')
          properties = {
            layer: 'fieldEdit',
            origin: 'authored',
            field: i.kind,
            radiusM: i.radiusM,
            delta: Math.max(-1, Math.min(1, i.amount ?? 0.3)),
          };
        else if (i.kind === 'zone') {
          if (!i.ward) return fail('zone brush needs a ward');
          properties = { layer: 'zone', origin: 'authored', kind: i.ward, radiusM: i.radiusM };
        } else
          properties = {
            layer: 'terrainEdit',
            origin: 'authored',
            op: i.kind,
            radiusM: i.radiusM,
            amount: i.amount ?? 15,
          };
        run({ type: 'authored.add', features: [{ type: 'Feature', id, geometry, properties } as never] });
        return ok(
          { id },
          `Brushed ${i.kind}${i.ward ? ` (${i.ward})` : ''} over ${i.points.length} point${i.points.length === 1 ? '' : 's'}`,
        );
      }
      case 'annotate': {
        const i = input as ToolInput<'annotate'>;
        const id = host.newId('note');
        let geometry: Geometry;
        if (i.kind === 'handoutFrame') {
          if (!i.polygon) return fail('handoutFrame needs a polygon');
          const ring = [...i.polygon, i.polygon[0]!];
          geometry = { type: 'Polygon', coordinates: [ring] };
        } else {
          if (i.x == null || i.y == null) return fail(`${i.kind} needs x and y`);
          geometry = { type: 'Point', coordinates: [i.x, i.y] };
        }
        run({
          type: 'annotation.add',
          annotation: {
            id,
            kind: i.kind,
            geometry: geometry as never,
            text: i.text,
            gmOnly: i.gmOnly ?? i.kind === 'note',
          },
        });
        return ok({ id }, `Added a ${i.kind}: ${i.text}`);
      }
      case 'name_features': {
        const i = input as ToolInput<'name_features'>;
        const d = doc();
        for (const item of i.items) {
          const s = d.spec.settlements.find((x) => x.id === item.id);
          if (s) run({ type: 'settlement.update', id: s.id, patch: { name: item.name } });
          else
            run({
              type: 'override.add',
              override: { op: 'setProperty', target: item.id, key: 'name', value: item.name },
            });
        }
        return ok({ renamed: i.items.length }, `Renamed ${i.items.map((x) => x.name).join(', ')}`);
      }
      case 'add_settlement': {
        const i = input as ToolInput<'add_settlement'>;
        const bad = checkFinite({ type: 'Point', coordinates: [i.x, i.y] }, bounds());
        if (bad) return fail(bad);
        const id = host.newId(i.kind);
        run({
          type: 'settlement.add',
          settlement: {
            id,
            kind: i.kind,
            population: i.population,
            site: { center: [i.x, i.y], lock: true },
            layout: { streetPattern: 'mixed' },
            features: [],
            ...(i.name ? { name: i.name } : {}),
            ...(i.culture ? { culture: i.culture } : {}),
          },
        });
        return ok({ id }, `Added ${i.name ?? `a ${i.kind}`} at (${Math.round(i.x)}, ${Math.round(i.y)})`);
      }
      case 'remove_settlement': {
        const i = input as ToolInput<'remove_settlement'>;
        run({ type: 'settlement.remove', id: i.id });
        return ok({ removed: i.id }, `Removed settlement ${i.id}`);
      }
      case 'undo':
        return host.undo() ? ok({ undone: true }, 'Undid the last command') : fail('nothing to undo');
      case 'redo':
        return host.redo() ? ok({ redone: true }, 'Redid the last command') : fail('nothing to redo');
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail('unreachable');
}
