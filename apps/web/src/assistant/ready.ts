import type { Settings } from '../storage';
import { loadAiKey } from '../storage';

// Providers that need a key before they can answer (see ai-engine PROVIDER_PRESETS). Mirrors main.ts aiReady().
const KEYED = new Set(['anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'mistral', 'deepseek']);

/** True when the optional AI assistant is switched on and configured. */
export function aiReady(settings: Settings): boolean {
  if (!settings.aiEnabled) return false;
  if (KEYED.has(settings.aiProvider)) return loadAiKey(settings.aiProvider).length > 8;
  if (settings.aiProvider === 'custom') return !!settings.aiBaseUrls.custom;
  return true;
}
