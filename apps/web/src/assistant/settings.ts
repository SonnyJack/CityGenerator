/**
 * Assistant settings. The API key is bring-your-own; it is kept in memory
 * and, only if the user opts in, in localStorage. It is never written to the
 * document, the URL or anywhere but the Anthropic API.
 */
export interface AssistantSettings {
  apiKey: string;
  remember: boolean;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | '';
  thinking: boolean;
}

const KEY = 'citygen.assistant';

export const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
  remember: false,
  model: 'claude-opus-5',
  effort: '',
  thinking: true,
};

export function loadSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, remember: true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AssistantSettings): void {
  try {
    if (s.remember) localStorage.setItem(KEY, JSON.stringify(s));
    else {
      // Keep the non-secret preferences, drop the key.
      const { apiKey: _k, ...rest } = s;
      localStorage.setItem(KEY, JSON.stringify({ ...rest, apiKey: '' }));
    }
  } catch {
    /* storage may be unavailable */
  }
}

export function forgetKey(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    localStorage.setItem(KEY, JSON.stringify({ ...parsed, apiKey: '', remember: false }));
  } catch {
    /* ignore */
  }
}
