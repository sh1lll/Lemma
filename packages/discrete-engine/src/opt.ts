// Optimization and operations research: LP/ILP, Lagrange/KKT, transportation, assignment, knapsack, TSP, DP
// classics, queueing, inventory (OR forms), decision analysis, game theory, gradient descent and Newton steps.
import { branchAndBound, clean, simplex, type LP, type Op } from './lp';
import { invert } from './numeric';
import { parseGraph } from './graph';
import { answer, compile, fmt, numbers, param, parseMatrix, refuse, sum, type Line, type Result } from './util';

const FUNCS = new Set(['sin', 'cos', 'tan', 'exp', 'log', 'ln', 'sqrt', 'abs', 'pi', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'min', 'max']);

/** Variable names in an expression: x, y, x1, x_2; "xy" counts as x and y. */
export function findVars(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts)
    for (const m of t.toLowerCase().matchAll(/[a-z]+(?:_?\d+)?/g)) {
      const w = m[0];
      if (FUNCS.has(w)) continue;
      if (/^[a-z](?:_?\d+)?$/.test(w)) {
        if (w !== 'e') out.add(w.replace('_', ''));
      } else if (/^[a-z]+$/.test(w)) for (const ch of w) if (ch !== 'e') out.add(ch);
    }
  return [...out].sort((a, b) => {
    const order = 'xyzwabcdefghijklmnopqrstuv';
    const pa = /^[a-z]$/.test(a) ? order.indexOf(a) : 100;
    const pb = /^[a-z]$/.test(b) ? order.indexOf(b) : 100;
    return pa - pb || a.localeCompare(b, 'en', { numeric: true });
  });
}

/** Coefficients and constant of a linear expression, or null when it isn't linear. */
export function linear(text: string, vars: string[]): { coef: number[]; k: number } | null {
  const f = compile(text.replace(/([a-z])_(\d)/gi, '$1$2'), vars);
  const zero = vars.map(() => 0);
  const k = f(...zero);
  const coef = vars.map((_, i) => f(...zero.map((_, j) => (j === i ? 1 : 0))) - k);
  for (const probe of [vars.map((_, i) => i + 2), vars.map((_, i) => (i % 2 ? -3 : 1.5) * (i + 1))]) {
    const lin = k + coef.reduce((s, a, i) => s + a * probe[i]!, 0);
    const v = f(...probe);
    if (!Number.isFinite(v) || Math.abs(v - lin) > 1e-8 * Math.max(1, Math.abs(v))) return null;
  }
  return { coef, k };
}

interface Constraint {
  lhs: string;
  op: Op;
  rhs: string;
  text: string;
}

function parseConstraints(s: string): { cons: Constraint[]; free: Set<string>; integer: Set<string> | 'all'; binary: Set<string> } {
  const free = new Set<string>();
  let integer: Set<string> | 'all' = new Set();
  const binary = new Set<string>();
  let body = s
    .replace(/≤|=<|⩽/g, '<=')
    .replace(/≥|=>|⩾/g, '>=')
    .replace(/\bat most\b/gi, '<=')
    .replace(/\bat least\b/gi, '>=');
  body = body.replace(/\b((?:[a-z](?:_?\d+)?\s*,\s*)*[a-z](?:_?\d+)?)\s+(?:are\s+|is\s+)?(?:unrestricted|free|urs)(?:\s+in\s+sign)?\b/gi, (_, v: string) => {
    v.split(/\s*,\s*/).forEach((x) => free.add(x.replace('_', '').toLowerCase()));
    return '';
  });
  body = body.replace(/\b((?:[a-z](?:_?\d+)?\s*,\s*)*[a-z](?:_?\d+)?)\s+(?:are\s+|is\s+)?(?:binary|in\s*\{\s*0\s*,\s*1\s*\})\b/gi, (_, v: string) => {
    v.split(/\s*,\s*/).forEach((x) => binary.add(x.replace('_', '').toLowerCase()));
    return '';
  });
  body = body.replace(/\b((?:[a-z](?:_?\d+)?\s*,\s*)*[a-z](?:_?\d+)?)\s+(?:are\s+|is\s+|must be\s+)?(?:integers?|integral|whole numbers?)\b/gi, (_, v: string) => {
    if (integer !== 'all') v.split(/\s*,\s*/).forEach((x) => (integer as Set<string>).add(x.replace('_', '').toLowerCase()));
    return '';
  });
  if (/\b(?:all\s+)?(?:variables\s+)?(?:are\s+)?integers?\b|\binteger (?:program\w*|solution|values|lp)\b|\bilp\b|\bmilp\b/i.test(body)) integer = 'all';
  body = body.replace(/\b(?:all\s+)?(?:variables\s+)?(?:are\s+)?(?:integers?|integer (?:programming|program|solution|values|lp)|ilp|milp)\b/gi, '');
  // Nonnegativity: "x, y >= 0", "x1, x2, x3 ≥ 0", "all variables nonnegative".
  body = body.replace(/\b(?:[a-z](?:_?\d+)?\s*,\s*)+[a-z](?:_?\d+)?\s*>=\s*0\b/gi, '');
  body = body.replace(/\b(?:all\s+)?(?:variables\s+)?(?:are\s+)?non-?negative\b|\bnonnegativity\b/gi, '');
  const parts = body.split(/[,;\n]|\band\b/).map((p) => p.trim()).filter(Boolean);
  const cons: Constraint[] = [];
  for (const p of parts) {
    const chain = p.split(/(<=|>=|=|<|>)/).map((x) => x.trim());
    if (chain.length < 3) continue;
    for (let i = 0; i + 2 < chain.length; i += 2) {
      const lhs = chain[i]!;
      const opRaw = chain[i + 1]!;
      const rhs = chain[i + 2]!;
      if (!lhs || !rhs) continue;
      const op: Op = opRaw === '<=' || opRaw === '<' ? '<=' : opRaw === '>=' || opRaw === '>' ? '>=' : '=';
      cons.push({ lhs, op, rhs, text: `${lhs} ${op === '<=' ? '≤' : op === '>=' ? '≥' : '='} ${rhs}` });
    }
  }
  return { cons, free, integer, binary };
}

function optimization(input: string): Result {
  const m = /\b(maximi[sz]e|minimi[sz]e|max|min)\b\s*:?\s*(?:(?:z|p|c|f|profit|cost|w)\s*(?:\([^)]*\))?\s*=\s*)?(.+?)\s*(?:,?\s*\b(?:subject to|s\.?\s?t\.?|such that|given|with constraints?|where|constraints?:?|under)\b|:)\s*(.+)$/i.exec(input);
  if (!m) {
    const un = /\b(maximi[sz]e|minimi[sz]e)\b\s*:?\s*(?:(?:z|f)\s*(?:\([^)]*\))?\s*=\s*)?(.+)$/i.exec(input);
    if (un && /[a-z]/i.test(un[2]!) && !/\b(?:subject|s\.t)/i.test(input)) return kkt(input, /^max/i.test(un[1]!), un[2]!.trim(), []);
    return null;
  }
  if (!/[<>=≤≥]|\bat (?:most|least)\b/i.test(m[3]!)) return null;
  const maximize = /^max/i.test(m[1]!);
  const objText = m[2]!.trim();
  const { cons, free, integer, binary } = parseConstraints(m[3]!);
  if (!cons.length) refuse('No constraints found; write them like “x + y <= 4, x + 3y <= 6”');
  const vars = findVars([objText, ...cons.flatMap((c) => [c.lhs, c.rhs])]);
  if (!vars.length) refuse('No variables found');
  if (vars.length > 30) refuse('Up to 30 variables');
  const obj = linear(objText, vars);
  const lin = cons.map((c) => linear(`(${c.lhs}) - (${c.rhs})`, vars));
  if (!obj || lin.some((l) => !l)) return kkt(input, maximize, objText, cons, vars);
  // Explicit single-variable bounds "x >= 0" are implied; keep other bounds.
  const rows: { coef: number[]; op: Op; b: number; text: string }[] = [];
  cons.forEach((c, i) => {
    const l = lin[i]!;
    const nz = l.coef.filter((a) => a !== 0).length;
    if (nz === 1 && l.k === 0 && c.op === '>=' && l.coef.find((a) => a !== 0)! > 0 && !free.size) return; // x ≥ 0
    if (nz === 0) {
      if ((c.op === '<=' && -l.k < 0) || (c.op === '>=' && -l.k > 0) || (c.op === '=' && l.k !== 0)) refuse(`Constraint “${c.text}” can never hold`);
      return;
    }
    rows.push({ coef: l.coef, op: c.op, b: -l.k, text: c.text });
  });
  for (const v of binary) {
    const j = vars.indexOf(v);
    if (j >= 0) rows.push({ coef: vars.map((_, k) => (k === j ? 1 : 0)), op: '<=', b: 1, text: `${v} ≤ 1 (binary)` });
  }
  // Free variables: x = x⁺ − x⁻.
  const cols: { name: string; src: number; sign: number }[] = [];
  vars.forEach((v, j) => {
    if (free.has(v)) cols.push({ name: `${v}⁺`, src: j, sign: 1 }, { name: `${v}⁻`, src: j, sign: -1 });
    else cols.push({ name: v, src: j, sign: 1 });
  });
  const lp: LP = {
    c: cols.map((c) => obj.coef[c.src]! * c.sign),
    A: rows.map((r) => cols.map((c) => r.coef[c.src]! * c.sign)),
    b: rows.map((r) => r.b),
    ops: rows.map((r) => r.op),
    maximize,
  };
  const names = cols.map((c) => c.name);
  const isInt = cols.map((c) => integer === 'all' || (integer as Set<string>).has(vars[c.src]!) || binary.has(vars[c.src]!));
  const anyInt = isInt.some(Boolean);
  const relax = simplex(lp, names);
  let res = relax;
  let bb: ReturnType<typeof branchAndBound> | null = null;
  if (anyInt && relax.status === 'optimal') {
    bb = branchAndBound(lp, isInt, names);
    if (!bb.best) return answer(input, 'optimization', 'Integer program', 'infeasible', { notes: ['The LP relaxation is feasible but no integer point satisfies every constraint.'] });
    res = bb.best;
  }
  const sense = maximize ? 'max' : 'min';
  const objStr = objText.replace(/\*/g, '');
  if (res.status === 'infeasible') return answer(input, 'optimization', `${anyInt ? 'Integer' : 'Linear'} program · ${sense} ${objStr}`, 'infeasible', { notes: ['No point satisfies all the constraints (phase 1 of the simplex method could not drive the artificial variables to zero).'] });
  if (res.status === 'unbounded') return answer(input, 'optimization', `Linear program · ${sense} ${objStr}`, 'unbounded', { notes: [`The objective can be made arbitrarily ${maximize ? 'large' : 'small'} inside the feasible region.`] });
  const x = vars.map((_, j) => clean(cols.reduce((s, c, k) => (c.src === j ? s + c.sign * res.x[k]! : s), 0)));
  const point = `(${vars.join(', ')}) = (${x.map((v) => fmt(v, 8)).join(', ')})`;
  const tableRows = rows.map((r, i) => {
    const lhs = clean(r.coef.reduce((s, a, j) => s + a * x[j]!, 0));
    const slack = clean(r.op === '<=' ? r.b - lhs : r.op === '>=' ? lhs - r.b : 0);
    return [r.text, fmt(lhs, 8), fmt(slack, 8), Math.abs(slack) < 1e-7 ? 'yes' : 'no', anyInt ? '—' : fmt(res.duals[i] ?? 0, 6)];
  });
  const binding = tableRows.filter((r) => r[3] === 'yes').map((r) => r[0]!);
  const zeroVars = vars.filter((v, j) => x[j] === 0 && !free.has(v)).map((v) => `${v} ≥ 0`);
  const lines: Line[] = [
    { label: 'Optimal value', display: `${sense} = ${fmt(res.value, 10)}` },
    { label: 'Optimal point', display: point },
    { label: 'Binding constraints', display: [...binding, ...zeroVars].join('; ') || 'none' },
  ];
  if (anyInt && relax.status === 'optimal') lines.push({ label: 'LP relaxation', display: `${fmt(relax.value, 8)} at (${relax.x.map((v) => fmt(v, 6)).join(', ')})` });
  const notes: string[] = [];
  if (!anyInt) notes.push('Shadow price = change in the optimal value per unit increase of that constraint’s right-hand side (valid within its allowable range).');
  if (vars.length === 2 && !anyInt && rows.length <= 12) {
    const corners = vertices2D(rows);
    if (corners.length) {
      const vals = corners.map((p) => obj.coef[0]! * p[0] + obj.coef[1]! * p[1] + obj.k);
      notes.push(`Corner points: ${corners.map((p, i) => `(${fmt(p[0], 6)}, ${fmt(p[1], 6)}) → ${fmt(vals[i]!, 6)}`).join('; ')}.`);
    }
  }
  if (!anyInt && hasAlternateOptima(lp, res)) notes.push('Another optimal solution exists (a nonbasic variable has zero reduced cost): the optimum is attained along an edge.');
  const table = bb
    ? { columns: ['node', 'added bounds', 'LP value', 'result'], rows: bb.log.map((n) => [String(n.id), n.bounds || '(root)', Number.isNaN(n.value) ? '—' : fmt(n.value, 8), n.status]), caption: 'Branch and bound tree' }
    : { columns: ['constraint', 'LHS at optimum', 'slack', 'binding', 'shadow price'], rows: tableRows };
  if (!bb && res.pivots.length) notes.push(`Simplex pivots: ${res.pivots.map((p) => `${p.enter} in, ${p.leave} out`).join('; ')}.`);
  if (bb?.truncated) notes.unshift('Stopped after 2,000 nodes; the incumbent may not be optimal.');
  return answer(input, 'optimization', `${anyInt ? (isInt.every(Boolean) ? 'Integer' : 'Mixed-integer') : 'Linear'} program · ${sense} ${objStr} subject to ${rows.length} constraint${rows.length === 1 ? '' : 's'}${free.size ? '' : ', variables ≥ 0'}`, `${sense} = ${fmt(res.value, 10)} at ${point}`, {
    value: res.value,
    lines,
    table,
    notes,
  });
}

function hasAlternateOptima(lp: LP, res: { x: number[]; value: number }): boolean {
  // Perturb the objective slightly in each direction and see whether the optimal point moves while the value stays.
  for (let j = 0; j < lp.c.length; j++) {
    for (const d of [1e-6, -1e-6]) {
      const c = lp.c.map((v, k) => (k === j ? v + d : v));
      const r = simplex({ ...lp, c });
      if (r.status !== 'optimal') continue;
      const v = lp.c.reduce((s, cc, k) => s + cc * r.x[k]!, 0);
      if (Math.abs(v - res.value) < 1e-6 && r.x.some((xv, k) => Math.abs(xv - res.x[k]!) > 1e-6)) return true;
    }
  }
  return false;
}

function vertices2D(rows: { coef: number[]; op: Op; b: number }[]): [number, number][] {
  const lines = [...rows.map((r) => ({ a: r.coef[0]!, b: r.coef[1]!, c: r.b })), { a: 1, b: 0, c: 0 }, { a: 0, b: 1, c: 0 }];
  const pts: [number, number][] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const L1 = lines[i]!;
      const L2 = lines[j]!;
      const det = L1.a * L2.b - L1.b * L2.a;
      if (Math.abs(det) < 1e-12) continue;
      const x = clean((L1.c * L2.b - L1.b * L2.c) / det);
      const y = clean((L1.a * L2.c - L1.c * L2.a) / det);
      if (x < -1e-9 || y < -1e-9) continue;
      const ok = rows.every((r) => {
        const v = r.coef[0]! * x + r.coef[1]! * y;
        return r.op === '<=' ? v <= r.b + 1e-9 : r.op === '>=' ? v >= r.b - 1e-9 : Math.abs(v - r.b) < 1e-9;
      });
      if (ok && !pts.some((p) => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9)) pts.push([x, y]);
    }
  return pts;
}

// ─── Lagrange multipliers / KKT ───

function newtonSystem(F: (z: number[]) => number[], z0: number[]): number[] | null {
  let z = [...z0];
  for (let it = 0; it < 100; it++) {
    const f = F(z);
    if (f.some((v) => !Number.isFinite(v))) return null;
    const nrm = Math.hypot(...f);
    if (nrm < 1e-11) return z;
    const J = z.map((_, j) => {
      const h = 1e-6 * Math.max(1, Math.abs(z[j]!));
      const zp = [...z];
      const zm = [...z];
      zp[j]! += h;
      zm[j]! -= h;
      const fp = F(zp);
      const fm = F(zm);
      return fp.map((v, i) => (v - fm[i]!) / (2 * h));
    });
    // J is column-major here: J[j][i] = ∂Fi/∂zj.
    const Jr = f.map((_, i) => z.map((_, j) => J[j]![i]!));
    const inv = invert(Jr);
    if (!inv) return null;
    const step = inv.map((r) => r.reduce((s, a, k) => s + a * f[k]!, 0));
    let t = 1;
    let next = z.map((v, i) => v - t * step[i]!);
    while (t > 1e-4 && Math.hypot(...F(next)) > nrm) {
      t /= 2;
      next = z.map((v, i) => v - t * step[i]!);
    }
    z = next;
  }
  return Math.hypot(...F(z)) < 1e-8 ? z : null;
}

const grad = (f: (...a: number[]) => number, x: number[]) =>
  x.map((_, i) => {
    const h = 1e-5 * Math.max(1, Math.abs(x[i]!));
    const p = [...x];
    const q = [...x];
    p[i]! += h;
    q[i]! -= h;
    return (f(...p) - f(...q)) / (2 * h);
  });

function kkt(input: string, maximize: boolean, objText: string, cons: Constraint[], varsIn?: string[]): Result {
  const vars = varsIn ?? findVars([objText, ...cons.flatMap((c) => [c.lhs, c.rhs])]);
  if (!vars.length || vars.length > 4) refuse('Lagrange/KKT here handles 1 to 4 variables');
  if (cons.length > 5) refuse('Up to 5 nonlinear constraints');
  const f = compile(objText, vars);
  const g = cons.map((c) => compile(`(${c.lhs}) - (${c.rhs})`, vars));
  const eqIdx = cons.map((c, i) => (c.op === '=' ? i : -1)).filter((i) => i >= 0);
  const ineqIdx = cons.map((c, i) => (c.op !== '=' ? i : -1)).filter((i) => i >= 0);
  const candidates: { x: number[]; lam: number[]; value: number; active: number[] }[] = [];
  const n = vars.length;
  const starts: number[][] = [];
  const grid = [-2, -0.5, 0.7, 1.5, 3];
  for (let k = 0; k < 40; k++) starts.push(vars.map((_, i) => grid[(k * (i + 2) + i * 3 + Math.floor(k / 5)) % grid.length]! * (1 + 0.37 * ((k + i) % 3))));
  for (let mask = 0; mask < 1 << ineqIdx.length; mask++) {
    const active = [...eqIdx, ...ineqIdx.filter((_, b) => mask & (1 << b))];
    if (active.length > n) continue;
    const F = (z: number[]) => {
      const x = z.slice(0, n);
      const lam = z.slice(n);
      const gf = grad(f, x);
      const gg = active.map((i) => grad(g[i]!, x));
      return [...gf.map((v, j) => v - lam.reduce((s, l, k) => s + l * gg[k]![j]!, 0)), ...active.map((i) => g[i]!(...x))];
    };
    for (const st of starts) {
      const z = newtonSystem(F, [...st, ...active.map(() => 0.5)]);
      if (!z) continue;
      const x = z.slice(0, n).map((v) => clean(Math.round(v * 1e9) / 1e9));
      const lam = z.slice(n).map((v) => clean(Math.round(v * 1e9) / 1e9));
      // Feasibility of inactive inequalities and multiplier signs (∇f = Σλ∇g).
      const feasible = cons.every((c, i) => {
        const v = g[i]!(...x);
        return c.op === '=' ? Math.abs(v) < 1e-6 : c.op === '<=' ? v <= 1e-7 : v >= -1e-7;
      });
      if (!feasible) continue;
      const signOk = active.every((ci, k) => {
        const c = cons[ci]!;
        if (c.op === '=') return true;
        // For max: ∇f = λ∇g with λ ≥ 0 on g ≤ 0 constraints; for min the sign flips.
        const want = (c.op === '<=') === maximize ? 1 : -1;
        return lam[k]! * want >= -1e-7;
      });
      if (!signOk) continue;
      if (candidates.some((c) => c.x.every((v, i) => Math.abs(v - x[i]!) < 1e-6))) continue;
      candidates.push({ x, lam, value: clean(f(...x)), active });
    }
  }
  if (!candidates.length) refuse('No KKT point found from the starting guesses');
  candidates.sort((a, b) => (maximize ? b.value - a.value : a.value - b.value));
  const best = candidates[0]!;
  const sense = maximize ? 'max' : 'min';
  const usesLagrange = cons.length > 0 && ineqIdx.length === 0;
  const pointStr = (x: number[]) => `(${x.map((v) => fmt(v, 8)).join(', ')})`;
  const notes = [
    usesLagrange ? 'Lagrange conditions: ∇f = λ∇g and g = 0, solved numerically from many starting points.' : cons.length ? 'KKT conditions: stationarity ∇f = Σλᵢ∇gᵢ, feasibility, complementary slackness and sign conditions on λ, checked for each set of active constraints.' : 'Stationary points ∇f = 0, found numerically.',
    'Candidates are compared by objective value; for an unbounded region the extremum may not exist even when a stationary point does.',
  ];
  return answer(input, 'optimization', `${usesLagrange ? 'Lagrange multipliers' : cons.length ? 'KKT conditions' : 'Unconstrained optimum'} · ${sense} ${objText}${cons.length ? ` subject to ${cons.map((c) => c.text).join(', ')}` : ''}`, `${sense} = ${fmt(best.value, 10)} at ${pointStr(best.x)}`, {
    value: best.value,
    lines: [
      { label: 'Optimal point', display: `(${vars.join(', ')}) = ${pointStr(best.x)}` },
      { label: 'Objective', display: fmt(best.value, 10) },
      ...(best.active.length ? [{ label: 'Multipliers λ', display: best.active.map((ci, k) => `${cons[ci]!.text}: ${fmt(best.lam[k]!, 8)}`).join('; ') }] : []),
    ],
    table: candidates.length > 1 ? { columns: ['point', 'f', 'active constraints', 'λ'], rows: candidates.map((c) => [pointStr(c.x), fmt(c.value, 8), c.active.map((i) => cons[i]!.text).join('; ') || 'none', c.lam.map((l) => fmt(l, 6)).join(', ') || '—']), caption: 'Candidate points', highlightRow: 0 } : undefined,
    notes,
    exactness: 'numeric',
  });
}

// ─── Transportation & assignment ───

function readVector(s: string, word: RegExp): number[] | null {
  const m = new RegExp(`${word.source}\\s*(?:[:=]|are|is|of)?\\s*\\[?\\s*((?:[-−]?[\\d.]+\\s*,?\\s*)+)\\]?`, 'i').exec(s);
  return m ? numbers(m[1]!) : null;
}

function transportation(input: string): Result {
  if (!/\btransportation\b|\btransport problem\b/i.test(input)) return null;
  const supply = readVector(input, /\bsuppl(?:y|ies)\b/);
  const demand = readVector(input, /\bdemands?\b/);
  const costs = parseMatrix(input.slice(input.search(/\[\s*\[|\bcosts?\b/i)).replace(/^costs?\s*(?:matrix)?\s*[:=]?\s*/i, ''));
  if (!supply || !demand || !costs) refuse('Give supply, demand and a cost matrix: “transportation supply 20 30 demand 10 25 15 costs [[8,6,10],[9,12,13]]”');
  if (costs!.length !== supply!.length || costs!.some((r) => r.length !== demand!.length)) refuse(`The cost matrix must be ${supply!.length}×${demand!.length} (supplies × demands)`);
  let S = [...supply!];
  let Dm = [...demand!];
  let C = costs!.map((r) => [...r]);
  const ts = sum(S);
  const td = sum(Dm);
  const notes: string[] = [];
  const rowNames = S.map((_, i) => `S${i + 1}`);
  const colNames = Dm.map((_, j) => `D${j + 1}`);
  if (ts > td) {
    Dm.push(ts - td);
    C = C.map((r) => [...r, 0]);
    colNames.push('Dummy');
    notes.push(`Supply exceeds demand by ${fmt(ts - td)}: a dummy destination with zero cost absorbs it.`);
  } else if (td > ts) {
    S.push(td - ts);
    C.push(Dm.map(() => 0));
    rowNames.push('Dummy');
    notes.push(`Demand exceeds supply by ${fmt(td - ts)}: a dummy source with zero cost covers the shortfall (unmet demand).`);
  }
  const m = S.length;
  const n = Dm.length;
  // North-west corner (initial BFS) for comparison.
  const s2 = [...S];
  const d2 = [...Dm];
  let nw = 0;
  for (let i = 0, j = 0; i < m && j < n; ) {
    const q = Math.min(s2[i]!, d2[j]!);
    nw += q * C[i]![j]!;
    s2[i]! -= q;
    d2[j]! -= q;
    if (s2[i] === 0) i++;
    else j++;
  }
  const lp: LP = { c: C.flat(), A: [], b: [], ops: [], maximize: /\bmaximi[sz]e|profit\b/i.test(input) };
  for (let i = 0; i < m; i++) {
    lp.A.push(Array.from({ length: m * n }, (_, k) => (Math.floor(k / n) === i ? 1 : 0)));
    lp.b.push(S[i]!);
    lp.ops.push('=');
  }
  for (let j = 0; j < n; j++) {
    lp.A.push(Array.from({ length: m * n }, (_, k) => (k % n === j ? 1 : 0)));
    lp.b.push(Dm[j]!);
    lp.ops.push('=');
  }
  const r = simplex(lp);
  if (r.status !== 'optimal') refuse('No feasible shipment plan');
  const X = Array.from({ length: m }, (_, i) => r.x.slice(i * n, i * n + n));
  S = S;
  Dm = Dm;
  notes.push(`North-west corner start costs ${fmt(nw)}; the optimum improves that by ${fmt(nw - r.value)}.`);
  return answer(input, 'optimization', `Transportation problem · ${supply!.length} sources, ${demand!.length} destinations`, `${lp.maximize ? 'max profit' : 'min cost'} = ${fmt(r.value)}`, {
    value: r.value,
    lines: [{ label: 'Shipments', display: X.flatMap((row, i) => row.map((q, j) => (q > 1e-9 ? `${rowNames[i]}→${colNames[j]}: ${fmt(q)}` : ''))).filter(Boolean).join(', ') }],
    table: { columns: ['', ...colNames, 'supply'], rows: [...X.map((row, i) => [rowNames[i]!, ...row.map((q, j) => (q > 1e-9 ? `${fmt(q)} @${fmt(C[i]![j]!)}` : '—')), fmt(S[i]!)]), ['demand', ...Dm.map((d) => fmt(d)), fmt(sum(S))]], caption: 'Optimal allocation (quantity @ unit cost)' },
    notes,
  });
}

/** Hungarian algorithm (Kuhn–Munkres), O(n³), minimising. Returns assignment[row] = col. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]!.length;
  const N = Math.max(n, m);
  const a = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => cost[i]?.[j] ?? 0));
  const u = new Array(N + 1).fill(0) as number[];
  const v = new Array(N + 1).fill(0) as number[];
  const p = new Array(N + 1).fill(0) as number[];
  const way = new Array(N + 1).fill(0) as number[];
  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(N + 1).fill(Infinity) as number[];
    const used = new Array(N + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= N; j++)
        if (!used[j]) {
          const cur = a[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
          if (cur < minv[j]!) (minv[j] = cur), (way[j] = j0);
          if (minv[j]! < delta) (delta = minv[j]!), (j1 = j);
        }
      for (let j = 0; j <= N; j++)
        if (used[j]) (u[p[j]!]! += delta), (v[j]! -= delta);
        else minv[j]! -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const ans = new Array(N).fill(-1) as number[];
  for (let j = 1; j <= N; j++) if (p[j]) ans[p[j]! - 1] = j - 1;
  return ans.slice(0, n);
}

function assignment(input: string): Result {
  if (!/\b(?:assignment problem|hungarian|assign\w*\s+(?:workers|jobs|tasks|agents)|job assignment)\b/i.test(input)) return null;
  const M = parseMatrix(input.slice(input.search(/\[\s*\[|\d/)));
  if (!M) refuse('Give a cost matrix, e.g. “hungarian [[9,2,7],[6,4,3],[5,8,1]]”');
  const maximize = /\bmaximi[sz]e|profit|max\b/i.test(input);
  const big = Math.max(...M!.flat());
  const cost = maximize ? M!.map((r) => r.map((x) => big - x)) : M!;
  const asg = hungarian(cost);
  const total = asg.reduce((s, j, i) => (j >= 0 && j < M![i]!.length ? s + M![i]![j]! : s), 0);
  const rows = M!.map((r, i) => [`row ${i + 1}`, ...r.map((x, j) => (asg[i] === j ? `[${fmt(x)}]` : fmt(x)))]);
  return answer(input, 'optimization', `Assignment problem (Hungarian algorithm) · ${M!.length}×${M![0]!.length}`, `${maximize ? 'max' : 'min'} total = ${fmt(total)}`, {
    value: total,
    lines: [{ label: 'Assignment', display: asg.map((j, i) => (j < M![i]!.length ? `row ${i + 1} → column ${j + 1} (${fmt(M![i]![j]!)})` : `row ${i + 1} → none`)).join(', ') }],
    table: { columns: ['', ...M![0]!.map((_, j) => `col ${j + 1}`)], rows, caption: 'Chosen cells in brackets' },
    notes: ['Hungarian method: subtract row and column minima, cover zeros with the fewest lines, adjust, repeat; O(n³).', ...(M!.length !== M![0]!.length ? ['Non-square: padded with zero-cost dummy rows/columns.'] : []), ...(maximize ? ['Maximisation solved as minimising (max entry − value).'] : [])],
  });
}

// ─── Knapsack, TSP, DP classics ───

function knapsack(input: string): Result {
  if (!/\bknapsack\b/i.test(input)) return null;
  const cap = param(input, ['capacity', 'cap', 'W', 'max weight', 'limit']);
  const w = readVector(input, /\bweights?\b/);
  const v = readVector(input, /\b(?:values?|profits?|benefits?)\b/);
  if (cap === undefined || !w || !v || w.length !== v.length) refuse('Give capacity, weights and values: “knapsack capacity 50 weights 10 20 30 values 60 100 120”');
  const n = w!.length;
  if (/\bfractional\b/i.test(input)) {
    const order = w!.map((_, i) => i).sort((a, b) => v![b]! / w![b]! - v![a]! / w![a]!);
    let left = cap!;
    let total = 0;
    const take: string[] = [];
    const rows: string[][] = [];
    for (const i of order) {
      const f = Math.min(1, left / w![i]!);
      if (f > 0) {
        total += f * v![i]!;
        left -= f * w![i]!;
        take.push(f === 1 ? `item ${i + 1}` : `${fmt(f, 6)} of item ${i + 1}`);
      }
      rows.push([`item ${i + 1}`, fmt(w![i]!), fmt(v![i]!), fmt(v![i]! / w![i]!, 6), fmt(Math.max(0, f), 6)]);
    }
    return answer(input, 'optimization', `Fractional knapsack · capacity ${fmt(cap!)}`, `max value = ${fmt(total, 10)}`, { value: total, lines: [{ label: 'Take', display: take.join(', ') }], table: { columns: ['item', 'weight', 'value', 'value/weight', 'fraction taken'], rows }, notes: ['Greedy by value-to-weight ratio is optimal when items can be split.'] });
  }
  if (!w!.every((x) => Number.isInteger(x) && x >= 0) || !Number.isInteger(cap) || cap! > 100000) refuse('0/1 knapsack here needs whole-number weights and capacity up to 100,000');
  const unbounded = /\bunbounded|unlimited|repeat\w*\b/i.test(input);
  const W = cap!;
  const dp = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0) as number[]);
  for (let i = 1; i <= n; i++)
    for (let c = 0; c <= W; c++) {
      dp[i]![c] = dp[i - 1]![c]!;
      const wi = w![i - 1]!;
      if (wi <= c) dp[i]![c] = Math.max(dp[i]![c]!, (unbounded ? dp[i]![c - wi]! : dp[i - 1]![c - wi]!) + v![i - 1]!);
    }
  const counts = new Array(n).fill(0) as number[];
  let c = W;
  for (let i = n; i >= 1; ) {
    if (dp[i]![c] === dp[i - 1]![c]) i--;
    else {
      counts[i - 1]!++;
      c -= w![i - 1]!;
      if (!unbounded) i--;
    }
  }
  const best = dp[n]![W]!;
  const used = counts.reduce((s, k, i) => s + k * w![i]!, 0);
  const showCols = W <= 15;
  return answer(input, 'optimization', `${unbounded ? 'Unbounded' : '0/1'} knapsack · capacity ${W}, ${n} items`, `max value = ${fmt(best)}`, {
    value: best,
    lines: [
      { label: 'Items chosen', display: counts.map((k, i) => (k ? `${unbounded && k > 1 ? `${k}× ` : ''}item ${i + 1} (w ${fmt(w![i]!)}, v ${fmt(v![i]!)})` : '')).filter(Boolean).join(', ') || 'none' },
      { label: 'Weight used', display: `${fmt(used)} of ${W}` },
    ],
    table: showCols ? { columns: ['items \\ capacity', ...Array.from({ length: W + 1 }, (_, k) => String(k))], rows: dp.map((r, i) => [i === 0 ? 'none' : `1..${i}`, ...r.map((x) => fmt(x))]), caption: 'DP table: best value using the first i items within capacity c' } : undefined,
    notes: ['Dynamic programming: best(i, c) = max(best(i−1, c), best(i−1, c − wᵢ) + vᵢ); O(n·W).'],
  });
}

function tsp(input: string): Result {
  if (!/\b(?:tsp|travell?ing salesm[ae]n|shortest tour|salesman)\b/i.test(input)) return null;
  const G = parseGraph(input);
  if (!G) refuse('Give distances as an edge list (A-B 10, …) or a distance matrix');
  const n = G!.names.length;
  if (n < 3) refuse('Need at least 3 cities');
  if (n > 15) refuse('Exact TSP here goes up to 15 cities (Held–Karp is O(n²2ⁿ))');
  const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (const e of G!.edges) {
    D[e.u]![e.v] = Math.min(D[e.u]![e.v]!, e.w);
    if (!G!.directed) D[e.v]![e.u] = Math.min(D[e.v]![e.u]!, e.w);
  }
  const full = 1 << n;
  const dp = Array.from({ length: full }, () => new Float64Array(n).fill(Infinity));
  const par = Array.from({ length: full }, () => new Int8Array(n).fill(-1));
  dp[1]![0] = 0;
  for (let mask = 1; mask < full; mask += 2)
    for (let j = 0; j < n; j++) {
      const cur = dp[mask]![j]!;
      if (cur === Infinity || !(mask & (1 << j))) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const v = cur + D[j]![k]!;
        if (v < dp[nm]![k]!) (dp[nm]![k] = v), (par[nm]![k] = j);
      }
    }
  let best = Infinity;
  let last = -1;
  for (let j = 1; j < n; j++) {
    const v = dp[full - 1]![j]! + D[j]![0]!;
    if (v < best) (best = v), (last = j);
  }
  if (best === Infinity) return answer(input, 'optimization', 'Travelling salesman', 'no tour', { notes: ['No Hamiltonian cycle exists with the given roads.'] });
  const tour: number[] = [];
  let mask = full - 1;
  for (let j = last; j >= 0; ) {
    tour.unshift(j);
    const p = par[mask]![j]!;
    mask &= ~(1 << j);
    j = p;
  }
  tour.push(0);
  // Nearest-neighbour heuristic for comparison.
  const seen = new Set([0]);
  let cur = 0;
  let nn = 0;
  const nnTour = [0];
  while (seen.size < n) {
    let bj = -1;
    for (let k = 0; k < n; k++) if (!seen.has(k) && (bj < 0 || D[cur]![k]! < D[cur]![bj]!)) bj = k;
    nn += D[cur]![bj]!;
    seen.add(bj);
    nnTour.push(bj);
    cur = bj;
  }
  nn += D[cur]![0]!;
  nnTour.push(0);
  const names = (t: number[]) => t.map((i) => G!.names[i]).join(' → ');
  return answer(input, 'optimization', `Travelling salesman (Held–Karp dynamic programming) · ${n} cities`, `${fmt(best)}`, {
    value: best,
    lines: [
      { label: 'Optimal tour', display: names(tour) },
      { label: 'Length', display: fmt(best) },
      { label: 'Nearest neighbour', display: `${Number.isFinite(nn) ? fmt(nn) : '∞'} (${names(nnTour)})` },
    ],
    notes: ['Held–Karp: C(S, j) = min over i of C(S∖{j}, i) + d(i, j); exact, O(n²·2ⁿ). TSP is NP-hard, so heuristics like nearest neighbour are used for large instances.'],
  });
}

function dpClassics(input: string): Result {
  const lc = input.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /\b(?:coin change|make change|minimum coins|fewest coins|ways to make)\b/.exec(lc))) {
    const amt = param(input, ['amount', 'for', 'make', 'total', 'change for', 'change']) ?? numbers(input)[0];
    const coins = readVector(input, /\b(?:coins?|denominations?|using)\b/);
    if (amt === undefined || !coins?.length) refuse('Try “coin change 11 with coins 1 2 5”');
    const A = amt!;
    if (!Number.isInteger(A) || A > 1_000_000 || coins!.some((c) => !Number.isInteger(c) || c <= 0)) refuse('Whole-number amounts and coins');
    const minC = new Array(A + 1).fill(Infinity) as number[];
    const from = new Array(A + 1).fill(-1) as number[];
    const ways = new Array(A + 1).fill(0n) as bigint[];
    minC[0] = 0;
    ways[0] = 1n;
    for (const c of coins!) for (let a = c; a <= A; a++) ways[a]! += ways[a - c]!;
    for (let a = 1; a <= A; a++)
      for (const c of coins!)
        if (c <= a && minC[a - c]! + 1 < minC[a]!) (minC[a] = minC[a - c]! + 1), (from[a] = c);
    const used: number[] = [];
    for (let a = A; a > 0 && from[a]! > 0; a -= from[a]!) used.push(from[a]!);
    return answer(input, 'optimization', `Coin change · amount ${A}, coins {${coins!.join(', ')}}`, minC[A] === Infinity ? 'impossible' : `${minC[A]} coins`, {
      value: Number.isFinite(minC[A]) ? minC[A] : undefined,
      lines: [
        { label: 'Fewest coins', display: minC[A] === Infinity ? 'impossible' : `${minC[A]}: ${used.sort((a, b) => b - a).join(' + ')}` },
        { label: 'Number of ways', display: ways[A]!.toString() },
      ],
      table: A <= 20 ? { columns: ['amount', ...Array.from({ length: A + 1 }, (_, k) => String(k))], rows: [['min coins', ...minC.map((x) => (x === Infinity ? '∞' : String(x)))], ['ways', ...ways.map(String)]] } : undefined,
      notes: ['min(a) = 1 + min over coins c ≤ a of min(a − c); ways counted coin by coin so order doesn’t matter.'],
    });
  }
  if ((m = /\b(?:lcs|longest common subsequence)\b(?:\s+of)?\s+["']?([a-z0-9]+)["']?\s*(?:,|and|\s)\s*["']?([a-z0-9]+)["']?/i.exec(input))) {
    const a = m[1]!;
    const b = m[2]!;
    const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0) as number[]);
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) L[i]![j] = a[i - 1] === b[j - 1] ? L[i - 1]![j - 1]! + 1 : Math.max(L[i - 1]![j]!, L[i]![j - 1]!);
    let s = '';
    for (let i = a.length, j = b.length; i && j; ) {
      if (a[i - 1] === b[j - 1]) (s = a[i - 1] + s), i--, j--;
      else if (L[i - 1]![j]! >= L[i]![j - 1]!) i--;
      else j--;
    }
    return answer(input, 'optimization', `Longest common subsequence of “${a}” and “${b}”`, `${L[a.length]![b.length]} (${s})`, {
      value: L[a.length]![b.length],
      table: a.length <= 12 && b.length <= 12 ? { columns: ['', 'ε', ...b.split('')], rows: L.map((r, i) => [i ? a[i - 1]! : 'ε', ...r.map(String)]) } : undefined,
      notes: ['L(i, j) = L(i−1, j−1) + 1 if the characters match, else max(L(i−1, j), L(i, j−1)).'],
    });
  }
  if ((m = /\b(?:edit distance|levenshtein(?: distance)?)\b(?:\s+(?:between|of|from))?\s+["']?([a-z0-9]+)["']?\s*(?:,|and|to|\s)\s*["']?([a-z0-9]+)["']?/i.exec(input))) {
    const a = m[1]!;
    const b = m[2]!;
    const E = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) E[i]![j] = Math.min(E[i - 1]![j]! + 1, E[i]![j - 1]! + 1, E[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return answer(input, 'optimization', `Levenshtein edit distance “${a}” → “${b}”`, String(E[a.length]![b.length]), {
      value: E[a.length]![b.length],
      table: a.length <= 12 && b.length <= 12 ? { columns: ['', 'ε', ...b.split('')], rows: E.map((r, i) => [i ? a[i - 1]! : 'ε', ...r.map(String)]) } : undefined,
      notes: ['Insertions, deletions and substitutions each cost 1.'],
    });
  }
  if (/\b(?:lis|longest increasing subsequence)\b/.test(lc)) {
    const a = numbers(input.replace(/^.*?subsequence|^.*?\blis\b/i, ''));
    if (a.length < 1) refuse('Give a list of numbers');
    const len = a.map(() => 1);
    const prev = a.map(() => -1);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) if (a[j]! < a[i]! && len[j]! + 1 > len[i]!) (len[i] = len[j]! + 1), (prev[i] = j);
    let k = len.indexOf(Math.max(...len));
    const seq: number[] = [];
    while (k >= 0) seq.unshift(a[k]!), (k = prev[k]!);
    return answer(input, 'optimization', `Longest strictly increasing subsequence of ${a.length} numbers`, String(seq.length), { value: seq.length, lines: [{ label: 'One LIS', display: seq.map((x) => fmt(x)).join(', ') }], table: { columns: ['i', 'aᵢ', 'LIS ending here'], rows: a.map((x, i) => [String(i + 1), fmt(x), String(len[i])]) }, notes: ['L(i) = 1 + max L(j) over j < i with aⱼ < aᵢ.'] });
  }
  if (/\bmatrix chain\b/.test(lc)) {
    const d = numbers(input.replace(/^.*?matrix chain(?:\s+(?:multiplication|order(?:ing)?))?/i, ''));
    if (d.length < 3) refuse('Give the dimensions p₀ p₁ … pₙ, e.g. “matrix chain 10 30 5 60”');
    const n = d.length - 1;
    const M = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
    const Sx = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
    for (let len = 2; len <= n; len++)
      for (let i = 0; i + len - 1 < n; i++) {
        const j = i + len - 1;
        M[i]![j] = Infinity;
        for (let k = i; k < j; k++) {
          const c = M[i]![k]! + M[k + 1]![j]! + d[i]! * d[k + 1]! * d[j + 1]!;
          if (c < M[i]![j]!) (M[i]![j] = c), (Sx[i]![j] = k);
        }
      }
    const paren = (i: number, j: number): string => (i === j ? `A${i + 1}` : `(${paren(i, Sx[i]![j]!)}${paren(Sx[i]![j]! + 1, j)})`);
    return answer(input, 'optimization', `Matrix chain multiplication · ${n} matrices`, `${fmt(M[0]![n - 1]!)} scalar multiplications`, { value: M[0]![n - 1], lines: [{ label: 'Best order', display: paren(0, n - 1) }, { label: 'Dimensions', display: Array.from({ length: n }, (_, i) => `A${i + 1}: ${d[i]}×${d[i + 1]}`).join(', ') }], notes: ['m(i, j) = min over k of m(i, k) + m(k+1, j) + pᵢ₋₁pₖpⱼ.'] });
  }
  if (/\brod cutting\b/.test(lc)) {
    const len = param(input, ['length', 'rod length', 'n']);
    const prices = readVector(input, /\bprices?\b/);
    if (len === undefined || !prices) refuse('Try “rod cutting length 8 prices 1 5 8 9 10 17 17 20”');
    const L = len!;
    const r = new Array(L + 1).fill(0) as number[];
    const cut = new Array(L + 1).fill(0) as number[];
    for (let j = 1; j <= L; j++)
      for (let i = 1; i <= Math.min(j, prices!.length); i++) if (prices![i - 1]! + r[j - i]! > r[j]!) (r[j] = prices![i - 1]! + r[j - i]!), (cut[j] = i);
    const pieces: number[] = [];
    for (let j = L; j > 0 && cut[j]! > 0; j -= cut[j]!) pieces.push(cut[j]!);
    return answer(input, 'optimization', `Rod cutting · length ${L}`, `max revenue ${fmt(r[L]!)}`, { value: r[L], lines: [{ label: 'Pieces', display: pieces.join(' + ') }], notes: ['r(n) = max over first cut i of pᵢ + r(n − i) (CLRS §15.1).'] });
  }
  return null;
}

// ─── Queueing ───

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function queueing(input: string): Result {
  const lc = input.toLowerCase().replace(/\s+/g, ' ');
  const m = /\bm\s*\/\s*([mdg])\s*\/\s*(\d+|c|s|1)(?:\s*\/\s*(\d+|k))?\b/.exec(lc);
  if (!m && !/\bqueu\w*\b|\bwaiting line\b/.test(lc)) return null;
  const lam = param(input, ['lambda', 'λ', 'arrival rate', 'arrivals', 'arrive at', 'arrive'], undefined);
  const mu = param(input, ['mu', 'μ', 'service rate', 'served at', 'serves', 'service']);
  if (lam === undefined || mu === undefined) {
    if (m) refuse('Give the arrival rate λ and the service rate μ, e.g. “M/M/1 λ=4 μ=5”');
    return null;
  }
  const svc = m?.[1] ?? 'm';
  let c = m?.[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : (param(input, ['c', 's', 'servers'], 1) ?? 1);
  const K = m?.[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : param(input, ['K', 'capacity', 'max in system']);
  if (m?.[2] && !/^\d+$/.test(m[2])) c = param(input, ['c', 's', 'servers'], 1)!;
  const rho = lam / (c * mu);
  const lines: Line[] = [];
  let model = '';
  let L: number, Lq: number, W: number, Wq: number, P0: number;
  const notes: string[] = [];
  const pn: number[] = [];
  if (svc === 'm' && K !== undefined) {
    if (c !== 1) {
      // M/M/c/K
      const r = lam / mu;
      const terms = Array.from({ length: K + 1 }, (_, n) => (n <= c ? r ** n / factorial(n) : r ** n / (factorial(c) * c ** (n - c))));
      P0 = 1 / sum(terms);
      terms.forEach((t) => pn.push(t * P0));
      Lq = pn.reduce((s, p, n) => (n > c ? s + (n - c) * p : s), 0);
      L = pn.reduce((s, p, n) => s + n * p, 0);
    } else {
      const r = lam / mu;
      for (let n = 0; n <= K; n++) pn.push(r === 1 ? 1 / (K + 1) : ((1 - r) * r ** n) / (1 - r ** (K + 1)));
      P0 = pn[0]!;
      L = pn.reduce((s, p, n) => s + n * p, 0);
      Lq = L - (1 - P0);
    }
    const lamEff = lam * (1 - pn[K]!);
    W = L / lamEff;
    Wq = Lq / lamEff;
    model = `M/M/${c}/${K}`;
    lines.push({ label: 'Blocking probability P_K', display: fmt(pn[K]!, 6) }, { label: 'Effective arrival rate', display: fmt(lamEff, 6) });
    notes.push('Finite capacity: arrivals that find K customers in the system are turned away, so the queue is stable even when ρ ≥ 1.');
  } else {
    if (rho >= 1) return answer(input, 'queueing', `M/${svc.toUpperCase()}/${c} queue · λ = ${fmt(lam)}, μ = ${fmt(mu)}`, 'unstable (ρ ≥ 1)', { lines: [{ label: 'Utilisation ρ = λ/(cμ)', display: fmt(rho, 6) }], notes: ['Arrivals outpace service, so the queue grows without bound; no steady state exists.'] });
    if (svc === 'm' && c === 1) {
      P0 = 1 - rho;
      L = rho / (1 - rho);
      Lq = (rho * rho) / (1 - rho);
      W = 1 / (mu - lam);
      Wq = rho / (mu - lam);
      model = 'M/M/1';
      for (let n = 0; n <= 5; n++) pn.push((1 - rho) * rho ** n);
    } else if (svc === 'm') {
      const r = lam / mu;
      let s0 = 0;
      for (let n = 0; n < c; n++) s0 += r ** n / factorial(n);
      const tail = r ** c / (factorial(c) * (1 - rho));
      P0 = 1 / (s0 + tail);
      const erlangC = tail * P0;
      Lq = (erlangC * rho) / (1 - rho);
      Wq = Lq / lam;
      W = Wq + 1 / mu;
      L = lam * W;
      model = `M/M/${c}`;
      lines.push({ label: 'P(wait) (Erlang C)', display: fmt(erlangC, 6) });
      for (let n = 0; n <= 5; n++) pn.push(n < c ? (r ** n / factorial(n)) * P0 : (r ** n / (factorial(c) * c ** (n - c))) * P0);
    } else {
      // M/D/1 or M/G/1 (Pollaczek–Khinchine).
      if (c !== 1) refuse('M/D/c and M/G/c have no simple closed form; try c = 1');
      const sd = svc === 'd' ? 0 : param(input, ['sigma', 'σ', 'sd', 'standard deviation', 'std'], undefined) ?? (param(input, ['variance', 'var'], undefined) !== undefined ? Math.sqrt(param(input, ['variance', 'var'])!) : undefined);
      if (sd === undefined) refuse('M/G/1 needs the service-time standard deviation σ');
      Lq = (lam * lam * sd! * sd! + rho * rho) / (2 * (1 - rho));
      L = Lq + rho;
      Wq = Lq / lam;
      W = Wq + 1 / mu;
      P0 = 1 - rho;
      model = svc === 'd' ? 'M/D/1' : 'M/G/1';
      notes.push('Pollaczek–Khinchine formula: Lq = (λ²σ² + ρ²)/(2(1 − ρ)).');
    }
  }
  const unit = /\bper hour|\/h(?:ou)?r\b|an hour/.test(lc) ? ' h' : /\bper minute|\/min\b|a minute/.test(lc) ? ' min' : '';
  return answer(input, 'queueing', `${model} queue · λ = ${fmt(lam)}, μ = ${fmt(mu)}${c > 1 ? `, c = ${c}` : ''}${K !== undefined ? `, K = ${K}` : ''}`, `L = ${fmt(L, 6)}, W = ${fmt(W, 6)}${unit}`, {
    value: L,
    lines: [
      { label: 'Utilisation ρ = λ/(cμ)', display: fmt(rho, 6) },
      { label: 'P₀ (system empty)', display: fmt(P0, 6) },
      { label: 'L (avg in system)', display: fmt(L, 6) },
      { label: 'Lq (avg in queue)', display: fmt(Lq, 6) },
      { label: 'W (avg time in system)', display: `${fmt(W, 6)}${unit}` },
      { label: 'Wq (avg wait in queue)', display: `${fmt(Wq, 6)}${unit}` },
      ...lines,
    ],
    table: pn.length ? { columns: ['n', 'Pₙ'], rows: pn.slice(0, 11).map((p, n) => [String(n), fmt(p, 6)]), caption: 'Steady-state probabilities' } : undefined,
    notes: [...notes, 'Little’s law: L = λW and Lq = λWq (with the effective arrival rate for finite queues).'],
  });
}

// ─── Inventory (OR forms) ───

function inventory(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:epq|economic production|production (?:lot|quantity|rate)|poq|eoq|economic order)\b/.test(lc)) return null;
  const isEPQ = /\b(?:epq|economic production|production (?:lot|quantity|rate)|poq)\b/.test(lc);
  const isBack = /\b(?:backorders?|back-?order\w*|shortages?|stockouts? allowed|planned shortage)\b/.test(lc);
  const isDisc = /\b(?:quantity discounts?|price breaks?|all-units discount)\b/.test(lc);
  if (!isEPQ && !isBack && !isDisc) return null; // plain EOQ belongs to the business/finance engine
  const D = param(input, ['D', 'demand', 'annual demand']);
  const S = param(input, ['S', 'K', 'setup cost', 'setup', 'ordering cost', 'order cost', 'cost per order']);
  let H = param(input, ['H', 'h', 'holding cost', 'holding', 'carrying cost']);
  if (D === undefined || S === undefined) refuse('Give D (annual demand) and S (setup/order cost) plus H (holding cost per unit per year)');
  if (isDisc) {
    const i = param(input, ['i', 'I', 'holding rate', 'carrying rate']);
    const br = [...input.matchAll(/(\d[\d,]*)\s*(?:\+|-\s*\d[\d,]*|to\s*\d[\d,]*|or more)?\s*(?:units)?\s*[:@]\s*\$?\s*([\d.]+)/g)].map((mm) => ({ min: Number(mm[1]!.replace(/,/g, '')), price: Number(mm[2]) }));
    if (!br.length || (i === undefined && H === undefined)) refuse('Give price breaks like “0: 5, 1000: 4.8, 2000: 4.75” and a holding rate i (fraction of price)');
    br.sort((a, b) => a.min - b.min);
    const rows: string[][] = [];
    let best = { q: 0, cost: Infinity, price: 0 };
    br.forEach((b, k) => {
      const h = i !== undefined ? i * b.price : H!;
      const eoq = Math.sqrt((2 * D! * S!) / h);
      const max = br[k + 1] ? br[k + 1]!.min - 1 : Infinity;
      const q = Math.min(Math.max(eoq, b.min), max);
      const tc = D! * b.price + (D! / q) * S! + (q / 2) * h;
      rows.push([`≥ ${fmt(b.min)}`, fmt(b.price), fmt(eoq, 6), fmt(q, 6), fmt(tc, 8)]);
      if (tc < best.cost) best = { q, cost: tc, price: b.price };
    });
    return answer(input, 'inventory', `EOQ with all-units quantity discounts · D = ${fmt(D!)}, S = ${fmt(S!)}`, `order ${fmt(best.q, 6)} units`, { value: best.q, lines: [{ label: 'Unit price', display: fmt(best.price) }, { label: 'Total annual cost', display: fmt(best.cost, 8) }], table: { columns: ['break', 'price', 'EOQ at price', 'feasible Q', 'total cost'], rows, highlightRow: rows.findIndex((r) => r[1] === fmt(best.price)) }, notes: ['For each price, the EOQ is pushed up to the break if it falls below it; the cheapest total (purchase + ordering + holding) wins.'] });
  }
  if (H === undefined) refuse('Give the holding cost H per unit per year');
  if (isEPQ && !isBack) {
    const p = param(input, ['p', 'P', 'production rate', 'production', 'produce']);
    const d = param(input, ['d', 'demand rate', 'usage rate']) ?? D!;
    if (p === undefined) refuse('Give the production rate p (same time unit as demand)');
    if (p! <= d) refuse('Production rate must exceed the demand rate');
    const q = Math.sqrt((2 * D! * S!) / (H! * (1 - d / p!)));
    const imax = q * (1 - d / p!);
    const tc = (D! / q) * S! + (imax / 2) * H!;
    return answer(input, 'inventory', `Economic production quantity · D = ${fmt(D!)}, S = ${fmt(S!)}, H = ${fmt(H!)}, p = ${fmt(p!)}`, `Q* = ${fmt(q, 8)}`, {
      value: q,
      lines: [
        { label: 'Formula', display: 'Q* = √(2DS / (H(1 − d/p)))' },
        { label: 'Max inventory', display: fmt(imax, 8) },
        { label: 'Production runs per year', display: fmt(D! / q, 6) },
        { label: 'Annual setup + holding cost', display: fmt(tc, 8) },
      ],
      notes: ['Inventory builds at rate p − d during a run, so average stock is Imax/2, not Q/2.'],
    });
  }
  const B = param(input, ['B', 'b', 'p', 'shortage cost', 'backorder cost', 'stockout cost', 'penalty']);
  if (B === undefined) refuse('Give the backorder cost B per unit per year');
  const q = Math.sqrt(((2 * D! * S!) / H!) * ((H! + B!) / B!));
  const smax = q * (H! / (H! + B!));
  const tc = (D! / q) * S! + ((q - smax) ** 2 * H!) / (2 * q) + (smax ** 2 * B!) / (2 * q);
  return answer(input, 'inventory', `EOQ with planned backorders · D = ${fmt(D!)}, S = ${fmt(S!)}, H = ${fmt(H!)}, B = ${fmt(B!)}`, `Q* = ${fmt(q, 8)}`, {
    value: q,
    lines: [
      { label: 'Formula', display: 'Q* = √(2DS/H · (H + B)/B)' },
      { label: 'Max backorder S*', display: fmt(smax, 8) },
      { label: 'Max inventory Q* − S*', display: fmt(q - smax, 8) },
      { label: 'Annual cost', display: fmt(tc, 8) },
    ],
    notes: ['Allowing shortages lengthens cycles; as B → ∞ this reduces to the classic EOQ.'],
  });
}

// ─── Decision analysis ───

function decision(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:decision (?:table|matrix|tree|analysis)|payoff (?:table|matrix)|expected (?:monetary )?value|emv|evpi|maximax|maximin|minimax regret|hurwicz|laplace criterion)\b/.test(lc)) return null;
  if (/\bgame\b|\bnash\b|\bzero[- ]sum\b/.test(lc)) return null;
  const probs = readVector(input, /\b(?:probabilit(?:y|ies)|probs?|p)\b/);
  const M = parseMatrix(input.slice(input.search(/\[\s*\[|(?:matrix|table)\s*[:=]?\s*[-\d]/i)).replace(/^\D*?(?=[-\d[])/, ''));
  if (!M) {
    // A single gamble: "expected value payoffs 100 -50 probabilities 0.6 0.4".
    const pay = readVector(input, /\b(?:payoffs?|outcomes?|values?)\b/);
    if (!pay || !probs || pay.length !== probs.length) return null;
    const ps = sum(probs);
    if (Math.abs(ps - 1) > 1e-6) refuse(`Probabilities add up to ${fmt(ps)}, not 1`);
    const ev = sum(pay.map((x, i) => x * probs[i]!));
    const varr = sum(pay.map((x, i) => probs[i]! * (x - ev) ** 2));
    return answer(input, 'decision', 'Expected value of a gamble', fmt(ev, 10), { value: ev, lines: [{ label: 'E[X] = Σ pᵢxᵢ', display: pay.map((x, i) => `${fmt(probs[i]!)}×${fmt(x)}`).join(' + ') }, { label: 'Variance', display: fmt(varr, 8) }, { label: 'Std deviation', display: fmt(Math.sqrt(varr), 8) }] });
  }
  const nAlt = M.length;
  const nState = M[0]!.length;
  if (M.some((r) => r.length !== nState)) refuse('Every row (alternative) needs one payoff per state');
  const costs = /\bcosts?\b/.test(lc) && !/\bpayoff|profit\b/.test(lc);
  const sign = costs ? -1 : 1;
  const P = sign === 1 ? M : M.map((r) => r.map((x) => -x));
  const alpha = param(input, ['alpha', 'α', 'hurwicz', 'coefficient of optimism'], 0.5)!;
  const colMax = P[0]!.map((_, j) => Math.max(...P.map((r) => r[j]!)));
  const regret = P.map((r) => r.map((x, j) => colMax[j]! - x));
  const crit = P.map((r, i) => ({
    maximax: Math.max(...r),
    maximin: Math.min(...r),
    regret: Math.max(...regret[i]!),
    hurwicz: alpha * Math.max(...r) + (1 - alpha) * Math.min(...r),
    laplace: sum(r) / nState,
    emv: probs && probs.length === nState ? sum(r.map((x, j) => x * probs[j]!)) : NaN,
  }));
  const argBest = (k: keyof (typeof crit)[0], min = false) => {
    let b = 0;
    crit.forEach((c, i) => {
      if (min ? c[k] < crit[b]![k] : c[k] > crit[b]![k]) b = i;
    });
    return b;
  };
  const show = (x: number) => fmt(sign * x, 8);
  const lines: Line[] = [];
  const name = (i: number) => `A${i + 1}`;
  if (probs && probs.length === nState) {
    const ps = sum(probs);
    if (Math.abs(ps - 1) > 1e-6) refuse(`Probabilities add up to ${fmt(ps)}, not 1`);
    const b = argBest('emv');
    const evwpi = sum(colMax.map((x, j) => x * probs[j]!));
    lines.push({ label: costs ? 'Lowest expected cost' : 'Best EMV', display: `${name(b)}: ${show(crit[b]!.emv)}` });
    lines.push({ label: 'EVPI', display: `${fmt(evwpi - crit[b]!.emv, 8)} (EV with perfect information ${show(evwpi)} − best EMV)` });
    lines.push({ label: 'Min expected regret (EOL)', display: fmt(Math.min(...regret.map((r) => sum(r.map((x, j) => x * probs[j]!)))), 8) });
  }
  lines.push(
    { label: costs ? 'Minimin' : 'Maximax (optimist)', display: `${name(argBest('maximax'))}` },
    { label: costs ? 'Minimax' : 'Maximin (pessimist)', display: `${name(argBest('maximin'))}` },
    { label: 'Minimax regret', display: `${name(argBest('regret', true))}` },
    { label: `Hurwicz (α = ${fmt(alpha)})`, display: `${name(argBest('hurwicz'))}` },
    { label: 'Laplace (equally likely)', display: `${name(argBest('laplace'))}` },
  );
  const hasP = probs && probs.length === nState;
  const rows = M.map((r, i) => [name(i), ...r.map((x) => fmt(x)), ...(hasP ? [show(crit[i]!.emv)] : []), show(crit[i]!.maximax), show(crit[i]!.maximin), fmt(crit[i]!.regret), show(crit[i]!.hurwicz), show(crit[i]!.laplace)]);
  const best = hasP ? argBest('emv') : argBest('maximin');
  return answer(input, 'decision', `Decision analysis · ${nAlt} alternatives × ${nState} states${costs ? ' (costs)' : ''}`, hasP ? `choose ${name(best)} (EMV ${show(crit[best]!.emv)})` : `maximin: ${name(best)}`, {
    value: hasP ? sign * crit[best]!.emv : undefined,
    lines,
    table: { columns: ['', ...M[0]!.map((_, j) => `S${j + 1}`), ...(hasP ? ['EMV'] : []), costs ? 'best' : 'max', costs ? 'worst' : 'min', 'max regret', 'Hurwicz', 'Laplace'], rows, highlightRow: best },
    notes: ['EMV = Σ p·payoff; EVPI is the most you should pay for perfect information about the state.'],
  });
}

// ─── Game theory ───

function parseBimatrix(s: string): { A: number[][]; B: number[][] } | null {
  const rows = [...s.matchAll(/\[((?:\s*\(\s*[-−\d.]+\s*,\s*[-−\d.]+\s*\)\s*,?)+)\]/g)];
  if (!rows.length) return null;
  const A: number[][] = [];
  const B: number[][] = [];
  for (const r of rows) {
    const cells = [...r[1]!.matchAll(/\(\s*([-−\d.]+)\s*,\s*([-−\d.]+)\s*\)/g)];
    A.push(cells.map((c) => Number(c[1]!.replace('−', '-'))));
    B.push(cells.map((c) => Number(c[2]!.replace('−', '-'))));
  }
  return A.every((r) => r.length === A[0]!.length) ? { A, B } : null;
}

const PRESETS: Record<string, { A: number[][]; B: number[][]; r: string[]; c: string[] }> = {
  "prisoner's dilemma": { A: [[-1, -3], [0, -2]], B: [[-1, 0], [-3, -2]], r: ['Cooperate', 'Defect'], c: ['Cooperate', 'Defect'] },
  'battle of the sexes': { A: [[3, 0], [0, 2]], B: [[2, 0], [0, 3]], r: ['Opera', 'Football'], c: ['Opera', 'Football'] },
  'matching pennies': { A: [[1, -1], [-1, 1]], B: [[-1, 1], [1, -1]], r: ['Heads', 'Tails'], c: ['Heads', 'Tails'] },
  'stag hunt': { A: [[4, 0], [3, 3]], B: [[4, 3], [0, 3]], r: ['Stag', 'Hare'], c: ['Stag', 'Hare'] },
  chicken: { A: [[0, -1], [1, -10]], B: [[0, 1], [-1, -10]], r: ['Swerve', 'Straight'], c: ['Swerve', 'Straight'] },
  'rock paper scissors': { A: [[0, -1, 1], [1, 0, -1], [-1, 1, 0]], B: [[0, 1, -1], [-1, 0, 1], [1, -1, 0]], r: ['Rock', 'Paper', 'Scissors'], c: ['Rock', 'Paper', 'Scissors'] },
};

function solveZeroSum(A: number[][]) {
  const m = A.length;
  const n = A[0]!.length;
  const shift = 1 - Math.min(...A.flat());
  // Row player: max v s.t. Σᵢ pᵢ aᵢⱼ ≥ v. With shifted payoffs: min Σ xᵢ s.t. Σᵢ xᵢ aᵢⱼ ≥ 1.
  const r1 = simplex({ c: new Array(m).fill(1), A: A[0]!.map((_, j) => A.map((r) => r[j]! + shift)), b: new Array(n).fill(1), ops: new Array(n).fill('>=') as Op[], maximize: false });
  const r2 = simplex({ c: new Array(n).fill(1), A: A.map((r) => r.map((x) => x + shift)), b: new Array(m).fill(1), ops: new Array(m).fill('<=') as Op[], maximize: true });
  const v = 1 / r1.value - shift;
  return { v: clean(v), p: r1.x.map((x) => clean(x / r1.value)), q: r2.x.map((x) => clean(x / r2.value)) };
}

function gameTheory(input: string): Result {
  const lc = input.toLowerCase().replace(/’/g, "'");
  if (!/\b(?:game|nash|minimax|saddle point|zero[- ]sum|payoff matrix|dominant strateg\w*|prisoner'?s dilemma|battle of the sexes|matching pennies|stag hunt|chicken|rock paper scissors|mixed strateg\w*)\b/.test(lc)) return null;
  if (/\bnim\b|\bgame of life\b|\bsprague|grundy\b/.test(lc)) return null;
  const preset = Object.keys(PRESETS).find((k) => lc.replace(/-/g, ' ').includes(k));
  const bi = parseBimatrix(input);
  let A: number[][];
  let B: number[][] | null = null;
  let rN: string[];
  let cN: string[];
  if (bi) {
    A = bi.A;
    B = bi.B;
  } else if (preset && !/\[\s*\[/.test(input)) {
    ({ A, B } = PRESETS[preset]!);
  } else {
    const M = parseMatrix(input.slice(input.search(/\[\s*\[|\d|-/)));
    if (!M) return null;
    A = M;
    if (!/\bzero[- ]sum|minimax|saddle|value of the game\b/.test(lc) && /\bnash\b/.test(lc)) B = M.map((r) => r.map((x) => -x));
  }
  if (A.some((r) => r.length !== A[0]!.length)) refuse('Every row needs the same number of entries');
  const m = A.length;
  const n = A[0]!.length;
  rN = preset && !bi ? PRESETS[preset]!.r : A.map((_, i) => `R${i + 1}`);
  cN = preset && !bi ? PRESETS[preset]!.c : A[0]!.map((_, j) => `C${j + 1}`);
  const zeroSum = !B || A.every((r, i) => r.every((x, j) => Math.abs(x + B![i]![j]!) < 1e-12));
  if (zeroSum) {
    const rowMin = A.map((r) => Math.min(...r));
    const colMax = A[0]!.map((_, j) => Math.max(...A.map((r) => r[j]!)));
    const lower = Math.max(...rowMin);
    const upper = Math.min(...colMax);
    const saddle = lower === upper;
    const sol = solveZeroSum(A);
    const lines: Line[] = [
      { label: 'Maximin (row player)', display: `${fmt(lower)} (row minima ${rowMin.map((x) => fmt(x)).join(', ')})` },
      { label: 'Minimax (column player)', display: `${fmt(upper)} (column maxima ${colMax.map((x) => fmt(x)).join(', ')})` },
      { label: 'Saddle point', display: saddle ? `yes, at ${A.flatMap((r, i) => r.map((x, j) => (x === lower && rowMin[i] === lower && colMax[j] === lower ? `(${rN[i]}, ${cN[j]})` : ''))).filter(Boolean).join(', ')}` : 'no: mixed strategies needed' },
      { label: 'Row strategy p', display: sol.p.map((x, i) => `${rN[i]} ${fmt(x, 6)}`).join(', ') },
      { label: 'Column strategy q', display: sol.q.map((x, j) => `${cN[j]} ${fmt(x, 6)}`).join(', ') },
    ];
    return answer(input, 'game', `Two-person zero-sum game · ${m}×${n} payoff matrix (to the row player)`, `value = ${fmt(sol.v, 8)}`, {
      value: sol.v,
      lines,
      notes: ['Von Neumann’s minimax theorem: max over p of min over q equals min over q of max over p; found here by linear programming.'],
    });
  }
  // General-sum: pure equilibria + support enumeration (small games).
  const Bm = B!;
  const pure: string[] = [];
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      const bestRow = A.every((r) => r[j]! <= A[i]![j]! + 1e-12);
      const bestCol = Bm[i]!.every((x) => x <= Bm[i]![j]! + 1e-12);
      if (bestRow && bestCol) pure.push(`(${rN[i]}, ${cN[j]}) payoffs (${fmt(A[i]![j]!)}, ${fmt(Bm[i]![j]!)})`);
    }
  const mixed: string[] = [];
  if (m <= 4 && n <= 4) {
    const subsets = (k: number) => Array.from({ length: (1 << k) - 1 }, (_, s) => Array.from({ length: k }, (_, i) => i).filter((i) => (s + 1) & (1 << i)));
    for (const S of subsets(m))
      for (const T of subsets(n)) {
        if (S.length !== T.length || S.length < 2) continue;
        // Column mix q on T making rows in S indifferent; row mix p on S making columns in T indifferent.
        const q = solveIndiff(S.map((i) => T.map((j) => A[i]![j]!)));
        const p = solveIndiff(T.map((j) => S.map((i) => Bm[i]![j]!)));
        if (!q || !p) continue;
        const qf = new Array(n).fill(0) as number[];
        T.forEach((j, k) => (qf[j] = q.mix[k]!));
        const pf = new Array(m).fill(0) as number[];
        S.forEach((i, k) => (pf[i] = p.mix[k]!));
        const rowPay = A.map((r) => r.reduce((s, x, j) => s + x * qf[j]!, 0));
        const colPay = A[0]!.map((_, j) => pf.reduce((s, x, i) => s + x * Bm[i]![j]!, 0));
        if (Math.max(...rowPay) > q.value + 1e-9 || Math.max(...colPay) > p.value + 1e-9) continue;
        mixed.push(`row (${pf.map((x, i) => `${rN[i]} ${fmt(x, 6)}`).join(', ')}), column (${qf.map((x, j) => `${cN[j]} ${fmt(x, 6)}`).join(', ')}); payoffs (${fmt(q.value, 6)}, ${fmt(p.value, 6)})`);
      }
  }
  const dom: string[] = [];
  for (let i = 0; i < m; i++) if (A.every((r, k) => k === i || r.every((x, j) => A[i]![j]! > x))) dom.push(`${rN[i]} strictly dominates for the row player`);
  for (let j = 0; j < n; j++) if (A[0]!.every((_, k) => k === j || Bm.every((r) => r[j]! > r[k]!))) dom.push(`${cN[j]} strictly dominates for the column player`);
  const total = pure.length + mixed.length;
  return answer(input, 'game', `${preset && !bi ? preset[0]!.toUpperCase() + preset.slice(1) : 'Bimatrix game'} · ${m}×${n}`, `${total} Nash equilibri${total === 1 ? 'um' : 'a'}`, {
    lines: [
      { label: 'Pure equilibria', display: pure.join('; ') || 'none' },
      { label: 'Mixed equilibria', display: mixed.join('; ') || (m <= 4 && n <= 4 ? 'none' : 'not searched (over 4×4)') },
      ...(dom.length ? [{ label: 'Dominance', display: dom.join('; ') }] : []),
    ],
    table: { columns: ['', ...cN], rows: A.map((r, i) => [rN[i]!, ...r.map((x, j) => `(${fmt(x)}, ${fmt(Bm[i]![j]!)})`)]), caption: 'Payoffs (row, column)' },
    notes: ['Nash equilibrium: no player gains by deviating alone. Mixed equilibria found by support enumeration (each player makes the other indifferent over the support).'],
  });
}

/** Mix over columns of M (k×k) making every row's payoff equal: returns mix and that common value. */
function solveIndiff(M: number[][]): { mix: number[]; value: number } | null {
  const k = M.length;
  // Unknowns: mix (k) and v. Equations: M·mix − v = 0 (k rows), Σ mix = 1.
  const A = M.map((r) => [...r, -1]);
  A.push([...new Array(k).fill(1), 0]);
  const b = [...new Array(k).fill(0), 1];
  const inv = invert(A);
  if (!inv) return null;
  const z = inv.map((r) => r.reduce((s, a, i) => s + a * b[i]!, 0));
  const mix = z.slice(0, k);
  if (mix.some((x) => x < -1e-9)) return null;
  return { mix: mix.map((x) => Math.max(0, x)), value: z[k]! };
}

// ─── Gradient descent & Newton optimisation ───

function iterativeOpt(input: string): Result {
  const lc = input.toLowerCase();
  const gd = /\bgradient (?:descent|ascent)\b|\bsteepest descent\b/.test(lc);
  const nt = /\bnewton'?s? (?:method )?(?:to |for )?(?:minimi[sz]\w*|maximi[sz]\w*|optimi[sz]\w*)|\bnewton (?:optimi[sz]ation|step)\b|\bminimi[sz]e .* (?:with|using) newton/.test(lc);
  const gs = /\bgolden[- ]section\b/.test(lc);
  if (!gd && !nt && !gs) return null;
  let body = input
    .replace(/\s*,?\s*(?:using|with|by)\s+(?:newton'?s?|gradient descent|golden[- ]section)(?:\s+(?:method|search))?/i, ' ')
    .replace(/^.*?(?:gradient (?:descent|ascent)|steepest descent|golden[- ]section(?: search)?|newton'?s?(?: method)?(?: optimi[sz]ation| step)?)\s*/i, '')
    .replace(/^(?:to\s+|for\s+)?(?:(?:minimi[sz]e|maximi[sz]e|optimi[sz]e|on|of|for|find the (?:minimum|maximum) of)\s+)?/i, '')
    .replace(/^(?:minimi[sz]e|maximi[sz]e)\s+/i, '');
  const fdef = /^f\s*\(([a-z][a-z0-9,\s]*)\)\s*=\s*/i.exec(body);
  if (fdef) body = body.slice(fdef[0].length);
  const cut = /\s*(?:,\s*(?=(?:from|start|starting|with|learning|step|alpha|lr|eta|on|over|x0|\d+\s+(?:iterations|steps)))|\bfrom\b|\bstarting\b|\bstart\b|\bwith\b|\blearning\b|\bstep\b|\balpha\b|α|η|\beta\b|\blr\b|\bon\s*\[|\bover\b|\[|\bx0\b|\bfor\s+\d|\b\d+\s+(?:iterations|steps)|,|$)/i.exec(body);
  const text = body.slice(0, cut ? cut.index : body.length).trim();
  if (!text) refuse('Try “gradient descent f(x,y) = x^2 + 3y^2 from (1, 1) learning rate 0.1”');
  const vars = fdef ? fdef[1]!.split(',').map((v) => v.trim()) : findVars([text]);
  if (!vars.length || vars.length > 6) refuse('1 to 6 variables');
  const f = compile(text, vars);
  const ascent = /\bascent\b|\bmaximi[sz]/.test(lc);
  if (gs) {
    const iv = /\[\s*([-−\d.]+)\s*,\s*([-−\d.]+)\s*\]/.exec(input) ?? /\b(?:on|over|between|from)\s+([-−\d.]+)\s+(?:to|and)\s+([-−\d.]+)/i.exec(input);
    if (!iv) refuse('Golden-section search needs an interval, e.g. “on [0, 2]”');
    let a = Number(iv![1]!.replace('−', '-'));
    let b = Number(iv![2]!.replace('−', '-'));
    const g = (Math.sqrt(5) - 1) / 2;
    const sgn = ascent ? -1 : 1;
    const rows: string[][] = [];
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    for (let k = 1; k <= 100 && b - a > 1e-8; k++) {
      if (k <= 30) rows.push([String(k), fmt(a, 8), fmt(b, 8), fmt(c, 8), fmt(d, 8), fmt(f(c), 8), fmt(f(d), 8)]);
      if (sgn * f(c) < sgn * f(d)) b = d;
      else a = c;
      c = b - g * (b - a);
      d = a + g * (b - a);
    }
    const x = (a + b) / 2;
    return answer(input, 'optimization', `Golden-section search · ${ascent ? 'max' : 'min'} ${text}`, `x ≈ ${fmt(x, 8)}, f = ${fmt(f(x), 8)}`, { value: x, table: { columns: ['k', 'a', 'b', 'c', 'd', 'f(c)', 'f(d)'], rows }, notes: ['Each step keeps the sub-interval containing the better interior point, shrinking by φ − 1 ≈ 0.618; assumes f is unimodal on the interval.'], exactness: 'numeric' });
  }
  const pt = /\(\s*([-−\d.,\s]+)\)/.exec(body.slice(text.length)) ?? /\b(?:from|starting at|start(?:ing)?|at|x0\s*=)\s*\(?\s*([-−\d.,\s]+?)\)?(?=\s*(?:,\s*[a-z]|\bwith\b|\blearning|\bstep|\balpha|\bα|\bη|$))/i.exec(input);
  let x = pt ? numbers(pt[1]!) : vars.map(() => 0);
  if (x.length !== vars.length) refuse(`Give a starting point with ${vars.length} coordinate${vars.length > 1 ? 's' : ''}`);
  const iters = Math.min(1000, param(input, ['iterations', 'steps', 'iters', 'n'], undefined) ?? (/\b(\d+)\s+(?:iterations|steps)\b/i.exec(input) ? Number(/\b(\d+)\s+(?:iterations|steps)\b/i.exec(input)![1]) : gd ? 10 : 20));
  const rows: string[][] = [];
  const hessian = (p: number[]) =>
    p.map((_, i) =>
      p.map((_, j) => {
        const h = 1e-4;
        const e = (di: number, dj: number) => {
          const q = [...p];
          q[i]! += di;
          q[j]! += dj;
          return f(...q);
        };
        return (e(h, h) - e(h, -h) - e(-h, h) + e(-h, -h)) / (4 * h * h);
      }),
    );
  if (gd) {
    const lr = param(input, ['learning rate', 'step size', 'alpha', 'α', 'eta', 'η', 'lr', 'step'], 0.1)!;
    for (let k = 0; k <= iters; k++) {
      const gr = grad(f, x);
      rows.push([String(k), ...x.map((v) => fmt(v, 8)), fmt(f(...x), 10), fmt(Math.hypot(...gr), 6)]);
      if (k === iters || Math.hypot(...gr) < 1e-12) break;
      x = x.map((v, i) => v + (ascent ? 1 : -1) * lr * gr[i]!);
      if (x.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e100)) refuse(`Diverged at step ${k + 1}: the learning rate ${lr} is too large`);
    }
    return answer(input, 'optimization', `Gradient ${ascent ? 'ascent' : 'descent'} · f(${vars.join(', ')}) = ${text}, step ${fmt(lr)}`, `after ${rows.length - 1} steps: (${x.map((v) => fmt(v, 6)).join(', ')}), f = ${fmt(f(...x), 8)}`, {
      value: f(...x),
      table: { columns: ['k', ...vars, 'f', '‖∇f‖'], rows },
      notes: [`x ← x ${ascent ? '+' : '−'} η∇f(x). Gradients computed by central differences. Converges for convex f when η < 2/L (L = largest Hessian eigenvalue).`],
      exactness: 'numeric',
    });
  }
  for (let k = 0; k <= iters; k++) {
    const gr = grad(f, x);
    rows.push([String(k), ...x.map((v) => fmt(v, 8)), fmt(f(...x), 10), fmt(Math.hypot(...gr), 6)]);
    if (Math.hypot(...gr) < 1e-9 || k === iters) break;
    const H = hessian(x);
    const inv = invert(H);
    if (!inv) refuse('The Hessian is singular here; Newton’s method can’t continue');
    const step = inv!.map((r) => r.reduce((s, a, i) => s + a * gr[i]!, 0));
    x = x.map((v, i) => v - step[i]!);
  }
  const H = hessian(x);
  const det = H.length === 1 ? H[0]![0]! : H.length === 2 ? H[0]![0]! * H[1]![1]! - H[0]![1]! * H[1]![0]! : NaN;
  const kind = H.length === 1 ? (H[0]![0]! > 0 ? 'local minimum' : H[0]![0]! < 0 ? 'local maximum' : 'inconclusive') : H.length === 2 ? (det > 0 ? (H[0]![0]! > 0 ? 'local minimum' : 'local maximum') : det < 0 ? 'saddle point' : 'inconclusive') : '';
  return answer(input, 'optimization', `Newton’s method for optimisation · f(${vars.join(', ')}) = ${text}`, `(${x.map((v) => fmt(v, 8)).join(', ')}), f = ${fmt(f(...x), 10)}`, {
    value: f(...x),
    lines: kind ? [{ label: 'Second-order test', display: kind }] : [],
    table: { columns: ['k', ...vars, 'f', '‖∇f‖'], rows },
    notes: ['x ← x − H⁻¹∇f: Newton’s method on ∇f = 0, quadratic convergence near a nondegenerate stationary point (which may be a max, min or saddle).'],
    exactness: 'numeric',
  });
}

export const optHandlers = [transportation, assignment, knapsack, tsp, dpClassics, queueing, inventory, decision, gameTheory, iterativeOpt];
export { optimization };
