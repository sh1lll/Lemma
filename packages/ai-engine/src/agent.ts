import { abortedError } from './errors';
import { buildSystemPrompt, type AssistantMode, type ExplanationLevel } from './prompts';
import { failureResult, LEMMA_TOOLS, toolResultToModelText, validateToolArgs, type ToolExecutor, type ToolResult } from './tools';
import type { AIProvider, ChatMessage, ContentPart, ToolCallPart, ToolResultPart, ToolSpec } from './types';
import { partsOf } from './types';

/** One tool call and its result: what the UI shows as a "computed by Lemma" chip. */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
  /** 1-based model step that requested the call. */
  step: number;
  durationMs: number;
}

/** A result the user already has on screen (from typing into the calculator), given to the model as context. */
export interface ContextResult {
  input: string;
  result: ToolResult;
}

export type RunStatus = 'done' | 'max_steps' | 'max_tokens' | 'refusal';

export interface AssistantRunOptions {
  provider: AIProvider;
  /** Conversation so far, ending with the new user message. Pass the previous run's `messages` to continue. */
  messages: ChatMessage[];
  /** Host executor for `compute` / `graph`. */
  tools: ToolExecutor;
  level?: ExplanationLevel;
  mode?: AssistantMode;
  /** Appended to the system prompt; keep it stable across a conversation. */
  systemExtra?: string;
  /** Replaces the whole system prompt (advanced; the grounding rules are then your responsibility). */
  system?: string;
  /** Tool definitions offered to the model. Default: compute + graph. */
  toolSpecs?: ToolSpec[];
  /** Recent calculator results to show the model, attached to the new user message. */
  context?: ContextResult[];
  signal?: AbortSignal;
  /** Streams visible assistant text (including any short preamble before tool calls). */
  onText?: (delta: string) => void;
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown>; step: number }) => void;
  onToolResult?: (record: ToolCallRecord) => void;
  /** Model turns allowed (each tool round trip is one). Default 8. */
  maxSteps?: number;
  maxTokens?: number;
}

export interface AssistantRunResult {
  /** The final answer to show / speak. */
  text: string;
  status: RunStatus;
  /** Full history to store and pass back next turn (provider-internal reasoning blocks removed). */
  messages: ChatMessage[];
  /** Only what this run appended (the context-augmented user message replaces the last input message). */
  newMessages: ChatMessage[];
  /** Every tool call and result, in order. */
  toolCalls: ToolCallRecord[];
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

export const MAX_STEPS_MESSAGE =
  "I couldn't finish this within the allowed number of steps. Here is what Lemma computed so far; try asking about one part at a time.";
export const MAX_TOKENS_MESSAGE = 'The answer was cut off before it finished. Try asking for a shorter answer or one part at a time.';
export const REFUSAL_MESSAGE = "I can't help with that request.";
/**
 * Tool calls executed per model turn. A confused model, or text in an image or pasted problem steering it,
 * can ask for hundreds at once; the rest get an error result (every call id still needs an answer).
 */
export const MAX_TOOL_CALLS_PER_STEP = 16;

/**
 * Runs the assistant: model → tool calls → results → model … until the model answers without tools,
 * or `maxSteps` model turns have run. Throws AIError (code 'aborted' when the signal fires).
 */
export async function runAssistant(opts: AssistantRunOptions): Promise<AssistantRunResult> {
  const { provider, signal } = opts;
  const maxSteps = Math.max(1, opts.maxSteps ?? 8);
  const system = opts.system ?? buildSystemPrompt({ level: opts.level, mode: opts.mode, extra: opts.systemExtra });
  const toolSpecs = opts.toolSpecs ?? LEMMA_TOOLS;

  const input = opts.messages.slice();
  const last = input[input.length - 1];
  if (!last || last.role !== 'user') throw new Error('runAssistant: messages must end with a user message.');
  if (opts.context?.length) input[input.length - 1] = withContext(last, opts.context);
  const baseLength = input.length - 1;

  const work: ChatMessage[] = input;
  const records: ToolCallRecord[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let status: RunStatus = 'done';
  let text = '';
  let steps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (signal?.aborted) throw abortedError(provider.id);
    steps = step;
    const resp = await provider.complete({ system, messages: work, tools: toolSpecs, maxTokens: opts.maxTokens }, signal, opts.onText);
    usage.inputTokens += resp.usage?.inputTokens ?? 0;
    usage.outputTokens += resp.usage?.outputTokens ?? 0;

    if (resp.stopReason === 'refusal') {
      // A refusal can cut a tool call off mid-input: never execute that turn's tools.
      work.push(withoutToolCalls(resp.message));
      text = resp.text.trim() || REFUSAL_MESSAGE;
      status = 'refusal';
      break;
    }
    if (resp.stopReason === 'max_tokens') {
      work.push(withoutToolCalls(resp.message));
      text = resp.text.trim() ? `${resp.text.trim()}\n\n${MAX_TOKENS_MESSAGE}` : MAX_TOKENS_MESSAGE;
      status = 'max_tokens';
      break;
    }
    work.push(resp.message);
    if (!resp.toolCalls.length) {
      text = resp.text;
      break;
    }

    const results = await Promise.all(
      resp.toolCalls.map((call, i) =>
        i < MAX_TOOL_CALLS_PER_STEP ? execute(call, step, opts) : skipped(call, step, `Too many tool calls in one turn (limit ${MAX_TOOL_CALLS_PER_STEP}); this one was not run.`),
      ),
    );
    if (signal?.aborted) throw abortedError(provider.id);
    records.push(...results.map((r) => r.record));
    work.push({ role: 'user', content: results.map((r) => r.part) });

    if (step === maxSteps) {
      status = 'max_steps';
      text = MAX_STEPS_MESSAGE;
      // Close the turn so the stored history alternates and the next request is valid.
      work.push({ role: 'assistant', content: [{ type: 'text', text }] });
    }
  }

  const messages = work.map(stripOpaque).filter((m) => partsOf(m).length > 0);
  return {
    text,
    status,
    messages,
    newMessages: messages.slice(baseLength),
    toolCalls: records,
    steps,
    usage,
  };
}

async function execute(call: ToolCallPart, step: number, opts: AssistantRunOptions): Promise<{ record: ToolCallRecord; part: ToolResultPart }> {
  const t0 = Date.now();
  opts.onToolCall?.({ id: call.id, name: call.name, args: call.args, step });
  let result: ToolResult;
  const offered = (opts.toolSpecs ?? LEMMA_TOOLS).some((t) => t.name === call.name);
  const invalid = call.argsError ?? (offered ? validateToolArgs(call.name, call.args) : `Unknown tool "${call.name}". Available tools: ${(opts.toolSpecs ?? LEMMA_TOOLS).map((t) => t.name).join(', ')}.`);
  if (invalid) {
    result = failureResult(invalid);
  } else {
    try {
      result = await opts.tools(call.name, call.args, opts.signal);
    } catch (e) {
      result = failureResult(e instanceof Error ? e.message : String(e));
    }
  }
  const record: ToolCallRecord = { id: call.id, name: call.name, args: call.args, result, step, durationMs: Date.now() - t0 };
  opts.onToolResult?.(record);
  return { record, part: { type: 'tool_result', callId: call.id, name: call.name, content: toolResultToModelText(result), isError: !result.ok } };
}

function skipped(call: ToolCallPart, step: number, why: string): { record: ToolCallRecord; part: ToolResultPart } {
  const result = failureResult(why);
  return {
    record: { id: call.id, name: call.name, args: call.args, result, step, durationMs: 0 },
    part: { type: 'tool_result', callId: call.id, name: call.name, content: toolResultToModelText(result), isError: true },
  };
}

function withContext(m: ChatMessage, context: ContextResult[]): ChatMessage {
  const lines = context.map((c) => `- "${c.input}" → ${toolResultToModelText(c.result)}`);
  const note: ContentPart = {
    type: 'text',
    text: `Recent Lemma results on the user's screen (computed by the engines; quote them exactly if relevant):\n${lines.join('\n')}`,
  };
  return { role: 'user', content: [...partsOf(m), note] };
}

function withoutToolCalls(m: ChatMessage): ChatMessage {
  return { role: m.role, content: partsOf(m).filter((p) => p.type !== 'tool_call') };
}

/**
 * Provider reasoning blocks are only needed inside one tool loop. Dropping them from stored history
 * (deterministically, every turn) keeps later requests valid even if the level, system prompt or provider changes.
 */
function stripOpaque(m: ChatMessage): ChatMessage {
  if (typeof m.content === 'string') return m;
  return { role: m.role, content: m.content.filter((p) => p.type !== 'opaque') };
}
