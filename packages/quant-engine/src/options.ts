import type { AnswerResult } from '@lemma/math-core';
import { answer, bad, bisect, fix, gaussian, list, money, N, need, NUM, num, param, pct, pdf, rateOf, rng, years, type Lines, type Q, type Table } from './util';

/**
 * Options and forwards: Black–Scholes–Merton and Black-76 with Greeks, implied volatility, put–call parity,
 * binomial (CRR) and trinomial trees for European and American exercise, Monte Carlo Asian and barrier options with
 * a seed, digital options, and forward/futures prices with carry and dividends. Conventions follow Hull, "Options,
 * Futures, and Other Derivatives": continuous compounding, T in years, theta per calendar day = per-year ÷ 365.
 */

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  /** Per 1.00 change in volatility. */
  vega: number;
  /** Per year. */
  theta: number;
  /** Per 1.00 change in r. */
  rho: number;
  d1: number;
  d2: number;
}

export function bsm(type: 'call' | 'put', S: number, K: number, T: number, r: number, v: number, q = 0): Greeks {
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * T) / (v * sq);
  const d2 = d1 - v * sq;
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const gamma = (dq * pdf(d1)) / (S * v * sq);
  const vega = S * dq * pdf(d1) * sq;
  const common = (-S * dq * pdf(d1) * v) / (2 * sq);
  if (type === 'call') {
    return {
      price: S * dq * N(d1) - K * dr * N(d2),
      delta: dq * N(d1),
      gamma,
      vega,
      theta: common - r * K * dr * N(d2) + q * S * dq * N(d1),
      rho: K * T * dr * N(d2),
      d1,
      d2,
    };
  }
  return {
    price: K * dr * N(-d2) - S * dq * N(-d1),
    delta: dq * (N(d1) - 1),
    gamma,
    vega,
    theta: common + r * K * dr * N(-d2) - q * S * dq * N(-d1),
    rho: -K * T * dr * N(-d2),
    d1,
    d2,
  };
}

/** Black (1976) on a forward/futures price F: BSM with q = r, except rho = −T × price. */
export function black76(type: 'call' | 'put', F: number, K: number, T: number, r: number, v: number): Greeks {
  const g = bsm(type, F, K, T, r, v, r);
  return { ...g, rho: -T * g.price };
}

export function impliedVol(type: 'call' | 'put', price: number, S: number, K: number, T: number, r: number, q = 0): number | null {
  return bisect((v) => bsm(type, S, K, T, r, v, q).price - price, 1e-6, 10, 1e-10);
}

export interface TreeResult {
  price: number;
  delta: number;
  /** Node values per step (for display): [step][node] = { s, v, early }. */
  nodes: { s: number; v: number; early: boolean }[][];
  u: number;
  d: number;
  p: number;
}

export function binomial(type: 'call' | 'put', american: boolean, S: number, K: number, T: number, r: number, v: number, n: number, q = 0, ud?: { u: number; d: number }): TreeResult | string {
  const dt = T / n;
  const u = ud?.u ?? Math.exp(v * Math.sqrt(dt));
  const d = ud?.d ?? 1 / u;
  const g = Math.exp((r - q) * dt);
  const p = (g - d) / (u - d);
  if (!(p > 0 && p < 1)) return `The risk-neutral probability is ${num(p)}, outside 0–1: these u, d and r allow arbitrage (need d < e^(rΔt) < u)`;
  const disc = Math.exp(-r * dt);
  const pay = (s: number) => Math.max(0, type === 'call' ? s - K : K - s);
  const keep = n <= 8;
  const nodes: TreeResult['nodes'] = [];
  let vals: number[] = [];
  for (let j = 0; j <= n; j++) vals.push(pay(S * u ** j * d ** (n - j)));
  if (keep) nodes[n] = vals.map((x, j) => ({ s: S * u ** j * d ** (n - j), v: x, early: false }));
  let delta = 0;
  for (let i = n - 1; i >= 0; i--) {
    const next: number[] = [];
    const row: TreeResult['nodes'][number] = [];
    for (let j = 0; j <= i; j++) {
      const cont = disc * (p * vals[j + 1]! + (1 - p) * vals[j]!);
      const s = S * u ** j * d ** (i - j);
      const ex = american ? pay(s) : 0;
      const early = american && ex > cont + 1e-12;
      next.push(early ? ex : cont);
      if (keep) row.push({ s, v: early ? ex : cont, early });
    }
    if (i === 0) delta = (vals[1]! - vals[0]!) / (S * u - S * d);
    vals = next;
    if (keep) nodes[i] = row;
  }
  return { price: vals[0]!, delta, nodes, u, d, p };
}

export function trinomial(type: 'call' | 'put', american: boolean, S: number, K: number, T: number, r: number, v: number, n: number, q = 0): { price: number; pu: number; pm: number; pd: number; u: number } | string {
  const dt = T / n;
  const u = Math.exp(v * Math.sqrt(2 * dt));
  const a = Math.exp(((r - q) * dt) / 2);
  const b = Math.exp(v * Math.sqrt(dt / 2));
  const pu = ((a - 1 / b) / (b - 1 / b)) ** 2;
  const pd = ((b - a) / (b - 1 / b)) ** 2;
  const pm = 1 - pu - pd;
  if (pu < 0 || pd < 0 || pm < 0) return 'The trinomial probabilities are negative for these inputs; use more steps';
  const disc = Math.exp(-r * dt);
  const pay = (s: number) => Math.max(0, type === 'call' ? s - K : K - s);
  let vals: number[] = [];
  for (let j = -n; j <= n; j++) vals.push(pay(S * u ** j));
  for (let i = n - 1; i >= 0; i--) {
    const next: number[] = [];
    for (let j = -i; j <= i; j++) {
      const k = j + i + 1; // index of the middle child in vals (which has 2(i+1)+1 entries)
      const cont = disc * (pu * vals[k + 1]! + pm * vals[k]! + pd * vals[k - 1]!);
      next.push(american ? Math.max(cont, pay(S * u ** j)) : cont);
    }
    vals = next;
  }
  return { price: vals[0]!, pu, pm, pd, u };
}

/** Kemna–Vorst closed form for a discretely monitored geometric-average Asian option (fixings at T/M, 2T/M, … T). */
export function geometricAsian(type: 'call' | 'put', S: number, K: number, T: number, r: number, v: number, M: number, q = 0): number {
  const dt = T / M;
  const mu = Math.log(S) + (r - q - (v * v) / 2) * dt * (M + 1) / 2;
  const s2 = (v * v * dt * (M + 1) * (2 * M + 1)) / (6 * M);
  const sg = Math.sqrt(s2);
  const d1 = (mu - Math.log(K) + s2) / sg;
  const d2 = d1 - sg;
  const df = Math.exp(-r * T);
  const eg = Math.exp(mu + s2 / 2);
  return type === 'call' ? df * (eg * N(d1) - K * N(d2)) : df * (K * N(-d2) - eg * N(-d1));
}

export interface McResult {
  price: number;
  se: number;
  paths: number;
}

export function mcAsian(type: 'call' | 'put', S: number, K: number, T: number, r: number, v: number, M: number, paths: number, seed: number, q = 0): McResult & { geometric: number; control: boolean } {
  const z = gaussian(rng(seed));
  const dt = T / M;
  const drift = (r - q - (v * v) / 2) * dt;
  const vol = v * Math.sqrt(dt);
  const df = Math.exp(-r * T);
  const pay = (x: number) => Math.max(0, type === 'call' ? x - K : K - x);
  const geo = geometricAsian(type, S, K, T, r, v, M, q);
  const half = Math.ceil(paths / 2);
  const ys: number[] = [];
  const xs: number[] = [];
  const shocks = new Float64Array(M);
  for (let i = 0; i < half; i++) {
    for (let k = 0; k < M; k++) shocks[k] = z();
    for (const sign of [1, -1]) {
      let ls = Math.log(S);
      let ar = 0;
      let lg = 0;
      for (let k = 0; k < M; k++) {
        ls += drift + sign * vol * shocks[k]!;
        ar += Math.exp(ls);
        lg += ls;
      }
      ys.push(df * pay(ar / M));
      xs.push(df * pay(Math.exp(lg / M)));
    }
  }
  // Control variate: the geometric Asian, whose price is known exactly. Pairs are averaged for antithetic SE.
  const n = ys.length;
  const my = ys.reduce((s, x) => s + x, 0) / n;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const beta = sxx > 0 ? sxy / sxx : 0;
  const adj: number[] = [];
  for (let i = 0; i < n; i += 2) adj.push(((ys[i]! - beta * (xs[i]! - geo)) + (ys[i + 1]! - beta * (xs[i + 1]! - geo))) / 2);
  const m = adj.reduce((s, x) => s + x, 0) / adj.length;
  const sd = Math.sqrt(adj.reduce((s, x) => s + (x - m) ** 2, 0) / (adj.length - 1));
  return { price: m, se: sd / Math.sqrt(adj.length), paths: n, geometric: geo, control: true };
}

export type BarrierKind = 'up-and-out' | 'up-and-in' | 'down-and-out' | 'down-and-in';

export function mcBarrier(type: 'call' | 'put', kind: BarrierKind, S: number, K: number, H: number, T: number, r: number, v: number, steps: number, paths: number, seed: number, q = 0): McResult {
  const z = gaussian(rng(seed));
  const dt = T / steps;
  const drift = (r - q - (v * v) / 2) * dt;
  const vol = v * Math.sqrt(dt);
  const df = Math.exp(-r * T);
  const up = kind.startsWith('up');
  const out = kind.endsWith('out');
  const lh = Math.log(H);
  const half = Math.ceil(paths / 2);
  const pair: number[] = [];
  const shocks = new Float64Array(steps);
  for (let i = 0; i < half; i++) {
    for (let k = 0; k < steps; k++) shocks[k] = z();
    let acc = 0;
    for (const sign of [1, -1]) {
      let ls = Math.log(S);
      let hit = up ? ls >= lh : ls <= lh;
      for (let k = 0; k < steps; k++) {
        ls += drift + sign * vol * shocks[k]!;
        if (!hit && (up ? ls >= lh : ls <= lh)) hit = true;
      }
      const sT = Math.exp(ls);
      const alive = out ? !hit : hit;
      acc += alive ? df * Math.max(0, type === 'call' ? sT - K : K - sT) : 0;
    }
    pair.push(acc / 2);
  }
  const m = pair.reduce((s, x) => s + x, 0) / pair.length;
  const sd = Math.sqrt(pair.reduce((s, x) => s + (x - m) ** 2, 0) / (pair.length - 1));
  return { price: m, se: sd / Math.sqrt(pair.length), paths: pair.length * 2 };
}

/** Continuously monitored down-and-in / down-and-out call with H ≤ K (Hull §26.9 / Merton 1973, Reiner–Rubinstein 1991). */
export function downCallClosed(kind: 'down-and-in' | 'down-and-out', S: number, K: number, H: number, T: number, r: number, v: number, q = 0): number {
  const lam = (r - q + (v * v) / 2) / (v * v);
  const sq = v * Math.sqrt(T);
  const y = Math.log((H * H) / (S * K)) / sq + lam * sq;
  const cdi = S * Math.exp(-q * T) * (H / S) ** (2 * lam) * N(y) - K * Math.exp(-r * T) * (H / S) ** (2 * lam - 2) * N(y - sq);
  return kind === 'down-and-in' ? cdi : bsm('call', S, K, T, r, v, q).price - cdi;
}

/** Continuously monitored up-and-in / up-and-out put with H ≥ K (Hull §26.9). */
export function upPutClosed(kind: 'up-and-in' | 'up-and-out', S: number, K: number, H: number, T: number, r: number, v: number, q = 0): number {
  const lam = (r - q + (v * v) / 2) / (v * v);
  const sq = v * Math.sqrt(T);
  const y = Math.log((H * H) / (S * K)) / sq + lam * sq;
  const pui = -S * Math.exp(-q * T) * (H / S) ** (2 * lam) * N(-y) + K * Math.exp(-r * T) * (H / S) ** (2 * lam - 2) * N(-y + sq);
  return kind === 'up-and-in' ? pui : bsm('put', S, K, T, r, v, q).price - pui;
}

// ---------------------------------------------------------------- parsing

const S_NAMES = String.raw`s0|s|spot(?: price)?|stock(?: price)?|share price|underlying(?: price)?|asset price|current (?:stock )?price|price of the (?:stock|share|underlying)`;
const K_NAMES = String.raw`k|strike(?: price)?|exercise price|x`;
const R_NAMES = String.raw`r|rf|risk[- ]?free(?: (?:interest )?rate)?|interest rate|rate`;
const V_NAMES = String.raw`sigma|vol|vols|volatility|v|iv|implied vol(?:atility)?`;
const Q_NAMES = String.raw`q|dividend yield|div(?:idend)? yield|continuous dividend(?: yield)?|yield`;
const T_NAMES = String.raw`t|time(?: to (?:maturity|expiry|expiration))?|maturity|expiry|expiration|tenor|term`;

interface Inputs {
  S?: number;
  K?: number;
  T?: { t: number; how: string };
  r?: number;
  v?: number;
  q: number;
  notes: string[];
}

function inputs(s: string, spot = S_NAMES): Inputs {
  const notes: string[] = [];
  const S = param(s, spot)?.v;
  const K = param(s, K_NAMES)?.v;
  const T = years(s, T_NAMES);
  const r = rateOf(param(s, R_NAMES), notes, 'r');
  const v = rateOf(param(s, V_NAMES), notes, 'volatility');
  const q = rateOf(param(s, Q_NAMES), notes, 'q') ?? 0;
  return { S, K, T, r, v, q, notes };
}

function missing(q: Q, kind: string, x: Inputs, needV = true, spotLabel = 'the stock price (S)'): AnswerResult | null {
  const lack: string[] = [];
  if (x.S === undefined) lack.push(spotLabel);
  if (x.K === undefined) lack.push('the strike (K)');
  if (!x.T) lack.push('the time to expiry (T, e.g. "T=0.5" or "6 months")');
  if (x.r === undefined) lack.push('the risk-free rate (r)');
  if (needV && x.v === undefined) lack.push('the volatility (σ)');
  if (lack.length) return need(q, kind, `I need ${lack.join(', ').replace(/, ([^,]*)$/, ' and $1')}`);
  if (!(x.S! > 0) || !(x.K! > 0)) return bad(q, kind, 'S and K must be positive');
  if (!(x.T!.t > 0)) return bad(q, kind, 'The time to expiry must be positive');
  if (needV && !(x.v! > 0)) return bad(q, kind, 'The volatility must be positive');
  return null;
}

function optType(s: string): 'call' | 'put' | 'both' {
  const c = /\bcalls?\b/.test(s);
  const p = /\bputs?\b/.test(s);
  return c && !p ? 'call' : p && !c ? 'put' : 'both';
}

const f4 = (x: number) => fix(x, 4);
const greeksTable = (c: Greeks, p: Greeks, caption: string): Table => ({
  caption,
  columns: ['', 'Call', 'Put'],
  rows: [
    ['Price', f4(c.price), f4(p.price)],
    ['Delta', f4(c.delta), f4(p.delta)],
    ['Gamma', f4(c.gamma), f4(p.gamma)],
    ['Vega (per 1% vol)', f4(c.vega / 100), f4(p.vega / 100)],
    ['Theta (per day)', f4(c.theta / 365), f4(p.theta / 365)],
    ['Theta (per year)', f4(c.theta), f4(p.theta)],
    ['Rho (per 1% rate)', f4(c.rho / 100), f4(p.rho / 100)],
  ],
});

function inputsLine(x: Inputs, spot = 'S'): string {
  return `${spot}=${num(x.S!)}, K=${num(x.K!)}, T=${num(x.T!.t)} y, r=${pct(x.r!, 2)}, σ=${pct(x.v!, 2)}${x.q ? `, q=${pct(x.q, 2)}` : ''}`;
}

// ---------------------------------------------------------------- handlers

export function blackScholes(q: Q): AnswerResult | null {
  const s = q.s;
  const b76 = /\bblack[\s-]*(?:19)?76\b|\bblack'?s model\b|\b(?:futures?|forward) options?\b|\boptions? on (?:a )?(?:futures?|forwards?)\b/.test(s);
  if (!b76 && !/black\W*scholes|\bbsm\b|\bgreeks?\b|\b(?:delta|gamma|vega|theta|rho)\b.*\b(?:call|put|option)\b|\b(?:european )?(?:call|put) option (?:price|value)\b|\bprice (?:a|an|the|this)? ?(?:european )?(?:call|put)\b|\boption pric/.test(s)) return null;
  if (/\b(?:binomial|trinomial|tree|monte carlo|asian|barrier|implied|american|knock|digital|binary|parity)\b/.test(s)) return null;
  const x = inputs(s, b76 ? String.raw`f0|f|forward(?: price)?|futures(?: price)?|${S_NAMES}` : S_NAMES);
  const kind = b76 ? 'black76' : 'black-scholes';
  const miss = missing(q, kind, x, true, b76 ? 'the forward/futures price (F)' : 'the stock price (S)');
  if (miss) return miss;
  const { S, K, T, r, v } = x as Required<Inputs>;
  const c = b76 ? black76('call', S, K, T.t, r, v) : bsm('call', S, K, T.t, r, v, x.q);
  const p = b76 ? black76('put', S, K, T.t, r, v) : bsm('put', S, K, T.t, r, v, x.q);
  const type = optType(s);
  const main = type === 'put' ? p : c;
  const name = b76 ? 'Black-76' : 'Black–Scholes';
  const lines: Lines = [
    { label: 'd₁', display: f4(c.d1) },
    { label: 'd₂', display: f4(c.d2) },
    { label: 'N(d₁), N(d₂)', display: `${f4(N(c.d1))}, ${f4(N(c.d2))}` },
  ];
  if (type === 'both') lines.unshift({ label: 'Put', display: f4(p.price) });
  else lines.unshift({ label: type === 'call' ? 'Put (same inputs)' : 'Call (same inputs)', display: f4(type === 'call' ? p.price : c.price) });
  const greek = /\b(delta|gamma|vega|theta|rho)\b/.exec(s)?.[1] as keyof Greeks | undefined;
  const notes = [
    ...x.notes,
    b76
      ? 'Black-76: c = e^(−rT)[F·N(d₁) − K·N(d₂)], d₁ = [ln(F/K) + σ²T/2] / (σ√T), d₂ = d₁ − σ√T'
      : `Black–Scholes–Merton: c = S·e^(−qT)·N(d₁) − K·e^(−rT)·N(d₂), d₁ = [ln(S/K) + (r − q + σ²/2)T] / (σ√T), d₂ = d₁ − σ√T`,
    'European exercise, continuous compounding; vega per 1 vol point, theta per calendar day (÷ 365), rho per 1% rate',
  ];
  if (greek && type !== 'both') {
    const scale = greek === 'vega' || greek === 'rho' ? 0.01 : greek === 'theta' ? 1 / 365 : 1;
    const val = main[greek] * scale;
    return answer(q, {
      kind,
      expression: `${name} ${type} ${greek} · ${inputsLine(x, b76 ? 'F' : 'S')}`,
      display: f4(val),
      value: val,
      lines: [{ label: `${type === 'call' ? 'Call' : 'Put'} price`, display: f4(main.price) }, ...lines],
      table: greeksTable(c, p, 'Greeks'),
      notes,
    });
  }
  return answer(q, {
    kind,
    expression: `${name} ${type === 'both' ? 'call and put' : type} · ${inputsLine(x, b76 ? 'F' : 'S')}`,
    display: money(main.price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: main.price,
    unit: type === 'both' ? 'call' : type,
    lines,
    table: greeksTable(c, p, 'Greeks'),
    notes,
  });
}

export function impliedVolatility(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\bimplied vol(?:atility)?\b/.test(s)) return null;
  const x = inputs(s.replace(/implied vol(?:atility)?|\biv\b/g, ' '));
  const notes = x.notes;
  const price = param(s, String.raw`(?:call|put|option)(?: (?:price|premium|value))?(?: (?:of|is))?|premium|market price|priced(?: at)?|trading at|trades? at|worth|c|p`);
  const lack: string[] = [];
  if (!price) lack.push('the option price');
  const miss = missing(q, 'implied-vol', x, false);
  if (lack.length) return need(q, 'implied-vol', `Implied volatility needs the option's market price, e.g. "implied vol of a call priced 4.76 S=42 K=40 T=0.5 r=10%"`);
  if (miss) return miss;
  const { S, K, T, r } = x as Required<Inputs>;
  let type = optType(s);
  if (type === 'both') {
    type = 'call';
    notes.push('Treated as a call (say "put" for a put)');
  }
  const t = type;
  const dq = Math.exp(-x.q * T.t);
  const dr = Math.exp(-r * T.t);
  const lo = Math.max(0, t === 'call' ? S * dq - K * dr : K * dr - S * dq);
  const hi = t === 'call' ? S * dq : K * dr;
  if (!(price!.v > lo && price!.v < hi)) return bad(q, 'implied-vol', `A ${t} price must be between ${fix(lo, 4)} and ${fix(hi, 4)} for these inputs (no-arbitrage bounds); ${num(price!.v)} is outside, so no volatility fits`);
  const iv = impliedVol(t, price!.v, S, K, T.t, r, x.q);
  if (iv === null) return bad(q, 'implied-vol', 'No volatility between 0% and 1000% reproduces that price');
  const g = bsm(t, S, K, T.t, r, iv, x.q);
  return answer(q, {
    kind: 'implied-vol',
    expression: `Implied volatility of a ${t} priced ${num(price!.v)} · S=${num(S)}, K=${num(K)}, T=${num(T.t)} y, r=${pct(r)}${x.q ? `, q=${pct(x.q)}` : ''}`,
    display: pct(iv, 2),
    value: iv,
    lines: [
      { label: 'Check: Black–Scholes price at this σ', display: f4(g.price) },
      { label: 'Vega (per 1% vol)', display: f4(g.vega / 100) },
      { label: 'Delta', display: f4(g.delta) },
    ],
    notes: [...notes, 'Solved by bisection on the Black–Scholes–Merton price (unique: the price rises with σ)'],
  });
}

export function putCallParity(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/put[\s-]*call parity|call[\s-]*put parity/.test(s)) return null;
  const notes: string[] = [];
  const S = param(s, S_NAMES)?.v;
  const K = param(s, K_NAMES)?.v;
  const T = years(s, T_NAMES);
  const r = rateOf(param(s, R_NAMES), notes, 'r');
  const qd = rateOf(param(s, Q_NAMES), notes, 'q') ?? 0;
  const c = param(s, String.raw`call(?: price| premium)?|c`)?.v;
  const p = param(s, String.raw`put(?: price| premium)?|p`)?.v;
  if (S === undefined || K === undefined || !T || r === undefined) return need(q, 'parity', 'Put–call parity needs S, K, T, r and a call or put price, e.g. "put call parity call 4.76 S=42 K=40 r=10% T=0.5"');
  if (c === undefined && p === undefined) return need(q, 'parity', 'Give the call price or the put price');
  const pvK = K * Math.exp(-r * T.t);
  const sAdj = S * Math.exp(-qd * T.t);
  const formula = 'c + K·e^(−rT) = p + S·e^(−qT)';
  const lines: Lines = [
    { label: 'PV of strike K·e^(−rT)', display: f4(pvK) },
    ...(qd ? [{ label: 'S·e^(−qT)', display: f4(sAdj) }] : []),
  ];
  if (c !== undefined && p !== undefined) {
    const gap = c - p - (sAdj - pvK);
    const ok = Math.abs(gap) < 0.005;
    return answer(q, {
      kind: 'parity',
      expression: `Put–call parity check · c=${num(c)}, p=${num(p)}, S=${num(S)}, K=${num(K)}, T=${num(T.t)}, r=${pct(r)}`,
      display: ok ? 'Holds' : `Violated by ${fix(Math.abs(gap), 4)}`,
      value: gap,
      lines: [
        ...lines,
        { label: 'c − p', display: f4(c - p) },
        { label: 'S·e^(−qT) − K·e^(−rT)', display: f4(sAdj - pvK) },
        ...(ok ? [] : [{ label: 'Arbitrage', display: gap > 0 ? 'Call rich: sell the call, buy the put and the stock, borrow PV(K)' : 'Put rich: sell the put, buy the call, short the stock, lend PV(K)' }]),
      ],
      notes: [...notes, formula, 'European options on the same underlying, strike and expiry'],
    });
  }
  const other = c !== undefined ? c - sAdj + pvK : p! + sAdj - pvK;
  const what = c !== undefined ? 'put' : 'call';
  return answer(q, {
    kind: 'parity',
    expression: `Put–call parity: ${what} from ${c !== undefined ? `call ${num(c)}` : `put ${num(p!)}`} · S=${num(S)}, K=${num(K)}, T=${num(T.t)}, r=${pct(r)}`,
    display: money(other, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: other,
    unit: what,
    lines,
    notes: [...notes, formula, ...(other < 0 ? ['A negative price means the given price breaks no-arbitrage bounds'] : [])],
  });
}

export function trees(q: Q): AnswerResult | null {
  const s = q.s;
  const tri = /\btrinomial\b/.test(s);
  if (!tri && !/\bbinomial (?:tree|model|option|pricing|lattice)|\bcrr\b|\b(?:binomial|lattice)\b.*\b(?:call|put|option)\b|\b(?:call|put|option)\b.*\bbinomial\b|\bamerican (?:call|put|option)\b/.test(s)) return null;
  const x = inputs(s);
  const uP = param(s, 'u|up(?: factor)?')?.v;
  const dP = param(s, 'd|down(?: factor)?')?.v;
  const explicit = uP !== undefined && dP !== undefined;
  const miss = missing(q, 'tree', x, !explicit);
  if (miss) return miss;
  const { S, K, T, r } = x as Required<Inputs>;
  const notes = x.notes;
  const stepsP = param(s, String.raw`n|steps?|periods?|time steps?`)?.v ?? (/(\d+)[\s-]*(?:step|period)s?\b/.exec(s) ? Number(/(\d+)[\s-]*(?:step|period)s?\b/.exec(s)![1]) : undefined);
  let n = stepsP ?? (explicit ? 1 : 100);
  if (stepsP === undefined) notes.push(`${n} step${n === 1 ? '' : 's'} (say "N steps" to change)`);
  if (!Number.isInteger(n) || n < 1 || n > 5000) return bad(q, 'tree', 'The number of steps must be a whole number from 1 to 5000');
  n = Math.round(n);
  const american = /\bamerican\b/.test(s);
  let type = optType(s);
  if (type === 'both') {
    notes.push('Priced a call (say "put" for a put)');
    type = 'call';
  }
  const t = type;
  const style = american ? 'American' : 'European';
  if (tri) {
    const v = x.v!;
    const tr = trinomial(t, american, S, K, T.t, r, v, n, x.q);
    if (typeof tr === 'string') return bad(q, 'tree', tr);
    const euro = bsm(t, S, K, T.t, r, v, x.q).price;
    return answer(q, {
      kind: 'tree',
      expression: `Trinomial tree, ${style} ${t}, ${n} steps · ${inputsLine(x)}`,
      display: money(tr.price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
      value: tr.price,
      lines: [
        { label: 'u = e^(σ√(2Δt))', display: fix(tr.u, 6) },
        { label: 'pᵤ, pₘ, p_d', display: `${f4(tr.pu)}, ${f4(tr.pm)}, ${f4(tr.pd)}` },
        { label: 'Black–Scholes (European)', display: f4(euro) },
      ],
      notes: [...notes, 'Boyle-type trinomial lattice: u = e^(σ√(2Δt)), middle move 1, probabilities matched to the risk-neutral drift'],
    });
  }
  const tr = binomial(t, american, S, K, T.t, r, x.v ?? 0, n, x.q, explicit ? { u: uP, d: dP } : undefined);
  if (typeof tr === 'string') return bad(q, 'tree', tr);
  const lines: Lines = [
    { label: 'u, d', display: `${fix(tr.u, 6)}, ${fix(tr.d, 6)}` },
    { label: 'Risk-neutral p', display: fix(tr.p, 6) },
    { label: 'Delta at t=0', display: f4(tr.delta) },
  ];
  if (x.v !== undefined) lines.push({ label: `Black–Scholes (European ${t})`, display: f4(bsm(t, S, K, T.t, r, x.v, x.q).price) });
  if (american) {
    const eu = binomial(t, false, S, K, T.t, r, x.v ?? 0, n, x.q, explicit ? { u: uP, d: dP } : undefined);
    if (typeof eu !== 'string') lines.push({ label: 'Same tree, European', display: f4(eu.price) }, { label: 'Early-exercise premium', display: f4(tr.price - eu.price) });
  }
  let table: Table | undefined;
  if (n <= 6) {
    const cols = ['Step', ...Array.from({ length: n + 1 }, (_, j) => `Node ${j}`)];
    table = {
      caption: `Tree: stock price / option value${american ? ' (* = exercise early)' : ''}, node 0 = all down moves`,
      columns: cols,
      rows: tr.nodes.map((row, i) => [String(i), ...Array.from({ length: n + 1 }, (_, j) => (row[j] ? `${fix(row[j]!.s, 2)} / ${fix(row[j]!.v, 4)}${row[j]!.early ? '*' : ''}` : ''))]),
    };
  }
  return answer(q, {
    kind: 'tree',
    expression: `Binomial tree (CRR), ${style} ${t}, ${n} step${n === 1 ? '' : 's'} · S=${num(S)}, K=${num(K)}, T=${num(T.t)} y, r=${pct(r)}${explicit ? `, u=${num(uP)}, d=${num(dP)}` : `, σ=${pct(x.v!)}`}${x.q ? `, q=${pct(x.q)}` : ''}`,
    display: money(tr.price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: tr.price,
    lines,
    table,
    notes: [...notes, explicit ? 'p = (e^((r−q)Δt) − d) / (u − d); value = e^(−rΔt)[p·Vᵤ + (1−p)·V_d], working back from expiry' : 'Cox–Ross–Rubinstein: u = e^(σ√Δt), d = 1/u, p = (e^((r−q)Δt) − d) / (u − d)'],
  });
}

export function monteCarlo(q: Q): AnswerResult | null {
  const s = q.s;
  const asian = /\basian\b|\baverage (?:price|rate) option/.test(s);
  const barrierM = /\b(up|down)[\s-]*(?:and[\s-]*)?(out|in)\b|\bknock[\s-]*(out|in)\b|\bbarrier\b/.exec(s);
  if (!asian && !barrierM) return null;
  if (!/\b(?:option|call|put)s?\b/.test(s)) return null;
  const x = inputs(s);
  const miss = missing(q, 'monte-carlo', x);
  if (miss) return miss;
  const { S, K, T, r, v } = x as Required<Inputs>;
  const notes = x.notes;
  let type = optType(s);
  if (type === 'both') {
    notes.push('Priced a call (say "put" for a put)');
    type = 'call';
  }
  const t = type;
  const pathsP = param(s, String.raw`paths|simulations|sims|trials|runs|scenarios`)?.v ?? (/(\d[\d,]*)\s*(?:paths|simulations|sims|trials|runs)\b/.exec(s) ? Number(/(\d[\d,]*)\s*(?:paths|simulations|sims|trials|runs)\b/.exec(s)![1]!.replace(/,/g, '')) : undefined);
  const paths = Math.round(pathsP ?? 20000);
  if (paths < 100 || paths > 200000) return bad(q, 'monte-carlo', 'Use between 100 and 200,000 paths here');
  const seedP = param(s, 'seed')?.v;
  const seed = Math.round(seedP ?? 42);
  if (seedP === undefined) notes.push('Seed 42 (say "seed N" for another run)');
  const fixP = param(s, String.raw`fixings|averaging (?:points|dates)|observations|monitoring (?:points|dates)|steps`)?.v ?? (/(\d+)\s*(?:fixings|averaging points|observations|monitoring dates|steps)\b/.exec(s) ? Number(/(\d+)\s*(?:fixings|averaging points|observations|monitoring dates|steps)\b/.exec(s)![1]) : undefined);
  const freq = /\bdaily\b/.test(s) ? Math.round(252 * T.t) : /\bweekly\b/.test(s) ? Math.round(52 * T.t) : /\bmonthly\b/.test(s) ? Math.round(12 * T.t) : /\bquarterly\b/.test(s) ? Math.round(4 * T.t) : undefined;
  if (asian) {
    const M = Math.max(1, Math.round(fixP ?? freq ?? Math.max(1, Math.round(12 * T.t))));
    if (fixP === undefined && freq === undefined) notes.push(`${M} equally spaced monthly fixings (say "N fixings" or "daily")`);
    if (M * paths > 20_000_000) return bad(q, 'monte-carlo', 'That many fixings × paths is too slow here; use fewer');
    const r0 = mcAsian(t, S, K, T.t, r, v, M, paths, seed, x.q);
    return answer(q, {
      kind: 'monte-carlo',
      expression: `Monte Carlo arithmetic Asian ${t}, ${M} fixings, ${r0.paths.toLocaleString('en-US')} paths · ${inputsLine(x)}`,
      display: money(r0.price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
      value: r0.price,
      lines: [
        { label: 'Standard error', display: f4(r0.se) },
        { label: '95% interval', display: `${f4(r0.price - 1.96 * r0.se)} to ${f4(r0.price + 1.96 * r0.se)}` },
        { label: 'Geometric Asian (exact)', display: f4(r0.geometric) },
        { label: 'Vanilla European (Black–Scholes)', display: f4(bsm(t, S, K, T.t, r, v, x.q).price) },
      ],
      notes: [...notes, 'Risk-neutral GBM paths, antithetic variates, geometric-Asian control variate (Kemna–Vorst closed form); payoff max(Ā − K, 0) on the arithmetic average of the fixings'],
      exactness: 'approximate',
    });
  }
  const H = param(s, String.raw`h|barrier(?: level| at)?|knock[\s-]*(?:out|in)(?: level| at)?`)?.v;
  if (H === undefined) return need(q, 'monte-carlo', 'What is the barrier level? e.g. "barrier 90"');
  const dir = barrierM![1] ?? (H > S ? 'up' : 'down');
  const io = barrierM![2] ?? barrierM![3] ?? (/\bin\b/.test(s) ? 'in' : 'out');
  if (!barrierM![1] && !barrierM![2] && !barrierM![3]) notes.push(`Read as ${dir}-and-${io} from the barrier's position`);
  const kind = `${dir}-and-${io}` as BarrierKind;
  if ((dir === 'up' && H <= S) || (dir === 'down' && H >= S)) {
    const already = io === 'out' ? 'is knocked out at the start (worth 0)' : 'is already knocked in (a vanilla option)';
    return bad(q, 'monte-carlo', `The barrier ${num(H)} is ${dir === 'up' ? 'at or below' : 'at or above'} the spot ${num(S)}, so the ${kind} option ${already}`);
  }
  const steps = Math.max(1, Math.round(fixP ?? freq ?? Math.round(252 * T.t)));
  if (fixP === undefined && freq === undefined) notes.push(`Monitored daily: ${steps} steps (252 trading days a year)`);
  if (steps * paths > 20_000_000) return bad(q, 'monte-carlo', 'That many monitoring steps × paths is too slow here; use fewer');
  const r0 = mcBarrier(t, kind, S, K, H, T.t, r, v, steps, paths, seed, x.q);
  const lines: Lines = [
    { label: 'Standard error', display: f4(r0.se) },
    { label: '95% interval', display: `${f4(r0.price - 1.96 * r0.se)} to ${f4(r0.price + 1.96 * r0.se)}` },
    { label: 'Vanilla European (Black–Scholes)', display: f4(bsm(t, S, K, T.t, r, v, x.q).price) },
  ];
  // Closed forms (continuous monitoring) where Hull gives them simply; BGK shifts the barrier for discrete monitoring.
  const shift = Math.exp(0.5826 * v * Math.sqrt(T.t / steps));
  if (t === 'call' && dir === 'down' && H <= K) {
    lines.push({ label: 'Closed form, continuous monitoring', display: f4(downCallClosed(kind as 'down-and-in', S, K, H, T.t, r, v, x.q)) });
    lines.push({ label: 'Closed form, discrete (BGK barrier shift)', display: f4(downCallClosed(kind as 'down-and-in', S, K, H / shift, T.t, r, v, x.q)) });
  } else if (t === 'put' && dir === 'up' && H >= K) {
    lines.push({ label: 'Closed form, continuous monitoring', display: f4(upPutClosed(kind as 'up-and-in', S, K, H, T.t, r, v, x.q)) });
    lines.push({ label: 'Closed form, discrete (BGK barrier shift)', display: f4(upPutClosed(kind as 'up-and-in', S, K, H * shift, T.t, r, v, x.q)) });
  }
  return answer(q, {
    kind: 'monte-carlo',
    expression: `Monte Carlo ${kind} ${t}, barrier ${num(H)}, ${steps} monitoring steps, ${r0.paths.toLocaleString('en-US')} paths · ${inputsLine(x)}`,
    display: money(r0.price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: r0.price,
    lines,
    notes: [...notes, 'Risk-neutral GBM paths with antithetic variates; the barrier is checked at each monitoring step (discrete monitoring), no rebate'],
    exactness: 'approximate',
  });
}

export function digital(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\b(?:digital|binary|cash[\s-]*or[\s-]*nothing|asset[\s-]*or[\s-]*nothing)\b.*\b(?:call|put|option)\b|\b(?:call|put|option)\b.*\b(?:digital|binary|cash[\s-]*or[\s-]*nothing)\b/.test(s)) return null;
  const x = inputs(s);
  const miss = missing(q, 'digital', x);
  if (miss) return miss;
  const { S, K, T, r, v } = x as Required<Inputs>;
  const assetOr = /asset[\s-]*or[\s-]*nothing/.test(s);
  const pay = param(s, String.raw`pays?|payout|payoff|cash|amount|notional`)?.v ?? 1;
  let type = optType(s);
  const notes = x.notes;
  if (type === 'both') {
    type = 'call';
    notes.push('Priced a call (say "put" for a put)');
  }
  const g = bsm('call', S, K, T.t, r, v, x.q);
  const price = assetOr
    ? type === 'call' ? S * Math.exp(-x.q * T.t) * N(g.d1) : S * Math.exp(-x.q * T.t) * N(-g.d1)
    : type === 'call' ? pay * Math.exp(-r * T.t) * N(g.d2) : pay * Math.exp(-r * T.t) * N(-g.d2);
  return answer(q, {
    kind: 'digital',
    expression: `${assetOr ? 'Asset-or-nothing' : `Cash-or-nothing (pays ${num(pay)})`} ${type} · ${inputsLine(x)}`,
    display: money(price, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: price,
    lines: [
      { label: 'd₂', display: f4(g.d2) },
      { label: 'Risk-neutral probability of finishing in the money', display: f4(type === 'call' ? N(g.d2) : N(-g.d2)) },
    ],
    notes: [...notes, assetOr ? 'Asset-or-nothing call = S·e^(−qT)·N(d₁)' : 'Cash-or-nothing call = Q·e^(−rT)·N(d₂); put uses N(−d₂)'],
  });
}

export function forwardPrice(q: Q): AnswerResult | null {
  const s = q.s;
  if (!/\b(?:forward|futures?)\b/.test(s) || /\bforward rates?\b|\bfra\b|\boptions?\b|\bcall\b|\bput\b/.test(s)) return null;
  // "future value of 100 per month" is time value of money (finance engine), not a futures contract.
  if (/\bfuture value\b/.test(s) && !/\b(?:spot|s0|cost of carry|commodity)\b/.test(s)) return null;
  if (!/\b(?:forward|futures?) (?:price|contract)|\bforward value|\bfair (?:forward|futures?)|\bcost of carry\b|\bprice (?:of )?(?:a |the )?(?:forward|futures?)|\b(?:forward|futures?)\b.*\b(?:spot|s0?|stock|commodity)\b/.test(s)) return null;
  const notes: string[] = [];
  const S = param(s, S_NAMES + '|spot price|price')?.v;
  const T = years(s, T_NAMES);
  const r = rateOf(param(s, R_NAMES), notes, 'r');
  if (S === undefined || !T || r === undefined) return need(q, 'forward', 'A forward price needs the spot price, the risk-free rate and the time, e.g. "forward price spot 50 r=8% 10 months"');
  const qd = rateOf(param(s, String.raw`q|dividend yield|div(?:idend)? yield|continuous dividend(?: yield)?|foreign (?:interest )?rate|rf_?foreign`), notes, 'q') ?? 0;
  const u = rateOf(param(s, String.raw`storage(?: cost)?(?: yield| rate)?|u`), notes, 'storage cost') ?? 0;
  const y = rateOf(param(s, String.raw`convenience yield|y`), notes, 'convenience yield') ?? 0;
  // Discrete dividends: "dividends of 0.75 in 3, 6 and 9 months", "dividend 2 in 4 months".
  let I = 0;
  const divs: string[] = [];
  const dm = new RegExp(String.raw`dividends? (?:of )?\$?(${NUM})(?: each)? (?:in|at|after|paid in|expected in) ((?:${NUM}(?:,| and|,? and)?\s*)+)\s*(months?|years?)`).exec(s);
  if (dm) {
    const amt = Number(dm[1]);
    const times = list(dm[2]!).map((t) => (dm[3]!.startsWith('m') ? t.v / 12 : t.v));
    for (const t of times) {
      if (t >= T.t) continue;
      I += amt * Math.exp(-r * t);
      divs.push(`${num(amt)} at ${num(t, 4)} y`);
    }
  }
  const F = (S - I) * Math.exp((r - qd + u - y) * T.t);
  const lines: Lines = [];
  if (I) lines.push({ label: 'PV of dividends (I)', display: f4(I) }, { label: 'Dividends', display: divs.join(', ') });
  const K = param(s, String.raw`k|delivery price|contract price|agreed price`)?.v;
  if (K !== undefined) lines.push({ label: `Value of a long forward at K=${num(K)}`, display: f4((F - K) * Math.exp(-r * T.t)) });
  const formula = `F₀ = ${I ? '(S₀ − I)' : 'S₀'}·e^((r${qd ? ' − q' : ''}${u ? ' + u' : ''}${y ? ' − y' : ''})T)`;
  return answer(q, {
    kind: 'forward',
    expression: `Forward price · S₀=${num(S)}, r=${pct(r)}, T=${num(T.t, 4)} y${qd ? `, q=${pct(qd)}` : ''}${u ? `, storage u=${pct(u)}` : ''}${y ? `, convenience y=${pct(y)}` : ''}`,
    display: money(F, q.cur, 4).replace(/(\.\d\d)00$/, '$1'),
    value: F,
    lines,
    notes: [...notes, formula, 'No-arbitrage cost-of-carry price with continuous compounding (Hull ch. 5); futures equal forwards when rates are deterministic'],
  });
}
