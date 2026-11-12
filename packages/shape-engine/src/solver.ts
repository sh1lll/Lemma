import { exText, ex, snap, V, type Ex } from './exact';

/**
 * Shapes as variables plus relations. Each relation can be solved for any one unknown, so whatever is given,
 * repeated passes fill in everything they can (forward or backward: "volume 500 and radius 4 → height").
 * When that stalls (two unknowns tied together, e.g. a rectangle from its area and perimeter) the shape's basis
 * parameters are found numerically (Levenberg–Marquardt from many starts, so every solution is found), snapped
 * back to exact values where they are clean, and the passes run again.
 */

export type Dim = 0 | 1 | 2 | 3 | 'angle' | 'count';

export interface VarDef {
  key: string;
  sym: string;
  label: string;
  dim: Dim;
  /** Phrases that name this measurement in a question ("slant height"). */
  words?: string[];
  /** One-letter names, used only with "=" or ":" ("r = 4"). */
  letters?: string[];
  /** Words after a number ("10 m tall"). */
  post?: string[];
  /** Internal helper (not shown). */
  hidden?: boolean;
  /** Integer-valued (number of sides). */
  int?: boolean;
  /** Allowed to be zero or negative (offsets). */
  signed?: boolean;
}

type Get = (k: string) => V;

export type Rel =
  | { kind: 'mono'; t: string; te: number; k: V; kRat: [bigint, bigint]; kIrr: string; f: [string, number][]; text: string }
  | { kind: 'sum'; terms: { v: string | null; c: V; p: 1 | 2; left?: boolean }[]; text: string }
  | { kind: 'fn'; t: string; deps: string[]; f: (g: Get) => V | null; text: string; inv?: Record<string, { f: (g: Get) => V | null; text: string }>; noNumericInverse?: boolean };

export interface Shape {
  id: string;
  name: string;
  vars: VarDef[];
  rels: Rel[];
  basis: string[];
  /** Fixed values (n = 6 for a hexagon). */
  fixed?: Record<string, V>;
  /** Reorders symmetric solutions (rectangle: length ≥ width). */
  canon?: (vals: Record<string, number>) => Record<string, number>;
  /** Default measurement to report when nothing specific is asked. */
  main: string;
  /** For bare numbers with no name ("rectangle 8 by 6"): which variables they fill, in order. */
  positional?: string[];
  notes?: string[];
  threeD?: boolean;
  /** Extra fact lines once solved. */
  extra?: (g: (k: string) => V | undefined) => { label: string; display: string }[];
  /** Checks a solved shape is valid (e.g. a frustum's top smaller than its base); returns a problem or null. */
  check?: (g: (k: string) => V | undefined) => string | null;
}

// ---------- DSL ----------

const SUPS: Record<string, string> = { '2': '²', '3': '³', '-1': '⁻¹', '4': '⁴' };

function constTok(tok: string, consts: Record<string, V>): { v: V; rat?: [bigint, bigint]; irr?: string } | null {
  if (/^\d+(?:\.\d+)?(?:\/\d+)?$/.test(tok)) {
    const [a, b] = tok.split('/');
    const v = V.dec(a!)!.div(b ? V.dec(b)! : V.rat(1));
    const r = ex.rational(v.e!)!;
    return { v, rat: [r.n, r.d] };
  }
  if (tok === 'π') return { v: V.PI, irr: 'π' };
  if (tok === 'π^2' || tok === 'π²') return { v: V.PI.mul(V.PI), irr: 'π²' };
  if (/^√\d+$/.test(tok)) return { v: V.dec(tok.slice(1))!.sqrt(), irr: tok };
  if (tok.startsWith('$')) {
    const c = consts[tok.slice(1)];
    if (!c) throw new Error(`unknown constant ${tok}`);
    return { v: c, irr: c.e ? `(${exText(c.e)})` : tok.slice(1) };
  }
  return null;
}

export const pretty = (s: string) => s.replace(/\^(-1|2|3|4)/g, (_m, p: string) => SUPS[p]!);

/** Joins factors: single letters and numbers run together ("πr²h"); longer symbols get a dot ("2·hₐ"). */
function joinFactors(xs: string[]): string {
  let out = '';
  for (const x of xs) {
    if (!out) out = x;
    else {
      const prev = out[out.length - 1]!;
      const tight = /^[a-zA-Zπ√(][²³⁻¹⁴]*$/.test(x.replace(/[²³⁻¹⁴]/g, '')) && x.replace(/[²³⁻¹⁴]/g, '').length === 1 && !/\d/.test(x[0]!);
      out += tight || /^[π√(]/.test(x) || (/[\d)]/.test(prev) && !/^\d/.test(x)) ? x : '·' + x;
    }
  }
  return out;
}

const pw = (s: string, p: number) => s + (p === 1 ? '' : SUPS[String(p)] ?? `^${p}`);

/** Monomial: "V = 1/3 π r^2 h". */
export function M(src: string, consts: Record<string, V> = {}): Rel {
  const [lhs, rhs] = src.split('=').map((x) => x.trim());
  const [t, tePart] = lhs!.split('^');
  let k = V.rat(1);
  let n = 1n;
  let d = 1n;
  const irr: string[] = [];
  const f: [string, number][] = [];
  for (const tok of rhs!.split(/\s+/)) {
    const c = constTok(tok, consts);
    if (c) {
      k = k.mul(c.v);
      if (c.rat) {
        n *= c.rat[0];
        d *= c.rat[1];
      } else irr.push(c.irr!);
      continue;
    }
    const [v, p] = tok.split('^');
    f.push([v!, p ? Number(p) : 1]);
  }
  return { kind: 'mono', t: t!, te: tePart ? Number(tePart) : 1, k, kRat: [n, d], kIrr: irr.join(''), f, text: '' };
}

function monoText(r: Extract<Rel, { kind: 'mono' }>, sym: (k: string) => string): string {
  const [n, d] = r.kRat;
  const parts: string[] = [];
  const pos = r.f.filter(([, p]) => p > 0).map(([v, p]) => pw(sym(v), p));
  const neg = r.f.filter(([, p]) => p < 0).map(([v, p]) => pw(sym(v), -p));
  const plainFrac = d !== 1n && !r.kIrr;
  const ratTxt = d !== 1n ? (plainFrac ? (n !== 1n ? String(n) : '') : `(${n}/${d})`) : n !== 1n ? String(n) : '';
  if (ratTxt) parts.push(ratTxt);
  if (r.kIrr) parts.push(r.kIrr);
  let rhs = joinFactors([...parts, ...pos]) || '1';
  const den = [...(plainFrac ? [String(d)] : []), ...neg];
  if (den.length) rhs = `${rhs}/${den.length > 1 ? `(${joinFactors(den)})` : den[0]}`;
  return `${pw(sym(r.t), r.te)} = ${rhs}`;
}

/** Sum of single-variable terms with powers 1 or 2: "d^2 = l^2 + w^2", "P = 2 l + 2 w", "A = π R^2 - π r^2". */
export function S(src: string, consts: Record<string, V> = {}): Rel {
  const [lhs, rhs] = src.split('=');
  const terms: { v: string | null; c: V; p: 1 | 2; left: boolean; tok: string[] }[] = [];
  const side = (txt: string, sign: number) => {
    for (const raw of txt.replace(/\s*([+-])\s*/g, ' $1 ').trim().split(/\s+(?=[+-]\s)/)) {
      let toks = raw.trim().split(/\s+/);
      let sg = sign;
      if (toks[0] === '+' || toks[0] === '-') {
        if (toks[0] === '-') sg = -sg;
        toks = toks.slice(1);
      }
      let c = V.rat(sg);
      let v: string | null = null;
      let p: 1 | 2 = 1;
      for (const tok of toks) {
        const k = constTok(tok, consts);
        if (k) c = c.mul(k.v);
        else {
          const [name, pwr] = tok.split('^');
          v = name!;
          p = pwr === '2' ? 2 : 1;
        }
      }
      terms.push({ v, c, p, left: sign > 0, tok: toks });
    }
  };
  side(lhs!, 1);
  side(rhs!, -1);
  return { kind: 'sum', terms, text: '' };
}

function sumText(r: Extract<Rel, { kind: 'sum' }>, sym: (k: string) => string): string {
  const termsOf = (left: boolean) => {
    const ts = (r.terms as { v: string | null; c: V; p: 1 | 2; left?: boolean }[]).filter((t) => (t.left ?? true) === left);
    return ts
      .map((t, i) => {
        const c = left ? t.c : t.c.neg();
        const piece = coefTimes(c, t.v ? sym(t.v) : '', t.p).replace(/^([+−])$/, '$11');
        const sign = piece[0]!;
        let body = piece.slice(1);
        if (!t.v) body = c.e ? exText(c.e).replace(/^−/, '') : String(Math.abs(c.x));
        return i === 0 ? (sign === '−' ? '−' + body : body) : ` ${sign === '−' ? '−' : '+'} ${body}`;
      })
      .join('');
  };
  return `${termsOf(true)} = ${termsOf(false)}`;
}

/** Fills in display text with the shape's symbols. */
export function finalize(shape: Shape): Shape {
  const defs = new Map(shape.vars.map((v) => [v.key, v]));
  const sym = (k: string) => defs.get(k)?.sym ?? k;
  for (const r of shape.rels) {
    if (r.kind === 'mono' && !r.text) r.text = monoText(r, sym);
    if (r.kind === 'sum' && !r.text) r.text = sumText(r, sym);
  }
  return shape;
}

export function F(t: string, deps: string[], f: (g: Get) => V | null, text: string, inv?: Record<string, { f: (g: Get) => V | null; text: string }>, opts: { noNumericInverse?: boolean } = {}): Rel {
  return { kind: 'fn', t, deps, f, text, inv, ...opts };
}

export function relVars(r: Rel): string[] {
  if (r.kind === 'mono') return [r.t, ...r.f.map(([v]) => v)];
  if (r.kind === 'sum') return r.terms.filter((x) => x.v).map((x) => x.v!);
  return [r.t, ...r.deps];
}

// ---------- rearranged formula text ----------

function coefTimes(c: V, sym: string, p: 1 | 2): string {
  const s = sym + (p === 2 ? '²' : '');
  const t = c.e ? exText(c.e) : String(c.x);
  const neg = t.startsWith('−');
  const a = neg ? t.slice(1) : t;
  let body: string;
  if (a === '1') body = s;
  else if (/^1\/(.+)$/.test(a)) body = `${s}/${a.slice(2)}`;
  else if (/^(\d+)\/(\d+)$/.test(a)) {
    const [n, d] = a.split('/');
    body = `${n}${s}/${d}`;
  } else if (/^[\dπ√]+$/.test(a)) body = `${a}${s}`;
  else body = `${a}·${s}`;
  return (neg ? '−' : '+') + body;
}

function sumSolveText(r: Extract<Rel, { kind: 'sum' }>, x: string, sym: (k: string) => string): string {
  const me = r.terms.find((t) => t.v === x)!;
  const parts: string[] = [];
  for (const t of r.terms) {
    if (t === me) continue;
    const c = t.c.neg().div(me.c);
    if (!t.v) parts.push((c.x < 0 ? '−' : '+') + (c.e ? exText(c.e).replace(/^−/, '') : String(Math.abs(c.x))));
    else parts.push(coefTimes(c, sym(t.v), t.p));
  }
  parts.sort((a, b) => (a.startsWith('+') ? 0 : 1) - (b.startsWith('+') ? 0 : 1));
  let body = parts.map((p, i) => (i === 0 ? (p.startsWith('−') ? '−' + p.slice(1) : p.slice(1)) : p.startsWith('−') ? ` − ${p.slice(1)}` : ` + ${p.slice(1)}`)).join('');
  if (me.p === 2) body = `√(${body})`;
  return `${sym(x)} = ${body}`;
}

function monoSolveText(r: Extract<Rel, { kind: 'mono' }>, x: string, sym: (k: string) => string): string {
  const num: string[] = [];
  const den: string[] = [];
  if (x === r.t) return `${sym(x)} = ${r.text.split('=')[1]!.trim()}`;
  const e = r.f.find(([v]) => v === x)![1];
  const [n, d] = r.kRat;
  if (d !== 1n) num.push(String(d));
  num.push(pw(sym(r.t), r.te));
  if (n !== 1n) den.push(String(n));
  if (r.kIrr) den.push(r.kIrr);
  for (const [v, p] of r.f) {
    if (v === x) continue;
    if (p > 0) den.push(pw(sym(v), p));
    else num.push(pw(sym(v), -p));
  }
  let N = joinFactors(num);
  let Dn = joinFactors(den);
  if (e < 0) [N, Dn] = [Dn || '1', N === '1' ? '' : N];
  const inner = Dn ? `${N}/${Dn.length > 1 ? `(${Dn})` : Dn}` : N;
  const a = Math.abs(e);
  const body = a === 1 ? inner : a === 2 ? `√(${inner})` : a === 3 ? `∛(${inner})` : `(${inner})^(1/${a})`;
  return `${sym(x)} = ${body}`;
}

// ---------- solving ----------

export interface Known {
  v: V;
  /** "given", "numeric" (found numerically), or the formula used. */
  how: string;
}

export interface SolveState {
  known: Map<string, Known>;
  conflicts: string[];
  invalid: string[];
  /** Several numerical solutions (each a full state). */
  alternatives?: Map<string, Known>[];
  numeric?: boolean;
}

const isLen = (d: Dim) => d === 1 || d === 2 || d === 3;

function valid(def: VarDef | undefined, v: V): boolean {
  if (!Number.isFinite(v.x)) return false;
  if (!def) return true;
  if (def.signed) return true;
  if (isLen(def.dim)) return v.x > 1e-14 * 0 && v.x > 0;
  if (def.dim === 'angle') return v.x > 0 && (def.key === 'Σ' || v.x < 360);
  if (def.dim === 'count') return v.x > 0;
  return true;
}

function solveRel(r: Rel, x: string, g: Get, defs: Map<string, VarDef>): { v: V; text: string } | null | 'multi' {
  const sym = (k: string) => defs.get(k)?.sym ?? k;
  if (r.kind === 'mono') {
    if (x === r.t) {
      let v = r.k;
      for (const [k, p] of r.f) v = v.mul(g(k).pow(p));
      return { v: r.te === 1 ? v : v.pow(1 / r.te), text: r.text };
    }
    const e = r.f.find(([k]) => k === x)![1];
    let rest = r.k;
    for (const [k, p] of r.f) if (k !== x) rest = rest.mul(g(k).pow(p));
    const v = g(r.t).pow(r.te).div(rest).pow(1 / e);
    return { v, text: monoSolveText(r, x, sym) };
  }
  if (r.kind === 'sum') {
    const me = r.terms.find((t) => t.v === x)!;
    let acc = V.rat(0);
    for (const t of r.terms) {
      if (t === me) continue;
      acc = acc.add(t.c.mul(t.v ? g(t.v).pow(t.p) : V.rat(1)));
    }
    let v = acc.neg().div(me.c);
    if (me.p === 2) {
      if (v.x < -1e-12) return null;
      v = v.x < 0 ? V.rat(0) : v.sqrt();
    }
    return { v, text: sumSolveText(r, x, sym) };
  }
  if (x === r.t) {
    const v = r.f(g);
    return v ? { v, text: r.text } : null;
  }
  const inv = r.inv?.[x];
  if (inv) {
    const v = inv.f(g);
    return v ? { v, text: inv.text } : null;
  }
  if (r.noNumericInverse) return null;
  // Numeric inverse over the variable's natural range.
  const def = defs.get(x);
  const target = g(r.t).x;
  const at = (y: number) => {
    const v = r.f((k) => (k === x ? V.of(y) : g(k)));
    return v ? v.x - target : NaN;
  };
  const roots: number[] = [];
  const grid: number[] = [];
  if (def?.dim === 'angle') for (let i = 1; i < 720; i++) grid.push(i / 4);
  else {
    const scale = Math.max(1e-9, ...r.deps.filter((k) => k !== x).map((k) => Math.abs(g(k).x)), Math.abs(target) ** (1 / Math.max(1, typeof def?.dim === 'number' ? def.dim : 1)));
    for (let i = -400; i <= 400; i++) grid.push(scale * 10 ** (i / 50));
  }
  let pa = grid[0]!;
  let fa = at(pa);
  for (let i = 1; i < grid.length; i++) {
    const pb = grid[i]!;
    const fb = at(pb);
    if (Number.isFinite(fa) && Number.isFinite(fb) && (fa === 0 || fa * fb < 0)) {
      let lo = pa;
      let hi = pb;
      let flo = fa;
      for (let it = 0; it < 200 && hi - lo > 1e-15 * Math.abs(hi); it++) {
        const mid = (lo + hi) / 2;
        const fm = at(mid);
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      const root = (lo + hi) / 2;
      if (Math.abs(at(root)) < 1e-9 * Math.max(1, Math.abs(target))) roots.push(root);
    }
    pa = pb;
    fa = fb;
  }
  const uniq = roots.filter((y, i) => i === 0 || Math.abs(y - roots[i - 1]!) > 1e-9 * Math.max(1, Math.abs(y)));
  if (uniq.length > 1) return 'multi';
  if (uniq.length === 0) return null;
  const y = uniq[0]!;
  const s = def?.dim === 'angle' ? snapAngle(y) : snap(y);
  return { v: s, text: `${sym(x)} from ${r.text} (solved numerically)` };
}

function snapAngle(y: number): V {
  const r = Math.round(y * 4) / 4;
  return Math.abs(r - y) < 1e-9 ? V.rat(Math.round(y * 4), 4) : V.of(y);
}

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** Fills in every variable the relations allow. Mutates `st`. */
export function propagate(shape: Shape, st: SolveState, numericOnly = false): void {
  const defs = new Map(shape.vars.map((v) => [v.key, v]));
  const k = st.known;
  const g: Get = (key) => k.get(key)!.v;
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const r of shape.rels) {
      const vs = relVars(r);
      const unknown = vs.filter((v) => !k.has(v));
      if (unknown.length === 0) {
        if (numericOnly || !vs.some((v) => k.get(v)!.how === 'given')) continue;
        // all known: consistency check on relations that involve given values
        const t = r.kind === 'sum' ? null : r.t;
        if (t) {
          const res = solveRel(r, t, g, defs);
          if (res && res !== 'multi' && !close(res.v.x, g(t).x, 1e-6)) {
            const msg = `${pretty(r.text)} doesn't hold for the given values (${defs.get(t)?.label ?? t} would be ${res.v.x.toPrecision(6)})`;
            if (!st.conflicts.includes(msg)) st.conflicts.push(msg);
          }
        } else if (r.kind === 'sum') {
          let acc = 0;
          let mag = 0;
          for (const term of r.terms) {
            const val = term.c.x * (term.v ? g(term.v).x ** term.p : 1);
            acc += val;
            mag = Math.max(mag, Math.abs(val));
          }
          if (Math.abs(acc) > 1e-6 * Math.max(1, mag)) {
            const msg = `${r.text} doesn't hold for the given values`;
            if (!st.conflicts.includes(msg)) st.conflicts.push(msg);
          }
        }
        continue;
      }
      if (unknown.length !== 1) continue;
      const x = unknown[0]!;
      const defX = defs.get(x);
      let res: ReturnType<typeof solveRel>;
      try {
        res = solveRel(r, x, g, defs);
      } catch {
        res = null;
      }
      if (!res || res === 'multi') continue;
      let v = numericOnly ? res.v.float() : res.v;
      if (defX?.int && Number.isFinite(v.x)) {
        const n = Math.round(v.x);
        if (Math.abs(v.x - n) > 1e-6 || n < 3) {
          if (!numericOnly) st.invalid.push(`${defX.label} would be ${v.x.toPrecision(6)}, which isn't a whole number of at least 3`);
          continue;
        }
        v = V.rat(n);
      }
      if (!valid(defX, v)) {
        if (!numericOnly) {
          const msg = `${defX?.label ?? x} would be ${Number.isFinite(v.x) ? v.x.toPrecision(6) : 'undefined'}, so these measurements can't belong to one ${shape.name}`;
          if (!st.invalid.includes(msg)) st.invalid.push(msg);
        }
        continue;
      }
      k.set(x, { v, how: res.text });
      changed = true;
    }
    if (!changed) break;
  }
}

// ---------- numerical solving for the basis ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-300) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export function numericSolve(shape: Shape, given0: Map<string, Known>): Record<string, number>[] {
  const given = new Map<string, Known>([...Object.entries(shape.fixed ?? {}).map(([k, v]) => [k, { v, how: 'fixed' }] as [string, Known]), ...given0]);
  const defs = new Map(shape.vars.map((v) => [v.key, v]));
  const unknownBasis = shape.basis.filter((b) => !given.has(b));
  const fixedBasis = shape.basis.filter((b) => given.has(b));
  const cons = [...given.keys()].filter((k) => !shape.basis.includes(k) && !(shape.fixed && k in shape.fixed));
  if (cons.length < unknownBasis.length || unknownBasis.length === 0) return [];
  const n = unknownBasis.length;
  const kinds = unknownBasis.map((b) => defs.get(b)!.dim);
  const toVal = (t: number, i: number) => (kinds[i] === 'angle' ? 180 / (1 + Math.exp(-t)) : defs.get(unknownBasis[i]!)!.signed ? t : Math.exp(t));
  const fromVal = (v: number, i: number) => (kinds[i] === 'angle' ? -Math.log(180 / v - 1) : defs.get(unknownBasis[i]!)!.signed ? v : Math.log(v));
  const targets = cons.map((c) => given.get(c)!.v.x);
  const resid = (t: number[]): number[] | null => {
    const st: SolveState = { known: new Map(), conflicts: [], invalid: [] };
    for (const b of fixedBasis) st.known.set(b, { v: given.get(b)!.v.float(), how: 'given' });
    for (const [k, v] of Object.entries(shape.fixed ?? {})) st.known.set(k, { v, how: 'given' });
    unknownBasis.forEach((b, i) => st.known.set(b, { v: V.of(toVal(t[i]!, i)), how: 'trial' }));
    propagate(shape, st, true);
    const out: number[] = [];
    for (let j = 0; j < cons.length; j++) {
      const got = st.known.get(cons[j]!);
      if (!got || !Number.isFinite(got.v.x)) return null;
      out.push((got.v.x - targets[j]!) / Math.max(1e-300, Math.abs(targets[j]!)));
    }
    return out;
  };
  // Scale guesses from the given magnitudes.
  const mags: number[] = [];
  for (const [k, kv] of given) {
    const d = defs.get(k)?.dim;
    if (typeof d === 'number' && d > 0) mags.push(Math.abs(kv.v.x) ** (1 / d));
  }
  const scale = mags.length ? Math.exp(mags.reduce((a, m) => a + Math.log(m), 0) / mags.length) : 1;
  const rand = rng(12345);
  const sols: number[][] = [];
  for (let start = 0; start < 48; start++) {
    let t = unknownBasis.map((_, i) => (kinds[i] === 'angle' ? fromVal(5 + rand() * 170, i) : defs.get(unknownBasis[i]!)!.signed ? (rand() - 0.5) * 4 * scale : Math.log(scale * 10 ** (rand() * 3 - 1.5))));
    let r = resid(t);
    if (!r) continue;
    let lambda = 1e-3;
    let cost = r.reduce((a, x) => a + x * x, 0);
    for (let it = 0; it < 200 && cost > 1e-28; it++) {
      const J: number[][] = r.map(() => new Array(n).fill(0));
      let bad = false;
      for (let i = 0; i < n; i++) {
        const h = 1e-7 * Math.max(1, Math.abs(t[i]!));
        const t2 = [...t];
        t2[i]! += h;
        const r2 = resid(t2);
        if (!r2) {
          bad = true;
          break;
        }
        for (let j = 0; j < r.length; j++) J[j]![i] = (r2[j]! - r[j]!) / h;
      }
      if (bad) break;
      const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)));
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, j) => s + row[a]! * r![j]!, 0));
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const A = JtJ.map((row, a) => row.map((x, b) => (a === b ? x * (1 + lambda) + 1e-30 : x)));
        const step = solveLinear(A, Jtr.map((x) => -x));
        if (!step) break;
        const tn = t.map((x, i) => x + step[i]!);
        const rn = resid(tn);
        const cn = rn ? rn.reduce((a, x) => a + x * x, 0) : Infinity;
        if (cn < cost) {
          t = tn;
          r = rn!;
          cost = cn;
          lambda = Math.max(1e-12, lambda / 5);
          improved = true;
          break;
        }
        lambda *= 8;
      }
      if (!improved) break;
    }
    if (cost < 1e-22) {
      let vals = Object.fromEntries(unknownBasis.map((b, i) => [b, toVal(t[i]!, i)]));
      if (shape.canon) {
        const all = { ...Object.fromEntries(fixedBasis.map((b) => [b, given.get(b)!.v.x])), ...vals };
        const c = shape.canon(all);
        vals = Object.fromEntries(unknownBasis.map((b) => [b, c[b]!]));
      }
      const vec = unknownBasis.map((b) => vals[b]!);
      if (vec.every((x, i) => Number.isFinite(x) && (kinds[i] !== 'angle' || (x > 1e-9 && x < 180 - 1e-9))) && !sols.some((s) => s.every((x, i) => close(x, vec[i]!, 1e-7)))) sols.push(vec);
    }
  }
  return sols.map((vec) => Object.fromEntries(unknownBasis.map((b, i) => [b, vec[i]!])));
}

/** Runs the full solve: propagation, then numerical basis solving if needed (all solutions). */
export function solveShape(shape: Shape, given: Map<string, Known>): SolveState {
  const st: SolveState = { known: new Map(given), conflicts: [], invalid: [] };
  for (const [k, v] of Object.entries(shape.fixed ?? {})) if (!st.known.has(k)) st.known.set(k, { v, how: 'fixed' });
  propagate(shape, st);
  if (shape.basis.every((b) => st.known.has(b)) || st.invalid.length) return st;
  const sols = numericSolve(shape, st.known.size > given.size ? onlyGiven(st, given) : given);
  if (sols.length === 0) return st;
  const states = sols.map((sol) => {
    const s2: SolveState = { known: new Map(given), conflicts: [], invalid: [] };
    for (const [k, v] of Object.entries(shape.fixed ?? {})) if (!s2.known.has(k)) s2.known.set(k, { v, how: 'fixed' });
    for (const [b, x] of Object.entries(sol)) {
      const def = shape.vars.find((v) => v.key === b)!;
      s2.known.set(b, { v: def.dim === 'angle' ? snapAngle(x) : snap(x), how: 'numeric' });
    }
    propagate(shape, s2);
    return s2;
  });
  const first = states[0]!;
  first.numeric = true;
  if (states.length > 1) first.alternatives = states.slice(1).map((s) => s.known);
  return first;
}

function onlyGiven(st: SolveState, given: Map<string, Known>): Map<string, Known> {
  void st;
  return given;
}

export function exOf(v: V): Ex | null {
  return v.e;
}
