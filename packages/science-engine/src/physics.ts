import { D, type AnswerResult, type Dec } from '@lemma/math-core';
import { CONST } from './constants';
import { quantities, SI, unitDim, type Dim, type Qty } from './quantities';
import { disp, fail, need, NUM, num, ok, prim, type Ctx } from './util';

interface Var {
  sym: string;
  /** How the variable is written in formulas and answers. */
  label: string;
  dim: Dim;
  /** Phrase(s) that label a value: "mass", "height". Regex source. */
  words?: string;
  /** Extra names accepted in "x = 5" assignments (lowercase). */
  aliases?: string[];
  /** Spoken/needed name: "the mass". */
  name: string;
}

interface Gathered {
  known: Map<string, Dec>;
  notes: string[];
  error?: string;
}

const G0 = CONST.g0;

/**
 * Assigns the numbers in a sentence to a formula's variables: explicit "m = 5 kg", then labels ("mass of 5 kg"),
 * then by unit dimension when only one variable of that dimension is still open.
 */
function gather(c: Ctx, vars: Var[], preset: Map<string, Dec> = new Map(), exclude: Qty[] = []): Gathered {
  const qs = quantities(c).filter((q) => !exclude.some((e) => e.index === q.index));
  const used = new Set<Qty>();
  const known = new Map(preset);
  const notes: string[] = [];
  let unitless = false;
  let error: string | undefined;

  const valueAt = (pos: number, v: Var, strict: boolean): Dec | null => {
    const q = qs.find((x) => x.index === pos && !used.has(x));
    if (q) {
      if (q.dim !== v.dim) {
        if (!strict) return null;
        error = `${q.raw.trim()} isn't a ${v.name.replace(/^the /, '')} (expected ${SI[v.dim][0]})`;
        return null;
      }
      used.add(q);
      return q.si;
    }
    const m = new RegExp(`^[-+]?${NUM}`).exec(c.s.slice(pos));
    if (!m) return null;
    // A unit we don't recognise for this quantity ("5 parsecs") shouldn't silently become SI.
    const tail = /^\s*([a-zµ°Ω/²³^]+)/i.exec(c.t.slice(pos + m[0].length));
    if (tail && unitDim(tail[1]!) && unitDim(tail[1]!)![0] !== v.dim) {
      if (!strict) return null;
      error = `${m[0]} ${tail[1]} isn't a ${v.name.replace(/^the /, '')}`;
      return null;
    }
    unitless = true;
    return num(m[0]);
  };

  // 1. Explicit assignments.
  for (const v of vars) {
    if (known.has(v.sym)) continue;
    const names = [v.sym.toLowerCase(), ...(v.aliases ?? [])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?<![\\w])(?:${names.join('|')})\\s*(?:=|:)\\s*`, 'g');
    for (const m of c.s.matchAll(re)) {
      const val = valueAt(m.index! + m[0].length, v, true);
      if (val) {
        known.set(v.sym, val);
        break;
      }
    }
  }
  // 2. Labelled values: "mass of 5 kg", "height 10 m".
  for (const v of vars) {
    if (known.has(v.sym) || !v.words) continue;
    const re = new RegExp(`\\b(?:${v.words})\\b(?:\\s+(?:of|is|was|equals|=|:|at|about|around|approximately|a|an))*\\s*(?=[-+.\\d])`, 'g');
    for (const m of c.s.matchAll(re)) {
      const val = valueAt(m.index! + m[0].length, v, false);
      if (val) {
        known.set(v.sym, val);
        break;
      }
    }
  }
  // 3. Remaining quantities by dimension.
  for (const q of qs) {
    if (used.has(q)) continue;
    const open = vars.filter((v) => v.dim === q.dim && !known.has(v.sym));
    if (open.length === 1) {
      known.set(open[0]!.sym, q.si);
      used.add(q);
    }
  }
  if (unitless) notes.push('Values given without units were taken as SI (kg, m, s, N, J, W, V, A, Ω)');
  return { known, notes, error };
}

const fmtVar = (v: Var, x: Dec) => `${v.label} = ${disp(x)} ${SI[v.dim][0]}`.replace(/ °$/, '°');

function extraLines(dim: Dim, x: Dec): { label: string; display: string }[] {
  if (dim === 'velocity') return [{ label: 'km/h', display: disp(x.mul('3.6')) }];
  if (dim === 'energy' && x.abs().gte(1000)) return [{ label: 'kJ', display: disp(x.div(1000)) }];
  if (dim === 'force') return [{ label: 'kgf', display: disp(x.div(G0)) }];
  return [];
}

// ---------- single-term formulas: y = k · Π xᵢ^eᵢ ----------
interface Monomial {
  title: string;
  trigger: (c: Ctx, qs: Qty[]) => boolean;
  lhs: Var;
  coef: Dec;
  factors: [Var, number][];
  formula: string;
  /** Rearranged forms by variable symbol. */
  solved: Record<string, string>;
  /** Variables with a standard default (g). */
  defaults?: Record<string, [Dec, string]>;
  extra?: (known: Map<string, Dec>, c: Ctx) => { set?: [string, Dec]; note?: string } | null;
}

const V = {
  m: { sym: 'm', label: 'm', dim: 'mass', words: 'mass|weighing|weighs|of mass', name: 'the mass' },
  v: { sym: 'v', label: 'v', dim: 'velocity', words: 'velocity|speed|moving at|travell?ing at|going', name: 'the speed' },
  h: { sym: 'h', label: 'h', dim: 'length', words: 'height|high|raised|lifted|elevation|altitude|drop of', name: 'the height' },
  g: { sym: 'g', label: 'g', dim: 'accel', words: 'gravity|gravitational acceleration|g', name: 'g' },
  a: { sym: 'a', label: 'a', dim: 'accel', words: 'acceleration|accelerat(?:es|ing) at|decelerat(?:es|ing) at', name: 'the acceleration' },
} satisfies Record<string, Var>;

const MONOMIALS: Monomial[] = [
  {
    title: 'Kinetic energy',
    trigger: (c) => /kinetic energy|\bke\b|\bk\.e\.|\be_?k\s*=/.test(c.s),
    lhs: { sym: 'E', label: 'KE', dim: 'energy', words: 'kinetic energy|ke|energy', aliases: ['ke', 'ek', 'e_k', 'e'], name: 'the kinetic energy' },
    coef: new D('0.5'),
    factors: [[V.m, 1], [V.v, 2]],
    formula: 'KE = ½mv²',
    solved: { E: 'KE = ½mv²', m: 'm = 2·KE / v²', v: 'v = √(2·KE / m)' },
  },
  {
    title: 'Gravitational potential energy',
    trigger: (c) => /potential energy|\bgpe\b|\bpe\b|\bg\.?p\.?e\.|\be_?p\s*=/.test(c.s),
    lhs: { sym: 'E', label: 'PE', dim: 'energy', words: 'potential energy|gpe|pe|energy', aliases: ['pe', 'gpe', 'ep', 'e_p', 'e'], name: 'the potential energy' },
    coef: new D(1),
    factors: [[V.m, 1], [V.g, 1], [V.h, 1]],
    formula: 'PE = mgh',
    solved: { E: 'PE = mgh', m: 'm = PE / (gh)', g: 'g = PE / (mh)', h: 'h = PE / (mg)' },
    defaults: { g: [G0, 'g = 9.80665 m/s² (standard gravity)'] },
  },
  {
    title: 'Momentum',
    trigger: (c) => /momentum|\bp\s*=\s*mv\b/.test(c.s),
    lhs: { sym: 'p', label: 'p', dim: 'momentum', words: 'momentum', aliases: ['p'], name: 'the momentum' },
    coef: new D(1),
    factors: [[V.m, 1], [V.v, 1]],
    formula: 'p = mv',
    solved: { p: 'p = mv', m: 'm = p / v', v: 'v = p / m' },
  },
  {
    title: 'Weight',
    trigger: (c) => /\bweigh(?:t|s|ing)?\b/.test(c.s) && !/(?:atomic|molecular|formula|molar) weight/.test(c.s) && !/\b(?:force|accelerat)/.test(c.s),
    lhs: { sym: 'W', label: 'W', dim: 'force', words: 'weight|weighs|weighing', aliases: ['w', 'fg', 'f_g'], name: 'the weight' },
    coef: new D(1),
    factors: [[{ ...V.m, words: 'mass|of mass' }, 1], [V.g, 1]],
    formula: 'W = mg',
    solved: { W: 'W = mg', m: 'm = W / g', g: 'g = W / m' },
    defaults: { g: [G0, 'g = 9.80665 m/s² (standard gravity)'] },
  },
  {
    title: 'Force',
    trigger: (c, qs) => /\bforce\b|\bf\s*=\s*ma\b|newton'?s second law/.test(c.s) || (qs.some((q) => q.dim === 'force') && qs.some((q) => q.dim === 'mass' || q.dim === 'accel') && !/\bweigh/.test(c.s)),
    lhs: { sym: 'F', label: 'F', dim: 'force', words: 'net force|force|pushed with|pulled with', aliases: ['f'], name: 'the force' },
    coef: new D(1),
    factors: [[V.m, 1], [V.a, 1]],
    formula: 'F = ma',
    solved: { F: 'F = ma', m: 'm = F / a', a: 'a = F / m' },
  },
  {
    title: 'Wave speed',
    trigger: (c) => /\bwave|wavelength|frequency|λ|lambda/.test(c.s),
    lhs: { sym: 'v', label: 'v', dim: 'velocity', words: 'wave speed|speed|velocity', aliases: ['v', 'c'], name: 'the wave speed' },
    coef: new D(1),
    factors: [[{ sym: 'f', label: 'f', dim: 'frequency', words: 'frequency', aliases: ['f', 'nu', 'ν'], name: 'the frequency' }, 1], [{ sym: 'λ', label: 'λ', dim: 'length', words: 'wavelength|lambda|λ', aliases: ['λ', 'lambda', 'l'], name: 'the wavelength' }, 1]],
    formula: 'v = fλ',
    solved: { v: 'v = fλ', f: 'f = v / λ', λ: 'λ = v / f' },
    extra: (known, c) =>
      !known.has('v') && /\b(?:light|electromagnetic|em wave|photons?|radio|microwaves?|x-?rays?|gamma|infrared|ultraviolet|uv|visible)\b/.test(c.s)
        ? { set: ['v', CONST.c], note: 'Electromagnetic wave in vacuum: v = c = 299,792,458 m/s' }
        : null,
  },
  {
    title: 'Density',
    trigger: (c) => /\bdensity\b|ρ|\brho\b/.test(c.s),
    lhs: { sym: 'ρ', label: 'ρ', dim: 'density', words: 'density', aliases: ['ρ', 'rho', 'd'], name: 'the density' },
    coef: new D(1),
    factors: [[V.m, 1], [{ sym: 'V', label: 'V', dim: 'volume', words: 'volume', aliases: ['v', 'vol'], name: 'the volume' }, -1]],
    formula: 'ρ = m / V',
    solved: { ρ: 'ρ = m / V', m: 'm = ρV', V: 'V = m / ρ' },
  },
];

function monomial(c: Ctx, f: Monomial): AnswerResult | null {
  const qs = quantities(c);
  if (!f.trigger(c, qs)) return null;
  const vars = [f.lhs, ...f.factors.map(([v]) => v)];
  const g = gather(c, vars);
  if (g.error) return fail(c, 'physics', g.error);
  const known = g.known;
  const notes = [...g.notes];
  const ex = f.extra?.(known, c);
  if (ex?.set) known.set(ex.set[0], ex.set[1]);
  if (ex?.note) notes.push(ex.note);
  let unknown = vars.filter((v) => !known.has(v.sym));
  if (unknown.length > 1 && f.defaults) {
    for (const [sym, [val, note]] of Object.entries(f.defaults)) {
      if (!known.has(sym)) {
        known.set(sym, val);
        notes.push(note);
      }
    }
    unknown = vars.filter((v) => !known.has(v.sym));
  }
  if (unknown.length === 0) return null;
  if (unknown.length > 1) {
    const target = unknown.includes(f.lhs) ? f.lhs : unknown[0]!;
    const rest = unknown.filter((v) => v !== target);
    return need(c, 'physics', `${f.title} (${f.formula}): what is ${rest.map((v) => `${v.name} (${v.label})`).join(' and ')}?`);
  }
  const x = unknown[0]!;
  let value: Dec;
  if (x === f.lhs) {
    value = f.coef;
    for (const [v, e] of f.factors) {
      const k = known.get(v.sym)!;
      if (e < 0 && k.isZero()) return fail(c, 'physics', `Can't compute ${f.lhs.name.replace(/^the /, '')}: ${v.name.replace(/^the /, '')} is zero, which would divide by zero`);
      value = value.mul(k.pow(e));
    }
  } else {
    const e = f.factors.find(([v]) => v === x)![1];
    let rest = f.coef;
    for (const [v, ee] of f.factors) if (v !== x) rest = rest.mul(known.get(v.sym)!.pow(ee));
    if (rest.isZero()) return fail(c, 'physics', `Can't solve for ${x.label}: that would divide by zero`);
    const ratio = known.get(f.lhs.sym)!.div(rest);
    if (e === 2) {
      if (ratio.isNegative()) return fail(c, 'physics', `No real ${x.name.replace(/^the /, '')} gives that result`);
      value = ratio.sqrt();
    } else value = e === 1 ? ratio : ratio.pow(1 / e);
  }
  const [unit, spoken] = SI[x.dim];
  const given = vars.filter((v) => v !== x).map((v) => fmtVar(v, known.get(v.sym)!));
  return ok(c, {
    kind: 'physics',
    expression: `${f.title} · ${x === f.lhs ? '' : `solve for ${x.label} · `}${given.join(', ')}`,
    primary: prim(value, unit, spoken),
    value,
    lines: [{ label: 'Formula', display: f.solved[x.sym] ?? f.formula }, ...given.map((d) => ({ label: 'Given', display: d })), ...extraLines(x.dim, value)],
    notes: [...notes, 'SI units'],
  });
}

export const monomialHandlers = MONOMIALS.map((f) => (c: Ctx) => monomial(c, f));

// ---------- Ohm's law and electrical power ----------
const EV = {
  V: { sym: 'V', label: 'V', dim: 'voltage', words: 'voltage|potential difference|p\\.d\\.|emf', aliases: ['v', 'u'], name: 'the voltage' },
  I: { sym: 'I', label: 'I', dim: 'current', words: 'current', aliases: ['i'], name: 'the current' },
  R: { sym: 'R', label: 'R', dim: 'resistance', words: 'resistance|resistor', aliases: ['r'], name: 'the resistance' },
  P: { sym: 'P', label: 'P', dim: 'power', words: 'power|wattage', aliases: ['p'], name: 'the power' },
} satisfies Record<string, Var>;

export function electrical(c: Ctx): AnswerResult | null {
  const qs = quantities(c);
  const elecQ = qs.filter((q) => q.dim === 'voltage' || q.dim === 'current' || q.dim === 'resistance');
  const assigns = [...c.s.matchAll(/(?<![\w])([virp])\s*=\s*[-+.\d]/g)].map((m) => m[1]);
  const byAssign = assigns.length >= 2 && assigns.some((x) => x === 'i' || x === 'r');
  if (!/ohm'?s law|\bvoltage\b|\bcurrent\b|\bresist(?:ance|or)\b|electric(?:al)? power|\bv\s*=\s*ir\b|\bp\s*=\s*(?:vi|iv|i²r|i\^2r|v²\/r)/.test(c.s) && elecQ.length === 0 && !byAssign) return null;
  const vars = [EV.V, EV.I, EV.R, EV.P];
  const g = gather(c, vars);
  if (g.error) return fail(c, 'physics', g.error);
  const k = g.known;
  // "current time", "voltage of a AA battery": no numbers given, so this isn't a circuit calculation.
  if (k.size === 0 && !/\d/.test(c.s)) return null;
  if (k.size < 2) {
    const miss = vars.filter((v) => !k.has(v.sym));
    return need(c, 'physics', `Ohm's law needs two of voltage, current, resistance and power; what ${k.size ? 'else' : ''} do you know? (missing ${miss.map((v) => v.label).join(', ')})`.replace('what  do', 'what do'));
  }
  if (k.size > 2) return null;
  let Vv = k.get('V');
  let I = k.get('I');
  let R = k.get('R');
  let P = k.get('P');
  let formula: string;
  const zero = [Vv, I, R, P].some((x) => x?.isZero());
  if (zero) return fail(c, 'physics', 'Values must be non-zero to solve the circuit');
  if (Vv && I) {
    R = Vv.div(I);
    P = Vv.mul(I);
    formula = 'R = V / I, P = VI';
  } else if (Vv && R) {
    I = Vv.div(R);
    P = Vv.pow(2).div(R);
    formula = 'I = V / R, P = V² / R';
  } else if (Vv && P) {
    I = P.div(Vv);
    R = Vv.pow(2).div(P);
    formula = 'I = P / V, R = V² / P';
  } else if (I && R) {
    Vv = I.mul(R);
    P = I.pow(2).mul(R);
    formula = 'V = IR, P = I²R';
  } else if (I && P) {
    Vv = P.div(I);
    R = P.div(I.pow(2));
    formula = 'V = P / I, R = P / I²';
  } else {
    Vv = P!.mul(R!).sqrt();
    I = P!.div(R!).sqrt();
    formula = 'V = √(PR), I = √(P / R)';
  }
  const all: Record<string, Dec> = { V: Vv!, I: I!, R: R!, P: P! };
  const missing = vars.filter((v) => !k.has(v.sym));
  const askWords: [string, RegExp][] = [['V', /\bvoltage|volts?\b|potential difference/], ['I', /\bcurrent|amps?\b|amperes?/], ['R', /\bresistance|ohms?\b|resistor/], ['P', /\bpower|watts?\b|wattage/]];
  const asked = askWords
    .filter(([sym]) => missing.some((m) => m.sym === sym))
    .map(([sym, re]) => [sym, re.exec(c.s)?.index ?? Infinity] as const)
    .sort((a, b) => a[1] - b[1])
    .find(([, i]) => i < Infinity)?.[0];
  const target = vars.find((v) => v.sym === (asked ?? missing[0]!.sym))!;
  const [unit, spoken] = SI[target.dim];
  return ok(c, {
    kind: 'physics',
    expression: `${target.sym === 'P' ? 'Electrical power' : "Ohm's law"} · ${vars.filter((v) => k.has(v.sym)).map((v) => fmtVar(v, k.get(v.sym)!)).join(', ')}`,
    primary: prim(all[target.sym]!, unit, spoken),
    value: all[target.sym]!,
    lines: [
      { label: 'Formula', display: `V = IR, P = VI → ${formula}` },
      ...vars.map((v) => ({ label: v.name.replace(/^the /, '').replace(/^./, (x) => x.toUpperCase()), display: `${disp(all[v.sym]!)} ${SI[v.dim][0]}` })),
    ],
    notes: [...g.notes, 'DC (or RMS AC with a purely resistive load)'],
  });
}

// ---------- SUVAT ----------
type S = 's' | 'u' | 'v' | 'a' | 't';
const SV: Record<S, Var> = {
  s: { sym: 's', label: 's', dim: 'length', words: 'displacement|distance|travels|travelled|traveled|covers|covered|drives|drove|walks|walked|falls|drops|over', aliases: ['s', 'd', 'x'], name: 'the displacement' },
  u: { sym: 'u', label: 'u', dim: 'velocity', words: 'initial velocity|initial speed|starting speed|starting velocity|starts at|launched at|thrown up at', aliases: ['u', 'v0', 'vi', 'v_0', 'v_i'], name: 'the initial velocity' },
  v: { sym: 'v', label: 'v', dim: 'velocity', words: 'final velocity|final speed|reaches|top speed', aliases: ['v', 'vf', 'v_f'], name: 'the final velocity' },
  a: { sym: 'a', label: 'a', dim: 'accel', words: 'acceleration|accelerates at|accelerating at|decelerates at|decelerating at|deceleration', aliases: ['a'], name: 'the acceleration' },
  t: { sym: 't', label: 't', dim: 'time', words: 'time|for|in', aliases: ['t'], name: 'the time' },
};

export function suvat(c: Ctx): AnswerResult | null {
  const s = c.s;
  const motion = /accelerat|decelerat|from rest|initial (?:velocity|speed)|final (?:velocity|speed)|displacement|suvat|kinematic|free.?fall|dropped|\bfalls?\b|\bstops?\b|to a stop|to rest|brakes?|braking|how long|how far|how fast|distance|travel|covers|covered|drives|drove|walks|walked|reach|\bv\s*=\s*u\s*\+\s*at\b/.test(s);
  if (!motion && new Set([...s.matchAll(/(?<![\w])([suvat])\s*=\s*[-+.\d]/g)].map((m) => m[1])).size < 3) return null;
  const qs = quantities(c);
  const kin = qs.filter((q) => ['length', 'time', 'velocity', 'accel'].includes(q.dim));
  if (kin.length < 1 && !/[suvat]\s*=/.test(s)) return null;
  const preset = new Map<string, Dec>();
  const notes: string[] = [];
  const exclude: Qty[] = [];
  const dropped = /\b(?:dropped|free.?fall|falls?|released)\b/.test(s);
  if (/\bfrom rest|starts? (?:from|at) rest|starting from rest|at rest initially|\bdropped|released from rest|stationary/.test(s)) preset.set('u', new D(0));
  if (/(?:comes?|coming|brought|brings?|bring|slows?|slowing)(?: \w+)? to (?:a )?(?:stop|rest|halt|standstill)|\bstops\b|\bto a stop\b|until it stops/.test(s)) preset.set('v', new D(0));
  // "from 0 to 100 km/h": first number may borrow the unit of the second.
  const ft = new RegExp(`from\\s+([-+]?${NUM})\\s*([a-z/]*)\\s+to\\s+(?=[-+.\\d])`).exec(s);
  if (ft) {
    const q2 = qs.find((q) => q.index === ft.index + ft[0].length && q.dim === 'velocity');
    if (q2) {
      const q1 = qs.find((q) => q.index > ft.index && q.end <= q2.index);
      const factor = q2.si.div(num(/[-+]?[\d.,e]+/.exec(q2.raw)![0]));
      preset.set('u', q1 && q1.dim === 'velocity' ? q1.si : num(ft[1]!).mul(factor));
      preset.set('v', q2.si);
      exclude.push(q2);
      if (q1) exclude.push(q1);
    }
  }
  // "from 10 m/s" is the starting speed; "to 30 m/s" / "reaches 30 m/s" the final one.
  for (const q of qs) {
    if (q.dim !== 'velocity' || exclude.includes(q)) continue;
    const before = s.slice(Math.max(0, q.index - 12), q.index);
    if (/\bfrom\s*$/.test(before) && !preset.has('u')) {
      preset.set('u', q.si);
      exclude.push(q);
    } else if (/\b(?:to|reaches|reaching|until)\s*$/.test(before) && !preset.has('v')) {
      preset.set('v', q.si);
      exclude.push(q);
    }
  }
  let gravity = false;
  if (dropped && !qs.some((q) => q.dim === 'accel') && !/\ba\s*=/.test(s)) {
    preset.set('a', G0);
    gravity = true;
    notes.push('Free fall: a = g = 9.80665 m/s², downward taken as positive, no air resistance');
  }
  const g = gather(c, Object.values(SV), preset, exclude);
  if (g.error) return fail(c, 'physics', g.error);
  const k = g.known;
  notes.push(...g.notes);
  if (/decelerat|brak|slows/.test(s) && k.get('a')?.isPositive()) {
    k.set('a', k.get('a')!.neg());
    notes.push('Deceleration taken as a negative acceleration');
  }
  // One speed with no acceleration information at all: constant velocity.
  const velQ = qs.filter((q) => q.dim === 'velocity' && !exclude.includes(q));
  if (!k.has('a') && !/accelerat|decelerat|brak|stop|rest|fall|drop/.test(s) && velQ.length === 1 && !k.has('u') && !k.has('v')) {
    const vv = velQ[0]!.si;
    k.set('u', vv);
    k.set('v', vv);
    k.set('a', new D(0));
    notes.push('No acceleration mentioned: constant velocity (a = 0)');
  }
  const unknown0 = (Object.keys(SV) as S[]).filter((x) => !k.has(x));
  // "A train travels 300 km in 2.5 hours; what is its speed?": a distance and a time, nothing about acceleration,
  // asks for the average speed s/t (not for SUVAT's missing initial and final velocities).
  if (k.size === 2 && k.has('s') && k.has('t') && !/accelerat|decelerat|brak|stop|rest|fall|drop|initial|final/.test(s) && /speed|velocity|how fast|\bpace\b|\brate\b/.test(s)) {
    const avg = averageSpeed(qs, k.get('s')!, k.get('t')!);
    if (avg) {
      return ok(c, {
        kind: 'physics',
        expression: `Average speed · ${avg.distance} in ${avg.time}`,
        primary: prim(avg.value, avg.unit, avg.spoken),
        value: avg.value,
        lines: [
          { label: 'Formula', display: 'speed = distance ÷ time' },
          ...(avg.unit === 'm/s' ? [] : [{ label: 'In SI units', display: `${disp(k.get('s')!.div(k.get('t')!))} m/s` }]),
        ],
        notes: ['Average speed over the whole trip'],
      });
    }
  }
  if (k.size < 3) {
    if (velQ.length && !k.has('u') && !k.has('v')) return need(c, 'physics', `Is ${velQ[0]!.raw.trim()} the initial or the final velocity?`);
    return need(c, 'physics', `Kinematics needs three of s, u, v, a, t; missing ${unknown0.map((x) => `${SV[x].name.replace(/^the /, '')} (${x})`).join(', ')}`);
  }
  if (unknown0.length === 0) return null;
  const used: string[] = [];
  const half = new D('0.5');
  for (let pass = 0; pass < 5; pass++) {
    const missing = (Object.keys(SV) as S[]).filter((x) => !k.has(x));
    if (!missing.length) break;
    const has = (...xs: S[]) => xs.every((x) => k.has(x));
    const K = (x: S) => k.get(x)!;
    const one = (eqVars: S[]) => {
      const m = eqVars.filter((x) => !k.has(x));
      return m.length === 1 ? m[0] : null;
    };
    let progressed = false;
    const e1 = one(['v', 'u', 'a', 't']);
    const e2 = one(['s', 'u', 'v', 't']);
    const e5 = one(['v', 'u', 'a', 's']);
    const e3 = one(['s', 'u', 'a', 't']);
    try {
      if (e1 && !(e1 === 'a' && K('t').isZero()) && !(e1 === 't' && K('a').isZero())) {
        if (e1 === 'v') k.set('v', K('u').plus(K('a').mul(K('t'))));
        if (e1 === 'u') k.set('u', K('v').minus(K('a').mul(K('t'))));
        if (e1 === 'a') k.set('a', K('v').minus(K('u')).div(K('t')));
        if (e1 === 't') k.set('t', K('v').minus(K('u')).div(K('a')));
        used.push(({ v: 'v = u + at', u: 'u = v − at', a: 'a = (v − u) / t', t: 't = (v − u) / a' } as Record<string, string>)[e1]!);
        progressed = true;
      } else if (e2 && !(e2 === 't' && K('u').plus(K('v')).isZero()) && !((e2 === 'u' || e2 === 'v') && K('t').isZero())) {
        if (e2 === 's') k.set('s', K('u').plus(K('v')).mul(K('t')).div(2));
        if (e2 === 'u') k.set('u', K('s').mul(2).div(K('t')).minus(K('v')));
        if (e2 === 'v') k.set('v', K('s').mul(2).div(K('t')).minus(K('u')));
        if (e2 === 't') k.set('t', K('s').mul(2).div(K('u').plus(K('v'))));
        used.push(({ s: 's = ½(u + v)t', u: 'u = 2s/t − v', v: 'v = 2s/t − u', t: 't = 2s / (u + v)' } as Record<string, string>)[e2]!);
        progressed = true;
      } else if (e5 && !(e5 === 'a' && K('s').isZero()) && !(e5 === 's' && K('a').isZero())) {
        if (e5 === 'v' || e5 === 'u') {
          const other = e5 === 'v' ? K('u') : K('v');
          const sq = e5 === 'v' ? other.pow(2).plus(K('a').mul(2).mul(K('s'))) : other.pow(2).minus(K('a').mul(2).mul(K('s')));
          if (sq.isNegative()) return fail(c, 'physics', 'No real solution: with that acceleration the object never covers that distance');
          k.set(e5, sq.sqrt());
          notes.push(`Taking the positive root for ${e5}`);
          used.push(e5 === 'v' ? 'v = √(u² + 2as)' : 'u = √(v² − 2as)');
        }
        if (e5 === 'a') {
          k.set('a', K('v').pow(2).minus(K('u').pow(2)).div(K('s').mul(2)));
          used.push('a = (v² − u²) / 2s');
        }
        if (e5 === 's') {
          k.set('s', K('v').pow(2).minus(K('u').pow(2)).div(K('a').mul(2)));
          used.push('s = (v² − u²) / 2a');
        }
        progressed = true;
      } else if (e3 && e3 !== 't' && !(e3 === 'u' && K('t').isZero()) && !(e3 === 'a' && K('t').isZero())) {
        if (e3 === 's') k.set('s', K('u').mul(K('t')).plus(half.mul(K('a')).mul(K('t').pow(2))));
        if (e3 === 'u') k.set('u', K('s').minus(half.mul(K('a')).mul(K('t').pow(2))).div(K('t')));
        if (e3 === 'a') k.set('a', K('s').minus(K('u').mul(K('t'))).mul(2).div(K('t').pow(2)));
        used.push(({ s: 's = ut + ½at²', u: 'u = (s − ½at²) / t', a: 'a = 2(s − ut) / t²' } as Record<string, string>)[e3]!);
        progressed = true;
      } else if (has('s', 'v', 'a', 't') && !k.has('u')) {
        k.set('u', K('v').minus(K('a').mul(K('t'))));
        used.push('u = v − at');
        progressed = true;
      }
    } catch {
      return fail(c, 'physics', 'Those values are inconsistent');
    }
    if (!progressed) break;
  }
  const still = (Object.keys(SV) as S[]).filter((x) => !k.has(x));
  if (still.length) return need(c, 'physics', `Not enough information to find ${still.join(', ')}`);
  if (k.get('t')!.isNegative()) return fail(c, 'physics', 'That motion would need a negative time; check the signs of the velocities and acceleration');

  const askOrder: [S, RegExp][] = [
    ['t', /how long|\btime\b|how many seconds/],
    ['s', /how far|distance|displacement|how high/],
    ['v', /final (?:velocity|speed)|how fast|top speed|speed .*(?:hit|impact|reach)|velocity .*(?:hit|impact)|reach/],
    ['a', /\bacceleration\b|\bdeceleration\b/],
    ['u', /initial (?:velocity|speed)/],
  ];
  const asked = askOrder
    .filter(([x]) => unknown0.includes(x))
    .map(([x, re]) => [x, re.exec(s)?.index ?? Infinity] as const)
    .sort((a, b) => a[1] - b[1])
    .find(([, i]) => i < Infinity)?.[0];
  const target: S = asked ?? (['v', 's', 't', 'a', 'u'] as S[]).find((x) => unknown0.includes(x))!;
  const val = k.get(target)!;
  const [unit, spoken] = SI[SV[target].dim];
  return ok(c, {
    kind: 'physics',
    expression: `Kinematics (SUVAT) · ${(['s', 'u', 'v', 'a', 't'] as S[]).filter((x) => !unknown0.includes(x)).map((x) => fmtVar(SV[x], k.get(x)!)).join(', ')}`,
    primary: prim(val, unit, spoken),
    value: val,
    lines: [
      { label: 'Formula', display: used.join('; ') },
      ...(['s', 'u', 'v', 'a', 't'] as S[]).map((x) => ({ label: `${SV[x].name.replace(/^the /, '')} (${x})`, display: `${disp(k.get(x)!)} ${SI[SV[x].dim][0]}` })),
      ...extraLines(SV[target].dim, val),
    ],
    notes: [...notes, ...(gravity ? [] : ['Constant acceleration, SI units'])],
  });
}

/** Distance ÷ time in the units the question used (km/h, mph, m/s…), falling back to m/s. */
function averageSpeed(qs: Qty[], sSI: Dec, tSI: Dec): { value: Dec; unit: string; spoken: string; distance: string; time: string } | null {
  const lenQ = qs.find((q) => q.dim === 'length');
  const timeQ = qs.find((q) => q.dim === 'time');
  if (!lenQ || !timeQ || tSI.isZero()) return null;
  const split = (raw: string) => {
    const m = /[-+]?[\d.,]+(?:e[-+]?\d+)?/.exec(raw);
    return m ? { n: num(m[0]), unit: raw.slice(m.index + m[0].length).trim() } : null;
  };
  const L = split(lenQ.raw);
  const T = split(timeQ.raw);
  const lu = L && (/^(?:km|kilomet(?:er|re)s?)$/.test(L.unit) ? 'km' : /^(?:mi|miles?)$/.test(L.unit) ? 'mi' : /^(?:m|met(?:er|re)s?)$/.test(L.unit) ? 'm' : /^(?:ft|feet|foot)$/.test(L.unit) ? 'ft' : null);
  const tu = T && (/^(?:h|hrs?|hours?)$/.test(T.unit) ? 'h' : /^(?:min|mins|minutes?)$/.test(T.unit) ? 'min' : /^(?:s|secs?|seconds?)$/.test(T.unit) ? 's' : null);
  const named: Record<string, [string, string]> = { 'km/h': ['km/h', 'kilometres per hour'], 'mi/h': ['mph', 'miles per hour'], 'm/s': ['m/s', 'metres per second'], 'ft/s': ['ft/s', 'feet per second'], 'km/min': ['km/min', 'kilometres per minute'], 'm/min': ['m/min', 'metres per minute'], 'mi/min': ['mi/min', 'miles per minute'] };
  const pair = lu && tu ? named[`${lu}/${tu}`] : undefined;
  if (L && T && pair && !T.n.isZero()) return { value: L.n.div(T.n), unit: pair[0], spoken: pair[1], distance: lenQ.raw.trim(), time: timeQ.raw.trim() };
  return { value: sSI.div(tSI), unit: 'm/s', spoken: 'metres per second', distance: lenQ.raw.trim(), time: timeQ.raw.trim() };
}

// ---------- projectile motion ----------
export function projectile(c: Ctx): AnswerResult | null {
  const s = c.s;
  if (!/projectile|launch|thrown|throws?|throwing|fired|fires|kicked|kicks|shot|hit at|launched|cannon/.test(s)) return null;
  const qs = quantities(c);
  const angleQ = qs.find((q) => q.dim === 'angle') ?? (() => {
    const m = new RegExp(`angle\\s*(?:of|=|is)?\\s*(${NUM})`).exec(s);
    return m ? ({ dim: 'angle', si: num(m[1]!), raw: m[0], index: m.index, end: m.index + m[0].length } as Qty) : undefined;
  })();
  const speedQ = qs.find((q) => q.dim === 'velocity');
  if (!angleQ && !speedQ) return null;
  if (!speedQ) return need(c, 'physics', 'What is the launch speed? (e.g. “at 20 m/s”)');
  if (!angleQ) {
    if (/straight up|vertically|directly up/.test(s)) return projectileAnswer(c, speedQ.si, new D(90), qs);
    if (/horizontal/.test(s)) return projectileAnswer(c, speedQ.si, new D(0), qs);
    return need(c, 'physics', 'At what launch angle? (e.g. “at 45°”)');
  }
  return projectileAnswer(c, speedQ.si, angleQ.si, qs);
}

function projectileAnswer(c: Ctx, v0: Dec, angleDeg: Dec, qs: Qty[]): AnswerResult {
  if (angleDeg.lt(0) || angleDeg.gt(90)) return fail(c, 'physics', 'Launch angle should be between 0° and 90° above the horizontal');
  const heightQ = qs.find((q) => q.dim === 'length' && /(?:height|cliff|from|above|tall|high|building|tower)\b[^.]{0,20}$/.test(c.s.slice(Math.max(0, q.index - 30), q.index)));
  const h0 = heightQ?.si.toNumber() ?? 0;
  if (h0 < 0) return fail(c, 'physics', 'Launch height must be zero or positive');
  const g = G0.toNumber();
  const th = (angleDeg.toNumber() * Math.PI) / 180;
  const v = v0.toNumber();
  const vx = v * Math.cos(th);
  const vy = angleDeg.eq(90) ? v : v * Math.sin(th);
  const vxC = angleDeg.eq(90) ? 0 : vx;
  if (vy === 0 && h0 === 0) return fail(c, 'physics', 'Launched horizontally from ground level, it lands immediately; give a launch height');
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const R = vxC * T;
  const H = h0 + (vy * vy) / (2 * g);
  const tApex = vy / g;
  const impact = Math.sqrt(vxC * vxC + (vy - g * T) ** 2);
  const s = c.s;
  const order: ['range' | 'height' | 'time', RegExp][] = [
    ['range', /\brange\b|how far|distance|lands?/],
    ['height', /max(?:imum)? height|how high|peak|highest|apex/],
    ['time', /time of flight|flight time|how long|hang time|air ?time|in the air/],
  ];
  const asked = order.map(([k, re]) => [k, re.exec(s)?.index ?? Infinity] as const).sort((a, b) => a[1] - b[1]).find(([, i]) => i < Infinity)?.[0] ?? 'range';
  const prims = { range: prim(R, 'm', 'metres'), height: prim(H, 'm', 'metres'), time: prim(T, 's', 'seconds') };
  const vals = { range: R, height: H, time: T };
  const notes = ['g = 9.80665 m/s² (standard gravity); no air resistance', h0 ? `Launched from ${disp(h0)} m above the landing level` : 'Lands at the launch height (level ground)'];
  return ok(c, {
    kind: 'physics',
    expression: `Projectile · ${disp(v0)} m/s at ${disp(angleDeg)}°${h0 ? ` from ${disp(h0)} m` : ''}`,
    primary: prims[asked],
    value: new D(vals[asked]),
    lines: [
      { label: 'Range', display: `${disp(R)} m` },
      { label: 'Max height', display: `${disp(H)} m` },
      { label: 'Time of flight', display: `${disp(T)} s` },
      { label: 'Time to apex', display: `${disp(tApex)} s` },
      { label: 'Impact speed', display: `${disp(impact)} m/s` },
      { label: 'Components', display: `vₓ = ${disp(vxC)} m/s, v_y = ${disp(vy)} m/s` },
      { label: 'Formula', display: h0 ? 't = (v_y + √(v_y² + 2gh)) / g, R = vₓt, H = h + v_y² / 2g' : 'R = v² sin 2θ / g, H = v² sin²θ / 2g, t = 2v sin θ / g' },
    ],
    notes,
  });
}
