import { V } from './exact';

/**
 * Polynomials in x, y, z with exact coefficients, parsed from equations such as "3x + 4y - 5 = 0",
 * "(x - 2)^2 + (y + 3)^2 = 25", "x^2/9 + y^2/4 = 1" or "2x - y + 3z = 7". Only what lines, planes and
 * conics need: + − × ÷(by constants) and whole powers.
 */

export type Poly = Map<string, V>; // key "a,b,c" = x^a y^b z^c

const key = (a: number, b: number, c: number) => `${a},${b},${c}`;
const parseKey = (k: string) => k.split(',').map(Number) as [number, number, number];

function add(p: Poly, q: Poly, sign = 1): Poly {
  const out: Poly = new Map(p);
  for (const [k, v] of q) {
    const cur = out.get(k);
    const nv = sign < 0 ? v.neg() : v;
    const sum = cur ? cur.add(nv) : nv;
    if (Math.abs(sum.x) < 1e-14) out.delete(k);
    else out.set(k, sum);
  }
  return out;
}
function mul(p: Poly, q: Poly): Poly {
  let out: Poly = new Map();
  for (const [k1, v1] of p)
    for (const [k2, v2] of q) {
      const [a1, b1, c1] = parseKey(k1);
      const [a2, b2, c2] = parseKey(k2);
      out = add(out, new Map([[key(a1 + a2, b1 + b2, c1 + c2), v1.mul(v2)]]));
    }
  return out;
}
const constP = (v: V): Poly => new Map(v.x === 0 ? [] : [[key(0, 0, 0), v]]);
export const degree = (p: Poly) => Math.max(0, ...[...p.keys()].map((k) => parseKey(k).reduce((a, b) => a + b, 0)));

type Tok = { t: 'num'; v: V } | { t: 'var'; v: 'x' | 'y' | 'z' } | { t: 'op'; v: string };

function lex(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i));
    if (m) {
      out.push({ t: 'num', v: V.dec(m[0])! });
      i += m[0].length;
      continue;
    }
    if (ch === 'x' || ch === 'y' || ch === 'z') {
      out.push({ t: 'var', v: ch });
      i++;
      continue;
    }
    if (ch === '²' || ch === '³') {
      out.push({ t: 'op', v: '^' }, { t: 'num', v: V.rat(ch === '²' ? 2 : 3) });
      i++;
      continue;
    }
    if ('+-*/^()·×'.includes(ch)) {
      out.push({ t: 'op', v: ch === '·' || ch === '×' ? '*' : ch });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

/** Recursive descent with implicit multiplication ("2x", "3(x+1)", "xy"). */
function parseExpr(toks: Tok[]): Poly | null {
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === 'op' && t.v === v;
  };
  const expr = (): Poly | null => {
    let neg = false;
    if (isOp('-') || isOp('+')) {
      neg = (toks[i] as { v: string }).v === '-';
      i++;
    }
    let left = term();
    if (!left) return null;
    if (neg) left = mul(left, constP(V.rat(-1)));
    while (isOp('+') || isOp('-')) {
      const op = (toks[i++] as { v: string }).v;
      const r = term();
      if (!r) return null;
      left = add(left, r, op === '-' ? -1 : 1);
    }
    return left;
  };
  const term = (): Poly | null => {
    let left = power();
    if (!left) return null;
    for (;;) {
      if (isOp('*')) {
        i++;
        const r = power();
        if (!r) return null;
        left = mul(left, r);
      } else if (isOp('/')) {
        i++;
        const r = power();
        if (!r || degree(r) !== 0 || r.size !== 1) return null;
        const c = r.get(key(0, 0, 0))!;
        left = mul(left, constP(V.rat(1).div(c)));
      } else if (peek() && (peek()!.t === 'num' || peek()!.t === 'var' || isOp('('))) {
        const r = power();
        if (!r) return null;
        left = mul(left, r);
      } else return left;
    }
  };
  const power = (): Poly | null => {
    let base = atom();
    if (!base) return null;
    if (isOp('^')) {
      i++;
      const e = peek();
      if (!e || e.t !== 'num' || !Number.isInteger(e.v.x) || e.v.x < 0 || e.v.x > 6) return null;
      i++;
      let r: Poly = constP(V.rat(1));
      for (let k = 0; k < e.v.x; k++) r = mul(r, base);
      base = r;
    }
    return base;
  };
  const atom = (): Poly | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === 'num') {
      i++;
      return constP(t.v);
    }
    if (t.t === 'var') {
      i++;
      return new Map([[key(t.v === 'x' ? 1 : 0, t.v === 'y' ? 1 : 0, t.v === 'z' ? 1 : 0), V.rat(1)]]);
    }
    if (isOp('(')) {
      i++;
      const e = expr();
      if (!e || !isOp(')')) return null;
      i++;
      return e;
    }
    if (isOp('-')) {
      i++;
      const a = power();
      return a ? mul(a, constP(V.rat(-1))) : null;
    }
    return null;
  };
  const e = expr();
  return e && i === toks.length ? e : null;
}

/** "lhs = rhs" → lhs − rhs as a polynomial (or an expression with no "=" taken as "= 0"). */
export function parseEquation(src: string): Poly | null {
  const parts = src.split('=');
  if (parts.length > 2) return null;
  const sides = parts.map((p) => {
    const toks = lex(p.trim());
    return toks && toks.length ? parseExpr(toks) : null;
  });
  if (sides.some((x) => !x)) return null;
  return parts.length === 2 ? add(sides[0]!, sides[1]!, -1) : sides[0]!;
}

export const coef = (p: Poly, a: number, b: number, c = 0): V => p.get(key(a, b, c)) ?? V.rat(0);
export const vars = (p: Poly) => {
  const s = new Set<string>();
  for (const k of p.keys()) {
    const [a, b, c] = parseKey(k);
    if (a) s.add('x');
    if (b) s.add('y');
    if (c) s.add('z');
  }
  return s;
};

/** Pulls equations out of free text: "the line 3x + 4y = 5", "y = 2x + 3", "x^2+y^2-4x=0". */
export function findEquations(t: string): { src: string; poly: Poly; start: number; end: number }[] {
  const out: { src: string; poly: Poly; start: number; end: number }[] = [];
  const re = /[-+(\d.xyz][-+*/^()\d.xyz²³\s·]*=[-+*/^()\d.xyz²³\s·]*[\d.xyz)²³]/g;
  for (const m of t.matchAll(re)) {
    const src = m[0].trim();
    if (!/[xyz]/.test(src)) continue;
    const poly = parseEquation(src);
    if (poly) out.push({ src, poly, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}
