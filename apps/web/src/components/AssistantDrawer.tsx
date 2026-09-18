import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PRICES, type TranscriptItem } from '@citygen/assistant';
import { useApp } from '../store.js';
import { useAssistant } from '../assistant/store.js';
import { forgetKey } from '../assistant/settings.js';
import { useT } from '../i18n/index.js';

const btn =
  'rounded border border-stone-300 bg-white px-2 py-0.5 text-xs hover:bg-stone-100 disabled:opacity-50';

/**
 * The assistant drawer: a conversation with streaming replies, a card per
 * tool call with an inline undo, the session cost, and BYOK settings.
 */
export function AssistantDrawer() {
  const t = useT();
  const {
    session,
    tick,
    settings,
    setSettings,
    send,
    cancel,
    newSession,
    setOpen,
    focus,
    setFocus,
    flavour,
    flavourBusy,
    flavourFor,
  } = useAssistant();
  void tick;
  const stats = useApp((s) => s.stats);
  const jumpTo = useApp((s) => s.jumpTo);
  const historyLength = useApp((s) => s.history.length);
  const [text, setText] = useState('');
  const [showSettings, setShowSettings] = useState(!settings.apiKey);
  const listRef = useRef<HTMLDivElement>(null);
  const transcript = session?.transcript ?? [];
  const busy = session?.busy ?? false;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [tick, transcript.length]);

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    await send(t);
  }

  const cost = session ? session.costUsd : 0;
  const usage = session?.usage;
  const price = DEFAULT_PRICES[settings.model];

  return (
    <aside
      className="flex h-full w-96 shrink-0 flex-col border-l border-stone-300 bg-stone-50 text-sm"
      data-testid="assistant"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <span className="font-semibold">{t('Assistant')}</span>
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => setShowSettings(!showSettings)} aria-pressed={showSettings}>
            {t('Settings')}
          </button>
          <button
            className={btn}
            onClick={() => newSession()}
            disabled={busy}
            title={t('Start a new conversation')}
          >
            {t('New')}
          </button>
          <button
            className="rounded px-1 text-stone-500 hover:bg-stone-100"
            aria-label={t('Close assistant')}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
      </div>

      {showSettings && (
        <div
          className="space-y-2 border-b border-stone-200 bg-white px-3 py-2 text-xs"
          data-testid="assistant-settings"
        >
          <label className="block">
            <span className="text-stone-600">{t('Anthropic API key (bring your own)')}</span>
            <input
              type="password"
              aria-label={t('API key')}
              className="mt-0.5 w-full rounded border border-stone-300 px-1 py-0.5 font-mono"
              value={settings.apiKey}
              placeholder="sk-ant-…"
              onChange={(e) => setSettings({ apiKey: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-stone-600">
            <input
              type="checkbox"
              checked={settings.remember}
              onChange={(e) => setSettings({ remember: e.target.checked })}
            />
            {t('Remember the key in this browser (localStorage). It is only ever sent to api.anthropic.com.')}
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Model')}</span>
              <select
                aria-label={t('Assistant model')}
                className="rounded border border-stone-300 bg-white px-1 py-0.5"
                value={settings.model}
                onChange={(e) => setSettings({ model: e.target.value })}
              >
                <option value="claude-opus-5">Claude Opus 5</option>
                <option value="claude-sonnet-5">Claude Sonnet 5</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Effort')}</span>
              <select
                aria-label={t('Effort')}
                className="rounded border border-stone-300 bg-white px-1 py-0.5"
                value={settings.effort}
                onChange={(e) => setSettings({ effort: e.target.value as never })}
              >
                <option value="">{t('default')}</option>
                <option value="low">{t('low')}</option>
                <option value="medium">{t('medium')}</option>
                <option value="high">{t('high')}</option>
                <option value="max">{t('max')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-stone-600">
              <input
                type="checkbox"
                checked={settings.thinking}
                onChange={(e) => setSettings({ thinking: e.target.checked })}
              />
              {t('thinking')}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-stone-600">{t('Focus')}</span>
              <select
                aria-label={t('Assistant focus')}
                className="rounded border border-stone-300 bg-white px-1 py-0.5"
                value={focus ?? ''}
                onChange={(e) => setFocus(e.target.value || null)}
              >
                <option value="">{t('whole region')}</option>
                {(stats?.settlements ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={btn}
              onClick={() => {
                forgetKey();
                setSettings({ apiKey: '', remember: false });
              }}
            >
              {t('Forget key')}
            </button>
          </div>
          {price && (
            <p className="text-stone-500">
              Estimated prices: ${price.input}/M input, ${price.output}/M output, cache reads at{' '}
              {Math.round(price.cacheRead * 100)}%.
            </p>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
        data-testid="assistant-transcript"
      >
        {!session && (
          <p className="text-xs text-stone-500">
            {t(
              'Ask for changes in plain words: “move the region to 1890”, “add a gasworks by the docks”, “why is the north end poor?”, “rename the port Innsmouth Wharf”. Every change lands in the undo history.',
            )}
          </p>
        )}
        {transcript.map((item) => (
          <TranscriptRow key={item.id} item={item} historyLength={historyLength} jumpTo={jumpTo} />
        ))}
        {flavour && (
          <div
            className="rounded border border-amber-300 bg-amber-50 p-2 text-xs"
            data-testid="assistant-flavour"
          >
            <div className="font-semibold">{flavour.value.title}</div>
            <p className="mt-1">{flavour.value.description}</p>
            {flavour.value.hooks.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {flavour.value.hooks.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            {flavour.value.npcs.length > 0 && (
              <p className="mt-1 text-stone-700">
                {flavour.value.npcs.map((n) => `${n.name} (${n.role}): ${n.note}`).join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-stone-200 bg-white px-3 py-2">
        <div className="flex gap-1">
          <textarea
            aria-label={t('Ask the assistant')}
            className="min-h-[3.5rem] flex-1 resize-y rounded border border-stone-300 px-2 py-1 text-sm"
            placeholder={
              settings.apiKey || useAssistant.getState().clientFactory
                ? 'Ask or instruct…'
                : 'Enter an API key in Settings first'
            }
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <button
              className="rounded border border-stone-800 bg-stone-800 px-2 py-0.5 text-xs text-white hover:bg-stone-700 disabled:opacity-50"
              onClick={() => void submit()}
              disabled={busy || !text.trim()}
            >
              {t('Send')}
            </button>
            {busy ? (
              <button className={btn} onClick={cancel}>
                {t('Stop')}
              </button>
            ) : (
              <button
                className={btn}
                disabled={flavourBusy}
                title={t('Flavour text for the focused settlement on Claude Sonnet 5')}
                onClick={() => {
                  const s = stats?.settlements.find((x) => x.id === focus) ?? stats?.settlements[0];
                  if (!s) return;
                  void flavourFor(
                    s.name ?? s.id,
                    `${s.kind} of ${s.population} people, ${s.districts} districts, ${s.walled ? 'walled' : 'unwalled'}; facilities: ${(
                      stats?.facilities.list ?? []
                    )
                      .filter((f) => f.settlement === s.id)
                      .map((f) => f.name)
                      .join(', ')}`,
                  );
                }}
              >
                {flavourBusy ? '…' : t('Flavour')}
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-stone-500" data-testid="assistant-cost">
          <span>
            {usage
              ? `${usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens} in · ${usage.outputTokens} out`
              : 'no usage yet'}
          </span>
          <span>≈ ${cost.toFixed(4)}</span>
        </div>
      </div>
    </aside>
  );
}

function TranscriptRow({
  item,
  historyLength,
  jumpTo,
}: {
  item: TranscriptItem;
  historyLength: number;
  jumpTo: (n: number) => void;
}) {
  const t = useT();
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded bg-stone-800 px-2 py-1 text-white" data-testid="assistant-user">
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="rounded bg-white px-2 py-1 whitespace-pre-wrap" data-testid="assistant-reply">
          {item.thinking && (
            <details className="mb-1 text-[11px] text-stone-500">
              <summary>{t('thinking')}</summary>
              <div className="whitespace-pre-wrap">{item.thinking}</div>
            </details>
          )}
          {item.text}
          {item.streaming && <span className="animate-pulse">▍</span>}
        </div>
      );
    case 'tool': {
      const o = item.outcome;
      const changed = o.historyAfter > o.historyBefore;
      const undoable = changed && historyLength >= o.historyAfter;
      return (
        <div
          className={`rounded border px-2 py-1 text-xs ${o.isError ? 'border-red-300 bg-red-50' : 'border-stone-300 bg-stone-100'}`}
          data-testid="assistant-tool"
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="font-mono text-[11px] text-stone-500">{o.name}</span>{' '}
              {item.running ? '…' : o.summary}
            </span>
            {undoable && (
              <button
                className={btn}
                onClick={() => jumpTo(o.historyBefore)}
                aria-label={t('Undo {name}', { name: o.name })}
              >
                {t('Undo')}
              </button>
            )}
          </div>
          {o.warnings.length > 0 && <div className="mt-0.5 text-amber-700">{o.warnings.join('; ')}</div>}
        </div>
      );
    }
    case 'error':
      return (
        <div
          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800"
          data-testid="assistant-error"
        >
          {item.message}
        </div>
      );
    case 'notice':
      return (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {item.text}
        </div>
      );
  }
}
