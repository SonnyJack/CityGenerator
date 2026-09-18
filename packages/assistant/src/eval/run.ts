import type { AssistantClient } from '../client.js';
import { scriptedClient } from '../client.js';
import { MemoryHost } from '../memoryHost.js';
import { AssistantSession } from '../session.js';
import type { EvalCase, EvalResult, Recording } from './types.js';

function pointer(doc: unknown, path: string): unknown {
  let cur: unknown = doc;
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = key === '-' ? cur[cur.length - 1] : cur[Number(key)];
    else cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Run one case against a client (scripted for CI, real for live runs) and check its expectations. */
export async function runCase(
  c: EvalCase,
  client: AssistantClient,
  options: { model?: string } = {},
): Promise<EvalResult> {
  const host = new MemoryHost();
  const session = new AssistantSession({
    client,
    host,
    ...(options.model ? { model: options.model } : {}),
    thinking: 'off',
  });
  await session.send(c.prompt);
  const failures: string[] = [];
  const toolItems = session.transcript.filter((t) => t.kind === 'tool');
  const outcomes = toolItems.map((t) => (t.kind === 'tool' ? t.outcome : null)).filter((o) => o !== null);
  const okTools = outcomes.filter((o) => !o.isError).map((o) => o.name as string);
  const answer =
    session.transcript
      .filter((t) => t.kind === 'assistant')
      .map((t) => (t.kind === 'assistant' ? t.text : ''))
      .filter(Boolean)
      .at(-1) ?? '';
  for (const e of session.transcript) if (e.kind === 'error') failures.push(`error: ${e.message}`);
  if (!c.allowErrors)
    for (const o of outcomes) if (o.isError) failures.push(`tool ${o.name} failed: ${o.summary}`);
  for (const t of c.tools)
    if (!okTools.includes(t)) failures.push(`expected tool ${t}, got [${okTools.join(', ')}]`);
  if (c.readOnly && host.historyLength() > 0)
    failures.push(`document changed (${host.historyLength()} commands) on a read-only request`);
  const doc = host.document();
  for (const check of c.doc ?? []) {
    const v = pointer(doc, check.path);
    if ('equals' in check && JSON.stringify(v) !== JSON.stringify(check.equals))
      failures.push(`${check.path} = ${JSON.stringify(v)}, expected ${JSON.stringify(check.equals)}`);
    if (check.matches && !new RegExp(check.matches, 'i').test(String(v)))
      failures.push(`${check.path} = ${JSON.stringify(v)} does not match /${check.matches}/`);
    if (check.length !== undefined && (!Array.isArray(v) || v.length !== check.length))
      failures.push(
        `${check.path} has length ${Array.isArray(v) ? v.length : 'n/a'}, expected ${check.length}`,
      );
    if (check.exists !== undefined && (v !== undefined) !== check.exists)
      failures.push(`${check.path} ${check.exists ? 'missing' : 'present'}`);
  }
  for (const r of c.resultIncludes ?? []) {
    const hit = outcomes.some(
      (o) =>
        o.name === r.tool &&
        !o.isError &&
        o.content.some((b) => b.type === 'text' && b.text.includes(r.text)),
    );
    if (!hit) failures.push(`no ${r.tool} result containing "${r.text}"`);
  }
  for (const s of c.answerIncludes ?? [])
    if (!answer.toLowerCase().includes(s.toLowerCase()))
      failures.push(`answer lacks "${s}": ${answer.slice(0, 120)}`);
  return { id: c.id, ok: failures.length === 0, failures, tools: okTools, answer };
}

export async function runRecorded(cases: EvalCase[], recording: Recording): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  for (const c of cases) {
    const turns = recording[c.id];
    if (!turns) {
      out.push({ id: c.id, ok: false, failures: ['no recording'], tools: [], answer: '' });
      continue;
    }
    const client = scriptedClient(turns);
    const r = await runCase(c, client);
    if (client.remaining() > 0) {
      r.failures.push(`${client.remaining()} recorded turn(s) unused`);
      r.ok = false;
    }
    out.push(r);
  }
  return out;
}
