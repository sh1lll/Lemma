import { MEDICAL_NOTE, NUM, frac, lab, named, namedFrac, need, num, ofDim, pct, res, show, withUnit, type Ctx, type Handler } from './util';

const Md = 'medical' as const;
const B = 'biology' as const;

function heightM(c: Ctx): number | null {
  const fi = /(\d)\s*(?:ft|feet|foot|')\s*(\d{1,2}(?:\.\d+)?)?\s*(?:in|inches|inch|"|'')?/.exec(c.s);
  if (fi) return (num(fi[1]!) * 12 + (fi[2] ? num(fi[2]) : 0)) * 0.0254;
  const inch = /(\d{2}(?:\.\d+)?)\s*(?:in|inches)\b/.exec(c.s);
  if (inch) return num(inch[1]!) * 0.0254;
  const L = lab(c, 'length', /height|tall|\bh\b/) ?? ofDim(c, 'length').find((q) => q.v > 0.4 && q.v < 2.6);
  return L ? L.v : null;
}
function weightKg(c: Ctx): number | null {
  const m = lab(c, 'mass', /weight|weighs|mass|\bw\b/) ?? ofDim(c, 'mass').find((q) => q.v > 0.3 && q.v < 500);
  return m ? m.v : null;
}
function age(c: Ctx): number | null {
  const m = /(?:age|aged)\s*(?:=|:|of)?\s*(\d{1,3})|(\d{1,3})\s*(?:-?\s*years?(?:\s*-?\s*old)?|yo|y\/o|yrs?)\b/.exec(c.s);
  return m ? num(m[1] ?? m[2]!) : null;
}
function sex(c: Ctx): 'm' | 'f' | null {
  if (/\b(?:female|woman|women|girl|f)\b/.test(c.s)) return 'f';
  if (/\b(?:male|man|men|boy|m)\b/.test(c.s)) return 'm';
  return null;
}

const bmi: Handler = (c) => {
  if (!/\bbmi\b|body mass index/.test(c.s)) return null;
  const h = heightM(c);
  const w = weightKg(c);
  if (h === null || w === null) return need(c, Md, 'BMI needs weight and height, e.g. "BMI 70 kg 1.75 m" or "BMI 150 lb 5 ft 6 in"');
  const v = w / (h * h);
  const cat = v < 18.5 ? 'Underweight' : v < 25 ? 'Normal weight' : v < 30 ? 'Overweight' : v < 35 ? 'Obesity class I' : v < 40 ? 'Obesity class II' : 'Obesity class III';
  return res(c, { kind: Md, expression: `BMI for ${show(w)} kg, ${show(h)} m`, value: v, unit: 'kg/m²', sig: 3, formula: 'BMI = weight (kg) / height (m)²', lines: [['WHO category (adults)', cat], ['Healthy weight range for this height', `${show(18.5 * h * h, 3)}–${show(24.9 * h * h, 3)} kg`]], notes: ['Adult categories (WHO); not for children, pregnancy or very muscular builds', MEDICAL_NOTE] });
};

const bmr: Handler = (c) => {
  if (!/\bbmr\b|basal metabolic|resting (?:energy|metabolic)|\btdee\b|calories? (?:a|per) day|daily calorie/.test(c.s)) return null;
  const h = heightM(c);
  const w = weightKg(c);
  const a = age(c);
  const s = sex(c);
  if (h === null || w === null || a === null) return need(c, Md, 'BMR needs weight, height and age (and sex)');
  if (s === null) return need(c, Md, 'BMR equations differ by sex: male or female?');
  const cm = h * 100;
  const mif = 10 * w + 6.25 * cm - 5 * a + (s === 'm' ? 5 : -161);
  const hb = s === 'm' ? 88.362 + 13.397 * w + 4.799 * cm - 5.677 * a : 447.593 + 9.247 * w + 3.098 * cm - 4.33 * a;
  const useHB = /harris|benedict/.test(c.s);
  const act: [RegExp, number, string][] = [[/sedentary/, 1.2, 'sedentary'], [/lightly active|light/, 1.375, 'lightly active'], [/moderately active|moderate/, 1.55, 'moderately active'], [/very active/, 1.725, 'very active'], [/extra active|athlete/, 1.9, 'extra active']];
  const af = act.find(([re]) => re.test(c.s));
  const base = useHB ? hb : mif;
  const lines: [string, string][] = [['Mifflin–St Jeor', `${show(mif, 5)} kcal/day`], ['Harris–Benedict (Roza–Shizgal 1984)', `${show(hb, 5)} kcal/day`]];
  if (af) lines.push([`TDEE (${af[2]}, ×${af[1]})`, `${show(base * af[1], 5)} kcal/day`]);
  return res(c, { kind: Md, expression: `BMR (${useHB ? 'Harris–Benedict' : 'Mifflin–St Jeor'}), ${s === 'm' ? 'male' : 'female'}, ${show(w)} kg, ${show(cm)} cm, ${a} y`, value: af && /tdee|calories|daily/.test(c.s) ? base * af[1] : base, unit: 'kcal/day', sig: 5, formula: useHB ? (s === 'm' ? '88.362 + 13.397W + 4.799H − 5.677A' : '447.593 + 9.247W + 3.098H − 4.330A') : `10W + 6.25H − 5A ${s === 'm' ? '+ 5' : '− 161'}`, lines, notes: ['W kg, H cm, A years', MEDICAL_NOTE] });
};

const bsa: Handler = (c) => {
  if (!/\bbsa\b|body surface area/.test(c.s)) return null;
  const h = heightM(c);
  const w = weightKg(c);
  if (h === null || w === null) return need(c, Md, 'BSA needs height and weight');
  const most = Math.sqrt((h * 100 * w) / 3600);
  const dub = 0.007184 * w ** 0.425 * (h * 100) ** 0.725;
  const useDub = /du ?bois/.test(c.s);
  return res(c, { kind: Md, expression: `Body surface area (${useDub ? 'Du Bois' : 'Mosteller'})`, value: useDub ? dub : most, unit: 'm²', sig: 3, formula: useDub ? 'BSA = 0.007184 · W^0.425 · H^0.725' : 'BSA = √(H(cm) · W(kg) / 3600)', lines: [['Mosteller', withUnit(most, 'm²', 3)], ['Du Bois', withUnit(dub, 'm²', 3)]], notes: [MEDICAL_NOTE] });
};

const ibw: Handler = (c) => {
  if (!/ideal (?:body )?weight|\bibw\b|lean body weight|adjusted body weight/.test(c.s)) return null;
  const h = heightM(c);
  const s = sex(c);
  if (h === null) return need(c, Md, 'Ideal body weight needs height');
  if (s === null) return need(c, Md, 'The Devine formula differs by sex: male or female?');
  const inches = h / 0.0254;
  const v = (s === 'm' ? 50 : 45.5) + 2.3 * (inches - 60);
  const lines: [string, string][] = [['Height', `${show(inches, 4)} in`]];
  const w = weightKg(c);
  if (w !== null && w > v) lines.push(['Adjusted body weight (IBW + 0.4 × excess)', withUnit(v + 0.4 * (w - v), 'kg')]);
  return res(c, { kind: Md, expression: `Ideal body weight (Devine), ${s === 'm' ? 'male' : 'female'}`, value: v, unit: 'kg', sig: 3, formula: `IBW = ${s === 'm' ? '50' : '45.5'} kg + 2.3 kg × (inches over 5 ft)`, lines, notes: inches < 60 ? ['Devine is not validated below 5 ft', MEDICAL_NOTE] : [MEDICAL_NOTE] });
};

const dosing: Handler = (c) => {
  const perKg = ofDim(c, 'dose')[0];
  if (perKg && /dose|dosage|give|mg\/kg|per kg|child|patient|weigh/.test(c.s)) {
    const w = ofDim(c, 'mass').find((q) => q.index !== perKg.index && q.v > 0.3);
    if (!w) return need(c, Md, 'What is the patient’s weight?');
    const dose = perKg.v * w.v; // mg
    const lines: [string, string][] = [['Weight', withUnit(w.v, 'kg')], ['Dose rate', withUnit(perKg.v, 'mg/kg')]];
    const per = /divided (?:into )?(\d+) doses|(?:every|q)\s*(\d+)\s*h|(\d+)\s*times (?:a|per) day/.exec(c.s);
    let shown = dose;
    let what = 'Dose';
    if (per && /day|daily|\/d\b/.test(c.s)) {
      const n = per[1] ? num(per[1]) : per[2] ? 24 / num(per[2]) : num(per[3]!);
      lines.push(['Daily total', withUnit(dose, 'mg')], ['Doses per day', show(n)]);
      shown = dose / n;
      what = 'Per dose';
    }
    const maxM = new RegExp(String.raw`max(?:imum)?\s*(?:of|dose)?\s*(${NUM})\s*mg`).exec(c.s);
    const notes = [MEDICAL_NOTE];
    if (maxM && shown > num(maxM[1]!)) {
      notes.unshift(`Capped at the stated maximum ${maxM[1]} mg`);
      shown = num(maxM[1]!);
    }
    const conc = ofDim(c, 'massconc')[0];
    const susp = new RegExp(String.raw`(${NUM})\s*mg\s*(?:\/|per|in)\s*(${NUM})?\s*ml`).exec(c.s);
    const mgPerMl = conc ? conc.v / 1000 * 1000 / 1000 : susp ? num(susp[1]!) / (susp[2] ? num(susp[2]) : 1) : null;
    if (mgPerMl) lines.push(['Volume to give', `${show(shown / (conc ? conc.v / 1000 : mgPerMl))} mL`], ['Concentration', `${show(conc ? conc.v / 1000 : mgPerMl)} mg/mL`]);
    return res(c, { kind: Md, expression: `Weight-based dose: ${perKg.raw} × ${w.raw}`, value: shown, unit: 'mg', unitWords: 'milligrams', formula: 'dose = mg/kg × weight (kg)', lines: [[what, withUnit(shown, 'mg')], ...lines], notes });
  }
  if (/\bdrip rate|gtt|drops? per min|drop factor|infusion rate|ml\/h|ml per hour|\biv\b/.test(c.s)) {
    const V = ofDim(c, 'volume')[0];
    const t = ofDim(c, 'time')[0];
    if (!V || !t) return need(c, Md, 'IV rate needs the volume and the infusion time');
    const mL = V.v * 1e6;
    const min = t.v / 60;
    const df = named(c, 'drop factor|df|gtt/ml|drops per ml') ?? (/(\d+)\s*(?:gtt|drops?)\s*(?:\/|per)\s*ml/.exec(c.s) ? num(/(\d+)\s*(?:gtt|drops?)\s*(?:\/|per)\s*ml/.exec(c.s)![1]!) : null);
    const lines: [string, string][] = [['Rate', `${show(mL / (min / 60))} mL/h`]];
    if (df === null) return res(c, { kind: Md, expression: `Infusion rate: ${V.raw} over ${t.raw}`, value: mL / (min / 60), unit: 'mL/h', formula: 'rate = volume / time', notes: ['For drops per minute, give the drop factor (gtt/mL)', MEDICAL_NOTE] });
    return res(c, { kind: Md, expression: `Drip rate: ${V.raw} over ${t.raw}, drop factor ${df} gtt/mL`, value: (mL * df) / min, unit: 'gtt/min', sig: 4, formula: 'gtt/min = volume (mL) × drop factor / time (min)', lines: [...lines, ['Rounded for counting', `${Math.round((mL * df) / min)} gtt/min`]], notes: [MEDICAL_NOTE] });
  }
  if (/reconstitut/.test(c.s)) {
    const masses = ofDim(c, 'mass');
    const V = ofDim(c, 'volume')[0];
    if (masses.length < 2 || !V) return need(c, Md, 'Reconstitution needs the vial amount, the diluent volume and the dose wanted');
    const vial = masses[0]!.v;
    const want = masses[1]!.v;
    const conc = vial / (V.v * 1e6);
    return res(c, { kind: Md, expression: 'Reconstituted dose volume', value: want / conc, unit: 'mL', formula: 'volume = dose / (vial amount / diluent volume)', lines: [['Concentration', `${show(conc * 1e6)} mg/mL`]], notes: ['Ignores powder displacement volume (check the product leaflet)', MEDICAL_NOTE] });
  }
  return null;
};

const crcl: Handler = (c) => {
  if (!/creatinine clearance|cockcroft|crcl/.test(c.s)) return null;
  const a = age(c);
  const w = weightKg(c);
  const s = sex(c);
  const cr = named(c, 'serum creatinine|creatinine|scr|cr');
  if (a === null || w === null || cr === null) return need(c, Md, 'Cockcroft–Gault needs age, weight and serum creatinine (mg/dL)');
  if (s === null) return need(c, Md, 'Cockcroft–Gault differs by sex: male or female?');
  const umol = /µmol|umol|μmol/.test(c.s) || cr > 20;
  const scr = umol ? cr / 88.4 : cr;
  const v = (((140 - a) * w) / (72 * scr)) * (s === 'f' ? 0.85 : 1);
  return res(c, { kind: Md, expression: `Creatinine clearance (Cockcroft–Gault), ${s === 'm' ? 'male' : 'female'}`, value: v, unit: 'mL/min', sig: 3, formula: `CrCl = (140 − age) × weight / (72 × SCr)${s === 'f' ? ' × 0.85' : ''}`, lines: [['Serum creatinine', `${show(scr)} mg/dL${umol ? ` (from ${show(cr)} µmol/L)` : ''}`]], notes: ['Actual body weight used; many protocols use ideal or adjusted weight', MEDICAL_NOTE] });
};

const pk: Handler = (c) => {
  if (!/loading dose|maintenance dose|elimination|clearance|volume of distribution|\bvd\b|pharmacokinetic|plasma|drug|concentration after|half.?life.*(?:mg|drug|dose)|(?:mg|drug|dose).*half.?life|steady state/.test(c.s) || /creatinine/.test(c.s)) return null;
  const notes = [MEDICAL_NOTE];
  const Vd = lab(c, 'volume', /vd|volume of distribution|volume/) ?? ofDim(c, 'volume')[0];
  const Ct = ofDim(c, 'massconc')[0];
  const hl = lab(c, 'time', /half.?life|t½|t1\/2/);
  const k = named(c, 'k|ke|elimination (?:rate )?constant|kel');
  const F = namedFrac(c, 'f|bioavailability') ?? 1;
  if (/loading dose/.test(c.s)) {
    if (!Vd || !Ct) return need(c, Md, 'Loading dose needs Vd and the target concentration');
    return res(c, { kind: Md, expression: 'Loading dose', value: (Ct.v * Vd.v * 1000) / F, unit: 'mg', formula: 'LD = C_target × Vd / F', lines: [['F', show(F)]], notes });
  }
  const CLq = ofDim(c, 'flow')[0];
  if (/maintenance dose|dosing rate/.test(c.s)) {
    const tau = lab(c, 'time', /every|interval|τ|tau|q/) ?? ofDim(c, 'time').find((x) => x !== hl);
    let CL = CLq ? CLq.v * 1000 * 3600 : null; // L/h
    if (CL === null && Vd && (k !== null || hl)) CL = (Vd.v * 1000 * (k ?? Math.LN2 / (hl!.v / 3600)));
    if (CL === null || !Ct || !tau) return need(c, Md, 'Maintenance dose needs clearance (or Vd and half-life), the target concentration and the dosing interval');
    const dose = (CL * Ct.v * (tau.v / 3600)) / F;
    return res(c, { kind: Md, expression: 'Maintenance dose', value: dose, unit: 'mg', formula: 'MD = CL × C_ss × τ / F', lines: [['Clearance', withUnit(CL, 'L/h')], ['Interval', withUnit(tau.v / 3600, 'h')]], notes });
  }
  if (/clearance/.test(c.s)) {
    if (!Vd || (k === null && !hl)) return need(c, Md, 'Clearance needs Vd and the elimination constant (or half-life)');
    const kk = k ?? Math.LN2 / (hl!.v / 3600);
    return res(c, { kind: Md, expression: 'Drug clearance', value: kk * Vd.v * 1000, unit: 'L/h', formula: 'CL = k × Vd', lines: [['k', `${show(kk)} /h`]], notes });
  }
  if (hl && /elimination|rate constant|\bk\b/.test(c.s) && !Ct) return res(c, { kind: Md, expression: 'Elimination rate constant', value: Math.LN2 / (hl.v / 3600), unit: 'per hour', formula: 'k = ln 2 / t½', lines: [['Time to ~97% eliminated (5 t½)', withUnit((5 * hl.v) / 3600, 'h')]], notes });
  if (Ct && (hl || k !== null)) {
    const t = ofDim(c, 'time').find((x) => x !== hl);
    if (!t) return need(c, Md, 'After how long?');
    const kk = k ?? Math.LN2 / (hl!.v / 3600);
    const C = Ct.v * Math.exp((-kk * t.v) / 3600);
    return res(c, { kind: Md, expression: `Concentration after ${t.raw} (first-order elimination)`, value: C, unit: 'mg/L', formula: 'C = C₀ e^(−kt)', lines: [['k', `${show(kk)} /h`], ['Half-lives elapsed', show((kk * t.v) / 3600 / Math.LN2)]], notes });
  }
  return null;
};

// ─────────────── diagnostic tests & risk ───────────────
const diagnostic: Handler = (c) => {
  if (!/sensitivity|specificity|\bppv\b|\bnpv\b|positive predictive|negative predictive|likelihood ratio|lr\+|lr-/.test(c.s)) return null;
  const tp = named(c, 'tp|true positives?');
  const fp = named(c, 'fp|false positives?');
  const fn = named(c, 'fn|false negatives?');
  const tn = named(c, 'tn|true negatives?');
  let sens = namedFrac(c, 'sensitivity|sens|tpr');
  let spec = namedFrac(c, 'specificity|spec|tnr');
  let prev = namedFrac(c, 'prevalence|prev|pre-?test probability|base rate');
  if (tp !== null && fp !== null && fn !== null && tn !== null) {
    sens = tp / (tp + fn);
    spec = tn / (tn + fp);
    prev ??= (tp + fn) / (tp + fp + fn + tn);
  }
  if (sens === null || spec === null) return need(c, Md, 'Give sensitivity and specificity (and prevalence for PPV/NPV), or a 2×2 table TP, FP, FN, TN');
  const lrp = sens / (1 - spec);
  const lrn = (1 - sens) / spec;
  const lines: [string, string][] = [['Sensitivity', pct(sens)], ['Specificity', pct(spec)], ['LR+', show(lrp)], ['LR−', show(lrn)]];
  if (prev === null) {
    return res(c, { kind: Md, expression: 'Likelihood ratios', value: lrp, display: `LR+ ${show(lrp)}, LR− ${show(lrn)}`, formula: 'LR+ = sens/(1 − spec), LR− = (1 − sens)/spec', lines, notes: ['Give the prevalence to get PPV and NPV', MEDICAL_NOTE] });
  }
  const ppv = (sens * prev) / (sens * prev + (1 - spec) * (1 - prev));
  const npv = (spec * (1 - prev)) / (spec * (1 - prev) + (1 - sens) * prev);
  lines.push(['Prevalence', pct(prev)], ['PPV', pct(ppv)], ['NPV', pct(npv)]);
  const per = 10000;
  const table = { caption: `Per ${per.toLocaleString('en-US')} people`, columns: ['', 'Has condition', 'No condition', 'Total'], rows: [['Test +', show(sens * prev * per, 4), show((1 - spec) * (1 - prev) * per, 4), show((sens * prev + (1 - spec) * (1 - prev)) * per, 4)], ['Test −', show((1 - sens) * prev * per, 4), show(spec * (1 - prev) * per, 4), show(((1 - sens) * prev + spec * (1 - prev)) * per, 4)]] };
  const wantNPV = /\bnpv\b|negative predictive/.test(c.s) && !/\bppv\b|positive predictive/.test(c.s);
  return res(c, { kind: Md, expression: wantNPV ? 'Negative predictive value' : 'Positive predictive value', value: wantNPV ? npv : ppv, display: wantNPV ? `NPV ${pct(npv)}` : `PPV ${pct(ppv)}`, formula: wantNPV ? 'NPV = spec(1−p) / (spec(1−p) + (1−sens)p)' : 'PPV = sens·p / (sens·p + (1−spec)(1−p))', lines, table, notes: [MEDICAL_NOTE] });
};

const risk: Handler = (c) => {
  if (/\bnnt\b|number needed to (?:treat|harm)|absolute risk reduction|\barr\b|relative risk reduction|\brrr\b|control event rate|experimental event rate|\bcer\b|\beer\b/.test(c.s)) {
    let cer = namedFrac(c, 'control(?: event rate| group| risk)?|cer|placebo|untreated');
    let eer = namedFrac(c, 'treatment(?: event rate| group| risk)?|experimental(?: event rate)?|eer|treated|drug|intervention');
    if (cer === null || eer === null) {
      const ps = [...c.s.matchAll(new RegExp(String.raw`(${NUM})\s*%`, 'g'))].map((m) => num(m[1]!) / 100);
      if (ps.length >= 2) [cer, eer] = [ps[0]!, ps[1]!];
    }
    if (cer === null || eer === null) return need(c, Md, 'NNT needs the control and treatment event rates');
    const arr = cer - eer;
    const rrr = arr / cer;
    const nnt = 1 / Math.abs(arr);
    return res(c, { kind: Md, expression: arr >= 0 ? 'Number needed to treat' : 'Number needed to harm', value: nnt, display: `${arr >= 0 ? 'NNT' : 'NNH'} ${show(nnt)} (round up to ${Math.ceil(nnt - 1e-9)})`, formula: 'NNT = 1/ARR, ARR = CER − EER', lines: [['CER', pct(cer)], ['EER', pct(eer)], ['ARR', pct(arr)], ['RRR', pct(rrr)], ['Relative risk', show(eer / cer)]], notes: [MEDICAL_NOTE] });
  }
  if (/odds ratio|relative risk|risk ratio|\b2x2\b|2 ?by ?2/.test(c.s)) {
    let a = named(c, 'a');
    let b = named(c, 'b');
    let cc = named(c, 'c');
    let d = named(c, 'd');
    const frac2 = [...c.s.matchAll(/(\d+)\s*(?:\/|out of|of)\s*(\d+)/g)];
    if ((a === null || b === null || cc === null || d === null) && frac2.length >= 2) {
      const [e1, n1, e2, n2] = [num(frac2[0]![1]!), num(frac2[0]![2]!), num(frac2[1]![1]!), num(frac2[1]![2]!)];
      [a, b, cc, d] = [e1, n1 - e1, e2, n2 - e2];
    }
    if (a === null || b === null || cc === null || d === null) return need(c, Md, 'Give the 2×2 table (a, b, c, d) or "exposed 30/100, unexposed 10/100"');
    const rr = a / (a + b) / (cc / (cc + d));
    const or = (a * d) / (b * cc);
    const se = Math.sqrt(1 / a + 1 / b + 1 / cc + 1 / d);
    const lines: [string, string][] = [['Risk (exposed)', pct(a / (a + b))], ['Risk (unexposed)', pct(cc / (cc + d))], ['Relative risk', show(rr)], ['Odds ratio', show(or)], ['OR 95% CI (Woolf)', `${show(Math.exp(Math.log(or) - 1.96 * se))} – ${show(Math.exp(Math.log(or) + 1.96 * se))}`], ['Risk difference', pct(a / (a + b) - cc / (cc + d))]];
    const wantOR = /odds/.test(c.s);
    return res(c, { kind: Md, expression: wantOR ? 'Odds ratio' : 'Relative risk', value: wantOR ? or : rr, formula: wantOR ? 'OR = ad/(bc)' : 'RR = [a/(a+b)] / [c/(c+d)]', lines, table: { columns: ['', 'Outcome +', 'Outcome −'], rows: [['Exposed', show(a), show(b)], ['Unexposed', show(cc), show(d)]] }, notes: [MEDICAL_NOTE] });
  }
  return null;
};

// ─────────────── epidemiology & biology ───────────────
function sir(beta: number, gamma: number, N: number, I0: number, days: number, sigma?: number) {
  let S = N - I0;
  let Ex = 0;
  let I = I0;
  let Rr = 0;
  const h = 0.01;
  let peak = I;
  let peakDay = 0;
  const steps = Math.round(days / h);
  const f = (s: number, e: number, i: number) => {
    const inf = (beta * s * i) / N;
    return sigma ? [-inf, inf - sigma * e, sigma * e - gamma * i, gamma * i] : [-inf, 0, inf - gamma * i, gamma * i];
  };
  for (let k = 0; k < steps; k++) {
    const k1 = f(S, Ex, I);
    const k2 = f(S + (h / 2) * k1[0]!, Ex + (h / 2) * k1[1]!, I + (h / 2) * k1[2]!);
    const k3 = f(S + (h / 2) * k2[0]!, Ex + (h / 2) * k2[1]!, I + (h / 2) * k2[2]!);
    const k4 = f(S + h * k3[0]!, Ex + h * k3[1]!, I + h * k3[2]!);
    S += (h / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!);
    Ex += (h / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!);
    I += (h / 6) * (k1[2]! + 2 * k2[2]! + 2 * k3[2]! + k4[2]!);
    Rr += (h / 6) * (k1[3]! + 2 * k2[3]! + 2 * k3[3]! + k4[3]!);
    if (I > peak) [peak, peakDay] = [I, (k + 1) * h];
  }
  return { S, E: Ex, I, R: Rr, peak, peakDay };
}
const epi: Handler = (c) => {
  if (/herd immunity/.test(c.s)) {
    const R0 = named(c, 'r0|r₀|r_0|r naught|basic reproduction number|reproduction number');
    if (R0 === null) return need(c, B, 'What is R₀?');
    if (R0 <= 1) return res(c, { kind: B, expression: 'Herd immunity threshold', value: 0, display: '0% (R₀ ≤ 1: no sustained spread)', formula: 'HIT = 1 − 1/R₀' });
    const eff = namedFrac(c, 'efficacy|effectiveness|vaccine efficacy');
    const h = 1 - 1 / R0;
    const lines: [string, string][] = [];
    if (eff !== null) lines.push(['Vaccination coverage needed', h / eff > 1 ? 'over 100%: not reachable by vaccination alone' : pct(h / eff)]);
    return res(c, { kind: B, expression: `Herd immunity threshold, R₀ = ${show(R0)}`, value: h, display: pct(h), formula: 'HIT = 1 − 1/R₀', lines, notes: ['Homogeneous mixing, lasting immunity'] });
  }
  if (/final (?:epidemic )?size|attack rate.*r0|final size/.test(c.s)) {
    const R0 = named(c, 'r0|r₀|r_0|r naught');
    if (R0 === null) return need(c, B, 'What is R₀?');
    let z = 0.5;
    for (let i = 0; i < 200; i++) z = 1 - Math.exp(-R0 * z);
    return res(c, { kind: B, expression: `Final epidemic size (SIR), R₀ = ${show(R0)}`, value: R0 <= 1 ? 0 : z, display: pct(R0 <= 1 ? 0 : z), formula: 'z = 1 − e^(−R₀z)', notes: ['Fraction of the population ever infected; no intervention'] });
  }
  if (/\bsir\b|\bseir\b|epidemic model|compartment/.test(c.s) || (/\br0\b|\br₀\b/.test(c.s) && /beta|gamma|β|γ/.test(c.s))) {
    const beta = named(c, 'β|beta|transmission rate|contact rate');
    let gamma = named(c, 'γ|gamma|recovery rate');
    const D = named(c, 'infectious period|recovery time');
    if (gamma === null && D !== null) gamma = 1 / D;
    if (beta === null || gamma === null) return need(c, B, 'An SIR model needs β (transmission rate) and γ (recovery rate, or 1/infectious period)');
    const R0 = beta / gamma;
    const N = named(c, 'population|n|total') ?? null;
    const I0 = named(c, 'i0|i₀|initial(?:ly)? infected|infected|infections?|cases?') ?? (/(\d+)\s*(?:initial(?:ly)? )?infect/.exec(c.s) ? num(/(\d+)\s*(?:initial(?:ly)? )?infect/.exec(c.s)![1]!) : 1);
    const day = named(c, 'day|days|t|after|at day') ?? (/(?:day|after)\s*(\d+)/.exec(c.s) ? num(/(?:day|after)\s*(\d+)/.exec(c.s)![1]!) : null);
    const sigma = /seir/.test(c.s) ? named(c, 'σ|sigma|incubation rate') ?? (named(c, 'incubation(?: period)?') ? 1 / named(c, 'incubation(?: period)?')! : null) : undefined;
    if (/seir/.test(c.s) && (sigma === null || sigma === undefined)) return need(c, B, 'An SEIR model also needs σ (1/incubation period)');
    if (N === null || day === null) return res(c, { kind: B, expression: 'Basic reproduction number', value: R0, formula: 'R₀ = β/γ', lines: [['Herd immunity threshold', R0 > 1 ? pct(1 - 1 / R0) : '0%'], ['Mean infectious period', withUnit(1 / gamma, 'days')]], notes: ['Give a population and a day (e.g. "population 1000, 1 infected, day 50") to run the model'] });
    const r = sir(beta, gamma, N, I0, day, sigma ?? undefined);
    const full = sir(beta, gamma, N, I0, Math.max(day, 2000), sigma ?? undefined);
    return res(c, {
      kind: B,
      expression: `${sigma ? 'SEIR' : 'SIR'} model: β = ${show(beta)}, γ = ${show(gamma)}${sigma ? `, σ = ${show(sigma)}` : ''}, N = ${show(N)}, day ${show(day)}`,
      value: r.I,
      display: `${show(r.I)} infected on day ${show(day)}`,
      formula: sigma ? "S' = −βSI/N, E' = βSI/N − σE, I' = σE − γI, R' = γI" : "S' = −βSI/N, I' = βSI/N − γI, R' = γI",
      table: { columns: ['Compartment', `Day ${show(day)}`], rows: [['Susceptible', show(r.S)], ...(sigma ? [['Exposed', show(r.E)]] : []), ['Infected', show(r.I)], ['Recovered', show(r.R)]] },
      lines: [['R₀', show(R0)], ['Peak infected', `${show(full.peak)} on day ${show(full.peakDay, 3)}`], ['Final size (ever infected)', pct(full.R / N)]],
      notes: ['RK4 integration, step 0.01 day; closed population, rates per day'],
    });
  }
  return null;
};

const genetics: Handler = (c) => {
  if (/hardy|weinberg/.test(c.s)) {
    let p = named(c, 'p');
    let q = named(c, 'q');
    const rec = namedFrac(c, 'recessive(?: phenotype)?|affected|homozygous recessive|q2|q²|aa');
    const carriers = /carrier/.test(c.s);
    if (p === null && q === null && rec !== null) q = Math.sqrt(rec);
    if (p === null && q !== null) p = 1 - q;
    if (q === null && p !== null) q = 1 - p;
    if (p === null || q === null) return need(c, B, 'Hardy–Weinberg needs p, q, or the recessive phenotype frequency (q²)');
    if (p < 0 || q < 0 || Math.abs(p + q - 1) > 1e-9) return need(c, B, 'Allele frequencies must satisfy p + q = 1');
    const rows = [['AA (p²)', show(p * p), pct(p * p)], ['Aa (2pq)', show(2 * p * q), pct(2 * p * q)], ['aa (q²)', show(q * q), pct(q * q)]];
    return res(c, { kind: B, expression: `Hardy–Weinberg equilibrium, p = ${show(p)}, q = ${show(q)}`, value: carriers ? 2 * p * q : q * q, display: carriers ? `Carriers (2pq) ${pct(2 * p * q)}` : `p² = ${show(p * p)}, 2pq = ${show(2 * p * q)}, q² = ${show(q * q)}`, formula: 'p² + 2pq + q² = 1', table: { columns: ['Genotype', 'Frequency', 'Percent'], rows }, notes: ['Random mating, no selection, mutation, migration or drift'] });
  }
  const cross = /\b([A-Za-z]{2,8})\s*(?:x|×|\*|cross(?:ed)?(?: with)?)\s*([A-Za-z]{2,8})\b/.exec(c.t);
  if (cross && (/punnett|cross|offspring|genotype|phenotype|probability|ratio/.test(c.s) || /^[A-Za-z]{2,8}\s*[x×]\s*[A-Za-z]{2,8}$/.test(c.t.trim()))) {
    const [p1, p2] = [cross[1]!, cross[2]!];
    if (p1.length !== p2.length || p1.length % 2 || p1.length > 6) return null;
    const genes = p1.length / 2;
    for (let g = 0; g < genes; g++) {
      const letters = new Set([...p1.slice(2 * g, 2 * g + 2), ...p2.slice(2 * g, 2 * g + 2)].map((x) => x.toLowerCase()));
      if (letters.size !== 1) return null;
    }
    const gametes = (p: string): string[] => {
      let out = [''];
      for (let g = 0; g < genes; g++) out = out.flatMap((pre) => [pre + p[2 * g], pre + p[2 * g + 1]]);
      return out;
    };
    const g1 = gametes(p1);
    const g2 = gametes(p2);
    const norm = (a: string, b: string) => Array.from({ length: genes }, (_, g) => [a[g]!, b[g]!].sort((x, y) => (x === y ? 0 : x === x.toUpperCase() ? -1 : 1)).join('')).join('');
    const geno = new Map<string, number>();
    const pheno = new Map<string, number>();
    for (const a of g1) for (const b of g2) {
      const k = norm(a, b);
      geno.set(k, (geno.get(k) ?? 0) + 1);
      const ph = Array.from({ length: genes }, (_, g) => (/[A-Z]/.test(k.slice(2 * g, 2 * g + 2)) ? k[2 * g]!.toUpperCase() + '_' : k.slice(2 * g, 2 * g + 2))).join(' ');
      pheno.set(ph, (pheno.get(ph) ?? 0) + 1);
    }
    const tot = g1.length * g2.length;
    const want = /(?:probability|chance|fraction|percent)\s*(?:of|that|for)?\s*(?:an?\s+)?(?:offspring\s+)?(?:is\s+|being\s+)?([A-Za-z]{2,8})\b/.exec(c.t);
    const grid = { caption: 'Punnett square', columns: ['', ...g2], rows: g1.map((a) => [a, ...g2.map((b) => norm(a, b))]) };
    const phenoRatio = [...pheno.entries()].sort((a, b) => b[1] - a[1]);
    const lines: [string, string][] = [['Genotypes', [...geno.entries()].map(([k, n]) => `${k} ${n}/${tot}`).join(', ')], ['Phenotype ratio', phenoRatio.map(([, n]) => n).join(':') + ` (${phenoRatio.map(([k]) => k).join(', ')})`]];
    if (want && want[1]!.length === p1.length) {
      const w = want![1]!;
      const key = Array.from({ length: genes }, (_, g) => [w[2 * g]!, w[2 * g + 1]!].sort((x, y) => (x === y ? 0 : x === x.toUpperCase() ? -1 : 1)).join('')).join('');
      const n = geno.get(key) ?? 0;
      return res(c, { kind: B, expression: `P(${w}) from ${p1} × ${p2}`, value: n / tot, display: `${n}/${tot} = ${pct(n / tot)}`, table: grid, lines, notes: ['Independent assortment, complete dominance'] });
    }
    return res(c, { kind: B, expression: `Cross ${p1} × ${p2}`, display: `Phenotypes ${phenoRatio.map(([, n]) => n).join(':')}`, table: grid, lines, notes: ['Independent assortment, complete dominance (uppercase dominant)'] });
  }
  return null;
};

const growth: Handler = (c) => {
  if (/michaelis|menten|\bvmax\b|\bkm\b.*substrate/.test(c.s)) {
    const Vmax = named(c, 'vmax|v_max');
    const Km = named(c, 'km|k_m');
    const S = named(c, '\\[s\\]|s|substrate(?: concentration)?');
    if (Vmax === null || Km === null || S === null) return need(c, B, 'Michaelis–Menten needs Vmax, Km and [S]');
    return res(c, { kind: B, expression: 'Michaelis–Menten reaction rate', value: (Vmax * S) / (Km + S), formula: 'v = Vmax[S]/(Km + [S])', lines: [['Fraction of Vmax', pct(S / (Km + S))]], notes: ['Same concentration units for Km and [S]; v in Vmax’s units'] });
  }
  if (/logistic/.test(c.s)) {
    const N0 = named(c, 'n0|n₀|initial(?: population)?|p0|starting');
    const Kc = named(c, 'k|carrying capacity|capacity');
    const r = namedFrac(c, 'r|growth rate|rate');
    const t = named(c, 't|time|after|years|days') ?? (/after\s*(\d+(?:\.\d+)?)/.exec(c.s) ? num(/after\s*(\d+(?:\.\d+)?)/.exec(c.s)![1]!) : null);
    if (N0 === null || Kc === null || r === null || t === null) return need(c, B, 'Logistic growth needs N₀, K, r and t');
    const rr = /r\s*(?:=|:)?\s*\d+(?:\.\d+)?\s*%/.test(c.s) ? r : named(c, 'r|growth rate|rate')!;
    const N = Kc / (1 + ((Kc - N0) / N0) * Math.exp(-rr * t));
    return res(c, { kind: B, expression: `Logistic growth at t = ${show(t)}`, value: N, formula: 'N(t) = K / (1 + ((K − N₀)/N₀)e^(−rt))', lines: [['Fraction of K', pct(N / Kc)], ['Fastest growth at N = K/2, t', show(Math.log((Kc - N0) / N0) / rr)]] });
  }
  if (/doubling time|rule of 70|rule of 72/.test(c.s) && !/money|invest|\$|interest|loan/.test(c.s)) {
    const r = namedFrac(c, 'r|growth rate|rate|growth') ?? (new RegExp(String.raw`(${NUM})\s*%`).exec(c.s) ? num(new RegExp(String.raw`(${NUM})\s*%`).exec(c.s)![1]!) / 100 : null);
    if (r === null) return need(c, B, 'What growth rate?');
    const cont = /continuous|e\^|exponential/.test(c.s);
    const td = cont ? Math.LN2 / r : Math.LN2 / Math.log(1 + r);
    return res(c, { kind: B, expression: `Doubling time at ${pct(r)} growth${cont ? ' (continuous)' : ' per period'}`, value: td, unit: 'periods', formula: cont ? 'T = ln 2 / r' : 'T = ln 2 / ln(1 + r)', lines: [['Rule of 70', show(0.7 / r)]] });
  }
  if (/(?:exponential|population|bacteria|cells|culture) (?:growth|grows|doubles)|bacteria|population grows|grows (?:at|by)/.test(c.s) && /after|in \d|t\s*=|hours|days|years|generations/.test(c.s)) {
    const N0 = named(c, 'n0|n₀|initial(?: population)?|starting|start(?:s)? with') ?? (/(?:of|with)\s*(\d[\d,.e]*)\s*(?:bacteria|cells|people|organisms|individuals)/.exec(c.s) ? num(/(?:of|with)\s*(\d[\d,.e]*)\s*(?:bacteria|cells|people|organisms|individuals)/.exec(c.s)![1]!) : null);
    const dbl = lab(c, 'time', /doubl|generation time|every/);
    const t = ofDim(c, 'time').find((x) => x !== dbl);
    const r = named(c, 'r|growth rate|rate') ?? null;
    if (N0 === null || !t) return need(c, B, 'Exponential growth needs the starting population and the time');
    if (dbl) {
      const n = t.v / dbl.v;
      return res(c, { kind: B, expression: `Growth by doubling every ${dbl.raw}`, value: N0 * 2 ** n, formula: 'N = N₀ · 2^(t/T_d)', lines: [['Doublings', show(n)]] });
    }
    if (r === null) return need(c, B, 'What growth rate r (or doubling time)?');
    const pctR = new RegExp(String.raw`(?:r|growth rate|rate)\s*(?:=|:|of)?\s*${NUM}\s*%`).test(c.s) ? r / 100 : r;
    const tt = num(t.raw.replace(/[^\d.e+-]/g, ''));
    return res(c, { kind: B, expression: `Exponential growth N₀ = ${show(N0)}, r = ${show(pctR)}, t = ${show(tt)}`, value: N0 * Math.exp(pctR * tt), formula: 'N = N₀e^(rt)', notes: ['Continuous growth; r per unit of t'] });
  }
  return null;
};

export const medical: Handler[] = [bmi, bmr, bsa, ibw, crcl, diagnostic, risk, pk, dosing, epi, genetics, growth];
export { frac };
