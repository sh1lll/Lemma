import { describe, expect, it } from 'vitest';
import * as L from '../src/matrix/linalg';
import { evaluate, parseEntry, type Value } from '../src/matrix/expr';

const q = (rows: (number | string)[][]): L.Matrix => rows.map((r) => r.map((x) => (typeof x === 'number' ? L.tidy(x) : L.parseExact(x)!)));
const show = (m: L.Matrix, style: L.NumStyle = 'fraction') => m.map((r) => r.map((x) => L.fmt(x, style)).join(' ')).join(' | ');
const env = (extra: Record<string, L.Matrix> = {}) => {
  const ms: Record<string, L.Matrix> = { A: q([[1, 2], [3, 4]]), B: q([[0, 1], [1, 0]]), C: q([[2, 0, 0], [0, 3, 4], [0, 4, 9]]), ...extra };
  return { matrix: (n: string) => ms[n] };
};
const ev = (src: string, e = env()): Value => evaluate(src, e);
const mat = (src: string, e = env()) => {
  const v = ev(src, e);
  if (v.t !== 'matrix') throw new Error(`${src} gave ${v.t}`);
  return show(v.v);
};
const num = (src: string, e = env()) => {
  const v = ev(src, e);
  if (v.t !== 'scalar') throw new Error(`${src} gave ${v.t}`);
  return L.fmt(v.v);
};

describe('exact fractions', () => {
  it('parses and formats', () => {
    expect(L.fmt(L.parseExact('0.25')!)).toBe('1/4');
    expect(L.fmt(L.parseExact('-6/4')!)).toBe('−3/2');
    expect(L.fmt(L.parseExact('2e3')!)).toBe('2000');
    expect(L.fmt(L.parseExact('1/3')!, 'decimal')).toBe('0.3333333333');
    expect(L.parseExact('abc')).toBeNull();
    expect(L.parseExact('1/0')).toBeNull();
  });
  it('reads grid entries, falling back to floats', () => {
    expect(L.fmt(parseEntry('1/2')!)).toBe('1/2');
    expect(L.fmt(parseEntry('')!)).toBe('0');
    expect(L.toF(parseEntry('sqrt(2)')!)).toBeCloseTo(Math.SQRT2, 12);
    expect(L.toF(parseEntry('pi/2')!)).toBeCloseTo(Math.PI / 2, 12);
    expect(parseEntry('A')).toBeNull();
  });
});

describe('matrix arithmetic and expressions', () => {
  it('multiplies, adds, scales, powers and transposes', () => {
    expect(mat('A·B')).toBe('2 1 | 4 3');
    expect(mat('AB')).toBe('2 1 | 4 3');
    expect(mat('A*B - B*A')).toBe('-1 -3 | 3 1'.replace(/-/g, '−'));
    expect(mat('2A + B')).toBe('2 5 | 7 8');
    expect(mat('A^2')).toBe('7 10 | 15 22');
    expect(mat('A²')).toBe('7 10 | 15 22');
    expect(mat('A^3')).toBe('37 54 | 81 118');
    expect(mat('Aᵀ')).toBe('1 3 | 2 4');
    expect(mat('A^T')).toBe('1 3 | 2 4');
    expect(mat('A/2')).toBe('1/2 1 | 3/2 2');
    expect(mat('[[1, 2], [3, 4]] * [[1], [1]]')).toBe('3 | 7');
  });

  it('inverts exactly and checks back to the identity', () => {
    expect(mat('A^-1')).toBe('−2 1 | 3/2 −1/2');
    expect(mat('A⁻¹')).toBe('−2 1 | 3/2 −1/2');
    expect(mat('inv(A)·A')).toBe('1 0 | 0 1');
    expect(mat('A^-2')).toBe(show(L.mulM(L.inverse(q([[1, 2], [3, 4]])), L.inverse(q([[1, 2], [3, 4]])))));
    expect(() => ev('inv([[1, 2], [2, 4]])')).toThrow(/no inverse/);
  });

  it('determinant, trace, rank, rref', () => {
    expect(num('det(A)')).toBe('−2');
    expect(num('det(C)')).toBe('22');
    expect(num('det([[2, 1, 3], [0, -1, 4], [1, 2, 0]])')).toBe(L.fmt(L.det(q([[2, 1, 3], [0, -1, 4], [1, 2, 0]]))));
    expect(num('det([[0, 1], [1, 0]])')).toBe('−1');
    expect(num('trace(A)')).toBe('5');
    expect(num('rank([[1, 2], [2, 4]])')).toBe('1');
    expect(mat('rref([[1, 2, 3], [4, 5, 6], [7, 8, 9]])')).toBe('1 0 −1 | 0 1 2 | 0 0 0');
    expect(num('det(A) * trace(A)')).toBe('−10');
  });

  it('explains mistakes in plain words', () => {
    expect(() => ev('A + C')).toThrow(/Can't add a 3×3 matrix to a 2×2 one/);
    expect(() => ev('A * C')).toThrow(/columns of the first must match/);
    expect(() => ev('det(Z)')).toThrow(/no matrix Z/);
    expect(() => ev('A / B')).toThrow(/inverse/);
    expect(() => ev('det([[1, 2, 3]])')).toThrow(/square/);
  });
});

describe('decompositions and eigen', () => {
  it('null space', () => {
    const v = ev('null([[1, 2], [2, 4]])');
    expect(v.t === 'parts' && show(v.parts[0]!.value as L.Matrix)).toBe('−2 | 1');
    const none = ev('null(A)');
    expect(none.t === 'parts' && none.parts[0]!.label).toBe('Only the zero vector');
  });

  it('LU with pivoting reproduces PA', () => {
    const a = q([[0, 2, 1], [1, 1, 0], [2, 0, 3]]);
    const { P, L: Lm, U } = L.lu(a);
    expect(show(L.mulM(P, a))).toBe(show(L.mulM(Lm, U)));
    expect(U.every((r, i) => r.every((x, j) => j >= i || L.isZero(x)))).toBe(true);
  });

  it('QR is orthonormal and reproduces A', () => {
    const a = q([[1, 1], [1, 0], [0, 1]]);
    const { Q, R } = L.qr(a);
    const back = L.mulM(Q, R);
    back.forEach((r, i) => r.forEach((x, j) => expect(L.toF(x)).toBeCloseTo(L.toF(a[i]![j]!), 10)));
    const qtq = L.mulM(L.transpose(Q), Q);
    qtq.forEach((r, i) => r.forEach((x, j) => expect(L.toF(x)).toBeCloseTo(i === j ? 1 : 0, 10)));
  });

  it('eigenvalues: rational, surds, complex and repeated', () => {
    const labels = (src: string) => {
      const v = ev(src);
      return v.t === 'parts' ? v.parts.map((p) => p.value) : [];
    };
    expect(labels('eigenvalues(C)')).toEqual(['11', '2', '1']);
    expect(labels('eigenvalues([[1, 1], [1, 0]])')).toEqual(['1/2 + √5/2', '1/2 − √5/2']);
    expect(labels('eigenvalues([[0, -1], [1, 0]])')).toEqual(['i', '−i']);
    expect(labels('eigenvalues([[2, 0], [0, 2]])')).toEqual(['2']);
    expect(ev('eigenvalues([[2, 0], [0, 2]])').t === 'parts' && (ev('eigenvalues([[2, 0], [0, 2]])') as { parts: { label: string }[] }).parts[0]!.label).toBe('λ₁ (×2)');
    // A 4×4 with no rational roots falls back to numeric roots.
    const m = q([[4, 1, 0, 0], [1, 3, 1, 0], [0, 1, 2, 1], [0, 0, 1, 1]]);
    const vals = L.eigenvalues(m);
    const tr = vals.reduce((s, e) => s + e.re * e.multiplicity, 0);
    expect(tr).toBeCloseTo(10, 8);
  });

  it('eigenvectors satisfy Av = λv', () => {
    for (const a of [q([[2, 0, 0], [0, 3, 4], [0, 4, 9]]), q([[1, 1], [1, 0]]), q([[4, 1], [2, 3]])]) {
      for (const { value, vectors } of L.eigenvectors(a)) {
        expect(vectors.length).toBeGreaterThan(0);
        for (const v of vectors) {
          const av = L.mulM(a, v).map((r) => L.toF(r[0]!));
          v.forEach((r, i) => expect(av[i]!).toBeCloseTo(value.re * L.toF(r[0]!), 6));
        }
      }
    }
  });

  it('characteristic polynomial', () => {
    expect(L.charpoly(q([[1, 2], [3, 4]])).map((x) => L.fmt(x))).toEqual(['1', '−5', '−2']);
  });
});
