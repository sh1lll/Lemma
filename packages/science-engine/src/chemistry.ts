import { D, formatNumber, type Dec } from '@lemma/math-core';
import { CONST } from './constants';
import { BY_SYMBOL, ELEMENTS, findElement, type Element } from './elements';
import { resolveSubstance, type Substance } from './formula';
import { disp, fail, need, NUM, num, ok, prettyFormula, prim, type Ctx } from './util';

const ATOMIC_WEIGHT_NOTE = 'Standard atomic weights (IUPAC abridged, conventional values)';

function radioactiveNote(s: Substance): string[] {
  const r = [...s.counts.keys()].map((k) => BY_SYMBOL.get(k)!).filter((e) => e.massNumber);
  return r.length ? [`${r.map((e) => e.symbol).join(', ')} ha${r.length > 1 ? 've' : 's'} no stable isotope; the mass number of the longest-lived isotope is used`] : [];
}

const subName = (s: Substance) => (s.name ? `${s.name} (${prettyFormula(s.formula)})` : prettyFormula(s.formula));

// ---------- molar mass ----------
export function molarMassH(c: Ctx) {
  const pre = /^(?:what(?:'s| is)\s+|find\s+|calculate\s+)?(?:the\s+)?(?:molar mass|molecular weight|molecular mass|formula mass|formula weight|molar weight|mw)\s*(?:of|for)?\s*(.*)$/.exec(c.s);
  const post = pre ? null : /^(.+?)\s+(?:molar mass|molecular weight|molecular mass)$/.exec(c.s);
  if (!pre && !post) return null;
  const text = pre ? c.t.slice(c.s.length - pre[1]!.length).trim() : c.t.slice(0, post![1]!.length).trim();
  if (!text) return need(c, 'chemistry', 'Molar mass of which substance? (e.g. “molar mass of Ca(OH)2”)');
  const sub = resolveSubstance(text);
  if (!sub) return fail(c, 'chemistry', `“${text}” isn't a formula or substance I know. Formulas are case-sensitive: Co is cobalt, CO is carbon monoxide`);
  const M = sub.molarMass;
  const rows = [...sub.counts].map(([el, n]) => {
    const e = BY_SYMBOL.get(el)!;
    const part = e.weight.mul(n.toString());
    return [`${el} (${e.name})`, n.toString(), e.weightText + (e.massNumber ? '*' : ''), part.toString(), `${part.div(M).mul(100).toFixed(2)}%`];
  });
  const f = formatNumber(M, { digits: 12 });
  return ok(c, {
    kind: 'chemistry',
    expression: `Molar mass · ${subName(sub)}`,
    primary: { display: f.display, plain: f.plain, spoken: `${f.spoken} grams per mole`, unit: 'g/mol' },
    value: M,
    lines: [
      { label: 'Formula', display: prettyFormula(sub.formula) },
      { label: 'Atoms per formula unit', display: sub.atoms.toString() },
      { label: 'Mass of one molecule', display: `${disp(M.div(CONST.NA))} g` },
    ],
    table: { caption: 'Composition by mass', columns: ['Element', 'Count', 'Atomic weight', 'g/mol', 'Mass %'], rows },
    notes: [ATOMIC_WEIGHT_NOTE, ...radioactiveNote(sub)],
  });
}

// ---------- grams ↔ moles ↔ particles ----------
type Amt = 'g' | 'mol' | 'particles' | 'atoms';
const AMT_UNITS: [RegExp, Amt, number][] = [
  [/^(?:kg|kilograms?|kilos?)$/, 'g', 1000],
  [/^(?:mg|milligrams?)$/, 'g', 0.001],
  [/^(?:µg|ug|micrograms?)$/, 'g', 1e-6],
  [/^(?:g|grams?|grammes?|gm|gms)$/, 'g', 1],
  [/^(?:mmol|millimoles?|millimols?)$/, 'mol', 0.001],
  [/^(?:mol|moles?|mols)$/, 'mol', 1],
  [/^(?:molecules?|particles?|formula units?|ions?|units?)$/, 'particles', 1],
  [/^atoms?$/, 'atoms', 1],
];
const AMT_SRC = String.raw`kilograms?|kilos?|kg|milligrams?|mg|µg|ug|micrograms?|grammes?|grams?|gms?|g|millimoles?|millimols?|mmol|moles?|mols?|molecules?|particles?|formula units?|ions?|atoms?`;
const TARGET_SRC = String.raw`moles?|mols?|mmol|millimoles?|grams?|g|mass|weight|kg|mg|molecules?|particles?|formula units?|ions?|atoms?`;

function amtUnit(u: string): [Amt, number] | null {
  const hit = AMT_UNITS.find(([re]) => re.test(u));
  return hit ? [hit[1], hit[2]] : null;
}

export function moles(c: Ctx) {
  const amtRe = new RegExp(`(?:^|\\s)(${NUM})\\s*(${AMT_SRC})\\b\\s*(?:of\\s+)?`, 'g');
  for (const m of c.s.matchAll(amtRe)) {
    const unit = amtUnit(m[2]!);
    if (!unit) continue;
    const from = m.index! + m[0].length;
    const stop = /\s+(?:to|into|in|as|is|are|contains?|equals?|has|have|weighs?|=)\s+|\s*\?|$/.exec(c.s.slice(from))!;
    const subText = c.t.slice(from, from + stop.index).trim();
    const before = c.s.slice(0, m.index!);
    const after = c.s.slice(from + stop.index);
    const tm = new RegExp(`\\b(${TARGET_SRC})\\b`).exec(after) ?? new RegExp(`\\b(${TARGET_SRC})\\b`).exec(before);
    if (!tm) continue;
    const word = tm[1]!;
    const target: [Amt, number] | null = /^(?:mass|weight)$/.test(word) ? ['g', 1] : amtUnit(word);
    if (!target) continue;
    if (!subText) return /mol|molecule|atom|particle/.test(word + m[2]) ? need(c, 'chemistry', `${m[1]} ${m[2]} of what substance?`) : null;
    const sub = resolveSubstance(subText);
    if (!sub) {
      // Only claim it when the question is unmistakably chemical.
      if (/mol|molecule|atom|particle/.test(word + m[2])) return fail(c, 'chemistry', `“${subText}” isn't a formula or substance I know`);
      return null;
    }
    return molesAnswer(c, sub, num(m[1]!).mul(unit[1]), unit[0], target, word);
  }
  return null;
}

function molesAnswer(c: Ctx, sub: Substance, amount: Dec, kind: Amt, target: [Amt, number], targetWord: string) {
  const M = sub.molarMass;
  const NA = CONST.NA;
  const perUnitAtoms = new D(sub.atoms.toString());
  let n: Dec;
  if (kind === 'g') n = amount.div(M);
  else if (kind === 'mol') n = amount;
  else if (kind === 'particles') n = amount.div(NA);
  else n = amount.div(NA).div(perUnitAtoms);
  if (target[0] === kind && target[1] === 1 && kind !== 'particles') return null;
  const grams = n.mul(M);
  const particles = n.mul(NA);
  const atoms = particles.mul(perUnitAtoms);
  const particleWord = sub.element && sub.atoms === 1n ? 'atoms' : /ion/.test(targetWord) ? 'ions' : /formula unit/.test(targetWord) ? 'formula units' : 'molecules';
  let value: Dec;
  let unit: string;
  let spokenUnit: string;
  let formula: string;
  switch (target[0]) {
    case 'g':
      value = grams.div(target[1]);
      unit = target[1] === 1000 ? 'kg' : target[1] === 0.001 ? 'mg' : 'g';
      spokenUnit = unit === 'kg' ? 'kilograms' : unit === 'mg' ? 'milligrams' : 'grams';
      formula = 'm = n × M';
      break;
    case 'mol':
      value = n.div(target[1]);
      unit = target[1] === 1 ? 'mol' : 'mmol';
      spokenUnit = target[1] === 1 ? 'moles' : 'millimoles';
      formula = kind === 'g' ? 'n = m / M' : 'n = N / N_A';
      break;
    case 'particles':
      value = particles;
      unit = particleWord;
      spokenUnit = particleWord;
      formula = 'N = n × N_A';
      break;
    default:
      value = atoms;
      unit = 'atoms';
      spokenUnit = 'atoms';
      formula = sub.atoms === 1n ? 'N = n × N_A' : `N = n × N_A × ${sub.atoms} atoms per molecule`;
  }
  const from = kind === 'g' ? `${disp(amount)} g` : kind === 'mol' ? `${disp(amount)} mol` : `${disp(amount)} ${kind === 'atoms' ? 'atoms' : particleWord}`;
  const notes = [ATOMIC_WEIGHT_NOTE, `N_A = 6.02214076 × 10²³ mol⁻¹ (exact)`, ...radioactiveNote(sub)];
  if (sub.name && !sub.element) notes.unshift(`“${sub.name}” read as ${prettyFormula(sub.formula)}`);
  if (sub.element && sub.name && ['oxygen', 'hydrogen', 'nitrogen', 'chlorine', 'fluorine', 'bromine', 'iodine'].includes(sub.name)) {
    notes.unshift(`Treated as single ${sub.formula} atoms; for the gas, write ${sub.formula}2`);
  }
  const lines = [
    { label: 'Formula', display: formula },
    { label: 'Molar mass', display: `${disp(M)} g/mol` },
    { label: 'Moles', display: `${disp(n)} mol` },
    { label: 'Mass', display: `${disp(grams)} g` },
    { label: sub.atoms === 1n ? 'Atoms' : particleWord[0]!.toUpperCase() + particleWord.slice(1), display: disp(particles) },
  ];
  if (sub.atoms > 1n) lines.push({ label: 'Atoms', display: disp(atoms) });
  return ok(c, {
    kind: 'chemistry',
    expression: `${from} of ${subName(sub)} → ${spokenUnit}`,
    primary: prim(value, unit, spokenUnit),
    value,
    lines,
    notes,
  });
}

// ---------- element lookup ----------
function elementAnswer(c: Ctx, e: Element, focus: 'number' | 'mass' | 'symbol' | 'name' | 'all') {
  const weight = `${e.weightText}${e.massNumber ? ' (mass number)' : ''}`;
  const notes: string[] = [];
  if (e.massNumber) notes.push(`${e.name} has no stable isotope and no standard atomic weight; ${e.weightText} is the mass number of its longest-lived isotope`);
  else notes.push(ATOMIC_WEIGHT_NOTE);
  if (e.symbol === 'Th' || e.symbol === 'Pa' || e.symbol === 'U') notes.push(`${e.name} is radioactive, but its natural isotopic composition gives it a standard atomic weight`);
  const lines = [
    { label: 'Name', display: e.name },
    { label: 'Symbol', display: e.symbol },
    { label: 'Atomic number', display: String(e.z) },
    { label: e.massNumber ? 'Mass number (longest-lived)' : 'Atomic weight', display: e.weightText },
    { label: 'Period', display: String(e.period) },
    { label: 'Group', display: e.group === null ? (e.z <= 71 ? 'lanthanide (f-block)' : 'actinide (f-block)') : String(e.group) },
    { label: 'Block', display: `${e.block}-block` },
  ];
  let primary;
  let value: Dec | undefined;
  switch (focus) {
    case 'number':
      primary = { display: String(e.z), plain: String(e.z), spoken: `atomic number ${e.z}` };
      value = new D(e.z);
      break;
    case 'mass':
      primary = { display: e.weightText, plain: e.weightText, spoken: `${e.weightText} ${e.massNumber ? '' : 'atomic mass units'}`.trim(), unit: e.massNumber ? undefined : 'u' };
      value = e.weight;
      break;
    case 'symbol':
      primary = { display: e.symbol, plain: e.symbol, spoken: [...e.symbol].join(' ') };
      break;
    default:
      primary = { display: `${e.name} (${e.symbol})`, plain: e.symbol, spoken: `${e.name}, element ${e.z}` };
      value = e.weight;
  }
  if (primary.unit === undefined) delete primary.unit;
  return ok(c, { kind: 'chemistry', expression: `${e.name} · element ${e.z}${focus === 'mass' ? ` · ${weight}` : ''}`, primary, value, lines, notes });
}

/** Symbols that are also everyday words; only taken as elements when asked ("what is He"). */
const COMMON_WORDS = new Set(['No', 'As', 'At', 'Be', 'He', 'In', 'Am', 'Pa', 'Po', 'Ga', 'Es']);

export function elementLookup(c: Ctx) {
  const PRE = String.raw`^(?:what(?:'s| is| are)\s+|whats\s+|tell me\s+|give me\s+|find\s+)?(?:the\s+)?`;
  const prop = new RegExp(`${PRE}(atomic number|proton number|number of protons|atomic mass|atomic weight|relative atomic mass|standard atomic weight|mass number|symbol|chemical symbol|element symbol|name|period|group)\\s+(?:of|for)\\s+(?:the element\\s+|element\\s+)?(.+)$`).exec(c.s);
  if (prop) {
    const start = c.s.length - prop[2]!.length;
    const e = findElement(c.t.slice(start)) ?? findElement(prop[2]!);
    if (!e) {
      if (/^\d+$/.test(prop[2]!)) {
        const byZ = ELEMENTS[Number(prop[2]) - 1];
        if (byZ) return elementAnswer(c, byZ, /symbol/.test(prop[1]!) ? 'symbol' : /name/.test(prop[1]!) ? 'name' : /mass|weight/.test(prop[1]!) ? 'mass' : 'all');
      }
      return fail(c, 'chemistry', `“${c.t.slice(start)}” isn't an element I know`);
    }
    const p = prop[1]!;
    return elementAnswer(c, e, /number|protons/.test(p) && !/mass number/.test(p) ? 'number' : /mass|weight/.test(p) ? 'mass' : /symbol/.test(p) ? 'symbol' : /name/.test(p) ? 'name' : 'all');
  }
  const byZ = new RegExp(`${PRE}(?:which |what )?element(?:\\s+(?:has|with|is))?(?:\\s+(?:atomic number|number|no\\.?|z\\s*=?))?\\s*(\\d{1,3})$`).exec(c.s);
  if (byZ) {
    const e = ELEMENTS[Number(byZ[1]) - 1];
    return e ? elementAnswer(c, e, 'all') : fail(c, 'chemistry', `There are 118 known elements; there's no element ${byZ[1]}`);
  }
  // "what is Fe", "what is iron", "iron", "Fe"
  const what = /^(?:what(?:'s| is)\s+|whats\s+|tell me about\s+|element\s+)(?:the element\s+)?(\S+)$/i.exec(c.t);
  const word = what ? what[1]! : c.t;
  const e = findElement(word);
  if (!e) return null;
  // A bare one-letter input is too likely to be a variable.
  if (!what && e.symbol === word && (word.length === 1 || COMMON_WORDS.has(word))) return null;
  return elementAnswer(c, e, 'all');
}
