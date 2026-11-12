import type { AngleMode } from '@lemma/math-core';

export interface Settings {
  angle: AngleMode;
  digits: number;
  grouping: boolean;
  speakResults: boolean;
  voiceLang: string;
  speechRate: number;
  continuousListening: boolean;
  /** auto: browser recognition where it works, on-device Whisper elsewhere (Firefox, desktop app). */
  voiceEngine: 'auto' | 'browser' | 'whisper';
  preferOnDevice: boolean;
  /** How long voice waits after the speaker stops before using the phrase (see patience.ts). */
  voicePatience: 'short' | 'normal' | 'long';
  /** Symbol for money answers when the question names no currency. */
  currency: string;
  /** Fetch exchange rates from the ECB (via Frankfurter) when a currency question needs them. */
  liveRates: boolean;
  theme: 'system' | 'light' | 'dark';
  look: import('./look').LookId;
  /** '' uses the look's own accent. */
  accent: string;
  font: 'rounded' | 'sans' | 'serif' | 'mono';
  textSize: 's' | 'm' | 'l' | 'xl';
  density: 'cozy' | 'compact';
  corners: 'round' | 'soft' | 'square';
  motion: 'full' | 'calm';
  /** Kinds of motion that can be switched off one by one while Motion is Normal (see motion.ts). */
  motionAnswers: boolean;
  motionPanels: boolean;
  motionContent: boolean;
  motionFeedback: boolean;
  motionPress: boolean;
  motionMic: boolean;
  /** Timing, engine notes and other fine print under results. Off keeps the screen calm. */
  showDetails: boolean;
  /** How worked solutions read: one step per line (and the steps open), or the compact one-line summary. */
  working: 'lines' | 'inline';
  /** The “Ask anything… try …” example text in the empty input. */
  inputHints: boolean;
  /** Optional AI layer. Off until the user configures a provider. */
  aiEnabled: boolean;
  /** Provider preset id (see ai-engine PROVIDER_PRESETS): 'builtin', 'anthropic', 'openai', 'ollama', 'custom', … */
  aiProvider: string;
  /** Chosen model and base-URL override per provider, so switching providers keeps each one's setup. */
  aiModels: Record<string, string>;
  aiBaseUrls: Record<string, string>;
  aiLevel: 'answer-only' | 'concise' | 'detailed' | 'beginner' | 'advanced';
  /** Offer the assistant when the calculator can't understand an input. */
  aiFallback: boolean;
  showKeypad: boolean;
  /** Basic (simple keypad), Scientific (math keyboard), Graphing (expression rows beside a graph) or Matrix. */
  calcMode: 'basic' | 'scientific' | 'graphing' | 'matrix';
  keepHistory: boolean;
  /** Load every engine and tool (and an offline copy) at start-up, so nothing waits on first use. */
  warmOnStart: boolean;
  /** Include the on-device voice model / AI model when loading everything. */
  warmVoice: boolean;
  warmAi: boolean;
}

export interface HistoryEntry {
  id: string;
  input: string;
  expression: string;
  display: string;
  plain: string;
  /** Extra lines for multi-target conversions. */
  extra?: string[];
  approximate?: boolean;
  pinned?: boolean;
  at: number;
}

export interface StoredTimer {
  id: string;
  label: string;
  endsAt: number;
  seconds: number;
}

const KEYS = {
  settings: 'lemma.settings.v1',
  history: 'lemma.history.v1',
  vars: 'lemma.vars.v1',
  fns: 'lemma.formulas.v1',
  rates: 'lemma.rates.v1',
  timers: 'lemma.timers.v1',
} as const;
const HISTORY_LIMIT = 300;

export const defaultSettings = (): Settings => ({
  angle: 'deg',
  digits: 12,
  grouping: true,
  speakResults: false,
  voiceLang: navigator.language || 'en-US',
  speechRate: 1.1,
  continuousListening: false,
  voiceEngine: 'auto',
  preferOnDevice: true,
  voicePatience: 'normal',
  currency: '$',
  liveRates: true,
  theme: 'system',
  look: 'comfy',
  accent: '',
  font: 'rounded',
  textSize: 'm',
  density: 'cozy',
  corners: 'round',
  motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'calm' : 'full',
  motionAnswers: true,
  motionPanels: true,
  motionContent: true,
  motionFeedback: true,
  motionPress: true,
  motionMic: true,
  showDetails: false,
  inputHints: true,
  working: 'lines',
  aiEnabled: false,
  aiProvider: 'builtin',
  aiModels: {},
  aiBaseUrls: {},
  aiLevel: 'concise',
  aiFallback: true,
  showKeypad: matchMedia('(pointer: coarse)').matches,
  calcMode: 'basic',
  keepHistory: true,
  warmOnStart: true,
  warmVoice: false,
  warmAi: false,
});

// Storage can be unavailable (private mode, blocked site data); the app must work without it.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or access errors only cost persistence.
  }
}

const RETIRED_LOCAL_MODELS = ['onnx-community/Qwen3-1.7B-ONNX'];

export const loadSettings = (): Settings => {
  const stored = read<Partial<Settings> & { aiModel?: string; aiBaseUrl?: string }>(KEYS.settings) ?? {};
  // Migrate the single-provider settings of earlier versions.
  if (stored.aiProvider === 'openai-compatible') stored.aiProvider = 'custom';
  if (stored.aiModel && !stored.aiModels) stored.aiModels = { [stored.aiProvider ?? 'anthropic']: stored.aiModel };
  if (stored.aiBaseUrl && !stored.aiBaseUrls) stored.aiBaseUrls = { custom: stored.aiBaseUrl };
  delete stored.aiModel;
  delete stored.aiBaseUrl;
  // An earlier desktop default that turned out too big to load there: back to the built-in default.
  if (stored.aiModels?.builtin && RETIRED_LOCAL_MODELS.includes(stored.aiModels.builtin)) delete stored.aiModels.builtin;
  return { ...defaultSettings(), ...stored };
};
export const saveSettings = (s: Settings) => write(KEYS.settings, s);

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(KEYS.history) ?? [];
// Pinned entries are never trimmed.
export const saveHistory = (h: HistoryEntry[]) => {
  let unpinned = 0;
  write(KEYS.history, h.filter((e) => e.pinned || ++unpinned <= HISTORY_LIMIT));
};

export const loadVars = (): Record<string, string> => read<Record<string, string>>(KEYS.vars) ?? {};
export const saveVars = (v: Record<string, string>) => write(KEYS.vars, v);

// API keys are kept apart from settings (never part of an exported settings object), one per provider.
const AI_KEYS = 'lemma.ai-keys.v1';
const LEGACY_AI_KEY = 'lemma.ai-key.v1';
const sessionKeys: Record<string, string> = {};
function readKeys(): Record<string, string> {
  try {
    const keys = JSON.parse(localStorage.getItem(AI_KEYS) ?? '{}') as Record<string, string>;
    const legacy = localStorage.getItem(LEGACY_AI_KEY);
    if (legacy && !keys.anthropic) {
      keys.anthropic = legacy;
      localStorage.setItem(AI_KEYS, JSON.stringify(keys));
      localStorage.removeItem(LEGACY_AI_KEY);
    }
    return keys;
  } catch {
    return sessionKeys;
  }
}
export const loadAiKey = (provider: string): string => readKeys()[provider] ?? '';
export const saveAiKey = (provider: string, k: string) => {
  const keys = readKeys();
  if (k) keys[provider] = k;
  else delete keys[provider];
  try {
    localStorage.setItem(AI_KEYS, JSON.stringify(keys));
  } catch {
    Object.assign(sessionKeys, keys); // Without storage the key lasts for this session only.
  }
};

export const loadFormulas = (): string[] => read<string[]>(KEYS.fns) ?? [];
export const saveFormulas = (f: string[]) => write(KEYS.fns, f);

export const loadRates = <T>(): T | null => read<T>(KEYS.rates);
export const saveRates = (r: unknown) => write(KEYS.rates, r);

export const loadTimers = (): StoredTimer[] => (read<StoredTimer[]>(KEYS.timers) ?? []).filter((t) => t.endsAt > Date.now() - 60_000);
export const saveTimers = (t: StoredTimer[]) => write(KEYS.timers, t);
