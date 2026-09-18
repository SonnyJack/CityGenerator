import { describe, expect, it } from 'vitest';
import {
  AssistantSession,
  executeTool,
  MemoryHost,
  scriptedClient,
  toolDefinitions,
  TOOL_SCHEMAS,
  strictify,
  costUsd,
  priceFor,
  generateFlavour,
} from '../src/index.js';

describe('tool definitions', () => {
  it('generates strict JSON schemas for every tool', () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(TOOL_SCHEMAS).sort());
    for (const d of defs) {
      expect(d.strict).toBe(true);
      expect(d.input_schema.type).toBe('object');
      expect(d.input_schema.additionalProperties).toBe(false);
      const props = Object.keys((d.input_schema.properties as object) ?? {});
      expect((d.input_schema.required as string[]).sort()).toEqual(props.sort());
      expect(JSON.stringify(d.input_schema)).not.toMatch(/"minimum"|"maxItems"|"\$schema"/);
      expect(d.description.length).toBeGreaterThan(20);
    }
  });
  it('strictify makes optionals nullable', () => {
    const s = strictify({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number', minimum: 1 } },
      required: ['a'],
    });
    expect(s.required).toEqual(['a', 'b']);
    expect((s.properties as Record<string, { type: unknown }>).b!.type).toEqual(['number', 'null']);
  });
});

describe('executeTool', () => {
  it('rejects unknown tools, invalid input and out-of-region geometry without throwing', async () => {
    const host = new MemoryHost();
    expect((await executeTool('nope', {}, host)).isError).toBe(true);
    expect((await executeTool('set_year', { year: 'soon' }, host)).isError).toBe(true);
    const far = await executeTool(
      'draw',
      {
        layer: 'street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [90000, 0],
          ],
        },
      },
      host,
    );
    expect(far.isError).toBe(true);
    expect(far.summary).toMatch(/outside the region/);
    const nan = await executeTool(
      'draw',
      {
        layer: 'street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [null, 5],
          ],
        },
      },
      host,
    );
    expect(nan.isError).toBe(true);
    const wrongShape = await executeTool(
      'draw',
      {
        layer: 'building',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [10, 0],
          ],
        },
      },
      host,
    );
    expect(wrongShape.isError).toBe(true);
    expect(host.historyLength()).toBe(0);
  });

  it('maps tools to commands and records history for inline undo', async () => {
    const host = new MemoryHost();
    const y = await executeTool('set_year', { year: 1890 }, host);
    expect(y.isError).toBe(false);
    expect(y.commands).toEqual([{ type: 'year.set', year: 1890 }]);
    expect(y.historyBefore).toBe(0);
    expect(y.historyAfter).toBe(1);
    expect(host.document().spec.year).toBe(1890);

    const note = await executeTool('annotate', { kind: 'note', x: 10, y: 20, text: 'Ghouls below' }, host);
    expect(note.isError).toBe(false);
    expect(host.document().annotations[0]?.gmOnly).toBe(true);

    const street = await executeTool(
      'draw',
      {
        layer: 'street',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [400, 100],
          ],
        },
        name: 'Pickman Lane',
        kind: 'collector',
      },
      host,
    );
    expect(street.isError).toBe(false);
    const f = host.document().authored.features[0]!;
    expect(f.properties).toMatchObject({ layer: 'street', kind: 'collector', name: 'Pickman Lane' });

    const brush = await executeTool(
      'brush',
      {
        kind: 'raise',
        points: [
          [0, 0],
          [100, 0],
        ],
        radiusM: 120,
        amount: 20,
      },
      host,
    );
    expect(brush.isError).toBe(false);
    expect(host.document().authored.features[1]?.properties).toMatchObject({
      layer: 'terrainEdit',
      op: 'raise',
      amount: 20,
    });

    const zone = await executeTool(
      'brush',
      { kind: 'zone', points: [[0, 0]], radiusM: 200, ward: 'park' },
      host,
    );
    expect(zone.isError).toBe(false);
    expect(host.document().authored.features[2]?.properties).toMatchObject({ layer: 'zone', kind: 'park' });

    const place = await executeTool('place_feature', { type: 'cemetery', settlement: 'city' }, host);
    expect(place.isError).toBe(false);
    expect(host.document().spec.features[0]?.type).toBe('cemetery');

    const rename = await executeTool(
      'name_features',
      { items: [{ id: 'city-port-1', name: 'Innsmouth Wharf' }] },
      host,
    );
    expect(rename.isError).toBe(false);
    const found = await host.findFeatures({ kind: 'facility', name: 'Innsmouth' });
    expect(found[0]?.id).toBe('city-port-1');

    const removed = await executeTool('remove_feature', { id: 'city-gasworks-1' }, host);
    expect(removed.isError).toBe(false);
    expect((await host.findFeatures({ kind: 'facility' })).some((x) => x.id === 'city-gasworks-1')).toBe(
      false,
    );

    const frozen = await executeTool('freeze', { x: 1250, y: -850 }, host);
    expect(frozen.isError).toBe(false);
    expect(
      host
        .document()
        .authored.features.some((x) => x.properties.origin === 'frozen' && x.properties.frozenFrom === 'b-1'),
    ).toBe(true);

    const moved = await executeTool('move_feature', { id: 'city-hospital-1', x: 500, y: 500 }, host);
    expect(moved.isError).toBe(false);
    expect(host.document().overrides.some((o) => o.op === 'pin' && o.target === 'city-hospital-1')).toBe(
      true,
    );

    const added = await executeTool(
      'add_settlement',
      { kind: 'village', x: -3000, y: -3000, population: 400, name: 'Dunwich' },
      host,
    );
    expect(added.isError).toBe(false);
    expect(host.document().spec.settlements[0]?.name).toBe('Dunwich');

    const regen = await executeTool('regenerate', { scope: 'settlement', id: 'city' }, host);
    expect(regen.isError).toBe(false);
    const patched = await executeTool(
      'patch_spec',
      { ops: [{ op: 'replace', path: '/terrain/relief', value: 0.8 }] },
      host,
    );
    expect(patched.isError).toBe(false);
    expect(host.document().spec.terrain.relief).toBe(0.8);
    const before = host.historyLength();
    const undo = await executeTool('undo', {}, host);
    expect(undo.isError).toBe(false);
    expect(host.historyLength()).toBe(before - 1);
    expect(host.document().spec.terrain.relief).toBe(0.4);
  });

  it('answers read tools from the host', async () => {
    const host = new MemoryHost();
    const s = await executeTool('get_settlement_summary', { id: 'city' }, host);
    expect(s.content[0]).toMatchObject({ type: 'text' });
    expect((s.content[0] as { text: string }).text).toContain('New Boston');
    const d = await executeTool('describe_area', { x: 1250, y: -850 }, host);
    expect((d.content[0] as { text: string }).text).toContain('Gilman House');
    const snap = await executeTool('render_snapshot', { bbox: [0, 0, 100, 100] }, host);
    expect(snap.isError).toBe(true);
    const big = await executeTool('render_snapshot', { bbox: [0, 0, 10000, 100] }, host);
    expect(big.summary).toMatch(/6 km/);
  });
});

describe('AssistantSession', () => {
  it('primes with the summary, runs tool rounds, keeps the transcript and costs', async () => {
    const host = new MemoryHost();
    const client = scriptedClient([
      {
        content: [
          { type: 'text', text: 'Moving the region to 1890 and marking the docks.' },
          { type: 'tool_use', id: 'tu1', name: 'set_year', input: { year: 1890 } },
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'annotate',
            input: { kind: 'marker', x: 1900, y: -1400, text: 'Docks' },
          },
        ],
        usage: { inputTokens: 1000, outputTokens: 100 },
      },
      {
        content: [{ type: 'text', text: 'Done: year 1890, marker on the docks.' }],
        usage: { inputTokens: 1200, outputTokens: 20, cacheReadTokens: 800 },
      },
    ]);
    const session = new AssistantSession({ client, host, model: 'claude-opus-5' });
    await session.send('Set the year to 1890 and put a marker on the docks');
    expect(client.remaining()).toBe(0);
    expect(host.document().spec.year).toBe(1890);
    expect(host.document().annotations).toHaveLength(1);
    const kinds = session.transcript.map((t) => t.kind);
    expect(kinds).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    const tools = session.transcript.filter((t) => t.kind === 'tool');
    expect(tools.map((t) => (t.kind === 'tool' ? t.outcome.historyBefore : -1))).toEqual([0, 1]);
    // The first request carries the system prompt with cache control, the tools and the priming summary.
    const first = client.requests[0]!;
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.tools.length).toBe(Object.keys(TOOL_SCHEMAS).length);
    expect((first.messages[0]!.content[0] as { text: string }).text).toContain('New Boston');
    expect(first.thinking).toBe('adaptive');
    // The second request carries tool results for both calls.
    const second = client.requests[1]!;
    const last = second.messages[second.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(session.usage.inputTokens).toBe(2200);
    expect(session.costUsd).toBeCloseTo(
      costUsd(
        { inputTokens: 2200, outputTokens: 120, cacheReadTokens: 800, cacheWriteTokens: 0 },
        priceFor('claude-opus-5'),
      ),
    );
  });

  it('reports invalid keys, network failures and refusals as messages, never throws', async () => {
    const host = new MemoryHost();
    const client = scriptedClient([
      { error: 'auth' },
      { error: 'network' },
      { content: [{ type: 'text', text: 'I cannot help with that.' }], stopReason: 'refusal' },
    ]);
    const session = new AssistantSession({ client, host });
    await session.send('hello');
    await session.send('hello again');
    await session.send('something declined');
    const errors = session.transcript.filter((t) => t.kind === 'error');
    expect(errors.map((e) => (e.kind === 'error' ? e.code : ''))).toEqual(['auth', 'network']);
    expect(session.transcript.some((t) => t.kind === 'notice' && t.text.includes('declined'))).toBe(true);
    expect(session.busy).toBe(false);
    expect(host.historyLength()).toBe(0);
  });

  it('feeds tool errors back to the model and stops at the round limit', async () => {
    const host = new MemoryHost();
    const turns = Array.from({ length: 4 }, (_, i) => ({
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'set_year', input: { year: 'bad' } }],
    }));
    const client = scriptedClient(turns);
    const session = new AssistantSession({ client, host, maxRounds: 2 });
    await session.send('loop');
    const results = client.requests[1]!.messages.at(-1)!.content[0] as {
      is_error?: boolean;
      content: { text: string }[];
    };
    expect(results.is_error).toBe(true);
    expect(results.content[0]!.text).toMatch(/invalid input/);
    expect(session.transcript.some((t) => t.kind === 'notice' && /tool rounds/.test(t.text))).toBe(true);
    expect(client.remaining()).toBe(1);
  });

  it('trims old tool results but keeps the priming summary', async () => {
    const host = new MemoryHost();
    const turns = Array.from({ length: 9 }, (_, i) => ({
      content: [{ type: 'tool_use' as const, id: `t${i}`, name: 'get_region_summary', input: {} }],
    }));
    turns.push({ content: [{ type: 'text', text: 'ok' } as never] });
    const client = scriptedClient(turns);
    const session = new AssistantSession({ client, host, keepToolResults: 3 });
    await session.send('read a lot');
    const msgs = session.apiMessages;
    const results = msgs.flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
    const trimmed = results.filter(
      (r) =>
        r.type === 'tool_result' && r.content[0]?.type === 'text' && r.content[0].text.includes('trimmed'),
    );
    expect(trimmed.length).toBe(9 - 3);
    expect((msgs[0]!.content[0] as { text: string }).text).toContain('Current region summary');
  });

  it('generates structured flavour text', async () => {
    const client = scriptedClient(
      [],
      [
        {
          title: 'The Docks',
          description: 'Fog.',
          hooks: ['a', 'b', 'c'],
          rumours: ['r1', 'r2'],
          npcs: [{ name: 'Obed', role: 'harbourmaster', note: 'gold' }],
        },
      ],
    );
    const r = await generateFlavour(client, {
      subject: 'The Docks',
      year: 1925,
      culture: 'newEngland',
      details: 'port, gasworks',
    });
    expect(r.value.title).toBe('The Docks');
    expect(r.value.npcs[0]!.name).toBe('Obed');
  });
});
