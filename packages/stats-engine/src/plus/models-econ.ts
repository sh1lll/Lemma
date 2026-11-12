/** Econometrics on typed data: panel fixed/random effects, Hausman, IV/2SLS, difference-in-differences, RDD, Kalman. */
import type { AnswerResult } from '@lemma/math-core';
import { checkLengths, coefTable, dataColumns, g6, g7, modelSpec, namedLists, NUMS, ols, type OLS } from './models-core';
import { alphaOf, answer, bad, chiSf, inv, mean, needErr, nums, testAnswer, tSf, zSf, type Column, type Line, type PCtx, type PHandler } from './util';

// ---------- panels ----------
const ID = /^(?:id|ids|entity|firm|firms|unit|units|country|countries|state|states|individual|person|group|i|company|school|region|county|city|panel|subject)$/;
const TIME = /^(?:time|year|years|t|period|quarter|month|wave|date|week)$/;

interface Panel {
  ids: number[];
  y: Column;
  xs: Column[];
  T: number;
  N: number;
  balanced: boolean;
}

function panelOf(c: PCtx): Panel | AnswerResult {
  const cols = dataColumns(c);
  const idCol = cols.find((k) => ID.test(k.name));
  if (!idCol) return needErr(c, 'Paste the panel as a long table with an entity column (id, firm, country …), e.g. "id,year,y,x" with one row per entity and period');
  const timeCol = cols.find((k) => TIME.test(k.name));
  const rest = cols.filter((k) => k !== idCol && k !== timeCol);
  if (rest.length < 2) return needErr(c, 'The panel needs an outcome and at least one regressor column');
  const spec = modelSpec(c.raw.split('\n')[0]! + ' ' + c.s, rest.map((k) => k.name));
  const by = (n: string) => rest.find((k) => k.name === n)!;
  const y = spec ? by(spec.y) : (rest.find((k) => k.name === 'y') ?? rest[0]!);
  const xs = spec ? spec.xs.map(by) : rest.filter((k) => k !== y);
  const ids = idCol.xs;
  const counts = new Map<number, number>();
  for (const i of ids) counts.set(i, (counts.get(i) ?? 0) + 1);
  const T = Math.max(...counts.values());
  const balanced = [...counts.values()].every((v) => v === T);
  return { ids, y, xs, T, N: counts.size, balanced };
}

function groupMeans(v: number[], ids: number[]): Map<number, number> {
  const s = new Map<number, [number, number]>();
  ids.forEach((g, i) => {
    const cur = s.get(g) ?? [0, 0];
    s.set(g, [cur[0] + v[i]!, cur[1] + 1]);
  });
  return new Map([...s].map(([g, [a, n]]) => [g, a / n]));
}

interface FE {
  b: number[];
  V: number[][];
  s2e: number;
  o: OLS;
  df: number;
}

function withinFit(pn: Panel): FE {
  const n = pn.y.xs.length;
  const K = pn.xs.length;
  const df = n - pn.N - K;
  if (df <= 0) bad(`Fixed effects need more observations than entities + regressors (${n} rows, ${pn.N} entities, ${K} regressors)`);
  const dm = (v: number[]) => {
    const m = groupMeans(v, pn.ids);
    return v.map((x, i) => x - m.get(pn.ids[i]!)!);
  };
  const yd = dm(pn.y.xs);
  const xd = pn.xs.map((x) => dm(x.xs));
  if (xd.some((col) => col.every((v) => Math.abs(v) < 1e-12)))
    bad('A regressor does not vary within entities, so fixed effects absorb it (its coefficient is not identified)');
  const o = ols(yd.map((_v, i) => xd.map((col) => col[i]!)), yd, pn.xs.map((x) => x.name), false);
  const s2e = o.sse / df;
  const V = o.XtXi.map((r) => r.map((v) => v * s2e));
  return { b: o.b, V, s2e, o, df };
}

interface RE {
  b: number[];
  se: number[];
  theta: number;
  s2u: number;
  s2e: number;
  o: OLS;
  XtXi: number[][];
}

function swamyArora(pn: Panel, fe: FE): RE {
  if (!pn.balanced) bad('Random effects here use the Swamy–Arora formulas for a balanced panel (every entity observed the same number of times)');
  const K = pn.xs.length;
  if (pn.N <= K + 1) bad(`Random effects need more entities than regressors + 1 (${pn.N} entities)`);
  const keys = [...new Set(pn.ids)];
  const ym = groupMeans(pn.y.xs, pn.ids);
  const xm = pn.xs.map((x) => groupMeans(x.xs, pn.ids));
  const between = ols(keys.map((k) => [1, ...xm.map((m) => m.get(k)!)]), keys.map((k) => ym.get(k)!), ['(Intercept)', ...pn.xs.map((x) => x.name)]);
  const s2b = between.sse / (pn.N - K - 1);
  const s2u = Math.max(0, s2b - fe.s2e / pn.T);
  const theta = 1 - Math.sqrt(fe.s2e / (pn.T * s2u + fe.s2e));
  const X = pn.y.xs.map((_v, i) => [1 - theta, ...pn.xs.map((x, j) => x.xs[i]! - theta * xm[j]!.get(pn.ids[i]!)!)]);
  const yq = pn.y.xs.map((v, i) => v - theta * ym.get(pn.ids[i]!)!);
  const o = ols(X, yq, ['(Intercept)', ...pn.xs.map((x) => x.name)], false);
  return { b: o.b, se: o.se, theta, s2u, s2e: fe.s2e, o, XtXi: o.XtXi };
}

export const panelHandler: PHandler = (c) => {
  const fe = /\bfixed[- ]effects?\b|\bwithin estimator\b|\bwithin regression\b/.test(c.s);
  const re = /\brandom[- ]effects?\b/.test(c.s);
  const haus = /\bhausman\b/.test(c.s);
  const panelWord = /\bpanel (?:data|regression|model)\b|\bpanel\b.*\bregress/.test(c.s);
  if (!fe && !re && !haus && !panelWord) return null;
  // "fixed/random effect(s) meta-analysis" pools study effects: the tests area answers it.
  if (/\bmeta[- ]?analy|\bpooled effect\b|\bstudies\b/.test(c.s)) return null;
  if (!c.raw.includes('\n') && !namedLists(c.s).some((k) => ID.test(k.name))) return needErr(c, 'Paste the panel as a long table: a header such as "id,year,y,x" and one row per entity and period');
  const pn = panelOf(c);
  if ('ok' in pn) return pn;
  checkLengths([pn.y, ...pn.xs]);
  const F = withinFit(pn);
  const notes: string[] = [`${pn.N} entities, ${pn.T} periods${pn.balanced ? '' : ' (unbalanced)'}`];
  if (haus) {
    const R = swamyArora(pn, F);
    const K = pn.xs.length;
    const d = F.b.map((v, j) => v - R.b[j + 1]!);
    // Both covariance matrices with the within σ²ₑ, so V_FE − V_RE is positive semi-definite in theory.
    const VR = Array.from({ length: K }, (_v, a) => Array.from({ length: K }, (_w, b) => F.s2e * R.XtXi[a + 1]![b + 1]!));
    const D = F.V.map((r, a) => r.map((v, b) => v - VR[a]![b]!));
    const Di = inv(D);
    if (!Di) bad('V_FE − V_RE is singular, so the Hausman statistic is not defined for these data');
    const H = d.reduce((s, da, a) => s + da * d.reduce((t, db, b) => t + Di[a]![b]! * db, 0), 0);
    if (!(H >= 0)) bad('V_FE − V_RE is not positive definite for these data, so the Hausman statistic is negative and not interpretable; prefer a robust (Mundlak) test');
    return testAnswer(c, {
      test: `Hausman test: fixed vs random effects · ${pn.y.name} on ${pn.xs.map((x) => x.name).join(', ')}`,
      statName: 'H',
      stat: H,
      df: K,
      p: chiSf(H, K),
      alpha: alphaOf(c),
      h0: 'random effects are consistent (effects uncorrelated with regressors)',
      h1: 'only fixed effects are consistent',
      reject: 'The FE and RE estimates differ systematically: use fixed effects.',
      retain: 'No systematic difference: random effects are consistent and more efficient.',
      lines: pn.xs.flatMap((x, j) => [{ label: `FE ${x.name}`, display: g7(F.b[j]!) }, { label: `RE ${x.name}`, display: g7(R.b[j + 1]!) }]),
      notes: [...notes, 'H = d′(V_FE − V_RE)⁻¹d with d = b_FE − b_RE; both variances use the within-estimator σ²ₑ'],
      assumptions: ['strictly exogenous regressors', 'homoscedastic, serially uncorrelated idiosyncratic errors'],
    });
  }
  if (re) {
    const R = swamyArora(pn, F);
    const lines: Line[] = [
      { label: 'θ', display: g7(R.theta) },
      { label: 'σ²_u', display: g7(R.s2u) },
      { label: 'σ²_e', display: g7(R.s2e) },
      { label: 'Observations', display: String(pn.y.xs.length) },
      { label: 'Entities', display: String(pn.N) },
    ];
    if (R.s2u === 0) notes.push('Estimated σ²_u is 0, so θ = 0 and random effects reduce to pooled OLS');
    return answer(c, {
      expression: `Random effects (Swamy–Arora GLS) · ${pn.y.name} on ${pn.xs.map((x) => x.name).join(', ')}`,
      value: R.b[1]!,
      display: `${pn.xs[0]!.name}: ${g6(R.b[1]!)}`,
      lines,
      table: coefTable(R.o),
      notes: [...notes, 'Quasi-demeaned OLS with θ = 1 − √(σ²ₑ/(Tσ²ᵤ + σ²ₑ)); σ²ₑ from the within regression, σ²ᵤ from the between regression', 'Assumes: entity effects uncorrelated with the regressors (check with a Hausman test)'],
    });
  }
  const o = F.o;
  const yd = o.y;
  const sstW = yd.reduce((s, v) => s + v * v, 0);
  const se = F.V.map((r, j) => Math.sqrt(r[j]!));
  const rows = pn.xs.map((x, j) => {
    const t = F.b[j]! / se[j]!;
    return [x.name, g7(F.b[j]!), g7(se[j]!), g6(t), g6(Number.isFinite(t) ? Math.min(1, 2 * tSf(Math.abs(t), F.df)) : 0)];
  });
  return answer(c, {
    expression: `Fixed effects (within estimator) · ${pn.y.name} on ${pn.xs.map((x) => x.name).join(', ')}`,
    value: F.b[0]!,
    display: `${pn.xs[0]!.name}: ${g6(F.b[0]!)}`,
    lines: [
      { label: 'Within R²', display: g7(sstW > 0 ? 1 - o.sse / sstW : 1) },
      { label: 'Entities', display: String(pn.N) },
      { label: 'Observations', display: String(pn.y.xs.length) },
      { label: 'Residual df', display: String(F.df) },
    ],
    table: { columns: ['Term', 'Estimate', 'Std. error', 't', 'p-value'], rows },
    notes: [...notes, 'Entity-demeaned OLS; σ² = SSR/(NT − N − K)', 'Assumes: strictly exogenous regressors; errors homoscedastic and serially uncorrelated (cluster-robust SEs not computed)', ...(panelWord && !fe ? ['“Panel regression” read as fixed effects; say “random effects” or “hausman test” for the alternatives'] : [])],
  });
};

// ---------- IV / 2SLS ----------
export const ivHandler: PHandler = (c) => {
  if (!/\b2sls\b|\btsls\b|\btwo[- ]stage least squares\b|\binstrumental variables?\b|\biv (?:regression|estimate|estimator)\b|\binstrument(?:s|ed)?\b/.test(c.s)) return null;
  const cols = dataColumns(c);
  if (cols.length < 3) return needErr(c, 'Give the outcome, the endogenous regressor and the instrument, e.g. "2sls y: … x: … z: …" (other columns are treated as exogenous controls)');
  checkLengths(cols);
  const using = /\b([a-z][a-z0-9_]*)\s+on\s+([a-z0-9_ ,&]+?)\s+(?:using|with instruments?|instrumented by|instruments?)\s+([a-z0-9_ ,&]+)/.exec(c.raw.split('\n')[0]! + ' ' + c.s);
  const names = cols.map((k) => k.name);
  const by = (n: string) => cols.find((k) => k.name === n);
  let y: Column | undefined;
  let endo: Column[];
  let insts: Column[];
  if (using && by(using[1]!)) {
    y = by(using[1]!);
    insts = using[3]!.split(/[\s,&]+/).map((n) => by(n)).filter((k): k is Column => !!k);
    endo = using[2]!.split(/[\s,&]+/).map((n) => by(n)).filter((k): k is Column => !!k && !insts.includes(k));
  } else {
    y = by('y') ?? cols[0];
    insts = cols.filter((k) => /^(?:z\d*|instruments?\d*|iv\d*)$/.test(k.name));
    endo = cols.filter((k) => /^(?:x\d*|d|endog\w*|treat\w*)$/.test(k.name) && k !== y);
  }
  if (!y) return needErr(c, 'Which column is the outcome? Name it y');
  if (!endo.length) return needErr(c, `Which regressor is endogenous? Name it x, or write "y on x using z" (columns: ${names.join(', ')})`);
  if (!insts.length) return needErr(c, 'Which variable is the instrument? Name it z, or write "y on x using z"');
  if (insts.length < endo.length) bad(`Under-identified: ${endo.length} endogenous regressor${endo.length > 1 ? 's' : ''} but only ${insts.length} instrument${insts.length > 1 ? 's' : ''}`);
  const ctrls = cols.filter((k) => k !== y && !endo.includes(k) && !insts.includes(k));
  const n = y.xs.length;
  const Z = y.xs.map((_v, i) => [1, ...insts.map((k) => k.xs[i]!), ...ctrls.map((k) => k.xs[i]!)]);
  const first = endo.map((x) => ols(Z, x.xs, Z[0]!.map((_v, j) => String(j))));
  const firstR = endo.map((x) => ols(y.xs.map((_v, i) => [1, ...ctrls.map((k) => k.xs[i]!)]), x.xs, ['c', ...ctrls.map((k) => k.name)]));
  const L = insts.length;
  const dfF = n - Z[0]!.length;
  const Ffs = first.map((o, j) => ((firstR[j]!.sse - o.sse) / L) / (o.sse / dfF));
  const names2 = ['(Intercept)', ...endo.map((k) => k.name), ...ctrls.map((k) => k.name)];
  const Xhat = y.xs.map((_v, i) => [1, ...first.map((o) => o.fit[i]!), ...ctrls.map((k) => k.xs[i]!)]);
  const Xact = y.xs.map((_v, i) => [1, ...endo.map((k) => k.xs[i]!), ...ctrls.map((k) => k.xs[i]!)]);
  const second = ols(Xhat, y.xs, names2);
  const kk = names2.length;
  if (n <= kk) bad(`${kk} coefficients need more than ${kk} observations`);
  const e = y.xs.map((v, i) => v - Xact[i]!.reduce((s, x, j) => s + x * second.b[j]!, 0));
  const s2 = e.reduce((s, v) => s + v * v, 0) / (n - kk);
  const se = second.XtXi.map((r, j) => Math.sqrt(s2 * r[j]!));
  const rows = names2.map((nm, j) => {
    const t = second.b[j]! / se[j]!;
    return [nm, g7(second.b[j]!), g7(se[j]!), g6(t), g6(Math.min(1, 2 * tSf(Math.abs(t), n - kk)))];
  });
  const olsFit = ols(Xact, y.xs, names2);
  const lines: Line[] = [
    ...endo.map((k, j) => ({ label: endo.length > 1 ? `First-stage F ${k.name}` : 'First-stage F', display: g7(Ffs[j]!) })),
    ...endo.map((k, j) => ({ label: `OLS estimate ${k.name}`, display: g7(olsFit.b[j + 1]!) })),
    { label: 'Observations', display: String(n) },
  ];
  const notes = [
    `Two-stage least squares: ${endo.map((k) => k.name).join(', ')} instrumented by ${insts.map((k) => k.name).join(', ')}${ctrls.length ? `; exogenous controls ${ctrls.map((k) => k.name).join(', ')}` : ''}`,
    'Standard errors from the structural residuals (actual regressors), homoscedastic errors assumed',
    'Assumes: instruments relevant (first stage) and excludable (affect y only through the endogenous regressor)',
  ];
  if (Ffs.some((v) => v < 10)) notes.push(`Weak-instrument warning: first-stage F = ${g6(Math.min(...Ffs))} < 10 (Staiger–Stock rule of thumb); 2SLS may be badly biased`);
  return answer(c, {
    expression: `Instrumental variables (2SLS) · ${y.name} on ${endo.map((k) => k.name).join(', ')}${ctrls.length ? ` + ${ctrls.map((k) => k.name).join(', ')}` : ''} · n = ${n}`,
    value: second.b[1]!,
    display: `${endo[0]!.name}: ${g6(second.b[1]!)}`,
    lines,
    table: { columns: ['Term', 'Estimate', 'Std. error', 't', 'p-value'], rows },
    notes,
  });
};

// ---------- difference-in-differences ----------
const DID = /\bdiff(?:erence)?[- ]in[- ]diff\w*\b|\bdid\b(?=.*\b(?:treat|control))|\bdiff-in-diff\b/;

function groupPrePost(s: string, words: string): [number, number] | null {
  const re = new RegExp(`\\b(?:${words})\\b[^0-9-]*?(?:group\\s*)?(?:before|pre(?:-treatment|-period)?|baseline)\\s*(?:=|:|is|of)?\\s*(${NUMS})[^0-9-]*?(?:after|post(?:-treatment|-period)?|follow-?up)\\s*(?:=|:|is|of)?\\s*(${NUMS})`);
  const m = re.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const didHandler: PHandler = (c) => {
  if (!DID.test(c.s)) return null;
  if (c.raw.includes('\n')) {
    const cols = dataColumns(c);
    const tr = cols.find((k) => /^(?:treat\w*|group|d)$/.test(k.name));
    const po = cols.find((k) => /^(?:post\w*|after|period|time)$/.test(k.name));
    if (tr && po) {
      const others = cols.filter((k) => k !== tr && k !== po);
      const y = others.find((k) => k.name === 'y') ?? others[0];
      if (!y) return needErr(c, 'Which column is the outcome?');
      checkLengths([y, tr, po]);
      if (![...tr.xs, ...po.xs].every((v) => v === 0 || v === 1)) bad('The treated and post columns must be 0/1 indicators');
      const X = y.xs.map((_v, i) => [1, tr.xs[i]!, po.xs[i]!, tr.xs[i]! * po.xs[i]!]);
      const o = ols(X, y.xs, ['(Intercept)', tr.name, po.name, `${tr.name} × ${po.name}`]);
      return answer(c, {
        expression: `Difference-in-differences regression · ${y.name} on ${tr.name}, ${po.name}, ${tr.name} × ${po.name} · n = ${y.xs.length}`,
        value: o.b[3]!,
        display: `DiD = ${g6(o.b[3]!)}`,
        lines: [{ label: 'DiD estimate', display: g7(o.b[3]!) }, { label: 'Standard error', display: g7(o.se[3]!) }, { label: 'p-value', display: g6(o.p[3]!) }, { label: 'R²', display: g7(o.r2) }],
        table: coefTable(o),
        notes: ['The interaction coefficient equals (treated after − before) − (control after − before) in cell means', 'Assumes: parallel trends without treatment; OLS standard errors (no clustering)'],
      });
    }
  }
  const t = groupPrePost(c.s, 'treated|treatment|treat|intervention|exposed');
  const k = groupPrePost(c.s, 'control|comparison|untreated|unexposed');
  if (!t) return needErr(c, 'Give the treated group’s before and after means, e.g. "treated before 10 after 15 control before 8 after 9"');
  if (!k) return needErr(c, 'Give the control group’s before and after means too, e.g. "… control before 8 after 9"');
  const dt = t[1] - t[0];
  const dc = k[1] - k[0];
  const did = dt - dc;
  return answer(c, {
    expression: `Difference-in-differences · treated ${g6(t[0])} → ${g6(t[1])}, control ${g6(k[0])} → ${g6(k[1])}`,
    value: did,
    display: `DiD = ${g6(did)}`,
    lines: [
      { label: 'Treated change', display: g7(dt) },
      { label: 'Control change', display: g7(dc) },
      { label: 'DiD estimate', display: g7(did) },
      { label: 'Counterfactual treated after', display: g7(t[0] + dc) },
    ],
    notes: ['DiD = (treated after − treated before) − (control after − control before)', 'Assumes: parallel trends (without treatment both groups would have changed by the same amount); no standard error without group-level data'],
  });
};

// ---------- regression discontinuity ----------
export const rddHandler: PHandler = (c) => {
  if (!/\bregression discontinuity\b|\brdd?\b|\bsharp rd\b/.test(c.s)) return null;
  const cut = /\b(?:cutoff|cut-off|threshold|cut point)\s*(?:=|:|at|of|is)?\s*(-?\d*\.?\d+)/.exec(c.s);
  const bw = /\b(?:bandwidth|window|h)\s*(?:=|:|of|is)?\s*(\d*\.?\d+)/.exec(c.s);
  const cols = namedLists(c.s);
  const xcol = cols.find((k) => /^(?:x|running|score|forcing)$/.test(k.name)) ?? cols[0];
  const ycol = cols.find((k) => k.name === 'y') ?? cols.find((k) => k !== xcol);
  if (!xcol || !ycol) return needErr(c, 'Give the running variable and outcome, e.g. "regression discontinuity cutoff 0 bandwidth 5 x: … y: …"');
  if (!cut) return needErr(c, 'Where is the cutoff? e.g. "cutoff 50"');
  if (xcol.xs.length !== ycol.xs.length) bad(`There are ${xcol.xs.length} running-variable values but ${ycol.xs.length} outcomes`);
  const c0 = Number(cut[1]);
  const h = bw ? Number(bw[1]) : Infinity;
  if (!(h > 0)) bad('The bandwidth must be positive');
  const left = xcol.xs.map((x, i) => [x, ycol.xs[i]!] as const).filter(([x]) => x < c0 && x >= c0 - h);
  const right = xcol.xs.map((x, i) => [x, ycol.xs[i]!] as const).filter(([x]) => x >= c0 && x <= c0 + h);
  if (left.length < 3 || right.length < 3) bad(`Each side of the cutoff needs at least 3 points within the bandwidth (left ${left.length}, right ${right.length})`);
  const fit = (pts: readonly (readonly [number, number])[]) => ols(pts.map(([x]) => [1, x - c0]), pts.map(([, y]) => y), ['(Intercept)', 'slope']);
  const L = fit(left);
  const R = fit(right);
  const jump = R.b[0]! - L.b[0]!;
  const seL = Number.isFinite(L.se[0]!) ? L.se[0]! : 0;
  const seR = Number.isFinite(R.se[0]!) ? R.se[0]! : 0;
  const se = Math.sqrt(seL ** 2 + seR ** 2);
  const z = se > 0 ? jump / se : Infinity;
  return answer(c, {
    expression: `Sharp regression discontinuity at ${g6(c0)} · local linear, ${bw ? `bandwidth ${g6(h)}` : 'all data'} · ${left.length} left, ${right.length} right`,
    value: jump,
    display: `jump = ${g6(jump)}`,
    lines: [
      { label: 'Jump at cutoff', display: g7(jump) },
      { label: 'Left intercept', display: g7(L.b[0]!) },
      { label: 'Right intercept', display: g7(R.b[0]!) },
      { label: 'Left slope', display: g7(L.b[1]!) },
      { label: 'Right slope', display: g7(R.b[1]!) },
      { label: 'Standard error', display: se > 0 ? g7(se) : '0 (exact fit)' },
      { label: 'p-value (normal)', display: se > 0 ? g6(2 * zSf(Math.abs(z))) : '—' },
      { label: 'Points left', display: String(left.length) },
      { label: 'Points right', display: String(right.length) },
    ],
    notes: [
      'Separate straight lines on each side (uniform kernel); the effect is the gap between them at the cutoff',
      'Assumes: no manipulation of the running variable and no other change at the cutoff; results depend on the bandwidth',
      ...(bw ? [] : ['No bandwidth given: all points used (say “bandwidth 5” to localise)']),
    ],
  });
};

// ---------- Kalman filter (local level) ----------
export const kalmanHandler: PHandler = (c) => {
  if (!/\bkalman\b/.test(c.s)) return null;
  const num = (re: RegExp) => {
    const m = re.exec(c.rest);
    if (!m) return null;
    c.rest = c.rest.slice(0, m.index) + ' '.repeat(m[0].length) + c.rest.slice(m.index + m[0].length);
    return Number(m[1]);
  };
  const q = num(new RegExp(`\\b(?:q|state (?:noise )?variance|process (?:noise )?variance|level variance)\\s*(?:=|:|of)?\\s*(${NUMS})`));
  const r = num(new RegExp(`\\b(?:r|observation (?:noise )?variance|measurement (?:noise )?variance|noise variance)\\s*(?:=|:|of)?\\s*(${NUMS})`));
  if (q === null || r === null) return needErr(c, 'Give the state and observation noise variances, e.g. "kalman filter local level q 0.5 r 1 data 4.4 4.0 3.5 …"');
  if (!(q >= 0 && r > 0)) bad('Variances must be positive (q may be 0)');
  const ys = nums(c.rest.replace(/\blocal level\b|\bkalman(?: filter)?\b|\bdata\b/g, ' '));
  if (ys.length < 2) return needErr(c, 'Give the observations, e.g. "… data 4.4 4.0 3.5 4.6"');
  let a = 0;
  let P = 1e7;
  let K = 0;
  const rows: string[][] = [];
  ys.forEach((y, t) => {
    P += q;
    K = P / (P + r);
    a += K * (y - a);
    P *= 1 - K;
    rows.push([String(t + 1), g7(y), g7(a), g7(P), g6(K)]);
  });
  return answer(c, {
    expression: `Kalman filter, local level model (q = ${g6(q)}, r = ${g6(r)}) · ${ys.length} observations`,
    value: a,
    display: `level ≈ ${g6(a)}`,
    lines: [
      { label: 'Filtered level', display: g7(a) },
      { label: 'Filtered variance', display: g7(P) },
      { label: 'Kalman gain', display: g7(K) },
      { label: 'Forecast', display: g7(a) },
      { label: 'Forecast variance', display: g7(P + q + r) },
    ],
    table: { columns: ['t', 'y', 'Filtered level', 'Variance', 'Gain'], rows },
    notes: ['Model: yₜ = μₜ + εₜ (variance r), μₜ = μₜ₋₁ + ηₜ (variance q); diffuse start (P₀ = 10⁷)'],
  });
};

export { mean };
