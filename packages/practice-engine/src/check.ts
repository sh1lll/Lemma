import { calculate, compileFloat, createSession, freeNames, parseInput, type Session } from '@lemma/math-core';
import type { CheckResult, Question } from './types';

const session: Session = (() => {
  const s = createSession();
  s.angle = 'rad';
  return s;
})();

/** Strips an "x =" style label, currency, approximation marks and trailing punctuation. */
function tidy(s: string): string {
  return s
    .trim()
    .replace(/^(?:the\s+)?answer\s*(?:is|:)\s*/i, '')
    .replace(/^[a-zA-Z]\s*(?:≈|=)\s*/, '')
    .replace(/^[≈~]\s*/, '')
    .replace(/\$/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[.。]\s*$/, '')
    .trim();
}

const UNIT_TAIL = /\s*[a-zA-Z°µ][a-zA-Z°²³/]*(?:\^[23])?\.?\s*$/;

const UNIT_ALIASES: Record<string, string> = {
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  in: 'in', inch: 'in', inches: 'in',
  ft: 'ft', foot: 'ft', feet: 'ft',
  yd: 'yd', yard: 'yd', yards: 'yd',
  mi: 'mi', mile: 'mi', miles: 'mi',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  '°c': '°c', c: '°c', celsius: '°c', centigrade: '°c',
  '°f': '°f', f: '°f', fahrenheit: '°f',
  'm/s': 'm/s', mps: 'm/s', 'meters per second': 'm/s', 'metres per second': 'm/s',
  'km/h': 'km/h', kph: 'km/h', kmh: 'km/h', 'km/hr': 'km/h', 'kilometers per hour': 'km/h', 'kilometres per hour': 'km/h',
  mph: 'mph', 'mi/h': 'mph', 'miles per hour': 'mph',
};

/**
 * The unit written after an answer ("5000 m", "9π cm²", "37.78 °C"), canonicalised, or null when there is none
 * or it isn't one we know (then the unit isn't judged).
 */
export function unitOf(raw: string): string | null {
  const m = /(?:(?:square|sq\.?|cubic)\s+)?(?:degrees?\s+)?°?\s*[a-zA-Zµ][a-zA-Z/]*(?:\s+per\s+[a-zA-Z]+)?(?:\^[23]|[²³])?\s*$/.exec(tidy(raw));
  if (!m) return null;
  let t = m[0].trim().toLowerCase().replace(/\s+/g, ' ');
  let pow = '';
  const sq = /^(?:square|sq\.?) (.+)$/.exec(t) ?? /^(.+?)(?:\^2|²)$/.exec(t);
  const cu = /^cubic (.+)$/.exec(t) ?? /^(.+?)(?:\^3|³)$/.exec(t);
  if (sq) [t, pow] = [sq[1]!, '²'];
  else if (cu) [t, pow] = [cu[1]!, '³'];
  t = t.replace(/^degrees? /, '').replace(/^°\s*/, '°');
  const base = UNIT_ALIASES[t];
  return base ? base + pow : null;
}

/** A number from free-form text, or null. Accepts fractions, mixed numbers, π, roots, and trailing units. */
export function parseNumber(raw: string): number | null {
  // "212 degrees F" is a temperature; math-core would read "degrees" as an angle and convert it to radians.
  let s = tidy(raw).replace(/\s*(?:°|\bdeg(?:rees?)?\b)\s*(?:c|f|k|celsius|centigrade|fahrenheit|kelvin)?\s*$/i, '');
  const mixed = /^([−-])?(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (mixed) {
    const v = Number(mixed[2]) + Number(mixed[3]) / Number(mixed[4]);
    return mixed[1] ? -v : v;
  }
  for (let i = 0; i < 3 && s; i++) {
    const r = calculate(s, session);
    if (r.ok && !r.definition && !r.assignment) {
      const v = r.value.toNumber();
      return Number.isFinite(v) ? v : null;
    }
    const next = s.replace(UNIT_TAIL, '');
    if (next === s) break;
    s = next;
  }
  return null;
}

const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const roundTo = (x: number, p: number) => Math.round((x + Math.sign(x) * 1e-9) * 10 ** p) / 10 ** p;

function result(q: Question, correct: boolean, feedback: string, close?: boolean): CheckResult {
  return close ? { correct, close, expected: q.answer.display, feedback } : { correct, expected: q.answer.display, feedback };
}

function checkNumber(q: Question, user: string): CheckResult {
  const disp = q.answer.display;
  const isPercent = /%\s*$/.test(disp);
  const isMoney = disp.includes('$');
  const E = parseNumber(disp.replace(/%\s*$/, ''));
  const PCT = /\s*(?:%|\bper\s?cent)\s*$/i;
  const userPercent = PCT.test(user.trim().replace(/[.]$/, ''));
  const u = parseNumber(user.trim().replace(/[.]$/, '').replace(PCT, ''));
  if (E === null) throw new Error(`unparseable expected answer ${disp}`);
  if (u === null) return result(q, false, 'I couldn’t read that as a number; try something like 12 or 3/4.');
  const roundMatch = /Round to (\d+) decimal/i.exec(q.prompt);
  const places = isMoney ? 2 : roundMatch ? Number(roundMatch[1]) : null;
  if (near(u, E) || (places !== null && near(roundTo(u, places), E))) {
    if (isPercent && !userPercent && Math.abs(E) < 1 && near(u * 100, E)) return result(q, false, `Write it as a percent: ${disp}.`, true);
    // A different unit makes the same number a different amount: "5000 mm" is not "5000 m".
    const eu = unitOf(disp), uu = unitOf(user);
    if (eu && uu && eu !== uu) return result(q, false, `The number is right, but the unit should be ${/\s(\S+)$/.exec(disp)?.[1] ?? eu}.`, true);
    return result(q, true, 'Correct.');
  }
  if (isPercent && !userPercent && near(u * 100, E)) return result(q, false, `Right value; write it as a percent: ${disp}.`, true);
  if (isMoney && Math.abs(u - E) <= 0.011) return result(q, false, 'Very close; check your rounding to the nearest cent.', true);
  if (E !== 0 && Math.abs(u - E) / Math.abs(E) <= 5e-3) {
    return result(q, false, places !== null ? `Close; round to ${places} decimal places.` : `Close, but the exact answer is ${disp}.`, true);
  }
  if (E !== 0 && near(u, -E)) return result(q, false, 'Check the sign.');
  return result(q, false, `Not quite; the answer is ${disp}.`);
}

/** Splits "x = 2 or x = 3", "2, 3", "1 ± √2" into numbers. */
function parseSet(raw: string): number[] | null {
  const parts = raw
    .replace(/[{}[\]]/g, '')
    .split(/\s*(?:\bor\b|\band\b|,|;)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const variants = p.includes('±') ? [p.replace('±', '+'), p.replace('±', '-')] : [p];
    for (const v of variants) {
      const n = parseNumber(v);
      if (n === null) return null;
      out.push(n);
    }
  }
  return out;
}

function uniq(xs: number[]): number[] {
  const out: number[] = [];
  for (const x of [...xs].sort((a, b) => a - b)) if (!out.some((o) => near(o, x, 1e-9))) out.push(x);
  return out;
}

function checkSet(q: Question, user: string): CheckResult {
  const E = uniq(parseSet(q.answer.display) ?? []);
  const parsed = parseSet(user);
  if (!parsed || !parsed.length) return result(q, false, 'I couldn’t read that; list the solutions like “x = 2 or x = 3”.');
  const U = uniq(parsed);
  const matched = (tol: number) => U.filter((u) => E.some((e) => near(u, e, tol))).length;
  const exact = matched(1e-9);
  if (exact === E.length && U.length === E.length) return result(q, true, 'Correct.');
  if (U.length === E.length && matched(5e-3) === E.length) return result(q, false, `Close; the exact solutions are ${q.answer.display}.`, true);
  if (exact === U.length && U.length < E.length) return result(q, false, `That’s right but incomplete; there ${E.length - U.length === 1 ? 'is another solution' : 'are more solutions'}.`);
  if (exact > 0) return result(q, false, `Partly right; the solutions are ${q.answer.display}.`);
  return result(q, false, `Not quite; the solutions are ${q.answer.display}.`);
}

function parsePair(raw: string): { x: number; y: number } | null {
  const named: Record<string, number> = {};
  const re = /([xy])\s*=\s*([^,;]+?)(?=\s*(?:,|;|\band\b|$|\s[xy]\s*=))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const v = parseNumber(m[2]!);
    if (v === null) return null;
    named[m[1]!.toLowerCase()] = v;
  }
  if (named.x !== undefined && named.y !== undefined) return { x: named.x, y: named.y };
  const parts = raw.replace(/[()]/g, ' ').split(/\s*(?:,|;|\band\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const x = parseNumber(parts[0]!), y = parseNumber(parts[1]!);
  return x === null || y === null ? null : { x, y };
}

function checkPair(q: Question, user: string): CheckResult {
  const E = parsePair(q.answer.display);
  const U = parsePair(user);
  if (!E) throw new Error(`unparseable expected answer ${q.answer.display}`);
  if (!U) return result(q, false, 'I couldn’t read that; answer like “x = 3, y = −2”.');
  if (near(U.x, E.x) && near(U.y, E.y)) return result(q, true, 'Correct.');
  if (near(U.x, E.y) && near(U.y, E.x)) return result(q, false, 'You have x and y swapped.');
  if (near(U.x, E.x, 5e-3) && near(U.y, E.y, 5e-3)) return result(q, false, `Close; the exact answer is ${q.answer.display}.`, true);
  if (near(U.x, E.x) || near(U.y, E.y)) return result(q, false, `One value is right; the answer is ${q.answer.display}.`);
  return result(q, false, `Not quite; the answer is ${q.answer.display}.`);
}

const SAMPLES: [number, number][] = [
  [0.7, 1.3],
  [1.3, 0.6],
  [1.9, 1.7],
  [0.45, 2.2],
  [2.6, 0.9],
  [1.1, 1.45],
];

/** Prepares typed algebra for the parser: drops "f'(x) =" labels and "+ C", separates glued names. */
function prepExpression(raw: string): { text: string; hadC: boolean } {
  let s = raw.trim().replace(/[.]\s*$/, '');
  const eq = s.split('=');
  if (eq.length === 2 && /^[\sa-zA-Z'′()/]*$/.test(eq[0]!)) s = eq[1]!;
  const hadC = /[+]\s*[cCkK](?![a-zA-Z(])/.test(s);
  s = s.replace(/[+]\s*[cCkK](?![a-zA-Z(])/g, '');
  s = s.replace(/x(?=(?:e\^|e\b|sin|cos|tan|ln|log|sqrt|exp|y))/g, 'x ').replace(/y(?=x)/g, 'y ');
  // In algebra, "2x(x + 1)" means 2·x·(x + 1), not 2 × (x + 1).
  s = s.replace(/(\d)\s*x\s*\(/g, '$1*x*(');
  return { text: s.trim(), hadC };
}

type Fn = (x: number, y: number) => number;

function compileExpression(text: string): Fn | { error: string } {
  try {
    const ast = parseInput(text, session);
    const names = freeNames(ast);
    const bad = names.filter((n) => n !== 'x' && n !== 'y');
    if (bad.length) return { error: `I don’t recognise “${bad[0]}” in that answer.` };
    const f = compileFloat(ast, { angle: 'rad', free: new Set(['x', 'y']) });
    return (x, y) => f({ x, y });
  } catch {
    return { error: 'I couldn’t read that expression; try something like 3x^2 + 2x.' };
  }
}

function checkExpression(q: Question, user: string): CheckResult {
  const exp = prepExpression(q.answer.display);
  const usr = prepExpression(user);
  const ef = compileExpression(exp.text);
  if ('error' in ef) throw new Error(`unparseable expected answer ${q.answer.display}`);
  if (!usr.text) return result(q, false, 'Please enter an expression.');
  const uf = compileExpression(usr.text);
  if ('error' in uf) return result(q, false, uf.error);
  const upToConstant = q.topic === 'integral';
  const diffs: number[] = [];
  const sums: number[] = [];
  for (const [x, y] of SAMPLES) {
    const e = ef(x, y);
    if (!Number.isFinite(e)) continue;
    const u = uf(x, y);
    if (!Number.isFinite(u)) return result(q, false, `Not quite; the answer is ${q.answer.display}.`);
    diffs.push(u - e);
    sums.push(u + e);
  }
  const scale = Math.max(1, ...SAMPLES.map(([x, y]) => Math.abs(ef(x, y))).filter(Number.isFinite));
  const tol = 1e-7 * scale;
  const constant = diffs.every((d) => Math.abs(d - diffs[0]!) <= tol);
  if (upToConstant ? constant : diffs.every((d) => Math.abs(d) <= tol)) {
    return result(q, true, upToConstant && !usr.hadC ? 'Correct; remember the + C.' : 'Correct.');
  }
  if (sums.every((s) => Math.abs(s) <= tol)) return result(q, false, 'Check the signs.');
  return result(q, false, `Not quite; the answer is ${q.answer.display}.`);
}

/** Checks an answer against a question, accepting equivalent forms. */
export function check(q: Question, userAnswer: string): CheckResult {
  const a = userAnswer ?? '';
  if (!a.trim()) return result(q, false, 'Please enter an answer.');
  switch (q.answer.kind) {
    case 'expression':
      return checkExpression(q, a);
    case 'set':
      return checkSet(q, a);
    case 'pair':
      return checkPair(q, a);
    default:
      return checkNumber(q, a);
  }
}
