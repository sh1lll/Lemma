import { compileFloat, freeNames, MathError, parseInput, print, splitLetterProducts, type FloatEnv, type FloatFn, type Node, type Session } from '@lemma/math-core';

/** A graph request turned into compiled, plottable items. No DOM here: renderers live in the apps. */

export type Comparator = '=' | '<' | '>' | '<=' | '>=';

export type GraphItem =
  | { kind: 'explicit'; id: number; label: string; f: FloatFn; domain?: [number, number]; derivativeOf?: number }
  | { kind: 'xOfY'; id: number; label: string; f: FloatFn }
  /** F(x, y) op 0; `extra` adds more conditions for a compound region (0 < y < x shades where all hold). */
  | { kind: 'implicit'; id: number; label: string; F: FloatFn; op: Comparator; extra?: { F: FloatFn; op: Comparator }[] }
  | { kind: 'parametric'; id: number; label: string; fx: FloatFn; fy: FloatFn; range: [number, number] }
  | { kind: 'polar'; id: number; label: string; r: FloatFn; range: [number, number] }
  /** `drag`: the point can be moved; x/y name the sliders it drives, `literal` rewrites the row's numbers. */
  | { kind: 'point'; id: number; label: string; x: FloatFn; y: FloatFn; drag?: { x?: string; y?: string; literal?: boolean } }
  // Statistical marks (see statPlotSpec): data points, histogram bars, a box plot, an area under a curve.
  | { kind: 'scatter'; id: number; label: string; points: number[]; connect?: boolean }
  | { kind: 'bars'; id: number; label: string; edges: number[]; heights: number[] }
  | { kind: 'box'; id: number; label: string; q: [lo: number, q1: number, median: number, q3: number, hi: number]; outliers: number[]; y: number }
  /** The area between f and the x-axis (or g) from `from` to `to`; lo/hi, when given, recompute the bounds from sliders. */
  | { kind: 'shade'; id: number; label: string; f: FloatFn; from: number; to: number; lo?: FloatFn; hi?: FloatFn; g?: FloatFn }
  /** A picture placed on the graph: centre (x, y), size w × h in graph units. */
  | { kind: 'image'; id: number; label: string; img: CanvasImageSource; x: number; y: number; w: number; h: number; opacity: number }
  /** An arrow from (x0, y0) to (x1, y1). */
  | { kind: 'vector'; id: number; label: string; x0: FloatFn; y0: FloatFn; x1: FloatFn; y1: FloatFn }
  // 3D (the graphing workspace's 3D view): implicit surfaces, curves, parametric surfaces, points, vectors.
  | { kind: 'implicit3d'; id: number; label: string; F: FloatFn }
  | { kind: 'curve3d'; id: number; label: string; fx: FloatFn; fy: FloatFn; fz: FloatFn; range: [number, number] }
  | { kind: 'psurface'; id: number; label: string; fx: FloatFn; fy: FloatFn; fz: FloatFn; u: [number, number]; v: [number, number] }
  | { kind: 'point3d'; id: number; label: string; x: FloatFn; y: FloatFn; z: FloatFn }
  | { kind: 'vector3d'; id: number; label: string; from: [FloatFn, FloatFn, FloatFn]; to: [FloatFn, FloatFn, FloatFn] }
  /** z = f(x, y) over a rectangle; drawn by the 3D view. */
  | { kind: 'surface'; id: number; label: string; f: FloatFn; x: [number, number]; y: [number, number] };

export interface Slider {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface GraphSpec {
  items: GraphItem[];
  sliders: Slider[];
  notes: string[];
  /** Suggested initial view, when the request implies one (e.g. a domain). y is fitted to the curves unless given. */
  view?: { xMin: number; xMax: number; yMin?: number; yMax?: number };
  /** Axis titles, and whether the y axis has numbers (a box plot's doesn't). */
  axes?: { x?: string; y?: string; yTicks?: boolean };
  /** A plain-text description of the graph for screen readers. */
  summary?: string;
}

const VARIABLES = new Set(['x', 'y', 't', 'theta', 'θ']);
const GRAPH_VERB = /^(?:(?:please |can you |could you )?(?:graph|plot|draw|sketch|show(?: me)?(?: the)?(?: graph of)?|visuali[sz]e)\s+(?:the )?(?:graph of |function |curve |equation )?)/i;

/** "3d plot …", "graph the surface …": a 3D graph of z = f(x, y). */
const SURFACE_VERB =
  /^(?:(?:please |can you |could you )?(?:graph|plot|draw|sketch|show(?: me)?|visuali[sz]e)\s+)?(?:(?:a|the)\s+)?(?:3d|3-d|three[- ]d(?:imensional)?)\s+(?:(?:plot|graph|surface)\s+)?(?:of\s+)?|^(?:(?:graph|plot|draw|sketch)\s+)(?:the\s+|a\s+)?surface\s+(?:of\s+)?/i;
/** Plots the statistics engine draws (with an answer): never parse these as curves. */
const STAT_PLOT =
  /\b(?:histogram|box(?:[- ]and[- ]whiskers?)?[- ]?plot|boxplot|box and whiskers?|dot ?plot|scatter ?(?:plot|graph|chart|diagram)?|scatterplot|normal (?:curve|distribution)|bell curve|regression|best[- ]fit|fit (?:a|an|the)|line of fit|trend ?line)\b|\bshade\s+p\s*\(/i;

const NOT_A_GRAPH =
  /^(?:solve|find|what|which|make|rearrange|transpose|express|identify|classify|conic|verify|prove|check|is|show|centre|center|foci|vertex|implicit|differentiate|derivative|d\/dx|dy\/dx|for\s+[a-z]\b)|y'|dy\/dx|\b(?:solve|subject|in terms of|integers?|pell|inverse|area|volume|arc length|tangent|normal|domain|range|amplitude|period|vertex|focus|foci|asymptotes?|directrix|intercepts?)\b/i;

export function isGraphRequest(input: string): boolean {
  const s = input.trim();
  if (STAT_PLOT.test(s)) return false;
  if (SURFACE_VERB.test(s)) return true;
  if (/^z\s*=/i.test(s) && /\b[xy]\b|\d[xy]\b/.test(s.replace(/^z\s*=/i, ''))) return true;
  if (/^show (?:that|whether)\b/i.test(s)) return false;
  if (GRAPH_VERB.test(s)) return true;
  // Questions about equations (solve, rearrange, identify a conic, implicit derivatives, ODEs) aren't graphs.
  if (NOT_A_GRAPH.test(s)) return false;
  // A list of two or more equations is a system to solve ("x + y = 5, x - y = 1"); "graph …" still draws it.
  const items = splitItems(s);
  if (items.length >= 2 && items.every((it) => /=/.test(it) && !/[<>≤≥]/.test(it))) return false;
  // "y = 2x + 1", "r = 1 + cos θ", "x^2 + y^2 = 25", "y > x^2": equations in plotting variables.
  if (/^\s*(?:y|r)\s*(?:=|<|>|≤|≥)/i.test(s) && /\b(?:x|theta|θ)\b|\d\s*x\b/i.test(s.replace(/^\s*(?:y|r)\s*/i, ''))) return true;
  if (/(?:=|<|>|≤|≥)/.test(s) && /\bx\b|\dx\b/.test(s) && /\by\b|\dy\b/.test(s)) return true;
  return false;
}

/** Splits on commas / ";" / " and " that are not inside brackets. */
function splitItems(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0 && (c === ',' || c === ';')) {
      out.push(cur);
      cur = '';
      continue;
    }
    if (depth === 0 && s.startsWith(' and ', i)) {
      out.push(cur);
      cur = '';
      i += 4;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function splitComparator(s: string): { lhs: string; op: Comparator; rhs: string } | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth) continue;
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=') return { lhs: s.slice(0, i), op: two, rhs: s.slice(i + 2) };
    if (c === '≤' || c === '≥') return { lhs: s.slice(0, i), op: c === '≤' ? '<=' : '>=', rhs: s.slice(i + 1) };
    if (c === '<' || c === '>' || c === '=') return { lhs: s.slice(0, i), op: c, rhs: s.slice(i + 1) };
  }
  return null;
}

export function parseGraph(input: string, session: Session): GraphSpec {
  const notes: string[] = [];
  const sv = SURFACE_VERB.exec(input.trim());
  let body = (sv ? input.trim().slice(sv[0].length) : input.trim().replace(GRAPH_VERB, '')).replace(/[.?!]+$/, '');
  let view: GraphSpec['view'];

  // Domain: "x^2 from -2 to 3", "for 0 < x < 3", "on [0, 5]", "for x between 0 and 3".
  let domain: [number, number] | undefined;
  const dm =
    /\s+(?:for|over|on|from)\s+(?:x\s+(?:from|between|in)\s+)?\[?\s*(-?[\d.]+)\s*(?:to|and|,|<=?\s*x\s*<=?)\s*(-?[\d.]+)\s*\]?\s*$/i.exec(body) ??
    /\s+(?:for|where)\s+(-?[\d.]+)\s*<=?\s*x\s*<=?\s*(-?[\d.]+)\s*$/i.exec(body);
  if (dm) {
    domain = [Number(dm[1]), Number(dm[2])];
    if (!(domain[0] < domain[1])) throw new MathError('syntax', 'The domain should go from smaller to larger');
    body = body.slice(0, dm.index);
    const pad = (domain[1] - domain[0]) * 0.15;
    view = { xMin: domain[0] - pad, xMax: domain[1] + pad };
  }
  if (sv || /^(?:z|f\(\s*x\s*,\s*y\s*\))\s*=/i.test(body)) return parseSurface(body, session, domain, notes);

  // "… and its derivative" adds a numeric derivative of the previous curve.
  const wantsDerivative = /\s+(?:and|with)\s+(?:its|the)\s+derivative$/i.test(body);
  body = body.replace(/\s+(?:and|with)\s+(?:its|the)\s+derivative$/i, '');

  const items: GraphItem[] = [];
  const params = new Set<string>();
  let nextId = 0;
  // "y = mx + b" has sliders m and b (as in Desmos), not one slider called "mx".
  const known = (name: string) => VARIABLES.has(name) || session.vars.has(name) || session.fns.has(name);
  const parse = (text: string): Node => splitLetterProducts(parseInput(text.replace(/θ/g, 'theta'), session), known);
  const free = (n: Node) => freeNames(n, session.vars).forEach((v) => !VARIABLES.has(v) && !session.fns.has(v) && params.add(v));

  // Collect parameters first so they compile as free variables.
  const pieces = splitItems(body);
  const parsed: { text: string; build: (freeSet: Set<string>) => GraphItem }[] = [];

  for (const raw of pieces) {
    const text = raw.replace(/^f\(x\)\s*=\s*/, 'y = ');
    const id = nextId++;
    // Point or parametric pair: "(1, 2)", "(cos t, sin t)".
    const pair = /^\(\s*(.+?)\s*,\s*(.+?)\s*\)$/.exec(text);
    if (pair && splitItems(pair[1]!).length === 1) {
      const a = parse(pair[1]!);
      const b = parse(pair[2]!);
      free(a);
      free(b);
      const usesT = [a, b].some((n) => freeNames(n).includes('t'));
      parsed.push({
        text,
        build: (fs) =>
          usesT
            ? { kind: 'parametric', id, label: `(${print(a)}, ${print(b)})`, fx: compileFloat(a, opts(fs)), fy: compileFloat(b, opts(fs)), range: [0, 2 * Math.PI] }
            : { kind: 'point', id, label: `(${print(a)}, ${print(b)})`, x: compileFloat(a, opts(fs)), y: compileFloat(b, opts(fs)) },
      });
      continue;
    }
    // Parametric written as "x = cos(t), y = sin(t)" arrives as two pieces; join them.
    const cmp = splitComparator(text);
    if (cmp) {
      const lhs = cmp.lhs.trim().toLowerCase();
      const rhsNode = parse(cmp.rhs);
      free(rhsNode);
      if (cmp.op === '=' && lhs === 'y' && !freeNames(rhsNode).includes('y')) {
        parsed.push({ text, build: (fs) => ({ kind: 'explicit', id, label: `y = ${print(rhsNode)}`, f: compileFloat(rhsNode, opts(fs)), domain }) });
        continue;
      }
      if (cmp.op === '=' && (lhs === 'r') && !freeNames(rhsNode).some((v) => v === 'x' || v === 'y')) {
        parsed.push({ text, build: (fs) => ({ kind: 'polar', id, label: `r = ${print(rhsNode).replace(/theta/g, 'θ')}`, r: compileFloat(rhsNode, opts(fs)), range: [0, 2 * Math.PI] }) });
        continue;
      }
      if (cmp.op === '=' && lhs === 'x' && !freeNames(rhsNode).includes('x')) {
        const usesT = freeNames(rhsNode).includes('t');
        if (usesT) {
          parsed.push({ text, build: (fs) => ({ kind: 'parametric', id, label: `x = ${print(rhsNode)}`, fx: compileFloat(rhsNode, opts(fs)), fy: () => NaN, range: [0, 2 * Math.PI] }) });
        } else {
          parsed.push({ text, build: (fs) => ({ kind: 'xOfY', id, label: `x = ${print(rhsNode)}`, f: compileFloat(rhsNode, opts(fs)) }) });
        }
        continue;
      }
      const lhsNode = parse(cmp.lhs);
      free(lhsNode);
      const diff: Node = { type: 'binary', op: '-', left: lhsNode, right: rhsNode };
      const label = `${print(lhsNode)} ${cmp.op === '<=' ? '≤' : cmp.op === '>=' ? '≥' : cmp.op} ${print(rhsNode)}`;
      parsed.push({ text, build: (fs) => ({ kind: 'implicit', id, label, F: compileFloat(diff, opts(fs)), op: cmp.op }) });
      continue;
    }
    // Bare expression: y = expr.
    const node = parse(text);
    free(node);
    const names = freeNames(node);
    if (names.includes('theta') && !names.includes('x')) {
      parsed.push({ text, build: (fs) => ({ kind: 'polar', id, label: `r = ${print(node).replace(/theta/g, 'θ')}`, r: compileFloat(node, opts(fs)), range: [0, 2 * Math.PI] }) });
    } else {
      parsed.push({ text, build: (fs) => ({ kind: 'explicit', id, label: `y = ${print(node)}`, f: compileFloat(node, opts(fs)), domain }) });
    }
  }

  function opts(fs: Set<string>) {
    return { angle: 'rad' as const, vars: session.vars, fns: session.fns, free: fs };
  }

  const freeSet = new Set([...VARIABLES, 'theta', ...params]);
  for (const p of parsed) items.push(p.build(freeSet));

  // Merge "x = f(t)" + "y = g(t)" pairs into one parametric curve.
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i]!;
    const b = items[i + 1]!;
    if (a.kind === 'parametric' && a.label.startsWith('x =') && b.kind === 'explicit' && /\bt\b/.test(b.label)) {
      items.splice(i, 2, { kind: 'parametric', id: a.id, label: `${a.label}, ${b.label}`, fx: a.fx, fy: b.f as FloatFn, range: a.range });
      // b.f was compiled as y = g(t); its env reads t, which is what parametric sampling supplies.
    }
  }

  if (wantsDerivative) {
    const last = [...items].reverse().find((i) => i.kind === 'explicit');
    if (!last || last.kind !== 'explicit') throw new MathError('syntax', 'Which curve should I differentiate?');
    const f = last.f;
    const h = 1e-5;
    const d: FloatFn = (env: FloatEnv) => {
      const x = env.x ?? NaN;
      return (f({ ...env, x: x + h }) - f({ ...env, x: x - h })) / (2 * h);
    };
    items.push({ kind: 'explicit', id: nextId++, label: `${last.label.replace(/^y = /, '')} → derivative`, f: d, derivativeOf: last.id });
    notes.push('The derivative curve is computed numerically (central difference)');
  }

  if (!items.length) throw new MathError('empty', 'What should I graph?');
  if (session.angle === 'deg' && /\b(?:sin|cos|tan|sec|csc|cot)\b/.test(body)) notes.push('Graphs use radians');
  const sliders = [...params].sort().map((name) => ({ name, value: 1, min: -10, max: 10, step: 0.1 }));
  if (sliders.length) notes.push(`${sliders.map((s) => s.name).join(', ')} ${sliders.length > 1 ? 'are sliders' : 'is a slider'}: drag to explore`);
  return { items, sliders, notes, view };
}

/** z = f(x, y): one surface over a square (x and y share the domain when one is given; −5 to 5 otherwise). */
function parseSurface(body: string, session: Session, domain: [number, number] | undefined, notes: string[]): GraphSpec {
  const pieces = splitItems(body.replace(/^(?:z|f\(\s*x\s*,\s*y\s*\))\s*=\s*/i, ''));
  if (!pieces.length) throw new MathError('empty', 'Which surface? e.g. "graph z = sin(x)*cos(y)"');
  if (pieces.length > 1) notes.push('3D graphs show one surface at a time: this is the first');
  const text = pieces[0]!.replace(/^(?:z|f\(\s*x\s*,\s*y\s*\))\s*=\s*/i, '');
  if (splitComparator(text)) throw new MathError('syntax', 'A 3D graph takes z = f(x, y), e.g. "graph z = sin(x)*cos(y)"');
  const known = (name: string) => VARIABLES.has(name) || session.vars.has(name) || session.fns.has(name);
  const node = splitLetterProducts(parseInput(text.replace(/θ/g, 'theta'), session), known);
  const params = freeNames(node, session.vars).filter((v) => v !== 'x' && v !== 'y' && !session.fns.has(v));
  const free = new Set(['x', 'y', ...params]);
  const f = compileFloat(node, { angle: 'rad', vars: session.vars, fns: session.fns, free });
  const range: [number, number] = domain ?? [-5, 5];
  if (session.angle === 'deg' && /\b(?:sin|cos|tan|sec|csc|cot)\b/.test(text)) notes.push('Graphs use radians');
  const sliders = [...new Set(params)].sort().map((name) => ({ name, value: 1, min: -10, max: 10, step: 0.1 }));
  if (sliders.length) notes.push(`${sliders.map((s) => s.name).join(', ')} ${sliders.length > 1 ? 'are sliders' : 'is a slider'}: drag to explore`);
  return { items: [{ kind: 'surface', id: 0, label: `z = ${print(node)}`, f, x: range, y: range }], sliders, notes };
}
