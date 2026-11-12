// Information theory (entropy, KL, mutual information, channel capacity, Huffman/Shannon–Fano) and coding theory
// (parity, Hamming codes, CRC, checksums, Luhn, ISBN/EAN).
import { answer, fmt, frac, log2, numbers, param, parseMatrix, refuse, sum, type Line, type Result } from './util';

function base(input: string): { b: number; unit: string } {
  if (/\b(?:nats?|natural log|base e|ln)\b/i.test(input)) return { b: Math.E, unit: 'nats' };
  if (/\b(?:hartleys?|bans?|dits?|base 10|decimal digits)\b/i.test(input)) return { b: 10, unit: 'hartleys' };
  return { b: 2, unit: 'bits' };
}
const H = (p: number[], b = 2) => -sum(p.map((x) => (x > 0 ? x * Math.log(x) : 0))) / Math.log(b);
export const binaryEntropy = (p: number) => H([p, 1 - p]);

function probs(list: number[]): { p: number[]; note?: string } {
  if (list.some((x) => x < 0)) refuse('Probabilities can’t be negative');
  const s = sum(list);
  if (s === 0) refuse('All zero');
  if (Math.abs(s - 1) < 1e-9) return { p: list };
  if (list.every((x) => x <= 1) && s < 1 - 1e-9) refuse(`These add up to ${fmt(s)}, not 1`);
  return { p: list.map((x) => x / s), note: `Normalised counts/weights (total ${fmt(s)}) to probabilities.` };
}

function quoted(input: string): string | null {
  const m = /["“'‘]([^"”'’]+)["”'’]/.exec(input) ?? /\b(?:string|message|text|word|of)\s+([A-Za-z][A-Za-z0-9 ]*[A-Za-z0-9]|[A-Za-z])\s*$/i.exec(input);
  return m ? m[1]! : null;
}

function entropy(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bentropy\b|\bperplexity\b/.test(lc) || /\bcross[- ]?entropy\b|\bjoint\b|\bconditional\b|\brelative entropy\b|\bmutual\b/.test(lc)) return null;
  const { b, unit } = base(input);
  if (/\bbinary entropy\b|\bh\s*\(\s*[\d.]+\s*\)/.test(lc)) {
    const p = numbers(input.replace(/^.*?(?:binary entropy(?: function)?|\bh\s*\()/i, ''))[0];
    if (p === undefined || p < 0 || p > 1) refuse('Give p between 0 and 1');
    const h = H([p!, 1 - p!], b);
    return answer(input, 'info', `Binary entropy H(${fmt(p!)})`, `${fmt(h, 8)} ${unit}`, { value: h, lines: [{ label: 'Formula', display: 'H(p) = −p log p − (1−p) log(1−p)' }], notes: ['Maximum 1 bit at p = 1/2.'] });
  }
  const nums = numbers(input.replace(/\b(?:base\s*\d+|log\s*\d+)\b/gi, ''));
  let p: number[];
  let note: string | undefined;
  let syms: string[] | null = null;
  const text = nums.length < 2 ? quoted(input) : null;
  if (text) {
    const counts = new Map<string, number>();
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    syms = [...counts.keys()];
    p = syms.map((s) => counts.get(s)! / text.length);
    note = `Symbol frequencies from “${text}” (${text.length} symbols).`;
  } else {
    if (nums.length < 1) refuse('Give probabilities, e.g. “entropy of 0.5 0.25 0.25”');
    ({ p, note } = probs(nums));
  }
  const h = H(p, b);
  const hmax = Math.log(p.length) / Math.log(b);
  const rows = p.map((x, i) => [syms ? JSON.stringify(syms[i]) : `p${i + 1}`, frac(x, 64) ?? fmt(x, 6), fmt(x > 0 ? -Math.log(x) / Math.log(b) : 0, 6), fmt(x > 0 ? -x * Math.log(x) / Math.log(b) : 0, 6)]);
  const lines: Line[] = [
    { label: 'H = −Σ p log p', display: `${fmt(h, 10)} ${unit}` },
    { label: 'Maximum (uniform)', display: `${fmt(hmax, 8)} ${unit}` },
    { label: 'Efficiency H/Hmax', display: fmt(hmax ? h / hmax : 1, 6) },
    { label: 'Perplexity b^H', display: fmt(b ** h, 8) },
  ];
  if (text) lines.push({ label: 'Total information', display: `${fmt(h * text.length, 8)} ${unit} for the whole message` });
  return answer(input, 'info', `Shannon entropy of ${syms ? 'a message' : `${p.length} outcomes`}`, `${fmt(h, 8)} ${unit}`, {
    value: h,
    lines,
    table: { columns: ['symbol', 'p', 'self-information −log p', 'contribution'], rows },
    notes: note ? [note] : [],
  });
}

function jointMeasures(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:mutual information|joint entropy|conditional entropy|information gain)\b/.test(lc)) return null;
  const M = parseMatrix(input.slice(input.search(/\[\s*\[|\d/)));
  if (!M || M.some((r) => r.length !== M[0]!.length)) refuse('Give the joint distribution as a matrix, e.g. “mutual information [[0.25,0.25],[0,0.5]]”');
  const { b, unit } = base(input);
  const tot = sum(M!.flat());
  const P = M!.map((r) => r.map((x) => x / tot));
  const px = P.map((r) => sum(r));
  const py = P[0]!.map((_, j) => sum(P.map((r) => r[j]!)));
  const hxy = H(P.flat(), b);
  const hx = H(px, b);
  const hy = H(py, b);
  const mi = hx + hy - hxy;
  const which = /\bjoint\b/.test(lc) ? 'joint' : /\bconditional\b/.test(lc) ? 'cond' : 'mi';
  const val = which === 'joint' ? hxy : which === 'cond' ? hxy - hx : mi;
  return answer(input, 'info', `${which === 'joint' ? 'Joint entropy H(X,Y)' : which === 'cond' ? 'Conditional entropy H(Y|X)' : 'Mutual information I(X;Y)'} · ${P.length}×${P[0]!.length} joint distribution`, `${fmt(Math.abs(val) < 1e-12 ? 0 : val, 8)} ${unit}`, {
    value: val,
    lines: [
      { label: 'H(X,Y)', display: fmt(hxy, 8) },
      { label: 'H(X) (rows)', display: fmt(hx, 8) },
      { label: 'H(Y) (columns)', display: fmt(hy, 8) },
      { label: 'H(Y|X) = H(X,Y) − H(X)', display: fmt(hxy - hx, 8) },
      { label: 'H(X|Y) = H(X,Y) − H(Y)', display: fmt(hxy - hy, 8) },
      { label: 'I(X;Y) = H(X) + H(Y) − H(X,Y)', display: fmt(Math.abs(mi) < 1e-12 ? 0 : mi, 8) },
    ],
    notes: [...(Math.abs(tot - 1) > 1e-9 ? [`Normalised the table (it summed to ${fmt(tot)}).`] : []), 'I(X;Y) = 0 exactly when X and Y are independent.'],
  });
}

function divergence(input: string): Result {
  const lc = input.toLowerCase();
  const kind = /\bcross[- ]?entropy\b/.test(lc) ? 'ce' : /\b(?:kl|kullback|relative entropy)\b/.test(lc) ? 'kl' : /\b(?:js|jensen)\b/.test(lc) ? 'js' : null;
  if (!kind) return null;
  const pm = /\bp\s*(?:=|:)\s*\[?([-−\d.,\s/]+?)\]?\s*(?:,|;|and)?\s*(?=\bq\b)/i.exec(input);
  const qm = /\bq\s*(?:=|:)\s*\[?([-−\d.,\s/]+)\]?/i.exec(input);
  let P: number[];
  let Q: number[];
  if (pm && qm) {
    P = numbers(pm[1]!);
    Q = numbers(qm[1]!);
  } else {
    const groups = [...input.matchAll(/\[([^\]]+)\]/g)].map((m) => numbers(m[1]!));
    if (groups.length < 2) refuse('Give two distributions: “kl divergence p = 0.5 0.5 q = 0.9 0.1”');
    [P, Q] = [groups[0]!, groups[1]!];
  }
  if (P.length !== Q.length) refuse('P and Q need the same number of outcomes');
  P = probs(P).p;
  Q = probs(Q).p;
  const { b, unit } = base(input);
  const lg = (x: number) => Math.log(x) / Math.log(b);
  const ce = -sum(P.map((p, i) => (p > 0 ? p * lg(Q[i]!) : 0)));
  const hp = H(P, b);
  const kl = sum(P.map((p, i) => (p > 0 ? p * lg(p / Q[i]!) : 0)));
  const klqp = sum(Q.map((q, i) => (q > 0 ? q * lg(q / P[i]!) : 0)));
  const Mx = P.map((p, i) => (p + Q[i]!) / 2);
  const js = 0.5 * sum(P.map((p, i) => (p > 0 ? p * lg(p / Mx[i]!) : 0))) + 0.5 * sum(Q.map((q, i) => (q > 0 ? q * lg(q / Mx[i]!) : 0)));
  const val = kind === 'ce' ? ce : kind === 'kl' ? kl : js;
  return answer(input, 'info', kind === 'ce' ? 'Cross-entropy H(P, Q)' : kind === 'kl' ? 'KL divergence D(P ‖ Q)' : 'Jensen–Shannon divergence', Number.isFinite(val) ? `${fmt(val, 8)} ${unit}` : '∞', {
    value: val,
    lines: [
      { label: 'H(P, Q) = −Σ p log q', display: fmt(ce, 8) },
      { label: 'H(P)', display: fmt(hp, 8) },
      { label: 'D(P‖Q) = H(P,Q) − H(P)', display: fmt(kl, 8) },
      { label: 'D(Q‖P)', display: fmt(klqp, 8) },
      { label: 'JS divergence', display: fmt(js, 8) },
    ],
    notes: ['KL divergence is not symmetric and is infinite when Q gives zero probability to something P allows.', ...(kind === 'ce' && unit === 'bits' ? [`In nats (as in ML log loss): ${fmt(ce * Math.LN2, 8)}.`] : [])],
  });
}

function capacity(input: string): Result {
  const lc = input.toLowerCase();
  if (/\b(?:bsc|binary symmetric)\b/.test(lc)) {
    const p = param(input, ['p', 'crossover', 'error probability', 'flip probability', 'error rate']) ?? numbers(input)[0];
    if (p === undefined || p < 0 || p > 1) refuse('Give the crossover probability p');
    const C = 1 - binaryEntropy(p!);
    return answer(input, 'info', `Binary symmetric channel, p = ${fmt(p!)}`, `C = ${fmt(C, 8)} bits/use`, { value: C, lines: [{ label: 'Formula', display: 'C = 1 − H(p)' }, { label: 'H(p)', display: fmt(binaryEntropy(p!), 8) }], notes: ['Achieved by uniform inputs. C = 0 at p = 1/2.'] });
  }
  if (/\b(?:bec|binary erasure)\b/.test(lc)) {
    const e = param(input, ['e', 'ε', 'epsilon', 'erasure probability', 'p']) ?? numbers(input)[0];
    if (e === undefined || e < 0 || e > 1) refuse('Give the erasure probability');
    return answer(input, 'info', `Binary erasure channel, ε = ${fmt(e!)}`, `C = ${fmt(1 - e!, 8)} bits/use`, { value: 1 - e!, lines: [{ label: 'Formula', display: 'C = 1 − ε' }] });
  }
  if (/\b(?:awgn|shannon[- ]hartley|channel capacity|shannon capacity|shannon limit)\b/.test(lc)) {
    const bwm = /([\d.]+)\s*(k|m|g)?hz\b/i.exec(input);
    const bw = bwm ? Number(bwm[1]) * ({ k: 1e3, m: 1e6, g: 1e9 }[bwm[2]?.toLowerCase() as 'k'] ?? 1) : param(input, ['bandwidth', 'B', 'W']);
    const dbm = /(-?[\d.]+)\s*db\b/i.exec(input);
    const snr = dbm ? 10 ** (Number(dbm[1]) / 10) : param(input, ['snr', 's/n', 'signal to noise', 'signal-to-noise']);
    if (snr === undefined) {
      if (/\bcapacity\b/.test(lc)) return null;
      refuse('Give the SNR (e.g. 30 dB) and bandwidth (e.g. 3 kHz)');
    }
    if (bw === undefined) {
      const c = log2(1 + snr!);
      return answer(input, 'info', `AWGN channel capacity per use, SNR = ${fmt(snr!, 6)}`, `${fmt(c, 8)} bits/use`, { value: c, lines: [{ label: 'Formula', display: 'C = ½·log₂(1 + SNR) per real sample, or log₂(1 + SNR) per complex sample' }, { label: 'Per real dimension', display: fmt(c / 2, 8) }] });
    }
    const C = bw * log2(1 + snr!);
    return answer(input, 'info', `Shannon–Hartley capacity · B = ${fmt(bw)} Hz, SNR = ${fmt(snr!, 6)}${dbm ? ` (${dbm[1]} dB)` : ''}`, `${fmt(C, 8)} bit/s`, {
      value: C,
      lines: [
        { label: 'Formula', display: 'C = B·log₂(1 + S/N)' },
        { label: 'Spectral efficiency', display: `${fmt(log2(1 + snr!), 8)} bit/s/Hz` },
        { label: 'In kbit/s', display: fmt(C / 1000, 8) },
      ],
      notes: ['No code can communicate reliably faster than C; good codes come arbitrarily close.'],
    });
  }
  return null;
}

interface CodeRow {
  sym: string;
  w: number;
  code: string;
}

function symbolWeights(input: string): { syms: string[]; w: number[]; text?: string } {
  const pairs = [...input.matchAll(/(?:^|[\s,;])([A-Za-z0-9_]+|'.')\s*[:=]\s*([\d.]+)/g)].filter((m) => !/^(?:capacity|n|p|q)$/i.test(m[1]!));
  if (pairs.length >= 2) return { syms: pairs.map((m) => m[1]!.replace(/'/g, '')), w: pairs.map((m) => Number(m[2])) };
  const text = /["“'‘]([^"”'’]+)["”'’]/.exec(input)?.[1] ?? /\b(?:of|for|encode|string|message|text)\s+([A-Za-z0-9 ]+?)\s*$/i.exec(input)?.[1];
  if (text && !/^\s*[\d.\s]+$/.test(text)) {
    const counts = new Map<string, number>();
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    return { syms: [...counts.keys()], w: [...counts.values()], text };
  }
  const nums = numbers(input);
  if (nums.length >= 2) return { syms: nums.map((_, i) => String.fromCharCode(65 + i)), w: nums };
  return refuse('Give symbols with frequencies (a:45 b:13 …), a probability list, or a quoted message');
}

export function huffmanCodes(syms: string[], w: number[]): CodeRow[] {
  type Node = { w: number; sym?: number; l?: Node; r?: Node; order: number };
  let q: Node[] = w.map((x, i) => ({ w: x, sym: i, order: i }));
  let order = w.length;
  if (q.length === 1) return [{ sym: syms[0]!, w: w[0]!, code: '0' }];
  while (q.length > 1) {
    q.sort((a, b) => a.w - b.w || a.order - b.order);
    const a = q.shift()!;
    const b = q.shift()!;
    q.push({ w: a.w + b.w, l: a, r: b, order: order++ });
  }
  const codes: string[] = [];
  const walk = (n: Node, c: string) => {
    if (n.sym !== undefined) codes[n.sym] = c || '0';
    else (walk(n.l!, c + '0'), walk(n.r!, c + '1'));
  };
  walk(q[0]!, '');
  return syms.map((s, i) => ({ sym: s, w: w[i]!, code: codes[i]! }));
}

function shannonFano(syms: string[], w: number[]): CodeRow[] {
  const items = syms.map((s, i) => ({ sym: s, w: w[i]!, code: '' })).sort((a, b) => b.w - a.w);
  const split = (lo: number, hi: number) => {
    if (hi - lo < 1) return;
    const total = sum(items.slice(lo, hi + 1).map((x) => x.w));
    let acc = 0;
    let best = lo;
    let bestDiff = Infinity;
    for (let i = lo; i < hi; i++) {
      acc += items[i]!.w;
      const d = Math.abs(total - 2 * acc);
      if (d < bestDiff) (bestDiff = d), (best = i);
    }
    for (let i = lo; i <= hi; i++) items[i]!.code += i <= best ? '0' : '1';
    split(lo, best);
    split(best + 1, hi);
  };
  split(0, items.length - 1);
  return items;
}

function sourceCoding(input: string): Result {
  const lc = input.toLowerCase();
  const huff = /\bhuffman\b/.test(lc);
  const sf = /\bshannon[- ]fano\b/.test(lc);
  if (!huff && !sf) return null;
  const { syms, w, text } = symbolWeights(input.replace(/^.*?(?:huffman|shannon[- ]fano)(?:\s+(?:code|coding|tree|encoding))?(?:\s+(?:for|of))?/i, ' '));
  const total = sum(w);
  const rows = (huff ? huffmanCodes(syms, w) : shannonFano(syms, w)).sort((a, b) => b.w - a.w || a.code.length - b.code.length);
  const avg = sum(rows.map((r) => (r.w / total) * r.code.length));
  const h = H(w.map((x) => x / total));
  const fixed = Math.max(1, Math.ceil(log2(syms.length)));
  const lines: Line[] = [
    { label: 'Average length', display: `${fmt(avg, 8)} bits/symbol` },
    { label: 'Entropy (lower bound)', display: `${fmt(h, 8)} bits/symbol` },
    { label: 'Efficiency H/L', display: `${fmt((h / avg) * 100, 5)}%` },
    { label: 'Fixed-length code', display: `${fixed} bits/symbol → compression ratio ${fmt(fixed / avg, 5)}:1` },
  ];
  if (text) {
    const bits = sum(rows.map((r) => r.w * r.code.length));
    lines.push({ label: 'Encoded message', display: `${bits} bits vs ${text.length * 8} bits as 8-bit ASCII (ratio ${fmt((text.length * 8) / bits, 5)}:1)` });
    const map = new Map(rows.map((r) => [r.sym, r.code]));
    const enc = [...text].map((c) => map.get(c)).join('');
    if (enc.length <= 120) lines.push({ label: 'Bits', display: enc });
  }
  return answer(input, 'info', `${huff ? 'Huffman' : 'Shannon–Fano'} code for ${syms.length} symbols`, `average ${fmt(avg, 6)} bits/symbol`, {
    value: avg,
    lines,
    table: { columns: ['symbol', text ? 'count' : 'weight', 'code', 'length'], rows: rows.map((r) => [r.sym === ' ' ? '␣' : r.sym, fmt(r.w), r.code, String(r.code.length)]) },
    notes: [huff ? 'Huffman: repeatedly merge the two least frequent nodes; the result is an optimal prefix code (ties may give different but equally short codes).' : 'Shannon–Fano: sort by frequency and split into halves of nearly equal total, recursively. Not always optimal (Huffman is).'],
  });
}

function compressionRatio(input: string): Result {
  if (!/\bcompression ratio\b|\bspace sav\w*\b/i.test(input)) return null;
  const n = numbers(input);
  if (n.length < 2) refuse('Give the original and compressed sizes, e.g. “compression ratio 1000 to 250”');
  const [a, b] = [n[0]!, n[1]!];
  return answer(input, 'info', `Compression from ${fmt(a)} to ${fmt(b)}`, `${fmt(a / b, 6)}:1`, { value: a / b, lines: [{ label: 'Ratio original/compressed', display: `${fmt(a / b, 6)}:1` }, { label: 'Space savings', display: `${fmt((1 - b / a) * 100, 6)}%` }, { label: 'Compressed as % of original', display: `${fmt((b / a) * 100, 6)}%` }] });
}

// ─── Coding theory ───

const bitsOf = (s: string) => s.replace(/[\s_]/g, '');

function parity(input: string): Result {
  const m = /\b(even|odd)?\s*parity(?:\s+bit)?\b(?:\s+(?:of|for))?\s+([01\s]{2,})(?:\s|$)/i.exec(input) ?? /\b([01]{2,})\b.*\b(even|odd)\s+parity/i.exec(input);
  if (!m) return null;
  let kind: string;
  let bits: string;
  if (/^[01\s]+$/.test(m[1] ?? '')) [bits, kind] = [bitsOf(m[1]!), m[2]!.toLowerCase()];
  else [kind, bits] = [(m[1] ?? 'even').toLowerCase(), bitsOf(m[2]!)];
  const ones = [...bits].filter((c) => c === '1').length;
  const bit = kind === 'even' ? ones % 2 : 1 - (ones % 2);
  return answer(input, 'coding', `${kind[0]!.toUpperCase() + kind.slice(1)} parity of ${bits}`, `parity bit ${bit}`, { value: bit, lines: [{ label: 'Number of 1s', display: String(ones) }, { label: 'Transmitted', display: bits + bit }], notes: ['A single parity bit detects any odd number of bit errors but cannot locate or correct them.'] });
}

function hamming(input: string): Result {
  const lc = input.toLowerCase();
  if (/\bhamming distance\b/.test(lc)) {
    const ws = input.replace(/^.*?hamming distance(?:\s+(?:between|of))?\s*/i, '').split(/\s*(?:,|\band\b|\s)\s*/).filter(Boolean);
    if (ws.length < 2) refuse('Give two strings of equal length');
    const [a, b] = [ws[0]!.replace(/["']/g, ''), ws[1]!.replace(/["']/g, '')];
    if (a.length !== b.length) refuse('Hamming distance needs strings of equal length');
    const diff = [...a].map((c, i) => (c === b[i] ? ' ' : '^')).join('');
    const d = [...a].filter((c, i) => c !== b[i]).length;
    return answer(input, 'coding', `Hamming distance between ${a} and ${b}`, String(d), { value: d, lines: [{ label: 'Positions differing', display: [...diff].map((c, i) => (c === '^' ? i + 1 : 0)).filter(Boolean).join(', ') || 'none' }] });
  }
  const enc = /\bhamming(?:\s*\(\s*7\s*,\s*4\s*\)|\s*7,4)?\s*(?:code\s+)?(?:encod\w*|code for|codeword for)\s+([01\s]+)$/i.exec(input) ?? /\bencode\s+([01\s]+?)\s+(?:with|using|in)\s+hamming/i.exec(input);
  const dec = /\bhamming(?:\s*\(\s*7\s*,\s*4\s*\)|\s*7,4)?\s*(?:code\s+)?(?:decod\w*|correct\w*|check|syndrome(?: of)?)\s+([01\s]+)$/i.exec(input) ?? /\b(?:decode|correct)\s+([01\s]+?)\s+(?:with|using)\s+hamming/i.exec(input);
  if (!enc && !dec) return null;
  if (enc) {
    const data = bitsOf(enc[1]!);
    if (!data.length || data.length > 64) refuse('1 to 64 data bits');
    let r = 0;
    while (2 ** r < data.length + r + 1) r++;
    const n = data.length + r;
    const code: (number | null)[] = new Array(n + 1).fill(null);
    let k = 0;
    for (let pos = 1; pos <= n; pos++) if (pos & (pos - 1)) code[pos] = Number(data[k++]);
    const parityRows: Line[] = [];
    for (let i = 0; i < r; i++) {
      const p = 1 << i;
      const covered: number[] = [];
      let x = 0;
      for (let pos = 1; pos <= n; pos++) if (pos & p && pos !== p) (x ^= code[pos]!), covered.push(pos);
      code[p] = x;
      parityRows.push({ label: `p${p} (covers ${[p, ...covered].join(',')})`, display: String(x) });
    }
    const word = code.slice(1).join('');
    const layout = Array.from({ length: n }, (_, i) => ((i + 1) & i ? `d` : `p`) + (i + 1)).join(' ');
    return answer(input, 'coding', `Hamming(${n},${data.length}) encode ${data}`, word, {
      lines: [{ label: 'Codeword', display: word }, { label: 'Layout', display: layout }, ...parityRows],
      notes: ['Parity bits sit at positions 1, 2, 4, 8, …; parity bit p covers every position whose binary index includes p (even parity). Corrects any single-bit error.'],
    });
  }
  const word = bitsOf(dec![1]!);
  const n = word.length;
  let syn = 0;
  for (let pos = 1; pos <= n; pos++) if (word[pos - 1] === '1') syn ^= pos;
  const corrected = syn && syn <= n ? word.slice(0, syn - 1) + (word[syn - 1] === '1' ? '0' : '1') + word.slice(syn) : word;
  const data = [...corrected].filter((_, i) => (i + 1) & i).join('');
  return answer(input, 'coding', `Hamming decode ${word}`, syn === 0 ? `no error · data ${data}` : syn <= n ? `error at bit ${syn} · data ${data}` : 'uncorrectable', {
    lines: [
      { label: 'Syndrome', display: `${syn.toString(2).padStart(Math.ceil(log2(n + 1)), '0')} = ${syn}` },
      { label: 'Corrected codeword', display: corrected },
      { label: 'Data bits', display: data },
    ],
    notes: ['The syndrome (XOR of the positions of all 1 bits) is the position of a single flipped bit, or 0 if none.'],
  });
}

const CRC_PRESETS: Record<string, { width: number; poly: number; init: number; refin: boolean; refout: boolean; xorout: number; check: number }> = {
  'crc-32': { width: 32, poly: 0x04c11db7, init: 0xffffffff, refin: true, refout: true, xorout: 0xffffffff, check: 0xcbf43926 },
  'crc-16': { width: 16, poly: 0x8005, init: 0, refin: true, refout: true, xorout: 0, check: 0xbb3d }, // CRC-16/ARC
  'crc-16-ccitt': { width: 16, poly: 0x1021, init: 0xffff, refin: false, refout: false, xorout: 0, check: 0x29b1 }, // CCITT-FALSE
  'crc-8': { width: 8, poly: 0x07, init: 0, refin: false, refout: false, xorout: 0, check: 0xf4 },
};

function reflect(x: number, w: number): number {
  let r = 0;
  for (let i = 0; i < w; i++) if (x & (1 << i)) r |= 1 << (w - 1 - i);
  return r >>> 0;
}

export function crcBytes(bytes: Uint8Array, p: (typeof CRC_PRESETS)[string]): number {
  const top = 2 ** (p.width - 1);
  const mask = p.width === 32 ? 0xffffffff : (1 << p.width) - 1;
  let crc = p.init;
  for (const b0 of bytes) {
    const b = p.refin ? reflect(b0, 8) : b0;
    crc = (crc ^ (b << (p.width - 8))) >>> 0;
    for (let k = 0; k < 8; k++) crc = crc & top ? (((crc * 2) ^ p.poly) & mask) >>> 0 : ((crc * 2) & mask) >>> 0;
  }
  if (p.refout) crc = reflect(crc, p.width);
  return ((crc ^ p.xorout) & mask) >>> 0;
}

function crc(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bcrc\b|\bcrc-?\d/.test(lc)) return null;
  const poly = /\b(?:generator|polynomial|poly|divisor|key|g\s*=)\s*(?:=|:)?\s*([01]{2,})\b/i.exec(input);
  if (poly) {
    const msgM = /\b(?:of|for|message|data)\s+([01]{2,})\b/i.exec(input) ?? /\b([01]{3,})\b/.exec(input.replace(poly[0], ''));
    if (!msgM) refuse('Give the message bits');
    const g = poly[1]!.replace(/^0+/, '');
    const msg = msgM![1]!;
    const r = g.length - 1;
    const bits = (msg + '0'.repeat(r)).split('').map(Number);
    const rows: string[][] = [];
    for (let i = 0; i <= bits.length - g.length; i++) {
      if (!bits[i]) continue;
      for (let j = 0; j < g.length; j++) bits[i + j] = bits[i + j]! ^ Number(g[j]);
      if (rows.length < 40) rows.push([String(i), bits.join('')]);
    }
    const rem = bits.slice(-r).join('');
    return answer(input, 'coding', `CRC of ${msg} with generator ${g} (degree ${r})`, `remainder ${rem}`, {
      lines: [
        { label: 'Remainder (CRC)', display: rem },
        { label: 'Transmitted frame', display: msg + rem },
        { label: 'Generator polynomial', display: polyStr(g) },
      ],
      table: { columns: ['XOR at bit', 'working bits'], rows, caption: `Long division of ${msg}${'0'.repeat(r)} by ${g} (mod 2)` },
      notes: ['Append degree-many zeros, divide by the generator with XOR, and send the remainder after the message; the receiver’s remainder is then 0.'],
    });
  }
  const key = /crc-?32/.test(lc) ? 'crc-32' : /crc-?16.*(?:ccitt|xmodem|false)|ccitt/.test(lc) ? 'crc-16-ccitt' : /crc-?16/.test(lc) ? 'crc-16' : /crc-?8/.test(lc) ? 'crc-8' : 'crc-32';
  const text = /["“'‘]([^"”'’]*)["”'’]/.exec(input)?.[1] ?? /\b(?:of|for)\s+(.+)$/i.exec(input)?.[1];
  if (text === undefined) refuse('Give a quoted string, e.g. crc-32 of "hello"');
  const p = CRC_PRESETS[key]!;
  const v = crcBytes(new TextEncoder().encode(text!), p);
  const hex = v.toString(16).toUpperCase().padStart(p.width / 4, '0');
  return answer(input, 'coding', `${key.toUpperCase()} of "${text}"`, `0x${hex}`, { value: v, lines: [{ label: 'Decimal', display: String(v) }, { label: 'Parameters', display: `poly 0x${p.poly.toString(16).toUpperCase()}, init 0x${p.init.toString(16).toUpperCase()}, reflected ${p.refin ? 'yes' : 'no'}, xorout 0x${p.xorout.toString(16).toUpperCase()}` }], notes: [`Check value for "123456789" is 0x${p.check.toString(16).toUpperCase()}.`] });
}

function polyStr(bits: string): string {
  const d = bits.length - 1;
  return [...bits].map((b, i) => (b === '1' ? (d - i === 0 ? '1' : d - i === 1 ? 'x' : `x^${d - i}`) : '')).filter(Boolean).join(' + ');
}

function checksum(input: string): Result {
  const lc = input.toLowerCase();
  if (/\b(?:internet|ip|ipv4|udp|tcp|ones'? complement) checksum\b/.test(lc)) {
    const words = (input.replace(/^.*?checksum(?:\s+(?:of|for))?/i, '').match(/\b[0-9a-f]{4}\b/gi) ?? []).map((h) => parseInt(h, 16));
    if (!words.length) refuse('Give 16-bit words in hex, e.g. “internet checksum 4500 0073 0000 4000 4011 0000 c0a8 0001 c0a8 00c7”');
    let s = 0;
    for (const w of words) {
      s += w;
      s = (s & 0xffff) + (s >>> 16);
    }
    const c = ~s & 0xffff;
    const hex = c.toString(16).toUpperCase().padStart(4, '0');
    return answer(input, 'coding', `Internet checksum of ${words.length} words`, `0x${hex}`, { value: c, lines: [{ label: 'One’s-complement sum', display: `0x${s.toString(16).toUpperCase().padStart(4, '0')}` }, { label: 'Checksum = ~sum', display: `0x${hex}` }], notes: ['RFC 1071: add 16-bit words with end-around carry, then complement. Put the checksum field as 0000 while computing.'] });
  }
  if (/\badler-?32\b/.test(lc) || /\bfletcher-?16\b/.test(lc)) {
    const text = /["“'‘]([^"”'’]*)["”'’]/.exec(input)?.[1] ?? /\b(?:of|for)\s+(.+)$/i.exec(input)?.[1];
    if (text === undefined) refuse('Give a quoted string');
    const bytes = new TextEncoder().encode(text!);
    if (/adler/.test(lc)) {
      let a = 1;
      let b = 0;
      for (const x of bytes) (a = (a + x) % 65521), (b = (b + a) % 65521);
      const v = ((b << 16) | a) >>> 0;
      return answer(input, 'coding', `Adler-32 of "${text}"`, `0x${v.toString(16).toUpperCase().padStart(8, '0')}`, { value: v, lines: [{ label: 'A', display: String(a) }, { label: 'B', display: String(b) }], notes: ['A = 1 + Σ bytes, B = Σ A after each byte, both mod 65521; checksum = B·65536 + A.'] });
    }
    let s1 = 0;
    let s2 = 0;
    for (const x of bytes) (s1 = (s1 + x) % 255), (s2 = (s2 + s1) % 255);
    const v = (s2 << 8) | s1;
    return answer(input, 'coding', `Fletcher-16 of "${text}"`, `0x${v.toString(16).toUpperCase().padStart(4, '0')}`, { value: v, lines: [{ label: 'sum1', display: String(s1) }, { label: 'sum2', display: String(s2) }] });
  }
  return null;
}

function luhn(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bluhn\b|\bmod(?:ulus)?[- ]?10 check\b|\bcredit card (?:check|valid)/.test(lc)) return null;
  const digits = (input.match(/\d[\d\s-]*\d|\d/g) ?? []).join('').replace(/\D/g, '');
  if (digits.length < 2) refuse('Give a number with at least 2 digits');
  const wantCheck = /\bcheck digit\b|\bgenerate\b|\bcompute\b/.test(lc);
  const run = (s: string, dbl: boolean) => {
    let total = 0;
    const steps: string[] = [];
    [...s].reverse().forEach((c, i) => {
      let d = Number(c);
      if ((i % 2 === 1) !== dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      total += d;
      steps.unshift(String(d));
    });
    return { total, steps };
  };
  if (wantCheck) {
    const { total } = run(digits, true);
    const check = (10 - (total % 10)) % 10;
    return answer(input, 'coding', `Luhn check digit for ${digits}`, String(check), { value: check, lines: [{ label: 'Full number', display: digits + check }, { label: 'Sum (doubling from the right)', display: String(total) }] });
  }
  const { total, steps } = run(digits, false);
  const ok = total % 10 === 0;
  return answer(input, 'coding', `Luhn check of ${digits}`, ok ? 'valid' : 'invalid', { lines: [{ label: 'Digits after doubling every second from the right', display: steps.join(' ') }, { label: 'Sum', display: `${total} (${ok ? 'divisible by 10' : `mod 10 = ${total % 10}`})` }], notes: ['Luhn catches every single-digit error and most adjacent transpositions. Passing it doesn’t mean a card number is real.'] });
}

function isbn(input: string): Result {
  const lc = input.toLowerCase();
  const kind = /\bisbn\b/.test(lc) ? 'isbn' : /\b(?:ean|ean-13|upc|gtin|barcode)\b/.test(lc) ? 'ean' : null;
  if (!kind) return null;
  const raw = (/[\dXx][\d\sXx-]{6,}[\dXx]/.exec(input.replace(/isbn(?:-1[03])?:?/i, ' '))?.[0] ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!raw) refuse('Give the number');
  const wantCheck = /\bcheck digit\b|\bcompute\b|\bgenerate\b/.test(lc);
  if ((raw.length === 10 && !wantCheck) || (raw.length === 9 && wantCheck)) {
    const d = [...raw].map((c) => (c === 'X' ? 10 : Number(c)));
    const s = d.slice(0, 9).reduce((a, x, i) => a + (10 - i) * x, 0);
    if (wantCheck) {
      const c = (11 - (s % 11)) % 11;
      return answer(input, 'coding', `ISBN-10 check digit for ${raw}`, c === 10 ? 'X' : String(c), { lines: [{ label: 'Weighted sum Σ(10−i)dᵢ', display: String(s) }, { label: 'Full ISBN', display: raw + (c === 10 ? 'X' : c) }] });
    }
    const tot = s + d[9]!;
    return answer(input, 'coding', `ISBN-10 check of ${raw}`, tot % 11 === 0 ? 'valid' : 'invalid', { lines: [{ label: 'Weighted sum Σ (10..1)·dᵢ', display: `${tot} (${tot % 11 === 0 ? 'divisible by 11' : `mod 11 = ${tot % 11}`})` }], notes: ['ISBN-10 detects every single-digit error and every transposition of two digits.'] });
  }
  const n = wantCheck ? raw.length + 1 : raw.length;
  if (![8, 12, 13, 14].includes(n)) refuse('Expected ISBN-10, ISBN-13, EAN-8/13, UPC-A (12) or GTIN-14');
  const d = [...raw].map(Number);
  const body = wantCheck ? d : d.slice(0, -1);
  // Weights 3,1,3,… from the right of the body.
  const s = body.reduceRight((a, x, i) => a + x * ((body.length - 1 - i) % 2 === 0 ? 3 : 1), 0);
  const c = (10 - (s % 10)) % 10;
  const label = n === 13 ? (kind === 'isbn' ? 'ISBN-13' : 'EAN-13') : n === 12 ? 'UPC-A' : n === 8 ? 'EAN-8' : 'GTIN-14';
  if (wantCheck) return answer(input, 'coding', `${label} check digit for ${raw}`, String(c), { value: c, lines: [{ label: 'Weighted sum (3,1 weights from the right)', display: String(s) }, { label: 'Full number', display: raw + c }] });
  const ok = c === d[d.length - 1];
  return answer(input, 'coding', `${label} check of ${raw}`, ok ? 'valid' : 'invalid', { lines: [{ label: 'Expected check digit', display: String(c) }, { label: 'Given check digit', display: String(d[d.length - 1]) }] });
}

export const infoHandlers = [sourceCoding, jointMeasures, divergence, entropy, capacity, compressionRatio, parity, hamming, crc, checksum, luhn, isbn];
