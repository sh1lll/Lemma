import { parseFormula, molarMass, resolveSubstance, ELEMENTS } from '@lemma/science-engine';
import { nullspace } from '@lemma/science-engine/src/balance';
import { K, NUM, SNUM, fail, lab, named, need, num, ofDim, pct, res, show, temperatures, withUnit, type Ctx, type Handler } from './util';

const C = 'chemistry' as const;
const R = K.R;

// ─────────────── reactions ───────────────
export interface Sp {
  text: string;
  formula: string;
  counts: Map<string, bigint>;
  coef: number;
  mm: number;
  side: 'L' | 'R';
}
const ARROW = /\s*(?:->|-->|→|⟶|=>|⇌|<=>|<->|⇄|\byields\b)\s*/;
const STATE = /\((?:s|l|g|aq)\)$/;

/** Finds "A + B -> C + D" in the text and balances it (coefficients the user wrote are kept if consistent). */
export function reaction(text: string): Sp[] | null {
  const m = /([A-Z0-9(][A-Za-z0-9()·.\s+]*?)\s*(?:->|-->|→|⟶|=>|⇌|<=>|<->|⇄)\s*([A-Z0-9(][A-Za-z0-9()·.+\s]*?[A-Za-z0-9)])(?=\s*(?:,|;|\bwith\b|\bk\b|\bkc\b|\bkp\b|\bk\s*=|\bif\b|\bfrom\b|\busing\b|\bstarting\b|\binitial\b|$|\s\d|\s[a-z]))/.exec(text);
  if (!m) return null;
  const side = (s: string, sd: 'L' | 'R') =>
    s.split(/\s\+\s|\+/).map((x) => x.trim()).filter(Boolean).map((raw) => {
      const cm = /^(\d+)\s*(.*)$/.exec(raw);
      const coef = cm ? Number(cm[1]) : 0;
      const formula = (cm ? cm[2]! : raw).replace(STATE, '').trim();
      return { raw, coef, formula, sd };
    });
  const items = [...side(m[1]!, 'L'), ...side(m[2]!, 'R')];
  const sps: Sp[] = [];
  for (const it of items) {
    const counts = parseFormula(it.formula);
    if (!counts) return null;
    sps.push({ text: it.formula, formula: it.formula, counts, coef: it.coef, mm: molarMass(counts).toNumber(), side: it.sd });
  }
  if (sps.filter((s) => s.side === 'L').length === 0 || sps.filter((s) => s.side === 'R').length === 0) return null;
  const els = [...new Set(sps.flatMap((s) => [...s.counts.keys()]))];
  const rows = els.map((el) => sps.map((s) => (s.counts.get(el) ?? 0n) * (s.side === 'L' ? 1n : -1n)));
  const basis = nullspace(rows, sps.length);
  if (basis.length !== 1) return null;
  const v = basis[0]!;
  const g = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : g(b, a % b));
  let l = 1n;
  for (const [, d] of v) l = (l * d) / g(l, d);
  let ints = v.map(([n, d]) => (n * l) / d);
  if (ints.every((x) => x <= 0n)) ints = ints.map((x) => -x);
  if (ints.some((x) => x <= 0n)) return null;
  const gg = ints.reduce((a, b) => g(a, b));
  ints = ints.map((x) => x / gg);
  // Keep user coefficients if they are a multiple of the balanced set (e.g. fractional-free but doubled).
  const user = sps.map((s) => s.coef);
  const ratio = user[0]! / Number(ints[0]);
  const keep = user.every((u, i) => u > 0 && Math.abs(u / Number(ints[i]) - ratio) < 1e-9);
  sps.forEach((s, i) => (s.coef = keep ? user[i]! : Number(ints[i])));
  return sps;
}
export const eqText = (sps: Sp[]) =>
  `${sps.filter((s) => s.side === 'L').map((s) => `${s.coef === 1 ? '' : s.coef}${s.formula}`).join(' + ')} → ${sps.filter((s) => s.side === 'R').map((s) => `${s.coef === 1 ? '' : s.coef}${s.formula}`).join(' + ')}`;

/** "10 g C3H8" amounts attached to formulas in the text. */
function amounts(c: Ctx, sps: Sp[]): Map<Sp, number> {
  const out = new Map<Sp, number>();
  const unitRe = String.raw`(kg|mg|g|grams?|mol|moles?|mmol)`;
  for (const sp of sps) {
    const f = sp.formula.replace(/[()·.]/g, (ch) => '\\' + ch);
    const re = new RegExp(String.raw`(${NUM})\s*${unitRe}\s*(?:of\s+)?${f}(?![A-Za-z0-9])|${f}(?![A-Za-z0-9])\s*(?:=|:)?\s*(${NUM})\s*${unitRe}`);
    const m = re.exec(c.t);
    if (!m) continue;
    const x = num(m[1] ?? m[3]!);
    const u = (m[2] ?? m[4]!).toLowerCase();
    const mol = /mmol/.test(u) ? x / 1000 : /mol/.test(u) ? x : (x * (u === 'kg' ? 1000 : u === 'mg' ? 1e-3 : 1)) / sp.mm;
    out.set(sp, mol);
  }
  return out;
}

const stoich: Handler = (c) => {
  if (!/->|→|⟶|=>|⇌|<=>|\byields\b/.test(c.t)) return null;
  if (/^\s*balance\b/i.test(c.t) || /\bk\s*=|\bkc\b|\bkp\b|\bice\b|equilibrium|enthalpy|δh|Δh|heat of reaction/.test(c.s)) return null;
  const sps = reaction(c.t);
  if (!sps) return null;
  const amt = amounts(c, sps);
  if (!amt.size) return null;
  const target = (() => {
    for (const sp of sps) {
      const f = sp.formula.replace(/[()·.]/g, (ch) => '\\' + ch);
      if (new RegExp(String.raw`(?:grams?|mass|moles?|mol|how much|how many)\s+(?:of\s+)?${f}(?![A-Za-z0-9])`).test(c.t) && !amt.has(sp)) return sp;
    }
    return sps.find((s) => s.side === 'R' && !amt.has(s));
  })();
  const reactants = [...amt.keys()].filter((s) => s.side === 'L');
  const lines: [string, string][] = [['Balanced equation', eqText(sps)]];
  let limiting = reactants[0] ?? [...amt.keys()][0]!;
  if (reactants.length >= 2) {
    limiting = reactants.reduce((a, b) => (amt.get(a)! / a.coef <= amt.get(b)! / b.coef ? a : b));
    for (const r of reactants) lines.push([`${r.formula}`, `${show(amt.get(r)!)} mol → ${show(amt.get(r)! / r.coef)} reaction units`]);
    for (const r of reactants) if (r !== limiting) lines.push([`${r.formula} left over`, `${show((amt.get(r)! - (amt.get(limiting)! / limiting.coef) * r.coef) * r.mm)} g`]);
  }
  const extent = amt.get(limiting)! / limiting.coef;
  const actual = new RegExp(String.raw`actual (?:yield )?(?:of |is |was )?(${NUM})\s*g|(${NUM})\s*g\s*(?:were |was )?(?:actually )?(?:obtained|recovered|collected|produced)`).exec(c.s);
  if (/limiting/.test(c.s) && reactants.length >= 2) {
    const prod = target ?? sps.find((s) => s.side === 'R')!;
    lines.push([`Theoretical ${prod.formula}`, `${show(extent * prod.coef * prod.mm)} g`]);
    return res(c, { kind: C, expression: `Limiting reagent for ${eqText(sps)}`, display: limiting.formula, lines, notes: ['The limiting reagent gives the fewest reaction units (moles ÷ coefficient)', 'Molar masses from IUPAC standard atomic weights'] });
  }
  if (!target) return need(c, C, 'Which product (or reactant) do you want the amount of?');
  const mol = extent * target.coef;
  if (actual) {
    const th = mol * target.mm;
    const a = num(actual[1] ?? actual[2]!);
    lines.push([`Theoretical ${target.formula}`, `${show(th)} g`]);
    return res(c, { kind: C, expression: `Percent yield of ${target.formula}`, value: (a / th) * 100, unit: '%', formula: 'yield = actual / theoretical × 100%', lines });
  }
  const wantMol = new RegExp(String.raw`(?:moles?|mol)\s+(?:of\s+)?`).test(c.s) && !/grams?|mass/.test(c.s);
  lines.push([`Moles of ${target.formula}`, `${show(mol)} mol`], [`Molar mass of ${target.formula}`, `${show(target.mm, 5)} g/mol`]);
  if (reactants.length >= 2) lines.push(['Limiting reagent', limiting.formula]);
  return res(c, {
    kind: C,
    expression: `Stoichiometry: ${wantMol ? 'moles' : 'mass'} of ${target.formula} from ${[...amt.keys()].map((s) => s.formula).join(' and ')}`,
    value: wantMol ? mol : mol * target.mm,
    unit: wantMol ? 'mol' : 'g',
    unitWords: wantMol ? 'moles' : 'grams',
    formula: `n(${target.formula}) = n(${limiting.formula}) × ${target.coef}/${limiting.coef}`,
    lines,
    notes: ['Assumes the reaction goes to completion'],
  });
};

const percentYield: Handler = (c) => {
  if (!/percent yield|% yield|percentage yield/.test(c.s) || /->|→/.test(c.t)) return null;
  const a = new RegExp(String.raw`actual(?: yield)?\s*(?:of|is|=|:)?\s*(${NUM})`).exec(c.s);
  const t = new RegExp(String.raw`theoretical(?: yield)?\s*(?:of|is|=|:)?\s*(${NUM})`).exec(c.s);
  if (!a || !t) return need(c, C, 'Percent yield needs the actual and theoretical yields');
  return res(c, { kind: C, expression: 'Percent yield', value: (num(a[1]!) / num(t[1]!)) * 100, unit: '%', formula: 'actual / theoretical × 100%' });
};

// ─────────────── formulas ───────────────
const pctComp: Handler = (c) => {
  const m = /(?:percent(?:age)? composition|mass percent(?:age)?|percent by mass|% composition|mass fraction)(?: of)?\s+(?:([a-z]+|[A-Z][a-z]?)\s+in\s+)?(.+)$/i.exec(c.t);
  if (!m) return null;
  const sub = resolveSubstance(m[2]!);
  if (!sub) return null;
  const M = sub.molarMass.toNumber();
  const rows = [...sub.counts].map(([el, n]) => {
    const e = ELEMENTS.find((x) => x.symbol === el)!;
    const mass = e.weight.toNumber() * Number(n);
    return [el, String(n), show(mass, 5), `${show((mass / M) * 100, 4)}%`];
  });
  if (m[1]) {
    const want = ELEMENTS.find((e) => e.symbol.toLowerCase() === m[1]!.toLowerCase() || e.name.toLowerCase() === m[1]!.toLowerCase());
    const n = want ? sub.counts.get(want.symbol) : undefined;
    if (!want || !n) return fail(c, C, `${m[1]} isn't in ${sub.formula}`);
    const p = (want.weight.toNumber() * Number(n)) / M;
    return res(c, { kind: C, expression: `Mass percent of ${want.name} in ${sub.formula}`, value: p * 100, unit: '%', formula: 'n × atomic mass / molar mass × 100%', lines: [['Molar mass', `${show(M, 5)} g/mol`]] });
  }
  return res(c, { kind: C, expression: `Percent composition of ${sub.formula}`, display: rows.map((r) => `${r[0]} ${r[3]}`).join(', '), table: { columns: ['Element', 'Atoms', 'Mass (g/mol)', 'Mass %'], rows }, lines: [['Molar mass', `${show(M, 5)} g/mol`]], notes: ['IUPAC standard atomic weights'] });
};

const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const empirical: Handler = (c) => {
  if (!/empirical formula|molecular formula|simplest formula/.test(c.s)) return null;
  if (/molecular formula/.test(c.s) && !/%|percent|grams?\b/.test(c.s)) {
    const m = /empirical(?: formula)?\s*(?:is|of|=)?\s*([A-Z][A-Za-z0-9()]*)/.exec(c.t);
    const M = new RegExp(String.raw`(?:molar mass|molecular (?:mass|weight)|mass|mw)\s*(?:of|is|=)?\s*(${NUM})`).exec(c.s);
    if (!m || !M) return need(c, C, 'Molecular formula needs the empirical formula and the molar mass');
    const counts = parseFormula(m[1]!);
    if (!counts) return null;
    const em = molarMass(counts).toNumber();
    const k = Math.round(num(M[1]!) / em);
    if (k < 1 || Math.abs(num(M[1]!) / em - k) > 0.05 * k) return fail(c, C, `${show(num(M[1]!))} isn't close to a whole multiple of the empirical mass ${show(em)}`);
    const f = [...counts].map(([el, n]) => el + (Number(n) * k === 1 ? '' : String(Number(n) * k))).join('');
    return res(c, { kind: C, expression: `Molecular formula from ${m[1]} and M = ${M[1]} g/mol`, display: f.replace(/\d/g, (d) => SUBS[Number(d)]!), lines: [['Empirical mass', `${show(em, 5)} g/mol`], ['Multiplier', String(k)]] });
  }
  const re = new RegExp(String.raw`(${NUM})\s*(?:%|g|grams?)?\s*(?:of\s+)?([A-Z][a-z]?)(?![a-z])|([A-Z][a-z]?)\s*(?:=|:)?\s*(${NUM})\s*(?:%|g)`, 'g');
  const parts: [string, number][] = [];
  for (const m of c.t.matchAll(re)) {
    const el = m[2] ?? m[3]!;
    const x = num(m[1] ?? m[4]!);
    if (ELEMENTS.some((e) => e.symbol === el)) parts.push([el, x]);
  }
  if (parts.length < 2) return need(c, C, 'Give each element with its percentage or mass, e.g. "40% C, 6.7% H, 53.3% O"');
  const mols = parts.map(([el, x]) => [el, x / ELEMENTS.find((e) => e.symbol === el)!.weight.toNumber()] as [string, number]);
  const min = Math.min(...mols.map((x) => x[1]));
  const ratios = mols.map(([el, n]) => [el, n / min] as [string, number]);
  let mult = 1;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    if (ratios.every(([, r]) => Math.abs(r * k - Math.round(r * k)) < 0.1)) {
      mult = k;
      break;
    }
    mult = 0;
  }
  if (!mult) return fail(c, C, `The mole ratios (${ratios.map(([e, r]) => `${e} ${show(r)}`).join(', ')}) don't round to small whole numbers; check the data`);
  const ints = ratios.map(([el, r]) => [el, Math.round(r * mult)] as [string, number]);
  const f = ints.map(([el, n]) => el + (n === 1 ? '' : n)).join('');
  return res(c, { kind: C, expression: 'Empirical formula from composition', display: f.replace(/\d/g, (d) => SUBS[Number(d)]!), table: { columns: ['Element', 'Given', 'Moles (per 100 g)', 'Ratio'], rows: parts.map(([el, x], i) => [el, show(x), show(mols[i]![1]), show(ratios[i]![1] * mult, 3)]) }, lines: [['Plain', f]], notes: ['Percentages are treated as grams in a 100 g sample'] });
};

// ─────────────── acids & bases ───────────────
const WEAK: [RegExp, number, 'a' | 'b', string][] = [
  [/acetic|ethanoic|ch3cooh|vinegar/, 1.8e-5, 'a', 'acetic acid'], [/formic|methanoic|hcooh/, 1.8e-4, 'a', 'formic acid'], [/hydrofluoric|\bhf\b/, 6.8e-4, 'a', 'hydrofluoric acid'],
  [/hypochlorous|hocl|hclo\b/, 3.0e-8, 'a', 'hypochlorous acid'], [/benzoic/, 6.3e-5, 'a', 'benzoic acid'], [/nitrous|hno2/, 4.5e-4, 'a', 'nitrous acid'], [/hydrocyanic|\bhcn\b/, 4.9e-10, 'a', 'hydrocyanic acid'],
  [/carbonic|h2co3/, 4.3e-7, 'a', 'carbonic acid (Ka1)'], [/ammonia|nh3|ammonium hydroxide/, 1.8e-5, 'b', 'ammonia'], [/methylamine|ch3nh2/, 4.4e-4, 'b', 'methylamine'], [/pyridine/, 1.7e-9, 'b', 'pyridine'],
];
const kaOf = (c: Ctx) => named(c, 'ka|k_a|acid dissociation constant');
const kbOf = (c: Ctx) => named(c, 'kb|k_b|base dissociation constant');
const pkaOf = (c: Ctx) => named(c, 'pka|pk_a');

function concOf(c: Ctx): number | null {
  const q = ofDim(c, 'conc')[0];
  if (q) return q.v;
  const m = new RegExp(String.raw`(${NUM})\s*(?:molar|mol\/l|mol per lit(?:er|re))\b`).exec(c.s);
  return m ? num(m[1]!) : null;
}
const acidBase: Handler = (c) => {
  // pKa ↔ Ka, Kb from Ka
  if (/\bpka\b|\bpkb\b/.test(c.s) && !/buffer|henderson|ph of|\bph\b.*(?:m|molar)\b|titrat/.test(c.s)) {
    const ka = kaOf(c);
    const pka = pkaOf(c);
    if (ka !== null && /pka/.test(c.s.slice(0, c.s.search(/\bka\b/) + 1) + c.s)) return res(c, { kind: C, expression: `pKa from Ka = ${show(ka)}`, value: -Math.log10(ka), formula: 'pKa = −log₁₀ Ka', lines: [['pKb of conjugate base', show(14 + Math.log10(ka))]] });
    if (pka !== null) return res(c, { kind: C, expression: `Ka from pKa = ${show(pka)}`, value: 10 ** -pka, formula: 'Ka = 10^(−pKa)' });
    const kb = kbOf(c);
    if (kb !== null) return res(c, { kind: C, expression: `pKb from Kb = ${show(kb)}`, value: -Math.log10(kb), formula: 'pKb = −log₁₀ Kb' });
  }
  if (/conjugate/.test(c.s) && (kaOf(c) !== null || kbOf(c) !== null)) {
    const ka = kaOf(c);
    if (ka !== null) return res(c, { kind: C, expression: 'Kb of the conjugate base', value: 1e-14 / ka, formula: 'Ka·Kb = Kw = 1.0 × 10⁻¹⁴ (25 °C)' });
    const kb = kbOf(c)!;
    return res(c, { kind: C, expression: 'Ka of the conjugate acid', value: 1e-14 / kb, formula: 'Ka·Kb = Kw = 1.0 × 10⁻¹⁴ (25 °C)' });
  }
  // Buffers (Henderson–Hasselbalch)
  if (/buffer|henderson/.test(c.s)) {
    let pka = pkaOf(c);
    const ka = kaOf(c);
    const w = WEAK.find(([re]) => re.test(c.s));
    if (pka === null && ka !== null) pka = -Math.log10(ka);
    if (pka === null && w) pka = w[2] === 'a' ? -Math.log10(w[1]) : 14 + Math.log10(w[1]);
    if (pka === null) return need(c, C, 'A buffer needs the pKa (or Ka) of the weak acid');
    const cs = [...c.s.matchAll(new RegExp(String.raw`(${NUM})\s*(?:m|mol\/l|molar|mol)\b\s*(?:of\s+)?([a-z0-9\-⁻\[\] ]{0,30}?)(?=,|\band\b|$|\d)`, 'g'))].map((m) => ({ x: num(m[1]!), what: m[2]! }));
    const baseRe = /base|salt|acetate|a-|a⁻|conjugate|sodium|ammonia\b|nh3|formate|fluoride/;
    const acidRe = /acid|ha\b|ammonium|nh4/;
    let A = named(c, 'base|salt|a-|a⁻|\\[a-\\]|conjugate base');
    let HA = named(c, 'acid|ha|\\[ha\\]');
    if (A === null || HA === null) {
      const b = cs.find((x) => baseRe.test(x.what) && !/acetic acid/.test(x.what));
      const a = cs.find((x) => x !== b && acidRe.test(x.what));
      if (b && a) [A, HA] = [b.x, a.x];
    }
    const ratio = named(c, 'ratio');
    if ((A === null || HA === null) && ratio === null) return need(c, C, 'Which concentration is the conjugate base and which is the acid (e.g. "base 0.1 M, acid 0.2 M")?');
    const r = ratio ?? A! / HA!;
    return res(c, { kind: C, expression: 'Buffer pH (Henderson–Hasselbalch)', value: pka + Math.log10(r), sig: 4, formula: 'pH = pKa + log([A⁻]/[HA])', lines: [['pKa', show(pka)], ['[A⁻]/[HA]', show(r)]], notes: w && pkaOf(c) === null && ka === null ? [`pKa from Ka(${w[3]}) = ${show(w[1])}`] : [] });
  }
  // Titration
  if (/titrat|equivalence|endpoint|end point/.test(c.s)) {
    const vols = ofDim(c, 'volume');
    const concs = ofDim(c, 'conc');
    if (vols.length < 1 || concs.length < 2) return need(c, C, 'Titration needs the analyte volume and concentration, and the titrant concentration');
    const [Va, Ca, Cb] = [vols[0]!.v, concs[0]!.v, concs[1]!.v];
    const Veq = (Va * Ca) / Cb;
    const ka = kaOf(c) ?? (WEAK.find(([re, , t]) => t === 'a' && re.test(c.s))?.[1] ?? null);
    if (/half/.test(c.s)) {
      if (ka === null) return need(c, C, 'pH at half-equivalence equals pKa: what is the Ka?');
      return res(c, { kind: C, expression: 'pH at half-equivalence', value: -Math.log10(ka), formula: 'pH = pKa (at half-equivalence [HA] = [A⁻])', lines: [['Half-equivalence volume', withUnit((Veq * 1e6) / 2, 'mL')]] });
    }
    if (/ph/.test(c.s) && /equivalence/.test(c.s)) {
      if (ka === null) return res(c, { kind: C, expression: 'pH at equivalence (strong acid + strong base)', value: 7, formula: 'Neutral salt: pH = 7 at 25 °C', lines: [['Equivalence volume', withUnit(Veq * 1e6, 'mL')]] });
      const Cs = (Ca * Va) / (Va + Veq);
      const kb = 1e-14 / ka;
      const oh = (-kb + Math.sqrt(kb * kb + 4 * kb * Cs)) / 2;
      return res(c, { kind: C, expression: 'pH at equivalence (weak acid + strong base)', value: 14 + Math.log10(oh), formula: 'A⁻ + H₂O ⇌ HA + OH⁻, Kb = Kw/Ka', lines: [['Equivalence volume', withUnit(Veq * 1e6, 'mL')], ['[A⁻] at equivalence', withUnit(Cs, 'M')], ['Kb', show(kb)]] });
    }
    return res(c, { kind: C, expression: 'Titrant volume to the equivalence point', value: Veq * 1e6, unit: 'mL', unitWords: 'millilitres', formula: 'C_a V_a = C_b V_b (1:1 stoichiometry)', notes: ['Assumes a 1:1 mole ratio (e.g. HCl + NaOH); scale for diprotic acids'] });
  }
  // Weak acid / weak base pH
  if (/\bp(?:oh|h)\b/.test(c.s) && (/\bka\b|\bkb\b|\bpka\b|weak/.test(c.s) || WEAK.some(([re]) => re.test(c.s)))) {
    const C0 = concOf(c);
    if (C0 === null) return need(c, C, 'What is the concentration (M)?');
    let K0 = kaOf(c);
    let type: 'a' | 'b' = 'a';
    const pka = pkaOf(c);
    if (K0 === null && pka !== null) K0 = 10 ** -pka;
    if (K0 === null) {
      const kb = kbOf(c);
      if (kb !== null) [K0, type] = [kb, 'b'];
    }
    const w = WEAK.find(([re]) => re.test(c.s));
    const notes: string[] = [];
    if (K0 === null && w) {
      [K0, type] = [w[1], w[2]];
      notes.push(`${type === 'a' ? 'Ka' : 'Kb'}(${w[3]}) = ${show(w[1])} at 25 °C (textbook value)`);
    } else if (w && kbOf(c) === null) type = w[2];
    if (K0 === null) return need(c, C, 'For a weak acid or base I need its Ka or Kb');
    const x = (-K0 + Math.sqrt(K0 * K0 + 4 * K0 * C0)) / 2;
    const pX = -Math.log10(x);
    const pH = type === 'a' ? pX : 14 - pX;
    notes.push('Exact quadratic for x²/(C − x) = K; water autoionisation neglected; 25 °C (Kw = 10⁻¹⁴)');
    return res(c, {
      kind: C,
      expression: `pH of ${show(C0)} M weak ${type === 'a' ? 'acid' : 'base'}, ${type === 'a' ? 'Ka' : 'Kb'} = ${show(K0)}`,
      value: /\bpoh\b/.test(c.s) ? 14 - pH : pH,
      formula: type === 'a' ? '[H⁺] = (−Ka + √(Ka² + 4KaC))/2' : '[OH⁻] = (−Kb + √(Kb² + 4KbC))/2',
      lines: [[type === 'a' ? '[H⁺]' : '[OH⁻]', withUnit(x, 'M')], ['Percent ionised', pct(x / C0)], [/\bpoh\b/.test(c.s) ? 'pH' : 'pOH', show(/\bpoh\b/.test(c.s) ? pH : 14 - pH)]],
      notes,
    });
  }
  return null;
};

// ─────────────── equilibrium ───────────────
const equilibrium: Handler = (c) => {
  if (/\bkp\b.*\bkc\b|\bkc\b.*\bkp\b/.test(c.s)) {
    const kc = named(c, 'kc');
    const kp = named(c, 'kp');
    const T = temperatures(c)[0];
    const dn = named(c, 'Δn|delta n|dn|change in moles(?: of gas)?');
    if (!T || dn === null) return need(c, C, 'Converting Kp/Kc needs T and Δn (moles of gas products − reactants)');
    const f = (0.082057366 * T.k) ** dn;
    if (kc !== null && !/kp\s*(?:=|of|is)\s*\d/.test(c.s)) return res(c, { kind: C, expression: 'Kp from Kc', value: kc * f, formula: 'Kp = Kc(RT)^Δn, R = 0.08206 L·atm/(mol·K)' });
    if (kp !== null) return res(c, { kind: C, expression: 'Kc from Kp', value: kp / f, formula: 'Kc = Kp/(RT)^Δn' });
  }
  if (!/\bice\b|equilibrium concentration|at equilibrium|\bkc?\s*=|\bkeq\b/.test(c.s) || !/->|→|⇌|<=>|=>/.test(c.t)) return null;
  const sps = reaction(c.t);
  if (!sps) return need(c, C, 'Write the reaction with formulas, e.g. "H2 + I2 ⇌ 2HI"');
  const Kc = named(c, 'kc|keq|k');
  if (Kc === null) return need(c, C, 'What is the equilibrium constant K?');
  const init = new Map<Sp, number>();
  for (const sp of sps) {
    const f = sp.formula.replace(/[()]/g, (ch) => '\\' + ch);
    const m = new RegExp(String.raw`\[${f}\]\s*(?:0|₀|_0|initial)?\s*(?:=|:|is)?\s*(${NUM})|(${NUM})\s*(?:m|mol\/l|molar)\s+(?:of\s+)?${f}(?![A-Za-z0-9])|${f}(?![A-Za-z0-9])\s*(?:=|:)\s*(${NUM})`).exec(c.t);
    init.set(sp, m ? num(m[1] ?? m[2] ?? m[3]!) : 0);
  }
  const sgn = (s: Sp) => (s.side === 'L' ? -1 : 1);
  const conc = (x: number) => sps.map((s) => init.get(s)! + sgn(s) * s.coef * x);
  const Q = (x: number) => {
    const cs = conc(x);
    let num_ = 1;
    let den = 1;
    sps.forEach((s, i) => {
      if (s.side === 'R') num_ *= cs[i]! ** s.coef;
      else den *= cs[i]! ** s.coef;
    });
    return num_ / den;
  };
  // Feasible x range: concentrations stay ≥ 0.
  let lo = -Infinity;
  let hi = Infinity;
  for (const s of sps) {
    const c0 = init.get(s)!;
    if (s.side === 'L') hi = Math.min(hi, c0 / s.coef);
    else lo = Math.max(lo, -c0 / s.coef);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return need(c, C, 'Give the initial concentrations, e.g. "[H2] = 1 M, [I2] = 1 M"');
  const f = (x: number) => Math.log(Q(x)) - Math.log(Kc);
  let a = lo + (hi - lo) * 1e-15;
  let b = hi - (hi - lo) * 1e-15;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (f(m) > 0) b = m;
    else a = m;
  }
  const x = (a + b) / 2;
  const fin = conc(x);
  const rows = sps.map((s, i) => [s.formula, show(init.get(s)!), `${sgn(s) * s.coef > 0 ? '+' : '−'}${s.coef === 1 ? '' : s.coef}x`, show(fin[i]!)]);
  return res(c, {
    kind: C,
    expression: `ICE table for ${eqText(sps)}, K = ${show(Kc)}`,
    value: x,
    display: sps.map((s, i) => `[${s.formula}] = ${show(fin[i]!)} M`).join(', '),
    formula: 'K = Π[products]^ν / Π[reactants]^ν, solved for x',
    table: { columns: ['Species', 'Initial (M)', 'Change', 'Equilibrium (M)'], rows },
    lines: [['x', show(x, 5)], ['Check Q', show(Q(x))]],
  });
};

// ─────────────── kinetics ───────────────
const kinetics: Handler = (c) => {
  if (/arrhenius|activation energy|\bea\b/.test(c.s)) {
    const ts = temperatures(c);
    const ea = ofDim(c, 'molarenergy')[0]?.v ?? named(c, 'ea|activation energy', 'molarenergy');
    if (ts.length < 2) return need(c, C, 'Arrhenius comparisons need two temperatures');
    const [T1, T2] = [ts[0]!.k, ts[1]!.k];
    const inv = 1 / T1 - 1 / T2;
    if (ea !== null && !/find (?:the )?activation|what is the activation|calculate (?:the )?activation/.test(c.s)) {
      const ratio = Math.exp((ea / R) * inv);
      return res(c, { kind: C, expression: `Rate constant ratio k₂/k₁ from ${show(T1)} K to ${show(T2)} K`, value: ratio, formula: 'ln(k₂/k₁) = (Ea/R)(1/T₁ − 1/T₂)', lines: [['Ea', withUnit(ea / 1000, 'kJ/mol')]] });
    }
    const ks = [...c.s.matchAll(new RegExp(String.raw`k\d?\s*(?:=|is)?\s*(${NUM})`, 'g'))].map((m) => num(m[1]!));
    const ratio = /doubl/.test(c.s) ? 2 : /tripl/.test(c.s) ? 3 : named(c, 'ratio|factor') ?? (ks.length >= 2 ? ks[1]! / ks[0]! : null);
    if (ratio === null) return need(c, C, 'Activation energy needs the rate ratio (e.g. "rate doubles") or both rate constants');
    const Ea = (R * Math.log(ratio)) / inv;
    return res(c, { kind: C, expression: 'Activation energy (two-point Arrhenius)', value: Ea / 1000, unit: 'kJ/mol', unitWords: 'kilojoules per mole', formula: 'Ea = R ln(k₂/k₁) / (1/T₁ − 1/T₂)', lines: [['Rate ratio', show(ratio)], ['T₁, T₂', `${show(T1)} K, ${show(T2)} K`]] });
  }
  const rl = /rate\s*=\s*k\s*((?:\[[a-z0-9]+\](?:\^?\d+(?:\.\d+)?)?\s*)+)/i.exec(c.t);
  if (rl) {
    const k = named(c, 'k');
    if (k === null) return need(c, C, 'What is k?');
    let rate = k;
    const parts: string[] = [];
    for (const m of rl[1]!.matchAll(/\[([A-Za-z0-9]+)\](?:\^?(\d+(?:\.\d+)?))?/g)) {
      const order = m[2] ? num(m[2]) : 1;
      const v = new RegExp(String.raw`\[${m[1]}\]\s*(?:=|is|:)\s*(${NUM})`).exec(c.t.slice(rl.index + rl[0].length)) ?? new RegExp(String.raw`(?<!rate\s*=\s*k[^,]*)\[${m[1]}\]\s*(?:=|is|:)?\s*(${NUM})`).exec(c.t);
      if (!v) return need(c, C, `What is [${m[1]}]?`);
      rate *= num(v[1]!) ** order;
      parts.push(`[${m[1]}]${order === 1 ? '' : '^' + order} = ${v[1]}`);
    }
    return res(c, { kind: C, expression: `Rate law: ${rl[0].trim()}`, value: rate, unit: 'M/s', formula: rl[0].trim(), lines: [['Concentrations', parts.join(', ')], ['Overall order', show([...rl[1]!.matchAll(/\](?:\^?(\d+(?:\.\d+)?))?/g)].reduce((s, m) => s + (m[1] ? num(m[1]) : 1), 0))]] });
  }
  const order = /zero.?order|0th order/.test(c.s) ? 0 : /second.?order|2nd order/.test(c.s) ? 2 : /first.?order|1st order/.test(c.s) ? 1 : null;
  if (order === null || !/half.?life|rate constant|\bk\b|remain|after|concentration|left/.test(c.s)) return null;
  const k = named(c, 'k|rate constant');
  const A0 = named(c, '\\[a\\]0|\\[a\\]₀|\\[a\\]_0|a0|initial concentration|\\[a\\]|initial') ?? ofDim(c, 'conc')[0]?.v ?? null;
  const tq = ofDim(c, 'time');
  const hlq = lab(c, 'time', /half.?life|t½/);
  if (k === null && hlq && order === 1) {
    const kk = Math.LN2 / hlq.v;
    return res(c, { kind: C, expression: 'First-order rate constant from half-life', value: kk, unit: 's⁻¹', formula: 'k = ln 2 / t½' });
  }
  if (k === null) return need(c, C, 'What is the rate constant k?');
  const t = tq.find((x) => x !== hlq);
  if (t && /remain|after|left|concentration/.test(c.s)) {
    if (order === 1) {
      const f = Math.exp(-k * t.v);
      if (A0 !== null) return res(c, { kind: C, expression: `First-order: [A] after ${t.raw}`, value: A0 * f, unit: 'M', formula: '[A] = [A]₀e^(−kt)', lines: [['Fraction remaining', show(f)]] });
      return res(c, { kind: C, expression: `First-order: fraction remaining after ${t.raw}`, value: f, formula: '[A]/[A]₀ = e^(−kt)' });
    }
    if (A0 === null) return need(c, C, 'What is the initial concentration [A]₀?');
    if (order === 2) return res(c, { kind: C, expression: `Second-order: [A] after ${t.raw}`, value: 1 / (1 / A0 + k * t.v), unit: 'M', formula: '1/[A] = 1/[A]₀ + kt' });
    return res(c, { kind: C, expression: `Zero-order: [A] after ${t.raw}`, value: Math.max(0, A0 - k * t.v), unit: 'M', formula: '[A] = [A]₀ − kt' });
  }
  if (order === 1) return res(c, { kind: C, expression: 'First-order half-life', value: Math.LN2 / k, unit: 's', unitWords: 'seconds', formula: 't½ = ln 2 / k', notes: ['Independent of concentration; time unit follows k (s⁻¹ assumed)'] });
  if (A0 === null) return need(c, C, `A ${order === 2 ? 'second' : 'zero'}-order half-life depends on [A]₀: what is it?`);
  if (order === 2) return res(c, { kind: C, expression: 'Second-order half-life', value: 1 / (k * A0), unit: 's', unitWords: 'seconds', formula: 't½ = 1/(k[A]₀)' });
  return res(c, { kind: C, expression: 'Zero-order half-life', value: A0 / (2 * k), unit: 's', unitWords: 'seconds', formula: 't½ = [A]₀/(2k)' });
};

// ─────────────── thermochemistry ───────────────
// Standard enthalpies of formation, kJ/mol, 298.15 K (NIST Chemistry WebBook / CRC Handbook).
const DHF: Record<string, number> = {
  CH4: -74.87, C2H6: -84.0, C3H8: -104.7, C4H10: -125.6, C8H18: -250.1, C2H4: 52.4, C2H2: 227.4, C6H6: 49.0, CH3OH: -239.2, C2H5OH: -277.6, C6H12O6: -1273.3, C12H22O11: -2226.1,
  CO2: -393.51, CO: -110.53, H2O: -285.83, 'H2O(l)': -285.83, 'H2O(g)': -241.83, NH3: -45.94, NO: 91.29, NO2: 33.1, N2O4: 9.08, SO2: -296.81, SO3: -395.77, H2S: -20.6, HCl: -92.31, HF: -273.3,
  NaCl: -411.12, CaCO3: -1207.6, CaO: -634.92, 'Ca(OH)2': -985.2, Fe2O3: -824.2, Al2O3: -1675.7, MgO: -601.6, H2O2: -187.78, O3: 142.7, NaOH: -425.8, H2SO4: -814.0, HNO3: -174.1,
  O2: 0, H2: 0, N2: 0, C: 0, Fe: 0, Al: 0, Na: 0, Cl2: 0, Mg: 0, Ca: 0, S: 0,
};
const E0: [RegExp, number, string, number][] = [
  [/lithium|\bli\b/, -3.04, 'Li⁺/Li', 1], [/potassium|\bk\b/, -2.93, 'K⁺/K', 1], [/calcium|\bca\b/, -2.87, 'Ca²⁺/Ca', 2], [/sodium|\bna\b/, -2.71, 'Na⁺/Na', 1], [/magnesium|\bmg\b/, -2.37, 'Mg²⁺/Mg', 2],
  [/aluminium|aluminum|\bal\b/, -1.66, 'Al³⁺/Al', 3], [/zinc|\bzn\b/, -0.76, 'Zn²⁺/Zn', 2], [/chromium|\bcr\b/, -0.74, 'Cr³⁺/Cr', 3], [/iron|\bfe\b/, -0.44, 'Fe²⁺/Fe', 2], [/cadmium|\bcd\b/, -0.4, 'Cd²⁺/Cd', 2],
  [/nickel|\bni\b/, -0.25, 'Ni²⁺/Ni', 2], [/\btin\b|\bsn\b/, -0.14, 'Sn²⁺/Sn', 2], [/lead|\bpb\b/, -0.13, 'Pb²⁺/Pb', 2], [/hydrogen|\bshe\b/, 0, 'H⁺/H₂', 2], [/copper|\bcu\b/, 0.34, 'Cu²⁺/Cu', 2],
  [/silver|\bag\b/, 0.8, 'Ag⁺/Ag', 1], [/mercury|\bhg\b/, 0.85, 'Hg²⁺/Hg', 2], [/bromine/, 1.07, 'Br₂/Br⁻', 2], [/chlorine/, 1.36, 'Cl₂/Cl⁻', 2], [/gold|\bau\b/, 1.5, 'Au³⁺/Au', 3], [/fluorine/, 2.87, 'F₂/F⁻', 2],
];
const thermochem: Handler = (c) => {
  if (/Δg|delta g|gibbs|free energy|spontan/.test(c.s)) {
    const T = temperatures(c)[0];
    const Kq = named(c, 'k|keq|kc|kp|equilibrium constant');
    const E = ofDim(c, 'voltage')[0];
    if (E) {
      const n = named(c, 'n|electrons') ?? null;
      if (n === null) return need(c, C, 'How many electrons are transferred (n)?');
      const G = -n * K.F * E.v;
      return res(c, { kind: C, expression: 'ΔG° from cell potential', value: G / 1000, unit: 'kJ/mol', formula: 'ΔG° = −nFE°', lines: [['Spontaneous?', G < 0 ? 'yes' : 'no']] });
    }
    const dh = /(?:Δh|delta h|enthalpy)\s*(?:=|of|is)?\s*([-+]?\d+(?:\.\d+)?)\s*(kj|j)?/.exec(c.s);
    const ds = /(?:Δs|delta s|entropy)\s*(?:=|of|is)?\s*([-+]?\d+(?:\.\d+)?)\s*(kj|j)?/.exec(c.s);
    if (dh && ds) {
      if (!T) return need(c, C, 'At what temperature?');
      const H = num(dh[1]!) * (dh[2] === 'j' ? 1e-3 : 1);
      const S = num(ds[1]!) * (ds[2] === 'kj' ? 1 : 1e-3);
      const G = H - T.k * S;
      const lines: [string, string][] = [['ΔH', withUnit(H, 'kJ/mol')], ['ΔS', withUnit(S * 1000, 'J/(mol·K)')], ['T', withUnit(T.k, 'K')], ['Spontaneous?', G < 0 ? 'yes (ΔG < 0)' : 'no (ΔG > 0)']];
      if (S !== 0 && H / S > 0) lines.push(['Crossover temperature ΔH/ΔS', withUnit(H / S, 'K')]);
      return res(c, { kind: C, expression: 'Gibbs free energy', value: G, unit: 'kJ/mol', unitWords: 'kilojoules per mole', formula: 'ΔG = ΔH − TΔS', lines, notes: ['ΔS assumed in J/(mol·K) unless written in kJ'] });
    }
    if (Kq !== null && T) {
      const G = -R * T.k * Math.log(Kq);
      return res(c, { kind: C, expression: 'ΔG° from the equilibrium constant', value: G / 1000, unit: 'kJ/mol', formula: 'ΔG° = −RT ln K' });
    }
    const g = ofDim(c, 'molarenergy')[0] ?? (/(?:Δg|delta g)\s*(?:=|of|is)?\s*([-+]?\d+(?:\.\d+)?)\s*kj/.exec(c.s) ? { v: num(/(?:Δg|delta g)\s*(?:=|of|is)?\s*([-+]?\d+(?:\.\d+)?)/.exec(c.s)![1]!) * 1000 } : null);
    if (g && T && /\bk\b|equilibrium constant/.test(c.s)) return res(c, { kind: C, expression: 'Equilibrium constant from ΔG°', value: Math.exp(-g.v / (R * T.k)), formula: 'K = e^(−ΔG°/RT)' });
    return need(c, C, 'ΔG needs ΔH, ΔS and T (or K and T, or E° and n)');
  }
  if (/enthalpy|Δh|delta h|heat of (?:reaction|combustion)|hess/.test(c.s) && /->|→|=>/.test(c.t)) {
    const sps = reaction(c.t.replace(/H2O\(g\)/g, 'H2Og').replace(/\((?:s|l|aq)\)/g, ''));
    const raw = reaction(c.t.replace(/\((?:s|l|g|aq)\)/g, ''));
    const use = raw ?? sps;
    if (!use) return null;
    const gasWater = /H2O\(g\)|steam|water vapou?r|gaseous water/.test(c.t);
    let H = 0;
    const rows: string[][] = [];
    for (const s of use) {
      const key = s.formula === 'H2O' && gasWater ? 'H2O(g)' : s.formula;
      const h = DHF[key];
      if (h === undefined) return need(c, C, `I don't have ΔHf° for ${s.formula}; give it, or use Hess's law with your own values`);
      H += (s.side === 'R' ? 1 : -1) * s.coef * h;
      rows.push([`${s.coef === 1 ? '' : s.coef}${key}`, s.side === 'L' ? 'reactant' : 'product', show(h, 5)]);
    }
    return res(c, { kind: C, expression: `Standard enthalpy of reaction for ${eqText(use)}`, value: H, unit: 'kJ', unitWords: 'kilojoules', formula: 'ΔH°rxn = ΣνΔHf°(products) − ΣνΔHf°(reactants)', table: { columns: ['Species', 'Role', 'ΔHf° (kJ/mol)'], rows }, notes: [`Water taken as ${gasWater ? 'gas' : 'liquid'}`, 'ΔHf° at 298 K from NIST/CRC tables', H < 0 ? 'Exothermic' : 'Endothermic'] });
  }
  if (/calorimet|coffee.?cup|bomb/.test(c.s) || (/q\s*=\s*mc|heat absorbed|heat released/.test(c.s) && /\bg\b|grams?/.test(c.s))) {
    const m = ofDim(c, 'mass')[0];
    const ts = temperatures(c);
    const dT = (/(?:Δt|delta t|temperature (?:change|rise|increase))\s*(?:of|=|is|by)?\s*(-?\d+(?:\.\d+)?)/.exec(c.s) ? num(/(?:Δt|delta t|temperature (?:change|rise|increase))\s*(?:of|=|is|by)?\s*(-?\d+(?:\.\d+)?)/.exec(c.s)![1]!) : null) ?? (ts.length >= 2 ? ts[1]!.k - ts[0]!.k : ts.find((t) => t.delta) ? ts.find((t) => t.delta)!.k - 273.15 : null);
    if (!m || dT === null) return need(c, C, 'Calorimetry needs the mass of water/solution and the temperature change');
    const cs = named(c, 'c|specific heat') ?? 4.184;
    const q = m.v * 1000 * cs * dT;
    const mol = ofDim(c, 'amount')[0];
    const lines: [string, string][] = [['Heat absorbed by the solution', withUnit(q, 'J')]];
    if (mol) lines.push(['ΔH per mole of reaction', withUnit(-q / mol.v / 1000, 'kJ/mol')]);
    return res(c, { kind: C, expression: 'Calorimetry q = mcΔT', value: q, unit: 'J', unitWords: 'joules', formula: 'q = mcΔT', lines, notes: [`c = ${show(cs)} J/(g·°C)${cs === 4.184 ? ' (water)' : ''}`, 'Heat lost by the reaction = −q of the solution'] });
  }
  return null;
};

// ─────────────── electrochemistry ───────────────
const electrochem: Handler = (c) => {
  if (/nernst/.test(c.s) || (/cell potential|e\s*cell|ecell/.test(c.s) && /\bq\b|concentration|reaction quotient/.test(c.s))) {
    const E0v = named(c, 'e°|e0|e₀|eo|e naught|standard (?:cell )?potential', 'voltage') ?? ofDim(c, 'voltage')[0]?.v ?? null;
    const n = named(c, 'n|electrons');
    const Q = named(c, 'q|reaction quotient');
    const T = temperatures(c)[0]?.k ?? 298.15;
    if (E0v === null || n === null || Q === null) return need(c, C, 'The Nernst equation needs E°, n and Q');
    const E = E0v - ((R * T) / (n * K.F)) * Math.log(Q);
    return res(c, { kind: C, expression: 'Cell potential (Nernst equation)', value: E, unit: 'V', unitWords: 'volts', sig: 4, formula: 'E = E° − (RT/nF) ln Q', lines: [['RT/F', withUnit((R * T) / K.F, 'V')], ['T', withUnit(T, 'K')]], notes: temperatures(c).length ? [] : ['T = 298.15 K assumed'] });
  }
  if (/cell potential|standard potential|e°\s*cell|galvanic|voltaic|battery voltage|emf of/.test(c.s)) {
    const found = E0.map((e) => ({ e, i: c.s.search(e[0]) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
    if (found.length < 2) return need(c, C, 'Which two half-cells (e.g. "zinc and copper")?');
    const [a, b] = [found[0]!.e, found[1]!.e];
    const [cat, an] = a[1] > b[1] ? [a, b] : [b, a];
    const E = cat[1] - an[1];
    const n = (cat[3] * an[3]) / gcd(cat[3], an[3]);
    return res(c, { kind: C, expression: `Standard cell potential: ${an[2]} anode, ${cat[2]} cathode`, value: E, unit: 'V', unitWords: 'volts', formula: 'E°cell = E°cathode − E°anode', lines: [['Cathode (reduction)', `${cat[2]}  ${cat[1] >= 0 ? '+' : ''}${cat[1]} V`], ['Anode (oxidation)', `${an[2]}  ${an[1] >= 0 ? '+' : ''}${an[1]} V`], ['ΔG° (n = ' + n + ')', withUnit((-n * K.F * E) / 1000, 'kJ/mol')]], notes: ['Standard reduction potentials at 25 °C (CRC Handbook)'] });
  }
  if (/electrolysis|faraday|deposit|electroplat|plated/.test(c.s)) {
    const I = ofDim(c, 'current')[0];
    const t = ofDim(c, 'time')[0];
    const Q = ofDim(c, 'charge')[0];
    const charge = Q?.v ?? (I && t ? I.v * t.v : null);
    if (charge === null) return need(c, C, 'Electrolysis needs the current and time (or the charge)');
    const metal = E0.find(([re]) => re.test(c.s) && !/hydrogen/.test(re.source));
    const n = named(c, 'n|electrons') ?? metal?.[3] ?? null;
    const el = metal ? ELEMENTS.find((e) => metal[2].startsWith(e.symbol)) : undefined;
    const mol = n ? charge / (n * K.F) : null;
    if (!n || mol === null) return need(c, C, 'Which metal (or how many electrons per ion, n)?');
    const lines: [string, string][] = [['Charge', withUnit(charge, 'C')], ['Moles of electrons', withUnit(charge / K.F, 'mol')], ['n', String(n)]];
    if (!el) return res(c, { kind: C, expression: 'Moles deposited by electrolysis', value: mol, unit: 'mol', formula: 'n = Q/(zF)', lines });
    const M = el.weight.toNumber();
    return res(c, { kind: C, expression: `Mass of ${el.name.toLowerCase()} deposited`, value: mol * M, unit: 'g', unitWords: 'grams', formula: 'm = ItM/(zF)', lines: [...lines, ['Molar mass', `${show(M, 5)} g/mol`]], notes: ['100% current efficiency assumed'] });
  }
  return null;
};
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

// ─────────────── gases ───────────────
function pressures(c: Ctx) {
  return ofDim(c, 'pressure');
}
const gases: Handler = (c) => {
  if (/partial pressure|dalton|mole fraction/.test(c.s)) {
    const ps = pressures(c);
    const x = named(c, 'mole fraction|χ|x');
    if (x !== null && ps.length) {
      const p = ps[0]!;
      return res(c, { kind: C, expression: 'Partial pressure (Dalton)', value: x * num(p.raw.replace(/[^\d.e+-]/g, '')), unit: p.unit, formula: 'Pᵢ = χᵢ P_total' });
    }
    if (ps.length >= 2 && /total/.test(c.s)) {
      const unit = ps[0]!.unit;
      const sc = ps[0]!.v / num(ps[0]!.raw.replace(/[^\d.e+-]/g, ''));
      return res(c, { kind: C, expression: 'Total pressure (Dalton)', value: ps.reduce((s, p) => s + p.v, 0) / sc, unit, formula: 'P_total = Σ Pᵢ' });
    }
    const mols = ofDim(c, 'amount');
    if (mols.length >= 2 && ps.length) {
      const tot = mols.reduce((s, m) => s + m.v, 0);
      const p = ps[0]!;
      const pv = num(p.raw.replace(/[^\d.e+-]/g, ''));
      return res(c, { kind: C, expression: 'Partial pressures from moles', display: mols.map((m, i) => `P${i + 1} = ${show((m.v / tot) * pv)} ${p.unit}`).join(', '), value: (mols[0]!.v / tot) * pv, formula: 'Pᵢ = (nᵢ/n_total) P_total', table: { columns: ['Gas', 'Moles', 'Mole fraction', 'Partial pressure'], rows: mols.map((m, i) => [`${i + 1}`, show(m.v), show(m.v / tot), `${show((m.v / tot) * pv)} ${p.unit}`]) } });
    }
    return need(c, C, 'Partial pressure needs the mole fraction and total pressure (or each gas)');
  }
  if (/graham|effusion|diffusion rate/.test(c.s)) {
    const fs = [...c.t.matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((m) => resolveSubstance(m[1]!)).filter((x): x is NonNullable<typeof x> => !!x && x.formula !== 'I');
    if (fs.length < 2) return need(c, C, "Graham's law needs two gases");
    const [a, b] = [fs[0]!, fs[1]!];
    return res(c, { kind: C, expression: `Effusion rate ratio ${a.formula} : ${b.formula}`, value: Math.sqrt(b.molarMass.toNumber() / a.molarMass.toNumber()), formula: 'r₁/r₂ = √(M₂/M₁)', lines: [[a.formula, `${show(a.molarMass.toNumber(), 5)} g/mol`], [b.formula, `${show(b.molarMass.toNumber(), 5)} g/mol`]] });
  }
  if (/gas density|density of (?:a )?(?:gas|[a-z]*\s*)?.*\b(?:at stp|stp|atm|kpa)\b/.test(c.s) && /density/.test(c.s)) {
    const m = /density of ([A-Za-z0-9() ]+?)(?: gas)?(?: at| \d|$)/i.exec(c.t);
    const sub = m ? resolveSubstance(m[1]!) : null;
    if (!sub) return null;
    const stp = /stp/.test(c.s);
    const P = pressures(c)[0]?.v ?? (stp ? 100000 : K.atm);
    const T = temperatures(c)[0]?.k ?? 273.15;
    const d = (P * sub.molarMass.toNumber()) / (R * T) / 1000;
    return res(c, { kind: C, expression: `Density of ${sub.formula} gas`, value: d, unit: 'g/L', unitWords: 'grams per litre', formula: 'ρ = PM/(RT)', lines: [['P', withUnit(P / 1000, 'kPa')], ['T', withUnit(T, 'K')]], notes: stp ? ['STP = 273.15 K and 100 kPa (IUPAC); at 1 atm multiply by 1.01325'] : ['Ideal gas'] });
  }
  if (/boyle|charles|gay.?lussac|combined gas|avogadro'?s law|(?:\bto\b|then|changes? to|becomes|compressed|expanded|heated|cooled).*(?:volume|pressure|temperature)|(?:new|final) (?:volume|pressure|temperature)/.test(c.s)) {
    const vs = ofDim(c, 'volume');
    const ps = pressures(c);
    const ts = temperatures(c);
    const known = { V: vs.length, P: ps.length, T: ts.length };
    const target = /(?:new|final|what(?: is| will be)? the) volume|volume\??$|find v|v2/.test(c.s) ? 'V' : /(?:new|final|what(?: is| will be)? the) pressure|pressure\??$|find p|p2/.test(c.s) ? 'P' : /(?:new|final|what(?: is| will be)? the) temperature|temperature\??$|find t|t2/.test(c.s) ? 'T' : known.V === 1 ? 'V' : known.P === 1 ? 'P' : known.T === 1 ? 'T' : null;
    if (!target) return null;
    const pair = <T,>(xs: T[], need2: boolean): [T, T] | null => (xs.length >= 2 ? [xs[0]!, xs[1]!] : need2 ? null : xs.length === 0 ? null : null);
    const Vp = pair(vs, target !== 'V');
    const Pp = pair(ps, target !== 'P');
    const Tp = pair(ts, target !== 'T');
    const V1 = vs[0];
    const P1 = ps[0];
    const T1 = ts[0];
    const r = (num_: number, den: number) => num_ / den;
    const notes = ['Fixed amount of ideal gas; temperatures converted to kelvin'];
    const fac = (xs: [number, number] | null) => (xs ? xs[0] / xs[1] : 1);
    const used: string[] = [];
    if (target === 'V') {
      if (!V1) return need(c, C, 'What is the starting volume?');
      const pf = Pp ? fac([Pp[0].v, Pp[1].v]) : 1;
      const tf = Tp ? 1 / fac([Tp[0].k, Tp[1].k]) : 1;
      if (Pp) used.push('P₁/P₂');
      if (Tp) used.push('T₂/T₁');
      if (!used.length) return need(c, C, 'What changes: the pressure, the temperature, or both?');
      const unit = V1.unit;
      const sc = V1.v / num(V1.raw.replace(/[^\d.e+-]/g, ''));
      return res(c, { kind: C, expression: `${Pp && Tp ? 'Combined gas law' : Pp ? "Boyle's law" : "Charles's law"}: new volume`, value: r(V1.v * pf * tf, sc), unit, formula: 'V₂ = V₁ · (P₁/P₂) · (T₂/T₁)', notes });
    }
    if (target === 'P') {
      if (!P1) return need(c, C, 'What is the starting pressure?');
      const vf = Vp ? fac([Vp[0].v, Vp[1].v]) : 1;
      const tf = Tp ? 1 / fac([Tp[0].k, Tp[1].k]) : 1;
      if (!Vp && !Tp) return need(c, C, 'What changes: the volume, the temperature, or both?');
      const sc = P1.v / num(P1.raw.replace(/[^\d.e+-]/g, ''));
      return res(c, { kind: C, expression: `${Vp && Tp ? 'Combined gas law' : Vp ? "Boyle's law" : "Gay-Lussac's law"}: new pressure`, value: (P1.v * vf * tf) / sc, unit: P1.unit, formula: 'P₂ = P₁ · (V₁/V₂) · (T₂/T₁)', notes });
    }
    if (!T1) return need(c, C, 'What is the starting temperature?');
    const pf = Pp ? 1 / fac([Pp[0].v, Pp[1].v]) : 1;
    const vf = Vp ? 1 / fac([Vp[0].v, Vp[1].v]) : 1;
    if (!Pp && !Vp) return need(c, C, 'What changes: the volume, the pressure, or both?');
    const T2 = T1.k * pf * vf;
    return res(c, { kind: C, expression: 'Gas law: new temperature', value: T2, unit: 'K', unitWords: 'kelvin', formula: 'T₂ = T₁ · (P₂/P₁) · (V₂/V₁)', lines: [['In °C', show(T2 - 273.15) + ' °C']], notes });
  }
  return null;
};

// ─────────────── solutions ───────────────
function soluteSolvent(c: Ctx) {
  const masses = ofDim(c, 'mass');
  const m = /(?:of\s+)?([A-Z][A-Za-z0-9()]*|[a-z]+(?: [a-z]+)?)\s+(?:in|dissolved in)\s+/i.exec(c.t.slice(masses[0] ? masses[0].end : 0));
  return { masses, sub: m ? resolveSubstance(m[1]!) : null };
}
const solutions: Handler = (c) => {
  if (/molality|molal\b/.test(c.s) || new RegExp(String.raw`${NUM}\s*m\b\s*(?:aqueous|solution|nacl|glucose)`).test(c.t) && /freezing|boiling/.test(c.s)) {
    if (!/freezing|boiling/.test(c.s)) {
      const { masses, sub } = soluteSolvent(c);
      const mol = ofDim(c, 'amount')[0]?.v ?? (masses[0] && sub ? (masses[0].v * 1000) / sub.molarMass.toNumber() : null);
      const solvent = masses.length >= 2 ? masses[1]!.v : null;
      if (mol === null || solvent === null) return need(c, C, 'Molality needs the solute (moles, or mass and formula) and the solvent mass');
      return res(c, { kind: C, expression: 'Molality', value: mol / solvent, unit: 'mol/kg', unitWords: 'moles per kilogram', formula: 'b = n_solute / m_solvent (kg)', lines: [['Moles of solute', withUnit(mol, 'mol')], ...(sub ? [['Molar mass', `${show(sub.molarMass.toNumber(), 5)} g/mol`] as [string, string]] : [])] });
    }
  }
  if (/freezing point|boiling point/.test(c.s) && /depress|elevat|lower|raise|new|of a|solution|\bm\b|molal/.test(c.s)) {
    const fr = /freezing/.test(c.s);
    const b = named(c, 'molality|b|m') ?? (new RegExp(String.raw`(${NUM})\s*(?:m|molal|mol\/kg)\b`).exec(c.s) ? num(new RegExp(String.raw`(${NUM})\s*(?:m|molal|mol\/kg)\b`).exec(c.s)![1]!) : null);
    if (b === null) return need(c, C, 'What is the molality (mol/kg)?');
    let i = named(c, 'i|van.?t hoff(?: factor)?');
    const notes: string[] = [];
    if (i === null) {
      i = /nacl|kcl|sodium chloride|potassium chloride/.test(c.s) ? 2 : /cacl2|mgcl2|calcium chloride|na2so4/.test(c.s) ? 3 : 1;
      notes.push(`van 't Hoff factor i = ${i} (ideal${i > 1 ? ' complete dissociation' : ', non-electrolyte'})`);
    }
    const Kx = named(c, 'kf|kb|k_f|k_b') ?? (fr ? 1.86 : 0.512);
    notes.push(`${fr ? 'Kf' : 'Kb'} = ${Kx} °C·kg/mol (water unless given)`);
    const d = i * Kx * b;
    return res(c, { kind: C, expression: fr ? 'Freezing-point depression' : 'Boiling-point elevation', value: d, unit: '°C', formula: fr ? 'ΔTf = i·Kf·b' : 'ΔTb = i·Kb·b', lines: [[fr ? 'New freezing point (water)' : 'New boiling point (water)', `${show(fr ? -d : 100 + d)} °C`]], notes });
  }
  if (/osmotic pressure/.test(c.s)) {
    const M = ofDim(c, 'conc')[0]?.v;
    const T = temperatures(c)[0]?.k ?? 298.15;
    const i = named(c, 'i|van.?t hoff(?: factor)?') ?? 1;
    if (M === undefined) return need(c, C, 'What is the molarity?');
    const p = i * M * 0.082057366 * T;
    return res(c, { kind: C, expression: 'Osmotic pressure', value: p, unit: 'atm', unitWords: 'atmospheres', formula: 'Π = iMRT', lines: [['In kPa', show(p * 101.325) + ' kPa']], notes: temperatures(c).length ? [] : ['T = 298.15 K assumed'] });
  }
  if (/\bppm\b|\bppb\b|parts per (?:million|billion)/.test(c.s)) {
    const masses = ofDim(c, 'mass');
    const vol = ofDim(c, 'volume')[0];
    const ppb = /ppb|billion/.test(c.s);
    const scale = ppb ? 1e9 : 1e6;
    if (masses.length && vol) {
      const v = (masses[0]!.v / (vol.v * 1000)) * scale; // kg solute per kg water (1 kg/L)
      return res(c, { kind: C, expression: `Concentration in ${ppb ? 'ppb' : 'ppm'}`, value: v, unit: ppb ? 'ppb' : 'ppm', formula: ppb ? 'ppb = µg/L (dilute aqueous)' : 'ppm = mg/L (dilute aqueous)', notes: ['Dilute aqueous solution, density 1 kg/L'] });
    }
    if (masses.length >= 2) return res(c, { kind: C, expression: `Concentration in ${ppb ? 'ppb' : 'ppm'} by mass`, value: (masses[0]!.v / masses[1]!.v) * scale, unit: ppb ? 'ppb' : 'ppm', formula: `${ppb ? 'ppb' : 'ppm'} = m_solute/m_solution × ${ppb ? '10⁹' : '10⁶'}` });
    return need(c, C, 'ppm needs the solute mass and the solution volume (or mass)');
  }
  return null;
};

// ─────────────── isotopes ───────────────
const isotopes: Handler = (c) => {
  if (!/average atomic mass|atomic weight from|isotop|relative atomic mass/.test(c.s)) return null;
  const pairs: [number, number][] = [];
  const re = new RegExp(String.raw`(${NUM})\s*(?:u|amu|da)?\s*(?:\(|at|with|:|,)?\s*(${NUM})\s*%|(${NUM})\s*%\s*(?:abundance\s*)?(?:of\s+|at\s+|with mass\s+|,\s*|:\s*)?(?:mass\s*)?(${NUM})\s*(?:u|amu|da)?`, 'g');
  for (const m of c.s.matchAll(re)) {
    if (m[1]) pairs.push([num(m[1]), num(m[2]!) / 100]);
    else pairs.push([num(m[4]!), num(m[3]!) / 100]);
  }
  if (pairs.length < 2) return need(c, C, 'Give each isotope mass with its abundance, e.g. "34.969 u 75.78%, 36.966 u 24.22%"');
  const tot = pairs.reduce((s, p) => s + p[1], 0);
  const avg = pairs.reduce((s, p) => s + p[0] * p[1], 0) / tot;
  return res(c, { kind: C, expression: 'Average atomic mass from isotopes', value: avg, sig: 5, unit: 'u', formula: 'Σ (mass × abundance)', table: { columns: ['Mass (u)', 'Abundance'], rows: pairs.map((p) => [show(p[0], 6), pct(p[1])]) }, notes: Math.abs(tot - 1) > 0.001 ? [`Abundances sum to ${pct(tot)}; normalised`] : [] });
};

export const chemistry: Handler[] = [isotopes, empirical, pctComp, percentYield, equilibrium, thermochem, electrochem, stoich, acidBase, kinetics, gases, solutions];
export { SNUM, lab };
