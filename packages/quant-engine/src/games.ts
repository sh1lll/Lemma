import type { AnswerResult } from '@lemma/math-core';
import { answer, bad, bracketBlocks, fix, need, num, param, parseNested, solve, type Lines, type Nested, type Q, type Table } from './util';

/**
 * Game theory for economics: pure and mixed Nash equilibria of small normal-form games (support enumeration,
 * exact for nondegenerate games), strictly dominant strategies and iterated elimination of strictly dominated
 * strategies, typed inline as "[[3,3],[0,5];[5,0],[1,1]]" (row player first in each cell), "A=[[..]] B=[[..]]",
 * or a single matrix for a zero-sum game. Also auctions with independent uniform values: expected revenue (revenue
 * equivalence), equilibrium bids, and the optimal reserve price (Myerson 1981).
 */

interface Game {
  A: number[][];
  B: number[][];
  zeroSum: boolean;
}

function asNum2(n: Nested): number[][] | null {
  if (!Array.isArray(n) || !n.every((r) => Array.isArray(r) && r.every((x) => typeof x === 'number'))) return null;
  return n as number[][];
}

function parseGame(s: string): Game | string | null {
  const twoA = /\ba\s*=\s*(\[[^=]*\])\s*,?\s*(?:and\s*)?b\s*=\s*(\[.*\])/.exec(s);
  if (twoA) {
    const A = asNum2(parseNested(bracketBlocks(twoA[1]!)[0] ?? '') as Nested);
    const B = asNum2(parseNested(bracketBlocks(twoA[2]!)[0] ?? '') as Nested);
    if (!A || !B || A.length !== B.length || A.some((r, i) => r.length !== B[i]!.length)) return 'A and B must be matrices of the same shape';
    return { A, B, zeroSum: false };
  }
  let block = bracketBlocks(s)[0];
  if (!block) {
    const i = s.indexOf('(');
    const j = s.lastIndexOf(')');
    if (i < 0 || j < i) return null;
    block = s.slice(i, j + 1);
  }
  const n = parseNested(block);
  if (!n || !Array.isArray(n) || !n.length) return null;
  const rows = n as Nested[];
  // Bimatrix: rows of cells, each cell [a, b].
  if (rows.every((r) => Array.isArray(r) && r.every((c) => Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === 'number')))) {
    const R = rows as number[][][];
    if (!R.every((r) => r.length === R[0]!.length)) return 'Every row needs the same number of cells';
    return { A: R.map((r) => r.map((c) => c[0]!)), B: R.map((r) => r.map((c) => c[1]!)), zeroSum: false };
  }
  // Flattened rows "[3,3,0,5;5,0,1,1]"? Ambiguous: refuse. A plain numeric matrix is a zero-sum game.
  const M = asNum2(n);
  if (M && M.every((r) => r.length === M[0]!.length)) return { A: M, B: M.map((r) => r.map((x) => -x)), zeroSum: true };
  return 'Write each cell as [row payoff, column payoff], rows separated by ";" — e.g. [[3,3],[0,5];[5,0],[1,1]]';
}

interface Eq {
  x: number[];
  y: number[];
  u: number;
  v: number;
  pure: boolean;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}

/** Support enumeration (equal-size supports): all Nash equilibria of a nondegenerate bimatrix game. */
export function nash(A: number[][], B: number[][]): Eq[] {
  const m = A.length;
  const n = A[0]!.length;
  const out: Eq[] = [];
  const eps = 1e-9;
  for (let k = 1; k <= Math.min(m, n); k++) {
    for (const I of combos(m, k))
      for (const J of combos(n, k)) {
        // Column mix y on J making the row player indifferent across I: A[I,J] y = v, Σy = 1.
        const My = [...I.map((i) => [...J.map((j) => A[i]![j]!), -1]), [...J.map(() => 1), 0]];
        const sy = solve(My, [...I.map(() => 0), 1]);
        const Mx = [...J.map((j) => [...I.map((i) => B[i]![j]!), -1]), [...I.map(() => 1), 0]];
        const sx = solve(Mx, [...J.map(() => 0), 1]);
        if (!sy || !sx) continue;
        const yS = sy.slice(0, k);
        const xS = sx.slice(0, k);
        if (yS.some((p) => p < -eps) || xS.some((p) => p < -eps)) continue;
        const y = Array<number>(n).fill(0);
        const x = Array<number>(m).fill(0);
        J.forEach((j, t) => (y[j] = Math.max(0, yS[t]!)));
        I.forEach((i, t) => (x[i] = Math.max(0, xS[t]!)));
        const rowPay = A.map((r) => r.reduce((a, v, j) => a + v * y[j]!, 0));
        const colPay = A[0]!.map((_, j) => B.reduce((a, r, i) => a + r[j]! * x[i]!, 0));
        const v = Math.max(...rowPay);
        const u = Math.max(...colPay);
        if (I.some((i) => rowPay[i]! < v - 1e-7) || J.some((j) => colPay[j]! < u - 1e-7)) continue;
        if (out.some((e) => e.x.every((p, i) => Math.abs(p - x[i]!) < 1e-7) && e.y.every((p, j) => Math.abs(p - y[j]!) < 1e-7))) continue;
        const pure = x.filter((p) => p > eps).length === 1 && y.filter((p) => p > eps).length === 1;
        out.push({ x, y, u: v, v: u, pure });
      }
  }
  return out;
}

/** Iterated elimination of strictly dominated pure strategies. */
function iesds(A: number[][], B: number[][]): { rows: number[]; cols: number[]; log: string[] } {
  let rows = A.map((_, i) => i);
  let cols = A[0]!.map((_, j) => j);
  const log: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rows) {
      const dom = rows.find((o) => o !== r && cols.every((c) => A[o]![c]! > A[r]![c]!));
      if (dom !== undefined) {
        log.push(`Row ${r + 1} is strictly dominated by row ${dom + 1}`);
        rows = rows.filter((x) => x !== r);
        changed = true;
        break;
      }
    }
    for (const c of cols) {
      const dom = cols.find((o) => o !== c && rows.every((r) => B[r]![o]! > B[r]![c]!));
      if (dom !== undefined) {
        log.push(`Column ${c + 1} is strictly dominated by column ${dom + 1}`);
        cols = cols.filter((x) => x !== c);
        changed = true;
        break;
      }
    }
  }
  return { rows, cols, log };
}

const mix = (p: number[], who: 'Row' | 'Col') =>
  p.filter((x) => x > 1e-9).length === 1 ? `${who} ${p.findIndex((x) => x > 1e-9) + 1}` : `${who} (${p.map((x) => fix(x, 4).replace(/\.?0+$/, '') || '0').join(', ')})`;

export function games(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bnash\b|\bpayoff matri|\bdominant strateg\w*\b|\bdominated strateg\w*\b|\bmixed strateg\w*\b|\bzero[\s-]*sum game\b|\bbest responses?\b|\bnormal[\s-]*form\b|\bprisoner'?s'? dilemma\b|\bgame\b.*\bequilibri/.test(s)) return null;
  if (/\bcournot|bertrand|stackelberg|demand|supply\b/.test(s)) return null;
  const g = parseGame(s);
  if (g === null) return need(q, 'game', 'Type the payoff matrix with [row, column] payoffs per cell, rows separated by ";", e.g. "nash equilibrium [[3,3],[0,5];[5,0],[1,1]]"');
  if (typeof g === 'string') return bad(q, 'game', g);
  const { A, B } = g;
  const m = A.length;
  const n = A[0]!.length;
  if (m < 1 || n < 1 || m > 6 || n > 6) return bad(q, 'game', 'Up to 6×6 games here');
  if (m === 1 && n === 1) return bad(q, 'game', 'A 1×1 game has nothing to choose');
  const eqs = nash(A, B);
  const pure = eqs.filter((e) => e.pure);
  const mixed = eqs.filter((e) => !e.pure);
  const dom = iesds(A, B);
  const notes: string[] = [];
  if (g.zeroSum) notes.push('One number per cell: read as a zero-sum game (column player gets the negative)');
  const rowBest = A[0]!.map((_, j) => Math.max(...A.map((r) => r[j]!)));
  const colBest = B.map((r) => Math.max(...r));
  const table: Table = {
    caption: 'Payoffs (row, column); * marks a best response',
    columns: ['', ...A[0]!.map((_, j) => `Col ${j + 1}`)],
    rows: A.map((r, i) => [`Row ${i + 1}`, ...r.map((a, j) => `${num(a)}${a === rowBest[j] ? '*' : ''}, ${num(B[i]![j]!)}${B[i]![j] === colBest[i] ? '*' : ''}`)]),
  };
  const lines: Lines = [];
  for (const e of pure) {
    const i = e.x.findIndex((p) => p > 0.5);
    const j = e.y.findIndex((p) => p > 0.5);
    lines.push({ label: 'Pure equilibrium', display: `(Row ${i + 1}, Col ${j + 1}) → payoffs (${num(A[i]![j]!)}, ${num(B[i]![j]!)})` });
  }
  for (const e of mixed) lines.push({ label: 'Mixed equilibrium', display: `${mix(e.x, 'Row')}, ${mix(e.y, 'Col')} → expected payoffs (${num(e.u)}, ${num(e.v)})` });
  const rowDominant = A.findIndex((r, i) => A.every((o, k) => k === i || r.every((v, j) => v > o[j]!)));
  const colDominant = A[0]!.findIndex((_, j) => A[0]!.every((__, k) => k === j || B.every((r) => r[j]! > r[k]!)));
  if (rowDominant >= 0) lines.push({ label: 'Row player strictly dominant strategy', display: `Row ${rowDominant + 1}` });
  if (colDominant >= 0) lines.push({ label: 'Column player strictly dominant strategy', display: `Col ${colDominant + 1}` });
  if (dom.log.length) lines.push({ label: 'Iterated elimination', display: `${dom.log.join('; ')} → survives rows ${dom.rows.map((r) => r + 1).join(', ')}, cols ${dom.cols.map((c) => c + 1).join(', ')}` });
  if (pure.length) {
    // Pareto check for the pure equilibria (useful for prisoner's dilemmas).
    for (const e of pure) {
      const i = e.x.findIndex((p) => p > 0.5);
      const j = e.y.findIndex((p) => p > 0.5);
      const better = A.flatMap((r, a) => r.map((_, b) => [a, b] as const)).find(([a, b]) => A[a]![b]! > A[i]![j]! && B[a]![b]! > B[i]![j]!);
      if (better) notes.push(`(Row ${i + 1}, Col ${j + 1}) is Pareto-dominated by (Row ${better[0] + 1}, Col ${better[1] + 1}): a dilemma`);
    }
  }
  if (!eqs.length) notes.push('No equilibrium found by support enumeration: the game is degenerate (ties); equilibria may form a continuum');
  else if (eqs.length % 2 === 0) notes.push('An even number of equilibria suggests a degenerate game (ties); there may be more');
  notes.push('Pure equilibria: each payoff is a best response to the other; mixed: each player is indifferent among the strategies they mix');
  const first = eqs[0];
  const display = !eqs.length
    ? 'No isolated equilibrium found'
    : pure.length && !mixed.length
      ? pure.map((e) => `(R${e.x.findIndex((p) => p > 0.5) + 1}, C${e.y.findIndex((p) => p > 0.5) + 1})`).join(' and ')
      : `${eqs.length} equilibri${eqs.length === 1 ? 'um' : 'a'}: ${eqs.map((e) => (e.pure ? `(R${e.x.findIndex((p) => p > 0.5) + 1}, C${e.y.findIndex((p) => p > 0.5) + 1})` : 'mixed')).join(', ')}`;
  return answer(q, {
    kind: 'game',
    expression: `Nash equilibria of a ${m}×${n} ${g.zeroSum ? 'zero-sum ' : ''}game`,
    display,
    value: first && !first.pure ? first.x[0] : undefined,
    lines,
    table,
    notes,
  });
}

// ---------------------------------------------------------------- auctions

export function auction(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bauctions?\b|\bbidders?\b/.test(s) || !/\bbidders?\b|\brevenue\b|\breserve\b|\buniform\b|\bbid\b/.test(s)) return null;
  const nM = /(\d+)\s*(?:bidders|buyers|players|participants)/.exec(s);
  const n = nM ? Number(nM[1]) : param(s, String.raw`n|bidders|number of bidders`)?.v;
  if (n === undefined) return need(q, 'auction', 'How many bidders? e.g. "3 bidders"');
  if (!(Number.isInteger(n) && n >= 1)) return bad(q, 'auction', 'The number of bidders must be a whole number of at least 1');
  const um = /(?:uniform(?:ly)?(?: distributed)?|values?|valuations?)[a-z ]*?(?:on|between|from|in|over|u)?\s*[[(]?\s*(-?\d+(?:\.\d+)?)\s*(?:,|and|to|-|\s)\s*(-?\d+(?:\.\d+)?)\s*[\])]?/.exec(s);
  if (!/uniform|u\s*\[|u\s*\(/.test(s) && !um) return need(q, 'auction', 'I can do independent private values drawn uniformly, e.g. "values uniform on [0, 100]"');
  const lo = um ? Number(um[1]) : 0;
  const hi = um ? Number(um[2]) : 1;
  if (!um) return need(q, 'auction', 'Over what range are values uniform? e.g. "uniform 0 to 100"');
  if (!(hi > lo)) return bad(q, 'auction', 'The value range must have hi > lo');
  const reserveP = param(s, String.raw`reserve(?: price)?(?: of)?|minimum bid|starting price`);
  const r = Math.max(lo, reserveP?.v ?? lo);
  const F = (v: number) => (v - lo) / (hi - lo);
  const f = 1 / (hi - lo);
  // Myerson: E[revenue] = n ∫ φ(v) F(v)^(n−1) f(v) dv over [r, hi], φ(v) = v − (1 − F)/f.
  const rev = (res: number) => {
    const N = 2000;
    const h = (hi - res) / N;
    let acc = 0;
    for (let i = 0; i <= N; i++) {
      const v = res + i * h;
      const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
      acc += w * (v - (1 - F(v)) / f) * F(v) ** (n - 1) * f;
    }
    return (n * acc * h) / 3;
  };
  const R = rev(r);
  const rStar = Math.max(lo, hi / 2);
  const type = /first[\s-]*price|sealed[\s-]*bid first|dutch/.test(s) ? 'first-price' : /second[\s-]*price|vickrey|english|ascending/.test(s) ? 'second-price' : /all[\s-]*pay/.test(s) ? 'all-pay' : 'any standard';
  const lines: Lines = [
    { label: 'Expected highest value', display: num(lo + ((hi - lo) * n) / (n + 1)) },
    { label: 'Expected second-highest value', display: n >= 2 ? num(lo + ((hi - lo) * (n - 1)) / (n + 1)) : '—' },
    { label: 'Probability of a sale', display: fix(1 - F(r) ** n, 4) },
    { label: 'Optimal reserve (Myerson)', display: `${num(rStar)} → revenue ${num(rev(rStar))}` },
  ];
  const valP = param(s, String.raw`(?:with |for |bidder with |if my )?(?:a )?value(?: of| is)?|valuation(?: of)?|my value`);
  if (valP && valP.v >= lo && valP.v <= hi && type !== 'second-price') {
    const v = valP.v;
    // First-price equilibrium bid with reserve r: b(v) = v − ∫_r^v F(x)^(n−1) dx ÷ F(v)^(n−1).
    const bid = v <= r ? NaN : v - ((F(v) ** n - F(r) ** n) / (n * f)) / F(v) ** (n - 1);
    if (type === 'all-pay') {
      const pay = v * F(v) ** (n - 1) - ((hi - lo) * F(v) ** n) / n;
      lines.unshift({ label: `All-pay equilibrium bid at value ${num(v)}`, display: num(pay) });
    } else lines.unshift({ label: `First-price equilibrium bid at value ${num(v)}`, display: Number.isFinite(bid) ? num(bid) : 'no bid (below reserve)' });
  }
  if (type === 'second-price') lines.unshift({ label: 'Equilibrium strategy', display: 'bid your true value (weakly dominant)' });
  else if (type === 'first-price' && !valP) lines.unshift({ label: 'Equilibrium bid (no reserve)', display: `b(v) = ${lo ? `${num(lo)} + ` : ''}${num((n - 1) / n)}·(v${lo ? ` − ${num(lo)}` : ''})` });
  return answer(q, {
    kind: 'auction',
    expression: `Expected revenue, ${type} auction · ${n} bidder${n === 1 ? '' : 's'}, values uniform on [${num(lo)}, ${num(hi)}]${r > lo ? `, reserve ${num(r)}` : ''}`,
    display: num(R, 4),
    value: R,
    lines,
    notes: ['Revenue equivalence: first-price, second-price, English, Dutch and all-pay auctions earn the same expected revenue with independent private values and the same reserve', r === lo ? `Without a reserve: E[revenue] = E[second-highest value] = lo + (hi − lo)(n − 1)/(n + 1)` : 'E[revenue] = n∫ φ(v)F(v)^(n−1)f(v)dv above the reserve, φ(v) = v − (1 − F(v))/f(v)'],
  });
}
