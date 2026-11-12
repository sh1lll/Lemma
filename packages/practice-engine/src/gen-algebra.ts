import { coefVar, gcd, joinSigned, lcm, MINUS, num, Q, toTex } from './format';
import type { Rng } from './rng';
import type { Difficulty, Draft, Step } from './types';

/** Number in parentheses when negative, for use inside an expression: 5 − (−3). */
const par = (n: number) => (n < 0 ? `(${num(n)})` : num(n));
const parQ = (q: Q) => (q.n < 0 ? `(${q})` : q.toString());
const step = (text: string, tex?: string): Step => (tex === undefined ? { text } : { text, tex });

// ---------- arithmetic ----------

export function arithmetic(rng: Rng, diff: Difficulty): Draft {
  const hint = 'Order of operations: parentheses, exponents, then × and ÷ left to right, then + and − left to right.';
  let expr: string;
  let steps: Step[];
  let r: number;
  if (diff === 1) {
    const t = rng.int(0, 2);
    if (t === 0) {
      const a = rng.int(1, 20), b = rng.int(2, 9), c = rng.int(2, 9);
      r = a + b * c;
      expr = `${a} + ${b} × ${c}`;
      steps = [step(`Multiply before adding: ${b} × ${c} = ${b * c}.`, `${a} + ${b * c}`), step(`Add: ${a} + ${b * c} = ${r}.`, String(r))];
    } else if (t === 1) {
      const a = rng.int(2, 9), b = rng.int(2, 9), c = rng.int(1, 20);
      r = a * b - c;
      expr = `${a} × ${b} − ${c}`;
      steps = [step(`Multiply first: ${a} × ${b} = ${a * b}.`, `${a * b} - ${c}`), step(`Subtract: ${a * b} − ${c} = ${num(r)}.`, String(r))];
    } else {
      const c = rng.int(2, 9), k = rng.int(2, 9), a = rng.int(1, 30);
      r = a - k;
      expr = `${a} − ${c * k} ÷ ${c}`;
      steps = [step(`Divide before subtracting: ${c * k} ÷ ${c} = ${k}.`, `${a} - ${k}`), step(`Subtract: ${a} − ${k} = ${num(r)}.`, String(r))];
    }
  } else if (diff === 2) {
    if (rng.chance(0.5)) {
      const a = rng.int(1, 12), b = rng.int(1, 12), c = rng.int(2, 6), e = rng.int(2, 6), k = rng.int(1, 9);
      const s = a + b, p = s * c;
      r = p - k;
      expr = `(${a} + ${b}) × ${c} − ${e * k} ÷ ${e}`;
      steps = [
        step(`Parentheses first: ${a} + ${b} = ${s}.`, `${s} \\times ${c} - ${e * k} \\div ${e}`),
        step(`Multiply: ${s} × ${c} = ${p}.`, `${p} - ${e * k} \\div ${e}`),
        step(`Divide: ${e * k} ÷ ${e} = ${k}.`, `${p} - ${k}`),
        step(`Subtract: ${p} − ${k} = ${num(r)}.`, String(r)),
      ];
    } else {
      const a = rng.int(2, 9), b = rng.int(5, 15), c = rng.int(1, 9), d = rng.int(2, 5);
      const s = b - c, p = a * s, q = d * d;
      r = p + q;
      expr = `${a} × (${b} − ${c}) + ${d}^2`;
      const sTex = s < 0 ? `(${s})` : String(s);
      steps = [
        step(`Parentheses first: ${b} − ${c} = ${num(s)}.`, `${a} \\times ${sTex} + ${d}^{2}`),
        step(`Exponent: ${d}^2 = ${q}.`, `${a} \\times ${sTex} + ${q}`),
        step(`Multiply: ${a} × ${par(s)} = ${num(p)}.`, `${p} + ${q}`),
        step(`Add: ${num(p)} + ${q} = ${num(r)}.`, String(r)),
      ];
    }
  } else {
    const a = rng.int(2, 7), e = rng.int(2, 5), m = rng.int(1, 4), b = e * m;
    const c = rng.int(1, 9);
    let diffCD = rng.nz(-6, 6);
    if (diffCD === c) diffCD = -diffCD;
    const d = c - diffCD, f = rng.signed(1, 15);
    const sq = a * a, P = b * diffCD, Qv = P / e;
    r = sq - Qv + f;
    expr = `(${MINUS}${a})^2 − ${b} × (${c} − ${par(d)}) ÷ ${e} ${f < 0 ? MINUS : '+'} ${Math.abs(f)}`;
    steps = [
      step(`Parentheses first: ${c} − ${par(d)} = ${num(diffCD)}.`),
      step(`Exponent: (${MINUS}${a})^2 = ${sq}. A negative number squared is positive.`),
      step(`Multiply and divide left to right: ${b} × ${par(diffCD)} = ${num(P)}, then ${num(P)} ÷ ${e} = ${num(Qv)}.`),
      step(`Add and subtract left to right: ${sq} − ${par(Qv)} ${f < 0 ? MINUS : '+'} ${Math.abs(f)} = ${num(r)}.`, String(r)),
    ];
  }
  return { prompt: `Evaluate ${expr}.`, promptTex: toTex(expr), answer: { display: num(r), tex: String(r), kind: 'number' }, steps, hint };
}

// ---------- fractions ----------

const fr = (q: Q) => q.toString();
/** A fraction operand as written in a prompt: always a/b, parenthesised so ÷ reads unambiguously. */
const opnd = (n: number, d: number) => `${n}/${d}`;

export function addSteps(a: Q, b: Q, op: '+' | '−'): { steps: Step[]; r: Q } {
  const r = op === '+' ? a.add(b) : a.sub(b);
  const sym = op === '+' ? '+' : '-';
  if (a.d === b.d) {
    const top = op === '+' ? a.n + b.n : a.n - b.n;
    const steps = [step(`The denominators match, so ${op === '+' ? 'add' : 'subtract'} the numerators: ${num(a.n)} ${op} ${par(b.n)} = ${num(top)}.`, `\\frac{${top}}{${a.d}}`)];
    if (r.d !== a.d) steps.push(step(`Simplify by dividing top and bottom by ${gcd(top, a.d)}: ${fr(r)}.`, r.tex()));
    return { steps, r };
  }
  const L = lcm(a.d, b.d);
  const an = a.n * (L / a.d), bn = b.n * (L / b.d);
  const top = op === '+' ? an + bn : an - bn;
  const steps = [
    step(`The least common denominator of ${a.d} and ${b.d} is ${L}.`),
    step(`Rewrite: ${fr(a)} = ${num(an)}/${L} and ${fr(b)} = ${num(bn)}/${L}.`, `\\frac{${an}}{${L}} ${sym} \\frac{${bn}}{${L}}`),
    step(`${op === '+' ? 'Add' : 'Subtract'} the numerators: ${num(an)} ${op} ${par(bn)} = ${num(top)}, giving ${num(top)}/${L}.`, `\\frac{${top}}{${L}}`),
  ];
  if (r.d !== L) steps.push(step(`Simplify by dividing top and bottom by ${gcd(top, L)}: ${fr(r)}.`, r.tex()));
  return { steps, r };
}

export function mulSteps(a: Q, b: Q): { steps: Step[]; r: Q } {
  const r = a.mul(b);
  const tn = a.n * b.n, td = a.d * b.d;
  const steps = [step(`Multiply the numerators and the denominators: (${num(a.n)} × ${par(b.n)})/(${a.d} × ${b.d}) = ${num(tn)}/${td}.`, `\\frac{${tn}}{${td}}`)];
  if (r.d !== td || r.n !== tn) steps.push(step(`Simplify by dividing top and bottom by ${gcd(tn, td)}: ${fr(r)}.`, r.tex()));
  return { steps, r };
}

export function divSteps(a: Q, b: Q): { steps: Step[]; r: Q } {
  const recip = new Q(b.d, b.n);
  const m = mulSteps(a, recip);
  return { steps: [step(`Dividing by ${fr(b)} is the same as multiplying by its reciprocal ${fr(recip)}.`, `${a.tex()} \\times ${recip.tex()}`), ...m.steps], r: m.r };
}

function properFraction(rng: Rng, dmax: number): Q {
  const d = rng.int(2, dmax);
  return new Q(rng.int(1, d - 1), d);
}

export function fractions(rng: Rng, diff: Difficulty): Draft {
  let expr: string;
  let res: { steps: Step[]; r: Q };
  if (diff === 1) {
    if (rng.chance(0.5)) {
      const d = rng.int(3, 12);
      const a = rng.int(1, d - 1), b = rng.int(1, d - 1);
      const op = a > b && rng.chance(0.4) ? '−' : '+';
      expr = `${opnd(a, d)} ${op} ${opnd(b, d)}`;
      const top = op === '+' ? a + b : a - b;
      const r = new Q(top, d);
      const steps = [step(`The denominators match, so ${op === '+' ? 'add' : 'subtract'} the numerators: ${a} ${op} ${b} = ${top}.`, `\\frac{${top}}{${d}}`)];
      if (r.d !== d) steps.push(step(`Simplify by dividing top and bottom by ${gcd(top, d)}: ${fr(r)}.`, r.tex()));
      res = { steps, r };
    } else {
      const a = properFraction(rng, 9), b = properFraction(rng, 9);
      expr = `${fr(a)} × ${fr(b)}`;
      res = mulSteps(a, b);
    }
  } else if (diff === 2) {
    const a = properFraction(rng, 12);
    let b = properFraction(rng, 12);
    while (b.d === a.d) b = properFraction(rng, 12);
    const t = rng.int(0, 2);
    if (t === 2) {
      expr = `(${fr(a)}) ÷ (${fr(b)})`;
      res = divSteps(a, b);
    } else {
      const op = t === 0 ? '+' : '−';
      expr = `${fr(a)} ${op} ${fr(b)}`;
      res = addSteps(a, b, op);
    }
  } else {
    const a = properFraction(rng, 8), b = properFraction(rng, 8), c = properFraction(rng, 9);
    if (rng.chance(0.5)) {
      const op = rng.chance(0.5) ? '+' : '−';
      expr = `(${fr(a)} ${op} ${fr(b)}) × ${fr(c)}`;
      const s = addSteps(a, b, op);
      const m = mulSteps(s.r, c);
      res = { steps: [step('Work inside the parentheses first.'), ...s.steps, step(`Now multiply ${fr(s.r)} by ${fr(c)}.`), ...m.steps], r: m.r };
    } else {
      expr = `(${fr(a)}) ÷ (${fr(b)}) − ${fr(c)}`;
      const d = divSteps(a, b);
      const s = addSteps(d.r, c, '−');
      res = { steps: [step('Divide before subtracting.'), ...d.steps, step(`Now subtract ${fr(c)} from ${fr(d.r)}.`), ...s.steps], r: s.r };
    }
  }
  const r = res.r;
  if (res.steps.length && res.steps[res.steps.length - 1]!.tex !== r.tex()) res.steps.push(step(`The answer is ${fr(r)}.`, r.tex()));
  return {
    prompt: `Calculate ${expr}. Give the answer in simplest form.`,
    promptTex: toTex(expr).replace(/(\d+)\/(\d+)/g, '\\frac{$1}{$2}'),
    answer: { display: fr(r), tex: r.tex(), kind: 'number' },
    steps: res.steps,
    hint: 'To add or subtract, use a common denominator; to multiply, multiply straight across; to divide, multiply by the reciprocal.',
  };
}

// ---------- linear ----------

/** "3x + 5", "−x − 2", "4": a·x + b. */
export function lin(a: number, b: number): string {
  const parts: string[] = [];
  if (a !== 0) parts.push(coefVar(a, 'x'));
  if (b !== 0 || a === 0) parts.push(num(b));
  return joinSigned(parts);
}

/** Steps for a·x + b = c·x + d (integers). Null when there is no single solution. */
export function solveLinear(a: number, b: number, c: number, d: number): { steps: Step[]; x: Q } | null {
  const k = a - c;
  if (k === 0) return null;
  const steps: Step[] = [];
  if (c !== 0) {
    steps.push(step(c > 0 ? `Subtract ${coefVar(c, 'x')} from both sides.` : `Add ${coefVar(-c, 'x')} to both sides.`, `${toTex(lin(k, b))} = ${d}`));
  }
  const rhs = d - b;
  if (b !== 0) steps.push(step(b > 0 ? `Subtract ${b} from both sides.` : `Add ${-b} to both sides.`, `${toTex(coefVar(k, 'x'))} = ${rhs}`));
  const x = new Q(rhs, k);
  if (k !== 1) steps.push(step(`Divide both sides by ${num(k)}.`, `x = ${x.tex()}`));
  return { steps, x };
}

export function linear(rng: Rng, diff: Difficulty): Draft {
  let eq: string;
  let sol: { steps: Step[]; x: Q } | null;
  if (diff === 1) {
    const a = rng.int(2, 9), xv = rng.int(-10, 10), b = rng.nz(-20, 20);
    const c = a * xv + b;
    eq = `${lin(a, b)} = ${num(c)}`;
    sol = solveLinear(a, b, 0, c);
  } else if (diff === 2 && rng.chance(0.4)) {
    const a = rng.int(2, 6), b = rng.nz(-9, 9), xv = rng.int(-8, 10);
    const c = a * (xv + b);
    eq = `${a}(${lin(1, b)}) = ${num(c)}`;
    const inner = new Q(c, a);
    const rest = solveLinear(1, b, 0, c / a)!;
    sol = { steps: [step(`Divide both sides by ${a}.`, `${toTex(lin(1, b))} = ${inner.tex()}`), ...rest.steps], x: rest.x };
  } else {
    // ax + b = cx + d. Difficulty 3 allows fractional solutions.
    let a: number, b: number, c: number, d: number;
    for (;;) {
      a = rng.signed(1, 9);
      c = rng.signed(1, 9);
      if (a === c) continue;
      b = rng.signed(0, 15);
      if (diff === 2) {
        const xv = rng.int(-9, 9);
        d = (a - c) * xv + b;
        if (Math.abs(d) > 40) continue;
      } else {
        d = rng.signed(0, 20);
        const s = new Q(d - b, a - c);
        if (s.isInt() || s.d > 9) continue;
      }
      break;
    }
    eq = `${lin(a, b)} = ${lin(c, d)}`;
    sol = solveLinear(a, b, c, d);
  }
  const { steps, x } = sol!;
  return {
    prompt: `Solve ${eq}.`,
    promptTex: toTex(eq),
    answer: { display: `x = ${x}`, tex: `x = ${x.tex()}`, kind: 'number' },
    steps,
    hint: 'Get the x terms on one side and the numbers on the other, then divide by the coefficient of x.',
  };
}

// ---------- quadratic ----------

export function quadStr(a: number, b: number, c: number): string {
  const parts = [coefVar(a, 'x^2')];
  if (b) parts.push(coefVar(b, 'x'));
  if (c) parts.push(num(c));
  return joinSigned(parts);
}

/** "(x − 3)", "(2x + 5)" for the factor a·x − p. */
function factor(a: number, p: number): string {
  return `(${lin(a, -p)})`;
}

/** k·√m simplified from √D: returns [k, m]. */
function simplifySurd(D: number): [number, number] {
  let k = 1, m = D;
  for (let f = 2; f * f <= m; f++) while (m % (f * f) === 0) {
    m /= f * f;
    k *= f;
  }
  return [k, m];
}

export interface QuadSolution {
  steps: Step[];
  display: string;
  tex: string;
}

/** Steps for a·x² + b·x + c = 0 (integers, a ≠ 0). Null when there are no real solutions. */
export function solveQuadratic(a0: number, b0: number, c0: number): QuadSolution | null {
  if (a0 === 0) return null;
  const steps: Step[] = [];
  let g = gcd(gcd(a0, b0), c0);
  if (a0 < 0) g = -g;
  const a = a0 / g, b = b0 / g, c = c0 / g;
  if (g !== 1) steps.push(step(`Divide every term by ${num(g)}.`, `${toTex(quadStr(a, b, c))} = 0`));
  const D = b * b - 4 * a * c;
  if (D < 0) return null;
  const setOf = (r1: Q, r2: Q) => {
    if (r1.value() === r2.value()) return { display: `x = ${r1}`, tex: `x = ${r1.tex()}` };
    const [lo, hi] = r1.value() < r2.value() ? [r1, r2] : [r2, r1];
    return { display: `x = ${lo} or x = ${hi}`, tex: `x = ${lo.tex()} \\text{ or } x = ${hi.tex()}` };
  };
  const s = Math.round(Math.sqrt(D));
  if (s * s === D) {
    const r1 = new Q(-b - s, 2 * a), r2 = new Q(-b + s, 2 * a);
    if (c === 0) {
      steps.push(step(`Factor out x: x(${lin(a, b)}) = 0.`, `x(${toTex(lin(a, b))}) = 0`));
      steps.push(step(`Set each factor to zero: x = 0 or ${lin(a, b)} = 0, so x = ${new Q(-b, a)}.`));
    } else if (a === 1) {
      const [p, q] = [r1.n, r2.n];
      steps.push(step(`Find two numbers that multiply to ${num(c)} and add to ${num(b)}: ${num(-p)} and ${num(-q)}.`));
      steps.push(step(`Factor: ${factor(1, p)}${factor(1, q)} = 0.`, `${toTex(factor(1, p) + factor(1, q))} = 0`));
      steps.push(step(`Set each factor to zero: x = ${num(p)}${p === q ? ' (a repeated root)' : ` or x = ${num(q)}`}.`));
    } else {
      const p1 = r1.n, a1 = r1.d, a2 = a / a1, p2 = (r2.n * a2) / r2.d;
      const m = -a1 * p2, n = -a2 * p1;
      steps.push(step(`Multiply a × c: ${a} × ${c < 0 ? `(${num(c)})` : c} = ${num(a * c)}.`));
      steps.push(step(`Find two numbers that multiply to ${num(a * c)} and add to ${num(b)}: ${num(m)} and ${num(n)}.`));
      steps.push(step(`Split the middle term: ${joinSigned([coefVar(a, 'x^2'), coefVar(m, 'x'), coefVar(n, 'x'), num(c)])} = 0.`));
      steps.push(step(`Factor by grouping: ${factor(a1, p1)}${factor(a2, p2)} = 0.`, `${toTex(factor(a1, p1) + factor(a2, p2))} = 0`));
      steps.push(step(r1.value() === r2.value() ? `Set the factor to zero: x = ${r1}.` : `Set each factor to zero: x = ${r1} or x = ${r2}.`));
    }
    return { steps, ...setOf(r1, r2) };
  }
  const [k, m] = simplifySurd(D);
  let p = -b, q = k, r = 2 * a;
  const h = gcd(gcd(p, q), r);
  p /= h;
  q /= h;
  r /= h;
  steps.push(step(`Identify a = ${a}, b = ${num(b)}, c = ${num(c)}. It doesn’t factor nicely, so use the quadratic formula.`, 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'));
  steps.push(step(`Discriminant: b² − 4ac = ${par(b)}² − 4 × ${a} × ${par(c)} = ${D}.`, `b^2 - 4ac = ${D}`));
  if (k > 1) steps.push(step(`Simplify the root: √${D} = ${k}√${m}.`, `\\sqrt{${D}} = ${k}\\sqrt{${m}}`));
  steps.push(step(`Substitute: x = (${num(-b)} ± ${k > 1 ? k : ''}√${m}) / ${2 * a}.`, `x = \\frac{${-b} \\pm ${k > 1 ? k : ''}\\sqrt{${m}}}{${2 * a}}`));
  if (h > 1) steps.push(step(`Divide top and bottom by ${h}.`));
  const surd = `${q === 1 ? '' : q}√${m}`;
  const surdTex = `${q === 1 ? '' : q}\\sqrt{${m}}`;
  const root = (sign: '+' | '−') => {
    const top = p === 0 ? (sign === '+' ? surd : `${MINUS}${surd}`) : `${num(p)} ${sign} ${surd}`;
    return r === 1 ? top : p === 0 ? `${top}/${r}` : `(${top})/${r}`;
  };
  const pm = p === 0 ? `\\pm ${surdTex}` : `${p} \\pm ${surdTex}`;
  const tex = r === 1 ? `x = ${pm}` : `x = \\frac{${pm}}{${r}}`;
  const display = `x = ${root('+')} or x = ${root('−')}`;
  steps.push(step(`So ${display}.`, tex));
  return { steps, display, tex };
}

export function quadratic(rng: Rng, diff: Difficulty): Draft {
  let a: number, b: number, c: number;
  if (diff === 1) {
    let r1: number, r2: number;
    do {
      r1 = rng.int(-9, 9);
      r2 = rng.int(-9, 9);
    } while (r1 * r2 === 0 || (r1 === r2 && !rng.chance(0.15)));
    a = 1;
    b = -(r1 + r2);
    c = r1 * r2;
  } else if (diff === 2) {
    let a1: number, a2: number, p1: number, p2: number;
    do {
      a1 = rng.int(1, 3);
      a2 = rng.int(2, 5);
      p1 = rng.nz(-7, 7);
      p2 = rng.nz(-7, 7);
      a = a1 * a2;
      b = -(a1 * p2 + a2 * p1);
      c = p1 * p2;
    } while (gcd(gcd(a, b), c) !== 1 || b === 0 || new Q(p1, a1).value() === new Q(p2, a2).value());
  } else {
    let D: number;
    do {
      a = rng.int(1, 3);
      b = rng.signed(0, 9);
      c = rng.signed(1, 9);
      D = b * b - 4 * a * c;
    } while (D <= 0 || Number.isInteger(Math.sqrt(D)));
  }
  const sol = solveQuadratic(a, b, c)!;
  const eq = `${quadStr(a, b, c)} = 0`;
  return {
    prompt: `Solve ${eq}.`,
    promptTex: toTex(eq),
    answer: { display: sol.display, tex: sol.tex, kind: 'set' },
    steps: sol.steps,
    hint: diff === 3 ? 'Use x = (−b ± √(b² − 4ac)) / 2a.' : 'Factor the left side, then set each factor equal to zero.',
  };
}

// ---------- system ----------

export function lin2(a: number, b: number, c: number): string {
  const parts: string[] = [];
  if (a) parts.push(coefVar(a, 'x'));
  if (b) parts.push(coefVar(b, 'y'));
  return `${joinSigned(parts)} = ${num(c)}`;
}

/** Elimination steps for a1x + b1y = c1, a2x + b2y = c2. Null unless there is exactly one solution and both x-coefficients are non-zero. */
export function solveSystem(a1: number, b1: number, c1: number, a2: number, b2: number, c2: number): { steps: Step[]; x: Q; y: Q } | null {
  const det = a1 * b2 - a2 * b1;
  if (det === 0 || a1 === 0 || a2 === 0) return null;
  const x = new Q(c1 * b2 - c2 * b1, det);
  const y = new Q(a1 * c2 - a2 * c1, det);
  const steps: Step[] = [];
  const L = lcm(a1, a2), m1 = L / a1, m2 = L / a2;
  const B = b1 * m1 - b2 * m2, C = c1 * m1 - c2 * m2;
  if (m1 !== 1 || m2 !== 1) {
    steps.push(step(`Multiply the first equation by ${m1} and the second by ${m2} so the x terms match.`, `${toTex(lin2(L, b1 * m1, c1 * m1))},\\quad ${toTex(lin2(L, b2 * m2, c2 * m2))}`));
  }
  steps.push(step('Subtract the second equation from the first to eliminate x.', `${toTex(coefVar(B, 'y'))} = ${C}`));
  if (B !== 1) steps.push(step(`Divide both sides by ${num(B)}.`, `y = ${y.tex()}`));
  const rest = new Q(c1).sub(new Q(b1).mul(y));
  steps.push(step(`Substitute y = ${y} into the first equation: ${coefVar(a1, 'x')} = ${num(c1)} − ${par(b1)} × ${parQ(y)} = ${rest}.`, `${toTex(coefVar(a1, 'x'))} = ${rest.tex()}`));
  if (a1 !== 1) steps.push(step(`Divide by ${num(a1)}.`, `x = ${x.tex()}`));
  steps.push(step('Check both equations with these values.'));
  return { steps, x, y };
}

export function system(rng: Rng, diff: Difficulty): Draft {
  let e1: string, e2: string;
  let sol: { steps: Step[]; x: Q; y: Q };
  if (diff === 1) {
    const xv = rng.int(-6, 12), yv = rng.int(-6, 12);
    const s = xv + yv, d = xv - yv;
    e1 = lin2(1, 1, s);
    e2 = lin2(1, -1, d);
    sol = {
      x: new Q(xv),
      y: new Q(yv),
      steps: [
        step('Add the two equations; the y terms cancel.', `2x = ${s + d}`),
        step('Divide both sides by 2.', `x = ${xv}`),
        step(`Substitute x = ${num(xv)} into x + y = ${num(s)}: y = ${num(s)} − ${par(xv)} = ${num(yv)}.`, `y = ${yv}`),
        step('Check both equations with these values.'),
      ],
    };
  } else {
    const R = diff === 2 ? 5 : 9;
    for (;;) {
      const a1 = rng.nz(1, R), b1 = rng.signed(1, R), a2 = rng.nz(1, R), b2 = rng.signed(1, R);
      let c1: number, c2: number;
      if (diff === 2) {
        const xv = rng.int(-8, 8), yv = rng.int(-8, 8);
        c1 = a1 * xv + b1 * yv;
        c2 = a2 * xv + b2 * yv;
      } else {
        c1 = rng.signed(0, 20);
        c2 = rng.signed(0, 20);
      }
      const s = solveSystem(a1, b1, c1, a2, b2, c2);
      if (!s) continue;
      if (diff === 3 && (s.x.d > 6 || s.y.d > 6 || (s.x.isInt() && s.y.isInt()))) continue;
      e1 = lin2(a1, b1, c1);
      e2 = lin2(a2, b2, c2);
      sol = s;
      break;
    }
  }
  const { x, y, steps } = sol;
  return {
    prompt: `Solve the system: ${e1} and ${e2}.`,
    promptTex: `\\begin{cases} ${toTex(e1)} \\\\ ${toTex(e2)} \\end{cases}`,
    answer: { display: `x = ${x}, y = ${y}`, tex: `x = ${x.tex()},\\ y = ${y.tex()}`, kind: 'pair' },
    steps,
    hint: 'Eliminate one variable by adding or subtracting the equations, then substitute back.',
  };
}

// ---------- exponents ----------

function pw(v: string, n: number): string {
  return n === 1 ? v : `${v}^${num(n)}`;
}

/** c·x^ex·y^ey written with positive exponents: "4x^5/y^3". */
function monomial(c: number, ex: number, ey: number): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const [v, e] of [['x', ex], ['y', ey]] as const) {
    if (e > 0) top.push(pw(v, e));
    else if (e < 0) bottom.push(pw(v, -e));
  }
  const coef = c === 1 && top.length ? '' : String(c);
  const t = coef + top.join('');
  if (!bottom.length) return t || '1';
  const b = bottom.join('');
  return `${t || '1'}/${bottom.length > 1 ? `(${b})` : b}`;
}

function monomialTex(c: number, ex: number, ey: number): string {
  const p = (v: string, n: number) => (n === 1 ? v : `${v}^{${n}}`);
  const top = [ex > 0 ? p('x', ex) : '', ey > 0 ? p('y', ey) : ''].join('');
  const bottom = [ex < 0 ? p('x', -ex) : '', ey < 0 ? p('y', -ey) : ''].join('');
  const t = (c === 1 && top ? '' : String(c)) + top;
  return bottom ? `\\frac{${t || 1}}{${bottom}}` : t || '1';
}

export function exponents(rng: Rng, diff: Difficulty): Draft {
  const steps: Step[] = [];
  let expr: string;
  let answer: { display: string; tex: string; kind: 'number' | 'expression' };
  const hint = 'Same base: multiply → add exponents, divide → subtract, power of a power → multiply.';
  if (diff === 1) {
    const a = rng.int(2, 9), b = rng.int(2, 9);
    if (rng.chance(0.5)) {
      expr = `x^${a} · x^${b}`;
      steps.push(step(`Same base, so add the exponents: ${a} + ${b} = ${a + b}.`, `x^{${a + b}}`));
      answer = { display: `x^${a + b}`, tex: `x^{${a + b}}`, kind: 'expression' };
    } else {
      const hi = Math.max(a, b) + 1, lo = Math.min(a, b);
      expr = `x^${hi} / x^${lo}`;
      const e = hi - lo;
      steps.push(step(`Same base, so subtract the exponents: ${hi} − ${lo} = ${e}.`, pw('x', e).replace(/\^(\d+)/, '^{$1}')));
      answer = { display: pw('x', e), tex: pw('x', e).replace(/\^(\d+)/, '^{$1}'), kind: 'expression' };
    }
  } else if (diff === 2) {
    if (rng.chance(0.35)) {
      const base = rng.pick([2, 3, 4, 5, 10]);
      const n = base === 10 ? rng.int(1, 3) : base >= 4 ? rng.int(1, 2) : rng.int(1, 4);
      const v = base ** n;
      expr = `${base}^${MINUS}${n}`;
      steps.push(step(`A negative exponent means the reciprocal: ${base}^${MINUS}${n} = 1/${base}^${n}.`, `\\frac{1}{${base}^{${n}}}`));
      steps.push(step(`${base}^${n} = ${v}.`, `\\frac{1}{${v}}`));
      answer = { display: `1/${v}`, tex: `\\frac{1}{${v}}`, kind: 'number' };
    } else {
      const a = rng.int(2, 5), b = rng.int(2, 4), c = rng.int(1, 9);
      const div = rng.chance(0.5);
      expr = div ? `(x^${a})^${b} / x^${c}` : `(x^${a})^${b} · x^${c}`;
      const e = div ? a * b - c : a * b + c;
      steps.push(step(`Power of a power: multiply the exponents: ${a} × ${b} = ${a * b}.`, `x^{${a * b}}`));
      steps.push(step(`${div ? 'Divide' : 'Multiply'} by x^${c}: ${div ? 'subtract' : 'add'} the exponents: ${a * b} ${div ? '−' : '+'} ${c} = ${num(e)}.`, monomialTex(1, e, 0)));
      answer = { display: monomial(1, e, 0), tex: monomialTex(1, e, 0), kind: 'expression' };
    }
  } else {
    const k = rng.int(2, 3), n = rng.int(2, 3);
    const kn = k ** n;
    const divisors = [1, 2, 4, 3, 8, 9, 16, 27].filter((d) => kn % d === 0 && d > 1);
    const m = rng.pick(divisors);
    const a = rng.int(1, 4), b = rng.signed(1, 3), c = rng.int(1, 6), d = rng.signed(1, 4);
    const ex = a * n - c, ey = b * n - d;
    expr = `(${k}${pw('x', a)} ${pw('y', b)})^${n} ÷ (${m}${pw('x', c)} ${pw('y', d)})`;
    steps.push(step(`Raise each factor to the power ${n}: ${k}^${n} = ${kn}, x^${a * n}, y^${num(b * n)}.`, `${kn}x^{${a * n}}y^{${b * n}}`));
    steps.push(step(`Divide the coefficients: ${kn} ÷ ${m} = ${kn / m}.`));
    steps.push(step(`Subtract exponents for x: ${a * n} − ${c} = ${num(ex)}.`));
    steps.push(step(`Subtract exponents for y: ${num(b * n)} − ${par(d)} = ${num(ey)}.`, ex < 0 || ey < 0 ? `${kn / m}x^{${ex}}y^{${ey}}` : monomialTex(kn / m, ex, ey)));
    if (ex < 0 || ey < 0) steps.push(step('Move negative exponents to the denominator.', monomialTex(kn / m, ex, ey)));
    answer = { display: monomial(kn / m, ex, ey), tex: monomialTex(kn / m, ex, ey), kind: 'expression' };
  }
  return { prompt: `${answer.kind === 'number' ? 'Evaluate' : 'Simplify'} ${expr}.`, promptTex: toTex(expr), answer, steps, hint };
}
