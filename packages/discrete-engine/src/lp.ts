// Linear programming: a dense two-phase simplex (Bland's rule), with duals, plus branch and bound for integers.

export type Op = '<=' | '>=' | '=';
export interface LP {
  c: number[];
  A: number[][];
  b: number[];
  ops: Op[];
  maximize: boolean;
}
export interface LPResult {
  status: 'optimal' | 'infeasible' | 'unbounded';
  x: number[];
  value: number;
  /** d(optimal value)/d(bᵢ) for each original constraint. */
  duals: number[];
  pivots: { phase: number; enter: string; leave: string; obj: number }[];
}

const EPS = 1e-9;

export function simplex(lp: LP, names?: string[]): LPResult {
  const n = lp.c.length;
  const m = lp.A.length;
  const flip = lp.b.map((b) => (b < 0 ? -1 : 1));
  const ops = lp.ops.map((o, i) => (flip[i]! < 0 ? (o === '<=' ? '>=' : o === '>=' ? '<=' : '=') : o));
  const A = lp.A.map((r, i) => r.map((x) => x * flip[i]!));
  const b = lp.b.map((x, i) => x * flip[i]!);
  // Columns: originals, then slack/surplus, then artificials.
  const colNames = [...(names ?? lp.c.map((_, j) => `x${j + 1}`))];
  const slackCol: number[] = [];
  const unitCol: number[] = [];
  let N = n;
  for (let i = 0; i < m; i++) {
    if (ops[i] !== '=') {
      slackCol[i] = N++;
      colNames.push(ops[i] === '<=' ? `s${i + 1}` : `e${i + 1}`);
    } else slackCol[i] = -1;
  }
  const artStart = N;
  const artCol: number[] = [];
  for (let i = 0; i < m; i++) {
    if (ops[i] !== '<=') {
      artCol[i] = N++;
      colNames.push(`a${i + 1}`);
    } else artCol[i] = -1;
  }
  const T: number[][] = [];
  const basis: number[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(N + 1).fill(0) as number[];
    A[i]!.forEach((x, j) => (row[j] = x));
    if (slackCol[i]! >= 0) row[slackCol[i]!] = ops[i] === '<=' ? 1 : -1;
    if (artCol[i]! >= 0) row[artCol[i]!] = 1;
    row[N] = b[i]!;
    T.push(row);
    basis.push(ops[i] === '<=' ? slackCol[i]! : artCol[i]!);
    unitCol.push(ops[i] === '<=' ? slackCol[i]! : artCol[i]!);
  }
  const pivots: LPResult['pivots'] = [];
  const pivot = (r: number, c: number) => {
    const p = T[r]![c]!;
    T[r] = T[r]!.map((x) => x / p);
    for (let i = 0; i < T.length; i++) {
      if (i === r) continue;
      const f = T[i]![c]!;
      if (Math.abs(f) > 0) T[i] = T[i]!.map((x, j) => x - f * T[r]![j]!);
    }
    basis[r] = c;
  };
  const run = (cost: number[], phase: number, allowed: (j: number) => boolean): 'optimal' | 'unbounded' => {
    for (let guard = 0; guard < 5000; guard++) {
      let enter = -1;
      for (let j = 0; j < N; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        const r = cost[j]! - basis.reduce((s, bj, i) => s + cost[bj]! * T[i]![j]!, 0);
        if (r < -EPS) {
          enter = j;
          break;
        }
      }
      if (enter < 0) return 'optimal';
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < T.length; i++) {
        const a = T[i]![enter]!;
        if (a > EPS) {
          const ratio = T[i]![N]! / a;
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i]! < basis[leave]!)) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave < 0) return 'unbounded';
      const out = colNames[basis[leave]!]!;
      pivot(leave, enter);
      const obj = basis.reduce((s, bj, i) => s + cost[bj]! * T[i]![N]!, 0);
      pivots.push({ phase, enter: colNames[enter]!, leave: out, obj });
    }
    return 'optimal';
  };
  if (artStart < N) {
    const c1 = new Array(N).fill(0).map((_, j) => (j >= artStart ? 1 : 0));
    run(c1, 1, () => true);
    const infeas = basis.reduce((s, bj, i) => s + (bj >= artStart ? T[i]![N]! : 0), 0);
    if (infeas > 1e-7) return { status: 'infeasible', x: [], value: NaN, duals: [], pivots };
    // Drive zero-level artificials out of the basis.
    for (let i = 0; i < T.length; i++) {
      if (basis[i]! < artStart) continue;
      const j = T[i]!.findIndex((x, k) => k < artStart && Math.abs(x) > EPS);
      if (j >= 0) pivot(i, j);
    }
  }
  const cMin = new Array(N).fill(0) as number[];
  lp.c.forEach((x, j) => (cMin[j] = lp.maximize ? -x : x));
  const status = run(cMin, 2, (j) => j < artStart);
  if (status === 'unbounded') return { status, x: [], value: lp.maximize ? Infinity : -Infinity, duals: [], pivots };
  const x = new Array(n).fill(0) as number[];
  basis.forEach((bj, i) => {
    if (bj < n) x[bj] = T[i]![N]!;
  });
  const value = lp.c.reduce((s, c, j) => s + c * x[j]!, 0);
  const duals = unitCol.map((uc, i) => {
    const y = basis.reduce((s, bj, k) => s + cMin[bj]! * T[k]![uc]!, 0);
    return y * flip[i]! * (lp.maximize ? -1 : 1);
  });
  return { status: 'optimal', x: x.map(clean), value: clean(value), duals: duals.map(clean), pivots };
}

export const clean = (v: number) => {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9) return r === 0 ? 0 : r;
  return Math.abs(v) < 1e-12 ? 0 : v;
};

export interface BBNode {
  id: number;
  bounds: string;
  status: string;
  value: number;
}

/** Branch and bound for pure/mixed integer programs (depth-first, best bound pruning). */
export function branchAndBound(lp: LP, integer: boolean[], names: string[], maxNodes = 2000) {
  let best: LPResult | null = null;
  const log: BBNode[] = [];
  let id = 0;
  const rec = (extraA: number[][], extraB: number[], extraOps: Op[], label: string) => {
    if (id >= maxNodes) return;
    const nodeId = ++id;
    const r = simplex({ ...lp, A: [...lp.A, ...extraA], b: [...lp.b, ...extraB], ops: [...lp.ops, ...extraOps] }, names);
    if (r.status !== 'optimal') {
      log.push({ id: nodeId, bounds: label, status: r.status === 'infeasible' ? 'infeasible' : 'unbounded relaxation', value: NaN });
      return;
    }
    if (best && (lp.maximize ? r.value <= best.value + 1e-9 : r.value >= best.value - 1e-9)) {
      log.push({ id: nodeId, bounds: label, status: 'pruned (bound)', value: r.value });
      return;
    }
    const j = r.x.findIndex((v, k) => integer[k] && Math.abs(v - Math.round(v)) > 1e-7);
    if (j < 0) {
      best = r;
      log.push({ id: nodeId, bounds: label, status: 'integer: new incumbent', value: r.value });
      return;
    }
    log.push({ id: nodeId, bounds: label, status: `branch on ${names[j]} = ${+r.x[j]!.toFixed(4)}`, value: r.value });
    const row = lp.c.map((_, k) => (k === j ? 1 : 0));
    const fl = Math.floor(r.x[j]!);
    rec([...extraA, row], [...extraB, fl], [...extraOps, '<='], `${label ? label + ', ' : ''}${names[j]} ≤ ${fl}`);
    rec([...extraA, row], [...extraB, fl + 1], [...extraOps, '>='], `${label ? label + ', ' : ''}${names[j]} ≥ ${fl + 1}`);
  };
  rec([], [], [], '');
  return { best: best as LPResult | null, log, truncated: id >= maxNodes };
}
