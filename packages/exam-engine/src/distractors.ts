/**
 * Wrong answers that real students give: sign errors, forgetting to divide, the wrong operation,
 * off-by-one, percent/decimal slips, reciprocals, swapped coordinates, power-rule slips. Every candidate is
 * checked to differ from the key (by value or, for expressions, by sampling) and from the other choices.
 */
import type { Topic } from '@lemma/practice-engine';
import { answerKind, evalNumber, formatLike, near, sameExpression, samples } from './math';
import { pretty } from './text';
import { Rng } from './util';

export interface DistractorContext {
  prompt: string;
  topic?: Topic;
  rng: Rng;
}

const NUM_TOKEN = /[−-]?\$?\d[\d,]*(?:\.\d+)?(?:\/\d+)?/;

/** Numbers that appear in the prompt (not exponents), as values. */
export function promptNumbers(prompt: string): number[] {
  const out: number[] = [];
  for (const m of prompt.replace(/−/g, '-').matchAll(/(?<![\w^.])(\d[\d,]*(?:\.\d+)?)/g)) {
    const v = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Coefficient of x in a linear-looking prompt ("3x + 7 = 22" → 3), when there is one. */
function xCoefficient(prompt: string): number | null {
  const m = /(?<![\w^.])(\d+(?:\.\d+)?)\s*\(?\s*x\b/.exec(prompt.replace(/−/g, '-'));
  return m ? Number(m[1]) : null;
}

/** A value's display in the key's style: same prefix/suffix (x =, $, units, π) and number format. */
function numberTemplate(display: string): { prefix: string; token: string; suffix: string } | null {
  const m = NUM_TOKEN.exec(display.replace(/−/g, '-'));
  if (!m) return null;
  return { prefix: display.slice(0, m.index), token: m[0], suffix: display.slice(m.index + m[0].length) };
}

function tokenValue(token: string): number | null {
  return evalNumber(token.replace(/\$/g, ''));
}

/** Evaluates + − × ÷ strictly left to right (the classic order-of-operations slip), or null. */
function leftToRight(expr: string): number | null {
  const toks = expr.replace(/−/g, '-').replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[+\-×*÷/]/g);
  if (!toks || toks.length < 3 || /[()^]/.test(expr)) return null;
  let acc = Number(toks[0]);
  for (let i = 1; i + 1 < toks.length; i += 2) {
    const b = Number(toks[i + 1]);
    const op = toks[i]!;
    acc = op === '+' ? acc + b : op === '-' ? acc - b : op === '×' || op === '*' ? acc * b : acc / b;
  }
  return Number.isFinite(acc) ? acc : null;
}

/** Mistakes specific to recognisable question forms. */
function contextMistakes(prompt: string): number[] {
  const p = prompt.replace(/−/g, '-').replace(/(\d),(?=\d{3})/g, '$1');
  const out: number[] = [];
  let m = /\$\s*([\d.]+)[^.]*?\bat\s+([\d.]+)\s*%[^.]*?compounded annually[^?]*?after\s+(\d+)\s+years?/i.exec(p);
  if (m) {
    const [P, r, t] = [Number(m[1]), Number(m[2]) / 100, Number(m[3])];
    out.push(P * (1 + r * t), P * (1 + r) ** (t - 1), P * (1 + r) ** (t + 1), P * r * t, P + P * r);
  }
  m = /([\d.]+)\s+[a-z ]*?\b(doubles|triples)\s+every\s+([\d.]+)\s+(\w+)[^?]*?after\s+([\d.]+)/i.exec(p);
  if (m) {
    const [N, b, d, t] = [Number(m[1]), m[2]!.toLowerCase() === 'doubles' ? 2 : 3, Number(m[3]), Number(m[5])];
    const k = t / d;
    out.push(N * b * k, N * b ** (k - 1), N * b ** (k + 1), N * b ** t);
  }
  m = /([\d.]+)\s*%\s*(?:tip\s+)?(?:of|on)\s+\$?([\d.]+)/i.exec(p);
  if (m) {
    const [r, N] = [Number(m[1]), Number(m[2])];
    out.push(N * r, (N * r) / 10, N - (N * r) / 100, N + (N * r) / 100, N / r);
  }
  m = /(?:evaluate|calculate)\s+([\d\s.+\-×*÷/]+?)\.?$/i.exec(p.trim());
  if (m) {
    const l = leftToRight(m[1]!);
    if (l !== null) out.push(l);
  }
  m = /convert\s+([\d.]+)\s+(\w+)/i.exec(p);
  if (m) {
    const n = Number(m[1]);
    out.push(n / 1000, n * 100, n / 100, n * 10, n / 10);
  }
  return out.filter(Number.isFinite);
}

function numberCandidates(v: number, ctx: DistractorContext): number[] {
  const nums = promptNumbers(ctx.prompt).filter((n) => n !== 0);
  const a = xCoefficient(ctx.prompt);
  const c: number[] = [];
  const push = (...xs: number[]) => c.push(...xs);
  const t = ctx.topic;
  push(...contextMistakes(ctx.prompt));
  if (t === 'percent' || t === 'money') push(v * 10, v / 10);
  if (t === 'linear' && a && a !== 1) {
    push(v * a); // forgot to divide by the coefficient
    const b = nums.find((n) => n !== a);
    if (b !== undefined) push(v + (2 * b) / a, v - (2 * b) / a); // moved the constant with the wrong sign
  }
  if (v !== 0) push(-v); // sign error
  if (t === 'fractions' || t === 'exponents') {
    if (v !== 0) push(1 / v);
    const f = /(\d+)\s*\/\s*(\d+)\s*[+−-]\s*(\d+)\s*\/\s*(\d+)/.exec(ctx.prompt.replace(/−/g, '-'));
    if (f) push((Number(f[1]) + Number(f[3])) / (Number(f[2]) + Number(f[4]))); // added tops and bottoms
  }
  if (t === 'stats') push(nums.reduce((s, n) => s + n, 0)); // forgot to divide by the count
  if (t === 'geometry') push(v * 2, v / 2); // radius/diameter, forgot ½
  if (Math.abs(v) <= 30) push(v + 1, v - 1); // off by one
  push(v * 2, v / 2);
  for (const n of nums.slice(0, 4)) if (n !== 1) push(v * n, v + n, v - n, v / n); // wrong operation with a given number
  if (t !== 'percent' && t !== 'money') push(v * 10, v / 10);
  const unit = Math.abs(v) > 30 ? 10 ** Math.floor(Math.log10(Math.abs(v)) - 1) : 1;
  for (let k = 2; k <= 12; k++) push(v + k * unit, v - k * unit);
  return c.filter(Number.isFinite);
}

/** `count` distinct wrong answers in the key's display style. */
export function distractors(key: string, count: number, ctx: DistractorContext): string[] {
  const kind = answerKind(key);
  const out: string[] = [];
  const seen = new Set<string>([norm(key)]);
  const add = (d: string, ok: () => boolean) => {
    if (out.length >= count) return;
    const n = norm(d);
    if (!d.trim() || seen.has(n) || !ok()) return;
    seen.add(n);
    out.push(d);
  };

  if (kind === 'number') {
    const tpl = numberTemplate(key);
    const tv = tpl ? tokenValue(tpl.token) : null;
    const kv = evalNumber(key);
    if (tpl && tv !== null && kv !== null) {
      const noNeg = tv >= 0 && (ctx.topic === 'geometry' || ctx.topic === 'units' || ctx.topic === 'money' || ctx.topic === 'stats' || /\$|π|²|³/.test(key));
      const intOnly = Number.isInteger(tv) && !/[./]/.test(tpl.token);
      for (const cand of numberCandidates(tv, ctx)) {
        if (noNeg && cand < 0) continue;
        if (intOnly && Math.abs(cand - Math.round(cand)) > 1e-9 && out.length < count - 1) continue;
        const display = pretty(tpl.prefix + formatLike(cand, tpl.token.replace(/^-/, '')) + tpl.suffix);
        add(display, () => {
          const dv = evalNumber(display);
          return dv === null ? true : !near(dv, kv, 1e-9) && out.every((o) => evalNumber(o) === null || !near(evalNumber(o)!, dv, 1e-9));
        });
      }
    }
  } else if (kind === 'set') {
    const roots = (key.match(/[−-]?\d+(?:\.\d+)?(?:\/\d+)?/g) ?? []).map((r) => ({ s: r, v: evalNumber(r)! })).filter((r) => r.v !== null);
    if (roots.length && !/√/.test(key)) {
      const show = (vs: number[]) => {
        const sorted = [...vs].sort((x, y) => x - y);
        return pretty(sorted.map((v) => `x = ${formatLike(v, roots[0]!.s.replace(/^[−-]/, ''))}`).join(' or '));
      };
      const vs = roots.map((r) => r.v);
      const cands: number[][] = [vs.map((v) => -v), vs.length > 1 ? [vs[0]!, -vs[1]!] : [vs[0]! + 1], vs.length > 1 ? [-vs[0]!, vs[1]!] : [vs[0]! - 1], vs.map((v) => v + 1), vs.map((v) => v - 1), vs.map((v) => v * 2), vs.length > 1 ? [vs[0]!] : [vs[0]! * 3], vs.map((v) => v - 2), vs.map((v) => v + 2)];
      for (const cset of cands) {
        const uniq = [...new Set(cset.map((v) => Math.round(v * 1e9) / 1e9))];
        add(show(uniq), () => !sameSet(uniq, vs));
      }
    }
  } else if (kind === 'pair') {
    const m = /x\s*=\s*([^,]+),\s*y\s*=\s*(.+)$/.exec(key.replace(/−/g, '-'));
    const x = m ? evalNumber(m[1]!) : null, y = m ? evalNumber(m[2]!) : null;
    if (m && x !== null && y !== null) {
      const show = (a: number, b: number) => pretty(`x = ${formatLike(a, m[1]!.trim().replace(/^-/, ''))}, y = ${formatLike(b, m[2]!.trim().replace(/^-/, ''))}`);
      for (const [a, b] of [[y, x], [x, -y], [-x, y], [x + 1, y - 1], [x - 1, y + 1], [x, y + 2], [x + 2, y], [-x, -y]] as [number, number][]) add(show(a, b), () => !(near(a, x) && near(b, y)));
    }
  } else {
    const upToC = /\+\s*C\b/.test(key);
    for (const d of expressionCandidates(key, ctx.prompt)) add(d, () => samples(d) !== null && !sameExpression(d, key, upToC) && out.every((o) => !sameExpression(o, d, upToC)));
  }
  // Last resort: generic but still wrong and distinct.
  for (let k = 2; out.length < count && k < 40; k++) {
    if (kind === 'expression') {
      const d = pretty(`${k}(${key.replace(/\s*\+\s*C\b/, '')})${/\+\s*C\b/.test(key) ? ' + C' : ''}`);
      add(d, () => samples(d) !== null && !sameExpression(d, key, /\+\s*C/.test(key)));
    } else {
      const v = evalNumber(key);
      if (v !== null) add(pretty(formatLike(v + k * (k % 2 ? 1 : -1), key)), () => true);
      else add(`${key} (${k})`, () => true);
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s·*]/g, '').replace(/−/g, '-');

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => near(v, sb[i]!));
}

/** Expression mistakes: sign flips, power-rule slips (exponent kept / coefficient not multiplied), dropped term. */
/** "x^4", "3x^2", "1/x", "x" → coefficient and exponent; null for anything else. */
function monomial(key: string): { c: number; n: number; frac: boolean } | null {
  const k = key.replace(/−/g, '-').replace(/\s+/g, '');
  let m = /^(-?\d*)x(?:\^(-?\d+))?$/.exec(k);
  if (m) return { c: m[1] === '' ? 1 : m[1] === '-' ? -1 : Number(m[1]), n: m[2] ? Number(m[2]) : 1, frac: false };
  m = /^(-?\d*)\/x(?:\^(\d+))?$/.exec(k);
  if (m) return { c: m[1] === '' || m[1] === '-' ? (m[1] === '-' ? -1 : 1) : Number(m[1]), n: -(m[2] ? Number(m[2]) : 1), frac: true };
  return null;
}

function showMonomial(c: number, n: number, frac: boolean): string {
  const cs = c === 1 ? '' : c === -1 ? '-' : String(c);
  if (n === 0) return String(c);
  if (n === 1) return `${cs}x`;
  if (n < 0 && frac) return `${c === 1 ? '1' : c}/x${n === -1 ? '' : `^${-n}`}`;
  return `${cs}x^${n}`;
}

/** Exponent-rule slips for a monomial answer, using the exponents in the prompt (added vs multiplied, etc.). */
export function monomialCandidates(key: string, prompt: string): string[] {
  const mono = monomial(key);
  if (!mono) return [];
  const ex = [...prompt.replace(/−/g, '-').matchAll(/\^\s*\(?(-?\d+)/g)].map((m) => Number(m[1]));
  const ns = new Set<number>();
  if (ex.length >= 2) {
    const [a, b] = [ex[0]!, ex[1]!];
    const c = ex[2];
    ns.add(a + b).add(a * b).add(a - b);
    if (c !== undefined) ns.add(a + b - c).add(a * b + c).add(a * b * c).add(a - b - c);
    if (b !== 0 && a % b === 0) ns.add(a / b);
  }
  for (const d of [1, -1, 2, mono.n]) ns.add(mono.n + d);
  ns.add(-mono.n);
  const out: string[] = [];
  for (const n of ns) if (n !== mono.n && Math.abs(n) <= 30) out.push(pretty(showMonomial(mono.c, n, mono.frac)));
  if (Math.abs(mono.c) !== 1) out.push(pretty(showMonomial(mono.c * 2, mono.n, mono.frac)), pretty(showMonomial(1, mono.n, mono.frac)));
  return out;
}

function expressionCandidates(key: string, prompt = ''): string[] {
  const mono = monomialCandidates(key, prompt);
  if (mono.length) return mono;
  const k = key.replace(/−/g, '-');
  const hasC = /\+\s*C\b/.test(k);
  const body = k.replace(/\s*\+\s*C\b/, '');
  const terms = body.split(/(?=\s[+-]\s)/).map((t) => t.trim());
  const join = (ts: string[]) => pretty(ts.join(' ').replace(/^\+\s*/, '').trim() + (hasC ? ' + C' : ''));
  const out: string[] = [];
  const flip = (t: string) => (/^-\s*/.test(t) ? t.replace(/^-\s*/, '+ ') : /^\+\s*/.test(t) ? t.replace(/^\+\s*/, '- ') : '-' + t);
  // Sign of first / last term.
  out.push(join([flip(terms[0]!), ...terms.slice(1)]));
  if (terms.length > 1) out.push(join([...terms.slice(0, -1), flip(terms[terms.length - 1]!)]));
  // Exponent off by one in the first power ("kept the exponent" / "raised instead of lowered").
  const pow = /\^(\d+)/.exec(body);
  if (pow) {
    const n = Number(pow[1]);
    out.push(join([body.replace(/\^(\d+)/, `^${n + 1}`)]));
    if (n > 2) out.push(join([body.replace(/\^(\d+)/, `^${n - 1}`)]));
  }
  // Coefficient slip: forgot to multiply/divide by the exponent.
  const coef = /^(-?\s*)(\d+)(?=\s*[a-z(])/.exec(body);
  if (coef && pow) {
    const c = Number(coef[2]);
    const n = Number(pow[1]);
    out.push(join([body.replace(/^(-?\s*)(\d+)/, `$1${c * n}`)]));
    if (c % (n + 1) === 0 && c / (n + 1) !== 1) out.push(join([body.replace(/^(-?\s*)(\d+)/, `$1${c / (n + 1)}`)]));
  }
  // Dropped the last term (e.g. forgot the derivative of the linear term).
  if (terms.length > 1) out.push(join(terms.slice(0, -1)));
  // Chain rule forgotten: drop a leading factor like "24x·".
  const chain = /^(-?\d*x?)\s*·\s*(.+)$/.exec(body);
  if (chain) out.push(join([chain[2]!]));
  // Doubling the first coefficient.
  if (coef) out.push(join([body.replace(/^(-?\s*)(\d+)/, (_m, s: string, d: string) => `${s}${Number(d) * 2}`)]));
  return out;
}
