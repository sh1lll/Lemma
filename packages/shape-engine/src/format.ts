import { D, formatNumber, MathError, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';
import { ex, exText, V } from './exact';
import { spokenUnit, unitText } from './units';

export type Dimension = 0 | 1 | 2 | 3 | 'angle' | 'count';

/** "6", "≈ 9.94718", "1.5". */
export function dec(x: number, digits = 6): { text: string; rounded: boolean } {
  if (!Number.isFinite(x)) return { text: String(x), rounded: false };
  if (Math.abs(x) < 1e-13) return { text: '0', rounded: false };
  const f = formatNumber(new D(x.toPrecision(15)), { digits });
  return { text: f.display, rounded: f.rounded };
}

/** Exact form text, or null when there is none worth showing (plain decimals, or long messy forms). */
export function exactText(v: V): string | null {
  if (!v.e) return null;
  const t = exText(v.e);
  if (t.length > 34) return null;
  const r = ex.rational(v.e);
  if (r) {
    // terminating decimals print as decimals
    let d = r.d;
    while (d % 2n === 0n) d /= 2n;
    while (d % 5n === 0n) d /= 5n;
    if (d === 1n && dec(v.x, 12).text.replace(/[,−-]/g, '').length <= 14) return null;
  }
  return t;
}

export function unitFor(dim: Dimension, base: string): string {
  if (dim === 'angle') return '°';
  if (dim === 0 || dim === 'count') return '';
  return unitText(base, dim);
}

/** "25π/3 ≈ 26.1799 cm²" */
export function show(v: V, dim: Dimension, base: string): string {
  const u = unitFor(dim, base);
  const sep = u === '°' ? '' : u ? ' ' : '';
  const e = exactText(v);
  const d = dec(v.x);
  const num = e ? `${e} ≈ ${d.text}` : `${d.rounded ? '≈ ' : ''}${d.text}`;
  return u ? `${num}${sep}${u}` : num;
}

export function spoken(v: V, dim: Dimension, base: string): string {
  const e = exactText(v);
  const d = dec(v.x);
  const u = dim === 'angle' ? 'degrees' : typeof dim === 'number' && dim > 0 ? spokenUnit(base, dim) : '';
  const say = (s: string) =>
    s
      .replace(/π/g, ' pi ')
      .replace(/√\(([^)]*)\)/g, ' root of $1 ')
      .replace(/√(\d+)/g, ' root $1 ')
      .replace(/\//g, ' over ')
      .replace(/−/g, ' minus ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${e ? `${say(e)}, about ` : d.rounded ? 'about ' : ''}${d.text.replace(/,/g, '')}${u ? ` ${u}` : ''}`;
}

export function toDec(v: V): Dec {
  if (v.e) {
    const r = ex.rational(v.e);
    if (r) return new D(r.n.toString()).div(new D(r.d.toString()));
  }
  return new D(Number.isFinite(v.x) ? v.x.toPrecision(15) : 0);
}

export function answer(input: string, a: Omit<Answer, 'ok' | 'input' | 'kind'> & { kind?: string }): Answer {
  return { ok: true, input, kind: a.kind ?? 'shape', ...a } as Answer;
}

export function need(input: string, msg: string): AnswerResult {
  return { ok: false, kind: 'shape', input, error: new MathError('ambiguous-reference', msg) };
}
export function fail(input: string, msg: string): AnswerResult {
  return { ok: false, kind: 'shape', input, error: new MathError('domain', msg) };
}

/** Primary block for a value. */
export function primaryOf(v: V, dim: Dimension, base: string): Answer['primary'] {
  const e = exactText(v);
  const d = dec(v.x);
  const u = unitFor(dim, base);
  const display = e ? `${e} ≈ ${d.text}` : `${d.rounded ? '≈ ' : ''}${d.text}`;
  return { display: u === '°' ? display + '°' : display, plain: Number.isFinite(v.x) ? String(+v.x.toPrecision(15)) : String(v.x), spoken: spoken(v, dim, base), ...(u && u !== '°' ? { unit: u } : {}) };
}
