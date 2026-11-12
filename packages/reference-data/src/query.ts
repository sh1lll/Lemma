import { calculate, createSession, D, MathError, type Answer, type AnswerResult, type Dec } from '@lemma/math-core';
import { EXTRA_CONSTANTS, MATH_CONSTANTS, SEQUENCES, type Sequence } from './data/math';
import { bigInt, num, spokenUnit } from './format';
import { PROP_BY_PHRASE, PROP_SRC, propLabel, resolve, type Fact, type Line, type Prop, type Resolved } from './lookup';

const KIND = 'reference';

interface Text {
  input: string;
  /** Case-preserving, tidied. */
  t: string;
  /** Lowercase of t (same length). */
  s: string;
}

function tidy(input: string): Text {
  let t = input
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.]+$/, '')
    .trim();
  const lead = /^(?:(?:please|hey|ok|okay|so)\s+)?(?:(?:what(?:'s|s| is| are| was| were)|tell me|give me|show me|show|find me|find|look up|lookup|get me|get|do you know|i want to know|calculate|compute)\s+)?(?:the\s+)?/i.exec(t);
  t = t.slice(lead ? lead[0].length : 0).replace(/\s+please$/i, '').trim();
  return { input, t, s: t.toLowerCase() };
}

// ---------------------------------------------------------------- single property questions

interface Query {
  entity: string;
  prop: Prop;
}

const P = `(${PROP_SRC})`;
const CONNECT = '(?:of|in|on|for|at|about|from|to)';
const RE_PROP_OF = new RegExp(`^(?:how (?:many|much) )?${P} ${CONNECT} (.+)$`);
const RE_HOW_MANY = new RegExp(`^how (?:many|much) ${P} (?:(?:are|is|do|does|there|in|on|for|of|has|have)\\s+)*(.+?)(?: (?:have|has|got|contain|contains|hold))?$`);
const RE_POSS = new RegExp(`^(.+?)'s? ${P}$`);
const RE_SUFFIX = new RegExp(`^(.+?) ${P}$`);
const RE_PEOPLE = /^how many (?:people|inhabitants|persons|residents) (?:live|are there|are|reside|living) in (.+)$/;
const RE_FAR = /^how far (?:away )?is (.+?)(?: (?:away )?from (?:the )?(earth|sun|us))?(?: away)?$/;
const RE_DIST = [
  /^distance (?:from (?:the )?earth )?(?:to|of) (.+?)(?: from (?:the )?(earth|sun))?$/,
  /^distance (?:between|from) (?:the )?earth (?:and|to) (.+)$/,
  /^distance (?:between|from) (?:the )?(.+?) (?:and|to) (?:the )?earth$/,
];
const RE_DIST_SUN = [/^distance (?:between|from) (?:the )?sun (?:and|to) (.+)$/, /^(.+?) distance from (?:the )?sun$/];
const RE_HOW_ADJ = /^how (hot|cold|warm|big|large|heavy|massive|dense|wide) is (.+)$/;
const RE_DISCOVERED = /^(?:when|what year) (?:was|were|did) (.+?) (?:get )?discovered$/;
const RE_CAPITAL_IS = /^(?:which|what) (?:city )?is the capital of (.+)$/;
const RE_MOONS = /^how many moons (?:does|do|has|have) (.+?)(?: (?:have|got))?$/;
const RE_LEN = /^how long is (?:a|the) (day|year) on (.+)$/;

function parseQuery(s: string): Query[] {
  const out: Query[] = [];
  const push = (entity: string | undefined, phrase: string | Prop | undefined) => {
    if (!entity || !phrase) return;
    const prop = (PROP_BY_PHRASE.get(phrase) ?? phrase) as Prop;
    out.push({ entity: entity.trim(), prop });
  };
  let m: RegExpExecArray | null;
  if ((m = RE_PEOPLE.exec(s))) push(m[1], 'population');
  if ((m = RE_MOONS.exec(s))) push(m[1], 'moons');
  if ((m = RE_LEN.exec(s))) push(m[2], m[1] === 'day' ? 'day' : 'orbital');
  if ((m = RE_FAR.exec(s))) push(m[1], m[2] === 'sun' ? 'sunDistance' : 'distance');
  for (const re of RE_DIST_SUN) if ((m = re.exec(s))) push(m[1], 'sunDistance');
  for (const re of RE_DIST) if ((m = re.exec(s))) push(m[1], m[2] === 'sun' ? 'sunDistance' : 'distance');
  if ((m = RE_HOW_ADJ.exec(s))) {
    const adj = m[1]!;
    const prop: Prop = adj === 'hot' || adj === 'cold' || adj === 'warm' ? 'temperature' : adj === 'heavy' || adj === 'massive' ? 'mass' : adj === 'dense' ? 'density' : 'area';
    push(m[2], prop);
    // "how big is jupiter": radius for a body, area for a country.
    if (prop === 'area') push(m[2], 'radius');
  }
  if ((m = RE_DISCOVERED.exec(s))) push(m[1], 'discovered');
  if ((m = RE_CAPITAL_IS.exec(s))) push(m[1], 'capital');
  if ((m = RE_HOW_MANY.exec(s))) push(m[2], m[1]);
  if ((m = RE_PROP_OF.exec(s))) {
    const phrase = m[1]!;
    let entity = m[2]!;
    let prop = PROP_BY_PHRASE.get(phrase)!;
    // "distance from the sun to mars", "mars distance from the sun"
    const sun = / from (?:the )?sun$/.exec(entity);
    if (prop === 'distance' && sun) {
      entity = entity.slice(0, sun.index);
      prop = 'sunDistance';
    } else if (prop === 'distance') {
      entity = entity.replace(/ from (?:the )?earth$/, '');
    }
    push(entity, prop);
  }
  if ((m = RE_POSS.exec(s))) push(m[1], m[2]);
  if ((m = RE_SUFFIX.exec(s))) push(m[1], m[2]);
  return out;
}

function answerFact(input: string, r: Extract<Resolved, { ok: true }>): Answer {
  const { entity, fact, prop } = r;
  const lines: Line[] = [...(fact.lines ?? [])];
  const seen = new Set(lines.map((l) => l.label.toLowerCase()));
  for (const [p, line] of entity.summary()) {
    if (lines.length >= 6) break;
    if (p === prop || (prop === 'molarMass' && p === 'atomicMass') || seen.has(line.label.toLowerCase())) continue;
    if (prop === 'summary' && p === 'summary' && line.label === 'Overview') continue;
    lines.push(line);
    seen.add(line.label.toLowerCase());
  }
  return {
    ok: true,
    kind: KIND,
    input,
    expression: `${entity.name} · ${fact.label}`,
    primary: { display: fact.display, plain: fact.plain, spoken: fact.spoken, ...(fact.unit ? { unit: fact.unit } : {}) },
    ...(fact.value ? { value: fact.value } : {}),
    lines: lines.slice(0, 6),
    notes: [...new Set([...(fact.notes ?? []), ...(!entity.noteProps || entity.noteProps.has(prop) ? entity.notes : [])])],
    source: entity.source,
  };
}

function miss(input: string, message: string): AnswerResult {
  return { ok: false, kind: KIND, input, error: new MathError('domain', message) };
}

/** First phrase that names a known entity wins; a known entity without the property is a miss, not a pass. */
function resolveText(x: Text): Resolved | null {
  let failure: Resolved | null = null;
  for (const q of parseQuery(x.s)) {
    // Re-slice the entity from the case-preserving text (for symbols and formulas: "Fe", "CO" vs "Co").
    const at = x.s.lastIndexOf(q.entity);
    const entityText = at >= 0 ? x.t.slice(at, at + q.entity.length) : q.entity;
    const r = resolve(entityText, q.prop);
    if (!r) continue;
    if (r.ok) return r;
    failure ??= r;
  }
  return failure;
}

function single(x: Text): AnswerResult | null {
  const r = resolveText(x);
  if (!r) return null;
  return r.ok ? answerFact(x.input, r) : miss(x.input, r.message);
}

// ---------------------------------------------------------------- arithmetic with data

const OP = /(\*|×|·|\/|÷|\+|\^| [-−] |−|\btimes\b|\bmultiplied by\b|\bdivided by\b|\bover\b|\bplus\b|\bminus\b)/i;
const OP_SYM: Record<string, string> = { '*': '*', '×': '*', '·': '*', times: '*', 'multiplied by': '*', '/': '/', '÷': '/', 'divided by': '/', over: '/', '+': '+', plus: '+', '-': '-', '−': '-', minus: '-', '^': '^' };
const OP_SHOW: Record<string, string> = { '*': '×', '/': '÷', '+': '+', '-': '−', '^': '^' };
const NUMERIC = /^\(?\s*-?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?\s*\)?$|^\(?\s*-?\.\d+\s*\)?$/i;

interface Ref {
  r: Extract<Resolved, { ok: true }>;
  /** Operator just before this reference ('' at the start). */
  before: string;
}

function arithmetic(x: Text): AnswerResult | null {
  const parts = x.t.split(new RegExp(OP.source, 'gi'));
  if (parts.length < 3) return null;
  const expr: string[] = [];
  const shown: string[] = [];
  const refs: Ref[] = [];
  const ops: string[] = [];
  let numbers = 0;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!.trim();
    if (i % 2 === 1) {
      const op = OP_SYM[raw.toLowerCase()];
      if (!op) return null;
      ops.push(op);
      expr.push(op);
      shown.push(OP_SHOW[op]!);
      continue;
    }
    if (!raw) return null;
    if (NUMERIC.test(raw)) {
      const clean = raw.replace(/,/g, '');
      expr.push(clean);
      shown.push(clean);
      numbers++;
      continue;
    }
    // Only a reference phrase about a known entity counts; anything else is not ours.
    const res = resolveText(tidy(raw));
    if (!res) return null;
    if (!res.ok) return miss(x.input, res.message);
    if (!res.fact.value) return miss(x.input, `${res.entity.name} · ${res.fact.label} is not a number`);
    refs.push({ r: res, before: ops[ops.length - 1] ?? '' });
    expr.push(`(${res.fact.value.toFixed()})`);
    shown.push(`${res.entity.name} ${res.fact.label}`);
  }
  if (!refs.length) return null;
  const calc = calculate(expr.join(' '), createSession());
  if (!calc.ok) return { ok: false, kind: KIND, input: x.input, error: calc.error };

  const units = refs.map((f) => f.r.fact.calcUnit ?? '');
  const notes: string[] = [];
  let unit: string | undefined;
  const allSame = units.every((u) => u === units[0]);
  const u0 = units[0] ?? '';
  if (units.some((u) => u === '°C' || u === 'K')) {
    notes.push('Temperatures do not scale like ordinary quantities; the result is a plain number');
  } else if (refs.length === 1 && ops.every((o) => o === '*' || o === '/') && refs[0]!.before !== '/') {
    unit = u0 || undefined;
  } else if (refs.length === 1 && ops.every((o) => o === '+' || o === '-')) {
    unit = u0 || undefined;
    if (u0 && u0 !== 'people') notes.push(`The plain numbers are taken to be in ${u0}`);
  } else if (refs.length === 2 && ops.length === 1 && ops[0] === '/' && allSame) {
    notes.push(u0 && u0 !== 'people' ? `A ratio: the units (${u0}) cancel` : 'A ratio of the two values');
  } else if (allSame && ops.every((o) => o === '+' || o === '-') && numbers === 0) {
    unit = u0 || undefined;
  } else if (units.some(Boolean)) {
    notes.push(`Units: ${refs.map((f) => `${f.r.entity.name} ${f.r.fact.label} in ${f.r.fact.calcUnit || 'plain numbers'}`).join('; ')}`);
  }
  // Display units for the "people" and "US$" pseudo-units.
  if (unit === 'people') unit = undefined;
  // The data carry about four to six significant digits, so the result is shown to six.
  const shownNum = num(calc.value, 6);
  let display = shownNum.display;
  if (unit === 'US$') {
    display = `$${display}`;
    unit = undefined;
  }
  const lines: Line[] = refs.map((f) => ({ label: `${f.r.entity.name} · ${f.r.fact.label}`, display: f.r.fact.unit ? `${f.r.fact.display} ${f.r.fact.unit}` : f.r.fact.display }));
  const sources = [...new Map(refs.map((f) => [f.r.entity.source.name, f.r.entity.source])).values()];
  if (sources.length > 1) notes.push(`Also uses: ${sources.slice(1).map((s) => s.name).join('; ')}`);
  for (const f of refs) for (const n of f.r.entity.notes) if (!notes.includes(n) && /Approximate/.test(n)) notes.push(n);
  if (shownNum.rounded) notes.push('Rounded to 6 significant digits');
  return {
    ok: true,
    kind: KIND,
    input: x.input,
    expression: shown.join(' '),
    primary: { display, plain: calc.formatted.plain, spoken: `${shownNum.spoken}${unit ? ` ${spokenUnit(unit)}` : ''}`, ...(unit ? { unit } : {}) },
    value: calc.value,
    lines,
    notes,
    source: sources[0]!,
  };
}

// ---------------------------------------------------------------- math constants and sequences

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, 'a hundred': 100, 'one hundred': 100 };
const N_SRC = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a hundred|one hundred|hundred)';
const toN = (w: string) => (/^\d+$/.test(w) ? Number(w) : WORD_NUM[w] ?? NaN);
const MAX_TERMS = 200;

function mathConstant(x: Text): Answer | null {
  const s = x.s;
  let m: RegExpExecArray | null;
  let name: string | undefined;
  let digits: number | undefined;
  let dp = false;
  let valueForm = false;
  if ((m = /^(?:(?:exact |numerical |numeric |decimal )?value of|(?:the )?decimal expansion of|(?:the )?digits of|(?:the )?first (\d+) (?:digits|decimal places|decimals) of)\s+(?:the )?(.+?)(?: to (\d+) (digits|significant digits|significant figures|sig figs|decimal places|decimals|places))?$/.exec(s))) {
    name = m[2];
    valueForm = true;
    const n = m[1] ?? m[3];
    if (n) digits = Number(n);
    dp = !!m[4] && /decimal|places/.test(m[4]) || (!!m[1] && /decimal/.test(s));
  } else if ((m = /^(.+?) (?:to|with) (\d+) (digits|significant digits|significant figures|sig figs|decimal places|decimals|places)$/.exec(s))) {
    name = m[1];
    valueForm = true;
    digits = Number(m[2]);
    dp = /decimal|places/.test(m[3]!);
  } else if ((m = /^(.+?) (?:digits|value|decimal expansion)$/.exec(s))) {
    name = m[1];
    valueForm = true;
  } else {
    name = s;
  }
  if (!name) return null;
  name = name.replace(/^the /, '').trim();
  const c = MATH_CONSTANTS.find((k) => k.names.includes(name!) || (valueForm && k.bare.includes(name!)));
  if (!c) return null;
  const full = new D(c.value);
  const maxSig = c.value.replace(/^0\.|\./, '').replace(/^0+/, '').length - 1;
  let shown = full;
  let note = 'Rounded to 30 significant digits';
  if (digits !== undefined) {
    const intDigits = full.abs().gte(1) ? full.trunc().toString().length : 0;
    const sig = dp ? digits + intDigits : digits;
    if (sig < 1 || sig > maxSig) return null;
    shown = full.toSignificantDigits(sig, D.ROUND_HALF_UP);
    note = dp ? `Rounded to ${digits} decimal places` : `Rounded to ${digits} significant digits`;
    const str = dp ? shown.toFixed(digits) : shown.toPrecision(sig);
    return constAnswer(x.input, c.name, c.symbol, str, full, [note, ...(c.note ? [c.note] : [])]);
  }
  shown = full.toSignificantDigits(30, D.ROUND_HALF_UP);
  return constAnswer(x.input, c.name, c.symbol, shown.toPrecision(30), full, [note, ...(c.note ? [c.note] : [])]);
}

function constAnswer(input: string, name: string, symbol: string, str: string, value: Dec, notes: string[]): Answer {
  return {
    ok: true,
    kind: KIND,
    input,
    expression: `${name} (${symbol})`,
    primary: { display: str, plain: str, spoken: `${name}, approximately ${num(value, 6).spoken}` },
    value,
    lines: [{ label: 'Symbol', display: symbol }, { label: 'Approximately', display: num(value, 6).display }],
    notes,
    exactness: 'approximate',
  };
}

function findSeq(name: string): Sequence | undefined {
  const n = name.replace(/^(?:the )/, '').trim();
  return SEQUENCES.find((q) => q.names.includes(n));
}

function sequence(x: Text): Answer | null {
  const s = x.s.replace(/^(?:list|show|give me|print|write)(?: out)?(?: the| of the| of)?\s+/, '').replace(/^the /, '');
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^(?:first|initial) ${N_SRC} (.+?)(?: in the sequence)?$`).exec(s))) {
    const n = toN(m[1]!);
    const q = findSeq(m[2]!);
    if (!q || !(n >= 1)) return null;
    return seqTerms(x.input, q, n, `First ${n} ${q.name.toLowerCase()}`);
  }
  if ((m = /^(\d+)(?:st|nd|rd|th) (.+?)(?: in the sequence)?$/.exec(s))) {
    const n = Number(m[1]);
    const q = findSeq(m[2]!);
    if (!q || n < 1 || n > 10000) return null;
    const v = q.nth(n);
    const shown = bigInt(v);
    const ord = `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
    const notes = q.key === 'fibonacci' ? ['Counting F₁ = 1, F₂ = 1'] : q.key === 'catalan' ? ['Counting C₁ = 1, C₂ = 2'] : q.key === 'factorials' ? [`That is ${n}!`] : q.key === 'powers2' ? [`That is 2^${n}`] : [];
    return {
      ok: true,
      kind: KIND,
      input: x.input,
      expression: `${ord} ${q.names.find((nm) => !nm.endsWith('s')) ?? q.name.toLowerCase()}`,
      primary: { display: shown, plain: v.toString(), spoken: v.toString() },
      value: new D(v.toString()),
      lines: [{ label: 'OEIS', display: q.oeis }],
      notes,
      exactness: 'exact',
    };
  }
  if ((m = /^(?:all )?primes?(?: numbers?)? (?:up to|below|under|less than|to|smaller than) (\d+)$/.exec(s))) {
    const lim = Number(m[1]);
    if (lim > 100000) return null;
    const below = /below|under|less than|smaller than/.test(s);
    const all = SEQUENCES[0]!.terms(Math.max(1, Math.ceil(lim / Math.max(1, Math.log(lim) - 1.1)) + 10)).filter((p) => (below ? p < BigInt(lim) : p <= BigInt(lim)));
    if (all.length > MAX_TERMS) return null;
    return listAnswer(x.input, `Prime numbers ${below ? 'below' : 'up to'} ${lim}`, all, ['OEIS A000040']);
  }
  const q = findSeq(s.replace(/^list of /, ''));
  if (q && (/numbers|sequence|series/.test(s) || q.key === 'fibonacci')) return seqTerms(x.input, q, 10, `First 10 ${q.name.toLowerCase()}`);
  return null;
}

function seqTerms(input: string, q: Sequence, n: number, title: string): Answer | null {
  if (n > MAX_TERMS) return null;
  const terms = q.terms(n);
  return listAnswer(input, title, terms, [...(q.startNote ? [q.startNote] : []), `OEIS ${q.oeis}`]);
}

function listAnswer(input: string, title: string, terms: bigint[], notes: string[]): Answer {
  const text = terms.map((t) => t.toString()).join(', ');
  const sum = terms.reduce((a, b) => a + b, 0n);
  const last = terms[terms.length - 1] ?? 0n;
  return {
    ok: true,
    kind: KIND,
    input,
    expression: title,
    primary: { display: text, plain: text, spoken: text },
    value: new D(last.toString()),
    lines: [
      { label: 'Count', display: String(terms.length) },
      { label: 'Last term', display: bigInt(last) },
      { label: 'Sum', display: bigInt(sum) },
    ],
    notes,
    exactness: 'exact',
  };
}

function extraConstant(x: Text): Answer | null {
  const s = x.s.replace(/^(?:value of )(?:the )?/, '').replace(/ (?:value|constant value)$/, '');
  const c = EXTRA_CONSTANTS.find((k) => k.names.includes(s));
  if (!c) return null;
  const v = new D(c.value);
  const f = num(v, 15);
  const notes = ['CODATA 2018 recommended value'];
  notes.push(c.uncertainty === null ? 'Exact (derived from SI-defined constants); shown to 10 significant digits' : `Standard uncertainty ${num(new D(c.uncertainty)).display}${c.unit ? ` ${c.unit}` : ''}`);
  const lines: Line[] = [{ label: 'Symbol', display: c.symbol }];
  if (c.key === 'alpha') lines.push({ label: 'Inverse (1/α)', display: num(new D(1).div(v), 12).display });
  if (c.key === 'u') lines.push({ label: 'In MeV/c²', display: '931.49410242' });
  return {
    ok: true,
    kind: KIND,
    input: x.input,
    expression: `${c.name} (${c.symbol})`,
    primary: { display: f.display, plain: f.plain, spoken: `${f.spoken}${c.spokenUnit ? ` ${c.spokenUnit}` : ''}`, ...(c.unit ? { unit: c.unit } : {}) },
    value: v,
    lines,
    notes,
    source: { name: 'CODATA 2018 (NIST)', url: 'https://physics.nist.gov/cuu/Constants/', asOf: '2018' },
  };
}

// ---------------------------------------------------------------- entry

/**
 * Reference questions: element, compound, planet, star, country, food and math-constant facts, plus arithmetic with
 * them ("2 * density of gold"). Null when the input isn't one (unknown entity included), so other engines can try.
 */
export function answerReference(input: string): AnswerResult | null {
  if (!input || input.length > 300) return null;
  const x = tidy(input);
  if (!x.s) return null;
  return mathConstant(x) ?? sequence(x) ?? extraConstant(x) ?? arithmetic(x) ?? single(x);
}

export type { Fact };
export { propLabel };
