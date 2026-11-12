// Graph theory: edge lists ("A-B 3, B-C 2"), adjacency matrices and named graphs (K5, K3,3, C6, Petersen), with
// paths, trees, flows, matchings, traversals, colorings, planarity, centrality, PageRank and spectra.
import { symEigen } from './numeric';
import { answer, fmt, parseMatrix, refuse, type Line, type Result } from './util';

export interface Edge {
  u: number;
  v: number;
  w: number;
}
export interface Graph {
  names: string[];
  edges: Edge[];
  directed: boolean;
  weighted: boolean;
}

const EDGE_RE = /([A-Za-z0-9_']+)\s*(<->|↔|->|→|=>|-|–|—)\s*([A-Za-z0-9_']+)(?:\s*(?:[:=(]|\bw(?:eight)?\s*=?|\bcap(?:acity)?\s*=?)?\s*([-−]?\d+(?:\.\d+)?)\s*\)?)?/g;

/** Edge list, adjacency matrix or named graph; null when the input has none. */
export function parseGraph(input: string): Graph | null {
  const directedWord = /\b(?:directed|digraph|di-graph|arcs?)\b/i.test(input) && !/\bundirected\b/i.test(input);
  const mat = /\b(?:adjacency|weight|distance|capacity|cost)\s+matrix\b/i.test(input) || /\[\s*\[/.test(input) ? parseMatrix(input.slice(input.search(/\[\s*\[|\d/))) : null;
  if (mat && mat.length >= 2 && mat.every((r) => r.length === mat.length) && !/\b[KCPWQ]_?\d/.test(input)) {
    const n = mat.length;
    const names = Array.from({ length: n }, (_, i) => (n <= 26 ? String.fromCharCode(65 + i) : String(i + 1)));
    const sym = mat.every((r, i) => r.every((x, j) => x === mat[j]![i]));
    const directed = directedWord || !sym;
    const edges: Edge[] = [];
    for (let i = 0; i < n; i++)
      for (let j = directed ? 0 : i + 1; j < n; j++) if (i !== j && mat[i]![j] !== 0) edges.push({ u: i, v: j, w: mat[i]![j]! });
    const weighted = edges.some((e) => e.w !== 1);
    return { names, edges, directed, weighted };
  }
  // Edge lists: strip the leading question so "shortest path from A to D:" isn't read as an edge.
  const colon = input.lastIndexOf(':');
  let body = colon >= 0 && EDGE_RE.test(input.slice(colon + 1)) ? input.slice(colon + 1) : input;
  EDGE_RE.lastIndex = 0;
  body = body.replace(/\b(?:from|between|source|sink|to|start(?:ing)? at|s\s*=|t\s*=)\s+[A-Za-z0-9_]+\b/gi, ' ');
  const names: string[] = [];
  const idx = (s: string) => {
    let i = names.indexOf(s);
    if (i < 0) {
      names.push(s);
      i = names.length - 1;
    }
    return i;
  };
  const edges: Edge[] = [];
  let anyArrow = false;
  let anyWeight = false;
  for (const m of body.matchAll(EDGE_RE)) {
    const [, a, op, b, w] = m;
    // "x - 2" inside a formula isn't an edge: names must look like labels.
    if (!/^[A-Za-z0-9_']{1,12}$/.test(a!) || !/^[A-Za-z0-9_']{1,12}$/.test(b!)) continue;
    if (/^\d+$/.test(a!) && /^\d+$/.test(b!) && w === undefined && op === '-' && !/\bedges?\b|\bgraph\b/i.test(input)) continue;
    const arrow = op === '->' || op === '→' || op === '=>';
    if (arrow) anyArrow = true;
    if (w !== undefined) anyWeight = true;
    const e = { u: idx(a!), v: idx(b!), w: w === undefined ? 1 : Number(w.replace('−', '-')) };
    edges.push(e);
    if (op === '<->' || op === '↔') edges.push({ u: e.v, v: e.u, w: e.w }), (anyArrow = true);
  }
  if (!edges.length) return namedGraph(input);
  // Isolated vertices: "vertices A B C D E".
  const vs = /\bvertices\s*(?:[:=]\s*)?\{?\s*((?:[A-Za-z0-9_]+\s*,?\s*)+)\}?/i.exec(input);
  if (vs) for (const t of vs[1]!.split(/[\s,]+/).filter(Boolean)) if (!/^(?:and|edges?|with)$/i.test(t)) idx(t);
  return { names, edges, directed: anyArrow || directedWord, weighted: anyWeight };
}

function namedGraph(input: string): Graph | null {
  const s = input.replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  const g = (n: number, pairs: [number, number][], names?: string[]): Graph => ({
    names: names ?? Array.from({ length: n }, (_, i) => String(i + 1)),
    edges: pairs.map(([u, v]) => ({ u, v, w: 1 })),
    directed: false,
    weighted: false,
  });
  if ((m = /\bK_?(\d+)\s*,\s*(\d+)\b/.exec(s)) || (m = /\bcomplete bipartite(?: graph)? (?:K\s*_?)?\(?\s*(\d+)\s*,\s*(\d+)\)?/i.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a + b > 40) refuse('Up to 40 vertices for named graphs');
    const pairs: [number, number][] = [];
    for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) pairs.push([i, a + j]);
    return g(a + b, pairs, [...Array.from({ length: a }, (_, i) => `a${i + 1}`), ...Array.from({ length: b }, (_, i) => `b${i + 1}`)]);
  }
  if ((m = /\bK_?(\d+)\b(?!\s*,)/.exec(s)) || (m = /\bcomplete graph (?:on |with )?(?:K\s*_?)?(\d+)/i.exec(s))) {
    const n = Number(m[1]);
    if (n < 1 || n > 40) refuse('Up to 40 vertices for named graphs');
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    return g(n, pairs);
  }
  if ((m = /\b(?:C_?(\d+)\b|cycle graph (?:C\s*_?)?(\d+))/.exec(s)) && !/\bC\s*\(/.test(s)) {
    const n = Number(m[1] ?? m[2]);
    if (n < 3 || n > 40) return null;
    return g(n, Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]));
  }
  if ((m = /\b(?:P_?(\d+)\b|path graph (?:P\s*_?)?(\d+))/.exec(s)) && !/\bP\s*\(/.test(s)) {
    const n = Number(m[1] ?? m[2]);
    if (n < 1 || n > 40) return null;
    return g(n, Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]));
  }
  if ((m = /\b(?:W_?(\d+)\b|wheel graph (?:W\s*_?)?(\d+))/.exec(s))) {
    const n = Number(m[1] ?? m[2]);
    if (n < 4 || n > 40) return null;
    const k = n - 1;
    const pairs: [number, number][] = Array.from({ length: k }, (_, i) => [i, (i + 1) % k]);
    for (let i = 0; i < k; i++) pairs.push([i, k]);
    return g(n, pairs);
  }
  if ((m = /\b(?:Q_?(\d+)\b|(\d+)[- ]?(?:cube|dimensional hypercube)|hypercube (?:Q\s*_?)?(\d+))/.exec(s)) || /\bcube graph\b/i.test(s)) {
    const d = m ? Number(m[1] ?? m[2] ?? m[3]) : 3;
    if (d < 1 || d > 5) return null;
    const n = 2 ** d;
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let b = 0; b < d; b++) if (!(i & (1 << b))) pairs.push([i, i | (1 << b)]);
    return g(n, pairs, Array.from({ length: n }, (_, i) => i.toString(2).padStart(d, '0')));
  }
  if (/\bpetersen\b/i.test(s)) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < 5; i++) pairs.push([i, (i + 1) % 5], [i, i + 5], [5 + i, 5 + ((i + 2) % 5)]);
    return g(10, pairs);
  }
  if ((m = /\bstar graph (?:S\s*_?)?(\d+)|\bS\s*_?\s*(\d+)\s+star\b/i.exec(s))) {
    const k = Number(m[1] ?? m[2]);
    if (k < 1 || k > 40) return null;
    return g(k + 1, Array.from({ length: k }, (_, i) => [0, i + 1] as [number, number]));
  }
  return null;
}

// ─── Helpers ───

function adjacency(G: Graph, undirected = !G.directed): { v: number; w: number }[][] {
  const adj: { v: number; w: number }[][] = G.names.map(() => []);
  for (const e of G.edges) {
    adj[e.u]!.push({ v: e.v, w: e.w });
    if (undirected) adj[e.v]!.push({ v: e.u, w: e.w });
  }
  for (const a of adj) a.sort((p, q) => G.names[p.v]!.localeCompare(G.names[q.v]!, 'en', { numeric: true }));
  return adj;
}

function findNode(G: Graph, label: string | undefined): number {
  if (label === undefined) return -1;
  const i = G.names.findIndex((n) => n.toLowerCase() === label.toLowerCase());
  return i;
}

function endpoints(input: string, G: Graph): { s: number; t: number } {
  const m = /\bfrom\s+([A-Za-z0-9_']+)\s+to\s+([A-Za-z0-9_']+)/i.exec(input) ?? /\bbetween\s+([A-Za-z0-9_']+)\s+and\s+([A-Za-z0-9_']+)/i.exec(input) ?? /\b([A-Za-z0-9_']+)\s+to\s+([A-Za-z0-9_']+)\s*:/i.exec(input);
  const sm = /\b(?:source|s)\s*=?\s*([A-Za-z0-9_']+)/i.exec(input);
  const tm = /\b(?:sink|t)\s*=?\s*([A-Za-z0-9_']+)/i.exec(input);
  return { s: findNode(G, m?.[1] ?? sm?.[1]), t: findNode(G, m?.[2] ?? tm?.[1]) };
}
function startNode(input: string, G: Graph): number {
  const m = /\b(?:from|starting (?:at|from)|start(?:ing)?\s*(?:at|=)?|source|root)\s+([A-Za-z0-9_']+)/i.exec(input);
  const i = findNode(G, m?.[1]);
  return i >= 0 ? i : 0;
}

const nm = (G: Graph, i: number) => G.names[i]!;
const pathStr = (G: Graph, p: number[]) => p.map((i) => nm(G, i)).join(' → ');
const edgeStr = (G: Graph, e: Edge) => `${nm(G, e.u)}${G.directed ? '→' : '–'}${nm(G, e.v)}`;

function components(G: Graph): number[][] {
  const adj = adjacency(G, true);
  const seen = new Array(G.names.length).fill(false);
  const out: number[][] = [];
  for (let s = 0; s < G.names.length; s++) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const st = [s];
    seen[s] = true;
    while (st.length) {
      const u = st.pop()!;
      comp.push(u);
      for (const { v } of adj[u]!) if (!seen[v]) (seen[v] = true), st.push(v);
    }
    out.push(comp.sort((a, b) => a - b));
  }
  return out;
}

function sccs(G: Graph): number[][] {
  const n = G.names.length;
  const adj = adjacency(G, false);
  let index = 0;
  const idx = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const on = new Array(n).fill(false);
  const st: number[] = [];
  const out: number[][] = [];
  const strong = (v: number) => {
    idx[v] = low[v] = index++;
    st.push(v);
    on[v] = true;
    for (const { v: w } of adj[v]!) {
      if (idx[w] < 0) {
        strong(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (on[w]) low[v] = Math.min(low[v], idx[w]);
    }
    if (low[v] === idx[v]) {
      const c: number[] = [];
      let w: number;
      do {
        w = st.pop()!;
        on[w] = false;
        c.push(w);
      } while (w !== v);
      out.push(c.sort((a, b) => a - b));
    }
  };
  for (let v = 0; v < n; v++) if (idx[v] < 0) strong(v);
  return out;
}

function bipartition(G: Graph): number[] | null {
  const adj = adjacency(G, true);
  const color = new Array(G.names.length).fill(-1);
  for (let s = 0; s < G.names.length; s++) {
    if (color[s] >= 0) continue;
    color[s] = 0;
    const q = [s];
    while (q.length) {
      const u = q.shift()!;
      for (const { v } of adj[u]!) {
        if (color[v] < 0) (color[v] = 1 - color[u]), q.push(v);
        else if (color[v] === color[u]) return null;
      }
    }
  }
  return color;
}

function degrees(G: Graph) {
  const n = G.names.length;
  const deg = new Array(n).fill(0);
  const inn = new Array(n).fill(0);
  const out = new Array(n).fill(0);
  for (const e of G.edges) {
    out[e.u]++;
    inn[e.v]++;
    deg[e.u]++;
    deg[e.v]++;
  }
  return { deg: deg as number[], inn: inn as number[], out: out as number[] };
}

function dijkstra(G: Graph, s: number) {
  const n = G.names.length;
  const adj = adjacency(G);
  const dist = new Array(n).fill(Infinity) as number[];
  const prev = new Array(n).fill(-1) as number[];
  const done = new Array(n).fill(false);
  dist[s] = 0;
  const steps: string[][] = [];
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const { v, w } of adj[u]!)
      if (dist[u]! + w < dist[v]!) {
        dist[v] = dist[u]! + w;
        prev[v] = u;
      }
    steps.push([String(k + 1), nm(G, u), ...dist.map((d, i) => (done[i] && i !== u ? '✓' : d === Infinity ? '∞' : `${fmt(d)}${prev[i]! >= 0 ? ` (${nm(G, prev[i]!)})` : ''}`))]);
  }
  return { dist, prev, steps };
}

function bellmanFord(G: Graph, s: number) {
  const n = G.names.length;
  const dist = new Array(n).fill(Infinity) as number[];
  const prev = new Array(n).fill(-1) as number[];
  dist[s] = 0;
  const arcs = G.directed ? G.edges : G.edges.flatMap((e) => [e, { u: e.v, v: e.u, w: e.w }]);
  const steps: string[][] = [];
  for (let k = 1; k < n; k++) {
    let changed = false;
    for (const e of arcs)
      if (dist[e.u]! + e.w < dist[e.v]!) {
        dist[e.v] = dist[e.u]! + e.w;
        prev[e.v] = e.u;
        changed = true;
      }
    steps.push([String(k), '', ...dist.map((d) => (d === Infinity ? '∞' : fmt(d)))]);
    if (!changed) break;
  }
  const negCycle = arcs.some((e) => dist[e.u]! + e.w < dist[e.v]! - 1e-12);
  return { dist, prev, steps, negCycle };
}

function tracePath(prev: number[], t: number): number[] {
  const p: number[] = [];
  for (let v = t; v >= 0; v = prev[v]!) {
    p.unshift(v);
    if (p.length > prev.length) break;
  }
  return p;
}

function floyd(G: Graph): number[][] {
  const n = G.names.length;
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (const e of G.edges) {
    d[e.u]![e.v] = Math.min(d[e.u]![e.v]!, e.w);
    if (!G.directed) d[e.v]![e.u] = Math.min(d[e.v]![e.u]!, e.w);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i]![k]! + d[k]![j]! < d[i]![j]!) d[i]![j] = d[i]![k]! + d[k]![j]!;
  return d;
}

function bfsDist(G: Graph, s: number): number[] {
  const adj = adjacency(G);
  const d = new Array(G.names.length).fill(Infinity) as number[];
  d[s] = 0;
  const q = [s];
  while (q.length) {
    const u = q.shift()!;
    for (const { v } of adj[u]!) if (d[v] === Infinity) (d[v] = d[u]! + 1), q.push(v);
  }
  return d;
}

// ─── SVG ───

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A circular-layout drawing; highlighted edges (paths, trees, matchings) in the accent colour. */
export function graphSvg(G: Graph, highlight: Edge[] = [], colors?: number[]): string {
  const n = G.names.length;
  if (n > 40) return '';
  const W = 320;
  const R = n <= 2 ? 70 : 120;
  const cx = W / 2;
  const pos = G.names.map((_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + R * Math.cos(a), cx + R * Math.sin(a)] as const;
  });
  const isHi = (e: Edge) => highlight.some((h) => (h.u === e.u && h.v === e.v) || (!G.directed && h.u === e.v && h.v === e.u));
  const palette = ['#4f8cff', '#ff7a59', '#2bb673', '#b46cff', '#f5b700', '#00b3b3', '#e05297', '#8a8a8a'];
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" role="img" aria-label="graph drawing" font-family="system-ui, sans-serif" font-size="12">`];
  if (G.directed) parts.push('<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>');
  for (const e of G.edges) {
    const [x1, y1] = pos[e.u]!;
    const [x2, y2] = pos[e.v]!;
    const hi = isHi(e);
    if (e.u === e.v) {
      parts.push(`<circle cx="${x1}" cy="${y1 - 18}" r="10" fill="none" stroke="currentColor" opacity="0.6"/>`);
      continue;
    }
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const r = 14;
    const ax = x1 + ((x2 - x1) * r) / len;
    const ay = y1 + ((y2 - y1) * r) / len;
    const bx = x2 - ((x2 - x1) * r) / len;
    const by = y2 - ((y2 - y1) * r) / len;
    parts.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${hi ? '#ff7a59' : 'currentColor'}" stroke-width="${hi ? 3 : 1.2}" opacity="${hi ? 1 : 0.55}"${G.directed ? ' marker-end="url(#arr)"' : ''}/>`);
    if (G.weighted) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" text-anchor="middle" fill="currentColor" font-size="11">${esc(fmt(e.w))}</text>`);
    }
  }
  G.names.forEach((name, i) => {
    const [x, y] = pos[i]!;
    const fill = colors ? palette[colors[i]! % palette.length] : 'none';
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${fill}" stroke="currentColor" stroke-width="1.5"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="currentColor" font-weight="600">${esc(name.length > 4 ? name.slice(0, 4) : name)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

function base(G: Graph): string {
  return `${G.directed ? 'Directed' : 'Undirected'}${G.weighted ? ', weighted' : ''} graph · ${G.names.length} vertices, ${G.edges.length} ${G.directed ? 'arcs' : 'edges'}`;
}

// ─── Operations ───

function shortestPath(input: string, G: Graph, lc: string): Result {
  const neg = G.edges.some((e) => e.w < 0);
  if (/\b(?:floyd|warshall|all[- ]pairs?)\b/.test(lc) || (/\bdistance matrix\b/.test(lc) && !/\bfrom\b/.test(lc))) {
    const d = floyd(G);
    const negCycle = d.some((r, i) => r[i]! < 0);
    return answer(input, 'graph', `Floyd–Warshall all-pairs shortest paths · ${base(G)}`, negCycle ? 'negative cycle' : `${G.names.length}×${G.names.length} distance matrix`, {
      table: { columns: ['', ...G.names], rows: d.map((r, i) => [nm(G, i), ...r.map((x) => (x === Infinity ? '∞' : fmt(x)))]), caption: 'Shortest distances (row → column)' },
      lines: [{ label: 'Diameter', display: fmt(Math.max(...d.flat().filter(Number.isFinite))) }],
      notes: ['dᵢⱼ ← min(dᵢⱼ, dᵢₖ + dₖⱼ) for every intermediate k: O(n³).', ...(negCycle ? ['A negative cycle makes some distances unbounded.'] : [])],
      figure: graphSvg(G),
    });
  }
  const { s, t } = endpoints(input, G);
  const src = s >= 0 ? s : startNode(input, G);
  const useBF = neg || /\bbellman/.test(lc);
  if (useBF) {
    const r = bellmanFord(G, src);
    if (r.negCycle) return answer(input, 'graph', `Bellman–Ford from ${nm(G, src)} · ${base(G)}`, 'negative cycle', { notes: ['A cycle with negative total weight is reachable, so shortest paths are undefined (you can loop forever to lower the cost).'], figure: graphSvg(G) });
    const lines: Line[] = G.names.map((_, i) => ({ label: `${nm(G, src)} → ${nm(G, i)}`, display: r.dist[i] === Infinity ? 'unreachable' : `${fmt(r.dist[i]!)} via ${pathStr(G, tracePath(r.prev, i))}` }));
    const target = t >= 0 ? t : -1;
    const path = target >= 0 ? tracePath(r.prev, target) : [];
    return answer(input, 'graph', `Bellman–Ford shortest paths from ${nm(G, src)}${target >= 0 ? ` to ${nm(G, target)}` : ''} · ${base(G)}`, target >= 0 ? (r.dist[target] === Infinity ? 'unreachable' : `${fmt(r.dist[target]!)} (${pathStr(G, path)})`) : `distances from ${nm(G, src)}`, {
      value: target >= 0 ? r.dist[target] : undefined,
      lines,
      table: { columns: ['pass', '', ...G.names], rows: r.steps, caption: 'Bellman–Ford relaxation passes' },
      notes: [neg ? 'Negative weights present, so Bellman–Ford (not Dijkstra) is used: relax every edge n − 1 times, then check for negative cycles.' : 'Bellman–Ford relaxes every edge n − 1 times; O(VE).'],
      figure: graphSvg(G, pathEdges(path)),
    });
  }
  const r = dijkstra(G, src);
  if (t < 0) {
    return answer(input, 'graph', `Dijkstra from ${nm(G, src)} · ${base(G)}`, `distances from ${nm(G, src)}`, {
      lines: G.names.map((_, i) => ({ label: `${nm(G, src)} → ${nm(G, i)}`, display: r.dist[i] === Infinity ? 'unreachable' : `${fmt(r.dist[i]!)} via ${pathStr(G, tracePath(r.prev, i))}` })),
      table: { columns: ['step', 'visit', ...G.names], rows: r.steps, caption: 'Dijkstra: tentative distances (predecessor)' },
      notes: ['Dijkstra repeatedly settles the closest unsettled vertex; valid because no weight is negative.'],
      figure: graphSvg(G),
    });
  }
  const path = tracePath(r.prev, t);
  const d = r.dist[t]!;
  return answer(input, 'graph', `Shortest path ${nm(G, src)} → ${nm(G, t)} (Dijkstra) · ${base(G)}`, d === Infinity ? 'no path' : `${fmt(d)}`, {
    value: Number.isFinite(d) ? d : undefined,
    lines: [
      { label: 'Path', display: d === Infinity ? '—' : pathStr(G, path) },
      { label: 'Length', display: d === Infinity ? '∞' : fmt(d) },
      { label: 'Edges used', display: d === Infinity ? '—' : String(path.length - 1) },
    ],
    table: { columns: ['step', 'visit', ...G.names], rows: r.steps, caption: 'Dijkstra: tentative distances (predecessor)' },
    notes: ['Dijkstra repeatedly settles the closest unsettled vertex; valid because no weight is negative.'],
    figure: graphSvg(G, pathEdges(path)),
  });
}

const pathEdges = (p: number[]): Edge[] => p.slice(1).map((v, i) => ({ u: p[i]!, v, w: 0 }));

function mst(input: string, G: Graph, lc: string): Result {
  if (G.directed) refuse('Minimum spanning trees are for undirected graphs (for digraphs, look up arborescences / Edmonds’ algorithm)');
  const n = G.names.length;
  const maximum = /\bmaximum spanning\b/.test(lc);
  const usePrim = /\bprim\b/.test(lc);
  const rows: string[][] = [];
  const tree: Edge[] = [];
  if (!usePrim) {
    const parent = G.names.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const sorted = [...G.edges].sort((a, b) => (maximum ? b.w - a.w : a.w - b.w) || nm(G, a.u).localeCompare(nm(G, b.u)));
    for (const e of sorted) {
      const a = find(e.u);
      const b = find(e.v);
      const ok = a !== b && e.u !== e.v;
      if (ok) {
        parent[a] = b;
        tree.push(e);
      }
      rows.push([edgeStr(G, e), fmt(e.w), ok ? 'add' : 'skip (cycle)']);
      if (tree.length === n - 1) break;
    }
  } else {
    const s = startNode(input, G);
    const inT = new Array(n).fill(false);
    inT[s] = true;
    for (let k = 1; k < n; k++) {
      let best: Edge | null = null;
      for (const e of G.edges) {
        const cross = inT[e.u] !== inT[e.v];
        if (cross && (!best || (maximum ? e.w > best.w : e.w < best.w))) best = e;
      }
      if (!best) break;
      inT[best.u] = inT[best.v] = true;
      tree.push(best);
      rows.push([String(k), edgeStr(G, best), fmt(best.w)]);
    }
  }
  const total = tree.reduce((s, e) => s + e.w, 0);
  const spanning = tree.length === n - 1;
  return answer(input, 'graph', `${maximum ? 'Maximum' : 'Minimum'} spanning tree (${usePrim ? 'Prim' : 'Kruskal'}) · ${base(G)}`, spanning ? `total weight ${fmt(total)}` : `forest, weight ${fmt(total)}`, {
    value: total,
    lines: [
      { label: 'Tree edges', display: tree.map((e) => `${edgeStr(G, e)} (${fmt(e.w)})`).join(', ') },
      { label: 'Total weight', display: fmt(total) },
      { label: 'Edges', display: `${tree.length} (= n − 1 = ${n - 1}${spanning ? '' : '; graph is disconnected'})` },
    ],
    table: usePrim ? { columns: ['step', 'edge added', 'weight'], rows, caption: `Prim from ${nm(G, startNode(input, G))}` } : { columns: ['edge', 'weight', 'action'], rows, caption: 'Kruskal: edges in weight order' },
    notes: [usePrim ? 'Prim grows one tree, always adding the cheapest edge leaving it.' : 'Kruskal adds edges cheapest first, skipping any that would close a cycle (union–find).'],
    figure: graphSvg(G, tree),
  });
}

function maxFlow(input: string, G: Graph): Result {
  const { s, t } = endpoints(input, G);
  const n = G.names.length;
  const src = s >= 0 ? s : findNode(G, 's') >= 0 ? findNode(G, 's') : 0;
  const snk = t >= 0 ? t : findNode(G, 't') >= 0 ? findNode(G, 't') : n - 1;
  if (src === snk) refuse('Source and sink must differ');
  const cap = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  for (const e of G.edges) {
    cap[e.u]![e.v]! += e.w;
    if (!G.directed) cap[e.v]![e.u]! += e.w;
  }
  const orig = cap.map((r) => [...r]);
  let flow = 0;
  const rows: string[][] = [];
  for (;;) {
    const prev = new Array(n).fill(-1) as number[];
    prev[src] = src;
    const q = [src];
    while (q.length && prev[snk]! < 0) {
      const u = q.shift()!;
      for (let v = 0; v < n; v++) if (prev[v]! < 0 && cap[u]![v]! > 1e-12) (prev[v] = u), q.push(v);
    }
    if (prev[snk]! < 0) break;
    let b = Infinity;
    for (let v = snk; v !== src; v = prev[v]!) b = Math.min(b, cap[prev[v]!]![v]!);
    const path: number[] = [];
    for (let v = snk; v !== src; v = prev[v]!) {
      cap[prev[v]!]![v]! -= b;
      cap[v]![prev[v]!]! += b;
      path.unshift(v);
    }
    path.unshift(src);
    flow += b;
    rows.push([String(rows.length + 1), pathStr(G, path), fmt(b), fmt(flow)]);
    if (rows.length > 1000) break;
  }
  // Min cut: vertices reachable from s in the residual graph.
  const S = new Set([src]);
  const q = [src];
  while (q.length) {
    const u = q.shift()!;
    for (let v = 0; v < n; v++) if (!S.has(v) && cap[u]![v]! > 1e-12) S.add(v), q.push(v);
  }
  const cut: Edge[] = G.edges.filter((e) => (S.has(e.u) && !S.has(e.v)) || (!G.directed && S.has(e.v) && !S.has(e.u)));
  const flows = G.edges.map((e) => {
    const f = G.directed ? Math.max(0, orig[e.u]![e.v]! - cap[e.u]![e.v]!) : Math.abs(orig[e.u]![e.v]! - cap[e.u]![e.v]!);
    return [edgeStr(G, e), fmt(e.w), fmt(Math.min(f, e.w))];
  });
  return answer(input, 'graph', `Maximum flow ${nm(G, src)} → ${nm(G, snk)} (Edmonds–Karp) · ${base(G)}`, fmt(flow), {
    value: flow,
    lines: [
      { label: 'Max flow', display: fmt(flow) },
      { label: 'Min cut', display: `${cut.map((e) => edgeStr(G, e)).join(', ')} (capacity ${fmt(cut.reduce((a, e) => a + e.w, 0))})` },
      { label: 'Source side S', display: `{${[...S].sort((a, b) => a - b).map((i) => nm(G, i)).join(', ')}}` },
    ],
    table: { columns: ['#', 'augmenting path', 'bottleneck', 'total'], rows, caption: 'Augmenting paths (shortest first)' },
    notes: ['Max-flow min-cut theorem: the maximum flow equals the capacity of the smallest cut separating source and sink.', `Edge flows: ${flows.map((f) => `${f[0]} ${f[2]}/${f[1]}`).join(', ')}`],
    figure: graphSvg(G, cut),
  });
}

function traversal(input: string, G: Graph, lc: string): Result {
  const dfs = /\bdfs\b|depth[- ]first/.test(lc);
  const s = startNode(input, G);
  const adj = adjacency(G);
  const order: number[] = [];
  const treeEdges: Edge[] = [];
  const seen = new Array(G.names.length).fill(false);
  const rows: string[][] = [];
  if (dfs) {
    const visit = (u: number, depth: number) => {
      seen[u] = true;
      order.push(u);
      rows.push([String(order.length), nm(G, u), String(depth)]);
      for (const { v } of adj[u]!) if (!seen[v]) treeEdges.push({ u, v, w: 0 }), visit(v, depth + 1);
    };
    visit(s, 0);
  } else {
    const q = [s];
    const depth = new Array(G.names.length).fill(0);
    seen[s] = true;
    while (q.length) {
      const u = q.shift()!;
      order.push(u);
      rows.push([String(order.length), nm(G, u), String(depth[u]), q.map((i) => nm(G, i)).join(' ') || '—']);
      for (const { v } of adj[u]!) if (!seen[v]) (seen[v] = true), (depth[v] = depth[u] + 1), treeEdges.push({ u, v, w: 0 }), q.push(v);
      rows[rows.length - 1]![3] = q.map((i) => nm(G, i)).join(' ') || '—';
    }
  }
  return answer(input, 'graph', `${dfs ? 'Depth' : 'Breadth'}-first search from ${nm(G, s)} · ${base(G)}`, order.map((i) => nm(G, i)).join(', '), {
    lines: [
      { label: 'Visit order', display: order.map((i) => nm(G, i)).join(' → ') },
      { label: 'Reached', display: `${order.length} of ${G.names.length} vertices` },
    ],
    table: { columns: dfs ? ['#', 'vertex', 'depth'] : ['#', 'vertex', 'level', 'queue after'], rows },
    notes: ['Neighbours are visited in alphabetical/numeric order.', dfs ? 'DFS goes as deep as possible before backtracking (recursion/stack).' : 'BFS visits vertices level by level (queue); levels are hop distances.'],
    figure: graphSvg(G, treeEdges),
  });
}

function eulerian(input: string, G: Graph): Result {
  const { deg, inn, out } = degrees(G);
  const used = G.names.map((_, i) => deg[i]! > 0);
  const comps = components(G).filter((c) => c.some((v) => used[v]));
  const connected = comps.length <= 1;
  let verdict: string;
  let start = G.edges[0]?.u ?? 0;
  let kind: 'circuit' | 'path' | 'none' = 'none';
  if (!G.directed) {
    const odd = G.names.map((_, i) => i).filter((i) => deg[i]! % 2);
    if (!connected) verdict = 'No Euler path: the edges are not all connected';
    else if (odd.length === 0) (verdict = 'Euler circuit exists (every vertex has even degree)'), (kind = 'circuit');
    else if (odd.length === 2) (verdict = `Euler path exists from ${nm(G, odd[0]!)} to ${nm(G, odd[1]!)} (exactly two odd vertices), but no circuit`), (kind = 'path'), (start = odd[0]!);
    else verdict = `No Euler path: ${odd.length} vertices have odd degree (${odd.map((i) => nm(G, i)).join(', ')}); a path allows at most 2`;
  } else {
    const plus = G.names.map((_, i) => i).filter((i) => out[i]! - inn[i]! === 1);
    const minus = G.names.map((_, i) => i).filter((i) => inn[i]! - out[i]! === 1);
    const bad = G.names.map((_, i) => i).filter((i) => Math.abs(out[i]! - inn[i]!) > 1);
    if (!connected) verdict = 'No Euler path: the arcs are not all connected';
    else if (!bad.length && !plus.length && !minus.length) (verdict = 'Euler circuit exists (in-degree = out-degree everywhere)'), (kind = 'circuit');
    else if (!bad.length && plus.length === 1 && minus.length === 1) (verdict = `Euler path exists from ${nm(G, plus[0]!)} to ${nm(G, minus[0]!)}`), (kind = 'path'), (start = plus[0]!);
    else verdict = 'No Euler path: in- and out-degrees are too unbalanced';
  }
  const lines: Line[] = [{ label: 'Degrees', display: G.names.map((v, i) => (G.directed ? `${v}: in ${inn[i]}, out ${out[i]}` : `${v}: ${deg[i]}`)).join(', ') }];
  let trail: number[] = [];
  if (kind !== 'none') {
    // Hierholzer.
    const adj: { v: number; id: number }[][] = G.names.map(() => []);
    G.edges.forEach((e, id) => {
      adj[e.u]!.push({ v: e.v, id });
      if (!G.directed) adj[e.v]!.push({ v: e.u, id });
    });
    for (const a of adj) a.sort((p, q) => q.v - p.v);
    const usedE = new Array(G.edges.length).fill(false);
    const st = [start];
    while (st.length) {
      const u = st[st.length - 1]!;
      const a = adj[u]!;
      while (a.length && usedE[a[a.length - 1]!.id]) a.pop();
      if (!a.length) trail.push(st.pop()!);
      else {
        const { v, id } = a.pop()!;
        usedE[id] = true;
        st.push(v);
      }
    }
    trail = trail.reverse();
    lines.push({ label: kind === 'circuit' ? 'Euler circuit' : 'Euler path', display: pathStr(G, trail) });
  }
  return answer(input, 'graph', `Euler path/circuit check · ${base(G)}`, kind === 'none' ? 'none' : kind === 'circuit' ? 'Euler circuit' : 'Euler path', {
    lines: [{ label: 'Verdict', display: verdict }, ...lines],
    notes: ['Euler (1736, Königsberg): a connected graph has an Euler circuit iff every degree is even, and an Euler path iff exactly 0 or 2 degrees are odd.'],
    figure: graphSvg(G, pathEdges(trail)),
  });
}

function hamiltonian(input: string, G: Graph, lc: string): Result {
  const n = G.names.length;
  if (n > 16) refuse('Hamiltonian search is exponential; up to 16 vertices');
  const adj = Array.from({ length: n }, () => new Array(n).fill(false) as boolean[]);
  for (const e of G.edges) {
    adj[e.u]![e.v] = true;
    if (!G.directed) adj[e.v]![e.u] = true;
  }
  const wantCycle = /\bcycle|circuit|tour\b/.test(lc);
  const find = (cycle: boolean): number[] | null => {
    const path: number[] = [];
    const used = new Array(n).fill(false);
    const rec = (u: number): boolean => {
      path.push(u);
      used[u] = true;
      if (path.length === n && (!cycle || adj[u]![path[0]!])) return true;
      for (let v = 0; v < n; v++) if (!used[v] && adj[u]![v] && rec(v)) return true;
      path.pop();
      used[u] = false;
      return false;
    };
    for (let s = 0; s < (cycle ? 1 : n); s++) if (rec(s)) return path;
    return null;
  };
  const cyc = find(true);
  const path = cyc ?? find(false);
  const lines: Line[] = [
    { label: 'Hamiltonian cycle', display: cyc ? pathStr(G, [...cyc, cyc[0]!]) : 'none' },
    { label: 'Hamiltonian path', display: path ? pathStr(G, path) : 'none' },
  ];
  const { deg } = degrees(G);
  if (!G.directed && n >= 3 && Math.min(...deg) >= n / 2) lines.push({ label: 'Dirac’s theorem', display: `min degree ${Math.min(...deg)} ≥ n/2, so a Hamiltonian cycle is guaranteed` });
  return answer(input, 'graph', `Hamiltonian ${wantCycle ? 'cycle' : 'path'} search · ${base(G)}`, wantCycle ? (cyc ? 'yes' : 'no') : path ? 'yes' : 'no', {
    lines,
    notes: ['Exhaustive backtracking search. Deciding Hamiltonicity is NP-complete, unlike Euler paths.'],
    figure: graphSvg(G, pathEdges(cyc ? [...cyc, cyc[0]!] : path ?? [])),
  });
}

function coloring(input: string, G: Graph): Result {
  const n = G.names.length;
  if (n > 30) refuse('Up to 30 vertices for exact colouring');
  const adj = Array.from({ length: n }, () => new Set<number>());
  for (const e of G.edges) if (e.u !== e.v) adj[e.u]!.add(e.v), adj[e.v]!.add(e.u);
  const order = G.names.map((_, i) => i).sort((a, b) => adj[b]!.size - adj[a]!.size);
  const tryK = (k: number): number[] | null => {
    const col = new Array(n).fill(-1) as number[];
    let steps = 0;
    const rec = (idx: number, maxUsed: number): boolean => {
      if (++steps > 2_000_000) return false;
      if (idx === n) return true;
      const v = order[idx]!;
      for (let c = 0; c < Math.min(k, maxUsed + 2); c++) {
        let ok = true;
        for (const w of adj[v]!) if (col[w] === c) (ok = false);
        if (!ok) continue;
        col[v] = c;
        if (rec(idx + 1, Math.max(maxUsed, c))) return true;
        col[v] = -1;
      }
      return false;
    };
    return rec(0, -1) ? col : null;
  };
  let k = G.edges.length ? 1 : 1;
  let col: number[] | null = null;
  for (k = 1; k <= n; k++) if ((col = tryK(k))) break;
  const classes = Array.from({ length: k }, (_, c) => G.names.filter((_, i) => col![i] === c));
  const omega = cliqueNumber(adj);
  return answer(input, 'graph', `Chromatic number · ${base(G)}`, `χ = ${k}`, {
    value: k,
    lines: [
      { label: 'Colouring', display: classes.map((c, i) => `colour ${i + 1}: {${c.join(', ')}}`).join('; ') },
      { label: 'Clique number ω', display: `${omega} (lower bound: χ ≥ ω)` },
      { label: 'Max degree Δ', display: `${Math.max(0, ...adj.map((a) => a.size))} (Brooks: χ ≤ Δ unless complete or odd cycle)` },
    ],
    notes: ['Exact search by backtracking with largest-degree-first ordering.', ...(k === 2 ? ['χ = 2 exactly when the graph is bipartite with at least one edge.'] : [])],
    figure: graphSvg({ ...G, directed: false }, [], col!),
  });
}

function cliqueNumber(adj: Set<number>[]): number {
  let best = 0;
  const n = adj.length;
  const rec = (R: number[], P: number[]) => {
    if (!P.length) {
      best = Math.max(best, R.length);
      return;
    }
    if (R.length + P.length <= best) return;
    for (let i = 0; i < P.length; i++) {
      const v = P[i]!;
      rec([...R, v], P.slice(i + 1).filter((w) => adj[v]!.has(w)));
    }
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return best;
}

/** Planarity by the Demoucron–Malgrange–Pertuiset path-embedding algorithm, block by block. */
export function isPlanar(n: number, edgeList: [number, number][]): boolean {
  const uniq = new Map<string, [number, number]>();
  for (const [a, b] of edgeList) if (a !== b) uniq.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
  const edges = [...uniq.values()];
  if (n <= 4 || edges.length <= 8) return true;
  if (edges.length > 3 * n - 6) return false;
  for (const block of biconnectedBlocks(n, edges)) if (block.length > 8 && !dmp(block)) return false;
  return true;
}

function biconnectedBlocks(n: number, edges: [number, number][]): [number, number][][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b]) => (adj[a]!.push(b), adj[b]!.push(a)));
  const disc = new Array(n).fill(-1) as number[];
  const low = new Array(n).fill(0) as number[];
  let time = 0;
  const stack: [number, number][] = [];
  const blocks: [number, number][][] = [];
  const dfs = (u: number, p: number) => {
    disc[u] = low[u] = time++;
    for (const v of adj[u]!) {
      if (disc[v]! < 0) {
        stack.push([u, v]);
        dfs(v, u);
        low[u] = Math.min(low[u]!, low[v]!);
        if (low[v]! >= disc[u]!) {
          const b: [number, number][] = [];
          let e: [number, number];
          do {
            e = stack.pop()!;
            b.push(e);
          } while (!(e[0] === u && e[1] === v));
          blocks.push(b);
        }
      } else if (v !== p && disc[v]! < disc[u]!) {
        stack.push([u, v]);
        low[u] = Math.min(low[u]!, disc[v]!);
      }
    }
  };
  for (let i = 0; i < n; i++) if (disc[i]! < 0) dfs(i, -1);
  return blocks;
}

function dmp(blockEdges: [number, number][]): boolean {
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const adj = new Map<number, number[]>();
  for (const [a, b] of blockEdges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  // Initial cycle by DFS.
  const verts = [...adj.keys()];
  const parent = new Map<number, number>();
  const depth = new Map<number, number>();
  let cycle: number[] | null = null;
  const dfs = (u: number, p: number) => {
    for (const v of adj.get(u)!) {
      if (cycle) return;
      if (v === p) continue;
      if (depth.has(v)) {
        if (depth.get(v)! < depth.get(u)!) {
          const c = [u];
          let x = u;
          while (x !== v) (x = parent.get(x)!), c.push(x);
          cycle = c;
        }
        continue;
      }
      parent.set(v, u);
      depth.set(v, depth.get(u)! + 1);
      dfs(v, u);
    }
  };
  depth.set(verts[0]!, 0);
  dfs(verts[0]!, -1);
  if (!cycle) return true;
  const c: number[] = cycle;
  const inH = new Set<number>(c);
  const Hedges = new Set<string>();
  c.forEach((v, i) => Hedges.add(key(v, c[(i + 1) % c.length]!)));
  let faces: number[][] = [[...c], [...c].reverse()];
  const total = blockEdges.length;
  let guard = 0;
  while (Hedges.size < total) {
    if (++guard > 10000) return true;
    // Fragments.
    type Frag = { contacts: Set<number>; interior: Set<number>; edges: [number, number][] };
    const frags: Frag[] = [];
    for (const [a, b] of blockEdges) if (inH.has(a) && inH.has(b) && !Hedges.has(key(a, b))) frags.push({ contacts: new Set([a, b]), interior: new Set(), edges: [[a, b]] });
    const seen = new Set<number>();
    for (const s of verts) {
      if (inH.has(s) || seen.has(s)) continue;
      const fr: Frag = { contacts: new Set(), interior: new Set(), edges: [] };
      const st = [s];
      seen.add(s);
      while (st.length) {
        const u = st.pop()!;
        fr.interior.add(u);
        for (const v of adj.get(u)!) {
          if (inH.has(v)) {
            fr.contacts.add(v);
            fr.edges.push([u, v]);
          } else {
            if (u < v) fr.edges.push([u, v]);
            if (!seen.has(v)) seen.add(v), st.push(v);
          }
        }
      }
      frags.push(fr);
    }
    let chosen: Frag | null = null;
    let face: number[] | null = null;
    for (const fr of frags) {
      const ok = faces.filter((f) => [...fr.contacts].every((v) => f.includes(v)));
      if (!ok.length) return false;
      if (ok.length === 1 || !chosen) {
        chosen = fr;
        face = ok[0]!;
        if (ok.length === 1) break;
      }
    }
    if (!chosen || !face) return true;
    // A path through the fragment between two contact vertices.
    const contacts = [...chosen.contacts];
    let path: number[];
    if (!chosen.interior.size) path = [chosen.edges[0]![0], chosen.edges[0]![1]];
    else {
      const a = contacts[0]!;
      const prev = new Map<number, number>();
      const q: number[] = [];
      for (const v of adj.get(a)!) if (chosen.interior.has(v) && !prev.has(v)) prev.set(v, a), q.push(v);
      let end = -1;
      while (q.length && end < 0) {
        const u = q.shift()!;
        for (const v of adj.get(u)!) {
          if (chosen.contacts.has(v) && v !== a) {
            prev.set(-1, u);
            end = v;
            break;
          }
          if (chosen.interior.has(v) && !prev.has(v)) prev.set(v, u), q.push(v);
        }
      }
      if (end < 0) return true;
      path = [end];
      let x = prev.get(-1)!;
      while (x !== a) path.push(x), (x = prev.get(x)!);
      path.push(a);
      path.reverse();
    }
    // Embed: split the face.
    const a = path[0]!;
    const b = path[path.length - 1]!;
    const ia = face.indexOf(a);
    const ib = face.indexOf(b);
    const L = face.length;
    const arc = (from: number, to: number) => {
      const out: number[] = [];
      for (let i = from; ; i = (i + 1) % L) {
        out.push(face![i]!);
        if (i === to) break;
      }
      return out;
    };
    const inner = path.slice(1, -1);
    const f1 = [...arc(ia, ib), ...[...inner].reverse()];
    const f2 = [...arc(ib, ia), ...inner];
    faces = faces.filter((f) => f !== face);
    faces.push(f1, f2);
    for (let i = 0; i < path.length - 1; i++) Hedges.add(key(path[i]!, path[i + 1]!));
    for (const v of path) inH.add(v);
  }
  return true;
}

function planarity(input: string, G: Graph): Result {
  const n = G.names.length;
  const pairs = G.edges.map((e) => [e.u, e.v] as [number, number]);
  const uniqueE = new Set(pairs.filter(([a, b]) => a !== b).map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`))).size;
  const planar = isPlanar(n, pairs);
  const lines: Line[] = [
    { label: 'V, E', display: `${n}, ${uniqueE}` },
    { label: 'Bound E ≤ 3V − 6', display: n >= 3 ? `${uniqueE} ≤ ${3 * n - 6}: ${uniqueE <= 3 * n - 6 ? 'holds' : 'fails, so not planar'}` : 'n/a' },
  ];
  if (bipartition(G) && n >= 3) lines.push({ label: 'Bipartite bound E ≤ 2V − 4', display: `${uniqueE} ≤ ${2 * n - 4}: ${uniqueE <= 2 * n - 4 ? 'holds' : 'fails, so not planar'}` });
  const comps = components(G).length;
  if (planar) lines.push({ label: 'Faces (Euler: V − E + F = 1 + C)', display: String(uniqueE - n + 1 + comps) });
  return answer(input, 'graph', `Planarity · ${base(G)}`, planar ? 'planar' : 'not planar', {
    lines,
    notes: [planar ? 'An embedding without crossings exists (found by the Demoucron–Malgrange–Pertuiset path-addition algorithm).' : 'Kuratowski: a graph is planar iff it contains no subdivision of K₅ or K₃,₃; this one must contain one.'],
    figure: graphSvg(G),
  });
}

function matching(input: string, G: Graph): Result {
  const n = G.names.length;
  const part = bipartition(G);
  let pairs: [number, number][] = [];
  if (part) {
    const left = G.names.map((_, i) => i).filter((i) => part[i] === 0);
    const adj = adjacency(G, true);
    const matchR = new Array(n).fill(-1) as number[];
    const tryK = (u: number, seen: boolean[]): boolean => {
      for (const { v } of adj[u]!) {
        if (seen[v]) continue;
        seen[v] = true;
        if (matchR[v]! < 0 || tryK(matchR[v]!, seen)) {
          matchR[v] = u;
          return true;
        }
      }
      return false;
    };
    for (const u of left) tryK(u, new Array(n).fill(false));
    pairs = matchR.map((u, v) => [u, v] as [number, number]).filter(([u]) => u >= 0);
  } else {
    if (n > 22) refuse('General (non-bipartite) matching here is exact up to 22 vertices');
    const adjM = G.names.map(() => 0);
    for (const e of G.edges) if (e.u !== e.v) (adjM[e.u]! |= 1 << e.v), (adjM[e.v]! |= 1 << e.u);
    const memo = new Map<number, number>();
    const best = (mask: number): number => {
      if (mask === 0) return 0;
      const hit = memo.get(mask);
      if (hit !== undefined) return hit;
      const i = 31 - Math.clz32(mask & -mask);
      const rest = mask & ~(1 << i);
      let r = best(rest);
      let m = adjM[i]! & rest;
      while (m) {
        const j = 31 - Math.clz32(m & -m);
        m &= m - 1;
        r = Math.max(r, 1 + best(rest & ~(1 << j)));
      }
      memo.set(mask, r);
      return r;
    };
    let mask = (1 << n) - 1;
    while (mask) {
      const i = 31 - Math.clz32(mask & -mask);
      const rest = mask & ~(1 << i);
      const target = best(mask);
      if (best(rest) === target) {
        mask = rest;
        continue;
      }
      let m = adjM[i]! & rest;
      while (m) {
        const j = 31 - Math.clz32(m & -m);
        m &= m - 1;
        if (1 + best(rest & ~(1 << j)) === target) {
          pairs.push([i, j]);
          mask = rest & ~(1 << j);
          break;
        }
      }
    }
  }
  const size = pairs.length;
  return answer(input, 'graph', `Maximum ${part ? 'bipartite ' : ''}matching · ${base(G)}`, `${size} pair${size === 1 ? '' : 's'}`, {
    value: size,
    lines: [
      { label: 'Matching', display: pairs.map(([u, v]) => `${nm(G, u)}–${nm(G, v)}`).join(', ') || '—' },
      { label: 'Perfect', display: 2 * size === n ? 'yes (every vertex matched)' : 'no' },
      ...(part ? [{ label: 'König', display: `minimum vertex cover also has ${size} vertices` }] : []),
    ],
    notes: [part ? 'Augmenting paths (Kuhn’s algorithm) on the bipartition found by 2-colouring.' : 'The graph is not bipartite, so an exact search over vertex subsets is used.'],
    figure: graphSvg({ ...G, directed: false }, pairs.map(([u, v]) => ({ u, v, w: 0 }))),
  });
}

function centrality(input: string, G: Graph, lc: string): Result {
  const n = G.names.length;
  const { deg, inn } = degrees(G);
  const D = G.weighted ? floyd(G) : G.names.map((_, i) => bfsDist(G, i));
  const closeness = D.map((row, i) => {
    const reach = row.filter((d, j) => j !== i && Number.isFinite(d));
    const s = reach.reduce((a, b) => a + b, 0);
    return s > 0 ? reach.length / s : 0;
  });
  // Brandes betweenness (unweighted BFS or weighted Dijkstra-like via Floyd counts).
  const bc = new Array(n).fill(0) as number[];
  const adj = adjacency(G);
  for (let s = 0; s < n; s++) {
    const S: number[] = [];
    const P: number[][] = G.names.map(() => []);
    const sigma = new Array(n).fill(0) as number[];
    sigma[s] = 1;
    const dist = new Array(n).fill(Infinity) as number[];
    dist[s] = 0;
    const done = new Array(n).fill(false);
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
      if (u < 0) break;
      done[u] = true;
      S.push(u);
      for (const { v, w } of adj[u]!) {
        const ww = G.weighted ? w : 1;
        if (dist[u]! + ww < dist[v]! - 1e-12) {
          dist[v] = dist[u]! + ww;
          sigma[v] = sigma[u]!;
          P[v] = [u];
        } else if (Math.abs(dist[u]! + ww - dist[v]!) < 1e-12) {
          sigma[v]! += sigma[u]!;
          P[v]!.push(u);
        }
      }
    }
    const delta = new Array(n).fill(0) as number[];
    while (S.length) {
      const w = S.pop()!;
      for (const v of P[w]!) delta[v]! += (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      if (w !== s) bc[w]! += delta[w]!;
    }
  }
  const btw = bc.map((b) => (G.directed ? b : b / 2));
  const norm = G.directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2;
  const eig = eigenvectorCentrality(G);
  const degC = (G.directed ? inn : deg).map((d) => d / (n - 1));
  const rows = G.names.map((v, i) => [v, String(G.directed ? inn[i] : deg[i]), fmt(degC[i]!, 4), fmt(closeness[i]!, 4), fmt(btw[i]!, 4), fmt(norm > 0 ? btw[i]! / norm : 0, 4), eig ? fmt(eig[i]!, 4) : '—']);
  const which = /\bbetweenness\b/.test(lc) ? 'betweenness' : /\bcloseness\b/.test(lc) ? 'closeness' : /\beigenvector\b/.test(lc) ? 'eigenvector' : 'degree';
  const scores = which === 'betweenness' ? btw : which === 'closeness' ? closeness : which === 'eigenvector' ? (eig ?? degC) : degC;
  const top = scores.indexOf(Math.max(...scores));
  return answer(input, 'graph', `${which[0]!.toUpperCase() + which.slice(1)} centrality · ${base(G)}`, `most central: ${nm(G, top)}`, {
    lines: [{ label: `${which} scores`, display: G.names.map((v, i) => `${v} ${fmt(scores[i]!, 4)}`).join(', ') }],
    table: { columns: ['vertex', G.directed ? 'in-degree' : 'degree', 'degree c.', 'closeness', 'betweenness', 'betw. (norm.)', 'eigenvector'], rows, highlightRow: top },
    notes: ['Degree centrality = deg/(n − 1); closeness = (vertices reached)/Σ distances to them; betweenness counts shortest paths through a vertex (Brandes); eigenvector centrality is the Perron vector of A, scaled to max 1.'],
    figure: graphSvg(G),
  });
}

function eigenvectorCentrality(G: Graph): number[] | null {
  const n = G.names.length;
  let x = new Array(n).fill(1) as number[];
  const adj = adjacency(G, true);
  for (let it = 0; it < 1000; it++) {
    const y = x.map((xi, i) => xi + adj[i]!.reduce((s, { v }) => s + x[v]!, 0)); // A + I avoids bipartite oscillation
    const m = Math.max(...y);
    if (m === 0) return null;
    const nx = y.map((v) => v / m);
    const d = Math.max(...nx.map((v, i) => Math.abs(v - x[i]!)));
    x = nx;
    if (d < 1e-12) break;
  }
  return x;
}

function pagerank(input: string, G: Graph): Result {
  const n = G.names.length;
  const d = /\b(?:damping|d)\s*=?\s*(0?\.\d+)/i.exec(input) ? Number(/\b(?:damping|d)\s*=?\s*(0?\.\d+)/i.exec(input)![1]) : 0.85;
  const outs = G.names.map(() => [] as number[]);
  for (const e of G.edges) {
    outs[e.u]!.push(e.v);
    if (!G.directed) outs[e.v]!.push(e.u);
  }
  let r = new Array(n).fill(1 / n) as number[];
  const rows: string[][] = [['0', ...r.map((x) => fmt(x, 4))]];
  let it = 0;
  for (; it < 200; it++) {
    const dangling = r.reduce((s, x, i) => (outs[i]!.length ? s : s + x), 0);
    const nr = new Array(n).fill((1 - d) / n + (d * dangling) / n) as number[];
    r.forEach((x, i) => outs[i]!.forEach((v) => (nr[v]! += (d * x) / outs[i]!.length)));
    const delta = nr.reduce((s, x, i) => s + Math.abs(x - r[i]!), 0);
    r = nr;
    if (it < 5) rows.push([String(it + 1), ...r.map((x) => fmt(x, 4))]);
    if (delta < 1e-12) break;
  }
  rows.push([`${it + 1} (final)`, ...r.map((x) => fmt(x, 6))]);
  const top = r.indexOf(Math.max(...r));
  return answer(input, 'graph', `PageRank (d = ${d}) · ${base(G)}`, `highest: ${nm(G, top)} (${fmt(r[top]!, 4)})`, {
    lines: G.names.map((v, i) => ({ label: v, display: fmt(r[i]!, 6) })),
    table: { columns: ['iteration', ...G.names], rows, caption: 'Power iteration' },
    notes: ['PR(v) = (1 − d)/n + d·Σ PR(u)/outdeg(u) over links u → v; dangling vertices share their rank with everyone. Ranks sum to 1.'],
    figure: graphSvg(G),
  });
}

function spectrum(input: string, G: Graph, lc: string): Result {
  if (G.directed) refuse('Spectra here are for undirected graphs (symmetric adjacency matrix)');
  const n = G.names.length;
  if (n > 40) refuse('Up to 40 vertices');
  const A = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  for (const e of G.edges) if (e.u !== e.v) (A[e.u]![e.v] = 1), (A[e.v]![e.u] = 1);
  const deg = A.map((r) => r.reduce((s, x) => s + x, 0));
  const L = A.map((r, i) => r.map((x, j) => (i === j ? deg[i]! : -x)));
  const ev = symEigen(A).values;
  const lv = symEigen(L).values.sort((a, b) => a - b);
  const clean = (x: number) => (Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x);
  const trees = Math.round(lv.slice(1).reduce((p, x) => p * x, 1) / n);
  const tri = Math.round(ev.reduce((s, x) => s + x ** 3, 0) / 6);
  const laplacian = /\blaplacian|algebraic connectivity|fiedler|spanning trees?\b/.test(lc);
  const counting = /\bnumber of spanning trees|spanning tree count|how many spanning trees|count spanning trees\b/.test(lc);
  const lines: Line[] = [
    { label: 'Adjacency eigenvalues', display: ev.map((x) => fmt(clean(x), 6)).join(', ') },
    { label: 'Laplacian eigenvalues', display: lv.map((x) => fmt(clean(x), 6)).join(', ') },
    { label: 'Algebraic connectivity λ₂(L)', display: `${fmt(clean(lv[1] ?? 0), 6)} (${(lv[1] ?? 0) > 1e-9 ? 'connected' : 'disconnected'})` },
    { label: 'Spanning trees (Kirchhoff)', display: String(trees) },
    { label: 'Edges = Σλ²/2', display: fmt(clean(ev.reduce((s, x) => s + x * x, 0) / 2)) },
    { label: 'Triangles = Σλ³/6', display: String(tri) },
    { label: 'Spectral radius', display: `${fmt(clean(ev[0]!), 6)} (between average degree ${fmt((2 * G.edges.length) / n, 4)} and max degree ${Math.max(...deg)})` },
  ];
  return answer(input, 'graph', `${counting ? 'Spanning tree count' : laplacian ? 'Laplacian spectrum' : 'Graph spectrum'} · ${base(G)}`, counting ? String(trees) : laplacian ? `λ₂ = ${fmt(clean(lv[1] ?? 0), 6)}` : `λ₁ = ${fmt(clean(ev[0]!), 6)}`, {
    value: counting ? trees : undefined,
    lines,
    notes: ['Kirchhoff’s matrix-tree theorem: the number of spanning trees is the product of the nonzero Laplacian eigenvalues divided by n.', 'A graph is bipartite iff its adjacency spectrum is symmetric about 0.'],
    figure: graphSvg(G),
  });
}

function toposort(input: string, G: Graph): Result {
  if (!G.directed) refuse('Topological order needs a directed graph (use arrows: A->B)');
  const { inn } = degrees(G);
  const indeg = [...inn];
  const adj = adjacency(G);
  const q = G.names.map((_, i) => i).filter((i) => indeg[i] === 0).sort((a, b) => nm(G, a).localeCompare(nm(G, b), 'en', { numeric: true }));
  const order: number[] = [];
  while (q.length) {
    const u = q.shift()!;
    order.push(u);
    for (const { v } of adj[u]!) if (--indeg[v]! === 0) q.push(v), q.sort((a, b) => nm(G, a).localeCompare(nm(G, b), 'en', { numeric: true }));
  }
  if (order.length < G.names.length) return answer(input, 'graph', `Topological sort · ${base(G)}`, 'impossible: the graph has a cycle', { notes: ['Only directed acyclic graphs (DAGs) have a topological order.'], figure: graphSvg(G) });
  return answer(input, 'graph', `Topological sort (Kahn) · ${base(G)}`, order.map((i) => nm(G, i)).join(', '), { notes: ['Every arc goes from earlier to later in this order; ties are broken alphabetically.'], figure: graphSvg(G) });
}

function summary(input: string, G: Graph): Result {
  const { deg, inn, out } = degrees(G);
  const n = G.names.length;
  const comps = components(G);
  const part = bipartition(G);
  const lines: Line[] = [
    { label: 'Vertices', display: `${n}: ${G.names.join(', ')}` },
    { label: G.directed ? 'Arcs' : 'Edges', display: String(G.edges.length) },
    { label: G.directed ? 'In/out degrees' : 'Degrees', display: G.names.map((v, i) => (G.directed ? `${v} ${inn[i]}/${out[i]}` : `${v} ${deg[i]}`)).join(', ') },
    { label: 'Degree sequence', display: [...deg].sort((a, b) => b - a).join(', ') },
    { label: 'Handshake check', display: `Σ deg = ${deg.reduce((a, b) => a + b, 0)} = 2 × ${G.edges.length}` },
    { label: G.directed ? 'Weakly connected' : 'Connected', display: comps.length === 1 ? 'yes' : `no, ${comps.length} components: ${comps.map((c) => `{${c.map((i) => nm(G, i)).join(', ')}}`).join(' ')}` },
  ];
  if (G.directed) {
    const sc = sccs(G);
    lines.push({ label: 'Strongly connected', display: sc.length === 1 ? 'yes' : `no, ${sc.length} strong components: ${sc.map((c) => `{${c.map((i) => nm(G, i)).join(', ')}}`).join(' ')}` });
  }
  const simple = new Set(G.edges.map((e) => (G.directed ? `${e.u},${e.v}` : `${Math.min(e.u, e.v)},${Math.max(e.u, e.v)}`))).size === G.edges.length && G.edges.every((e) => e.u !== e.v);
  const m = G.edges.length;
  lines.push({ label: 'Bipartite', display: part ? `yes: {${G.names.filter((_, i) => part[i] === 0).join(', ')}} | {${G.names.filter((_, i) => part[i] === 1).join(', ')}}` : 'no (has an odd cycle)' });
  lines.push({ label: 'Tree', display: !G.directed && comps.length === 1 && m === n - 1 ? 'yes (connected with n − 1 edges)' : 'no' });
  lines.push({ label: 'Density', display: fmt(simple ? (G.directed ? m / (n * (n - 1)) : (2 * m) / (n * (n - 1))) : NaN, 4) });
  if (!G.directed && simple && m === (n * (n - 1)) / 2) lines.push({ label: 'Complete', display: `yes (K${n})` });
  if (G.weighted) lines.push({ label: 'Total weight', display: fmt(G.edges.reduce((s, e) => s + e.w, 0)) });
  const adjM = G.names.map((_, i) => G.names.map((_, j) => G.edges.filter((e) => (e.u === i && e.v === j) || (!G.directed && e.u === j && e.v === i)).reduce((s, e) => s + (G.weighted ? e.w : 1), 0)));
  return answer(input, 'graph', base(G), `${n} vertices, ${m} ${G.directed ? 'arcs' : 'edges'}`, {
    lines,
    table: n <= 12 ? { columns: ['', ...G.names], rows: adjM.map((r, i) => [nm(G, i), ...r.map((x) => fmt(x))]), caption: G.weighted ? 'Weight matrix' : 'Adjacency matrix' } : undefined,
    notes: [],
    figure: graphSvg(G),
  });
}

/** Routes graph questions. */
export function graphTheory(input: string): Result {
  const lc = input.toLowerCase();
  const asks = /\b(?:graph|vertices|vertex|edges?|nodes?|shortest|path|dijkstra|bellman|floyd|warshall|spanning|mst|kruskal|prim|max(?:imum)?[- ]flow|min(?:imum)?[- ]cut|bfs|dfs|breadth|depth|euler\w*|hamilton\w*|chromatic|colou?r\w*|planar\w*|matching|centrality|pagerank|page rank|spectrum|eigenvalues?|laplacian|topological|adjacency|degree|connected|bipartite|digraph|network|tree|k\d|petersen)\b/.test(lc);
  if (!asks) return null;
  const G = parseGraph(input);
  if (!G) return null;
  if (G.names.length > 200) refuse('Up to 200 vertices');
  if (/\bshortest|dijkstra|bellman|floyd|warshall|all[- ]pairs?|distance matrix|cheapest route|fastest route\b/.test(lc)) return shortestPath(input, G, lc);
  if (/\bspanning trees?\b/.test(lc) && /\bnumber of|how many|count\b/.test(lc)) return spectrum(input, G, lc);
  if (/\b(?:spanning tree|mst|kruskal|prim'?s?)\b/.test(lc)) return mst(input, G, lc);
  if (/\bmax(?:imum)?[- ]?flow|min(?:imum)?[- ]?cut\b/.test(lc)) return maxFlow(input, G);
  if (/\bbfs|dfs|breadth[- ]first|depth[- ]first|travers\w*\b/.test(lc)) return traversal(input, G, lc);
  if (/\beuler\w*/.test(lc)) return eulerian(input, G);
  if (/\bhamilton\w*|travell?ing salesman\b/.test(lc) && !/\btsp\b|salesman/.test(lc)) return hamiltonian(input, G, lc);
  if (/\bchromatic|colou?r(?:ing|able)?\b/.test(lc)) return coloring(input, G);
  if (/\bplanar\w*/.test(lc)) return planarity(input, G);
  if (/\bmatching\b/.test(lc)) return matching(input, G);
  if (/\bpage ?rank\b/.test(lc)) return pagerank(input, G);
  if (/\bcentrality|most central|betweenness|closeness\b/.test(lc)) return centrality(input, G, lc);
  if (/\bspectrum|spectral|eigenvalues?|laplacian|algebraic connectivity|fiedler\b/.test(lc)) return spectrum(input, G, lc);
  if (/\btopological\b/.test(lc)) return toposort(input, G);
  return summary(input, G);
}

