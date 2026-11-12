// Smaller topics: fuzzy logic, chaos (logistic map, Lyapunov exponents, bifurcations), fractals (Mandelbrot test,
// similarity/box-counting dimensions), elementary cellular automata, Big-O and the master theorem, Euler
// characteristic/genus, knot facts, Ramsey numbers, Nim.
import { answer, fmt, numbers, param, refuse, type Line, type Result } from './util';

// ─── Fuzzy logic ───

function fuzzy(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bfuzzy\b/.test(lc)) return null;
  const sets = [...input.matchAll(/\b([A-Z])\s*=\s*\{([^}]+)\}/g)].map((m) => ({ name: m[1]!, mem: parseFuzzy(m[2]!) }));
  if (sets.length) {
    const [A, B] = [sets[0]!, sets[1]];
    const keys = [...new Set([...A.mem.keys(), ...(B ? B.mem.keys() : [])])];
    const a = (k: string) => A.mem.get(k) ?? 0;
    const b = (k: string) => B?.mem.get(k) ?? 0;
    const tnorm = /\bproduct\b|\balgebraic\b/.test(lc) ? 'product' : /\blukasiewicz|łukasiewicz|bounded\b/.test(lc) ? 'lukasiewicz' : 'min';
    const and = (x: number, y: number) => (tnorm === 'product' ? x * y : tnorm === 'lukasiewicz' ? Math.max(0, x + y - 1) : Math.min(x, y));
    const or = (x: number, y: number) => (tnorm === 'product' ? x + y - x * y : tnorm === 'lukasiewicz' ? Math.min(1, x + y) : Math.max(x, y));
    const set = (f: (k: string) => number) => `{${keys.map((k) => `${k}/${fmt(f(k), 4)}`).join(', ')}}`;
    const lines: Line[] = [{ label: `¬${A.name} = 1 − μ`, display: set((k) => 1 - a(k)) }];
    if (B) {
      lines.unshift({ label: `${A.name} ∩ ${B.name}`, display: set((k) => and(a(k), b(k))) }, { label: `${A.name} ∪ ${B.name}`, display: set((k) => or(a(k), b(k))) });
      lines.push({ label: `¬${B.name}`, display: set((k) => 1 - b(k)) });
    }
    const height = Math.max(...keys.map(a));
    const card = keys.reduce((s, k) => s + a(k), 0);
    lines.push({ label: `Height of ${A.name}`, display: fmt(height, 4) }, { label: `Cardinality |${A.name}| = Σμ`, display: fmt(card, 6) }, { label: `Support of ${A.name}`, display: `{${keys.filter((k) => a(k) > 0).join(', ')}}` });
    const alpha = param(input, ['alpha cut', 'α-cut', 'alpha-cut', 'α cut']);
    if (alpha !== undefined) lines.push({ label: `${fmt(alpha)}-cut of ${A.name}`, display: `{${keys.filter((k) => a(k) >= alpha).join(', ')}}` });
    return answer(input, 'fuzzy', `Fuzzy set operations (${tnorm === 'min' ? 'Zadeh min/max' : tnorm === 'product' ? 'product / probabilistic sum' : 'Łukasiewicz'})`, B ? set((k) => and(a(k), b(k))) : set((k) => 1 - a(k)), { lines, notes: ['Zadeh operators: AND = min, OR = max, NOT = 1 − μ. Fuzzy sets violate the law of excluded middle: A ∪ ¬A need not be everything.'] });
  }
  // Scalar truth values: "fuzzy and 0.7 0.4".
  const op = /\b(and|or|not|implies|implication|nand|nor|xor)\b/.exec(lc)?.[1];
  const v = numbers(input);
  if (!op || !v.length || v.some((x) => x < 0 || x > 1)) refuse('Try “fuzzy and 0.7 0.4” or “fuzzy A={x1:0.2, x2:0.7} B={x1:0.5, x2:0.3}”');
  const [x, y = 0] = v as [number, number?];
  const rows: [string, number][] =
    op === 'not'
      ? [['1 − a', 1 - x]]
      : op === 'and'
        ? [['min (Zadeh)', Math.min(x, y!)], ['product', x * y!], ['Łukasiewicz max(0, a+b−1)', Math.max(0, x + y! - 1)]]
        : op === 'or'
          ? [['max (Zadeh)', Math.max(x, y!)], ['probabilistic sum a+b−ab', x + y! - x * y!], ['Łukasiewicz min(1, a+b)', Math.min(1, x + y!)]]
          : op === 'implies' || op === 'implication'
            ? [['Łukasiewicz min(1, 1−a+b)', Math.min(1, 1 - x + y!)], ['Kleene–Dienes max(1−a, b)', Math.max(1 - x, y!)], ['Gödel (1 if a≤b else b)', x <= y! ? 1 : y!]]
            : op === 'xor'
              ? [['max(min(a,1−b), min(1−a,b))', Math.max(Math.min(x, 1 - y!), Math.min(1 - x, y!))]]
              : op === 'nand'
                ? [['1 − min', 1 - Math.min(x, y!)]]
                : [['1 − max', 1 - Math.max(x, y!)]];
  return answer(input, 'fuzzy', `Fuzzy ${op!.toUpperCase()} of ${v.slice(0, op === 'not' ? 1 : 2).map((t) => fmt(t)).join(' and ')}`, fmt(rows[0]![1], 6), { value: rows[0]![1], lines: rows.map(([l, val]) => ({ label: l, display: fmt(val, 6) })) });
}

function parseFuzzy(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of s.split(',')) {
    const mm = /^\s*([^:/]+?)\s*[:/]\s*([\d.]+)\s*$/.exec(p) ?? /^\s*([\d.]+)\s*\/\s*([^\s]+)\s*$/.exec(p);
    if (!mm) continue;
    if (/^[\d.]+$/.test(mm[1]!) && !/^[\d.]+$/.test(mm[2]!)) m.set(mm[2]!, Number(mm[1]));
    else m.set(mm[1]!, Number(mm[2]));
  }
  return m;
}

// ─── Chaos ───

function logisticMap(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\blogistic map\b|\blyapunov\b|\bbifurcation\b|\bfeigenbaum\b|\bperiod[- ]doubling\b/.test(lc)) return null;
  if (/\bbifurcation points?\b|\bfeigenbaum\b|\bperiod[- ]doubling\b/.test(lc) && param(input, ['r', 'mu', 'μ', 'lambda']) === undefined) {
    const pts = [[1, 'fixed point x* = 1 − 1/r becomes non-zero (transcritical)'], [3, 'period 2 begins'], [3.449490, 'period 4 (1 + √6)'], [3.544090, 'period 8'], [3.564407, 'period 16'], [3.568759, 'period 32'], [3.569946, 'onset of chaos r∞ (accumulation point)'], [3.828427, 'period-3 window (1 + √8)'], [4, 'fully chaotic on [0, 1]']] as const;
    return answer(input, 'chaos', 'Bifurcation points of the logistic map xₙ₊₁ = r·xₙ(1 − xₙ)', 'r = 3, 3.4495, 3.5441, … → 3.56995', {
      table: { columns: ['r', 'event'], rows: pts.map(([r, e]) => [fmt(r, 7), e]) },
      lines: [{ label: 'Feigenbaum δ', display: '4.669201609… = lim (rₙ − rₙ₋₁)/(rₙ₊₁ − rₙ)' }, { label: 'Feigenbaum α', display: '2.502907875…' }],
      notes: ['The ratios of successive period-doubling intervals converge to δ for every smooth one-hump map (universality).'],
    });
  }
  const r = param(input, ['r', 'mu', 'μ', 'lambda', 'λ']);
  if (r === undefined) refuse('Give r, e.g. “logistic map r=3.2 x0=0.5 10 iterations”');
  const x0 = param(input, ['x0', 'x_0', 'x₀', 'start', 'starting at'], 0.5)!;
  const n = Math.min(500, param(input, ['iterations', 'n', 'steps'], undefined) ?? (/\b(\d+)\s+(?:iterations|iterates|steps)\b/i.exec(input) ? Number(/\b(\d+)\s+(?:iterations|iterates|steps)\b/i.exec(input)![1]) : 20));
  const xs = [x0];
  for (let i = 0; i < n; i++) xs.push(r! * xs[i]! * (1 - xs[i]!));
  // Lyapunov exponent: average of ln|r(1 − 2x)| after a transient.
  let x = x0;
  for (let i = 0; i < 1000; i++) x = r! * x * (1 - x);
  let lyap = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) {
    lyap += Math.log(Math.abs(r! * (1 - 2 * x)) || 1e-300);
    x = r! * x * (1 - x);
  }
  lyap /= N;
  // Attractor period.
  const orbit: number[] = [];
  for (let i = 0; i < 64; i++) (x = r! * x * (1 - x)), orbit.push(x);
  let period = 0;
  for (let p = 1; p <= 32; p++)
    if (orbit.slice(0, 32).every((v, i) => Math.abs(v - orbit[i + p]!) < 1e-6)) {
      period = p;
      break;
    }
  const behaviour = r! < 0 || r! > 4 ? 'escapes [0, 1]' : period ? (period === 1 ? `converges to the fixed point ${fmt(orbit[0]!, 8)}` : `period-${period} cycle: ${orbit.slice(0, period).map((v) => fmt(v, 6)).join(', ')}`) : lyap > 0 ? 'chaotic (positive Lyapunov exponent)' : 'aperiodic / very slow convergence';
  const wantLyap = /\blyapunov\b/.test(lc);
  return answer(input, 'chaos', `Logistic map xₙ₊₁ = ${fmt(r!)}·xₙ(1 − xₙ), x₀ = ${fmt(x0)}`, wantLyap ? `λ ≈ ${fmt(lyap, 6)}` : behaviour, {
    value: wantLyap ? lyap : xs[n],
    lines: [
      { label: 'Long-run behaviour', display: behaviour },
      { label: 'Lyapunov exponent', display: `${fmt(lyap, 6)} (${lyap > 0 ? 'chaotic' : 'stable'})` },
      { label: 'Fixed points', display: `0 and ${fmt(1 - 1 / r!, 8)} (stable when |2 − r| < 1, i.e. 1 < r < 3)` },
      { label: `x${n}`, display: fmt(xs[n]!, 10) },
    ],
    table: { columns: ['n', 'xₙ'], rows: xs.map((v, i) => [String(i), fmt(v, 10)]) },
    notes: ['λ = lim (1/N) Σ ln|f′(xₙ)| with f′(x) = r(1 − 2x), estimated over 100,000 iterates after a transient. At r = 4, λ = ln 2.'],
  });
}

function mandelbrot(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bmandelbrot\b|\bjulia set\b/.test(lc)) return null;
  const m = /([-−]?[\d.]+)\s*([+−-])\s*([\d.]*)\s*i\b/.exec(input) ?? null;
  let re: number;
  let im: number;
  if (m) {
    re = Number(m[1]!.replace('−', '-'));
    im = (m[2] === '+' ? 1 : -1) * (m[3] ? Number(m[3]) : 1);
  } else {
    const n = numbers(input.replace(/\bjulia set\b.*?\bc\s*=\s*[-−\d.+i\s]+/i, ''));
    if (/\bi\b/.test(input) && n.length === 1 && /[-−]?[\d.]*\s*i\b/.test(input)) [re, im] = [0, n[0]!];
    else if (n.length >= 2) [re, im] = [n[0]!, n[1]!];
    else if (n.length === 1) [re, im] = [n[0]!, 0];
    else return refuse('Give a point, e.g. “is -1 + 0i in the mandelbrot set”');
  }
  const maxIt = 1000;
  let zr = 0;
  let zi = 0;
  let k = 0;
  const rows: string[][] = [];
  for (; k < maxIt; k++) {
    if (k < 12) rows.push([String(k), `${fmt(zr, 8)} ${zi < 0 ? '−' : '+'} ${fmt(Math.abs(zi), 8)}i`, fmt(Math.hypot(zr, zi), 8)]);
    if (zr * zr + zi * zi > 4) break;
    [zr, zi] = [zr * zr - zi * zi + re, 2 * zr * zi + im];
  }
  const inside = k === maxIt;
  // Exact tests for the main cardioid and period-2 bulb.
  const q = (re - 0.25) ** 2 + im * im;
  const cardioid = q * (q + (re - 0.25)) <= 0.25 * im * im;
  const bulb = (re + 1) ** 2 + im * im <= 1 / 16;
  return answer(input, 'fractal', `Mandelbrot membership of c = ${fmt(re)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im))}i`, inside ? 'in the set (bounded)' : `not in the set (escapes after ${k} iterations)`, {
    lines: [
      { label: 'Iteration', display: 'z₀ = 0, zₙ₊₁ = zₙ² + c' },
      { label: 'Escape test', display: `|z| > 2 ⇒ diverges; ${inside ? `|z| ≤ 2 for ${maxIt} iterations` : `|z${k}| = ${fmt(Math.hypot(zr, zi), 6)}`}` },
      ...(cardioid ? [{ label: 'Region', display: 'main cardioid (proved in the set)' }] : bulb ? [{ label: 'Region', display: 'period-2 bulb (proved in the set)' }] : []),
    ],
    table: { columns: ['n', 'zₙ', '|zₙ|'], rows },
    notes: inside && !cardioid && !bulb ? [`“In the set” here means it stayed bounded for ${maxIt} iterations; points near the boundary can escape later.`] : [],
  });
}

const FRACTALS: [RegExp, string, number, string][] = [
  [/\bcantor\b/i, 'Cantor set', Math.log(2) / Math.log(3), '2 copies at scale 1/3: log 2 / log 3'],
  [/\bkoch\b/i, 'Koch curve/snowflake', Math.log(4) / Math.log(3), '4 copies at scale 1/3: log 4 / log 3'],
  [/\bsierpinski (?:carpet|square)\b/i, 'Sierpiński carpet', Math.log(8) / Math.log(3), '8 copies at scale 1/3: log 8 / log 3'],
  [/\bsierpinski\b|\bsierpiński\b/i, 'Sierpiński triangle', Math.log(3) / Math.log(2), '3 copies at scale 1/2: log 3 / log 2'],
  [/\bmenger\b/i, 'Menger sponge', Math.log(20) / Math.log(3), '20 copies at scale 1/3: log 20 / log 3'],
  [/\bdragon curve\b|\bheighway\b/i, 'Heighway dragon (boundary has dimension ≈ 1.5236; the curve fills area)', 2, '2 copies at scale 1/√2: log 2 / log √2'],
  [/\bvicsek\b/i, 'Vicsek fractal', Math.log(5) / Math.log(3), '5 copies at scale 1/3: log 5 / log 3'],
  [/\bhilbert curve\b|\bpeano curve\b/i, 'Space-filling curve (Hilbert/Peano)', 2, 'fills the square: dimension 2'],
  [/\bmandelbrot boundary\b/i, 'Boundary of the Mandelbrot set', 2, 'Shishikura (1998): Hausdorff dimension 2'],
  [/\bcoastline of britain\b|\bbritain coastline\b/i, 'Coastline of Britain (Richardson/Mandelbrot)', 1.25, 'empirical box-counting estimate ≈ 1.25'],
];

function fractalDimension(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:fractal|hausdorff|box[- ]counting|similarity|self[- ]similar\w*|minkowski) dimension\b|\bdimension of (?:the )?(?:cantor|koch|sierpi|menger|dragon|vicsek|hilbert|peano|mandelbrot|coastline)/.test(lc)) return null;
  const custom = /\b(\d+)\s+(?:copies|pieces|parts)\b.*?\b(?:scale(?:d)?(?: factor)?|ratio|by)\s*(?:of\s*)?(?:1\s*\/\s*)?([\d.]+)/i.exec(input);
  if (custom) {
    const N = Number(custom[1]);
    let s = Number(custom[2]);
    if (s < 1) s = 1 / s;
    const D = Math.log(N) / Math.log(s);
    return answer(input, 'fractal', `Similarity dimension: ${N} copies, each scaled by 1/${fmt(s)}`, `D = ${fmt(D, 8)}`, { value: D, lines: [{ label: 'Formula', display: `D = log N / log(1/r) = log ${N} / log ${fmt(s)}` }] });
  }
  const boxes = /\bbox[- ]counting\b/.test(lc) ? [...input.matchAll(/\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const) : [];
  if (boxes.length >= 2) {
    // Least-squares slope of log N vs log(1/ε).
    const X = boxes.map(([e]) => Math.log(1 / e));
    const Y = boxes.map(([, n]) => Math.log(n));
    const mx = X.reduce((a, b) => a + b, 0) / X.length;
    const my = Y.reduce((a, b) => a + b, 0) / Y.length;
    const slope = X.reduce((s, x, i) => s + (x - mx) * (Y[i]! - my), 0) / X.reduce((s, x) => s + (x - mx) ** 2, 0);
    return answer(input, 'fractal', `Box-counting dimension from ${boxes.length} (ε, N) pairs`, `D ≈ ${fmt(slope, 6)}`, { value: slope, table: { columns: ['ε', 'N(ε)', 'log(1/ε)', 'log N'], rows: boxes.map(([e, n], i) => [fmt(e), fmt(n), fmt(X[i]!, 6), fmt(Y[i]!, 6)]) }, notes: ['D = slope of log N(ε) against log(1/ε) (least squares).'] });
  }
  const f = FRACTALS.find(([re]) => re.test(input));
  if (!f) refuse('Name a standard fractal (Cantor, Koch, Sierpiński, Menger…) or give “N copies scaled by r”');
  return answer(input, 'fractal', `Fractal dimension of the ${f![1]}`, `D = ${fmt(f![2], 8)}`, { value: f![2], lines: [{ label: 'Reason', display: f![3] }], notes: ['For exactly self-similar fractals, the box-counting, Hausdorff and similarity dimensions agree.'] });
}

// ─── Cellular automata ───

function cellular(input: string): Result {
  const lc = input.toLowerCase();
  const m = /\brule\s*(\d{1,3})\b/.exec(lc);
  if (!m || !/\bcellular|automat\w*|rule\s*\d+\s*(?:from|starting|with|for|generations|steps|\d)|wolfram\b/.test(lc)) return null;
  const rule = Number(m[1]);
  if (rule > 255) refuse('Elementary rules are numbered 0–255');
  const gens = Math.min(64, param(input, ['generations', 'steps', 'gens', 'rows'], undefined) ?? (/\b(\d+)\s+(?:generations|steps|rows)\b/.exec(lc) ? Number(/\b(\d+)\s+(?:generations|steps|rows)\b/.exec(lc)![1]) : 8));
  const startM = /\b(?:from|starting(?: with)?|initial(?: state)?|start)\s*:?\s*([01]{3,})\b/.exec(lc);
  const width = startM ? startM[1]!.length : 2 * gens + 1;
  let row = startM ? [...startM[1]!].map(Number) : Array.from({ length: width }, (_, i) => (i === gens ? 1 : 0));
  const table = [...Array(8)].map((_, k) => [(7 - k).toString(2).padStart(3, '0'), String((rule >> (7 - k)) & 1)]);
  const out: string[] = [];
  for (let g = 0; g <= gens; g++) {
    out.push(row.map((c) => (c ? '█' : '·')).join(''));
    row = row.map((_, i) => {
      const l = row[(i - 1 + width) % width]!;
      const c = row[i]!;
      const r = row[(i + 1) % width]!;
      return (rule >> ((l << 2) | (c << 1) | r)) & 1;
    });
  }
  const cls: Record<number, string> = { 30: 'class 3 (chaotic); used as a random number generator', 90: 'class 3; draws the Sierpiński triangle (XOR of neighbours)', 110: 'class 4 (complex); proven Turing-complete (Cook, 2004)', 184: 'traffic-flow model; conserves the number of 1s', 0: 'everything dies', 255: 'everything lives' };
  return answer(input, 'automaton', `Elementary cellular automaton rule ${rule} · ${gens} generations`, `rule ${rule} = ${rule.toString(2).padStart(8, '0')}₂`, {
    lines: [{ label: 'Evolution', display: out.join('\n') }, ...(cls[rule] ? [{ label: 'Known for', display: cls[rule]! }] : [])],
    table: { columns: ['neighbourhood', 'new cell'], rows: table, caption: 'Rule table (Wolfram code: bit k = output for neighbourhood k)' },
    notes: [startM ? 'Wraps around at the edges.' : 'Starts from a single live cell; wraps around at the edges.'],
  });
}

function gameOfLife(input: string): Result {
  if (!/\bgame of life\b|\bconway'?s? life\b/i.test(input)) return null;
  const known: Record<string, string> = {
    glider: 'Glider: 5 cells, period 4, moves one cell diagonally every 4 generations (speed c/4).',
    blinker: 'Blinker: 3 cells in a row, oscillator with period 2.',
    block: 'Block: 2×2 still life.',
    beehive: 'Beehive: 6-cell still life.',
    toad: 'Toad: 6-cell oscillator with period 2.',
    beacon: 'Beacon: 6-cell oscillator with period 2.',
    pulsar: 'Pulsar: 48-cell oscillator with period 3.',
    'gosper glider gun': 'Gosper glider gun: emits a glider every 30 generations; the first known finite pattern with unbounded growth (1970).',
    'r-pentomino': 'R-pentomino: 5 cells that take 1103 generations to stabilise.',
  };
  const k = Object.keys(known).find((n) => input.toLowerCase().includes(n));
  return answer(input, 'automaton', 'Conway’s Game of Life', k ? k : 'B3/S23', { lines: [{ label: 'Rules', display: 'A dead cell with exactly 3 live neighbours is born; a live cell with 2 or 3 survives; all others die.' }, ...(k ? [{ label: k, display: known[k]! }] : [])], notes: ['Life is Turing-complete.'] });
}

// ─── Complexity ───

const GROWTH: [RegExp, string, (n: number) => number][] = [
  [/^(?:1|constant)$/, '1', () => 1],
  [/^(?:log\s*\(?\s*log\s*n\s*\)?)$/, 'log log n', (n) => Math.log2(Math.log2(n))],
  [/^(?:log\s*n|lg\s*n|ln\s*n|log2\s*n|logn)$/, 'log n', (n) => Math.log2(n)],
  [/^(?:sqrt\s*\(?\s*n\s*\)?|√n|n\^\(?1\/2\)?|n\^0\.5)$/, '√n', (n) => Math.sqrt(n)],
  [/^n$/, 'n', (n) => n],
  [/^(?:n\s*\*?\s*log\s*n|n\s*lg\s*n|nlogn|n log n)$/, 'n log n', (n) => n * Math.log2(n)],
  [/^n\^?\s*\(?(\d+(?:\.\d+)?)\)?$|^n²$|^n³$/, 'n^k', (n) => n],
  [/^(\d+(?:\.\d+)?)\^n$/, 'c^n', (n) => n],
  [/^n!$|^factorial$/, 'n!', (n) => n],
  [/^n\^n$/, 'n^n', (n) => n],
];

function growthRank(t: string): { label: string; logf: (n: number) => number } | null {
  const s = t.trim().toLowerCase().replace(/^o\s*\(\s*(.+)\s*\)$/, '$1').replace(/\s+/g, ' ');
  if (/^n\^n$/.test(s)) return { label: 'n^n', logf: (n) => n * Math.log(n) };
  if (/^n!$|^factorial$/.test(s)) return { label: 'n!', logf: (n) => lgamma(n + 1) };
  let m = /^(\d+(?:\.\d+)?)\^n$/.exec(s);
  if (m) return { label: `${m[1]}^n`, logf: (n) => n * Math.log(Number(m![1])) };
  m = /^n\^?\s*\(?(\d+(?:\.\d+)?)\)?$/.exec(s.replace('²', '^2').replace('³', '^3'));
  if (m) return { label: `n^${m[1]}`, logf: (n) => Number(m![1]) * Math.log(n) };
  m = /^n\^?\s*\(?(\d+(?:\.\d+)?)\)?\s*\*?\s*log\s*n$/.exec(s.replace('²', '^2'));
  if (m) return { label: `n^${m[1]} log n`, logf: (n) => Number(m![1]) * Math.log(n) + Math.log(Math.log2(n)) };
  for (const [re, label, f] of GROWTH) if (re.test(s) && label !== 'n^k' && label !== 'c^n') return { label, logf: (n) => Math.log(f(n)) };
  return null;
}
function lgamma(x: number): number {
  // Stirling with corrections; fine for x ≥ 2.
  if (x < 7) {
    let p = 1;
    for (let i = 2; i < x; i++) p *= i;
    return Math.log(p);
  }
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x) - 1 / (360 * x ** 3);
}

function bigO(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bbig[- ]?o\b|\bgrowth rates?\b|\bgrows faster\b|\basymptotic(?:ally)? (?:compar|grow|order)/.test(lc) && !/\bo\(\s*[^)]+\)\s*(?:vs|versus|or|and|,)\s*o\(/i.test(lc)) return null;
  if (/\bmaster theorem\b|\bt\s*\(\s*n\s*\)\s*=/.test(lc)) return null;
  const terms = (input.match(/O\s*\(([^)]*\)?)\)/gi) ?? []).map((t) => t.replace(/^O\s*\(/i, '').replace(/\)$/, ''));
  const list = terms.length >= 2 ? terms : (input.includes(':') ? input.slice(input.lastIndexOf(':') + 1) : input.replace(/^.*?(?:big[- ]?o|growth rates?|compare|order|rank)\s*(?:of)?\s*/i, '')).split(/\s*(?:,|\bvs\.?\b|\bversus\b|\bor\b|\band\b|;)\s*/).filter(Boolean);
  const ranked = list.map((t) => ({ t: t.trim(), g: growthRank(t) })).filter((x) => x.g);
  if (ranked.length < 2) refuse('List the growth rates to compare, e.g. “compare big O: n log n, n^2, 2^n, log n”');
  const N = 1e6;
  ranked.sort((a, b) => a.g!.logf(N) - b.g!.logf(N));
  const sizes = [10, 100, 1000, 1e6];
  return answer(input, 'complexity', 'Growth-rate comparison (slowest to fastest)', ranked.map((r) => `O(${r.g!.label})`).join(' < '), {
    table: { columns: ['growth', ...sizes.map((n) => `n = ${n >= 1e6 ? '10⁶' : n}`)], rows: ranked.map((r) => [`O(${r.g!.label})`, ...sizes.map((n) => { const l = r.g!.logf(n); return l > 700 ? `≈10^${fmt(l / Math.LN10, 4)}` : fmt(Math.exp(l), 4); })]) },
    notes: ['f = O(g) means f ≤ c·g for all large n. Ordering: constants < logs < powers (any positive power beats any log) < exponentials < n! < nⁿ.'],
  });
}

function masterTheorem(input: string): Result {
  const lc = input.toLowerCase().replace(/\s+/g, ' ');
  const m = /t\s*\(\s*n\s*\)\s*=\s*(\d*)\s*\*?\s*t\s*\(\s*n\s*\/\s*(\d+)\s*\)\s*\+\s*(.+)$/.exec(lc);
  if (!m) return null;
  if (!/\bmaster\b|\bsolve\b|\brecurrence\b|\bcomplexity\b|\bbig[- ]?o\b|t\s*\(\s*n\s*\)/.test(lc)) return null;
  const a = Number(m[1] || 1);
  const b = Number(m[2]);
  const fx = m[3]!.trim().replace(/[.?]$/, '').replace(/^θ\s*\(|^theta\s*\(|^o\s*\(/i, '').replace(/\)$/, '');
  // f(n) = c·n^k·log^p n
  const fm = /^(?:\d+(?:\.\d+)?\s*\*?\s*)?(?:(n)(?:\s*\^\s*\(?(\d+(?:\.\d+)?(?:\/\d+)?)\)?)?)?\s*\*?\s*(?:(log|lg)\s*\^?\s*(\d+)?\s*\(?n\)?)?$|^(\d+(?:\.\d+)?)$|^(?:sqrt\s*\(?\s*n\s*\)?|√n)$/.exec(fx.replace(/\s+/g, ''));
  if (!fm) refuse(`Couldn’t read f(n) = ${fx}; use forms like n, n^2, n log n, 1, sqrt n`);
  let k = 0;
  let p = 0;
  if (/^(?:sqrt|√)/.test(fx)) k = 0.5;
  else if (fm![5] !== undefined) k = 0;
  else {
    if (fm![1]) k = fm![2] ? (fm![2].includes('/') ? Number(fm![2].split('/')[0]) / Number(fm![2].split('/')[1]) : Number(fm![2])) : 1;
    if (fm![3]) p = fm![4] ? Number(fm![4]) : 1;
  }
  const crit = Math.log(a) / Math.log(b);
  const cs = fmt(crit, 6);
  const nk = (e: number, lp: number) => `${e === 0 ? (lp ? '' : '1') : e === 1 ? 'n' : `n^${fmt(e, 6)}`}${lp ? `${e === 0 ? '' : ' '}log${lp > 1 ? `^${lp}` : ''} n` : ''}`;
  let result: string;
  let which: string;
  if (Math.abs(k - crit) < 1e-9) {
    result = `Θ(${nk(k, p + 1)})`;
    which = `Case 2: f(n) = Θ(n^${cs} log^${p} n) matches n^(log_b a), so multiply by one more log`;
  } else if (k < crit) {
    result = `Θ(${nk(crit, 0)})`;
    which = `Case 1: f(n) = O(n^(${cs} − ε)), the leaves dominate`;
  } else {
    result = `Θ(${nk(k, p)})`;
    which = `Case 3: f(n) = Ω(n^(${cs} + ε)) and the regularity condition a·f(n/b) ≤ c·f(n) holds (${fmt(a / b ** k, 4)} < 1), so the root dominates`;
  }
  return answer(input, 'complexity', `Master theorem for T(n) = ${a}T(n/${b}) + ${fx}`, `T(n) = ${result}`, {
    lines: [
      { label: 'a, b, f(n)', display: `${a}, ${b}, ${fx}` },
      { label: 'n^(log_b a)', display: `n^${cs}${Number.isInteger(crit) ? '' : ` (log_${b} ${a} ≈ ${cs})`}` },
      { label: 'Case', display: which },
    ],
    notes: ['Examples: merge sort T(n) = 2T(n/2) + n → Θ(n log n); binary search T(n) = T(n/2) + 1 → Θ(log n); Strassen T(n) = 7T(n/2) + n² → Θ(n^2.807).'],
  });
}

// ─── Topology ───

const SURFACES: [RegExp, string, number, string][] = [
  [/\bsphere\b/i, 'sphere', 2, 'genus 0, orientable'],
  [/\btorus\b|\bdonut\b|\bdoughnut\b/i, 'torus', 0, 'genus 1, orientable'],
  [/\bdouble torus\b|\bgenus[- ]2\b/i, 'double torus', -2, 'genus 2, orientable'],
  [/\bprojective plane\b|\brp2\b|\brp²\b/i, 'real projective plane', 1, 'non-orientable genus 1'],
  [/\bklein bottle\b/i, 'Klein bottle', 0, 'non-orientable genus 2'],
  [/\bm[oö]bius (?:strip|band)\b/i, 'Möbius strip', 0, 'non-orientable, one boundary circle'],
  [/\bdisk\b|\bdisc\b/i, 'disk', 1, 'contractible, one boundary circle'],
  [/\bcylinder\b|\bannulus\b/i, 'cylinder/annulus', 0, 'orientable, two boundary circles'],
  [/\bcircle\b/i, 'circle', 0, '1-dimensional'],
  [/\bpoint\b/i, 'point', 1, '0-dimensional'],
];
const SOLIDS: Record<string, [number, number, number]> = { tetrahedron: [4, 6, 4], cube: [8, 12, 6], hexahedron: [8, 12, 6], octahedron: [6, 12, 8], dodecahedron: [20, 30, 12], icosahedron: [12, 30, 20], 'square pyramid': [5, 8, 5], 'triangular prism': [6, 9, 5], 'pentagonal prism': [10, 15, 7], 'hexagonal prism': [12, 18, 8], 'truncated icosahedron': [60, 90, 32], 'soccer ball': [60, 90, 32] };

function topology(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\beuler characteristic\b|\bv\s*-\s*e\s*\+\s*f\b|\bgenus\b|\bχ\b/.test(lc)) return null;
  const V = param(input, ['V', 'vertices']);
  const E = param(input, ['E', 'edges']);
  const F = param(input, ['F', 'faces']);
  if (V !== undefined && E !== undefined && F !== undefined) {
    const chi = V - E + F;
    const genus = (2 - chi) / 2;
    return answer(input, 'topology', `Euler characteristic with V = ${V}, E = ${E}, F = ${F}`, `χ = ${chi}`, { value: chi, lines: [{ label: 'χ = V − E + F', display: `${V} − ${E} + ${F} = ${chi}` }, { label: 'Genus (closed orientable surface)', display: Number.isInteger(genus) && genus >= 0 ? `g = (2 − χ)/2 = ${genus}` : 'not a closed orientable surface' }], notes: ['Every convex polyhedron has χ = 2 (Euler’s polyhedron formula).'] });
  }
  const gm = /\bgenus\s*(?:of\s*)?(?:g\s*=\s*)?(\d+)\b/.exec(lc);
  const cm = /\b(?:χ|chi|euler characteristic)\s*(?:=|of|is)\s*(-?\d+)\b/.exec(lc);
  if (cm && /\bgenus\b/.test(lc)) {
    const chi = Number(cm[1]);
    const nonOr = /\bnon-?orientable\b/.test(lc);
    const g = nonOr ? 2 - chi : (2 - chi) / 2;
    return answer(input, 'topology', `Genus from Euler characteristic χ = ${chi}${nonOr ? ' (non-orientable)' : ''}`, Number.isInteger(g) && g >= 0 ? `g = ${g}` : 'impossible', { lines: [{ label: 'Formula', display: nonOr ? 'χ = 2 − k (k cross-caps)' : 'χ = 2 − 2g' }] });
  }
  if (gm && !/\btorus|sphere|klein|plane|strip\b/.test(lc)) {
    const g = Number(gm[1]);
    const nonOr = /\bnon-?orientable\b/.test(lc);
    const chi = nonOr ? 2 - g : 2 - 2 * g;
    return answer(input, 'topology', `Euler characteristic of a ${nonOr ? 'non-orientable' : 'closed orientable'} surface of genus ${g}`, `χ = ${chi}`, { value: chi, lines: [{ label: 'Formula', display: nonOr ? 'χ = 2 − g' : 'χ = 2 − 2g' }] });
  }
  const solid = Object.keys(SOLIDS).sort((a, b) => b.length - a.length).find((s) => lc.includes(s));
  if (solid) {
    const [v, e, f] = SOLIDS[solid]!;
    return answer(input, 'topology', `Euler characteristic of a ${solid}`, `χ = ${v - e + f}`, { value: v - e + f, lines: [{ label: 'V − E + F', display: `${v} − ${e} + ${f} = ${v - e + f}` }] });
  }
  const s = SURFACES.find(([re]) => re.test(input));
  if (s) return answer(input, 'topology', `Euler characteristic of the ${s[1]}`, `χ = ${s[2]}`, { value: s[2], lines: [{ label: 'Type', display: s[3] }], notes: ['χ is a topological invariant: any triangulation of the surface gives the same V − E + F.'] });
  return refuse('Give V, E and F, a genus, or a surface name (sphere, torus, Klein bottle…)');
}

const KNOTS: Record<string, { name: string; cross: number; facts: string }> = {
  unknot: { name: 'Unknot (0₁)', cross: 0, facts: 'trivial knot; Alexander polynomial 1; unknotting number 0' },
  trefoil: { name: 'Trefoil (3₁)', cross: 3, facts: 'chiral; tricolorable; Alexander polynomial t − 1 + t⁻¹; Jones polynomial t + t³ − t⁴ (right-handed); unknotting number 1; genus 1; the (2,3) torus knot' },
  'figure-eight': { name: 'Figure-eight (4₁)', cross: 4, facts: 'amphichiral; not tricolorable; Alexander polynomial −t + 3 − t⁻¹; unknotting number 1; hyperbolic volume 2.0299' },
  'figure eight': { name: 'Figure-eight (4₁)', cross: 4, facts: 'amphichiral; not tricolorable; Alexander polynomial −t + 3 − t⁻¹; unknotting number 1; hyperbolic volume 2.0299' },
  cinquefoil: { name: 'Cinquefoil (5₁)', cross: 5, facts: 'the (2,5) torus knot; Alexander polynomial t² − t + 1 − t⁻¹ + t⁻²; unknotting number 2' },
  'three-twist': { name: 'Three-twist knot (5₂)', cross: 5, facts: 'twist knot; Alexander polynomial 2t − 3 + 2t⁻¹; unknotting number 1' },
  stevedore: { name: 'Stevedore knot (6₁)', cross: 6, facts: 'slice knot; Alexander polynomial −2t + 5 − 2t⁻¹' },
};

function knots(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bknot\b|\btrefoil\b|\bunknot\b|\bcinquefoil\b/.test(lc)) return null;
  if (/\bknots?\b.*\b(?:speed|nautical|mph|km)\b|\bknots? (?:to|in)\b/.test(lc)) return null;
  const k = Object.keys(KNOTS).find((n) => lc.includes(n));
  if (k) {
    const d = KNOTS[k]!;
    return answer(input, 'topology', d.name, `crossing number ${d.cross}`, { value: d.cross, lines: [{ label: 'Facts', display: d.facts }] });
  }
  if (/\bhow many knots\b|\bnumber of (?:prime )?knots\b/.test(lc)) {
    const n = numbers(input)[0];
    const counts = [0, 0, 0, 1, 1, 2, 3, 7, 21, 49, 165, 552, 2176, 9988, 46972, 253293, 1388705];
    if (n === undefined || n > 16) refuse('Prime knot counts are tabulated up to 16 crossings');
    return answer(input, 'topology', `Prime knots with ${n} crossings (mirror images not distinguished)`, String(counts[n!] ?? 0), { value: counts[n!] ?? 0, notes: ['OEIS A002863.'] });
  }
  return null;
}

// ─── Ramsey numbers and Nim ───

function ramsey(input: string): Result {
  const m = /\bramsey(?: number)?\s*(?:r\s*)?\(?\s*(\d+)\s*,\s*(\d+)\s*\)?/i.exec(input) ?? /\bR\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(input);
  if (!m) return null;
  let [s, t] = [Number(m[1]), Number(m[2])].sort((a, b) => a - b) as [number, number];
  const exact: Record<string, number> = { '3,3': 6, '3,4': 9, '3,5': 14, '3,6': 18, '3,7': 23, '3,8': 28, '3,9': 36, '4,4': 18, '4,5': 25 };
  const bounds: Record<string, string> = { '3,10': '40–41', '4,6': '36–40', '5,5': '43–46', '4,7': '49–59', '5,6': '58–87', '6,6': '102–165' };
  const key = `${s},${t}`;
  if (s === 1) return answer(input, 'combinatorics', `Ramsey number R(1, ${t})`, '1', { value: 1 });
  if (s === 2) return answer(input, 'combinatorics', `Ramsey number R(2, ${t})`, String(t), { value: t, notes: ['R(2, t) = t: colour any edge red and you have a red K₂; otherwise everything is blue.'] });
  if (exact[key]) return answer(input, 'combinatorics', `Ramsey number R(${s}, ${t})`, String(exact[key]), { value: exact[key], notes: [s === 3 && t === 3 ? 'Among any 6 people, 3 are mutual friends or 3 are mutual strangers; 5 is not enough (colour K₅’s pentagon and pentagram differently).' : 'Exact value from the literature (Radziszowski, “Small Ramsey Numbers”, dynamic survey).', ...(key === '4,5' ? ['Proved by McKay and Radziszowski (1995).'] : [])] });
  if (bounds[key]) return answer(input, 'combinatorics', `Ramsey number R(${s}, ${t})`, `unknown: ${bounds[key]}`, { notes: ['Published bounds (Radziszowski’s dynamic survey and later papers; upper bounds may since have improved). The exact value is an open problem.', ...(key === '5,5' ? ['Erdős: if aliens demanded R(5,5) we should marshal all our computers; for R(6,6), attack.'] : [])] });
  const ub = binom(s + t - 2, s - 1);
  return answer(input, 'combinatorics', `Ramsey number R(${s}, ${t})`, `unknown (≤ ${ub})`, { notes: ['Upper bound from Erdős–Szekeres: R(s, t) ≤ C(s + t − 2, s − 1).'] });
}
function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function nim(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bnim\b|\bnim-?sum\b|\bgrundy\b|\bsprague\b/.test(lc)) return null;
  const heaps = numbers(input.replace(/^.*?\b(?:nim|grundy|sprague[- ]grundy)\b/i, '')).map(Math.floor);
  if (!heaps.length) refuse('Give heap sizes, e.g. “nim 3 4 5”');
  const misere = /\bmis[eè]re\b/.test(lc);
  const x = heaps.reduce((a, b) => a ^ b, 0);
  const moves: string[] = [];
  heaps.forEach((h, i) => {
    const t = h ^ x;
    if (t < h) moves.push(`take ${h - t} from heap ${i + 1} (${h} → ${t})`);
  });
  let win = x !== 0;
  let move = moves[0];
  if (misere && heaps.every((h) => h <= 1)) {
    const ones = heaps.filter((h) => h === 1).length;
    win = ones % 2 === 0;
    move = win ? 'take a heap of 1, leaving an odd number of 1-heaps' : undefined;
  } else if (misere && heaps.filter((h) => h > 1).length === 1) {
    const big = heaps.findIndex((h) => h > 1);
    const ones = heaps.filter((h) => h === 1).length;
    const leave = ones % 2 === 0 ? 1 : 0;
    win = true;
    move = `reduce heap ${big + 1} to ${leave}, leaving an odd number of 1-heaps`;
  }
  return answer(input, 'game', `${misere ? 'Misère ' : ''}Nim with heaps ${heaps.join(', ')}`, win ? `first player wins: ${move}` : 'second player wins (P-position)', {
    lines: [
      { label: 'Nim-sum (XOR)', display: `${heaps.join(' ⊕ ')} = ${x} (${heaps.map((h) => h.toString(2)).join(' ⊕ ')} = ${x.toString(2)})` },
      { label: 'Winning moves', display: win ? (misere && move ? move : moves.join('; ')) : 'none: every move hands the opponent a win' },
    ],
    notes: ['Bouton (1901): a Nim position is a loss for the player to move exactly when the XOR of the heap sizes is 0. By Sprague–Grundy, every impartial game is equivalent to a Nim heap.'],
  });
}

export const miscHandlers = [masterTheorem, bigO, fuzzy, logisticMap, mandelbrot, fractalDimension, cellular, gameOfLife, topology, knots, ramsey, nim];
