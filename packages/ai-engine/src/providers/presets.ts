import { AIError } from '../errors';
import { ANTHROPIC_VERSION } from './anthropic';

/**
 * Where a user can run the assistant. Anything that speaks the OpenAI chat-completions API works through
 * `custom`; the named presets just fill in the URL and a sensible default model.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: 'builtin' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  defaultModel: string;
  needsKey: boolean;
  local?: boolean;
  /** Short guidance shown under the picker. */
  hint: string;
  keyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'builtin',
    label: 'Built-in model (free, runs on this device)',
    kind: 'builtin',
    defaultModel: 'onnx-community/Qwen3-0.6B-ONNX', // browsers; the desktop app defaults to Qwen3 1.7B (defaultLocalModel)
    needsKey: false,
    local: true,
    hint: 'Runs privately on your device. No account or key; works offline after a one-time download.',
  },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', defaultModel: 'claude-sonnet-5-5', needsKey: true, hint: 'Best quality. Needs an API key.', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini', needsKey: true, hint: 'Needs an API key.', keyUrl: 'https://platform.openai.com/api-keys' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    needsKey: true,
    hint: 'Has a free tier with a Google AI Studio key.',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (hundreds of models)',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    needsKey: true,
    hint: 'One key for most models. Models ending in “:free” cost nothing.',
    keyUrl: 'https://openrouter.ai/keys',
  },
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', needsKey: true, hint: 'Very fast; has a free tier.', keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', needsKey: true, hint: 'Needs an API key.', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', needsKey: true, hint: 'Needs an API key.', keyUrl: 'https://platform.deepseek.com/api_keys' },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:8b',
    needsKey: false,
    local: true,
    hint: 'Any model you have pulled in Ollama. For the web app, start Ollama with OLLAMA_ORIGINS=* so the browser may connect.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    needsKey: false,
    local: true,
    hint: 'Start the local server in LM Studio (Developer tab) and enable CORS.',
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible URL)',
    kind: 'openai-compatible',
    defaultModel: '',
    needsKey: false,
    hint: 'Any server that speaks the OpenAI chat format.',
  },
];

export const presetById = (id: string): ProviderPreset => PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS.find((p) => p.id === 'custom')!;

/** Lists the models a provider offers (also a connection test). */
export async function listModels(
  preset: ProviderPreset,
  opts: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<string[]> {
  const f = opts.fetch ?? fetch;
  if (preset.kind === 'builtin') return [];
  const anthropic = preset.kind === 'anthropic';
  const base = (opts.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  if (!anthropic && !base) throw new AIError('bad_request', 'Enter the server’s base URL first');
  const url = anthropic ? 'https://api.anthropic.com/v1/models?limit=100' : `${base}/models`;
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': opts.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }
    : opts.apiKey
      ? { authorization: `Bearer ${opts.apiKey}` }
      : {};
  let res: Response;
  try {
    res = await f(url, { headers, signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AIError('aborted', 'Stopped.');
    throw new AIError(
      'network',
      preset.local
        ? `Couldn’t reach ${preset.label.replace(' (local)', '')} at ${base}. Is it running${preset.id === 'ollama' ? ' (with OLLAMA_ORIGINS=* for the web app)' : ' with CORS enabled'}?`
        : `Couldn’t reach ${preset.label}. Check your connection; some providers don’t allow browser requests (try the desktop app).`,
    );
  }
  if (res.status === 401 || res.status === 403) throw new AIError('auth', 'The API key was rejected.', { status: res.status });
  if (!res.ok) throw new AIError('server', `The provider returned ${res.status}.`, { status: res.status });
  const body = (await res.json()) as { data?: { id?: string; name?: string }[]; models?: { id?: string; name?: string }[] };
  const items = body.data ?? body.models ?? [];
  return [...new Set(items.map((m) => m.id ?? m.name ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
