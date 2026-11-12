import { parseFormula, type Counts } from './formula';
import { fail, ok, prettyFormula, superscript, type Ctx } from './util';


interface Species {
  text: string;
  counts: Counts;
  charge: bigint;
}

const ARROW = /\s*(?:->|-->|→|⟶|=>|⇌|<=>|<->|⇄|=|\byields\b|\bgives\b|\bproduces\b|\bforms\b)\s*/;

function parseSpecies(raw: string): Species | null {
  let t = raw.trim().replace(/^\d+\s*(?=[A-Z(\[])/, '');
  if (t === 'e-' || t === 'e⁻' || t === 'e^-') return { text: 'e⁻', counts: new Map(), charge: -1n };
  let charge = 0n;
  // Charge as ^2-, ^+, {3+}, superscripts (²⁻), or a trailing "3+" / "-".
  const cm = /(?:\^\{?|\{)(\d*)([+-])\}?$/.exec(t) ?? /([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([⁺⁻])$/.exec(t) ?? /(\d*)([+-])$/.exec(t);
  if (cm) {
    const digits = [...cm[1]!].map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(d) >= 0 ? String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(d)) : d).join('');
    const mag = digits ? BigInt(digits) : 1n;
    charge = cm[2] === '+' || cm[2] === '⁺' ? mag : -mag;
    t = t.slice(0, cm.index).replace(/\^$/, '');
  }
  // Physical state labels: (s), (l), (g), (aq).
  t = t.replace(/\((?:s|l|g|aq)\)$/, '');
  const counts = parseFormula(t);
  if (!counts) return null;
  const text = prettyFormula(t) + (charge ? superscript(`${charge < 0n ? -charge : charge === 1n ? '' : charge}`.replace(/^1$/, '') + (charge > 0n ? '+' : '-')) : '');
  return { text, counts, charge };
}

function splitSide(side: string): string[] {
  // "Fe3+ + e-" needs spaced pluses; "Fe+O2" (no spaces) splits on every "+".
  return (/\s\+\s/.test(side) ? side.split(/\s+\+\s+/) : side.split('+')).map((x) => x.trim()).filter(Boolean);
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

type Q = [bigint, bigint];
const q = (n: bigint, d = 1n): Q => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
};
const sub = (a: Q, b: Q): Q => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q): Q => q(a[0] * b[0], a[1] * b[1]);
const div = (a: Q, b: Q): Q => q(a[0] * b[1], a[1] * b[0]);

/** Basis of the rational nullspace of an integer matrix, by exact Gauss–Jordan elimination. */
export function nullspace(matrix: bigint[][], cols: number): Q[][] {
  const A: Q[][] = matrix.map((r) => r.map((v) => q(v)));
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < cols && row < A.length; col++) {
    const p = A.findIndex((r, i) => i >= row && r[col]![0] !== 0n);
    if (p < 0) continue;
    [A[row], A[p]] = [A[p]!, A[row]!];
    const pr = A[row]!;
    const pv = pr[col]!;
    for (let j = 0; j < cols; j++) pr[j] = div(pr[j]!, pv);
    for (let i = 0; i < A.length; i++) {
      if (i === row) continue;
      const r = A[i]!;
      const f = r[col]!;
      if (f[0] === 0n) continue;
      for (let j = 0; j < cols; j++) r[j] = sub(r[j]!, mul(f, pr[j]!));
    }
    pivots.push(col);
    row++;
  }
  const basis: Q[][] = [];
  for (let free = 0; free < cols; free++) {
    if (pivots.includes(free)) continue;
    const v: Q[] = Array.from({ length: cols }, () => q(0n));
    v[free] = q(1n);
    pivots.forEach((pc, i) => (v[pc] = q(-A[i]![free]![0], A[i]![free]![1])));
    basis.push(v);
  }
  return basis;
}

/** "balance Fe + O2 -> Fe2O3", "C3H8 + O2 = CO2 + H2O", "Cu + Ag+ → Cu2+ + Ag". */
export function balance(c: Ctx) {
  const keyword = /^(?:please\s+)?balance(?:\s+the)?(?:\s+(?:chemical\s+)?equation)?\s*:?\s*/i.exec(c.t);
  const body = keyword ? c.t.slice(keyword[0].length) : c.t;
  const parts = body.split(ARROW);
  if (parts.length !== 2) return keyword && body ? fail(c, 'chemistry', 'Write the equation with one arrow, e.g. “Fe + O2 -> Fe2O3”') : null;
  // Without the word "balance", an "=" equation must look like a reaction (has a "+"), so "C1V1=C2V2" isn't taken.
  const arrowText = ARROW.exec(body)![0].trim();
  if (!keyword && arrowText === '=' && !body.includes('+')) return null;
  const lhs = splitSide(parts[0]!);
  const rhs = splitSide(parts[1]!);
  if (!lhs.length || !rhs.length) return keyword ? fail(c, 'chemistry', 'Both sides of the equation need at least one formula') : null;
  const species = [...lhs, ...rhs].map(parseSpecies);
  const bad = species.findIndex((x) => !x);
  if (bad >= 0) return keyword ? fail(c, 'chemistry', `“${[...lhs, ...rhs][bad]}” isn't a chemical formula I can read`) : null;
  const sp = species as Species[];

  const elements = [...new Set(sp.flatMap((x) => [...x.counts.keys()]))];
  const rows = elements.map((el) => sp.map((x, j) => (x.counts.get(el) ?? 0n) * (j < lhs.length ? 1n : -1n)));
  if (sp.some((x) => x.charge !== 0n)) rows.push(sp.map((x, j) => x.charge * (j < lhs.length ? 1n : -1n)));
  const basis = nullspace(rows, sp.length);
  const shown = `${lhs.map((x) => x.replace(/^\d+\s*(?=[A-Z(\[])/, '')).join(' + ')} → ${rhs.map((x) => x.replace(/^\d+\s*(?=[A-Z(\[])/, '')).join(' + ')}`;

  if (basis.length === 0) return fail(c, 'chemistry', `${shown} can't be balanced: no set of coefficients conserves every element${rows.length > elements.length ? ' and the charge' : ''}`);
  if (basis.length > 1) return fail(c, 'chemistry', `${shown} has more than one independent balancing (it combines ${basis.length} separate reactions), so there's no single answer`);
  const v = basis[0]!;
  let lcm = 1n;
  for (const [, d] of v) lcm = (lcm * d) / gcd(lcm, d);
  let ints = v.map(([n, d]) => (n * lcm) / d);
  if (ints.every((x) => x <= 0n)) ints = ints.map((x) => -x);
  if (ints.some((x) => x <= 0n)) {
    const zero = ints.findIndex((x) => x === 0n);
    return fail(c, 'chemistry', zero >= 0 ? `${shown} can't be balanced: ${sp[zero]!.text} would need a coefficient of 0` : `${shown} can't be balanced with positive coefficients (a species is on the wrong side)`);
  }
  const g = ints.reduce((a, b) => gcd(a, b));
  ints = ints.map((x) => x / g);

  const side = (from: number, to: number, pretty: boolean) =>
    sp
      .slice(from, to)
      .map((x, i) => `${ints[from + i] === 1n ? '' : ints[from + i]}${pretty ? x.text : [...lhs, ...rhs][from + i]!.replace(/^\d+\s*(?=[A-Z(\[])/, '').replace(/\((?:s|l|g|aq)\)$/, '')}`)
      .join(' + ');
  const display = `${side(0, lhs.length, true)} → ${side(lhs.length, sp.length, true)}`;
  const plain = `${side(0, lhs.length, false)} → ${side(lhs.length, sp.length, false)}`;
  const spoken = plain.replace(/→/, 'yields').replace(/\+/g, 'plus');

  const table = {
    caption: 'Atoms on each side',
    columns: ['Element', 'Reactants', 'Products'],
    rows: elements.map((el) => {
      let l = 0n;
      let r = 0n;
      sp.forEach((x, j) => {
        const n = (x.counts.get(el) ?? 0n) * ints[j]!;
        if (j < lhs.length) l += n;
        else r += n;
      });
      return [el, String(l), String(r)];
    }),
  };
  const notes = ['Smallest whole-number coefficients, found exactly from the element-conservation equations'];
  if ([...lhs, ...rhs].some((x) => /^\d+\s*(?=[A-Z(\[])/.test(x))) notes.push('Coefficients you wrote were ignored and worked out afresh');
  if (rows.length > elements.length) notes.push('Charge is balanced too');
  return ok(c, {
    kind: 'chemistry',
    expression: `Balance ${sp.slice(0, lhs.length).map((x) => x.text).join(' + ')} → ${sp.slice(lhs.length).map((x) => x.text).join(' + ')}`,
    primary: { display, plain, spoken },
    lines: sp.map((x, j) => ({ label: x.text, display: String(ints[j]) })),
    table,
    notes,
  });
}
