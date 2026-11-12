// ML model arithmetic: model size / FLOPs / perplexity, backprop, gradient descent, naive Bayes, kNN, k-means,
// PCA, factor analysis, regularisation and ridge regression.
import { g, label, listAfter, ln, matrixAfter, num, runValues, sigmoid, tuples } from './ml-common';
import {
  answer, bad, hashSeed, inv, labelledColumns, matrixOf, mul, mulv, needErr, rng, symEig, T, tableColumns, type Line, type Mat, type PCtx, type PHandler,
} from './util';

const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?';
const SCALE: Record<string, number> = { trillion: 1e12, t: 1e12, billion: 1e9, b: 1e9, bn: 1e9, million: 1e6, m: 1e6, mn: 1e6, thousand: 1e3, k: 1e3 };
const SCALE_RE = '(trillion|billion|million|thousand|bn|mn|t|b|m|k)?';

function scaled(s: string, noun: string): number | null {
  const m = new RegExp(`(${NUM})\\s*${SCALE_RE}\\s*-?\\s*(?:${noun})\\b`).exec(s);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? SCALE[m[2]]! : 1);
}

const big = (x: number) => (x >= 1e6 ? g(x, 6) : g(x, 8));

// ---------- model size, FLOPs, transformer parameters, perplexity ----------

const PRECISION: [RegExp, number, string][] = [
  [/\bfp64\b|\bfloat64\b|\bdouble precision\b/, 8, 'fp64'],
  [/\bfp32\b|\bfloat32\b|\bfull precision\b|\bsingle precision\b|\btf32\b/, 4, 'fp32'],
  [/\bbf16\b|\bbfloat16\b/, 2, 'bf16'],
  [/\bfp16\b|\bfloat16\b|\bhalf precision\b/, 2, 'fp16'],
  [/\bint8\b|\b8-?bits?\b|\bfp8\b|\bq8\b/, 1, 'int8'],
  [/\bint4\b|\b4-?bits?\b|\bnf4\b|\bq4\b|\bfp4\b/, 0.5, 'int4'],
];

const modelArithmetic: PHandler = (c) => {
  const s = c.s;
  const N = scaled(s, 'parameters?|params?');
  // Transformer parameter count from the architecture.
  const layers = Number(/(\d+)\s*(?:layers|transformer blocks|blocks)\b/.exec(s)?.[1] ?? NaN) || num(s, 'layers|n_layers?|num_layers');
  const dModel = num(s, 'd_model|d model|dmodel|hidden size|hidden dim(?:ension)?|model dim(?:ension)?|embedding (?:dim(?:ension)?|size)|d_embed');
  if (/\btransformer\b|\bgpt\b|\blayers\b/.test(s) && layers && dModel && !/\bflops\b/.test(s)) {
    const V = num(s, 'vocab(?:ulary)?(?: size)?|v');
    const core = 12 * layers * dModel * dModel;
    const total = core + (V ?? 0) * dModel;
    return answer(c, {
      expression: `Transformer parameters · ${layers} layers, d_model ${dModel}${V ? `, vocabulary ${V}` : ''}`,
      value: total,
      display: big(total),
      lines: [
        { label: 'Non-embedding (12·L·d²)', display: big(core) },
        ...(V ? [{ label: 'Embedding (V·d)', display: big(V * dModel) }] : []),
        { label: 'Total', display: big(total) },
      ],
      notes: [
        'Per layer: attention 4d² + MLP 8d² (feed-forward width 4d); biases, layer norms and position embeddings left out',
        ...(V ? ['Input and output embeddings tied (counted once)'] : ['No vocabulary size given: embeddings not counted']),
      ],
    });
  }
  if (/\bflops?\b|\bcompute budget\b/.test(s)) {
    if (N === null) return needErr(c, 'How many parameters? (e.g. "7B parameters")');
    const D = scaled(s, 'tokens?');
    const training = /\btrain/.test(s) || (D !== null && !/\binference\b|\bper token\b|\bforward\b/.test(s));
    if (training) {
      if (D === null) return needErr(c, 'How many training tokens? (e.g. "2T tokens")');
      const C = 6 * N * D;
      return answer(c, {
        expression: `Training compute · ${big(N)} parameters × ${big(D)} tokens`,
        value: C,
        lines: [{ label: 'FLOPs', display: g(C, 6) }, { label: 'PF-days', display: g(C / (1e15 * 86400), 6) }],
        notes: ['C ≈ 6·N·D (forward 2N + backward 4N per token; Kaplan et al. 2020); attention FLOPs ignored'],
      });
    }
    const perTok = 2 * N;
    const total = D !== null ? perTok * D : perTok;
    return answer(c, {
      expression: `Inference compute · ${big(N)} parameters${D !== null ? ` × ${big(D)} tokens` : ' per token'}`,
      value: total,
      lines: [{ label: 'FLOPs per token', display: g(perTok, 6) }, ...(D !== null ? [{ label: 'Total FLOPs', display: g(total, 6) }] : [])],
      notes: ['Forward pass ≈ 2·N FLOPs per token (one multiply and one add per weight); attention over the context ignored'],
    });
  }
  const prec = PRECISION.find(([re]) => re.test(s));
  if (N === null || !(prec || /\bmemory\b|\bvram\b|\bram\b|\bgb\b|\bgib\b|\bbytes?\b|\bdisk\b/.test(s))) return null;
  if (!prec) return needErr(c, 'At what precision? (fp32, fp16/bf16, int8 or int4)');
  const [, bytes, name] = prec;
  const total = N * bytes;
  return answer(c, {
    expression: `Model weights in memory · ${big(N)} parameters at ${name} (${bytes} byte${bytes === 1 ? '' : 's'} each)`,
    value: total / 1e9,
    display: `${g(total / 1e9, 6)} GB`,
    lines: [
      { label: 'GB (10⁹ bytes)', display: g(total / 1e9, 6) },
      { label: 'GiB', display: g(total / 2 ** 30, 6) },
      { label: 'Bytes', display: big(total) },
      { label: 'Full training (Adam, mixed precision ≈ 16 B/param)', display: `${g((N * 16) / 1e9, 6)} GB` },
    ],
    notes: ['Weights only: activations, KV cache and framework overhead come on top', 'GB = 10⁹ bytes; GiB = 2³⁰ bytes'],
  });
};

const perplexity: PHandler = (c) => {
  const s = c.s;
  if (!/\bperplexity\b/.test(s)) return null;
  const probs = listAfter(s, 'token probabilities|probabilities|probs');
  if (probs) {
    if (probs.some((p) => !(p > 0 && p <= 1))) bad('Token probabilities must be in (0, 1]');
    const H = -probs.reduce((a, p) => a + ln(p), 0) / probs.length;
    return answer(c, {
      expression: `Perplexity of ${probs.length} token probabilities`,
      value: Math.exp(H),
      lines: [{ label: 'Cross-entropy (nats/token)', display: g(H) }, { label: 'Cross-entropy (bits/token)', display: g(H / Math.LN2) }],
      notes: ['PPL = exp(−(1/N)·Σ ln pᵢ): the inverse geometric mean of the probabilities'],
    });
  }
  const unit = new RegExp(`(${NUM})\\s*(nats?|bits?)\\b`).exec(s);
  const H = unit ? Number(unit[1]) : num(s, 'cross[- ]?entropy|loss|entropy|h');
  if (H === null) return needErr(c, 'Give the cross-entropy (e.g. "perplexity cross entropy 2 nats") or token probabilities');
  const bits = unit ? unit[2]!.startsWith('bit') : /\bbits?\b|\blog ?2\b|\bbase 2\b/.test(s);
  const ppl = bits ? 2 ** H : Math.exp(H);
  const notes = [bits ? 'PPL = 2^H with H in bits' : 'PPL = e^H with H in nats (natural log)'];
  if (!unit && !/\bnats?\b|\bbits?\b/.test(s)) notes.push('Unit not stated: read as nats (the usual training-loss unit); say “bits” for 2^H');
  return answer(c, { expression: `Perplexity from cross-entropy ${label(H)} ${bits ? 'bits' : 'nats'}`, value: ppl, notes });
};

// ---------- backprop ----------

function vecOrScalar(s: string, names: string, n: number): number[] {
  const xs = listAfter(s, names);
  if (!xs) return new Array<number>(n).fill(0);
  if (xs.length === 1) return new Array<number>(n).fill(xs[0]!);
  if (xs.length !== n) bad(`Expected ${n} values for ${names.split('|')[0]}, got ${xs.length}`);
  return xs;
}

const backprop: PHandler = (c) => {
  const s = c.s;
  if (!/\bbackprop\w*\b|\bback-?propagation\b|\bneuron\b|\bperceptron\b/.test(s)) return null;
  const lr = num(s, 'learning rate|lr|eta|η|alpha');
  const W1 = matrixAfter(s, 'hidden weights|hidden layer weights|w1|input-hidden weights');
  const W2 = matrixAfter(s, 'output weights|output layer weights|w2|hidden-output weights');
  if (W1 && W2) {
    const x = listAfter(s, 'inputs?|x');
    const t = listAfter(s, 'targets?|t|y|desired outputs?');
    if (!x || !t) return needErr(c, 'Give the inputs and targets, e.g. "inputs [0.05, 0.1] targets [0.01, 0.99]"');
    const H = W1.length;
    const O = W2.length;
    if (W1[0]!.length !== x.length) bad(`The hidden weights take ${W1[0]!.length} inputs but ${x.length} were given (rows = neurons, columns = inputs)`);
    if (W2[0]!.length !== H) bad(`The output weights take ${W2[0]!.length} inputs but the hidden layer has ${H} neurons`);
    if (t.length !== O) bad(`${O} outputs but ${t.length} targets`);
    const b1 = vecOrScalar(s, 'hidden bias(?:es)?|b1', H);
    const b2 = vecOrScalar(s, 'output bias(?:es)?|b2', O);
    const h = W1.map((r, i) => sigmoid(r.reduce((a, w, j) => a + w * x[j]!, b1[i]!)));
    const o = W2.map((r, i) => sigmoid(r.reduce((a, w, j) => a + w * h[j]!, b2[i]!)));
    const E = o.reduce((a, oi, i) => a + 0.5 * (t[i]! - oi) ** 2, 0);
    const dO = o.map((oi, i) => (oi - t[i]!) * oi * (1 - oi));
    const dH = h.map((hj, j) => W2.reduce((a, r, i) => a + r[j]! * dO[i]!, 0) * hj * (1 - hj));
    const rate = lr ?? 0;
    const nW2 = W2.map((r, i) => r.map((w, j) => w - rate * dO[i]! * h[j]!));
    const nW1 = W1.map((r, i) => r.map((w, j) => w - rate * dH[i]! * x[j]!));
    const lines: Line[] = [
      { label: 'Total error', display: g(E, 9) },
      ...h.map((v, i) => ({ label: `Hidden ${i + 1}`, display: g(v, 9) })),
      ...o.map((v, i) => ({ label: `Output ${i + 1}`, display: g(v, 9) })),
    ];
    if (lr !== null) {
      nW2.forEach((r, i) => r.forEach((w, j) => lines.push({ label: `New output w${i + 1}${j + 1}`, display: g(w, 9) })));
      nW1.forEach((r, i) => r.forEach((w, j) => lines.push({ label: `New hidden w${i + 1}${j + 1}`, display: g(w, 9) })));
      b2.forEach((b, i) => lines.push({ label: `New output bias ${i + 1}`, display: g(b - rate * dO[i]!, 9) }));
      b1.forEach((b, i) => lines.push({ label: `New hidden bias ${i + 1}`, display: g(b - rate * dH[i]!, 9) }));
    }
    return answer(c, {
      expression: `Backpropagation · ${x.length}-${H}-${O} sigmoid network${lr !== null ? `, learning rate ${label(lr)}` : ''}`,
      value: E,
      lines,
      notes: [
        'Sigmoid activations; error E = Σ ½(target − output)²',
        'wᵢⱼ = weight into neuron i from input j (rows = neurons); all gradients use the old weights',
        ...(lr === null ? ['No learning rate given: forward pass and error only'] : []),
      ],
      table: {
        columns: ['Weight', 'Gradient ∂E/∂w', 'New value'],
        rows: [
          ...W2.flatMap((r, i) => r.map((w, j) => [`output w${i + 1}${j + 1} (${label(w)})`, g(dO[i]! * h[j]!, 6), lr !== null ? g(nW2[i]![j]!, 8) : '—'])),
          ...W1.flatMap((r, i) => r.map((w, j) => [`hidden w${i + 1}${j + 1} (${label(w)})`, g(dH[i]! * x[j]!, 6), lr !== null ? g(nW1[i]![j]!, 8) : '—'])),
        ],
      },
    });
  }
  if (!/\bneuron\b|\bperceptron\b|\bunit\b|\bsingle\b/.test(s)) return null;
  const x = listAfter(s, 'inputs?|x');
  const w = listAfter(s, 'weights?|w');
  const t = num(s, 'target|t|y|label|desired output');
  if (!x || !w || t === null) return needErr(c, 'Give the input(s) x, weight(s) w, bias b and target, e.g. "backprop single neuron x 1 w 0.5 b 0 target 1 learning rate 0.1"');
  if (x.length !== w.length) bad(`${x.length} inputs but ${w.length} weights`);
  const b = num(s, 'bias|b') ?? 0;
  const ce = /\bcross[- ]?entropy\b|\blog ?loss\b|\bbce\b/.test(s);
  const z = w.reduce((acc, wi, i) => acc + wi * x[i]!, b);
  const a = sigmoid(z);
  const L = ce ? -(t * ln(a) + (1 - t) * ln(1 - a)) : 0.5 * (a - t) ** 2;
  const dz = ce ? a - t : (a - t) * a * (1 - a);
  const lines: Line[] = [
    { label: 'z', display: g(z, 9) },
    { label: 'Output a', display: g(a, 9) },
    { label: 'Loss', display: g(L, 9) },
    { label: 'dL/dz', display: g(dz, 9) },
    ...x.map((xi, i) => ({ label: `dL/dw${i + 1}`, display: g(dz * xi, 9) })),
    { label: 'dL/db', display: g(dz, 9) },
  ];
  if (lr !== null) {
    w.forEach((wi, i) => lines.push({ label: `New w${i + 1}`, display: g(wi - lr * dz * x[i]!, 9) }));
    lines.push({ label: 'New b', display: g(b - lr * dz, 9) });
  }
  return answer(c, {
    expression: `One backprop step · sigmoid neuron, ${ce ? 'cross-entropy' : 'squared-error'} loss`,
    value: lr !== null ? w[0]! - lr * dz * x[0]! : dz,
    lines,
    notes: [
      'a = σ(w·x + b)',
      ce ? 'L = −[t·ln a + (1 − t)·ln(1 − a)], so ∂L/∂z = a − t' : 'L = ½(a − t)², so ∂L/∂z = (a − t)·a·(1 − a)',
      lr !== null ? 'Primary value: the updated first weight w ← w − η·∂L/∂w' : 'No learning rate given: gradients only (primary value ∂L/∂z)',
    ],
  });
};

// ---------- gradient descent ----------

function stepsOf(s: string): number | null {
  const m = /(?:^|[^\d.])(\d+)\s*(?:steps?|iterations?|iters?|epochs?|updates?)\b/.exec(s);
  if (m) return Number(m[1]);
  return num(s, 'steps|iterations|iters|epochs');
}

/** "x^2 - 4x + 3" → coefficients by power. Null if it isn't a polynomial in x. */
function polynomial(expr: string): Map<number, number> | null {
  const e = expr.replace(/\s+/g, '').replace(/\*/g, '').replace(/²/g, '^2').replace(/³/g, '^3');
  if (!e || /[^0-9x.^+\-]/.test(e)) return null;
  const out = new Map<number, number>();
  for (const m of e.matchAll(/([+-]?)([^+-]+)/g)) {
    const t = /^(\d*\.?\d*)(x(?:\^(\d+))?)?$/.exec(m[2]!);
    if (!t || (!t[1] && !t[2])) return null;
    const coef = (m[1] === '-' ? -1 : 1) * (t[1] ? Number(t[1]) : 1);
    const pow = t[2] ? (t[3] ? Number(t[3]) : 1) : 0;
    out.set(pow, (out.get(pow) ?? 0) + coef);
  }
  return out.size ? out : null;
}

const polyStr = (p: Map<number, number>) =>
  [...p.entries()].sort((a, b) => b[0] - a[0]).map(([k, v], i) => `${v < 0 ? (i ? ' − ' : '−') : i ? ' + ' : ''}${Math.abs(v) === 1 && k ? '' : label(Math.abs(v))}${k ? (k === 1 ? 'x' : `x^${k}`) : ''}`).join('');

const gradientDescent: PHandler = (c) => {
  const s = c.s;
  if (!/\bgradient descent\b|\bgd step/.test(s)) return null;
  const lr = num(s, 'learning rate|lr|eta|η|alpha|step size');
  const steps = stepsOf(s);
  const fm = /f\s*\(\s*x\s*\)\s*=\s*(.*)$/.exec(s);
  if (fm) {
    const stop = /\s(?:from|starting|start|x0|x_0|initial|init|with|learning|lr|alpha|eta|step size|for|using|at)\b|[,;]/.exec(fm[1]!);
    const expr = stop ? fm[1]!.slice(0, stop.index) : fm[1]!;
    const p = polynomial(expr);
    if (!p) return needErr(c, `Gradient descent here works on polynomials in x (e.g. "x^2 - 4x"); couldn't read "${expr.trim()}"`);
    const x0m = new RegExp(`\\b(?:from|starting (?:at|from)|start (?:at|from)|starting point|initial(?:ly)?(?: x)?|init(?:ial)? x)\\s*(?:x\\s*=\\s*)?(${NUM})`).exec(s);
    const x0 = x0m ? Number(x0m[1]) : num(s, 'x0|x_0');
    if (x0 === null) return needErr(c, 'Where does it start? (e.g. "from x = 0")');
    if (lr === null) return needErr(c, 'What learning rate? (e.g. "learning rate 0.1")');
    if (steps === null) return needErr(c, 'How many steps? (e.g. "for 3 steps")');
    if (!(steps >= 1 && steps <= 10000 && Number.isInteger(steps))) bad('The number of steps must be a whole number from 1 to 10000');
    const fx = (x: number) => [...p].reduce((a, [k, v]) => a + v * x ** k, 0);
    const dfx = (x: number) => [...p].reduce((a, [k, v]) => a + (k ? k * v * x ** (k - 1) : 0), 0);
    const rows: string[][] = [['0', g(x0), g(fx(x0)), g(dfx(x0))]];
    let x = x0;
    for (let i = 1; i <= steps; i++) {
      x = x - lr * dfx(x);
      if (i <= 200 || i === steps) rows.push([String(i), g(x), g(fx(x)), g(dfx(x))]);
    }
    const notes = [`f(x) = ${polyStr(p)}, f′(x) computed exactly; x ← x − η·f′(x)`];
    if (!Number.isFinite(x) || Math.abs(x) > 1e6 * Math.max(1, Math.abs(x0))) notes.push('Diverging: the learning rate is too large for this function');
    return answer(c, {
      expression: `Gradient descent on f(x) = ${polyStr(p)} · x₀ = ${label(x0)}, η = ${label(lr)}, ${steps} step${steps === 1 ? '' : 's'}`,
      value: x,
      lines: [{ label: `x after ${steps} steps`, display: g(x, 9) }, { label: 'f(x)', display: g(fx(x), 9) }, { label: "f'(x)", display: g(dfx(x), 9) }],
      notes,
      table: { columns: ['Step', 'x', 'f(x)', "f'(x)"], rows },
    });
  }
  const xs = listAfter(s, 'x');
  const ys = listAfter(s, 'y');
  if (!xs || !ys) return needErr(c, 'Give a polynomial ("f(x) = x^2 - 4x") or data ("x 1 2 3 y 2 4 6")');
  if (xs.length !== ys.length) bad(`${xs.length} x values but ${ys.length} y values`);
  if (lr === null) return needErr(c, 'What learning rate? (e.g. "learning rate 0.1")');
  if (steps === null) return needErr(c, 'How many iterations? (e.g. "for 10 iterations")');
  if (!(steps >= 1 && steps <= 100000 && Number.isInteger(steps))) bad('The number of iterations must be a whole number from 1 to 100000');
  const half = /\bhalf\b|1\/2|½|1\/\(2n\)|2n\b/.test(s);
  let w = num(s, 'initial w|w0|w_0|w') ?? 0;
  let b = num(s, 'initial b|b0|b_0|b') ?? 0;
  const n = xs.length;
  const k = half ? 1 : 2;
  const loss = (W: number, B: number) => xs.reduce((a, x, i) => a + (W * x + B - ys[i]!) ** 2, 0) / (half ? 2 * n : n);
  const rows: string[][] = [['0', g(w), g(b), g(loss(w, b))]];
  for (let it = 1; it <= steps; it++) {
    let dw = 0;
    let db = 0;
    xs.forEach((x, i) => {
      const e = w * x + b - ys[i]!;
      dw += (k * e * x) / n;
      db += (k * e) / n;
    });
    w -= lr * dw;
    b -= lr * db;
    if (it <= 200 || it === steps) rows.push([String(it), g(w), g(b), g(loss(w, b))]);
  }
  return answer(c, {
    expression: `Gradient descent for y = w·x + b · ${n} points, η = ${label(lr)}, ${steps} iteration${steps === 1 ? '' : 's'}`,
    value: w,
    display: `w = ${g(w)}, b = ${g(b)}`,
    lines: [{ label: 'w', display: g(w, 9) }, { label: 'b', display: g(b, 9) }, { label: 'Loss', display: g(loss(w, b), 9) }],
    notes: [
      half ? 'Loss J = (1/2n)·Σ(ŷ − y)²' : 'Loss J = (1/n)·Σ(ŷ − y)² (mean squared error); gradients ∂J/∂w = (2/n)·Σ(ŷ − y)·x, ∂J/∂b = (2/n)·Σ(ŷ − y)',
      'Batch gradient descent, starting from w = b = 0 unless given',
    ],
    table: { columns: ['Iteration', 'w', 'b', 'Loss'], rows },
  });
};

// ---------- naive Bayes ----------

function classSections(s: string): { name: string; text: string }[] {
  const marks = [...s.matchAll(/\bclass\s+([a-z0-9_]+)\s*[:=]/g)];
  return marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.index : s.length;
    let text = s.slice(m.index + m[0].length, end);
    const q = text.search(/\b(?:query|classify|predict|new point|test point|point to classify)\b/);
    if (q >= 0) text = text.slice(0, q);
    return { name: m[1]!, text };
  });
}

function queryOf(s: string): number[] | null {
  const m = /\b(?:query|classify|predict(?: for| at)?|new point|test point|x)\s*(?:point)?\s*(?:[:=]|at|is)?\s*(\([^)]*\)|\[[^\]]*\]|-?[\d.]+(?:\s*,\s*-?[\d.]+)*)/.exec(s);
  if (!m) return null;
  const xs = runValues(m[1]!);
  return xs.length ? xs : null;
}

function pointsIn(text: string): number[][] {
  const tp = tuples(text, 1);
  if (tp.length) return tp;
  return runValues(text).map((v) => [v]);
}

const naiveBayes: PHandler = (c) => {
  const s = c.s;
  if (!/\bnaive bayes\b|\bnaïve bayes\b/.test(s)) return null;
  const pri = /\bpriors?\b/.exec(s);
  const lik = /\blikelihoods?\b/.exec(s);
  if (pri && lik && lik.index > pri.index) {
    const priorText = s.slice(pri.index + pri[0].length, lik.index);
    const pairs = [...priorText.matchAll(new RegExp(`([a-z][a-z0-9_]*)\\s*[:=]?\\s*(${NUM}(?:\\s*/\\s*${NUM})?)`, 'g'))];
    if (pairs.length < 2) return needErr(c, 'Give each class prior, e.g. "priors yes 9 no 5"');
    const names = pairs.map((p) => p[1]!);
    const priors = pairs.map((p) => runValues(p[2]!)[0]!);
    const lt = s.slice(lik.index + lik[0].length);
    const likes = names.map((nm) => {
      const m = new RegExp(`(?:^|[^a-z0-9_])${nm}\\s*[:=]?\\s*((?:${NUM}(?:\\s*/\\s*${NUM})?\\s*,?\\s*)+)`).exec(lt);
      if (!m) bad(`No likelihoods given for class “${nm}”`);
      return runValues(m[1]!);
    });
    const k = likes[0]!.length;
    if (likes.some((l) => l.length !== k)) bad('Every class needs the same number of feature likelihoods');
    if (likes.flat().some((p) => !(p >= 0 && p <= 1))) bad('Likelihoods P(feature | class) must be between 0 and 1');
    const tot = priors.reduce((a, b) => a + b, 0);
    const pr = priors.map((p) => p / tot);
    const joint = pr.map((p, i) => likes[i]!.reduce((a, l) => a * l, p));
    const Z = joint.reduce((a, b) => a + b, 0);
    if (!(Z > 0)) bad('Every class has probability 0 for these features (a zero likelihood); use Laplace smoothing');
    const post = joint.map((j) => j / Z);
    const best = post.indexOf(Math.max(...post));
    return answer(c, {
      expression: `Naive Bayes (categorical) · ${names.length} classes, ${k} features`,
      value: post[best],
      display: `${names[best]} (P = ${g(post[best]!, 6)})`,
      lines: names.flatMap((nm, i) => [
        { label: `Prior ${nm}`, display: g(pr[i]!) },
        { label: `Prior × likelihoods (${nm})`, display: g(joint[i]!) },
        { label: `P(${nm} | x)`, display: g(post[i]!) },
      ]),
      notes: ['P(class | x) ∝ P(class)·Π P(featureᵢ | class), features assumed independent given the class', ...(Math.abs(tot - 1) > 1e-9 ? ['Priors given as counts; normalised to probabilities'] : [])],
    });
  }
  const sections = classSections(s);
  if (sections.length < 2) return needErr(c, 'Give the class data and a query ("gaussian naive bayes class a: 1 2 3 class b: 6 7 8 query 4") or priors and likelihoods');
  const q = queryOf(s.slice(s.lastIndexOf('class')).replace(/^class\s+[a-z0-9_]+\s*[:=]/, ' ')) ?? queryOf(s);
  if (!q) return needErr(c, 'Which point should be classified? (e.g. "query 4")');
  const data = sections.map((sec) => ({ name: sec.name, pts: pointsIn(sec.text) }));
  const d = q.length;
  for (const cl of data) {
    if (cl.pts.length < 2) bad(`Class “${cl.name}” needs at least 2 points`);
    if (cl.pts.some((p) => p.length !== d)) bad(`Every point must have ${d} feature${d === 1 ? '' : 's'}, like the query`);
  }
  const N = data.reduce((a, cl) => a + cl.pts.length, 0);
  const stats = data.map((cl) => {
    const mu = Array.from({ length: d }, (_v, j) => cl.pts.reduce((a, p) => a + p[j]!, 0) / cl.pts.length);
    const v = Array.from({ length: d }, (_v, j) => cl.pts.reduce((a, p) => a + (p[j]! - mu[j]!) ** 2, 0) / cl.pts.length);
    if (v.some((x) => !(x > 0))) bad(`Class “${cl.name}” has zero variance in a feature; Gaussian naive Bayes can't use it`);
    const prior = cl.pts.length / N;
    const logL = mu.reduce((a, m, j) => a - 0.5 * ln(2 * Math.PI * v[j]!) - (q[j]! - m) ** 2 / (2 * v[j]!), 0);
    return { name: cl.name, mu, v, prior, logL };
  });
  const lj = stats.map((st) => Math.log(st.prior) + st.logL);
  const mx = Math.max(...lj);
  const Z = lj.reduce((a, l) => a + Math.exp(l - mx), 0);
  const post = lj.map((l) => Math.exp(l - mx) / Z);
  const best = post.indexOf(Math.max(...post));
  return answer(c, {
    expression: `Gaussian naive Bayes · ${stats.length} classes, query (${q.map(label).join(', ')})`,
    value: post[best],
    display: `${stats[best]!.name} (P = ${g(post[best]!, 6)})`,
    lines: stats.flatMap((st, i) => [
      { label: `Prior ${st.name}`, display: g(st.prior) },
      { label: `Mean ${st.name}`, display: st.mu.map((m) => g(m)).join(', ') },
      { label: `Variance ${st.name}`, display: st.v.map((m) => g(m)).join(', ') },
      { label: `Likelihood ${st.name}`, display: g(Math.exp(st.logL)) },
      { label: `P(${st.name} | x)`, display: g(post[i]!) },
    ]),
    notes: ['Per-class normal densities with maximum-likelihood (population, ÷n) variances, as scikit-learn uses; priors from class sizes', 'Features assumed independent given the class'],
  });
};

// ---------- kNN ----------

const knn: PHandler = (c) => {
  const s = c.s;
  if (!/\bk-?nn\b|\bk-?nearest\b|\bnearest neighbou?rs?\b/.test(s)) return null;
  const k = num(s, 'k');
  if (k === null) return needErr(c, 'How many neighbours k? (e.g. "k = 3")');
  if (!(Number.isInteger(k) && k >= 1)) bad('k must be a whole number of at least 1');
  const manhattan = /\bmanhattan\b|\bl1\b|\btaxicab\b|\bcity ?block\b/.test(s);
  const dist = (a: number[], b: number[]) => (manhattan ? a.reduce((t, v, i) => t + Math.abs(v - b[i]!), 0) : Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]!) ** 2, 0)));
  const dname = manhattan ? 'Manhattan' : 'Euclidean';
  const sections = classSections(s);
  if (sections.length >= 2) {
    const q = queryOf(s.slice(s.search(/\b(?:query|classify|predict|new point|test point)\b/) >= 0 ? s.search(/\b(?:query|classify|predict|new point|test point)\b/) : 0));
    if (!q) return needErr(c, 'Which point should be classified? (e.g. "query (2, 2)")');
    const pts = sections.flatMap((sec) => pointsIn(sec.text).map((p) => ({ p, cls: sec.name })));
    if (pts.some((x) => x.p.length !== q.length)) bad(`Every point must have ${q.length} coordinate${q.length === 1 ? '' : 's'}, like the query`);
    if (k > pts.length) bad(`k = ${k} but there are only ${pts.length} points`);
    const ranked = pts.map((x) => ({ ...x, d: dist(x.p, q) })).sort((a, b) => a.d - b.d);
    const nb = ranked.slice(0, k);
    const votes = new Map<string, { n: number; d: number }>();
    for (const x of nb) {
      const v = votes.get(x.cls) ?? { n: 0, d: 0 };
      votes.set(x.cls, { n: v.n + 1, d: v.d + x.d });
    }
    const sorted = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].d - b[1].d);
    const notes = [`${dname} distance; majority vote of the ${k} nearest`];
    if (sorted.length > 1 && sorted[0]![1].n === sorted[1]![1].n) notes.push('Vote tied: broken by the smaller total distance');
    if (k < ranked.length && Math.abs(ranked[k - 1]!.d - ranked[k]!.d) < 1e-12) notes.push(`Distance tie at the ${k}th neighbour: the order among equal distances follows the input order`);
    const winner = sorted[0]![0];
    return answer(c, {
      expression: `${k}-nearest-neighbour classification of (${q.map(label).join(', ')})`,
      display: winner,
      lines: [
        ...nb.map((x, i) => ({ label: `Neighbour ${i + 1}`, display: `(${x.p.map(label).join(', ')}) class ${x.cls}, distance ${g(x.d)}` })),
        ...sorted.map(([cl, v]) => ({ label: `Votes ${cl}`, display: String(v.n) })),
      ],
      notes,
    });
  }
  const xs = listAfter(s, 'x');
  const ys = listAfter(s, 'y');
  const q = num(s, 'query|predict(?: at| for)?|at');
  if (!xs || !ys || q === null) return needErr(c, 'Give labelled points and a query, e.g. "knn k 3 class a: (1,1) (2,1) class b: (5,5) (6,5) query (2,2)" or "knn regression k 2 x 1 2 3 y 10 20 30 query 2.4"');
  if (xs.length !== ys.length) bad(`${xs.length} x values but ${ys.length} y values`);
  if (k > xs.length) bad(`k = ${k} but there are only ${xs.length} points`);
  const ranked = xs.map((x, i) => ({ x, y: ys[i]!, d: Math.abs(x - q) })).sort((a, b) => a.d - b.d);
  const nb = ranked.slice(0, k);
  const yhat = nb.reduce((a, v) => a + v.y, 0) / k;
  const notes = [`Prediction = mean y of the ${k} nearest x values (unweighted)`];
  if (k < ranked.length && Math.abs(ranked[k - 1]!.d - ranked[k]!.d) < 1e-12) notes.push(`Distance tie at the ${k}th neighbour; the first in input order was used`);
  return answer(c, {
    expression: `${k}-nearest-neighbour regression at x = ${label(q)}`,
    value: yhat,
    lines: nb.map((v, i) => ({ label: `Neighbour ${i + 1}`, display: `x = ${label(v.x)}, y = ${label(v.y)}, distance ${g(v.d)}` })),
    notes,
  });
};

// ---------- k-means ----------

const sq = (a: number[], b: number[]) => a.reduce((t, v, i) => t + (v - b[i]!) ** 2, 0);

function lloyd(X: number[][], init: number[][]): { C: number[][]; assign: number[]; wcss: number; iters: number } {
  let C = init.map((p) => p.slice());
  let assign = new Array<number>(X.length).fill(-1);
  let iters = 0;
  for (; iters < 300; iters++) {
    const next = X.map((p) => {
      let best = 0;
      for (let j = 1; j < C.length; j++) if (sq(p, C[j]!) < sq(p, C[best]!)) best = j;
      return best;
    });
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    C = C.map((cj, j) => {
      const mem = X.filter((_p, i) => assign[i] === j);
      return mem.length ? cj.map((_v, d) => mem.reduce((a, p) => a + p[d]!, 0) / mem.length) : cj;
    });
    if (!changed) break;
  }
  const wcss = X.reduce((a, p, i) => a + sq(p, C[assign[i]!]!), 0);
  return { C, assign, wcss, iters: iters + 1 };
}

const kmeans: PHandler = (c) => {
  const s = c.s;
  if (!/\bk-?means\b/.test(s)) return null;
  const k = num(s, 'k|clusters') ?? (Number(/(\d+)\s*clusters\b/.exec(s)?.[1] ?? NaN) || null);
  if (k === null) return needErr(c, 'How many clusters k? (e.g. "k = 3")');
  if (!(Number.isInteger(k) && k >= 1)) bad('k must be a whole number of at least 1');
  const im = /\b(?:initial|starting|init(?:ial)?|start) (?:centroids?|centers?|centres?|means)\b|\bseeds? (?:at|=)/.exec(s);
  const dataText = im ? s.slice(0, im.index) : s;
  let X: number[][] = tuples(dataText, 2);
  if (!X.length) {
    const t = c.raw.includes('\n') ? tableColumns(c.raw) : null;
    if (t && t.length >= 1) X = t[0]!.xs.map((_v, i) => t.map((col) => col.xs[i]!));
    else X = (listAfter(dataText, 'points|data|values|observations|of') ?? []).map((v) => [v]);
  }
  if (X.length < 2) return needErr(c, 'Give the data points, e.g. "k-means k=2 points 1 2 3 10 11 12" or "(1,1) (1,2) (8,8)"');
  const dim = X[0]!.length;
  if (X.some((p) => p.length !== dim)) bad('All points need the same number of coordinates');
  if (k > X.length) bad(`k = ${k} but there are only ${X.length} points`);
  const notes: string[] = [];
  let res: ReturnType<typeof lloyd>;
  if (im) {
    const it = s.slice(im.index + im[0].length);
    const init = dim > 1 ? tuples(it, dim) : runValues(it).map((v) => [v]);
    if (init.length < k) bad(`k = ${k} but ${init.length} initial centroid${init.length === 1 ? '' : 's'} given`);
    res = lloyd(X, init.slice(0, k));
    notes.push('Started from the given centroids (Lloyd’s algorithm)');
  } else {
    const seedM = /\bseed\s*(?:=|:)?\s*(\d+)/.exec(s);
    const seed = seedM ? Number(seedM[1]) : hashSeed(c.s) % 100000;
    const r = rng(seed);
    let best: ReturnType<typeof lloyd> | null = null;
    for (let rep = 0; rep < 10; rep++) {
      const init: number[][] = [X[Math.floor(r() * X.length)]!];
      while (init.length < k) {
        const d2 = X.map((p) => Math.min(...init.map((q) => sq(p, q))));
        const tot = d2.reduce((a, b) => a + b, 0);
        let u = r() * tot;
        let pick = 0;
        for (; pick < X.length - 1; pick++) {
          u -= d2[pick]!;
          if (u <= 0) break;
        }
        init.push(X[tot > 0 ? pick : init.length % X.length]!);
      }
      const out = lloyd(X, init);
      if (!best || out.wcss < best.wcss - 1e-12) best = out;
    }
    res = best!;
    // Stable presentation: clusters ordered by their first coordinate.
    const order = res.C.map((cc, j) => [cc[0]!, j] as const).sort((a, b) => a[0] - b[0]).map(([, j]) => j);
    const rename = new Map(order.map((j, i) => [j, i]));
    res = { ...res, C: order.map((j) => res.C[j]!), assign: res.assign.map((a) => rename.get(a)!) };
    notes.push(`k-means++ initialisation, best of 10 runs by within-cluster SS (seed ${seed}${seedM ? '' : ' from the text; say “seed N” to change'})`, 'Clusters numbered by their first coordinate');
  }
  const fmtP = (p: number[]) => (p.length === 1 ? g(p[0]!) : `(${p.map((v) => g(v)).join(', ')})`);
  const sizes = res.C.map((_c, j) => res.assign.filter((a) => a === j).length);
  const grand = Array.from({ length: dim }, (_v, d) => X.reduce((a, p) => a + p[d]!, 0) / X.length);
  const tss = X.reduce((a, p) => a + sq(p, grand), 0);
  notes.push('Squared Euclidean distance; WCSS = Σ squared distance of each point to its centroid');
  return answer(c, {
    expression: `k-means · k = ${k}, ${X.length} points`,
    value: res.wcss,
    display: `Centroids ${res.C.map(fmtP).join(', ')}`,
    lines: [
      ...res.C.map((cc, j) => ({ label: `Centroid ${j + 1}`, display: fmtP(cc) })),
      { label: 'Cluster sizes', display: sizes.join(', ') },
      { label: 'Within-cluster SS', display: g(res.wcss) },
      { label: 'Between-cluster SS', display: g(tss - res.wcss) },
      { label: 'Iterations', display: String(res.iters) },
    ],
    notes,
    table: { columns: ['Point', 'Cluster'], rows: X.slice(0, 100).map((p, i) => [fmtP(p), String(res.assign[i]! + 1)]) },
  });
};

// ---------- PCA & factor analysis ----------

function dataMatrix(c: PCtx): { X: number[][]; names: string[] } | null {
  if (c.raw.includes('\n')) {
    const t = tableColumns(c.raw);
    if (t && t.length >= 2) return { X: t[0]!.xs.map((_v, i) => t.map((col) => col.xs[i]!)), names: t.map((col) => col.name) };
  }
  const lab = labelledColumns(c.s);
  if (lab.length >= 2 && lab.every((col) => col.xs.length === lab[0]!.xs.length)) return { X: lab[0]!.xs.map((_v, i) => lab.map((col) => col.xs[i]!)), names: lab.map((col) => col.name) };
  const tp = tuples(c.s, 2);
  if (tp.length >= 3 && tp.every((p) => p.length === tp[0]!.length)) return { X: tp, names: tp[0]!.map((_v, j) => `x${j + 1}`) };
  return null;
}

function covOf(X: number[][], standardise: boolean): Mat {
  const n = X.length;
  const p = X[0]!.length;
  const mu = Array.from({ length: p }, (_v, j) => X.reduce((a, r) => a + r[j]!, 0) / n);
  const C: Mat = Array.from({ length: p }, (_v, i) => Array.from({ length: p }, (_w, j) => X.reduce((a, r) => a + (r[i]! - mu[i]!) * (r[j]! - mu[j]!), 0) / (n - 1)));
  if (!standardise) return C;
  const sd = C.map((r, i) => Math.sqrt(r[i]!));
  if (sd.some((v) => !(v > 0))) bad('A variable has zero variance, so it cannot be standardised');
  return C.map((r, i) => r.map((v, j) => v / (sd[i]! * sd[j]!)));
}

function givenMatrix(c: PCtx): Mat | null {
  const M = matrixAfter(c.s, 'covariance matrix|correlation matrix|covariance|correlation|matrix') ?? matrixAfter(c.s, null) ?? (c.raw.includes('\n') ? null : matrixOf(c));
  if (!M) return null;
  const p = M.length;
  if (M.some((r) => r.length !== p)) bad('The matrix must be square');
  if (M.some((r, i) => r.some((v, j) => Math.abs(v - M[j]![i]!) > 1e-9 * Math.max(1, Math.abs(v))))) bad('A covariance / correlation matrix must be symmetric');
  return M;
}

const pca: PHandler = (c) => {
  const s = c.s;
  if (!/\bpca\b|\bprincipal components?(?: analysis)?\b/.test(s) || /\bfactor analysis\b/.test(s)) return null;
  const std = /\bstandardi[sz]\w*|\bscaled?\b|\bcorrelation\b/.test(s);
  let C: Mat;
  let names: string[];
  let source: string;
  if (/\bcovariance\b|\bcorrelation\b/.test(s) && givenMatrix(c)) {
    C = givenMatrix(c)!;
    names = C.map((_r, i) => `x${i + 1}`);
    source = /\bcorrelation\b/.test(s) ? 'given correlation matrix' : 'given covariance matrix';
  } else {
    const d = dataMatrix(c);
    if (!d) return needErr(c, 'Give the data (a pasted table, labelled columns or points like (1,2) (2,3) (3,5)) or a covariance matrix');
    if (d.X.length < 2) bad('PCA needs at least 2 observations');
    C = covOf(d.X, std);
    names = d.names;
    source = `${d.X.length} observations, ${std ? 'standardised (correlation matrix)' : 'sample covariance matrix (n − 1)'}`;
  }
  const { values, vectors } = symEig(C);
  const tot = values.reduce((a, b) => a + b, 0);
  const notes = [`From the ${source}`, 'Eigenvectors scaled to unit length, sign chosen so the largest component is positive'];
  if (values.some((v) => v < -1e-10)) notes.push('The matrix has negative eigenvalues, so it is not a valid covariance matrix');
  let cum = 0;
  const lines: Line[] = values.flatMap((v, j) => {
    cum += v;
    return [
      { label: `λ${j + 1}`, display: g(v, 9) },
      { label: `PC${j + 1} explained`, display: `${g((100 * v) / tot, 6)}%` },
      { label: `PC${j + 1} cumulative`, display: `${g((100 * cum) / tot, 6)}%` },
    ];
  });
  return answer(c, {
    expression: `Principal component analysis · ${C.length} variables`,
    value: values[0]! / tot,
    display: `PC1 explains ${g((100 * values[0]!) / tot, 6)}%`,
    lines,
    notes,
    table: { columns: ['Variable', ...values.map((_v, j) => `PC${j + 1}`)], rows: names.map((nm, i) => [nm, ...values.map((_v, j) => g(vectors[i]![j]!, 6))]) },
  });
};

const factorAnalysis: PHandler = (c) => {
  const s = c.s;
  if (!/\bfactor analysis\b|\bfactor loadings?\b|\bexploratory factor\b/.test(s)) return null;
  let R: Mat;
  const M = givenMatrix(c);
  if (M) {
    if (/\bcovariance\b/.test(s)) {
      const sd = M.map((r, i) => Math.sqrt(r[i]!));
      R = M.map((r, i) => r.map((v, j) => v / (sd[i]! * sd[j]!)));
    } else R = M;
    if (R.some((r, i) => Math.abs(r[i]! - 1) > 1e-6)) bad('A correlation matrix needs 1s on the diagonal (say “covariance” if it is one)');
  } else {
    const d = dataMatrix(c);
    if (!d) return needErr(c, 'Give a correlation matrix (e.g. [[1, 0.6], [0.6, 1]]) or data');
    R = covOf(d.X, true);
  }
  const p = R.length;
  const kExplicit = Number(/(\d+)\s*factors?\b/.exec(s)?.[1] ?? NaN) || num(s, 'factors?|k');
  const paf = /\bprincipal axis\b|\bpaf\b/.test(s);
  let eig = symEig(R);
  const k = kExplicit ?? Math.max(1, eig.values.filter((v) => v > 1).length);
  if (!(Number.isInteger(k) && k >= 1 && k <= p)) bad(`The number of factors must be between 1 and ${p}`);
  let Rw = R;
  if (paf) {
    const Ri = inv(R);
    let h = Ri ? Ri.map((r, i) => 1 - 1 / r[i]!) : R.map(() => 0.5);
    for (let it = 0; it < 200; it++) {
      Rw = R.map((r, i) => r.map((v, j) => (i === j ? h[i]! : v)));
      eig = symEig(Rw);
      const nh = Array.from({ length: p }, (_v, i) => eig.values.slice(0, k).reduce((a, lam, j) => a + Math.max(lam, 0) * eig.vectors[i]![j]! ** 2, 0));
      const delta = Math.max(...nh.map((v, i) => Math.abs(v - h[i]!)));
      h = nh;
      if (delta < 1e-10) break;
    }
  }
  const L = Array.from({ length: p }, (_v, i) => Array.from({ length: k }, (_w, j) => eig.vectors[i]![j]! * Math.sqrt(Math.max(eig.values[j]!, 0))));
  const comm = L.map((r) => r.reduce((a, v) => a + v * v, 0));
  const explained = comm.reduce((a, b) => a + b, 0) / p;
  const notes = [
    paf ? 'Principal-axis factoring (iterated communalities, starting from squared multiple correlations)' : 'Principal-component extraction (loadings = eigenvector × √eigenvalue); say “principal axis” for PAF',
    kExplicit ? `${k} factor${k === 1 ? '' : 's'} as requested` : `${k} factor${k === 1 ? '' : 's'} by the Kaiser criterion (eigenvalue > 1)`,
    'Unrotated loadings (no varimax)',
  ];
  if (comm.some((h) => h > 1 + 1e-9)) notes.push('A communality exceeds 1 (Heywood case): the solution is improper');
  return answer(c, {
    expression: `Factor analysis · ${p} variables, ${k} factor${k === 1 ? '' : 's'}`,
    value: explained,
    display: `${g(explained * 100, 6)}% of variance explained`,
    lines: [
      ...eig.values.slice(0, k).map((v, j) => ({ label: `Eigenvalue ${j + 1}`, display: g(v) })),
      ...L.map((r, i) => ({ label: `Loading ${i + 1}`, display: r.map((v) => g(v)).join(', ') })),
      ...comm.map((h, i) => ({ label: `Communality ${i + 1}`, display: g(h) })),
      ...comm.map((h, i) => ({ label: `Uniqueness ${i + 1}`, display: g(1 - h) })),
    ],
    notes,
    table: { columns: ['Variable', ...Array.from({ length: k }, (_v, j) => `Factor ${j + 1}`), 'Communality'], rows: L.map((r, i) => [`x${i + 1}`, ...r.map((v) => g(v, 4)), g(comm[i]!, 4)]) },
  });
};

// ---------- regularisation ----------

const regularisation: PHandler = (c) => {
  const s = c.s;
  if (/\bridge (?:regression|fit|estimate)\b/.test(s)) {
    const lam = num(s, 'lambda|alpha|penalty|λ');
    let Xc: number[][];
    let names: string[];
    let y: number[];
    const xs = listAfter(s, 'x');
    const ys = listAfter(s, 'y');
    if (xs && ys) {
      Xc = xs.map((v) => [v]);
      names = ['x'];
      y = ys;
    } else {
      const lab = labelledColumns(c.s);
      const yi = lab.findIndex((col) => /(?:^|\s)(?:y|target|response)$/.test(col.name));
      if (yi < 0 || lab.length < 2) return needErr(c, 'Give the data, e.g. "ridge regression x 1 2 3 y 2 4 6 lambda 1"');
      y = lab[yi]!.xs;
      const preds = lab.filter((_col, i) => i !== yi);
      names = preds.map((p) => p.name.split(' ').pop()!);
      Xc = y.map((_v, i) => preds.map((p) => p.xs[i]!));
    }
    if (lam === null) return needErr(c, 'What penalty λ? (e.g. "lambda 1")');
    if (!(lam >= 0)) bad('λ must be zero or positive');
    if (Xc.length !== y.length || Xc.some((r) => r.some((v) => v === undefined))) bad('The predictor and response lists must be the same length');
    const n = y.length;
    const p = Xc[0]!.length;
    const mx = Array.from({ length: p }, (_v, j) => Xc.reduce((a, r) => a + r[j]!, 0) / n);
    const my = y.reduce((a, b) => a + b, 0) / n;
    const Z = Xc.map((r) => r.map((v, j) => v - mx[j]!));
    const yc = y.map((v) => v - my);
    const A = mul(T(Z), Z).map((r, i) => r.map((v, j) => v + (i === j ? lam : 0)));
    const Ai = inv(A);
    if (!Ai) bad('The system is singular (try λ > 0)');
    const beta = mulv(Ai, mulv(T(Z), yc));
    const b0 = my - beta.reduce((a, b, j) => a + b * mx[j]!, 0);
    const lines: Line[] = p === 1 ? [{ label: 'Slope', display: g(beta[0]!, 9) }] : beta.map((b, j) => ({ label: `β ${names[j]}`, display: g(b, 9) }));
    lines.push({ label: 'Intercept', display: g(b0, 9) });
    return answer(c, {
      expression: `Ridge regression · λ = ${label(lam)}, ${n} observations`,
      value: beta[0],
      display: p === 1 ? `ŷ = ${g(beta[0]!)}x ${b0 < 0 ? '−' : '+'} ${g(Math.abs(b0))}` : undefined,
      lines,
      notes: ['Minimises Σ(y − ŷ)² + λ·Σβ² (scikit-learn Ridge convention); the intercept is not penalised (data centred)', 'Predictors not standardised; standardise first if they are on different scales'],
    });
  }
  const l1 = /\bl1\b|\blasso\b/.test(s);
  const l2 = /\bl2\b|\bridge\b|\bweight decay\b/.test(s);
  const elastic = /\belastic net\b/.test(s);
  if (!(l1 || l2 || elastic) || !/\bpenalty\b|\bregulari[sz]\w*|\bterm\b|\bweight decay\b|\bnorm\b|\bcost\b/.test(s)) return null;
  const w = listAfter(s, 'weights?|w|coefficients?|beta|θ|theta|parameters?');
  if (!w) return needErr(c, 'Give the weights, e.g. "l2 penalty weights 1 -2 3 lambda 0.1"');
  const lam = num(s, 'lambda|alpha|λ|regularization strength|strength|c');
  const L1 = w.reduce((a, v) => a + Math.abs(v), 0);
  const L2 = w.reduce((a, v) => a + v * v, 0);
  if (lam === null) {
    return answer(c, {
      expression: `${l1 ? 'L1' : 'L2'} norm of ${w.length} weights`,
      value: l1 ? L1 : L2,
      lines: [{ label: 'Σ|w|', display: g(L1) }, { label: 'Σw²', display: g(L2) }, { label: '‖w‖₂', display: g(Math.sqrt(L2)) }],
      notes: ['No λ given: the unscaled penalty sums (say “lambda 0.1” for the penalty term)'],
    });
  }
  const v = elastic ? lam * (L1 + L2) : l1 ? lam * L1 : lam * L2;
  return answer(c, {
    expression: `${elastic ? 'Elastic-net' : l1 ? 'L1 (lasso)' : 'L2 (ridge)'} penalty · λ = ${label(lam)}, ${w.length} weights`,
    value: v,
    lines: [
      { label: 'L1 penalty λΣ|w|', display: g(lam * L1) },
      { label: 'L2 penalty λΣw²', display: g(lam * L2) },
      { label: 'Σ|w|', display: g(L1) },
      { label: 'Σw²', display: g(L2) },
    ],
    notes: [l1 && !elastic ? 'L1 penalty = λ·Σ|wᵢ|' : 'L2 penalty = λ·Σwᵢ² (some texts use λ/2·Σwᵢ²; halve it for that convention)', 'Bias terms are usually left out of the penalty'],
  });
};

export const MODEL_HANDLERS: PHandler[] = [modelArithmetic, perplexity, backprop, gradientDescent, naiveBayes, knn, kmeans, factorAnalysis, pca, regularisation];
