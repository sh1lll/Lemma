import { at, compile, ExprError, isBuiltin, namesIn, normalizeSource, parseExpr, show, tokenize, values, type C, type Env, type Expr, type Fn, type Scope } from './expr';
import { fitModel } from './fit';
import type { Comparator, GraphItem } from './spec';

/**
 * The graphing workspace's rows → drawable items. Rows see each other: "a = 2" is a slider, "b = 2a" a derived value,
 * "L = [1, 2, 3]" a list, "f(x) = x²" a function, table columns are lists, and "y₁ ~ m x₁ + b" fits m and b (which
 * other rows can then use). Each row is classified by what it says: y = …, x = …, r = …, z = …, an equation or
 * (compound) inequality in x and y, a point or a parametric curve, a 3D point, curve or surface, a vector, or a bare
 * value ("= 5"). Restrictions in braces after a row ({x > 0}, {0 ≤ t ≤ π}) mask it, and become the sampling range
 * when they bound t, θ, u, v or x by numbers.
 */

export interface RowIn {
  id: number;
  text: string;
}

export interface TableIn {
  id: number;
  cols: { name: string; values: (number | null)[] }[];
  connect?: boolean;
}

export interface BuildOptions {
  angle?: 'rad' | 'deg';
  /** Current values of sliders (defaults for names that aren't set by a row). */
  params?: Record<string, number>;
  /** Calculator variables. */
  consts?: ReadonlyMap<string, number>;
  /** Calculator functions. */
  extFns?: (name: string) => ((...a: number[]) => number) | null;
}

export type RowKind = 'empty' | 'slider' | 'define' | 'function' | 'list' | 'curve' | 'point' | 'regression' | 'value' | 'surface' | 'error';

export interface RowOut {
  id: number;
  kind: RowKind;
  items: GraphItem[];
  error?: string;
  slider?: { name: string; value: number };
  /** Computed value to show under the row: "= 5", "= [1, 4, 9]", "≈ 2.667". */
  value?: string;
  fit?: { params: [string, number][]; r2: number; n: number; model: string };
  /** 3 when the row can only be drawn in 3D; 2 for flat items; 0 for none. */
  dims: 0 | 2 | 3;
  /** Names this row needs that nothing defines (offered as sliders). */
  missing: string[];
}

export interface BuildResult {
  rows: Map<number, RowOut>;
  tables: Map<number, { items: GraphItem[]; error?: string }>;
  /** Names used but not defined anywhere: automatic sliders. */
  missing: string[];
  /** Slider rows' values by name. */
  sliders: Record<string, number>;
}

const PLOT = new Set(['x', 'y', 'z', 't', 'theta', 'u', 'v', 'r']);
const CONSTS = new Set(['pi', 'tau', 'e', 'inf']);
const TAU = 2 * Math.PI;

/** "x₁", "x_1", "y_{1}" → the name the expression language uses ("x_1"); null when it isn't one name. */
export function columnName(text: string): string | null {
  try {
    const t = tokenize(text);
    return t.length === 1 && t[0]!.k === 'name' ? (t[0] as { v: string }).v : null;
  } catch {
    return null;
  }
}

const isNum = (e: Expr): number | null => (e.t === 'num' ? e.v : e.t === 'neg' && e.a.t === 'num' ? -e.a.v : null);

/** Trailing restriction braces: "x² {x > 0}" → core x², restrictions [x > 0]. */
function peel(e: Expr): { core: Expr; restr: Expr[] } {
  const restr: Expr[] = [];
  const strip = (n: Expr): Expr => {
    while (n.t === 'bin' && n.op === '*' && n.b.t === 'piece' && n.b.cases.length && n.b.cases.every((c) => c.cond && !c.val)) {
      restr.unshift(...n.b.cases.map((c) => c.cond!));
      n = n.a;
    }
    return n;
  };
  let core = strip(e);
  if (core.t === 'cmp') {
    const last = core.args.length - 1;
    const tail = strip(core.args[last]!);
    if (tail !== core.args[last]) core = { ...core, args: [...core.args.slice(0, last), tail] };
  }
  return { core, restr };
}

function subst(e: Expr, from: string, to: string): Expr {
  const rec = (n: Expr): Expr => {
    if (n.t === 'name') return n.name === from ? { t: 'name', name: to } : n;
    const out: Record<string, unknown> = { ...n };
    for (const [k, v] of Object.entries(n)) {
      if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && 't' in x ? rec(x as Expr) : x && typeof x === 'object' ? { cond: x.cond && rec(x.cond), val: x.val && rec(x.val) } : x));
      else if (v && typeof v === 'object' && 't' in v) out[k] = rec(v as Expr);
    }
    return out as Expr;
  };
  return rec(e);
}

export function fmtValue(v: number): string {
  if (Number.isNaN(v)) return 'undefined';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e9 || a < 1e-6) return v.toExponential(4).replace(/\.?0+e/, 'e').replace('-', '−');
  return String(Number(v.toPrecision(8))).replace('-', '−');
}

export function buildRows(rows: RowIn[], tables: TableIn[] = [], opts: BuildOptions = {}): BuildResult {
  const angle = opts.angle ?? 'rad';
  const out = new Map<number, RowOut>();
  const tablesOut = new Map<number, { items: GraphItem[]; error?: string }>();
  const defs = new Map<string, Expr>();
  const lists = new Map<string, Expr | number[]>();
  const fns = new Map<string, { params: string[]; body: Expr }>();
  const consts = new Map<string, number>(opts.consts ?? []);
  const sliders: Record<string, number> = {};
  const owner = new Map<string, number>();
  const missingAll = new Set<string>();

  const res = (id: number, kind: RowKind, extra: Partial<RowOut> = {}): RowOut => ({ id, kind, items: [], dims: 0, missing: [], ...extra });
  const claim = (name: string, id: number) => {
    const prev = owner.get(name);
    if (prev !== undefined && prev !== id) throw new ExprError(`${name} is already defined in another row`);
    if (PLOT.has(name) || CONSTS.has(name)) throw new ExprError(`${name} can’t be redefined`);
    owner.set(name, id);
  };

  // ---------- tables: columns are lists ----------
  for (const t of tables) {
    try {
      for (const c of t.cols) {
        const name = columnName(c.name);
        if (!name) throw new ExprError(`“${c.name}” isn’t a valid column name (try x₁)`);
        claim(name, -t.id);
        lists.set(name, c.values.map((v) => (v === null ? NaN : v)));
      }
    } catch (err) {
      tablesOut.set(t.id, { items: [], error: (err as Error).message });
    }
  }

  // ---------- parse, and collect definitions ----------
  interface P {
    id: number;
    ast?: Expr;
    fitL?: Expr;
    fitR?: Expr;
    err?: string;
    role?: 'slider' | 'define' | 'function' | 'list';
    name?: string;
  }
  const parsed: P[] = [];
  const words = new Set<string>();
  for (const r of rows) {
    const text = r.text.trim();
    if (!text) {
      out.set(r.id, res(r.id, 'empty'));
      continue;
    }
    const p: P = { id: r.id };
    parsed.push(p);
    try {
      const tilde = normalizeSource(text).split('~');
      if (tilde.length === 2) {
        p.fitL = parseExpr(tilde[0]!, words);
        p.fitR = parseExpr(tilde[1]!, words);
        continue;
      }
      if (tilde.length > 2) throw new ExprError('Use one ~ in a regression');
      const ast = (p.ast = parseExpr(text, words));
      if (ast.t === 'cmp' && ast.ops.length === 1 && ast.ops[0] === '=') {
        const [l, rr] = ast.args as [Expr, Expr];
        if (l.t === 'name' && !PLOT.has(l.name) && !CONSTS.has(l.name)) {
          const v = isNum(rr);
          const usesPlot = [...namesIn(rr)].some((n) => n === 'x' || n === 'y' || n === 'z');
          if (v !== null) {
            claim(l.name, r.id);
            p.role = 'slider';
            p.name = l.name;
            sliders[l.name] = v;
          } else if (rr.t === 'list' || rr.t === 'range') {
            claim(l.name, r.id);
            p.role = 'list';
            p.name = l.name;
            lists.set(l.name, rr);
          } else if (!usesPlot) {
            claim(l.name, r.id);
            p.role = 'define';
            p.name = l.name;
            defs.set(l.name, rr);
          }
        } else if (l.t === 'call' && /^[a-zA-Z](_\w+)?$/.test(l.name) && !isBuiltin(l.name) && l.args.length && l.args.every((a) => a.t === 'name')) {
          const params = l.args.map((a) => (a as { name: string }).name);
          claim(l.name, r.id);
          p.role = 'function';
          p.name = l.name;
          fns.set(l.name, { params, body: rr });
        }
      }
    } catch (err) {
      p.err = (err as Error).message;
    }
  }

  const params: Env = { ...(opts.params ?? {}), ...sliders };
  const scope = (free: string[], missing: Set<string>, polarXY = false): Scope => ({
    angle,
    free: new Set([...free, ...Object.keys(sliders)]),
    defs,
    lists,
    fns,
    consts,
    extFns: opts.extFns,
    missing,
    polarXY,
    params,
  });

  // ---------- regressions first: their parameters become values other rows can use ----------
  for (const p of parsed) {
    if (!p.fitL || !p.fitR || p.err) continue;
    try {
      const lhs = compile(p.fitL, scope([], new Set()));
      if (lhs.n === null) throw new ExprError('The left side of ~ should be a list, e.g. a table column y₁');
      const known = (n: string) => defs.has(n) || lists.has(n) || n in sliders || fns.has(n) || consts.has(n) || CONSTS.has(n);
      const pnames = [...namesIn(p.fitR)].filter((n) => !known(n) && !PLOT.has(n)).sort();
      if (!pnames.length) throw new ExprError('The model has no parameters to fit (e.g. y₁ ~ m x₁ + b)');
      if (pnames.length > 8) throw new ExprError('Too many parameters to fit');
      const rhs = compile(p.fitR, scope(pnames, new Set()));
      const ys = values(lhs, params);
      const n = Math.min(ys.length, rhs.n ?? ys.length);
      const env: Env = { ...params };
      const model = (q: number[], k: number) => {
        pnames.forEach((nm, j) => (env[nm] = q[j]!));
        env.__k = k;
        return rhs.f(env);
      };
      const fit = fitModel(model, ys.slice(0, n), pnames.length);
      if (fit.n < pnames.length) throw new ExprError(`Need at least ${pnames.length} data points`);
      if (!fit.params.every(Number.isFinite) || !Number.isFinite(fit.sse)) throw new ExprError('That model couldn’t be fitted to this data');
      pnames.forEach((nm, j) => {
        if (!owner.has(nm)) {
          owner.set(nm, p.id);
          consts.set(nm, fit.params[j]!);
        }
      });
      // Draw the fitted curve: the (one) list on the right becomes x.
      const used = [...namesIn(p.fitR)].filter((nm) => lists.has(nm));
      const items: GraphItem[] = [];
      if (used.length === 1) {
        const curve = compile(subst(p.fitR, used[0]!, 'x'), scope(['x'], new Set()));
        if (curve.n === null) items.push({ kind: 'explicit', id: p.id, label: `${show(p.fitL)} ~ ${show(p.fitR)}`, f: curve.f });
      }
      out.set(p.id, res(p.id, 'regression', { items, dims: items.length ? 2 : 0, fit: { params: pnames.map((nm, j) => [nm, fit.params[j]!]), r2: fit.r2, n: fit.n, model: show(p.fitR) } }));
    } catch (err) {
      out.set(p.id, res(p.id, 'error', { error: (err as Error).message }));
    }
  }

  // ---------- everything else ----------
  for (const p of parsed) {
    if (out.has(p.id)) continue;
    if (p.err || !p.ast) {
      out.set(p.id, res(p.id, 'error', { error: p.err ?? 'Can’t read that' }));
      continue;
    }
    const missing = new Set<string>();
    try {
      const r = classify(p.id, p.ast, p.role, p.name, missing);
      r.missing = [...missing];
      for (const m of missing) missingAll.add(m);
      out.set(p.id, r);
    } catch (err) {
      out.set(p.id, res(p.id, 'error', { error: (err as Error).message, missing: [...missing] }));
    }
  }

  // ---------- table points ----------
  for (const t of tables) {
    if (tablesOut.has(t.id)) continue;
    const items: GraphItem[] = [];
    const xs = t.cols[0]?.values ?? [];
    for (let j = 1; j < t.cols.length; j++) {
      const ys = t.cols[j]!.values;
      const pts: number[] = [];
      for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
        const x = xs[k];
        const y = ys[k];
        if (x !== null && y !== null && x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) pts.push(x, y);
      }
      if (pts.length) items.push({ kind: 'scatter', id: t.id, label: `${t.cols[0]!.name}, ${t.cols[j]!.name}`, points: pts, connect: t.connect });
    }
    tablesOut.set(t.id, { items });
  }

  return { rows: out, tables: tablesOut, missing: [...missingAll].filter((m) => !(m in sliders)).sort(), sliders };

  // ---------- classification ----------
  function classify(id: number, ast: Expr, role: P['role'], name: string | undefined, missing: Set<string>): RowOut {
    if (role === 'slider') return res(id, 'slider', { slider: { name: name!, value: sliders[name!]! } });
    if (role === 'list') {
      const c = compile(lists.get(name!) as Expr, scope([], missing));
      const vs = values(c, params);
      return res(id, 'list', { value: `= [${vs.slice(0, 12).map(fmtValue).join(', ')}${vs.length > 12 ? ', …' : ''}]` });
    }
    if (role === 'define') {
      const c = compile(defs.get(name!)!, scope([], missing));
      const vs = values(c, params);
      return res(id, 'define', { value: c.n === null ? `= ${fmtValue(vs[0]!)}` : `= [${vs.slice(0, 12).map(fmtValue).join(', ')}]` });
    }
    if (role === 'function') {
      const fn = fns.get(name!)!;
      const label = show(ast);
      if (fn.params.length === 1 && fn.params[0] === 'x') {
        const c = compile({ t: 'call', name: name!, args: [{ t: 'name', name: 'x' }] }, scope(['x'], missing));
        return res(id, 'function', { items: family(c, (f) => ({ kind: 'explicit', id, label, f })), dims: 2 });
      }
      if (fn.params.length === 2 && fn.params[0] === 'x' && fn.params[1] === 'y') {
        const c = compile({ t: 'call', name: name!, args: [{ t: 'name', name: 'x' }, { t: 'name', name: 'y' }] }, scope(['x', 'y'], missing));
        return res(id, 'function', { items: [{ kind: 'surface', id, label, f: c.f, x: [-10, 10], y: [-10, 10] }], dims: 3 });
      }
      return res(id, 'function');
    }

    const { core, restr } = peel(ast);
    const names = namesIn(core);
    const has = (v: string) => names.has(v) && !defs.has(v) && !lists.has(v);
    const label = show(ast);
    // Restrictions: masks, plus numeric ranges for the sampling variable.
    const masks = restr.map((r) => compile(r, scope(['x', 'y', 'z', 't', 'theta', 'u', 'v'], missing, true)).f);
    const mask = (f: Fn): Fn =>
      masks.length
        ? (e) => {
            for (const m of masks) {
              const v = m(e);
              if (v === 0 || Number.isNaN(v)) return NaN;
            }
            return f(e);
          }
        : f;
    const rangeOf = (v: string, dflt: [number, number]): [number, number] => {
      let lo = dflt[0];
      let hi = dflt[1];
      for (const r of restr) {
        if (r.t !== 'cmp') continue;
        const i = r.args.findIndex((a) => a.t === 'name' && a.name === v);
        if (i < 0) continue;
        const num = (k: number): number | null => {
          const a = r.args[k];
          if (!a) return null;
          if ([...namesIn(a)].some((nm) => PLOT.has(nm))) return null;
          try {
            const val = compile(a, scope([], new Set())).f({ ...params });
            return Number.isFinite(val) ? val : null;
          } catch {
            return null;
          }
        };
        const left = i > 0 ? num(i - 1) : null;
        const right = num(i + 1);
        const opL = r.ops[i - 1];
        const opR = r.ops[i];
        if (left !== null && opL) {
          if (opL === '<' || opL === '<=') lo = Math.max(lo, left);
          else if (opL === '>' || opL === '>=') hi = Math.min(hi, left);
        }
        if (right !== null && opR) {
          if (opR === '<' || opR === '<=') hi = Math.min(hi, right);
          else if (opR === '>' || opR === '>=') lo = Math.max(lo, right);
        }
      }
      return [lo, hi];
    };

    // ----- equations and inequalities -----
    if (core.t === 'cmp') {
      const { ops, args } = core;
      if (ops.length === 1 && ops[0] === '=') {
        const [l, r] = args as [Expr, Expr];
        const lhsName = l.t === 'name' ? l.name : null;
        const rhsName = r.t === 'name' ? r.name : null;
        const ns = (e: Expr) => namesIn(e);
        const pick = (nm: string, other: Expr) => (lhsName === nm ? !ns(other).has(nm) : false) || false;
        if ((lhsName === 'y' && !ns(r).has('y') && !ns(r).has('z')) || (rhsName === 'y' && !ns(l).has('y') && !ns(l).has('z') && lhsName !== 'x')) {
          const body = lhsName === 'y' ? r : l;
          const c = compile(body, scope(['x'], missing));
          const xr = rangeOf('x', [-Infinity, Infinity]);
          const domain: [number, number] | undefined = Number.isFinite(xr[0]) || Number.isFinite(xr[1]) ? xr : undefined;
          return res(id, 'curve', { items: family(c, (f) => ({ kind: 'explicit', id, label, f: mask(f), domain })), dims: 2 });
        }
        if ((lhsName === 'x' && !ns(r).has('x') && !ns(r).has('z')) || (rhsName === 'x' && !ns(l).has('x') && !ns(l).has('z'))) {
          const body = lhsName === 'x' ? r : l;
          const c = compile(body, scope(['y'], missing));
          return res(id, 'curve', { items: family(c, (f) => ({ kind: 'xOfY', id, label, f: mask(f) })), dims: 2 });
        }
        if (lhsName === 'r' && !ns(r).has('x') && !ns(r).has('y') && !ns(r).has('r')) {
          const c = compile(r, scope(['theta'], missing));
          const range = rangeOf('theta', [0, TAU]);
          return res(id, 'curve', { items: family(c, (f) => ({ kind: 'polar', id, label, r: mask(f), range: finite(range, [0, TAU]) })), dims: 2 });
        }
        if (pick('z', r)) {
          const c = compile(r, scope(['x', 'y'], missing));
          return res(id, 'surface', { items: family(c, (f) => ({ kind: 'surface', id, label, f: mask(f), x: [-10, 10], y: [-10, 10] })), dims: 3 });
        }
      }
      const allNames = new Set<string>();
      args.forEach((a) => namesIn(a).forEach((n) => allNames.add(n)));
      const uses3 = allNames.has('z') && !defs.has('z');
      if (uses3) {
        if (ops.length !== 1 || ops[0] !== '=') throw new ExprError('3D inequalities aren’t supported yet: use = for a surface');
        const c = compile({ t: 'bin', op: '-', a: args[0]!, b: args[1]! }, scope(['x', 'y', 'z'], missing, true));
        return res(id, 'surface', { items: family(c, (f) => ({ kind: 'implicit3d', id, label, F: mask(f) })), dims: 3 });
      }
      if (!['x', 'y', 'r', 'theta'].some((v) => allNames.has(v) && !defs.has(v))) {
        // No plotting variable: a check like "2 + 2 = 4".
        const c = compile(core, scope([], missing));
        return res(id, 'value', { value: values(c, params)[0] ? 'true' : 'false' });
      }
      if (ops.includes('=') && ops.length > 1) throw new ExprError('Only inequalities can be chained (e.g. 0 < y < x)');
      const conds: { F: C; op: Comparator }[] = [];
      for (let i = 0; i < ops.length; i++) {
        conds.push({ F: compile({ t: 'bin', op: '-', a: args[i]!, b: args[i + 1]! }, scope(['x', 'y'], missing, true)), op: ops[i]! });
      }
      let len: number | null = null;
      for (const c of conds) len = len === null ? c.F.n : c.F.n === null ? len : Math.min(len, c.F.n);
      const make = (k: number | null): GraphItem => {
        const fs = conds.map((c) => (k === null || c.F.n === null ? c.F.f : at(c.F.f, k)));
        return { kind: 'implicit', id, label, F: mask(fs[0]!), op: conds[0]!.op, extra: conds.slice(1).map((c, i) => ({ F: mask(fs[i + 1]!), op: c.op })) };
      };
      const items = len === null ? [make(null)] : Array.from({ length: Math.min(len, 50) }, (_, k) => make(k));
      return res(id, 'curve', { items, dims: 2 });
    }

    // ----- points, parametric curves and surfaces -----
    if (core.t === 'tuple') {
      const n = core.items.length;
      if (n !== 2 && n !== 3) throw new ExprError('Points have two or three coordinates');
      if (n === 2) {
        if (has('t')) {
          const cs = core.items.map((a) => compile(a, scope(['t'], missing)));
          const range = finite(rangeOf('t', [0, TAU]), [0, TAU]);
          return res(id, 'curve', { items: families(cs, ([fx, fy]) => ({ kind: 'parametric', id, label, fx: mask(fx!), fy: mask(fy!), range })), dims: 2 });
        }
        const cs = core.items.map((a) => compile(a, scope([], missing)));
        const drag = dragOf(core.items[0]!, core.items[1]!);
        return res(id, 'point', { items: families(cs, ([fx, fy]) => ({ kind: 'point', id, label, x: mask(fx!), y: mask(fy!), drag })), dims: 2 });
      }
      if (has('u') || has('v')) {
        const cs = core.items.map((a) => compile(a, scope(['u', 'v'], missing)));
        const u = finite(rangeOf('u', [0, TAU]), [0, TAU]);
        const v = finite(rangeOf('v', [0, TAU]), [0, TAU]);
        return res(id, 'surface', { items: families(cs, ([fx, fy, fz]) => ({ kind: 'psurface', id, label, fx: mask(fx!), fy: mask(fy!), fz: mask(fz!), u, v })), dims: 3 });
      }
      if (has('t')) {
        const cs = core.items.map((a) => compile(a, scope(['t'], missing)));
        const range = finite(rangeOf('t', [0, TAU]), [0, TAU]);
        return res(id, 'curve', { items: families(cs, ([fx, fy, fz]) => ({ kind: 'curve3d', id, label, fx: mask(fx!), fy: mask(fy!), fz: mask(fz!), range })), dims: 3 });
      }
      const cs = core.items.map((a) => compile(a, scope([], missing)));
      return res(id, 'point', { items: families(cs, ([fx, fy, fz]) => ({ kind: 'point3d', id, label, x: mask(fx!), y: mask(fy!), z: mask(fz!) })), dims: 3 });
    }

    if (core.t === 'call' && core.name === 'vector') {
      const [a, b] = core.args;
      if (!a || !b || a.t !== 'tuple' || b.t !== 'tuple' || a.items.length !== b.items.length) throw new ExprError('vector((x₁, y₁), (x₂, y₂)) takes two points');
      const ca = a.items.map((e) => compile(e, scope(['t'], missing)).f);
      const cb = b.items.map((e) => compile(e, scope(['t'], missing)).f);
      if (a.items.length === 2) return res(id, 'curve', { items: [{ kind: 'vector', id, label, x0: ca[0]!, y0: ca[1]!, x1: cb[0]!, y1: cb[1]! }], dims: 2 });
      return res(id, 'curve', { items: [{ kind: 'vector3d', id, label, from: ca as [Fn, Fn, Fn], to: cb as [Fn, Fn, Fn] }], dims: 3 });
    }

    // ----- bare expressions -----
    if (has('x') && has('y')) {
      const c = compile(core, scope(['x', 'y'], missing));
      return res(id, 'surface', { items: family(c, (f) => ({ kind: 'surface', id, label: `z = ${label}`, f: mask(f), x: [-10, 10], y: [-10, 10] })), dims: 3 });
    }
    if (has('x')) {
      const c = compile(core, scope(['x'], missing));
      const xr = rangeOf('x', [-Infinity, Infinity]);
      const domain: [number, number] | undefined = Number.isFinite(xr[0]) || Number.isFinite(xr[1]) ? xr : undefined;
      return res(id, 'curve', { items: family(c, (f) => ({ kind: 'explicit', id, label: `y = ${label}`, f: mask(f), domain })), dims: 2 });
    }
    if (has('theta') && !has('y')) {
      const c = compile(core, scope(['theta'], missing));
      return res(id, 'curve', { items: family(c, (f) => ({ kind: 'polar', id, label: `r = ${label}`, r: mask(f), range: finite(rangeOf('theta', [0, TAU]), [0, TAU]) })), dims: 2 });
    }
    if (has('y')) throw new ExprError('For a curve in y, write x = …');
    // A value: "2 + 3", "mean(L)", "∫_0^2 x² dx" (which also shades the area).
    const c = compile(core, scope([], missing));
    const vs = values(c, params);
    const items: GraphItem[] = [];
    if (core.t === 'int' && !missing.size) {
      const v = core.v === 'θ' ? 'theta' : core.v;
      try {
        const body = compile(subst(core.a, v, 'x'), scope(['x'], new Set()));
        const lo = compile(core.lo, scope([], new Set())).f;
        const hi = compile(core.hi, scope([], new Set())).f;
        if (body.n === null) items.push({ kind: 'shade', id, label, f: body.f, from: lo({ ...params }), to: hi({ ...params }), lo, hi });
        if (body.n === null) items.push({ kind: 'explicit', id, label: show(core.a), f: body.f });
      } catch {
        // The value still shows.
      }
    }
    const shown = c.n === null ? `${core.t === 'int' ? '≈' : '='} ${fmtValue(vs[0]!)}` : `= [${vs.slice(0, 12).map(fmtValue).join(', ')}${vs.length > 12 ? ', …' : ''}]`;
    return res(id, 'value', { value: shown, items, dims: items.length ? 2 : 0 });
  }

  function dragOf(a: Expr, b: Expr): { x?: string; y?: string; literal?: boolean } | undefined {
    const xn = isNum(a);
    const yn = isNum(b);
    if (xn !== null && yn !== null) return { literal: true };
    const sx = a.t === 'name' && a.name in sliders ? a.name : undefined;
    const sy = b.t === 'name' && b.name in sliders ? b.name : undefined;
    if (sx || sy) return { x: sx, y: sy };
    return undefined;
  }
}

function finite(r: [number, number], d: [number, number]): [number, number] {
  const lo = Number.isFinite(r[0]) ? r[0] : d[0];
  const hi = Number.isFinite(r[1]) ? r[1] : d[1];
  return hi > lo ? [lo, hi] : d;
}

/** One item, or one per element when the expression is a list (a family of curves). */
function family(c: C, make: (f: Fn) => GraphItem): GraphItem[] {
  if (c.n === null) return [make(c.f)];
  return Array.from({ length: Math.min(c.n, 50) }, (_, k) => make(at(c.f, k)));
}

function families(cs: C[], make: (fs: Fn[]) => GraphItem): GraphItem[] {
  let n: number | null = null;
  for (const c of cs) if (c.n !== null) n = n === null ? c.n : Math.min(n, c.n);
  if (n === null) return [make(cs.map((c) => c.f))];
  return Array.from({ length: Math.min(n, 200) }, (_, k) => make(cs.map((c) => (c.n === null ? c.f : at(c.f, k)))));
}
