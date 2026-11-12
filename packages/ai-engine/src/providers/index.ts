import type { AIProvider } from '../types';
import { AnthropicProvider, type AnthropicOptions } from './anthropic';
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './openai';

export * from './anthropic';
export * from './openai';
export * from './local';
export * from './presets';
export * from './transformers-runtime';

export type ProviderConfig = ({ kind: 'anthropic' } & AnthropicOptions) | ({ kind: 'openai-compatible' } & OpenAICompatibleOptions);

/** Builds a provider from stored settings. */
export function createProvider(config: ProviderConfig): AIProvider {
  if (config.kind === 'anthropic') {
    const { kind: _kind, ...opts } = config;
    return new AnthropicProvider(opts);
  }
  const { kind: _kind, ...opts } = config;
  return new OpenAICompatibleProvider(opts);
}
