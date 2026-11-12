import {
  deriv,
  exprPlain,
  exprTex,
  fnPlain,
  poly,
  polyDeriv,
  polyPlain,
  polyTex,
  simplify,
  termDeriv,
  termPlain,
  termTex,
  X,
  coefPlain,
  type Expr,
  type Fn,
  type Poly,
  type Term,
} from './calculus';
import { num } from './format';
import type { Rng } from './rng';
import type { Difficulty, Draft, Step } from './types';

const kx = (k: number): Poly => [{ c: k, n: 1 }];

function trigOrExp(rng: Rng, k: number): Fn {
  return { kind: rng.pick(['sin', 'cos', 'exp'] as const), arg: kx(k) };
}

/** Distinct powers from `from`, highest first. */
function powers(rng: Rng, from: number[], count: number): number[] {
  return rng.shuffle(from).slice(0, count).sort((a, b) => b - a);
}

// ---------- derivative ----------

function derivStep(t: Term): Step {
  const d = simplify(termDeriv(t));
  const res = exprPlain(d);
  const resTex = exprTex(d);
  const lhs = termPlain(t);
  const tex = `\\frac{d}{dx}\\left[${termTex(t)}\\right] = ${resTex}`;
  const f = t.f;
  if (!f) {
    if (t.n === 0) return { text: `The constant ${lhs} has derivative 0.`, tex };
    if (t.n === 1) return { text: `The derivative of ${lhs} is ${res}.`, tex };
    if (t.n < 0) return { text: `Write ${lhs} as ${coefPlain(t.c)}x^${num(t.n)}; the power rule gives ${res}.`, tex };
    return { text: `Power rule: bring down the ${t.n} and lower the power by one: ${lhs} becomes ${res}.`, tex };
  }
  if (t.n !== 0) {
    const u = termPlain({ c: t.c, n: t.n });
    const du = exprPlain(termDeriv({ c: t.c, n: t.n }));
    const v = fnPlain(f);
    const dv = exprPlain(simplify(termDeriv({ c: 1, n: 0, f })));
    return { text: `Product rule with u = ${u} and v = ${v}: u′ = ${du}, v′ = ${dv}, so u′v + uv′ = ${res}.`, tex };
  }
  if (f.kind === 'ln') return { text: `The derivative of ln x is 1/x, so ${lhs} becomes ${res}.`, tex };
  const inner = polyPlain(f.arg);
  const innerD = polyPlain(polyDeriv(f.arg));
  const simpleArg = f.arg.length === 1 && f.arg[0]!.n === 1;
  if (simpleArg && f.arg[0]!.c === 1) {
    const rule = f.kind === 'sin' ? 'sin x is cos x' : f.kind === 'cos' ? 'cos x is −sin x' : 'e^x is itself';
    return { text: `The derivative of ${rule}, so ${lhs} becomes ${res}.`, tex };
  }
  if (f.kind === 'pow') {
    return { text: `Chain rule: bring down the ${f.m}, lower the power to ${f.m - 1}, and multiply by the inside's derivative ${innerD}: ${res}.`, tex };
  }
  const outer = f.kind === 'sin' ? 'sin becomes cos' : f.kind === 'cos' ? 'cos becomes −sin' : 'e^u stays e^u';
  return { text: `Chain rule: ${outer}, then multiply by the derivative of the inside ${inner}, which is ${innerD}: ${res}.`, tex };
}

/** Steps and answer for d/dx of f, shared by generated questions and worked solutions. */
export function derivativeSolution(f: Expr): { prompt: string; promptTex: string; steps: Step[]; answer: string; answerTex: string } {
  const d = deriv(f);
  const steps: Step[] = f.map(derivStep);
  if (f.length > 1) steps.push({ text: 'Add the results.', tex: `f'(x) = ${exprTex(d)}` });
  return {
    prompt: `Find the derivative of f(x) = ${exprPlain(f)}.`,
    promptTex: `\\frac{d}{dx}\\left[${exprTex(f)}\\right]`,
    steps,
    answer: exprPlain(d),
    answerTex: exprTex(d),
  };
}

function derivativeDraft(f: Expr, hint: string): Draft {
  const s = derivativeSolution(f);
  return { prompt: s.prompt, promptTex: s.promptTex, answer: { display: s.answer, tex: s.answerTex, kind: 'expression' }, steps: s.steps, hint };
}

export function derivative(rng: Rng, diff: Difficulty): Draft {
  if (diff === 1) {
    const ns = powers(rng, [4, 3, 2, 1, 0], 3);
    if (!ns.some((n) => n >= 2)) ns[0] = 3;
    const f: Expr = ns.map((n) => ({ c: rng.signed(1, 9), n }));
    return derivativeDraft(f, 'Use the power rule on each term: d/dx xⁿ = n·xⁿ⁻¹.');
  }
  if (diff === 2) {
    const p: Term = rng.chance(0.25) ? { c: rng.signed(1, 6), n: -rng.int(1, 3) } : { c: rng.signed(1, 9), n: rng.int(2, 5) };
    const useLn = rng.chance(0.2);
    const fn: Fn = useLn ? { kind: 'ln' } : trigOrExp(rng, rng.chance(0.5) ? 1 : rng.int(2, 5));
    const g: Term = { c: rng.signed(1, 8), n: 0, f: fn };
    const f = rng.chance(0.5) ? [p, g] : [g, p];
    return derivativeDraft(f, 'Differentiate term by term; for sin(kx), cos(kx) and e^(kx), multiply by k.');
  }
  const kind = rng.pick(['product', 'product', 'chainTrig', 'chainPow'] as const);
  if (kind === 'product') {
    const fn: Fn = rng.chance(0.2) ? { kind: 'ln' } : trigOrExp(rng, rng.chance(0.6) ? 1 : rng.int(2, 3));
    return derivativeDraft([{ c: rng.signed(1, 5), n: rng.int(1, 3), f: fn }], 'This is a product: use (uv)′ = u′v + uv′.');
  }
  if (kind === 'chainTrig') {
    const arg = poly([rng.nz(1, 4), 2], [rng.signed(0, 5), 0]);
    const fn: Fn = { kind: rng.pick(['sin', 'cos', 'exp'] as const), arg };
    return derivativeDraft([{ c: rng.signed(1, 4), n: 0, f: fn }], 'Chain rule: differentiate the outside, keep the inside, then multiply by the inside’s derivative.');
  }
  const arg = rng.chance(0.5) ? poly([rng.int(2, 5), 1], [rng.nz(-6, 6), 0]) : poly([1, 2], [rng.nz(-5, 5), 0]);
  return derivativeDraft([{ c: rng.signed(1, 3), n: 0, f: { kind: 'pow', arg, m: rng.int(3, 5) } }], 'Chain rule: d/dx (inside)ⁿ = n·(inside)ⁿ⁻¹·(inside)′.');
}

// ---------- integral ----------

/** One integration step: ∫ integrandPart dx = antiderivativePart, with the rule that justifies it. */
function integStep(F: Term): Step {
  const part = simplify(termDeriv(F));
  const fp = exprPlain(part);
  const Fp = termPlain(F);
  const tex = `\\int ${exprTex(part)}\\,dx = ${termTex(F)}`;
  const f = F.f;
  if (!f) return { text: `Power rule: raise the power by one and divide by the new power: ∫ ${fp} dx = ${Fp}.`, tex };
  if (f.kind === 'ln') return { text: `∫ 1/x dx = ln|x|, so ∫ ${fp} dx = ${Fp}.`, tex };
  const k = f.kind === 'pow' ? 1 : f.arg[0]!.c;
  const base = f.kind === 'sin' ? '∫ cos(kx) dx = sin(kx)/k' : f.kind === 'cos' ? '∫ sin(kx) dx = −cos(kx)/k' : '∫ e^(kx) dx = e^(kx)/k';
  if (k === 1) {
    const b = f.kind === 'sin' ? '∫ cos x dx = sin x' : f.kind === 'cos' ? '∫ sin x dx = −cos x' : '∫ e^x dx = e^x';
    return { text: `${b}, so ∫ ${fp} dx = ${Fp}.`, tex };
  }
  return { text: `${base}; with k = ${k}, ∫ ${fp} dx = ${Fp}.`, tex };
}

/** One step per antiderivative term. */
export function integralSteps(F: Expr): Step[] {
  return F.map(integStep);
}

function indefiniteDraft(F: Expr, steps: Step[], hint: string): Draft {
  const f = deriv(F);
  const ans = exprPlain(F) + ' + C';
  const ansTex = exprTex(F) + ' + C';
  steps.push({ text: 'Add the constant of integration.', tex: ansTex });
  return {
    prompt: `Find ∫ (${exprPlain(f)}) dx.`,
    promptTex: `\\int \\left(${exprTex(f)}\\right)\\,dx`,
    answer: { display: ans, tex: ansTex, kind: 'expression' },
    steps,
    hint,
  };
}

function evalPoly(F: Expr, x: number): number {
  return F.reduce((s, t) => s + t.c * x ** t.n, 0);
}

export function integral(rng: Rng, diff: Difficulty): Draft {
  if (diff === 1) {
    const ns = powers(rng, [4, 3, 2, 1], 3);
    const F: Expr = ns.map((n) => ({ c: rng.signed(1, 5), n }));
    return indefiniteDraft(F, F.map(integStep), 'Power rule backwards: ∫ xⁿ dx = xⁿ⁺¹/(n+1). Don’t forget + C.');
  }
  if (diff === 2) {
    const p: Term = { c: rng.signed(1, 5), n: rng.int(1, 4) };
    const g: Term = rng.chance(0.2)
      ? { c: rng.signed(1, 6), n: 0, f: { kind: 'ln', abs: true } }
      : { c: rng.signed(1, 4), n: 0, f: trigOrExp(rng, rng.chance(0.4) ? 1 : rng.int(2, 4)) };
    const F = rng.chance(0.5) ? [p, g] : [g, p];
    return indefiniteDraft(F, F.map(integStep), 'Integrate term by term; ∫ cos(kx) dx = sin(kx)/k and ∫ e^(kx) dx = e^(kx)/k.');
  }
  const kind = rng.pick(['parts', 'sub', 'definite'] as const);
  if (kind === 'definite') {
    const ns = powers(rng, [3, 2, 1], 2);
    const F: Expr = ns.map((n) => ({ c: rng.signed(1, 4), n }));
    const f = deriv(F);
    const a = rng.int(-2, 1);
    const b = a + rng.int(1, 3);
    const Fb = evalPoly(F, b);
    const Fa = evalPoly(F, a);
    const v = Fb - Fa;
    return {
      prompt: `Evaluate ∫ from ${num(a)} to ${num(b)} of (${exprPlain(f)}) dx.`,
      promptTex: `\\int_{${a}}^{${b}} \\left(${exprTex(f)}\\right)\\,dx`,
      answer: { display: num(v), tex: String(v), kind: 'number' },
      steps: [
        ...F.map(integStep),
        { text: `So an antiderivative is F(x) = ${exprPlain(F)}.`, tex: `F(x) = ${exprTex(F)}` },
        { text: `Evaluate at the upper limit: F(${num(b)}) = ${num(Fb)}.`, tex: `F(${b}) = ${Fb}` },
        { text: `Evaluate at the lower limit: F(${num(a)}) = ${num(Fa)}.`, tex: `F(${a}) = ${Fa}` },
        { text: `Subtract: ${num(Fb)} − ${Fa < 0 ? `(${num(Fa)})` : num(Fa)} = ${num(v)}.`, tex: `F(${b}) - F(${a}) = ${v}` },
      ],
      hint: 'Find an antiderivative F, then compute F(upper) − F(lower).',
    };
  }
  if (kind === 'parts') {
    const k = rng.int(1, 3);
    const b = rng.signed(1, 3);
    const which = rng.pick(['exp', 'cos', 'sin'] as const);
    // Integrand b·k²·x·g(kx); antiderivative chosen so every coefficient is an integer.
    let F: Expr;
    let v: string;
    if (which === 'exp') {
      F = [{ c: b * k, n: 1, f: { kind: 'exp', arg: kx(k) } }, { c: -b, n: 0, f: { kind: 'exp', arg: kx(k) } }];
      v = fnPlain({ kind: 'exp', arg: kx(k) });
    } else if (which === 'cos') {
      F = [{ c: b * k, n: 1, f: { kind: 'sin', arg: kx(k) } }, { c: b, n: 0, f: { kind: 'cos', arg: kx(k) } }];
      v = fnPlain({ kind: 'sin', arg: kx(k) });
    } else {
      F = [{ c: -b * k, n: 1, f: { kind: 'cos', arg: kx(k) } }, { c: b, n: 0, f: { kind: 'sin', arg: kx(k) } }];
      v = fnPlain({ kind: 'cos', arg: kx(k) });
    }
    const vTerm: Term = { c: which === 'sin' ? -b * k : b * k, n: 0, f: F[0]!.f };
    const back: Term = { ...F[1]!, c: -F[1]!.c };
    const steps: Step[] = [
      { text: `Integrate by parts with u = x and dv = ${exprPlain(simplify(termDeriv(vTerm)))} dx.`, tex: '\\int u\\,dv = uv - \\int v\\,du' },
      { text: `Then du = dx and v = ${termPlain(vTerm)}.`, tex: `v = ${termTex(vTerm)}` },
      { text: `uv = ${termPlain(F[0]!)}.`, tex: `uv = ${termTex(F[0]!)}` },
      { text: `∫ v du = ∫ ${termPlain(vTerm)} dx = ${termPlain(back)}; subtract it.`, tex: `\\int v\\,du = ${termTex(back)}` },
    ];
    return indefiniteDraft(F, steps, 'Integration by parts: let u = x so it disappears when differentiated.');
  }
  // u-substitution: integrand is (inside)′ × g(inside), with inside = x² + c.
  const c0 = rng.signed(0, 5);
  const inside = poly([1, 2], [c0, 0]);
  const g = rng.pick(['cos', 'sin', 'exp', 'pow'] as const);
  const b = rng.signed(1, 4);
  let F: Expr;
  if (g === 'pow') F = [{ c: b, n: 0, f: { kind: 'pow', arg: inside, m: rng.int(3, 4) } }];
  else if (g === 'cos') F = [{ c: b, n: 0, f: { kind: 'sin', arg: inside } }];
  else if (g === 'sin') F = [{ c: b, n: 0, f: { kind: 'cos', arg: inside } }];
  else F = [{ c: b, n: 0, f: { kind: 'exp', arg: inside } }];
  const U = polyPlain(inside);
  const fn = F[0]!.f!;
  // The same antiderivative written in u instead of x² + c.
  const uF: Term = fn.kind === 'pow' ? { c: b, n: fn.m } : fn.kind === 'ln' ? { c: b, n: 0, f: fn } : { c: b, n: 0, f: { kind: fn.kind, arg: X } };
  const uIntegrand = simplify(termDeriv(uF));
  const toU = (s: string) => s.replace(/x/g, 'u');
  const steps: Step[] = [
    { text: `Substitute u = ${U}, so du = 2x dx.`, tex: `u = ${polyTex(inside)},\\quad du = 2x\\,dx` },
    { text: `The integral becomes ∫ ${toU(exprPlain(uIntegrand))} du.`, tex: `\\int ${toU(exprTex(uIntegrand))}\\,du` },
    { text: `Integrate in u: ${toU(termPlain(uF))}.`, tex: toU(termTex(uF)) },
    { text: `Put u = ${U} back.`, tex: exprTex(F) },
  ];
  return indefiniteDraft(F, steps, 'Look for a function times its inside’s derivative: try u = x² + c.');
}
