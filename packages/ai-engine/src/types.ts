/**
 * Provider-neutral chat format. Every provider converts to and from these shapes, so the agent loop,
 * history storage and UI never see a vendor wire format.
 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  mediaType: ImageMediaType;
  /** Base64 without a `data:` prefix and without newlines. */
  data: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Set when the model's argument JSON could not be parsed (streamed input can be cut off or malformed).
   * The agent never executes such a call; it returns an error result so the model can retry.
   */
  argsError?: string;
}

export interface ToolResultPart {
  type: 'tool_result';
  callId: string;
  /** Tool name, kept for providers and UIs that need it (not sent to Anthropic). */
  name?: string;
  /** JSON (or plain text) handed to the model. */
  content: string;
  isError?: boolean;
}

/**
 * A provider-internal block the same provider needs back unchanged inside one tool loop
 * (Anthropic `thinking` / `redacted_thinking`). Other providers drop it.
 */
export interface OpaquePart {
  type: 'opaque';
  provider: string;
  raw: unknown;
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart | OpaquePart;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/** JSON Schema subset used for tool parameters. */
export interface JSONSchema {
  type: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  additionalProperties?: boolean;
  minItems?: number;
  maxItems?: number;
  enum?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Upper bound on generated tokens. Providers choose a default when omitted. */
  maxTokens?: number;
}

export type StopReason = 'end' | 'tool_calls' | 'max_tokens' | 'refusal' | 'other';

export interface ChatResponse {
  /** The assistant turn, ready to append to history. */
  message: ChatMessage & { role: 'assistant'; content: ContentPart[] };
  /** Concatenated visible text. */
  text: string;
  toolCalls: ToolCallPart[];
  stopReason: StopReason;
  /** Raw provider stop reason, for logs. */
  rawStopReason?: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AIProvider {
  /** "anthropic", "openai-compatible", … */
  readonly id: string;
  /** Model id in use, for display. */
  readonly model: string;
  complete(req: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void): Promise<ChatResponse>;
}

export function partsOf(m: ChatMessage): ContentPart[] {
  return typeof m.content === 'string' ? (m.content ? [{ type: 'text', text: m.content }] : []) : m.content;
}

export function textOf(m: ChatMessage): string {
  return partsOf(m)
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
