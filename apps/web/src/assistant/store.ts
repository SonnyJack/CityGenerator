import { create } from 'zustand';
import {
  anthropicClient,
  AssistantSession,
  generateFlavour,
  type AssistantClient,
  type Flavour,
} from '@citygen/assistant';
import { WebHost } from './host.js';
import { loadSettings, saveSettings, type AssistantSettings } from './settings.js';

/**
 * Assistant UI state: settings, the current session and a tick that bumps
 * whenever the session's transcript changes. Tests can inject a scripted
 * client through `clientFactory`.
 */
export interface AssistantState {
  open: boolean;
  settings: AssistantSettings;
  session: AssistantSession | null;
  tick: number;
  focus: string | null;
  flavour: { subject: string; value: Flavour } | null;
  flavourBusy: boolean;
  clientFactory: ((settings: AssistantSettings) => AssistantClient) | null;

  setOpen(open: boolean): void;
  setSettings(patch: Partial<AssistantSettings>): void;
  setFocus(id: string | null): void;
  setClientFactory(f: AssistantState['clientFactory']): void;
  /** Start (or restart) a conversation with the current settings. */
  newSession(): AssistantSession | null;
  send(text: string): Promise<void>;
  cancel(): void;
  flavourFor(subject: string, details: string): Promise<void>;
}

export const host = new WebHost();

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  settings: loadSettings(),
  session: null,
  tick: 0,
  focus: null,
  flavour: null,
  flavourBusy: false,
  clientFactory: null,

  setOpen: (open) => set({ open }),
  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings, session: null });
  },
  setFocus: (focus) => set({ focus }),
  setClientFactory: (clientFactory) => set({ clientFactory, session: null }),

  newSession() {
    const { settings, clientFactory, focus } = get();
    const client = clientFactory
      ? clientFactory(settings)
      : settings.apiKey
        ? anthropicClient({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
        : null;
    if (!client) return null;
    const session = new AssistantSession({
      client,
      host,
      model: settings.model,
      thinking: settings.thinking ? 'adaptive' : 'off',
      ...(settings.effort ? { effort: settings.effort } : {}),
      focus,
      onChange: () => set((s) => ({ tick: s.tick + 1 })),
    });
    set({ session, tick: 0 });
    return session;
  },

  async send(text) {
    const session = get().session ?? get().newSession();
    if (!session) return;
    await session.send(text);
  },

  cancel() {
    get().session?.cancel();
  },

  async flavourFor(subject, details) {
    const { settings, clientFactory } = get();
    const client = clientFactory
      ? clientFactory(settings)
      : settings.apiKey
        ? anthropicClient({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
        : null;
    if (!client) return;
    set({ flavourBusy: true });
    try {
      const doc = host.document();
      const r = await generateFlavour(client, {
        subject,
        year: doc.spec.year,
        culture: doc.spec.culture,
        details,
      });
      set({ flavour: { subject, value: r.value } });
    } catch (e) {
      set({
        flavour: {
          subject,
          value: {
            title: 'Could not generate',
            description: (e as Error).message,
            hooks: [],
            rumours: [],
            npcs: [],
          },
        },
      });
    } finally {
      set({ flavourBusy: false });
    }
  },
}));
