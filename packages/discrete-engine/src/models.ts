// Mathematical models: SIR/SEIR/SIS compartments, logistic growth, Lotka–Volterra, with RK4 and sensitivity.
import { answer, fmt, param, refuse, type Line, type Result } from './util';

type Deriv = (t: number, y: number[]) => number[];

export function rk4(f: Deriv, y0: number[], t1: number, h: number): { t: number[]; y: number[][] } {
  const ts = [0];
  const ys = [y0];
  let y = y0;
  const n = Math.round(t1 / h);
  for (let i = 0; i < n; i++) {
    const t = i * h;
    const k1 = f(t, y);
    const k2 = f(t + h / 2, y.map((v, j) => v + (h / 2) * k1[j]!));
    const k3 = f(t + h / 2, y.map((v, j) => v + (h / 2) * k2[j]!));
    const k4 = f(t + h, y.map((v, j) => v + h * k3[j]!));
    y = y.map((v, j) => v + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!));
    ts.push((i + 1) * h);
    ys.push(y);
  }
  return { t: ts, y: ys };
}

function sampleRows(t: number[], y: number[][], every: number, cols: (row: number[], t: number) => string[]): string[][] {
  const rows: string[][] = [];
  const step = Math.max(1, Math.round(every / (t[1]! - t[0]!)));
  for (let i = 0; i < t.length; i += step) rows.push([fmt(t[i]!, 6), ...cols(y[i]!, t[i]!)]);
  if ((t.length - 1) % step) rows.push([fmt(t[t.length - 1]!, 6), ...cols(y[y.length - 1]!, t[t.length - 1]!)]);
  return rows;
}

function epidemic(input: string): Result {
  const lc = input.toLowerCase();
  const kind = /\bseir\b/.test(lc) ? 'SEIR' : /\bsis\b/.test(lc) ? 'SIS' : /\bsir\b|\bsusceptible[- ]infected/.test(lc) ? 'SIR' : null;
  if (!kind) return null;
  const R0given = param(input, ['R0', 'R_0', 'r0', 'r naught', 'basic reproduction number']);
  let gamma = param(input, ['gamma', 'γ', 'recovery rate']);
  const days = param(input, ['infectious period', 'recovery time', 'duration']);
  if (gamma === undefined && days !== undefined) gamma = 1 / days;
  let beta = param(input, ['beta', 'β', 'transmission rate', 'contact rate', 'infection rate']);
  if (beta === undefined && R0given !== undefined && gamma !== undefined) beta = R0given * gamma;
  if (beta === undefined || gamma === undefined) refuse(`Give β and γ (or R0 and γ), e.g. “${kind} model beta 0.3 gamma 0.1 N 1000 I0 1”`);
  const sigma = kind === 'SEIR' ? param(input, ['sigma', 'σ', 'incubation rate', 'latency rate']) ?? (param(input, ['incubation period', 'latent period']) ? 1 / param(input, ['incubation period', 'latent period'])! : undefined) : 0;
  if (kind === 'SEIR' && sigma === undefined) refuse('SEIR needs σ (1/incubation period)');
  const N = param(input, ['N', 'population', 'pop'], 1000)!;
  const I0 = param(input, ['I0', 'I_0', 'initial infected', 'infected'], 1)!;
  const E0 = param(input, ['E0', 'E_0', 'exposed'], 0)!;
  const R0init = param(input, ['R(0)', 'recovered'], 0)!;
  const T = param(input, ['days', 't', 'time', 'for', 'over'], 160)!;
  const h = Math.min(0.1, T / 2000);
  const sim = (b: number, g: number) => {
    const f: Deriv = (_, [S, E, I, R]) => {
      const inf = (b * S! * I!) / N;
      if (kind === 'SEIR') return [-inf, inf - sigma! * E!, sigma! * E! - g * I!, g * I!];
      if (kind === 'SIS') return [-inf + g * I!, 0, inf - g * I!, 0];
      return [-inf, 0, inf - g * I!, g * I!];
    };
    return rk4(f, [N - I0 - E0 - R0init, E0, I0, R0init], T, h);
  };
  const run = sim(beta!, gamma!);
  const Is = run.y.map((r) => r[2]!);
  const peakI = Math.max(...Is);
  const peakT = run.t[Is.indexOf(peakI)]!;
  const last = run.y[run.y.length - 1]!;
  const R0 = beta! / gamma!;
  const lines: Line[] = [
    { label: 'R₀ = β/γ', display: fmt(R0, 6) },
    { label: 'Peak infected', display: `${fmt(peakI, 6)} on day ${fmt(peakT, 4)} (${fmt((100 * peakI) / N, 4)}% of N)` },
  ];
  const sens: string[][] = [];
  if (kind !== 'SIS') {
    const finalR = last[3]!;
    lines.push({ label: `Recovered by day ${fmt(T)}`, display: `${fmt(finalR, 6)} (${fmt((100 * finalR) / N, 4)}%)` });
    // Final-size equation (SIR/SEIR): s∞ = exp(−R0(1 − s∞)).
    if (R0 > 1) {
      let s = 0.5;
      for (let i = 0; i < 200; i++) s = Math.exp(-R0 * (1 - s));
      lines.push({ label: 'Final size (analytic, small I₀)', display: `${fmt((1 - s) * 100, 5)}% eventually infected` });
    }
    lines.push({ label: 'Herd immunity threshold', display: R0 > 1 ? `1 − 1/R₀ = ${fmt((1 - 1 / R0) * 100, 5)}%` : 'none needed (R₀ ≤ 1)' });
    // Sensitivity: elasticity of peak and final size to β and γ (±1%).
    for (const [name, bb, gg] of [['β', 1.01, 1], ['γ', 1, 1.01]] as const) {
      const up = sim(beta! * bb, gamma! * gg);
      const dn = sim(beta! / bb, gamma! / gg);
      const pk = (r: typeof up) => Math.max(...r.y.map((v) => v[2]!));
      const fin = (r: typeof up) => r.y[r.y.length - 1]![3]!;
      const el = (a: number, b: number, base: number) => (a - b) / base / (2 * Math.log(1.01));
      sens.push([name, fmt(el(pk(up), pk(dn), peakI), 4), fmt(el(fin(up), fin(dn), last[3]!), 4)]);
    }
  } else {
    lines.push({ label: 'Endemic equilibrium I*', display: R0 > 1 ? `N(1 − 1/R₀) = ${fmt(N * (1 - 1 / R0), 6)}` : '0 (dies out)' });
  }
  const table = { columns: ['day', 'S', ...(kind === 'SEIR' ? ['E'] : []), 'I', ...(kind !== 'SIS' ? ['R'] : [])], rows: sampleRows(run.t, run.y, Math.max(1, Math.round(T / 16)), (r) => [r[0]!, ...(kind === 'SEIR' ? [r[1]!] : []), r[2]!, ...(kind !== 'SIS' ? [r[3]!] : [])].map((v) => fmt(v, 6))), caption: `${kind} trajectory (RK4, step ${fmt(h)})` };
  const eq = kind === 'SEIR' ? 'S′ = −βSI/N, E′ = βSI/N − σE, I′ = σE − γI, R′ = γI' : kind === 'SIS' ? 'S′ = −βSI/N + γI, I′ = βSI/N − γI' : 'S′ = −βSI/N, I′ = βSI/N − γI, R′ = γI';
  const notes = [eq, R0 > 1 ? 'R₀ > 1: an epidemic grows until enough people are immune.' : 'R₀ ≤ 1: the infection dies out.'];
  if (sens.length) notes.push(`Sensitivity (elasticity, % change per 1% change): peak ${sens.map((s) => `${s[0]} ${s[1]}`).join(', ')}; final size ${sens.map((s) => `${s[0]} ${s[2]}`).join(', ')}.`);
  return answer(input, 'model', `${kind} model · β = ${fmt(beta!)}, γ = ${fmt(gamma!)}${kind === 'SEIR' ? `, σ = ${fmt(sigma!)}` : ''}, N = ${fmt(N)}, I₀ = ${fmt(I0)}, ${fmt(T)} days`, `peak ${fmt(peakI, 5)} infected on day ${fmt(Math.round(peakT))}`, {
    value: peakI,
    lines,
    table,
    notes,
    exactness: 'numeric',
  });
}

function logistic(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\blogistic (?:growth|model|equation|population|curve)\b|\bverhulst\b/.test(lc) || /\blogistic map\b|\bregression\b/.test(lc)) return null;
  const r = param(input, ['r', 'growth rate', 'rate']);
  const K = param(input, ['K', 'carrying capacity', 'capacity']);
  const P0 = param(input, ['P0', 'P_0', 'N0', 'N_0', 'initial population', 'initial', 'starting']);
  const t = param(input, ['t', 'time', 'after', 'at']);
  if (r === undefined || K === undefined || P0 === undefined) refuse('Give r, K and P0, e.g. “logistic growth r=0.1 K=1000 P0=10 t=50”');
  const P = (tt: number) => K! / (1 + ((K! - P0!) / P0!) * Math.exp(-r! * tt));
  const tInfl = Math.log((K! - P0!) / P0!) / r!;
  const T = t ?? Math.max(10, 2 * tInfl);
  const rows = Array.from({ length: 11 }, (_, i) => {
    const tt = (T * i) / 10;
    return [fmt(tt, 6), fmt(P(tt), 8), fmt(r! * P(tt) * (1 - P(tt) / K!), 6)];
  });
  return answer(input, 'model', `Logistic growth · r = ${fmt(r!)}, K = ${fmt(K!)}, P₀ = ${fmt(P0!)}`, t !== undefined ? `P(${fmt(t)}) = ${fmt(P(t), 8)}` : `P(t) = ${fmt(K!)}/(1 + ${fmt((K! - P0!) / P0!, 6)}e^(−${fmt(r!)}t))`, {
    value: t !== undefined ? P(t) : undefined,
    lines: [
      { label: 'Solution', display: `P(t) = K / (1 + ((K − P₀)/P₀)·e^(−rt))` },
      { label: 'Inflection (fastest growth)', display: Number.isFinite(tInfl) && tInfl > 0 ? `t = ${fmt(tInfl, 6)}, P = K/2 = ${fmt(K! / 2)}, rate ${fmt((r! * K!) / 4, 6)}` : 'already past K/2' },
      { label: 'Doubling time early on', display: fmt(Math.LN2 / r!, 6) },
    ],
    table: { columns: ['t', 'P(t)', 'dP/dt'], rows },
    notes: ['dP/dt = rP(1 − P/K): near-exponential growth while P ≪ K, levelling off at the carrying capacity.'],
  });
}

function lotkaVolterra(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\blotka|\bpredator[- ]prey\b|\bvolterra\b/.test(lc)) return null;
  const a = param(input, ['alpha', 'α', 'a', 'prey growth'], 1.1)!;
  const b = param(input, ['beta', 'β', 'b', 'predation rate'], 0.4)!;
  const g = param(input, ['gamma', 'γ', 'c', 'predator death'], 0.4)!;
  const d = param(input, ['delta', 'δ', 'd', 'predator growth'], 0.1)!;
  const x0 = param(input, ['x0', 'prey0', 'prey', 'x_0'], 10)!;
  const y0 = param(input, ['y0', 'predators0', 'predators', 'predator', 'y_0'], 10)!;
  const T = param(input, ['t', 'time', 'for', 'days', 'years'], 50)!;
  const run = rk4((_, [x, y]) => [a * x! - b * x! * y!, d * x! * y! - g * y!], [x0, y0], T, Math.min(0.01, T / 5000));
  const xs = run.y.map((r) => r[0]!);
  const ys = run.y.map((r) => r[1]!);
  const peaks = xs.map((v, i) => (i > 0 && i < xs.length - 1 && v > xs[i - 1]! && v >= xs[i + 1]! ? run.t[i]! : NaN)).filter((v) => !Number.isNaN(v));
  const period = peaks.length >= 2 ? (peaks[peaks.length - 1]! - peaks[0]!) / (peaks.length - 1) : NaN;
  const V = (x: number, y: number) => d * x - g * Math.log(x) + b * y - a * Math.log(y);
  const drift = Math.abs(V(xs[xs.length - 1]!, ys[ys.length - 1]!) - V(x0, y0));
  return answer(input, 'model', `Lotka–Volterra · α = ${fmt(a)}, β = ${fmt(b)}, γ = ${fmt(g)}, δ = ${fmt(d)}, x₀ = ${fmt(x0)}, y₀ = ${fmt(y0)}`, `equilibrium (${fmt(g / d, 6)}, ${fmt(a / b, 6)}), period ≈ ${fmt(period, 4)}`, {
    lines: [
      { label: 'Coexistence equilibrium', display: `x* = γ/δ = ${fmt(g / d, 6)}, y* = α/β = ${fmt(a / b, 6)}` },
      { label: 'Prey range', display: `${fmt(Math.min(...xs), 6)} to ${fmt(Math.max(...xs), 6)}` },
      { label: 'Predator range', display: `${fmt(Math.min(...ys), 6)} to ${fmt(Math.max(...ys), 6)}` },
      { label: 'Cycle period (simulated)', display: Number.isFinite(period) ? fmt(period, 6) : 'not a full cycle in this time' },
      { label: 'Small-oscillation period 2π/√(αγ)', display: fmt((2 * Math.PI) / Math.sqrt(a * g), 6) },
      { label: 'Conserved quantity drift', display: fmt(drift, 3) },
    ],
    table: { columns: ['t', 'prey x', 'predators y'], rows: sampleRows(run.t, run.y, Math.max(1, T / 20), (r) => [fmt(r[0]!, 6), fmt(r[1]!, 6)]), caption: 'RK4 trajectory' },
    notes: ['x′ = αx − βxy, y′ = δxy − γy. Orbits are closed: V = δx − γ ln x + βy − α ln y is conserved, so populations cycle forever.'],
    exactness: 'numeric',
  });
}

function exponentialModel(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:malthus\w*|exponential (?:growth|decay) model)\b/.test(lc)) return null;
  const r = param(input, ['r', 'rate', 'k']);
  const P0 = param(input, ['P0', 'N0', 'initial']);
  const t = param(input, ['t', 'time', 'after']);
  if (r === undefined || P0 === undefined || t === undefined) refuse('Give r, P0 and t');
  const P = P0! * Math.exp(r! * t!);
  return answer(input, 'model', `Exponential model P = P₀e^(rt) · r = ${fmt(r!)}, P₀ = ${fmt(P0!)}`, `P(${fmt(t!)}) = ${fmt(P, 8)}`, { value: P, lines: [{ label: r! > 0 ? 'Doubling time ln2/r' : 'Half-life ln2/|r|', display: fmt(Math.LN2 / Math.abs(r!), 6) }] });
}

export const modelHandlers = [epidemic, logistic, lotkaVolterra, exponentialModel];
