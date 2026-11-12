import { calculate, createSession, D, MathError, type Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import {
  AIError,
  AnthropicProvider,
  answerToToolResult,
  buildSystemPrompt,
  calcToToolResult,
  checkWork,
  COMPUTE_TOOL,
  EXPLANATION_LEVELS,
  explainResult,
  extractFromImage,
  GROUNDING_RULES,
  OpenAICompatibleProvider,
  outcomeToToolResult,
  parseExtraction,
  resolveOutcome,
  validateToolArgs,
  type OutcomeLike,
} from '../src';
import { anthropicSSE, mockFetch, openaiSSE, sse } from './helpers';

describe('system prompt', () => {
  it('contains the never-compute-yourself rules', () => {
    expect(GROUNDING_RULES).toMatch(/Compute only via tools/);
    expect(GROUNDING_RULES).toMatch(/never do arithmetic yourself/i);
    expect(GROUNDING_RULES).toMatch(/Quote tool results exactly/);
    expect(GROUNDING_RULES).toMatch(/unverified or approximate/);
    expect(GROUNDING_RULES).toMatch(/Ask instead of guessing/);
    expect(GROUNDING_RULES).toMatch(/Never invent data/);
    expect(GROUNDING_RULES).toMatch(/exchange rates/);
  });

  it('every level and mode keeps the rules, and levels differ', () => {
    const prompts = new Set<string>();
    for (const level of EXPLANATION_LEVELS) {
      for (const mode of ['chat', 'check-work', 'explain'] as const) {
        const p = buildSystemPrompt({ level, mode });
        expect(p.startsWith(GROUNDING_RULES)).toBe(true);
        prompts.add(p);
      }
    }
    expect(prompts.size).toBe(EXPLANATION_LEVELS.length * 3);
    expect(buildSystemPrompt({ mode: 'check-work' })).toMatch(/first step that is wrong/);
    expect(buildSystemPrompt({ level: 'detailed' })).toMatch(/its own compute call/);
    expect(buildSystemPrompt({ level: 'concise' })).toBe(buildSystemPrompt({ level: 'concise' }));
  });
});

describe('tools', () => {
  it('compute description teaches phrasings for every domain and one-query-per-calculation chaining', () => {
    const d = COMPUTE_TOOL.description;
    for (const s of ['20% of 450', '50 miles to km', '90 days from today', '3pm new york to london', 'loan at 4.5%', '100 dollars to eur', 'std dev of', 'molar mass of H2O', 'solve x^2 - 5x + 6 = 0', 'integrate', 'is 97 prime', 'One calculation per call', 'plain']) {
      expect(d).toContain(s);
    }
  });

  it('validates arguments', () => {
    expect(validateToolArgs('compute', { query: '2+2' })).toBeNull();
    expect(validateToolArgs('compute', { query: '  ' })).toMatch(/query/);
    expect(validateToolArgs('graph', { expressions: ['x^2'] })).toBeNull();
    expect(validateToolArgs('graph', { expressions: [] })).toMatch(/expressions/);
    expect(validateToolArgs('graph', { expressions: [3] })).toMatch(/expressions/);
    expect(validateToolArgs('rm', {})).toMatch(/Unknown tool/);
  });

  const loan: Answer = {
    ok: true,
    kind: 'loan',
    input: 'monthly payment on a $300,000 loan at 4.5% over 30 years',
    expression: 'Monthly payment · $300,000 at 4.5% for 30 years',
    primary: { display: '$1,520.06', plain: '1520.06', spoken: '1,520 dollars and 6 cents' },
    value: new D('1520.06'),
    lines: [{ label: 'Total interest', display: '$247,220.13' }],
    notes: ['Fixed rate, monthly compounding'],
    exactness: 'exact',
  };

  it('answerToToolResult keeps provenance and drops heavy fields', () => {
    const r = answerToToolResult(loan);
    expect(r).toEqual({
      ok: true,
      kind: 'loan',
      display: '$1,520.06',
      plain: '1520.06',
      expression: loan.expression,
      notes: ['Fixed rate, monthly compounding'],
      lines: [{ label: 'Total interest', display: '$247,220.13' }],
      exactness: 'exact',
    });
    const fx = answerToToolResult({
      ...loan,
      kind: 'currency',
      primary: { display: '€92.10', plain: '92.10', spoken: '' },
      source: { name: 'ECB', url: 'https://example.org', asOf: '2026-10-29', stale: true },
      verified: { ok: true, how: 'round trip' },
    });
    expect(fx.source).toEqual({ name: 'ECB', url: 'https://example.org', asOf: '2026-10-29', stale: true });
    expect(fx.verified).toEqual({ ok: true, how: 'round trip' });
    expect(answerToToolResult({ ok: false, kind: 'loan', input: 'loan', error: new MathError('incomplete', 'What is the interest rate?') })).toMatchObject({ ok: false, error: 'What is the interest rate?' });
  });

  it('calcToToolResult uses the real calculator, including ambiguity and approximation', () => {
    const s = createSession();
    expect(calcToToolResult(calculate('20% of 450', s))).toMatchObject({ ok: true, display: '90', plain: '90', exactness: 'exact' });
    const amb = calcToToolResult(calculate('6/2(1+2)', s));
    expect(amb.notes.join(' ')).toMatch(/Ambiguous/);
    expect(calcToToolResult(calculate('sqrt 2', s))).toMatchObject({ display: '1.41421356237', exactness: 'approximate' });
    expect(calcToToolResult(calculate('1/0', s)).ok).toBe(false);
  });

  it('outcomeToToolResult covers router outcomes; resolveOutcome waits on pending', async () => {
    const conv: OutcomeLike = {
      kind: 'convert',
      result: { ok: true, input: '50 miles to km', expression: '50 mi → km', results: [{ unit: { symbol: 'km' }, formatted: { display: '80.4672', plain: '80.4672', rounded: false } }], notes: [] },
    };
    expect(outcomeToToolResult(conv)).toMatchObject({ ok: true, display: '80.4672 km', exactness: 'exact' });
    expect(outcomeToToolResult({ kind: 'graph', input: 'graph x^2' })).toMatchObject({ ok: true, kind: 'graph' });
    expect(outcomeToToolResult({ kind: 'error', error: new MathError('syntax', 'Bad input') }, 'x')).toMatchObject({ ok: false, error: 'Bad input' });

    let loaded = false;
    const run = (): OutcomeLike =>
      loaded ? { kind: 'answer', result: loan } : { kind: 'pending', waitFor: Promise.resolve().then(() => void (loaded = true)) };
    expect(await resolveOutcome(run, 'q')).toMatchObject({ ok: true, display: '$1,520.06' });
    const never = await resolveOutcome(() => ({ kind: 'pending', waitFor: Promise.reject(new Error('offline, no cached rates')) }), 'q');
    expect(never).toMatchObject({ ok: false, error: 'offline, no cached rates' });
  });
});

describe('extractFromImage', () => {
  const reply = (text: string) => sse(anthropicSSE({ text }));

  it('sends the image without solving and parses the problems', async () => {
    const json = JSON.stringify({
      problems: [
        { query: 'solve 2x + 3 = 7', latex: '2x + 3 = 7', description: 'Q1 linear equation' },
        { query: 'derivative of x^2 sin(x)', latex: '\\frac{d}{dx} x^2 \\sin x', description: 'Q2 derivative' },
      ],
      note: '',
    });
    const m = mockFetch([reply('```json\n' + json + '\n```')]);
    const p = new AnthropicProvider({ apiKey: 'k', fetch: m.fetch });
    const r = await extractFromImage(p, 'data:image/jpeg;base64,/9j/4AAQ\nSkZJRg==', 'image/jpeg');
    expect(r.noMathFound).toBe(false);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toEqual({ query: 'solve 2x + 3 = 7', latex: '2x + 3 = 7', description: 'Q1 linear equation' });
    const body = m.requests[0]!.body;
    expect(body).not.toHaveProperty('tools');
    const content = (body.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } });
    expect(String(content[1]!.text)).toMatch(/Do NOT solve/);
  });

  it('handles "no math found"', async () => {
    const m = mockFetch([reply('{"problems": [], "note": "The photo shows a cat; there is no maths in it."}')]);
    const r = await extractFromImage(new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }), 'AAAA', 'image/png');
    expect(r).toEqual({ problems: [], noMathFound: true, note: 'The photo shows a cat; there is no maths in it.' });
    expect(parseExtraction('There is no math in this image.')).toMatchObject({ noMathFound: true });
  });

  it('works through an OpenAI-compatible vision model', async () => {
    const m = mockFetch([sse(openaiSSE({ text: 'Here you go: {"problems":[{"query":"mean of 3, 5, 7","latex":"\\\\bar{x}","description":"mean"}]}' }))]);
    const r = await extractFromImage(new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-test', fetch: m.fetch }), 'AAAA', 'image/png');
    expect(r.problems[0]!.query).toBe('mean of 3, 5, 7');
    const content = (m.requests[0]!.body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0]!.content;
    expect(content[0]!.image_url!.url).toBe('data:image/png;base64,AAAA');
  });

  it('rejects unreadable replies and unsupported image types', async () => {
    expect(() => parseExtraction('I think the answer is 4.')).toThrow(AIError);
    await expect(extractFromImage(new AnthropicProvider({ apiKey: 'k', fetch: mockFetch([]).fetch }), 'AAAA', 'image/tiff')).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('explainResult and checkWork', () => {
  it('explainResult sends the computed answer and can call tools for intermediate steps', async () => {
    const m = mockFetch([
      sse(anthropicSSE({ toolUses: [{ id: 't1', name: 'compute', input: { query: '0.045 / 12' } }] })),
      sse(anthropicSSE({ text: 'The monthly rate is 0.00375, so the payment is $1,520.06.' })),
    ]);
    const answer: Answer = {
      ok: true,
      kind: 'loan',
      input: 'monthly payment on a $300,000 loan at 4.5% over 30 years',
      expression: 'Monthly payment',
      primary: { display: '$1,520.06', plain: '1520.06', spoken: '' },
      notes: [],
    };
    const r = await explainResult(answer, 'detailed', {
      provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }),
      tools: async () => ({ ok: true, display: '0.00375', plain: '0.00375', expression: '0.045 / 12', notes: [] }),
    });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.text).toContain('$1,520.06');
    const body = m.requests[0]!.body;
    expect(String(body.system)).toMatch(/explain a result Lemma has already computed/);
    expect(String(body.system)).toMatch(/Style: detailed/);
    expect(JSON.stringify(body.messages)).toContain('$1,520.06');
  });

  it('explainResult without tools offers none and says so', async () => {
    const m = mockFetch([sse(anthropicSSE({ text: 'It uses the annuity formula.' }))]);
    await explainResult({ ok: true, display: '90', plain: '90', expression: '20% of 450', notes: [] }, 'beginner', { provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }) });
    expect(m.requests[0]!.body).not.toHaveProperty('tools');
    expect(String(m.requests[0]!.body.system)).toMatch(/No tools are available/);
  });

  it('checkWork uses the check-work prompt and sends the working', async () => {
    const m = mockFetch([
      sse(anthropicSSE({ toolUses: [{ id: 'a', name: 'compute', input: { query: 'solve 2x + 3 = 7' } }] })),
      sse(anthropicSSE({ text: 'Step 2 is wrong: you wrote x = 5, Lemma got x = 2.' })),
    ]);
    const r = await checkWork({
      provider: new AnthropicProvider({ apiKey: 'k', fetch: m.fetch }),
      tools: async () => ({ ok: true, display: 'x = 2', plain: 'x = 2', expression: 'solve 2x + 3 = 7', notes: [], verified: { ok: true, how: 'substitution' } }),
      problem: 'Solve 2x + 3 = 7',
      working: '2x = 10\nx = 5',
    });
    expect(r.text).toMatch(/Step 2 is wrong/);
    expect(String(m.requests[0]!.body.system)).toMatch(/check the user's working/);
    expect(JSON.stringify(m.requests[0]!.body.messages)).toContain('2x = 10');
  });
});
