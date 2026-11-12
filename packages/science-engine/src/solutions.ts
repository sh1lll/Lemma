import { D, type Dec } from '@lemma/math-core';
import { CONST } from './constants';
import { resolveSubstance, type Substance } from './formula';
import { disp, fail, need, NUM, num, ok, prettyFormula, prim, SNUM, type Ctx } from './util';

interface Found {
  v: Dec;
  index: number;
  end: number;
  raw: string;
}

function findAll(text: string, re: RegExp, factor: (unit: string) => Dec | null): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(re)) {
    const f = factor(m[2]!);
    if (!f) continue;
    out.push({ v: num(m[1]!).mul(f), index: m.index!, end: m.index! + m[0].length, raw: m[0].trim() });
  }
  return out;
}

// ---------- concentrations, volumes, amounts ----------
const CONC_SYM = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(M|mM|µM|uM|nM|mol\/L|mol\/l|mol L-1|mol l-1|mol\/dm3|mol\/dm³|mol dm-3|mmol\/L|mmol\/l)(?![A-Za-z])`, 'g');
const CONC_WORD = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(molar|millimolar|micromolar)\b`, 'gi');
const CONC_LOWER_M = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(m)(?![a-z0-9/²³^])`, 'g');
const CONC_F: Record<string, string> = { M: '1', mM: '1e-3', 'µM': '1e-6', uM: '1e-6', nM: '1e-9', molar: '1', millimolar: '1e-3', micromolar: '1e-6', m: '1' };

export function concentrations(c: Ctx, allowLowerM: boolean): Found[] {
  const f = (u: string) => new D(CONC_F[u] ?? CONC_F[u.toLowerCase()] ?? (/^mmol/.test(u) ? '1e-3' : '1'));
  const out = [...findAll(c.t, CONC_SYM, f), ...findAll(c.t, CONC_WORD, f)];
  if (allowLowerM) for (const x of findAll(c.s, CONC_LOWER_M, f)) if (!out.some((o) => o.index === x.index)) out.push(x);
  return out.sort((a, b) => a.index - b.index);
}

const VOL = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(ml|millilit(?:er|re)s?|µl|ul|microlit(?:er|re)s?|l|lit(?:er|re)s?|dm3|dm³|cm3|cm³|cc|m3|m³|cubic met(?:er|re)s?)(?![a-z0-9])`, 'g');
const VOL_F = (u: string): Dec | null =>
  /^(?:ml|millilit|cm|cc)/.test(u) ? new D('1e-3') : /^(?:µl|ul|microlit)/.test(u) ? new D('1e-6') : /^(?:m3|m³|cubic)/.test(u) ? new D(1000) : new D(1);
export const volumes = (c: Ctx) => findAll(c.s, VOL, VOL_F).map((f) => ({ ...f, raw: c.t.slice(f.index, f.end).trim() }));
const volUnit = (raw: string) => (/ml|millilit|cm|cc/i.test(raw) ? 'mL' : /m3|m³|cubic/i.test(raw) ? 'm³' : 'L');

const MOL = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(mmol|millimoles?|mol|moles?|mols)\b`, 'g');
const MASS = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(kg|kilograms?|mg|milligrams?|g|grams?|grammes?)\b`, 'g');
const amounts = (c: Ctx) => findAll(c.s, MOL, (u) => new D(u.startsWith('m') && u !== 'mol' && !u.startsWith('mole') && u !== 'mols' ? '1e-3' : '1'));
const masses = (c: Ctx) => findAll(c.s, MASS, (u) => new D(u.startsWith('k') ? 1000 : u === 'mg' || u.startsWith('milli') ? '1e-3' : 1));

/** The first word group in the text that names a substance: "NaCl", "Ca(OH)2", "sodium chloride", "glucose". */
export function findSubstance(c: Ctx): Substance | null {
  const words = c.t.split(' ');
  for (let i = 0; i < words.length; i++) {
    for (let n = 3; n >= 1; n--) {
      if (i + n > words.length) continue;
      const w = words.slice(i, i + n).join(' ').replace(/[,.;:]$/, '');
      const formulaLike = /^[A-Z(\[]/.test(w) && !w.includes(' ') && (/\d|[()[\]]/.test(w) || (w.match(/[A-Z]/g)?.length ?? 0) >= 2);
      const named = /^[a-z]/i.test(w) && !/^[A-Z][a-z]?$/.test(w);
      if (!formulaLike && !named) continue;
      if (/^(?:m|l|ml|g|mg|kg|mol|atm|pa|kpa|k|stp|at|in|of|and|to|the|a|an)$/i.test(w)) continue;
      const s = resolveSubstance(w);
      if (s && (formulaLike || s.name)) return s;
    }
  }
  return null;
}

// ---------- pH ----------
const STRONG_ACID: Record<string, [string, number]> = {
  hcl: ['HCl', 1], hbr: ['HBr', 1], hi: ['HI', 1], hno3: ['HNO3', 1], hclo4: ['HClO4', 1], hclo3: ['HClO3', 1], h2so4: ['H2SO4', 2],
  'hydrochloric acid': ['HCl', 1], 'hydrobromic acid': ['HBr', 1], 'hydroiodic acid': ['HI', 1], 'nitric acid': ['HNO3', 1], 'perchloric acid': ['HClO4', 1], 'sulfuric acid': ['H2SO4', 2], 'sulphuric acid': ['H2SO4', 2],
};
const STRONG_BASE: Record<string, [string, number]> = {
  naoh: ['NaOH', 1], koh: ['KOH', 1], lioh: ['LiOH', 1], rboh: ['RbOH', 1], csoh: ['CsOH', 1], 'ca(oh)2': ['Ca(OH)2', 2], 'ba(oh)2': ['Ba(OH)2', 2], 'sr(oh)2': ['Sr(OH)2', 2],
  'sodium hydroxide': ['NaOH', 1], 'potassium hydroxide': ['KOH', 1], 'lithium hydroxide': ['LiOH', 1], 'calcium hydroxide': ['Ca(OH)2', 2], 'barium hydroxide': ['Ba(OH)2', 2],
};

const H_ION = String.raw`(?:\[h\+\]|\[h3o\+\]|\[h⁺\]|h3o\+|h\+|hydrogen ions?|hydronium(?: ions?)?)`;
const OH_ION = String.raw`(?:\[oh-\]|\[oh⁻\]|\[oh\]|oh-|hydroxide(?: ions?)?)`;
const CONC_UNIT = String.raw`(?:\s*(?:m|mol\/l|molar|mol l-1))?`;

export function ph(c: Ctx) {
  const s = c.s;
  if (!/\bp(?:oh|h)\b|\[h|\[oh|\bh\+|h3o\+|\boh-|hydronium|hydroxide ion/.test(s)) return null;
  const KW = 14;
  let H: Dec | null = null;
  let waterIncluded = false;
  let span: [number, number] = [-1, -1];
  const notes = ['Assumes 25 °C, where Kw = 1.0 × 10⁻¹⁴ so pH + pOH = 14'];
  const take = (m: RegExpExecArray | null) => (m ? ((span = [m.index, m.index + m[0].length]), m) : null);

  let m =
    take(new RegExp(`${H_ION}\\s*(?:concentration\\s*)?(?:=|is|of|:|equals)?\\s*(${NUM})${CONC_UNIT}`).exec(s)) ??
    take(new RegExp(`(${NUM})\\s*(?:m|mol\\/l|molar)?\\s*(?:of\\s+)?${H_ION}`).exec(s));
  if (m) H = num(m[1]!);
  else {
    m = take(new RegExp(`${OH_ION}\\s*(?:concentration\\s*)?(?:=|is|of|:|equals)?\\s*(${NUM})${CONC_UNIT}`).exec(s)) ?? take(new RegExp(`(${NUM})\\s*(?:m|mol\\/l|molar)?\\s*(?:of\\s+)?${OH_ION}`).exec(s));
    if (m) H = new D(10).pow(-KW).div(num(m[1]!));
  }
  if (!H) {
    const sol = take(new RegExp(`(${NUM})\\s*(?:m|mol\\/l|molar|mol l-1)\\s+(?:of\\s+)?(?:an?\\s+)?(.+?)(?:\\s+solution)?$`).exec(s));
    if (sol) {
      const name = sol[2]!.trim();
      const conc = num(sol[1]!);
      const acid = STRONG_ACID[name];
      const base = STRONG_BASE[name];
      // Charge balance with water's own ions: [X] = (C + √(C² + 4Kw)) / 2. Without it 1e-8 M HCl would come out
      // basic (pH 8); with it, it is pH 6.98. Above ~1e-6 M the correction is invisible.
      const withWater = (C: Dec) => C.plus(C.pow(2).plus(new D(10).pow(-KW).mul(4)).sqrt()).div(2);
      const corrected = (C: Dec, X: Dec) => {
        waterIncluded = true;
        if (X.minus(C).div(X).gt('0.005')) notes.push('Very dilute: water’s own autoionization (10⁻⁷ M) is included');
        return X;
      };
      if (acid) {
        const C = conc.mul(acid[1]);
        H = corrected(C, withWater(C));
        notes.push(`${prettyFormula(acid[0])} is a strong acid: assumed to dissociate completely${acid[1] > 1 ? ` (both protons, an approximation for the second)` : ''}`);
      } else if (base) {
        const C = conc.mul(base[1]);
        H = new D(10).pow(-KW).div(corrected(C, withWater(C)));
        notes.push(`${prettyFormula(base[0])} is a strong base: assumed to dissociate completely, giving ${base[1]} OH⁻ per formula unit`);
      } else {
        return need(c, 'chemistry', `Is ${name} a strong acid or base? For a weak acid or base I need its Ka or Kb`);
      }
    }
  }
  if (!H) {
    const p = take(new RegExp(`\\bph\\s*(?:=|is|of|:|at|equals|equal to)?\\s*(${SNUM})(?![\\d.]|\\s*(?:m\\b|mol|molar))`).exec(s));
    if (p) H = new D(10).pow(num(p[1]!).neg());
    else {
      const q = take(new RegExp(`\\bpoh\\s*(?:=|is|of|:|at|equals|equal to)?\\s*(${SNUM})(?![\\d.]|\\s*(?:m\\b|mol|molar))`).exec(s));
      if (q) H = new D(10).pow(num(q[1]!).sub(KW));
    }
  }
  if (!H) return need(c, 'chemistry', 'Give a concentration or a pH, e.g. “pH of 0.001 M HCl” or “[H+] at pH 4.5”');
  if (H.lte(0)) return fail(c, 'chemistry', 'Concentrations must be positive');

  const pH = H.log(10).neg();
  const pOH = new D(KW).minus(pH);
  const OH = new D(10).pow(-KW).div(H);
  if (!waterIncluded && ((H.lt('1e-6') && H.gt('1e-8')) || (OH.lt('1e-6') && OH.gt('1e-8')))) notes.push('Very dilute: the water’s own H⁺/OH⁻ (10⁻⁷ M) is not added in');

  const mentions: [number, 'pH' | 'pOH' | 'H' | 'OH'][] = [];
  for (const [re, k] of [[/\bph\b/g, 'pH'], [/\bpoh\b/g, 'pOH'], [new RegExp(H_ION, 'g'), 'H'], [new RegExp(OH_ION, 'g'), 'OH']] as const) {
    for (const x of s.matchAll(re)) if (x.index! < span[0] || x.index! >= span[1]) mentions.push([x.index!, k]);
  }
  mentions.sort((a, b) => a[0] - b[0]);
  const target = mentions[0]?.[1] ?? 'pH';
  const r = (x: Dec) => x.toDecimalPlaces(4);
  const values = { pH: r(pH), pOH: r(pOH), H, OH };
  const value = values[target];
  const label = { pH: 'pH', pOH: 'pOH', H: '[H⁺]', OH: '[OH⁻]' }[target];
  const isConc = target === 'H' || target === 'OH';
  const p = prim(value, isConc ? 'M' : undefined, isConc ? 'molar' : undefined);
  if (!isConc) p.spoken = `${label} ${p.spoken}`;
  return ok(c, {
    kind: 'chemistry',
    expression: `${label} · ${target === 'pH' || target === 'pOH' ? `[H⁺] = ${disp(H)} M` : `pH ${disp(r(pH))}`}`,
    primary: p,
    value,
    lines: [
      { label: 'pH', display: disp(r(pH)) },
      { label: 'pOH', display: disp(r(pOH)) },
      { label: '[H⁺]', display: `${disp(H)} M` },
      { label: '[OH⁻]', display: `${disp(OH)} M` },
      { label: 'Formula', display: 'pH = −log₁₀[H⁺], pH + pOH = 14' },
      { label: 'Nature', display: pH.lt(7) ? 'acidic' : pH.gt(7) ? 'basic' : 'neutral' },
    ],
    notes,
  });
}

// ---------- molarity ----------
export function molarity(c: Ctx) {
  const s = c.s;
  const chemWord = /\b(?:molarity|molar concentration|concentration|molar|solution|dissolved?|solute)\b/.test(s);
  const concs = concentrations(c, chemWord);
  const vols = volumes(c);
  if (!chemWord && !(concs.length && vols.length)) return null;
  if (concs.length > 1) return null;
  const mols = amounts(c);
  const ms = masses(c);
  const sub = findSubstance(c);
  const notes: string[] = [];
  let n: Dec | null = mols[0]?.v ?? null;
  if (!n && ms[0]) {
    if (!sub) return need(c, 'chemistry', `${ms[0].raw} of which substance? (e.g. “10 g NaCl”)`);
    n = ms[0].v.div(sub.molarMass);
    notes.push(`${ms[0].raw} ÷ ${disp(sub.molarMass)} g/mol (${prettyFormula(sub.formula)}) = ${disp(n)} mol`);
  }
  const M = concs[0]?.v ?? null;
  const V = vols[0]?.v ?? null;
  const known = [n, M, V].filter(Boolean).length;
  if (known === 3) return null;
  if (!chemWord && known < 2) return null;
  const wantsMass = /\b(?:grams?|mass|how much)\b/.test(s) && !ms.length && sub;
  if (known < 2) {
    if (!M && /molarity|concentration/.test(s)) return need(c, 'chemistry', !V ? 'What is the volume of the solution?' : 'How much solute? (moles, or grams of a named substance)');
    if (M || V || n) return need(c, 'chemistry', !M ? 'What is the concentration (M)?' : !V ? 'What volume of solution?' : 'How much solute?');
    return null;
  }
  const vUnit = vols[0] ? volUnit(vols[0].raw) : 'L';
  if (!M) {
    const molar = n!.div(V!);
    return ok(c, {
      kind: 'chemistry',
      expression: `Molarity · ${disp(n!)} mol in ${vols[0]!.raw}`,
      primary: prim(molar, 'M', 'molar'),
      value: molar,
      lines: [{ label: 'Formula', display: 'M = n / V' }, { label: 'Moles', display: `${disp(n!)} mol` }, { label: 'Volume', display: `${disp(V!)} L` }, { label: 'Millimolar', display: `${disp(molar.mul(1000))} mM` }],
      notes: [...notes, 'Molarity = moles of solute per litre of solution'],
    });
  }
  if (!V) {
    const vol = n!.div(M);
    const show = vol.lt(1) ? vol.mul(1000) : vol;
    const u = vol.lt(1) ? 'mL' : 'L';
    return ok(c, {
      kind: 'chemistry',
      expression: `Volume · ${disp(n!)} mol at ${concs[0]!.raw}`,
      primary: prim(show, u, u === 'mL' ? 'millilitres' : 'litres'),
      value: show,
      lines: [{ label: 'Formula', display: 'V = n / M' }, { label: 'Litres', display: `${disp(vol)} L` }],
      notes,
    });
  }
  const moles = M.mul(V);
  if (wantsMass && sub) {
    const g = moles.mul(sub.molarMass);
    return ok(c, {
      kind: 'chemistry',
      expression: `Mass of ${prettyFormula(sub.formula)} for ${vols[0]!.raw} of ${concs[0]!.raw}`,
      primary: prim(g, 'g', 'grams'),
      value: g,
      lines: [{ label: 'Formula', display: 'm = M × V × molar mass' }, { label: 'Moles', display: `${disp(moles)} mol` }, { label: 'Molar mass', display: `${disp(sub.molarMass)} g/mol` }],
      notes,
    });
  }
  return ok(c, {
    kind: 'chemistry',
    expression: `Moles · ${vols[0]!.raw} of ${concs[0]!.raw}`,
    primary: prim(moles, 'mol', 'moles'),
    value: moles,
    lines: [
      { label: 'Formula', display: 'n = M × V' },
      { label: 'Volume', display: `${disp(V)} L (${vUnit === 'mL' ? vols[0]!.raw : `${disp(V.mul(1000))} mL`})` },
      ...(sub ? [{ label: `Mass of ${prettyFormula(sub.formula)}`, display: `${disp(moles.mul(sub.molarMass))} g` }] : []),
    ],
    notes,
  });
}

// ---------- dilution C1V1 = C2V2 ----------
export function dilution(c: Ctx) {
  const s = c.s;
  if (!/\b(?:dilut\w*|c1\s*v1|m1\s*v1|stock solution|to make)\b|c1v1|m1v1/.test(s) && (s.match(/\b[cmv][12]\s*=/g)?.length ?? 0) < 3) return null;
  const vars: Record<'c1' | 'v1' | 'c2' | 'v2', Dec | null> = { c1: null, v1: null, c2: null, v2: null };
  let vUnit = 'L';
  const explicit = [...c.t.matchAll(new RegExp(String.raw`\b([CMVcmv])\s*([12])\s*=\s*(${NUM})(?:\s*(M|mM|µM|uM|nM|mL|ml|L|l|µL|uL|dm3|cm3)\b)?`, 'g'))];
  if (explicit.length) {
    for (const m of explicit) {
      const isConc = /[CMcm]/.test(m[1]!);
      const key = `${isConc ? 'c' : 'v'}${m[2]}` as keyof typeof vars;
      const unit = m[4] ?? '';
      let v = num(m[3]!);
      if (isConc) v = v.mul(new D(CONC_F[unit] ?? (unit ? '1' : '1')));
      else {
        if (unit) {
          v = v.mul(VOL_F(unit.toLowerCase())!);
          vUnit = volUnit(unit.toLowerCase());
        }
      }
      vars[key] = v;
    }
    if (explicit.some((m) => /[Vv]/.test(m[1]!) && !m[4])) vUnit = '(same unit as given)';
  } else {
    const concs = concentrations(c, true);
    const vols = volumes(c);
    const toIdx = (() => {
      const m = /\b(?:to|into|until|make|final|up to)\b/.exec(s);
      return m ? m.index : Infinity;
    })();
    if (concs.length === 2) {
      vars.c1 = concs[0]!.v;
      vars.c2 = concs[1]!.v;
    } else if (concs.length === 1) {
      if (concs[0]!.index < toIdx) vars.c1 = concs[0]!.v;
      else vars.c2 = concs[0]!.v;
    }
    for (const v of vols) {
      // "50 mL of 2 M" pairs a volume with the concentration right after it; "2 M, 50 mL" with the one right before.
      const partner =
        concs.find((cc) => cc.index >= v.end && /^\s*(?:of\s+)?(?:an?\s+)?$/.test(s.slice(v.end, cc.index))) ??
        concs.find((cc) => v.index >= cc.end && /^[\s,]*$/.test(s.slice(cc.end, v.index)));
      let slot: 'v1' | 'v2';
      if (partner) slot = partner.v === vars.c1 && (concs.length === 1 || partner === concs[0]) ? 'v1' : 'v2';
      else slot = v.index < toIdx ? 'v1' : 'v2';
      if (vars[slot]) slot = slot === 'v1' ? 'v2' : 'v1';
      vars[slot] = v.v;
    }
    if (vols[0]) vUnit = volUnit(vols[0].raw);
  }
  const missing = (Object.keys(vars) as (keyof typeof vars)[]).filter((k) => !vars[k]);
  if (missing.length > 1) return need(c, 'chemistry', `For C₁V₁ = C₂V₂ I need three of the four values; missing ${missing.map((k) => k.toUpperCase()).join(', ')}`);
  if (missing.length === 0) return null;
  const k = missing[0]!;
  const { c1, v1, c2, v2 } = vars;
  let value: Dec;
  if (k === 'c1') value = c2!.mul(v2!).div(v1!);
  else if (k === 'v1') value = c2!.mul(v2!).div(c1!);
  else if (k === 'c2') value = c1!.mul(v1!).div(v2!);
  else value = c1!.mul(v1!).div(c2!);
  const isVol = k[0] === 'v';
  const factor = vUnit === 'mL' ? 1000 : vUnit === 'm³' ? 0.001 : 1;
  const shown = isVol ? value.mul(factor) : value;
  const unit = isVol ? (vUnit.startsWith('(') ? '' : vUnit) : 'M';
  const all = { c1, v1, c2, v2, [k]: value } as Record<keyof typeof vars, Dec>;
  const fv = (x: Dec) => `${disp(x.mul(factor))}${unit && isVolUnit(vUnit) ? ` ${vUnit}` : ''}`;
  const lines = [
    { label: 'Formula', display: `C₁V₁ = C₂V₂ → ${k.toUpperCase()} = ${k === 'c1' ? 'C₂V₂ / V₁' : k === 'v1' ? 'C₂V₂ / C₁' : k === 'c2' ? 'C₁V₁ / V₂' : 'C₁V₁ / C₂'}` },
    { label: 'C₁', display: `${disp(all.c1)} M` },
    { label: 'V₁', display: fv(all.v1) },
    { label: 'C₂', display: `${disp(all.c2)} M` },
    { label: 'V₂', display: fv(all.v2) },
  ];
  if (all.v2.gt(all.v1)) lines.push({ label: 'Solvent to add', display: fv(all.v2.minus(all.v1)) });
  const notes: string[] = [];
  if (all.c2.gt(all.c1)) notes.push('C₂ is higher than C₁: that is concentration, not dilution');
  if (vUnit.startsWith('(')) notes.push('Volumes had no unit; the answer is in the same unit');
  return ok(c, {
    kind: 'chemistry',
    expression: `Dilution · solve for ${k.toUpperCase()}`,
    primary: prim(shown, unit || undefined, isVol ? (vUnit === 'mL' ? 'millilitres' : vUnit === 'L' ? 'litres' : undefined) : 'molar'),
    value: shown,
    lines,
    notes,
  });
}
const isVolUnit = (u: string) => u === 'L' || u === 'mL' || u === 'm³';

// ---------- ideal gas law ----------
const PRESS = new RegExp(String.raw`(?<![\w.])(${NUM})\s*(atm|atmospheres?|kpa|kilopascals?|mpa|hpa|pa|pascals?|bar|mbar|mmhg|mm hg|torr|psi)\b`, 'g');
const PRESS_F: Record<string, number> = { atm: 101325, kpa: 1000, mpa: 1e6, hpa: 100, pa: 1, bar: 1e5, mbar: 100, mmhg: 133.322387415, 'mm hg': 133.322387415, torr: 101325 / 760, psi: 6894.757293168 };
const pressF = (u: string) => new D(PRESS_F[u.replace(/s$/, '').replace(/^atmosphere$/, 'atm').replace(/^kilopascal$/, 'kpa').replace(/^pascal$/, 'pa')] ?? NaN);
const TEMP = new RegExp(String.raw`(?<![\w.])(${SNUM})\s*(k|kelvin|°\s?c|º\s?c|c|celsius|degrees? c(?:elsius)?|°\s?f|º\s?f|f|fahrenheit|degrees? f(?:ahrenheit)?)(?![a-z])`, 'g');

export function idealGas(c: Ctx) {
  const s = c.s;
  if (!/\b(?:ideal gas|gas law|pv\s*=\s*nrt|gas|stp)\b/.test(s)) return null;
  const notes: string[] = [];
  const unitsUsed: string[] = [];
  const P = findAll(s, PRESS, (u) => pressF(u.replace(/\s+/g, ' ')))[0];
  const V = volumes(c)[0];
  const temps = [...s.matchAll(TEMP)];
  let T: Dec | null = null;
  if (temps[0]) {
    const u = temps[0][2]!.replace(/\s+/g, '');
    const v = num(temps[0][1]!);
    if (/^(?:k|kelvin)$/.test(u)) {
      T = v;
      unitsUsed.push('T in K');
    } else if (/f/.test(u)) {
      T = v.minus(32).mul(5).div(9).plus('273.15');
      unitsUsed.push(`T: ${v} °F = ${disp(T)} K`);
    } else {
      T = v.plus('273.15');
      unitsUsed.push(`T: ${v} °C = ${disp(T)} K`);
    }
  }
  let n: Dec | null = amounts(c)[0]?.v ?? null;
  const sub = findSubstance(c);
  const mass = masses(c)[0];
  if (!n && mass) {
    if (!sub) return need(c, 'chemistry', `${mass.raw} of which gas?`);
    n = mass.v.div(sub.molarMass);
    unitsUsed.push(`n: ${mass.raw} ÷ ${disp(sub.molarMass)} g/mol = ${disp(n)} mol`);
  }
  let p: Dec | null = P ? P.v : null;
  if (P) unitsUsed.push(`P: ${P.raw}${/pa$/.test(P.raw) && !/kpa|mpa|hpa/.test(P.raw) ? '' : ` = ${disp(P.v)} Pa`}`);
  let v: Dec | null = V ? V.v.div(1000) : null;
  if (V) unitsUsed.push(`V: ${V.raw} = ${disp(V.v)} L`);
  if (/\bstp\b/.test(s)) {
    if (!T) T = new D('273.15');
    if (!p) p = new D(101325);
    notes.push('STP taken as 0 °C and 1 atm (IUPAC’s 100 kPa definition gives 22.711 L/mol instead of 22.414)');
  }
  const R = CONST.R;
  const known = { P: p, V: v, n, T };
  const missing = (Object.keys(known) as (keyof typeof known)[]).filter((k) => !known[k]);
  if (missing.length === 0) return null;
  if (missing.length > 1) return need(c, 'chemistry', `PV = nRT needs three of P, V, n and T; missing ${missing.join(', ')} (give units, e.g. “2 atm”, “10 L”, “300 K”)`);
  const k = missing[0]!;
  const lines: { label: string; display: string }[] = [{ label: 'Formula', display: `PV = nRT → ${{ P: 'P = nRT / V', V: 'V = nRT / P', n: 'n = PV / RT', T: 'T = PV / nR' }[k]}` }];
  let primary;
  let value: Dec;
  if (k === 'P') {
    const pa = n!.mul(R).mul(T!).div(v!);
    value = pa.div(101325);
    primary = prim(value, 'atm', 'atmospheres');
    lines.push({ label: 'kPa', display: disp(pa.div(1000)) }, { label: 'Pa', display: disp(pa) });
  } else if (k === 'V') {
    const m3 = n!.mul(R).mul(T!).div(p!);
    value = m3.mul(1000);
    primary = prim(value, 'L', 'litres');
    lines.push({ label: 'm³', display: disp(m3) }, { label: 'mL', display: disp(m3.mul(1e6)) });
  } else if (k === 'n') {
    value = p!.mul(v!).div(R.mul(T!));
    primary = prim(value, 'mol', 'moles');
    if (sub) lines.push({ label: `Mass of ${prettyFormula(sub.formula)}`, display: `${disp(value.mul(sub.molarMass))} g` });
    lines.push({ label: 'Molecules', display: disp(value.mul(CONST.NA)) });
  } else {
    value = p!.mul(v!).div(n!.mul(R));
    primary = prim(value, 'K', 'kelvin');
    lines.push({ label: '°C', display: disp(value.minus('273.15')) });
  }
  if (T && T.lte(0)) return fail(c, 'chemistry', 'Temperature must be above absolute zero');
  notes.push(`R = ${disp(R, 10)} J/(mol·K); worked in SI units (Pa, m³, K)`, `Units used: ${unitsUsed.join('; ') || 'STP values'}`, 'Ideal gas: real gases deviate at high pressure or low temperature');
  return ok(c, { kind: 'chemistry', expression: `Ideal gas law · solve for ${k}`, primary, value, lines, notes });
}
