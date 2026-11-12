import { print, type Node } from './ast';
import type { AngleMode } from './builtins';
import { D, type Dec } from './decimal';
import { MathError } from './errors';
import { evaluate, type Scope, type UserFunction } from './evaluate';
import { formatNumber, toFraction, type FormatOptions, type Formatted } from './format';
import { lex, type Token } from './lexer';
import { delatex, normalize, splitChain, type NormalizeOptions } from './natural';
import { parse, type ParseOptions } from './parser';

export { D, MathError, formatNumber, toFraction, normalize, delatex, splitChain, lex, parse, evaluate, print };
export type { AngleMode, Dec, Formatted, FormatOptions, Node, Scope, UserFunction };
export * from './answer';
export { compileFloat, freeNames, gamma, type FloatEnv, type FloatFn } from './float';
export { splitLetterProducts } from './implicit';
export type { MathErrorCode } from './errors';

export interface Session {
  angle: AngleMode;
  ans: Dec | null;
  base: Dec | null;
  vars: Map<string, Dec>;
  fns: Map<string, UserFunction>;
}

export function createSession(): Session {
  return { angle: 'deg', ans: null, base: null, vars: new Map(), fns: new Map() };
}

export interface CalcOptions extends NormalizeOptions {
  format?: FormatOptions;
}

export interface Alternative {
  label: string;
  expression: string;
  value: Dec;
  formatted: Formatted;
}

export interface CalcSuccess {
  ok: true;
  input: string;
  /** Fully explicit form of what was calculated, e.g. "20% of 450 + 30". */
  expression: string;
  value: Dec;
  formatted: Formatted;
  /** Exact fraction when the result is rational and not an integer. */
  fraction?: string;
  /** The display is rounded (irrational result or more digits than shown). */
  approximate: boolean;
  notes: string[];
  /** Other plausible readings of ambiguous input, each with its own result. */
  alternatives: Alternative[];
  assignment?: string;
  /** Several assignments in one input ("a = 3, b = 4"), applied in order by {@link commit}. */
  assignments?: { name: string; value: Dec }[];
  /** Set when the input defined a formula instead of computing a value. */
  definition?: { name: string; params: string[]; body: Node; source: string };
  base: Dec | null;
}

export interface CalcFailure {
  ok: false;
  input: string;
  error: MathError;
}

export type CalcResult = CalcSuccess | CalcFailure;

/**
 * The one entry point for deterministic calculation. Pure: it reads the session but never mutates it,
 * so it is safe to call on every keystroke for live preview. Call {@link commit} to make a result "the answer".
 */
export function calculate(input: string, session: Session, opts: CalcOptions = {}): CalcResult {
  const multi = opts.decimalSeparator === ',' ? null : multiAssign(input, session, opts);
  if (multi) return multi;
  try {
    const norm = normalize(input, { ...opts, hasPrevious: session.ans !== null });
    const tokens = lex(norm.text);
    // ".." or "?!" typed on its own: something was typed, it just isn't a calculation. (A lone "." is a number
    // being started, so it stays quiet.)
    if (!tokens.length && input.trim().length >= 2) throw new MathError('syntax', `“${input.trim().slice(0, 20)}” isn’t something to calculate`);
    const userFunctions = new Set(session.fns.keys());
    const { ast, flags } = parse(tokens, { userFunctions });
    // "solve g(x) = 0" asks a question about g; it must never redefine it.
    if ((ast.type === 'define' || ast.type === 'assign') && /^\s*(?:solve|find|roots?\s+of|zeros?\s+of|when)\b/i.test(input)) {
      throw new MathError('syntax', 'That’s an equation to solve, not a definition');
    }
    if (ast.type === 'define') {
      const source = print(ast);
      return {
        ok: true,
        input,
        expression: source,
        value: new D(0),
        formatted: { display: `${ast.name}(${ast.params.join(', ')})`, plain: source, spoken: `saved formula ${ast.name}`, rounded: false },
        approximate: false,
        notes: [`Saved formula. Use it like ${ast.name}(${ast.params.map(() => '…').join(', ')}).`],
        alternatives: [],
        definition: { name: ast.name, params: ast.params, body: ast.body, source },
        base: null,
      };
    }
    const out = evaluate(ast, session);
    let formatted = formatNumber(out.value, opts.format);
    // "asin(0.5)" in degrees is an angle: 30°, not a bare 30.
    if (session.angle === 'deg' && ast.type === 'call' && /^(?:a(?:sin|cos|tan|cot|sec|csc)|atan2)$/.test(ast.name) && !/[e×]/.test(formatted.display)) {
      formatted = { ...formatted, display: `${formatted.display}°`, spoken: `${formatted.spoken} degrees` };
    }
    // "20% off $80" is $64.00: an amount of money stays money (one currency, not a ratio of two amounts).
    const currency = ast.type === 'assign' ? null : moneyOf(input);
    if (currency) formatted = formatMoney(out.value, currency, formatted) ?? formatted;
    const notes = [...norm.notes, ...out.notes];
    if (flags.autoClosedParens) notes.push(`Closed ${flags.autoClosedParens} missing parenthes${flags.autoClosedParens > 1 ? 'es' : 'is'}`);

    const candidates: { label: string; run: () => Node }[] = norm.alternatives.map((a) => ({
      label: a.label,
      run: () => parse(lex(a.text), { userFunctions }).ast,
    }));
    const grouped = groupAfterOf(tokens);
    if (grouped) candidates.push({ label: 'percentage of the whole sum', run: () => parse(grouped, { userFunctions }).ast });
    if (flags.implicitAfterDivision) candidates.push({ label: 'implied multiplication first', run: () => parse(tokens, { implicitBindsTighter: true, userFunctions }).ast });
    if (flags.negatedPower) candidates.push({ label: 'negative number raised to the power', run: () => parse(tokens, { negationBindsTighter: true, userFunctions } satisfies ParseOptions).ast });

    const alternatives: Alternative[] = [];
    for (const c of candidates) {
      try {
        const altAst = c.run();
        const v = evaluate(altAst, session).value;
        if (v.eq(out.value) || alternatives.some((a) => a.value.eq(v))) continue;
        alternatives.push({ label: c.label, expression: print(altAst), value: v, formatted: formatNumber(v, opts.format) });
      } catch {
        // An alternative reading that fails to evaluate is simply not offered.
      }
    }

    return {
      ok: true,
      input,
      expression: print(ast),
      value: out.value,
      formatted,
      fraction: currency ? undefined : out.exact ? exactFraction(out.exact) : out.rational ? toFraction(out.value) : undefined,
      approximate: formatted.rounded,
      notes,
      alternatives,
      assignment: ast.type === 'assign' ? ast.name : undefined,
      base: out.base,
    };
  } catch (e) {
    if (e instanceof MathError) return { ok: false, input, error: e };
    // Thousands of nested brackets run the parser out of stack: say so in words, not as an engine error.
    if (e instanceof RangeError && /call stack/i.test(e.message)) return { ok: false, input, error: new MathError('syntax', 'Too many nested brackets to work out') };
    // decimal.js throws plain Errors for some invalid operations; keep failures isolated and typed.
    return { ok: false, input, error: new MathError('domain', e instanceof Error ? e.message : String(e)) };
  }
}

const ASSIGN_PART = /^\s*[a-zA-Z]\w*\s*(?:=|:=|←)\s*\S/;

/** "a = 3, b = 4" / "x = 2; y = x + 1" / "p = 1 and q = 2": every part an assignment, evaluated in order. */
function multiAssign(input: string, session: Session, opts: CalcOptions): CalcResult | null {
  if (!/[,;]|\band\b/.test(input) || !/=|←/.test(input)) return null;
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth === 0 && (c === ',' || c === ';' || input.startsWith(' and ', i))) {
      parts.push(cur);
      cur = '';
      if (input.startsWith(' and ', i)) i += 4;
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  if (parts.length < 2 || !parts.every((p) => ASSIGN_PART.test(p))) return null;
  const local: Session = { ...session, vars: new Map(session.vars) };
  const assignments: { name: string; value: Dec }[] = [];
  let last: CalcSuccess | null = null;
  for (const p of parts) {
    const r = calculate(p.trim(), local, opts);
    if (!r.ok) return r;
    if (!r.assignment) return null;
    local.vars.set(r.assignment, r.value);
    assignments.push({ name: r.assignment, value: r.value });
    last = r;
  }
  const display = assignments.map((a) => `${a.name} = ${formatNumber(a.value, opts.format).display}`).join(', ');
  return {
    ...last!,
    input,
    expression: assignments.map((a) => `${a.name} = ${a.value.toString()}`).join('; '),
    formatted: { display, plain: display, spoken: display.replace(/,/g, ' and'), rounded: false },
    assignment: undefined,
    assignments,
    alternatives: [],
    fraction: undefined,
  };
}

/** The one currency symbol written on amounts in the input ("$80", "€ 12.50"), or null (none, several, or a ratio). */
function moneyOf(input: string): string | null {
  const syms = new Set([...input.matchAll(/([$€£¥₹])\s?[\d.]/g)].map((m) => m[1]!));
  if (syms.size !== 1) return null;
  // "$80 / $20" and "$12 per kg" are ratios or rates, not amounts of money.
  if ((input.match(/[$€£¥₹]\s?[\d.]/g)?.length ?? 0) > 1 && /[/÷]/.test(input)) return null;
  if (/\bper\b|[/÷]\s*[a-z]/i.test(input)) return null;
  return [...syms][0]!;
}

/** Money to the cent (yen to the unit), half away from zero as tills and banks do. Null when it would hide the value. */
function formatMoney(v: Dec, sym: string, number: Formatted): Formatted | null {
  const places = sym === '¥' ? 0 : 2;
  if (v.abs().gte(1e15) || (!v.isZero() && v.abs().lt(places ? 0.005 : 0.5))) return null;
  const fixed = v.abs().toFixed(places, D.ROUND_HALF_UP);
  const [i, f] = fixed.split('.');
  const neg = v.isNegative() && !/^0(?:\.0+)?$/.test(fixed);
  const body = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
  const words: Record<string, string> = { $: 'dollars', '€': 'euros', '£': 'pounds', '¥': 'yen', '₹': 'rupees' };
  return {
    display: `${neg ? '−' : ''}${sym}${body}`,
    // Re-entry keeps the exact amount; only the display rounds to the cent.
    plain: number.plain,
    spoken: `${neg ? 'minus ' : ''}${fixed} ${words[sym]}`,
    rounded: !new D(fixed).eq(v.abs()),
  };
}

function exactFraction([n, d]: readonly [bigint, bigint]): string | undefined {
  return d !== 1n && d <= 1_000_000n ? `${n}/${d}` : undefined;
}

/** Makes a result the session's "ans", records its base and applies any assignment. */
export function commit(session: Session, result: CalcSuccess, value: Dec = result.value): void {
  if (result.definition) {
    const { name, params, body, source } = result.definition;
    session.fns.set(name, { params, body, source });
    return;
  }
  if (result.assignments) for (const a of result.assignments) session.vars.set(a.name, a.value);
  if (result.assignment) session.vars.set(result.assignment, value);
  session.ans = value;
  // "The original number" keeps pointing at the first calculation's base through a chain of follow-ups.
  if (!/\b(?:ans|base)\b/.test(result.expression)) session.base = result.base ?? value;
}

/**
 * "20% of 450 + 30" can mean (20% of 450) + 30 or 20% of (450 + 30).
 * Returns the token list for the second reading when the first is what the parser chose.
 */
function groupAfterOf(tokens: Token[]): Token[] | null {
  const ofIdx = tokens.findIndex((t) => t.t === 'op' && (t.v === 'of' || t.v === 'off'));
  if (ofIdx < 0) return null;
  let depth = 0;
  let end = tokens.length;
  let hasAdditive = false;
  for (let i = ofIdx + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.t !== 'op') continue;
    if (t.v === '(') depth++;
    else if (t.v === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (depth === 0 && (t.v === '+' || t.v === '-')) {
      const prev = tokens[i - 1]!;
      const binary = prev.t !== 'op' || prev.v === ')' || prev.v === '%' || prev.v === '!';
      if (binary) hasAdditive = true;
    }
  }
  if (!hasAdditive) return null;
  const open: Token = { t: 'op', v: '(', pos: -1 };
  const close: Token = { t: 'op', v: ')', pos: -1 };
  return [...tokens.slice(0, ofIdx + 1), open, ...tokens.slice(ofIdx + 1, end), close, ...tokens.slice(end)];
}

/** Re-creates a saved formula from its source text (e.g. after reload). */
export function defineFromSource(session: Session, source: string): boolean {
  const r = calculate(source, session);
  if (!r.ok || !r.definition) return false;
  commit(session, r);
  return true;
}

/** Parses input (natural language included) to an AST with the session's formulas known. Throws MathError. */
export function parseInput(input: string, session: Session, opts: NormalizeOptions = {}): Node {
  const norm = normalize(input, opts);
  return parse(lex(norm.text), { userFunctions: new Set(session.fns.keys()) }).ast;
}
