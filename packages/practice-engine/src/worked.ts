/**
 * Worked solutions for the user's own question. Every path parses into a form we can solve exactly,
 * then checks itself numerically (substitution, finite differences, recomputation). Anything outside
 * those forms, or anything that fails its own check, returns null: we never guess.
 */
import { compileFloat, createSession, D, freeNames, parseInput, type Dec, type Node } from '@lemma/math-core';
import { deriv, exprPlain, exprTex, simplify, type Expr, type Fn, type Poly, type Term } from './calculus';
import { addSteps, divSteps, lin, lin2, mulSteps, quadStr, solveLinear, solveQuadratic, solveSystem } from './gen-algebra';
import { derivativeSolution, integralSteps } from './gen-calculus';
import { money, num, Q, toTex, trim } from './format';
import type { Step } from './types';

export interface Worked {
  title: string;
  question: string;
  questionTex?: string;
  steps: Step[];
  answer: { display: string; tex?: string };
}

const session = (() => {
  const s = createSession();
  s.angle = 'rad';
  return s;
})();
const step = (text: string, tex?: string): Step => (tex === undefined ? { text } : { text, tex });

type F = (env: Record<string, number>) => number;

function compile(text: string, allowed: string[]): { ast: Node; f: F } | null {
  try {
    // In algebra, "2x(x + 1)" means 2·x·(x + 1); math-core would read that x as a times sign.
    const ast = parseInput(text.replace(/(\d)\s*x\s*\(/g, '$1*x*('), session);
    const names = freeNames(ast);
    if (names.some((n) => !allowed.includes(n))) return null;
    return { ast, f: compileFloat(ast, { angle: 'rad', free: new Set(allowed) }) };
  } catch {
    return null;
  }
}

const close = (a: number, b: number, rel = 1e-7) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const isInt = (v: number) => Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9;
const gcdInt = (a: number, b: number): number => (b ? gcdInt(b, a % b) : Math.abs(a));
const N = (s: string) => Number(s.replace(/,/g, '').replace(/−/g, '-'));
const NUM = String.raw`[-−]?\d[\d,]*(?:\.\d+)?|[-−]?\.\d+`;

// ---------- equations ----------

function cleanEquation(q: string): string {
  return q
    .replace(/^\s*(?:please\s+)?(?:solve|find x|find|what is x|what's x)(?:\s+for\s+x)?\s*:?\s*/i, '')
    .replace(/\s+for\s+x\s*$/i, '')
    .replace(/[?.]\s*$/, '')
    .trim();
}

function oneVariable(q: string): Worked | null {
  const eq = cleanEquation(q);
  const sides = eq.split('=');
  if (sides.length !== 2 || !sides[0]!.trim() || !sides[1]!.trim()) return null;
  const L = compile(sides[0]!, ['x']);
  const R = compile(sides[1]!, ['x']);
  if (!L || !R) return null;
  if (![...freeNames(L.ast), ...freeNames(R.ast)].includes('x')) return null;
  // Fit each side as a quadratic in x, then confirm the fit at other points.
  const fit = (f: F) => {
    const c = f({ x: 0 }), p = f({ x: 1 }), m = f({ x: -1 });
    const a = (p + m) / 2 - c, b = (p - m) / 2;
    for (const x of [2, -3, 0.5, 7]) if (!close(f({ x }), a * x * x + b * x + c)) return null;
    return [a, b, c] as const;
  };
  const lf = fit(L.f), rf = fit(R.f);
  if (!lf || !rf) return null;
  // "x/2 + 3 = 5", "0.5x = 3": multiply both sides by the common denominator so every coefficient is whole.
  let scale = 1;
  for (const v of [...lf, ...rf]) {
    let q = 1;
    while (q <= 100 && !isInt(v * q)) q++;
    if (q > 100) return null;
    scale = (scale * q) / gcdInt(scale, q);
    if (scale > 1000) return null;
  }
  const l = lf.map((v) => Math.round(v * scale)) as [number, number, number];
  const r = rf.map((v) => Math.round(v * scale)) as [number, number, number];
  const [a, b, c] = [l[0] - r[0], l[1] - r[1], l[2] - r[2]];
  const question = `Solve ${eq.replace(/\s*=\s*/, ' = ')}.`;
  const side = (p: readonly number[]) => (p[0] ? quadStr(p[0], p[1]!, p[2]!) : lin(p[1]!, p[2]!));
  const cleared =
    scale === 1
      ? []
      : [step(`Multiply both sides by ${scale} to clear the ${/\//.test(eq) ? 'fractions' : 'decimals'}: ${side(l)} = ${side(r)}.`, `${toTex(side(l))} = ${toTex(side(r))}`)];
  if (a === 0) {
    if (l[0] !== 0 || r[0] !== 0) return null;
    const sol = solveLinear(l[1], l[2], r[1], r[2]);
    if (!sol) return null;
    const steps = [...cleared, ...sol.steps];
    if (/\(/.test(eq) && scale === 1) steps.unshift(step(`Expand the brackets: ${lin(l[1], l[2])} = ${lin(r[1], r[2])}.`, `${toTex(lin(l[1], l[2]))} = ${toTex(lin(r[1], r[2]))}`));
    // Substitute back as an independent check.
    if (!close(L.f({ x: sol.x.value() }), R.f({ x: sol.x.value() }))) return null;
    return { title: 'Solving a linear equation', question, questionTex: toTex(eq), steps, answer: { display: `x = ${sol.x}`, tex: `x = ${sol.x.tex()}` } };
  }
  const sol = solveQuadratic(a, b, c);
  if (!sol) return null;
  const steps = [...sol.steps];
  if (r.some((v) => v !== 0) || (/\(/.test(eq) && scale === 1)) steps.unshift(step(`Move everything to one side: ${quadStr(a, b, c)} = 0.`, `${toTex(quadStr(a, b, c))} = 0`));
  steps.unshift(...cleared);
  const disc = b * b - 4 * a * c;
  for (const s of [1, -1]) {
    const x = (-b + s * Math.sqrt(disc)) / (2 * a);
    if (!close(L.f({ x }), R.f({ x }), 1e-6)) return null;
  }
  return { title: 'Solving a quadratic equation', question, questionTex: toTex(eq), steps, answer: { display: sol.display, tex: sol.tex } };
}

function twoVariables(q: string): Worked | null {
  const body = q.replace(/^\s*(?:solve)?\s*(?:the\s+)?(?:system|simultaneous equations)?\s*:?\s*/i, '').replace(/[?.]\s*$/, '');
  const eqs = body.split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean);
  if (eqs.length !== 2) return null;
  const rows: [number, number, number][] = [];
  for (const e of eqs) {
    const sides = e.split('=');
    if (sides.length !== 2) return null;
    const L = compile(sides[0]!, ['x', 'y']), R = compile(sides[1]!, ['x', 'y']);
    if (!L || !R) return null;
    const h = (x: number, y: number) => L.f({ x, y }) - R.f({ x, y });
    const c0 = h(0, 0), a = h(1, 0) - c0, b = h(0, 1) - c0;
    for (const [x, y] of [[2, 3], [-1, 4], [5, -2]] as const) if (!close(h(x, y), a * x + b * y + c0)) return null;
    if (![a, b, c0].every(isInt)) return null;
    rows.push([Math.round(a), Math.round(b), -Math.round(c0)]);
  }
  const [r1, r2] = rows as [[number, number, number], [number, number, number]];
  const sol = solveSystem(r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]);
  if (!sol) return null;
  const e1 = lin2(...r1), e2 = lin2(...r2);
  return {
    title: 'Solving a system of equations',
    question: `Solve the system: ${e1} and ${e2}.`,
    questionTex: `\\begin{cases} ${toTex(e1)} \\\\ ${toTex(e2)} \\end{cases}`,
    steps: sol.steps,
    answer: { display: `x = ${sol.x}, y = ${sol.y}`, tex: `x = ${sol.x.tex()},\\ y = ${sol.y.tex()}` },
  };
}

// ---------- calculus: math-core AST → our term form ----------

function constOf(e: Expr): number | null {
  if (e.length === 0) return 0;
  return e.length === 1 && e[0]!.n === 0 && !e[0]!.f ? e[0]!.c : null;
}

function toPoly(e: Expr): Poly | null {
  if (e.some((t) => t.f || t.n < 0 || !isInt(t.c))) return null;
  return simplify(e).map((t) => ({ c: Math.round(t.c), n: t.n })).sort((a, b) => b.n - a.n);
}

function mulTerm(a: Term, b: Term): Term | null {
  if (a.f && b.f) return null;
  return { c: a.c * b.c, n: a.n + b.n, f: a.f ?? b.f };
}

function toExpr(n: Node): Expr | null {
  switch (n.type) {
    case 'num': {
      const v = Number(n.value);
      return Number.isFinite(v) ? [{ c: v, n: 0 }] : null;
    }
    case 'name':
      return n.name === 'x' ? [{ c: 1, n: 1 }] : null;
    case 'neg': {
      const a = toExpr(n.arg);
      return a && a.map((t) => ({ ...t, c: -t.c }));
    }
    case 'binary': {
      if (n.op === '^' && n.left.type === 'name' && n.left.name === 'e') {
        const arg = toExpr(n.right);
        const p = arg && toPoly(arg);
        return p && p.length ? [{ c: 1, n: 0, f: { kind: 'exp', arg: p } }] : null;
      }
      const l = toExpr(n.left);
      if (!l) return null;
      if (n.op === '^') {
        const k = (() => {
          const r = toExpr(n.right);
          return r ? constOf(r) : null;
        })();
        if (k === null || !isInt(k)) return null;
        const m = Math.round(k);
        const ls = simplify(l);
        if (ls.length === 1 && !ls[0]!.f) return [{ c: ls[0]!.c ** m, n: ls[0]!.n * m }];
        const p = toPoly(ls);
        if (!p || p.length < 2 || m < 2 || m > 12) return null;
        return [{ c: 1, n: 0, f: { kind: 'pow', arg: p, m } }];
      }
      const r = toExpr(n.right);
      if (!r) return null;
      if (n.op === '+') return [...l, ...r];
      if (n.op === '-') return [...l, ...r.map((t) => ({ ...t, c: -t.c }))];
      if (n.op === '*') {
        const ls = simplify(l), rs = simplify(r);
        const out: Term[] = [];
        for (const a of ls) for (const b of rs) {
          const t = mulTerm(a, b);
          if (!t) return null;
          out.push(t);
        }
        return out;
      }
      if (n.op === '/') {
        const rs = simplify(r);
        if (rs.length !== 1 || rs[0]!.f || rs[0]!.c === 0) return null;
        const d = rs[0]!;
        const out = l.map((t) => ({ ...t, c: t.c / d.c, n: t.n - d.n }));
        return out.some((t) => t.f && t.n < 0) ? null : out;
      }
      return null;
    }
    case 'call': {
      if (n.args.length !== 1) return null;
      const a = toExpr(n.args[0]!);
      if (!a) return null;
      if (n.name === 'ln') {
        const s = simplify(a);
        return s.length === 1 && s[0]!.c === 1 && s[0]!.n === 1 && !s[0]!.f ? [{ c: 1, n: 0, f: { kind: 'ln' } }] : null;
      }
      if (n.name !== 'sin' && n.name !== 'cos' && n.name !== 'exp') return null;
      const p = toPoly(a);
      return p && p.length && p.some((t) => t.n > 0) ? [{ c: 1, n: 0, f: { kind: n.name, arg: p } as Fn }] : null;
    }
    default:
      return null;
  }
}

/** Parses an expression in x into our term form and confirms the two agree numerically. */
function parseCalculus(text: string): { e: Expr; f: F } | null {
  const c = compile(text, ['x']);
  if (!c) return null;
  const raw = toExpr(c.ast);
  if (!raw) return null;
  const e = simplify(raw);
  if (!e.length) return null;
  let back: { f: F } | null;
  try {
    back = compile(exprPlain(e), ['x']);
  } catch {
    return null; // a coefficient that isn't a simple fraction
  }
  if (!back) return null;
  for (const x of [0.3, 0.9, 1.4, 2.2]) if (!close(c.f({ x }), back.f({ x }), 1e-9)) return null;
  return { e, f: c.f };
}

function derivativeQuery(q: string): Worked | null {
  const m =
    /^\s*(?:what(?:'s| is)\s+)?(?:find\s+)?(?:the\s+)?(?:derivative|differentiate)(?:\s+of)?\s+(.+?)(?:\s+with respect to x)?\s*[?.]?\s*$/i.exec(q) ??
    /^\s*d\s*\/\s*dx\s*(?:of\s+)?(.+?)\s*[?.]?\s*$/i.exec(q);
  if (!m) return null;
  const text = m[1]!.replace(/^(?:f\(x\)|y)\s*=\s*/i, '').replace(/^\[(.*)\]$/, '$1');
  const p = parseCalculus(text);
  if (!p) return null;
  let sol: ReturnType<typeof derivativeSolution>;
  try {
    sol = derivativeSolution(p.e);
  } catch {
    return null;
  }
  const d = compile(sol.answer, ['x']);
  if (!d) return null;
  for (const x of [0.4, 1.1, 1.7, 2.3]) {
    const h = 1e-5;
    const fd = (p.f({ x: x + h }) - p.f({ x: x - h })) / (2 * h);
    if (!close(fd, d.f({ x }), 1e-5)) return null;
  }
  return { title: 'Finding a derivative', question: sol.prompt, questionTex: sol.promptTex, steps: sol.steps, answer: { display: sol.answer, tex: sol.answerTex } };
}

/** Antiderivative of one term when it is a basic form; null otherwise. */
function antiTerm(t: Term): Term | null {
  if (!t.f) return t.n === -1 ? { c: t.c, n: 0, f: { kind: 'ln', abs: true } } : { c: t.c / (t.n + 1), n: t.n + 1 };
  if (t.n !== 0 || t.f.kind === 'ln' || t.f.kind === 'pow') return null;
  const arg = t.f.arg;
  if (arg.length < 1 || arg.length > 2 || arg[0]!.n !== 1 || (arg[1] && arg[1].n !== 0)) return null;
  const k = arg[0]!.c;
  if (t.f.kind === 'sin') return { c: -t.c / k, n: 0, f: { kind: 'cos', arg } };
  if (t.f.kind === 'cos') return { c: t.c / k, n: 0, f: { kind: 'sin', arg } };
  return { c: t.c / k, n: 0, f: t.f };
}

function integralQuery(q: string): Worked | null {
  const m =
    /^\s*(?:what(?:'s| is)\s+)?(?:find\s+|evaluate\s+)?(?:the\s+)?(?:(?:definite\s+|indefinite\s+)?integral|antiderivative|integrate)(?:\s+from\s+(\S+)\s+to\s+(\S+))?(?:\s+of)?\s+(.+?)\s*[?.]?\s*$/i.exec(q) ??
    /^\s*∫\s*(?:_\{?(\S+?)\}?\s*\^\{?(\S+?)\}?\s+)?(.+?)\s*[?.]?\s*$/.exec(q);
  if (!m) return null;
  let text = m[3]!.trim();
  let lo = m[1], hi = m[2];
  const from = /^(.+?)\s+from\s+(\S+)\s+to\s+(\S+)$/i.exec(text);
  if (from && !lo) [text, lo, hi] = [from[1]!, from[2], from[3]];
  text = text.replace(/\s*d\s*x\s*$/i, '').replace(/^\((.*)\)$/, '$1');
  const p = parseCalculus(text);
  if (!p) return null;
  const F: Expr = [];
  for (const t of p.e) {
    const a = antiTerm(t);
    if (!a) return null;
    F.push(a);
  }
  let Fp: string;
  try {
    Fp = exprPlain(F);
  } catch {
    return null;
  }
  const Fc = compile(Fp, ['x']);
  if (!Fc) return null;
  // Differentiate the antiderivative numerically and compare with the integrand.
  for (const x of [0.4, 1.1, 1.7, 2.3]) {
    const h = 1e-5;
    if (!close((Fc.f({ x: x + h }) - Fc.f({ x: x - h })) / (2 * h), p.f({ x }), 1e-5)) return null;
  }
  const steps = integralSteps(F);
  const integrand = exprPlain(p.e);
  if (lo === undefined || hi === undefined) {
    steps.push(step('Add the constant of integration.', `${exprTex(F)} + C`));
    return {
      title: 'Finding an integral',
      question: `Find ∫ (${integrand}) dx.`,
      questionTex: `\\int \\left(${exprTex(p.e)}\\right)\\,dx`,
      steps,
      answer: { display: `${Fp} + C`, tex: `${exprTex(F)} + C` },
    };
  }
  // Definite integrals: only polynomials, so the value is an exact fraction.
  if (F.some((t) => t.f || t.n < 0) || !/^-?\d+$/.test(lo.replace('−', '-')) || !/^-?\d+$/.test(hi.replace('−', '-'))) return null;
  const a = N(lo), b = N(hi);
  const evalF = (x: number) => F.reduce((s, t) => s.add(fracOf(t.c).mul(new Q(x ** t.n))), new Q(0));
  const Fa = evalF(a), Fb = evalF(b), v = Fb.sub(Fa);
  if (!close(v.value(), Fc.f({ x: b }) - Fc.f({ x: a }))) return null;
  steps.push(
    step(`So F(x) = ${Fp}.`, `F(x) = ${exprTex(F)}`),
    step(`Evaluate at the upper limit: F(${num(b)}) = ${Fb}.`, `F(${b}) = ${Fb.tex()}`),
    step(`Evaluate at the lower limit: F(${num(a)}) = ${Fa}.`, `F(${a}) = ${Fa.tex()}`),
    step(`Subtract: ${Fb} − ${Fa.n < 0 ? `(${Fa})` : Fa} = ${v}.`, v.tex()),
  );
  return {
    title: 'Evaluating a definite integral',
    question: `Evaluate ∫ from ${num(a)} to ${num(b)} of (${integrand}) dx.`,
    questionTex: `\\int_{${a}}^{${b}} \\left(${exprTex(p.e)}\\right)\\,dx`,
    steps,
    answer: { display: v.toString(), tex: v.tex() },
  };
}

function fracOf(c: number): Q {
  for (let q = 1; q <= 1000; q++) {
    const p = Math.round(c * q);
    if (Math.abs(p / q - c) < 1e-9) return new Q(p, q);
  }
  throw new Error('not a fraction');
}

// ---------- percent and money ----------

/** "an 18% tip", "a 15% tip". */
const an = (n: string) => (/^(?:8|11|18|8\d)(?:\D|$)/.test(n) ? 'an' : 'a');
const cents = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const dec = (x: Dec) => trim(x.toNumber(), 10);

function percentQuery(q: string): Worked | null {
  const s = q.trim().replace(/[?]\s*$/, '');
  const tip = new RegExp(String.raw`^(?:what(?:'s| is)\s+(?:an?\s+|the\s+)?)?(?:total\s+(?:with|for|of)\s+(?:an?\s+)?)?(${NUM})\s*%\s*(tip|tax|sales tax|gratuity)\s+(?:on|for|of)\s+(?:an?\s+)?\$?(${NUM})(?:\s*(?:dollars?|bill))?(\s+total)?$`, 'i').exec(s);
  if (tip) {
    const p = new D(N(tip[1]!)), b = new D(N(tip[3]!));
    const kind = tip[2]!.toLowerCase().includes('tax') ? 'tax' : 'tip';
    const total = /\btotal\b/i.test(s);
    const exact = b.mul(p).div(100);
    const amt = cents(exact);
    const steps = [
      step(`Write ${dec(p)}% as a decimal: ${dec(p.div(100))}.`),
      step(`Multiply: ${b.toFixed(2)} × ${dec(p.div(100))} = ${exact.toString()}${exact.eq(amt) ? '' : `, which rounds to ${amt.toFixed(2)}`}.`, `\\$${amt.toFixed(2)}`),
    ];
    let ans = amt;
    if (total) {
      ans = b.plus(amt);
      steps.push(step(`Add it to the bill: ${b.toFixed(2)} + ${amt.toFixed(2)} = ${ans.toFixed(2)}.`, `\\$${ans.toFixed(2)}`));
    }
    return {
      title: total ? `Total with ${kind}` : `Working out a ${kind}`,
      question: total ? `What is the total of ${money(b.toNumber())} with ${an(dec(p))} ${dec(p)}% ${kind}?` : `What is ${an(dec(p))} ${dec(p)}% ${kind} on ${money(b.toNumber())}?`,
      steps,
      answer: { display: money(ans.toNumber()), tex: `\\$${ans.toFixed(2)}` },
    };
  }
  const off = new RegExp(String.raw`^(?:what(?:'s| is)\s+)?(${NUM})\s*%\s*off\s+(?:of\s+)?(\$)?(${NUM})$`, 'i').exec(s);
  if (off) {
    const p = new D(N(off[1]!)), b = new D(N(off[3]!));
    const keep = new D(100).minus(p).div(100);
    const v = b.mul(keep);
    const isMoney = !!off[2];
    const show = (x: Dec) => (isMoney ? money(cents(x).toNumber()) : dec(x));
    return {
      title: 'Applying a discount',
      question: `What is ${dec(p)}% off ${isMoney ? money(b.toNumber()) : dec(b)}?`,
      steps: [
        step(`${dec(p)}% off leaves ${dec(new D(100).minus(p))}% of the price, which is ${dec(keep)} as a decimal.`),
        step(`Multiply: ${dec(b)} × ${dec(keep)} = ${dec(v)}.`, isMoney ? `\\$${cents(v).toFixed(2)}` : dec(v)),
      ],
      answer: { display: show(v) },
    };
  }
  const of = new RegExp(String.raw`^(?:what(?:'s| is)\s+)?(${NUM})\s*(?:%|percent)\s+of\s+(\$)?(${NUM})$`, 'i').exec(s);
  if (of) {
    const p = new D(N(of[1]!)), b = new D(N(of[3]!));
    const v = p.div(100).mul(b);
    const isMoney = !!of[2];
    return {
      title: 'Finding a percentage',
      question: `What is ${dec(p)}% of ${isMoney ? money(b.toNumber()) : dec(b)}?`,
      steps: [step(`Write ${dec(p)}% as a decimal: ${dec(p)} ÷ 100 = ${dec(p.div(100))}.`), step(`Multiply: ${dec(p.div(100))} × ${dec(b)} = ${dec(v)}.`, dec(v))],
      answer: { display: isMoney ? money(cents(v).toNumber()) : dec(v) },
    };
  }
  const what = new RegExp(String.raw`^(${NUM})\s+is\s+what\s+(?:percent|%)\s+of\s+(${NUM})$`, 'i').exec(s);
  if (what) {
    const a = new D(N(what[1]!)), b = new D(N(what[2]!));
    if (b.isZero()) return null;
    const v = a.div(b).mul(100);
    const shown = v.toDecimalPlaces(4).eq(v) ? dec(v) : v.toDecimalPlaces(2, D.ROUND_HALF_UP).toString();
    return {
      title: 'Finding what percent',
      question: `${dec(a)} is what percent of ${dec(b)}?`,
      steps: [step(`Divide the part by the whole: ${dec(a)} ÷ ${dec(b)} = ${a.div(b).toSignificantDigits(8).toString()}.`), step(`Multiply by 100: ${v.eq(new D(shown)) ? '' : '≈ '}${shown}%.`, `${shown}\\%`)],
      answer: { display: `${v.eq(new D(shown)) ? '' : '≈ '}${shown}%` },
    };
  }
  return null;
}

// ---------- units ----------

interface Unit {
  dim: string;
  /** Size in the dimension's base unit, as an exact ratio. */
  si: [string, string];
  sym: string;
}

const U = (dim: string, sym: string, n: string, d = '1'): Unit => ({ dim, sym, si: [n, d] });
const UNITS: [RegExp, Unit][] = [
  [/^(?:kg|kgs|kilo(?:gram)?s?)$/, U('mass', 'kg', '1')],
  [/^(?:g|grams?|gm)$/, U('mass', 'g', '0.001')],
  [/^(?:mg|milligrams?)$/, U('mass', 'mg', '0.000001')],
  [/^(?:lb|lbs|pounds?)$/, U('mass', 'lb', '0.45359237')],
  [/^(?:oz|ounces?)$/, U('mass', 'oz', '0.028349523125')],
  [/^(?:m|meters?|metres?)$/, U('length', 'm', '1')],
  [/^(?:km|kilometers?|kilometres?)$/, U('length', 'km', '1000')],
  [/^(?:cm|centimeters?|centimetres?)$/, U('length', 'cm', '0.01')],
  [/^(?:mm|millimeters?|millimetres?)$/, U('length', 'mm', '0.001')],
  [/^(?:in|inch|inches)$/, U('length', 'in', '0.0254')],
  [/^(?:ft|foot|feet)$/, U('length', 'ft', '0.3048')],
  [/^(?:yd|yards?)$/, U('length', 'yd', '0.9144')],
  [/^(?:mi|miles?)$/, U('length', 'mi', '1609.344')],
  [/^(?:l|liters?|litres?)$/, U('volume', 'L', '1')],
  [/^(?:ml|milliliters?|millilitres?)$/, U('volume', 'mL', '0.001')],
  [/^(?:gal|gallons?)$/, U('volume', 'gal', '3.785411784')],
  [/^(?:qt|quarts?)$/, U('volume', 'qt', '0.946352946')],
  [/^(?:cups?)$/, U('volume', 'cup', '0.2365882365')],
  [/^(?:m\/s|meters? per second|metres? per second)$/, U('speed', 'm/s', '1')],
  [/^(?:km\/h|kph|kmh|kilometers? per hour|kilometres? per hour)$/, U('speed', 'km/h', '1000', '3600')],
  [/^(?:mph|miles? per hour)$/, U('speed', 'mph', '1609.344', '3600')],
  [/^(?:m²|m\^2|sq m|square meters?|square metres?)$/, U('area', 'm²', '1')],
  [/^(?:cm²|cm\^2|sq cm|square centimeters?|square centimetres?)$/, U('area', 'cm²', '0.0001')],
  [/^(?:ft²|ft\^2|sq ft|square feet|square foot)$/, U('area', 'ft²', '0.09290304')],
  [/^(?:acres?)$/, U('area', 'acre', '4046.8564224')],
  [/^(?:hectares?|ha)$/, U('area', 'ha', '10000')],
  [/^(?:s|sec|secs|seconds?)$/, U('time', 's', '1')],
  [/^(?:min|mins|minutes?)$/, U('time', 'min', '60')],
  [/^(?:h|hr|hrs|hours?)$/, U('time', 'h', '3600')],
  [/^(?:days?)$/, U('time', 'day', '86400')],
];

function unitOf(s: string): Unit | null {
  const k = s.trim().toLowerCase().replace(/\.$/, '');
  for (const [re, u] of UNITS) if (re.test(k)) return u;
  return null;
}

const TEMP: Record<string, 'C' | 'F' | 'K'> = { c: 'C', celsius: 'C', centigrade: 'C', f: 'F', fahrenheit: 'F', k: 'K', kelvin: 'K', kelvins: 'K' };

function unitsQuery(q: string): Worked | null {
  const m = new RegExp(String.raw`^\s*(?:convert\s+|what(?:'s| is)\s+)?(${NUM})\s*(.+?)\s+(?:to|in|into|as)\s+(.+?)\s*[?.]?\s*$`, 'i').exec(q);
  if (!m) return null;
  const v = new D(N(m[1]!));
  const tkey = (x: string) => x.trim().toLowerCase().replace(/^degrees?\s+/, '').replace(/^°\s*/, '');
  const tf = TEMP[tkey(m[2]!)];
  const tt = TEMP[tkey(m[3]!)];
  if (tf && tt && tf !== tt) return temperature(v, tf, tt);
  const a = unitOf(m[2]!), b = unitOf(m[3]!);
  if (!a || !b || a.dim !== b.dim || a.sym === b.sym) return null;
  const factor = new D(a.si[0]).div(a.si[1]).div(new D(b.si[0]).div(b.si[1]));
  const exact = v.mul(factor);
  const fShown = factor.toSignificantDigits(6);
  const big = factor.gte(1);
  const fact = big ? `1 ${a.sym} ${fShown.eq(factor) ? '=' : '≈'} ${dec(fShown)} ${b.sym}` : `1 ${b.sym} ${new D(1).div(factor).toSignificantDigits(6).eq(new D(1).div(factor)) ? '=' : '≈'} ${dec(new D(1).div(factor).toSignificantDigits(6))} ${a.sym}`;
  const rounded = exact.toDecimalPlaces(4, D.ROUND_HALF_UP);
  const approx = !rounded.eq(exact);
  const shown = `${approx ? '≈ ' : ''}${dec(rounded)}`;
  const opText = big ? `${dec(v)} × ${dec(fShown)}` : `${dec(v)} ÷ ${dec(new D(1).div(factor).toSignificantDigits(6))}`;
  return {
    title: 'Converting units',
    question: `Convert ${dec(v)} ${a.sym} to ${b.sym}.`,
    steps: [step(`Use the conversion: ${fact}.`), step(`${big ? 'Multiply' : 'Divide'}: ${opText} ${approx ? '≈' : '='} ${dec(rounded)}.`, `${dec(rounded)}\\ \\text{${b.sym}}`)],
    answer: { display: `${shown} ${b.sym}`, tex: `${dec(rounded)}\\ \\text{${b.sym}}` },
  };
}

function temperature(v: Dec, from: 'C' | 'F' | 'K', to: 'C' | 'F' | 'K'): Worked {
  const sym = (u: string) => (u === 'K' ? 'K' : `°${u}`);
  const steps: Step[] = [];
  let c = v;
  if (from === 'F') {
    c = v.minus(32).mul(5).div(9);
    steps.push(step(`Subtract 32: ${dec(v)} − 32 = ${dec(v.minus(32))}.`), step(`Multiply by 5/9: ${dec(v.minus(32))} × 5 ÷ 9 = ${dec(c.toDecimalPlaces(4, D.ROUND_HALF_UP))}${to === 'C' ? '' : ' °C'}.`));
  } else if (from === 'K') {
    c = v.minus(new D('273.15'));
    steps.push(step(`Subtract 273.15: ${dec(v)} − 273.15 = ${dec(c)}${to === 'C' ? '' : ' °C'}.`));
  }
  let r = c;
  if (to === 'F') {
    r = c.mul(9).div(5).plus(32);
    steps.push(step(`Multiply by 9/5 and add 32: ${dec(c.toDecimalPlaces(4, D.ROUND_HALF_UP))} × 9 ÷ 5 + 32 = ${dec(r.toDecimalPlaces(4, D.ROUND_HALF_UP))}.`));
  } else if (to === 'K') {
    r = c.plus(new D('273.15'));
    steps.push(step(`Add 273.15: ${dec(c.toDecimalPlaces(4, D.ROUND_HALF_UP))} + 273.15 = ${dec(r.toDecimalPlaces(4, D.ROUND_HALF_UP))}.`));
  }
  const rr = r.toDecimalPlaces(4, D.ROUND_HALF_UP);
  const shown = `${rr.eq(r) ? '' : '≈ '}${dec(rr)} ${sym(to)}`;
  return { title: 'Converting temperature', question: `Convert ${dec(v)} ${sym(from)} to ${sym(to)}.`, steps, answer: { display: shown.replace(/^(-)/, '−') } };
}

// ---------- stats ----------

function statsQuery(q: string): Worked | null {
  const m = /^\s*(?:what(?:'s| is)\s+|find\s+|calculate\s+)?(?:the\s+)?(mean|average|median|mode|range|(?:population\s+|sample\s+)?(?:standard deviation|std ?dev|stdev|std|variance))\s+(?:of\s+)?(?:the\s+)?(?:numbers\s+)?(?:data\s+)?:?\s*([-−\d.,\s]+?)\s*[?.]?\s*$/i.exec(q);
  if (!m) return null;
  const kind = m[1]!.toLowerCase();
  const xs = m[2]!.split(/[\s,]+/).filter(Boolean).map(N);
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return null;
  const ds = xs.map((x) => new D(x));
  const list = xs.map((x) => num(x)).join(', ');
  const n = xs.length;
  const sum = ds.reduce((a, b) => a.plus(b), new D(0));
  const mean = sum.div(n);
  const show = (x: Dec) => {
    const r = x.toDecimalPlaces(4, D.ROUND_HALF_UP);
    return `${r.eq(x) ? '' : '≈ '}${dec(r)}`;
  };
  if (kind === 'mean' || kind === 'average') {
    return {
      title: 'Finding the mean',
      question: `Find the mean of ${list}.`,
      steps: [step(`Add the values: ${xs.map(num).join(' + ')} = ${dec(sum)}.`), step(`Divide by how many there are (${n}): ${dec(sum)} ÷ ${n} ${show(mean).startsWith('≈') ? show(mean) : `= ${show(mean)}`}.`, `\\bar{x} = ${dec(mean.toDecimalPlaces(4, D.ROUND_HALF_UP))}`)],
      answer: { display: show(mean) },
    };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  if (kind === 'median') {
    const steps = [step(`Sort the values: ${sorted.map(num).join(', ')}.`)];
    let med: Dec;
    if (n % 2) {
      med = new D(sorted[(n - 1) / 2]!);
      steps.push(step(`With ${n} values, the middle one is number ${(n + 1) / 2}: ${dec(med)}.`));
    } else {
      const a = new D(sorted[n / 2 - 1]!), b = new D(sorted[n / 2]!);
      med = a.plus(b).div(2);
      steps.push(step(`With ${n} values, the two middle ones are ${dec(a)} and ${dec(b)}.`), step(`Average them: (${dec(a)} + ${dec(b)}) ÷ 2 = ${dec(med)}.`));
    }
    return { title: 'Finding the median', question: `Find the median of ${list}.`, steps, answer: { display: dec(med) } };
  }
  if (kind === 'range') {
    const r = new D(sorted[n - 1]!).minus(sorted[0]!);
    return {
      title: 'Finding the range',
      question: `Find the range of ${list}.`,
      steps: [step(`The largest value is ${num(sorted[n - 1]!)} and the smallest is ${num(sorted[0]!)}.`), step(`Range = ${num(sorted[n - 1]!)} − ${sorted[0]! < 0 ? `(${num(sorted[0]!)})` : num(sorted[0]!)} = ${dec(r)}.`)],
      answer: { display: dec(r) },
    };
  }
  if (kind === 'mode') {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const top = Math.max(...counts.values());
    const modes = [...counts].filter(([, c]) => c === top).map(([x]) => x);
    if (top < 2 || modes.length !== 1) return null; // no mode, or several: not a single answer
    return {
      title: 'Finding the mode',
      question: `Find the mode of ${list}.`,
      steps: [step(`Sort the values: ${sorted.map(num).join(', ')}.`), step(`${num(modes[0]!)} appears most often (${top} times), so it is the mode.`)],
      answer: { display: num(modes[0]!) },
    };
  }
  // Sample unless "population" is said: the same default as the stats engine that gives the answer above.
  const sample = !/population/i.test(kind);
  if (sample && n < 2) return null;
  const sq = ds.map((x) => x.minus(mean).pow(2));
  const ss = sq.reduce((a, b) => a.plus(b), new D(0));
  const variance = ss.div(sample ? n - 1 : n);
  const word = sample ? 'sample' : 'population';
  const steps = [
    step(`Mean: ${dec(sum)} ÷ ${n} ${show(mean).startsWith('≈') ? show(mean) : `= ${show(mean)}`}.`),
    step(`Square each distance from the mean and add them: ${show(ss).replace(/^≈ /, '≈ ')}.`),
    step(sample ? `Divide by n − 1 = ${n - 1} for a sample variance: ${show(variance)}.` : `Divide by n = ${n} for the population variance: ${show(variance)}.`, `${sample ? 's' : '\\sigma'}^2 = ${dec(variance.toDecimalPlaces(4, D.ROUND_HALF_UP))}`),
  ];
  if (/variance/.test(kind)) return { title: `Finding the ${word} variance`, question: `Find the ${word} variance of ${list}.`, steps, answer: { display: show(variance) } };
  const sd = variance.sqrt();
  steps.push(step(`Take the square root: ${show(sd)}.`, `${sample ? 's' : '\\sigma'} = ${dec(sd.toDecimalPlaces(4, D.ROUND_HALF_UP))}`));
  return { title: `Finding the ${word} standard deviation`, question: `Find the ${word} standard deviation of ${list}.`, steps, answer: { display: show(sd) } };
}

// ---------- geometry ----------

/** "9π" with a decimal check, or a plain number. */
function piAnswer(k: Dec): { display: string; tex: string; approx: string } {
  const r = k.toDecimalPlaces(4);
  const exactK = r.eq(k) ? dec(k) : null;
  const approx = dec(k.mul(D.acos(-1)).toDecimalPlaces(2, D.ROUND_HALF_UP));
  if (exactK !== null) return { display: `${exactK === '1' ? '' : exactK}π`, tex: `${exactK === '1' ? '' : exactK}\\pi`, approx };
  const f = fracOf(k.toNumber());
  return { display: `${f.n === 1 ? '' : f.n}π/${f.d}`, tex: `\\frac{${f.n === 1 ? '' : f.n}\\pi}{${f.d}}`, approx };
}

function geometryQuery(q: string): Worked | null {
  const s = q.toLowerCase().replace(/[?.]\s*$/, '');
  const numAfter = (word: string) => {
    const m = new RegExp(String.raw`\b${word}\b\s*(?:of|is|=|:)?\s*(${NUM})`).exec(s) ?? new RegExp(String.raw`(${NUM})\s*(?:[a-z]+\s+)?${word}\b`).exec(s);
    return m ? new D(N(m[1]!)) : null;
  };
  const unitM = new RegExp(String.raw`(?:${NUM})\s*(cm|mm|m|km|in|ft|yd|inches|feet|meters?)\b`).exec(s);
  const u = unitM ? ({ inches: 'in', feet: 'ft', meter: 'm', meters: 'm' } as Record<string, string>)[unitM[1]!] ?? unitM[1]! : '';
  const withU = (x: string, p = 1) => (u ? `${x} ${u}${p === 2 ? '²' : p === 3 ? '³' : ''}` : x);
  const radius = () => {
    const r = numAfter('radius');
    if (r) return r;
    const d = numAfter('diameter');
    return d ? d.div(2) : null;
  };
  if (/\bcircle\b/.test(s) && /\b(area|circumference|perimeter)\b/.test(s)) {
    const r = radius();
    if (!r || r.lte(0)) return null;
    const fromD = !numAfter('radius');
    const area = /\barea\b/.test(s);
    const k = area ? r.pow(2) : r.mul(2);
    const a = piAnswer(k);
    const steps = fromD ? [step(`The radius is half the diameter: r = ${dec(r)}.`)] : [];
    if (area) steps.push(step('Area of a circle = πr².', 'A = \\pi r^2'), step(`r² = ${dec(r)}² = ${dec(k)}, so A = ${a.display} ≈ ${a.approx}.`, `A = ${a.tex}`));
    else steps.push(step('Circumference = 2πr.', 'C = 2\\pi r'), step(`2 × ${dec(r)} = ${dec(k)}, so C = ${a.display} ≈ ${a.approx}.`, `C = ${a.tex}`));
    return { title: area ? 'Area of a circle' : 'Circumference of a circle', question: `Find the ${area ? 'area' : 'circumference'} of a circle with radius ${withU(dec(r))}.`, steps, answer: { display: withU(a.display, area ? 2 : 1), tex: a.tex } };
  }
  if (/\b(sphere|ball)\b/.test(s) && /\bvolume\b/.test(s)) {
    const r = radius();
    if (!r || r.lte(0)) return null;
    const k = r.pow(3).mul(4).div(3);
    const a = piAnswer(k);
    return {
      title: 'Volume of a sphere',
      question: `Find the volume of a sphere with radius ${withU(dec(r))}.`,
      steps: [step('Volume of a sphere = ⁴⁄₃πr³.', 'V = \\tfrac43 \\pi r^3'), step(`${dec(r)}³ = ${dec(r.pow(3))}.`), step(`4 × ${dec(r.pow(3))} ÷ 3, so V = ${a.display} ≈ ${a.approx}.`, `V = ${a.tex}`)],
      answer: { display: withU(a.display, 3), tex: a.tex },
    };
  }
  if (/\b(cylinder|cone)\b/.test(s) && /\bvolume\b/.test(s)) {
    const r = radius(), h = numAfter('height') ?? numAfter('tall') ?? numAfter('high');
    if (!r || !h || r.lte(0) || h.lte(0)) return null;
    const cone = /\bcone\b/.test(s);
    const k = r.pow(2).mul(h).div(cone ? 3 : 1);
    const a = piAnswer(k);
    return {
      title: cone ? 'Volume of a cone' : 'Volume of a cylinder',
      question: `Find the volume of a ${cone ? 'cone' : 'cylinder'} with radius ${withU(dec(r))} and height ${withU(dec(h))}.`,
      steps: [
        cone ? step('Volume of a cone = ⅓πr²h.', 'V = \\tfrac13 \\pi r^2 h') : step('Volume of a cylinder = πr²h.', 'V = \\pi r^2 h'),
        step(`${dec(r)}² × ${dec(h)} = ${dec(r.pow(2).mul(h))}${cone ? `, and ÷ 3 gives ${dec(k.toDecimalPlaces(4))}` : ''}.`),
        step(`So V = ${a.display} ≈ ${a.approx}.`, `V = ${a.tex}`),
      ],
      answer: { display: withU(a.display, 3), tex: a.tex },
    };
  }
  if (/\bhypotenuse\b/.test(s)) {
    const nums = [...s.matchAll(new RegExp(NUM, 'g'))].map((m) => new D(N(m[0])));
    if (nums.length !== 2 || nums.some((x) => x.lte(0))) return null;
    // "hypotenuse 10 and one leg 6, find the other leg": the hypotenuse is given, a leg is wanted.
    const asksHyp = /\b(?:find|what(?:'s| is)|calculate|how long is)\s+(?:the\s+)?(?:length of the\s+)?hypotenuse\b/.test(s);
    const asksLeg = /\b(?:other|missing|remaining|unknown|second|third)\s+(?:leg|side)\b|\b(?:find|what(?:'s| is)|calculate|how long is)\s+(?:the\s+)?(?:length of the\s+)?leg\b/.test(s);
    const hypGiven = new RegExp(String.raw`\bhypotenuse\s*(?:is|=|:|of length|measures|has length)?\s*(${NUM})`).exec(s);
    if (!asksHyp && (asksLeg || (hypGiven && /\bleg\b/.test(s) && !/\blegs\b/.test(s)))) {
      const cm = new RegExp(String.raw`\bhypotenuse\b\s*(?:is|=|:|of|of length|measures|has length)?\s*(${NUM})`).exec(s) ?? new RegExp(String.raw`(${NUM})\s*(?:[a-z]+\s+)?(?:for the\s+|as the\s+)?hypotenuse\b`).exec(s);
      if (!cm) return null;
      const c = new D(N(cm[1]!));
      const others = nums.filter((x) => !x.eq(c));
      const a = others.length === 1 ? others[0]! : null;
      if (!a || c.lte(a)) return null;
      const b2 = c.pow(2).minus(a.pow(2));
      const b = b2.sqrt();
      const r = b.toDecimalPlaces(4, D.ROUND_HALF_UP);
      const shown = r.eq(b) ? dec(b) : `≈ ${dec(b.toDecimalPlaces(2, D.ROUND_HALF_UP))}`;
      return {
        title: 'Finding a leg from the hypotenuse',
        question: `A right triangle has hypotenuse ${withU(dec(c))} and one leg ${withU(dec(a))}. Find the other leg.`,
        steps: [
          step('Pythagoras: a² + b² = c², so b² = c² − a².', 'b^2 = c^2 - a^2'),
          step(`${dec(c)}² − ${dec(a)}² = ${dec(c.pow(2))} − ${dec(a.pow(2))} = ${dec(b2)}.`, `b^2 = ${dec(b2)}`),
          step(`b = √${dec(b2)} ${r.eq(b) ? '=' : ''} ${shown}.`.replace('  ', ' '), `b = ${shown.replace('≈ ', '\\approx ')}`),
        ],
        answer: { display: withU(shown) },
      };
    }
    const [a, b] = nums as [Dec, Dec];
    const c2 = a.pow(2).plus(b.pow(2));
    const c = c2.sqrt();
    const r = c.toDecimalPlaces(4, D.ROUND_HALF_UP);
    const shown = r.eq(c) ? dec(c) : `≈ ${dec(c.toDecimalPlaces(2, D.ROUND_HALF_UP))}`;
    return {
      title: 'Finding the hypotenuse',
      question: `A right triangle has legs ${withU(dec(a))} and ${withU(dec(b))}. Find the hypotenuse.`,
      steps: [step('Pythagoras: c² = a² + b².', 'c^2 = a^2 + b^2'), step(`${dec(a)}² + ${dec(b)}² = ${dec(a.pow(2))} + ${dec(b.pow(2))} = ${dec(c2)}.`, `c^2 = ${dec(c2)}`), step(`c = √${dec(c2)} ${r.eq(c) ? '=' : ''} ${shown}.`.replace('  ', ' '), `c = ${shown.replace('≈ ', '\\approx ')}`)],
      answer: { display: withU(shown) },
    };
  }
  if (/\btriangle\b/.test(s) && /\barea\b/.test(s)) {
    const b = numAfter('base'), h = numAfter('height');
    if (!b || !h) return null;
    const a = b.mul(h).div(2);
    return {
      title: 'Area of a triangle',
      question: `Find the area of a triangle with base ${withU(dec(b))} and height ${withU(dec(h))}.`,
      steps: [step('Area of a triangle = ½ × base × height.', 'A = \\tfrac12 bh'), step(`½ × ${dec(b)} × ${dec(h)} = ${dec(a)}.`, `A = ${dec(a)}`)],
      answer: { display: withU(dec(a), 2) },
    };
  }
  if (/\b(rectangle|square)\b/.test(s) && /\b(area|perimeter)\b/.test(s)) {
    const nums = [...s.matchAll(new RegExp(NUM, 'g'))].map((m) => new D(N(m[0])));
    const square = /\bsquare\b/.test(s) && nums.length === 1;
    if (!(nums.length === 2 || square) || nums.some((x) => x.lte(0))) return null;
    const l = nums[0]!, w = square ? l : nums[1]!;
    const area = /\barea\b/.test(s);
    const v = area ? l.mul(w) : l.plus(w).mul(2);
    const shape = square ? 'square' : 'rectangle';
    return {
      title: `${area ? 'Area' : 'Perimeter'} of a ${shape}`,
      question: square ? `Find the ${area ? 'area' : 'perimeter'} of a square with side ${withU(dec(l))}.` : `Find the ${area ? 'area' : 'perimeter'} of a ${withU(dec(l))} by ${withU(dec(w))} rectangle.`,
      steps: area
        ? [step(`Area = length × width.`, 'A = lw'), step(`${dec(l)} × ${dec(w)} = ${dec(v)}.`, `A = ${dec(v)}`)]
        : [step('Perimeter = 2 × (length + width).', 'P = 2(l + w)'), step(`2 × (${dec(l)} + ${dec(w)}) = ${dec(v)}.`, `P = ${dec(v)}`)],
      answer: { display: withU(dec(v), area ? 2 : 1) },
    };
  }
  return null;
}

// ---------- fractions ----------

function fractionQuery(q: string): Worked | null {
  const m = /^\s*(?:what(?:'s| is)\s+|calculate\s+|simplify\s+)?\(?\s*([-−]?\d+)\s*\/\s*(\d+)\s*\)?\s*(\+|-|−|plus|minus|×|\*|x|times|÷|divided by|\/)\s*\(?\s*([-−]?\d+)\s*\/\s*(\d+)\s*\)?\s*[?=.]?\s*$/i.exec(q);
  if (!m) return null;
  if (N(m[2]!) === 0 || N(m[5]!) === 0) return null;
  const a = new Q(N(m[1]!), N(m[2]!)), b = new Q(N(m[4]!), N(m[5]!));
  const op = m[3]!.toLowerCase();
  let res: { steps: Step[]; r: Q };
  let sym: string;
  if (op === '+' || op === 'plus') [res, sym] = [addSteps(a, b, '+'), '+'];
  else if (op === '-' || op === '−' || op === 'minus') [res, sym] = [addSteps(a, b, '−'), '−'];
  else if (op === '÷' || op === 'divided by' || op === '/') {
    if (b.n === 0) return null;
    [res, sym] = [divSteps(a, b), '÷'];
  } else [res, sym] = [mulSteps(a, b), '×'];
  const qa = `${m[1]!.replace('-', '−')}/${m[2]}`, qb = `${m[4]!.replace('-', '−')}/${m[5]}`;
  return {
    title: 'Working with fractions',
    question: `Calculate ${qa} ${sym} ${qb}.`,
    questionTex: `\\frac{${N(m[1]!)}}{${m[2]}} ${toTex(sym)} \\frac{${N(m[4]!)}}{${m[5]}}`,
    steps: res.steps,
    answer: { display: res.r.toString(), tex: res.r.tex() },
  };
}

/**
 * Worked steps for the user's own question, for the forms the generators know how to solve.
 * Returns null for anything it can't solve with confidence.
 */
export function worked(query: string): Worked | null {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q || q.length > 300) return null;
  const tries: ((s: string) => Worked | null)[] = [derivativeQuery, integralQuery, percentQuery, unitsQuery, statsQuery, geometryQuery, fractionQuery];
  const eqs = (q.match(/=/g) ?? []).length;
  // "y" may carry a coefficient ("3x + 2y = 12"), so no word boundary before it.
  if (eqs === 2 && /(?<![a-z])y(?![a-z])/i.test(q)) tries.unshift(twoVariables);
  else if (eqs === 1) tries.unshift(oneVariable);
  for (const t of tries) {
    try {
      const w = t(q);
      if (w) return w;
    } catch {
      // A solver that trips over unexpected input simply doesn't apply.
    }
  }
  return null;
}
