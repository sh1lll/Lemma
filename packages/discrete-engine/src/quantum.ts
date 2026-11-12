// Quantum computing math on small state vectors: kets, normalisation, gates (Pauli, H, S, T, CNOT, CZ, SWAP),
// tensor products, Born-rule probabilities and Bloch angles.
import { answer, compile, fmt, refuse, type Line, type Result } from './util';

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const abs2 = (a: C) => a[0] * a[0] + a[1] * a[1];
const S2 = Math.SQRT1_2;

/** Amplitude text like "1/sqrt2", "i/√2", "(1+i)/2", "-0.6" → complex. */
function amp(t: string): C {
  const s = t.trim().replace(/√\s*\(?\s*(\d+)\s*\)?/g, 'sqrt($1)').replace(/sqrt\s*(\d+)/gi, 'sqrt($1)').replace(/−/g, '-');
  if (!s || s === '+') return [1, 0];
  if (s === '-') return [-1, 0];
  const f = compile(s.replace(/\bi\b/g, ' qi ').replace(/(\d)\s*qi/g, '$1*qi'), ['qi']);
  const re = f(0);
  const im = f(1) - re;
  if (!Number.isFinite(re) || !Number.isFinite(im) || Math.abs(f(2) - (re + 2 * im)) > 1e-9) refuse(`Couldn’t read the amplitude “${t}”`);
  return [re, im];
}

/** Parses kets: "|0>", "0.6|0> + 0.8|1>", "(|00> + |11>)/sqrt2", "|+>", or a vector "[0.6, 0.8]". */
export function parseState(s0: string): C[] | null {
  const s = s0.replace(/⟩|〉/g, '>').replace(/\|\s*/g, '|').trim();
  const vec = /^\[([^\]]+)\]$/.exec(s) ?? /^\(([^()|]+(?:,[^()|]+)+)\)$/.exec(s);
  if (vec) {
    const v = vec[1]!.split(',').map(amp);
    if (v.length < 2 || (v.length & (v.length - 1))) refuse('A state vector needs 2, 4, 8, … amplitudes');
    return v;
  }
  if (!s.includes('|')) return null;
  // Overall factor "(…)/sqrt2" or "1/sqrt2 (…)".
  let factor: C = [1, 0];
  let body = s;
  let m = /^\((.+)\)\s*\/\s*(.+)$/.exec(s);
  if (m && m[1]!.includes('|')) {
    body = m[1]!;
    const d = amp(m[2]!);
    factor = [d[0] / abs2(d), -d[1] / abs2(d)];
  } else if ((m = /^([^|(]*?)\s*\((.+)\)$/.exec(s)) && m[2]!.includes('|') && m[1]!.trim()) {
    body = m[2]!;
    factor = amp(m[1]!.replace(/\*\s*$/, ''));
  }
  const terms = [...body.matchAll(/([+-]?)\s*([^|+]*?)\s*\*?\s*\|([01+\-ir]+)>/g)];
  if (!terms.length) return null;
  const labels = terms.map((t) => t[3]!);
  const n = labels[0]!.length;
  if (labels.some((l) => l.length !== n)) refuse('All kets must have the same number of qubits');
  let state: C[] = new Array(2 ** n).fill(0).map(() => [0, 0] as C);
  for (const t of terms) {
    const sign = t[1] === '-' ? -1 : 1;
    let a = amp(t[2]!.trim() || '1');
    a = [a[0] * sign, a[1] * sign];
    const ket = basisKet(t[3]!);
    state = state.map((v, i) => add(v, mul(a, ket[i]!)));
  }
  return state.map((v) => mul(v, factor));
}

function basisKet(label: string): C[] {
  const single: Record<string, C[]> = {
    '0': [[1, 0], [0, 0]],
    '1': [[0, 0], [1, 0]],
    '+': [[S2, 0], [S2, 0]],
    '-': [[S2, 0], [-S2, 0]],
    i: [[S2, 0], [0, S2]],
    r: [[S2, 0], [0, S2]],
  };
  let v: C[] = [[1, 0]];
  for (const ch of label) {
    const k = single[ch];
    if (!k) refuse(`Unknown ket |${label}⟩`);
    v = tensor(v, k!);
  }
  return v;
}

export function tensor(a: C[], b: C[]): C[] {
  const out: C[] = [];
  for (const x of a) for (const y of b) out.push(mul(x, y));
  return out;
}

type M = C[][];
const GATES: Record<string, M> = {
  I: [[[1, 0], [0, 0]], [[0, 0], [1, 0]]],
  X: [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
  Y: [[[0, 0], [0, -1]], [[0, 1], [0, 0]]],
  Z: [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
  H: [[[S2, 0], [S2, 0]], [[S2, 0], [-S2, 0]]],
  S: [[[1, 0], [0, 0]], [[0, 0], [0, 1]]],
  T: [[[1, 0], [0, 0]], [[0, 0], [S2, S2]]],
};
const TWO: Record<string, M> = {
  CNOT: perm([0, 1, 3, 2]),
  SWAP: perm([0, 2, 1, 3]),
  CZ: [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? ([i === 3 ? -1 : 1, 0] as C) : ([0, 0] as C)))),
};
function perm(p: number[]): M {
  return p.map((pi) => p.map((_, j) => (j === pi ? ([1, 0] as C) : ([0, 0] as C))));
}

function kron(A: M, B: M): M {
  const out: M = [];
  for (const ra of A)
    for (const rb of B) {
      const row: C[] = [];
      for (const a of ra) for (const b of rb) row.push(mul(a, b));
      out.push(row);
    }
  return out;
}
const apply = (G: M, v: C[]): C[] => G.map((r) => r.reduce((s, g, j) => add(s, mul(g, v[j]!)), [0, 0] as C));

const tidy = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
function cstr(c: C): string {
  const [re, im] = [tidy(c[0]), tidy(c[1])];
  const known = (x: number) => (Math.abs(Math.abs(x) - S2) < 1e-12 ? `${x < 0 ? '−' : ''}1/√2` : Math.abs(Math.abs(x) - 0.5) < 1e-12 ? `${x < 0 ? '−' : ''}1/2` : fmt(x, 6).replace(/^-/, '−'));
  if (im === 0) return known(re);
  if (re === 0) return `${known(im)}i`.replace(/^1i$/, 'i').replace(/^−1i$/, '−i');
  return `(${known(re)} ${im < 0 ? '−' : '+'} ${known(Math.abs(im))}i)`;
}
export function ketStr(v: C[]): string {
  const n = Math.log2(v.length);
  const parts = v.map((a, i) => (abs2(a) > 1e-20 ? `${cstr(a) === '1' ? '' : cstr(a) === '−1' ? '−' : cstr(a)}|${i.toString(2).padStart(n, '0')}⟩` : '')).filter(Boolean);
  return parts.join(' + ').replace(/\+ −/g, '− ') || '0';
}

function probsTable(v: C[]) {
  const n = Math.log2(v.length);
  return { columns: ['basis', 'amplitude', 'probability'], rows: v.map((a, i) => [`|${i.toString(2).padStart(n, '0')}⟩`, cstr(a), fmt(tidy(abs2(a)), 6)]) };
}

function bloch(v: C[]): Line[] {
  if (v.length !== 2) return [];
  const nrm = Math.sqrt(abs2(v[0]!) + abs2(v[1]!));
  let [a, b] = [v[0]!.map((x) => x / nrm) as C, v[1]!.map((x) => x / nrm) as C];
  // Remove global phase so α is real and non-negative.
  const ph = Math.atan2(a[1], a[0]);
  const rot: C = [Math.cos(-ph), Math.sin(-ph)];
  a = mul(a, rot);
  b = mul(b, rot);
  const theta = 2 * Math.acos(Math.min(1, Math.max(-1, a[0])));
  const phi = abs2(b) < 1e-20 ? 0 : ((Math.atan2(b[1], b[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const deg = (x: number) => `${fmt(tidy(x), 6)} rad = ${fmt(tidy((x * 180) / Math.PI), 6)}°`;
  return [
    { label: 'Bloch θ', display: deg(theta) },
    { label: 'Bloch φ', display: deg(phi) },
    { label: 'Bloch vector (x, y, z)', display: `(${[Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)].map((x) => fmt(tidy(x), 6)).join(', ')})` },
  ];
}

function gateMatrix(name: string, n: number, target: number, control?: number): M {
  const g = name.toUpperCase();
  if (TWO[g] || g === 'CX') {
    if (n === 2 && (control === undefined || (control === 0 && target === 1))) return TWO[g === 'CX' ? 'CNOT' : g]!;
    if (control === undefined) refuse(`${g} needs control and target qubits`);
    // General controlled-X / CZ / SWAP on n qubits by permutation.
    const N = 2 ** n;
    const bit = (i: number, q: number) => (i >> (n - 1 - q)) & 1;
    return Array.from({ length: N }, (_, r) =>
      Array.from({ length: N }, (_, c) => {
        let img = c;
        let ph = 1;
        if (g === 'CNOT' || g === 'CX') img = bit(c, control!) ? c ^ (1 << (n - 1 - target)) : c;
        else if (g === 'CZ') ph = bit(c, control!) && bit(c, target) ? -1 : 1;
        else if (g === 'SWAP') {
          const a = bit(c, control!);
          const b = bit(c, target);
          img = a === b ? c : c ^ (1 << (n - 1 - control!)) ^ (1 << (n - 1 - target));
        }
        return (r === img ? [ph, 0] : [0, 0]) as C;
      }),
    );
  }
  const G = GATES[g];
  if (!G) refuse(`Unknown gate ${name}`);
  let out: M = [[[1, 0]]];
  for (let q = 0; q < n; q++) out = kron(out, q === target ? G! : GATES.I!);
  return out;
}

const GATE_WORD: [RegExp, string][] = [
  [/\bhadamard\b|\bh\b/i, 'H'],
  [/\bpauli[- ]?x\b|\bnot gate\b|\bbit[- ]flip\b|\bx\b/i, 'X'],
  [/\bpauli[- ]?y\b|\by\b/i, 'Y'],
  [/\bpauli[- ]?z\b|\bphase[- ]flip\b|\bz\b/i, 'Z'],
  [/\bphase gate\b|\bs\b/i, 'S'],
  [/\bt gate\b|\bπ\/8\b|\bt\b/i, 'T'],
  [/\bcnot\b|\bcx\b|\bcontrolled[- ]not\b/i, 'CNOT'],
  [/\bcz\b|\bcontrolled[- ]z\b/i, 'CZ'],
  [/\bswap\b/i, 'SWAP'],
];

function quantum(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\|[^|]*[>⟩]|\bqubits?\b|\bbloch\b|\bhadamard\b|\bpauli\b|\bcnot\b|\bket\b|\bquantum (?:state|gate|circuit)\b|\bbell state\b|\btensor product\b/.test(lc)) return null;
  if (/\bbell states?\b/.test(lc) && !/\|/.test(input)) {
    const which = /phi\s*-|φ\s*-|Φ⁻/i.test(input) ? 'Φ⁻' : /psi\s*\+|ψ\s*\+|Ψ⁺/i.test(input) ? 'Ψ⁺' : /psi\s*-|ψ\s*-|Ψ⁻/i.test(input) ? 'Ψ⁻' : 'Φ⁺';
    const v: C[] = { 'Φ⁺': [[S2, 0], [0, 0], [0, 0], [S2, 0]], 'Φ⁻': [[S2, 0], [0, 0], [0, 0], [-S2, 0]], 'Ψ⁺': [[0, 0], [S2, 0], [S2, 0], [0, 0]], 'Ψ⁻': [[0, 0], [S2, 0], [-S2, 0], [0, 0]] }[which] as C[];
    return answer(input, 'quantum', `Bell state |${which}⟩`, ketStr(v), { table: probsTable(v), notes: ['Prepared from |00⟩ by H on qubit 1 then CNOT (with X/Z for the other three). Maximally entangled: measuring one qubit fixes the other.'] });
  }
  // Tensor product of two states.
  const tp = /\btensor (?:product )?(?:of )?(.+?)\s+(?:and|with|⊗)\s+(.+)$/i.exec(input) ?? (/⊗/.test(input) && !/\b[HXYZIST]\s*⊗/.test(input) ? /^(?:.*?:\s*)?(.+?)\s*⊗\s*(.+)$/.exec(input) : null);
  if (tp) {
    const a = parseState(tp[1]!.trim());
    const b = parseState(tp[2]!.trim());
    if (a && b) {
      const v = tensor(a, b);
      return answer(input, 'quantum', `Tensor product ${ketStr(a)} ⊗ ${ketStr(b)}`, ketStr(v), { table: probsTable(v), notes: ['(a|0⟩ + b|1⟩) ⊗ (c|0⟩ + d|1⟩) = ac|00⟩ + ad|01⟩ + bc|10⟩ + bd|11⟩. A product state is not entangled.'] });
    }
  }
  // Find the state: the last ket expression or vector in the input.
  const stM = /((?:\(?\s*[-+]?\s*(?:[\d./√()i\s*+-]|sqrt)*\|[01+\-ir]+[>⟩]\s*)+\)?(?:\s*\/\s*(?:√\s*\d+|sqrt\s*\(?\d+\)?|\d+(?:\.\d+)?))?|\[[^\]]+\])\s*\??\s*$/i.exec(input.replace(/⟩/g, '>'));
  let state = stM ? parseState(stM[1]!.trim()) : null;
  if (!state) {
    const any = /(\(?[^a-z]*\|[01+\-]+>[^a-z]*)/i.exec(input.replace(/⟩/g, '>'));
    state = any ? parseState(any[1]!.trim()) : null;
  }
  if (!state) refuse('Give a state like |0⟩, 0.6|0⟩ + 0.8|1⟩, (|00⟩ + |11⟩)/√2 or [0.6, 0.8]');
  const n = Math.log2(state!.length);
  const norm2 = state!.reduce((s, a) => s + abs2(a), 0);
  const prefix = stM ? input.slice(0, stM.index) : input;
  // Gates to apply, in order of mention ("H then CNOT on |00>", "apply X to qubit 1 of |00>").
  const ops: { g: string; target: number; control?: number }[] = [];
  const opText = prefix.replace(/\b(?:apply|then|and|on|to|of|the|gate|followed by|state|qubit\s*\d+|act\w*|operate\w*)\b/gi, (w) => (/^qubit/i.test(w) ? w : ' '));
  const re = /\b(hadamard|pauli[- ]?[xyz]|cnot|cx|cz|swap|controlled[- ](?:not|z)|bit[- ]flip|phase[- ]flip|phase gate|[hxyzst])(?:\s*(?:gate)?\s*(?:on|to)?\s*qubits?\s*(\d)(?:\s*(?:and|,|->|→)\s*(\d))?)?(?:\s*\(\s*(\d)\s*(?:,\s*(\d))?\s*\))?/gi;
  for (const m of opText.matchAll(re)) {
    const word = m[1]!;
    const g = GATE_WORD.find(([r]) => r.test(word))?.[1];
    if (!g) continue;
    const a = m[2] ?? m[4];
    const b = m[3] ?? m[5];
    if (TWO[g]) ops.push({ g, control: a !== undefined ? Number(a) - 1 : 0, target: b !== undefined ? Number(b) - 1 : 1 });
    else ops.push({ g, target: a !== undefined ? Number(a) - 1 : 0 });
    // "H⊗H" / "H ⊗ I": each factor acts on its own qubit.
  }
  const kronM = /\b([HXYZIST])\s*⊗\s*([HXYZIST])(?:\s*⊗\s*([HXYZIST]))?/.exec(prefix);
  const measure = /\bmeasur\w*|\bprobabilit\w*|\bborn\b/.test(lc);
  const wantNorm = /\bnormali[sz]\w*|\bis .* normali[sz]ed\b|\bvalid state\b/.test(lc);
  const wantBloch = /\bbloch\b/.test(lc);
  let v = state!;
  const lines: Line[] = [];
  const notes: string[] = [];
  if (Math.abs(norm2 - 1) > 1e-9) {
    if (wantNorm || measure || wantBloch || ops.length || kronM) {
      const k = Math.sqrt(norm2);
      v = v.map((a) => [a[0] / k, a[1] / k] as C);
      notes.push(`Normalised: the squared amplitudes summed to ${fmt(norm2, 8)}, so every amplitude was divided by √${fmt(norm2, 8)}.`);
    }
  }
  if (kronM) {
    const fs = [kronM[1]!, kronM[2]!, kronM[3]].filter(Boolean) as string[];
    if (fs.length !== n) refuse(`${fs.join('⊗')} acts on ${fs.length} qubits but the state has ${n}`);
    const G = fs.map((f) => GATES[f]!).reduce((A, B) => kron(A, B));
    v = apply(G, v);
    lines.push({ label: 'Applied', display: `${fs.join(' ⊗ ')}` });
  } else
    for (const op of ops) {
      if (op.target >= n || (op.control !== undefined && op.control >= n)) refuse(`The state has only ${n} qubit${n > 1 ? 's' : ''}`);
      if (TWO[op.g] && n < 2) refuse(`${op.g} needs two qubits`);
      v = apply(gateMatrix(op.g, n, op.target, op.control), v);
      lines.push({ label: `Apply ${op.g}${TWO[op.g] ? ` (control ${op.control! + 1}, target ${op.target + 1})` : n > 1 ? ` on qubit ${op.target + 1}` : ''}`, display: ketStr(v) });
    }
  const applied = ops.length > 0 || !!kronM;
  if (wantNorm && !applied && !measure) {
    const ok = Math.abs(norm2 - 1) < 1e-9;
    return answer(input, 'quantum', `Normalisation of ${ketStr(state!)}`, ok ? 'already normalised' : ketStr(v), { lines: [{ label: 'Σ|amplitude|²', display: fmt(norm2, 8) }], table: probsTable(v), notes });
  }
  if (wantBloch) lines.push(...bloch(v));
  if (n === 2 && v.length === 4) {
    const det = add(mul(v[0]!, v[3]!), mul([-1, 0], mul(v[1]!, v[2]!)));
    const conc = 2 * Math.sqrt(abs2(det));
    lines.push({ label: 'Entangled', display: conc > 1e-9 ? `yes (concurrence ${fmt(conc, 6)})` : 'no (product state)' });
  }
  if (measure && n >= 2) {
    const p1 = v.reduce((s, a, i) => (i >> (n - 1)) & 1 ? s + abs2(a) : s, 0);
    lines.push({ label: 'P(first qubit = 1)', display: fmt(tidy(p1), 6) });
  }
  const what = applied ? `${ops.map((o) => o.g).join(' then ') || kronM![0]} on ${ketStr(state!)}` : measure ? `Measurement probabilities for ${ketStr(v)}` : wantBloch ? `Bloch sphere angles of ${ketStr(v)}` : `State ${ketStr(v)}`;
  notes.push('Born rule: P(outcome) = |amplitude|². Global phase is unobservable.');
  return answer(input, 'quantum', what, applied ? ketStr(v) : measure ? v.map((a, i) => `P(${i.toString(2).padStart(n, '0')}) = ${fmt(tidy(abs2(a)), 6)}`).join(', ') : wantBloch ? `θ = ${lines.find((l) => l.label === 'Bloch θ')?.display.split(' =')[0]}, φ = ${lines.find((l) => l.label === 'Bloch φ')?.display.split(' =')[0]}` : ketStr(v), {
    lines,
    table: probsTable(v),
    notes,
  });
}

export const quantumHandlers = [quantum];
