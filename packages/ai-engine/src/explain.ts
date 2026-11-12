import type { Answer } from '@lemma/math-core';
import { runAssistant, type AssistantRunOptions, type AssistantRunResult } from './agent';
import type { ExplanationLevel } from './prompts';
import { answerToToolResult, type ToolExecutor, type ToolResult } from './tools';
import type { AIProvider } from './types';

type Common = Pick<AssistantRunOptions, 'signal' | 'onText' | 'onToolCall' | 'onToolResult' | 'maxSteps' | 'systemExtra'>;

export interface ExplainOptions extends Common {
  provider: AIProvider;
  /** Lets the model compute intermediate steps. Without it, the model explains in words only. */
  tools?: ToolExecutor;
  /** The user's original question, if different from the answer's input. */
  question?: string;
}

/** Asks the model to explain an already-computed result at the given level. */
export function explainResult(answer: Answer | ToolResult, level: ExplanationLevel, opts: ExplainOptions): Promise<AssistantRunResult> {
  const result: ToolResult = 'primary' in answer ? answerToToolResult(answer) : answer;
  const input = 'input' in answer ? answer.input : result.expression;
  const ask = opts.question ?? input;
  const noTools = !opts.tools;
  return runAssistant({
    ...opts,
    level,
    mode: 'explain',
    tools: opts.tools ?? (async () => ({ ok: false, display: '', plain: '', expression: '', notes: [], error: 'No tools available.' })),
    toolSpecs: noTools ? [] : undefined,
    systemExtra: [
      opts.systemExtra,
      noTools ? 'No tools are available for this explanation: explain the method in words and do not introduce any number that is not in the result below.' : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    messages: [
      {
        role: 'user',
        content: `Explain this Lemma result.\nQuestion: ${ask}\nResult (JSON from the engine): ${JSON.stringify(result)}`,
      },
    ],
  });
}

export interface CheckWorkOptions extends Common {
  provider: AIProvider;
  tools: ToolExecutor;
  /** The problem statement. */
  problem: string;
  /** The user's working, one step per line (as typed, dictated or transcribed from a photo). */
  working: string;
  level?: ExplanationLevel;
}

/** "Check my work": verifies each step with tools and reports the first wrong one. */
export function checkWork(opts: CheckWorkOptions): Promise<AssistantRunResult> {
  return runAssistant({
    ...opts,
    level: opts.level ?? 'concise',
    mode: 'check-work',
    maxSteps: opts.maxSteps ?? 12,
    messages: [{ role: 'user', content: `Problem: ${opts.problem}\n\nMy working:\n${opts.working}` }],
  });
}
