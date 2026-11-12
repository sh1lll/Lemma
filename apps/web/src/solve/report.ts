import { D, type Dec } from '@lemma/math-core';
import type { SymResult } from '@lemma/symbolic-engine';
import { factorize } from '@lemma/symbolic-engine/src/numtheory';
import { h, store, tex } from './dom';
import type { SolveContext, SolveHost } from './host';
import type { Analysed } from './index';
import { numberLine } from './steps-view';

/**
 * The full report under an answer (functions: alternate forms, plot, roots, domain and range, derivative,
 * integral, series, limits, properties; equations and inequalities: the solution set on a number line;
 * numbers: exact and decimal forms, continued fraction, prime factors, name, scientific notation, Roman
 * numerals). Every section loads on its own, after the answer is on screen; empty sections disappear.
 */
const OPEN_KEY = 'lemma.report-open';

export function buildReport(host: SolveHost, ctx: SolveContext, a: Analysed): void {
  const sections: [string, () => Promise<Node | null>][] = [];
  if (a.fn) functionSections(host, a, sections);
  else if (a.req?.op === 'solve' && a.req.exprs.length === 1 && !a.req.interval && a.req.domain !== 'complex') {
    const req = { op: 'report' as const, what: 'intervals', exprs: a.req.exprs, rels: a.req.rels, vars: a.req.vars, label: 'intervals' };
    sections.push(['Solution set', () => host.symbolic().run(req).then((r) => (r.ok && r.intervals?.length ? h('div', {}, tex(r.items?.[0]?.[1] ?? '', true), numberLine(r.intervals)) : null))]);
  }
  const value = numericValue(a);
  if (value) numberSections(host, a, value, sections);
  if (!sections.length) return;

  const box = h('details', { class: 'report', 'data-testid': 'report' });
  box.open = store.get(OPEN_KEY) !== '0';
  box.addEventListener('toggle', () => store.set(OPEN_KEY, box.open ? '1' : '0'));
  box.append(h('summary', {}, 'Full report'));
  const grid = h('div', { class: 'report-grid' });
  box.append(grid);
  ctx.alts.append(box);
  // Sections fill in one after another (the algebra engine works on one request at a time).
  let chain: Promise<unknown> = Promise.resolve();
  for (const [title, load] of sections) {
    const sec = h('section', { class: 'report-sec', 'data-section': title }, h('h3', {}, title), h('div', { class: 'report-wait', 'aria-hidden': 'true' }));
    grid.append(sec);
    chain = chain.then(async () => {
      if (!ctx.alive()) return;
      let node: Node | null = null;
      try {
        node = await load();
      } catch {
        node = null;
      }
      if (!node) sec.remove();
      else sec.replaceChildren(h('h3', {}, title), node);
      if (!grid.children.length) box.remove();
    });
  }
}

function sym(host: SolveHost, a: Analysed, what: string): Promise<SymResult> {
  return host.symbolic().run({ op: 'report', what, exprs: [a.fn!.expr], vars: [a.fn!.v], label: what });
}

/** [label, LaTeX, text] rows as a compact list. */
function items(r: SymResult): Node | null {
  if (!r.ok || !r.items?.length) return null;
  const dl = h('dl', { class: 'report-items' });
  for (const [label, latex] of r.items) dl.append(h('dt', {}, label), h('dd', {}, tex(latex)));
  return dl;
}

function functionSections(host: SolveHost, a: Analysed, out: [string, () => Promise<Node | null>][]) {
  const v = a.fn!.v;
  out.push(['Input', () => sym(host, a, 'alt').then((r) => (r.ok && r.latex_out ? tex(`f(${v}) = ${r.latex_out}`, true) : null))]);
  out.push(['Alternate forms', () => sym(host, a, 'alt').then((r) => items(r))]);
  out.push(['Plot', () => sym(host, a, 'alt').then((r) => (r.plain ? plot(host, r.plain) : null))]);
  out.push(['Roots', () => sym(host, a, 'roots').then((r) => (r.ok && r.none ? h('p', { class: 'report-note' }, 'No real roots') : rootsList(r)))]);
  out.push(['Domain and range', () => sym(host, a, 'domain').then((r) => items(r))]);
  out.push(['Derivative', () => sym(host, a, 'deriv').then((r) => (r.ok && r.items?.[0] ? tex(`\\frac{d}{d${v}} f = ${r.items[0][1]}`, true) : null))]);
  out.push(['Integral', () => sym(host, a, 'integral').then((r) => (r.ok && r.items?.[0] ? tex(`\\int f\\,d${v} = ${r.items[0][1]}`, true) : null))]);
  out.push(['Series at 0', () => sym(host, a, 'series').then((r) => (r.ok && r.items?.[0] ? tex(r.items[0][1], true) : null))]);
  out.push(['Limits', () => sym(host, a, 'limits').then((r) => items(r))]);
  out.push(['Properties', () => sym(host, a, 'props').then((r) => items(r))]);
}

function rootsList(r: SymResult): Node | null {
  if (!r.ok || !r.items?.length) return null;
  const ul = h('ul', { class: 'report-roots' });
  for (const [label, , text] of r.items) {
    const li = h('li', {}, tex(label));
    if (text && /^[−-]?\d/.test(text) && !label.endsWith(` = ${text}`) && !label.includes('approx')) li.append(h('span', { class: 'report-note' }, ` ≈ ${text}`));
    ul.append(li);
  }
  return ul;
}

async function plot(host: SolveHost, plain: string): Promise<Node | null> {
  if (/[A-Z]|\bI\b/.test(plain.replace(/\bE\b|\bpi\b/g, ''))) return null;
  const [{ parseGraph }, { GraphView }] = await Promise.all([import('@lemma/graph-engine'), import('../graph/view')]);
  let spec;
  try {
    spec = parseGraph(`graph ${plain.replace(/\bE\b/g, 'e')}`, host.session);
  } catch {
    return null;
  }
  const view = new GraphView(spec);
  view.root.classList.add('report-graph');
  return h('div', { class: 'report-plot' }, view.root);
}

// ---------- numbers ----------
function numericValue(a: Analysed): Dec | null {
  const o = a.outcome;
  if (o.kind === 'calc' && !o.result.assignment && !o.result.definition) return o.result.value;
  if (o.kind === 'answer' && (o.result.kind === 'arith' || o.result.kind === 'calc') && o.result.value && !o.result.primary.unit && /^[−-]?[\d.,]+$/.test(o.result.primary.display.replace(/\s/g, ''))) return o.result.value;
  return null;
}

function numberSections(host: SolveHost, a: Analysed, v: Dec, out: [string, () => Promise<Node | null>][]) {
  if (!v.isFinite()) return;
  const isInt = v.isInteger();
  const frac = a.outcome.kind === 'calc' ? a.outcome.result.fraction : undefined;
  const dec = v.toSignificantDigits(25).toString();
  const forms: [string, string][] = [];
  if (frac) forms.push(['Exact', `\\frac{${frac.split('/')[0]}}{${frac.split('/')[1]}}`.replace('\\frac{-', '-\\frac{')]);
  if (!isInt) forms.push(['Decimal', dec + (v.toSignificantDigits(40).toString().length > dec.length ? '\\ldots' : '')]);
  if (forms.length) out.push(['Exact and decimal forms', async () => dlist(forms)]);
  if (!v.isZero() && (v.abs().gte(1e4) || v.abs().lt(1e-3) || !isInt)) {
    const [m, e] = v.toExponential(8).split('e');
    const mm = m!.replace(/\.?0+$/, '');
    out.push(['Scientific notation', async () => tex(`${mm} \\times 10^{${Number(e)}}`, true)]);
  }
  if (!isInt || frac) {
    out.push(['Continued fraction', async () => {
      const cf = continuedFraction(v, frac);
      if (!cf || cf.terms.length < 2) return null;
      const [a0, ...rest] = cf.terms;
      return h('div', {}, tex(`[${a0}; ${rest.join(', ')}${cf.exact ? '' : ', \\ldots'}]`, true), cf.exact ? null : h('p', { class: 'report-note' }, 'From the decimal value, so only the first terms are reliable'));
    }]);
  }
  if (isInt && v.abs().gte(2) && v.abs().lt(1e18)) {
    out.push(['Prime factorization', async () => {
      const n = BigInt(v.abs().toFixed(0));
      const f = factorize(n);
      const parts = [...f.entries()].map(([p, k]) => (k > 1 ? `${p}^{${k}}` : `${p}`));
      const prime = f.size === 1 && [...f.values()][0] === 1;
      return h('div', {}, tex(`${v.isNegative() ? '-' : ''}${parts.join(' \\times ')}`, true), prime ? h('p', { class: 'report-note' }, `${n} is prime`) : null);
    }]);
  }
  if (isInt && v.abs().lt(1e15)) {
    out.push(['Number name', () => host.compute(`${v.toFixed(0)} in words`).then((o) => (o.kind === 'answer' ? h('p', { class: 'report-text' }, o.result.primary.display) : null))]);
  }
  if (isInt && v.gte(1) && v.lte(3999)) {
    out.push(['Roman numerals', () => host.compute(`${v.toFixed(0)} in roman numerals`).then((o) => (o.kind === 'answer' ? h('p', { class: 'report-text roman' }, o.result.primary.display) : null))]);
  }
}

function dlist(rows: [string, string][]): Node {
  const dl = h('dl', { class: 'report-items' });
  for (const [k, latex] of rows) dl.append(h('dt', {}, k), h('dd', {}, tex(latex)));
  return dl;
}

/** Continued fraction terms: exact for a known fraction, otherwise the first terms of the decimal. */
export function continuedFraction(v: Dec, frac?: string): { terms: string[]; exact: boolean } | null {
  let p: bigint;
  let q: bigint;
  let exact = false;
  if (frac && /^-?\d+\/\d+$/.test(frac)) {
    const [a, b] = frac.split('/');
    p = BigInt(a!);
    q = BigInt(b!);
    exact = true;
  } else {
    const s = v.toSignificantDigits(30).toFixed();
    const [ip, fp = ''] = s.replace('-', '').split('.');
    q = 10n ** BigInt(fp.length);
    p = BigInt(ip! + fp) * (s.startsWith('-') ? -1n : 1n);
    exact = fp.length < 12;
  }
  const terms: string[] = [];
  const floorDiv = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
  for (let i = 0; i < (exact ? 40 : 10) && q !== 0n; i++) {
    const t = floorDiv(p, q);
    terms.push(t.toString());
    [p, q] = [q, p - t * q];
  }
  return { terms, exact: exact && q === 0n };
}

export const _test = { continuedFraction, D };
