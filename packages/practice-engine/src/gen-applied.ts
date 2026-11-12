import { D, type Dec } from '@lemma/math-core';
import { gcd, money, num, trim } from './format';
import type { Rng } from './rng';
import type { Difficulty, Draft, Step } from './types';

const step = (text: string, tex?: string): Step => (tex === undefined ? { text } : { text, tex });
const cents = (x: Dec) => x.toDecimalPlaces(2, D.ROUND_HALF_UP);
const dstr = (x: Dec) => trim(x.toNumber());
/** "$85" for whole dollars, "$85.50" otherwise. */
const dollars = (x: Dec) => (x.isInteger() ? `$${x.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : money(x.toNumber()));
/** A bill amount like 84.50 with whole or quarter cents patterns that look like real receipts. */
const bill = (rng: Rng, lo: number, hi: number) => new D(rng.int(lo * 4, hi * 4)).div(4).plus(rng.pick([0, 0, 0.05, 0.1, 0.15, 0.2, 0.35, 0.4, 0.45, 0.6, 0.65, 0.8, 0.85, 0.9, 0.95].map((c) => c))).toDecimalPlaces(2);

// ---------- percent ----------

export function percent(rng: Rng, diff: Difficulty): Draft {
  if (diff === 1) {
    const p = rng.pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 75]);
    const unit = 100 / gcd(p, 100);
    const b = unit * rng.int(1, Math.max(1, Math.floor(400 / unit)));
    const r = (p * b) / 100;
    const dec = new D(p).div(100);
    return {
      prompt: `What is ${p}% of ${b}?`,
      promptTex: `${p}\\% \\text{ of } ${b}`,
      answer: { display: String(r), tex: String(r), kind: 'number' },
      steps: [step(`Write ${p}% as a decimal: ${p} ÷ 100 = ${dstr(dec)}.`), step(`Multiply: ${dstr(dec)} × ${b} = ${r}.`, `${dstr(dec)} \\times ${b} = ${r}`)],
      hint: '“Percent” means “out of 100”: divide the percent by 100, then multiply.',
    };
  }
  if (diff === 2) {
    if (rng.chance(0.5)) {
      const p = rng.pick([5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 60, 75, 80, 120, 150]);
      const unit = 100 / gcd(p, 100);
      const b = unit * rng.int(1, Math.max(1, Math.floor(300 / unit)));
      const a = (p * b) / 100;
      return {
        prompt: `${a} is what percent of ${b}?`,
        answer: { display: `${p}%`, tex: `${p}\\%`, kind: 'number' },
        steps: [step(`Divide the part by the whole: ${a} ÷ ${b} = ${trim(a / b, 4)}.`), step(`Multiply by 100 to get a percent: ${p}%.`, `${p}\\%`)],
        hint: 'Percent = part ÷ whole × 100.',
      };
    }
    const p = rng.pick([10, 20, 25, 40, 50, 60, 75]);
    const up = rng.chance(0.5);
    const unit = 100 / gcd(p, 100);
    const a = unit * rng.int(1, Math.max(1, Math.floor(200 / unit)));
    const ch = (a * p) / 100;
    const b = up ? a + ch : a - ch;
    const word = up ? 'increase' : 'decrease';
    return {
      prompt: `A price goes from $${a} to $${b}. What is the percent ${word}?`,
      answer: { display: `${p}%`, tex: `${p}\\%`, kind: 'number' },
      steps: [
        step(`Find the change: ${up ? `${b} − ${a}` : `${a} − ${b}`} = ${ch}.`),
        step(`Divide by the original amount: ${ch} ÷ ${a} = ${trim(ch / a, 4)}.`),
        step(`Multiply by 100: ${p}% ${word}.`, `${p}\\%`),
      ],
      hint: `Percent change = change ÷ original × 100.`,
    };
  }
  if (rng.chance(0.6)) {
    const p = rng.pick([10, 15, 20, 25, 30, 40]);
    const orig = new D(rng.int(4, 60) * 5);
    const keep = new D(100 - p).div(100);
    const sale = orig.mul(keep);
    return {
      prompt: `After a ${p}% discount, a jacket costs ${dollars(sale)}. What was the original price?`,
      answer: { display: dollars(orig), tex: `\\$${orig.toString()}`, kind: 'number' },
      steps: [
        step(`The sale price is ${100 - p}% of the original, so original × ${dstr(keep)} = ${dstr(sale)}.`, `x \\times ${dstr(keep)} = ${dstr(sale)}`),
        step(`Divide: ${dstr(sale)} ÷ ${dstr(keep)} = ${dstr(orig)}.`, `x = ${dstr(orig)}`),
      ],
      hint: 'Don’t add the percent back on; divide by what fraction of the price is left.',
    };
  }
  const p = rng.pick([10, 20, 25, 50]);
  const q = rng.pick([10, 20, 25, 50]);
  const net = new D(1).plus(new D(p).div(100)).mul(new D(1).minus(new D(q).div(100)));
  const pct = net.minus(1).mul(100);
  const w = pct.isNegative() ? 'decrease' : 'increase';
  return {
    prompt: `A price rises ${p}% and then falls ${q}%. What is the overall percent change? Use a negative number for a decrease.`,
    answer: { display: `${num(pct.toNumber())}%`, tex: `${pct.toString()}\\%`, kind: 'number' },
    steps: [
      step(`A ${p}% rise multiplies the price by ${dstr(new D(1).plus(p / 100))}.`),
      step(`A ${q}% fall multiplies it by ${dstr(new D(1).minus(q / 100))}.`),
      step(`Combined: ${dstr(new D(1).plus(p / 100))} × ${dstr(new D(1).minus(q / 100))} = ${dstr(net)}.`, `${dstr(net)}`),
      step(`${dstr(net)} − 1 = ${dstr(net.minus(1))}, a ${dstr(pct.abs())}% ${w}.`, `${pct.toString()}\\%`),
    ],
    hint: 'Turn each change into a multiplier and multiply them; percents don’t simply add.',
  };
}

// ---------- units ----------

interface Conv {
  from: string;
  to: string;
  sym: string;
  factor: number;
  /** Divide by the factor instead of multiplying (keeps 1/1.609344 exact). */
  div?: boolean;
  fact: string;
}

const METRIC: Conv[] = [
  { from: 'kilometers', to: 'meters', sym: 'm', factor: 1000, fact: '1 km = 1000 m' },
  { from: 'meters', to: 'centimeters', sym: 'cm', factor: 100, fact: '1 m = 100 cm' },
  { from: 'centimeters', to: 'millimeters', sym: 'mm', factor: 10, fact: '1 cm = 10 mm' },
  { from: 'kilograms', to: 'grams', sym: 'g', factor: 1000, fact: '1 kg = 1000 g' },
  { from: 'liters', to: 'milliliters', sym: 'mL', factor: 1000, fact: '1 L = 1000 mL' },
  { from: 'grams', to: 'kilograms', sym: 'kg', factor: 1000, div: true, fact: '1000 g = 1 kg' },
  { from: 'meters', to: 'kilometers', sym: 'km', factor: 1000, div: true, fact: '1000 m = 1 km' },
  { from: 'milliliters', to: 'liters', sym: 'L', factor: 1000, div: true, fact: '1000 mL = 1 L' },
];

const IMPERIAL: Conv[] = [
  { from: 'kilograms', to: 'pounds', sym: 'lb', factor: 2.20462262, fact: '1 kg ≈ 2.20462 lb' },
  { from: 'pounds', to: 'kilograms', sym: 'kg', factor: 0.45359237, fact: '1 lb = 0.45359237 kg' },
  { from: 'miles', to: 'kilometers', sym: 'km', factor: 1.609344, fact: '1 mile = 1.609344 km' },
  { from: 'kilometers', to: 'miles', sym: 'mi', factor: 1.609344, div: true, fact: '1 mile = 1.609344 km' },
  { from: 'inches', to: 'centimeters', sym: 'cm', factor: 2.54, fact: '1 inch = 2.54 cm' },
  { from: 'feet', to: 'meters', sym: 'm', factor: 0.3048, fact: '1 foot = 0.3048 m' },
  { from: 'gallons', to: 'liters', sym: 'L', factor: 3.785411784, fact: '1 US gallon ≈ 3.78541 L' },
];

const COMPOUND: Conv[] = [
  { from: 'kilometers per hour', to: 'meters per second', sym: 'm/s', factor: 3.6, div: true, fact: '1 km = 1000 m and 1 hour = 3600 s, so divide by 3.6' },
  { from: 'meters per second', to: 'kilometers per hour', sym: 'km/h', factor: 3.6, fact: '1 m/s = 3600 m per hour = 3.6 km/h' },
  { from: 'miles per hour', to: 'kilometers per hour', sym: 'km/h', factor: 1.609344, fact: '1 mile = 1.609344 km, and the hours stay the same' },
  { from: 'square meters', to: 'square centimeters', sym: 'cm²', factor: 10000, fact: '1 m = 100 cm, so 1 m² = 100² = 10,000 cm²' },
  { from: 'square feet', to: 'square meters', sym: 'm²', factor: 0.09290304, fact: '1 ft = 0.3048 m, so 1 ft² = 0.3048² = 0.09290304 m²' },
  { from: 'liters', to: 'cubic centimeters', sym: 'cm³', factor: 1000, fact: '1 L = 1000 cm³' },
];

export function units(rng: Rng, diff: Difficulty): Draft {
  if (diff === 2 && rng.chance(0.25)) {
    const toC = rng.chance(0.5);
    const v = toC ? 32 + 9 * rng.int(-4, 12) : 5 * rng.int(-8, 20);
    const r = toC ? ((v - 32) * 5) / 9 : (v * 9) / 5 + 32;
    const [fu, tu] = toC ? ['°F', '°C'] : ['°C', '°F'];
    return {
      prompt: `Convert ${num(v)} ${fu} to ${tu}.`,
      answer: { display: `${num(r)} ${tu}`, kind: 'number' },
      steps: toC
        ? [step(`Subtract 32: ${num(v)} − 32 = ${num(v - 32)}.`), step(`Multiply by 5/9: ${num(v - 32)} × 5 ÷ 9 = ${num(r)}.`, `${r}^\\circ\\text{C}`)]
        : [step(`Multiply by 9/5: ${num(v)} × 9 ÷ 5 = ${num((v * 9) / 5)}.`), step(`Add 32: ${num((v * 9) / 5)} + 32 = ${num(r)}.`, `${r}^\\circ\\text{F}`)],
      hint: toC ? '°C = (°F − 32) × 5/9.' : '°F = °C × 9/5 + 32.',
    };
  }
  const table = diff === 1 ? METRIC : diff === 2 ? IMPERIAL : COMPOUND;
  const c = rng.pick(table);
  const v = diff !== 1 ? rng.int(2, 120) : c.div ? rng.int(1, 99) * (rng.chance(0.5) ? 10 : 100) : rng.chance(0.5) ? rng.int(1, 50) : rng.int(1, 99) / 10;
  const exact = c.div ? new D(v).div(c.factor) : new D(v).mul(c.factor);
  const val = diff === 1 ? exact : exact.toDecimalPlaces(2, D.ROUND_HALF_UP);
  const round = diff === 1 ? '' : ' Round to 2 decimal places.';
  const shown = diff === 1 ? dstr(val) : val.toFixed(2);
  const approx = diff === 1 || exact.eq(val) ? shown : `${exact.toSignificantDigits(8).toString()} ≈ ${shown}`;
  const op = `${trim(v)} ${c.div ? '÷' : '×'} ${trim(c.factor, 10)} = ${approx}`;
  return {
    prompt: `Convert ${trim(v)} ${c.from} to ${c.to}.${round}`,
    answer: { display: `${shown} ${c.sym}`, tex: `${shown}\\ \\text{${c.sym}}`, kind: 'number' },
    steps: [step(`Use the conversion: ${c.fact}.`), step(`${c.div ? 'Divide' : 'Multiply'}: ${op}.`, `${shown}\\ \\text{${c.sym}}`)],
    hint: 'Multiply by the conversion factor so the old unit cancels.',
  };
}

// ---------- stats ----------

function list(xs: number[]): string {
  return xs.map(num).join(', ');
}

export function stats(rng: Rng, diff: Difficulty): Draft {
  if (diff === 1) {
    const n = rng.int(4, 6);
    const xs = Array.from({ length: n - 1 }, () => rng.int(1, 30));
    const partial = xs.reduce((a, b) => a + b, 0);
    let last = rng.int(1, 30);
    while ((partial + last) % n !== 0) last++;
    xs.push(last);
    const sum = partial + last;
    return {
      prompt: `Find the mean of ${list(xs)}.`,
      answer: { display: String(sum / n), kind: 'number' },
      steps: [step(`Add the values: ${xs.join(' + ')} = ${sum}.`), step(`Divide by how many there are (${n}): ${sum} ÷ ${n} = ${sum / n}.`, `\\bar{x} = ${sum / n}`)],
      hint: 'Mean = sum of the values ÷ number of values.',
    };
  }
  if (diff === 2) {
    const kind = rng.pick(['median', 'median', 'range', 'mode'] as const);
    if (kind === 'mode') {
      const base = Array.from({ length: 5 }, () => rng.int(1, 20));
      const uniq = [...new Set(base)];
      const m = rng.pick(uniq);
      const xs = rng.shuffle([...uniq, m, m]);
      return {
        prompt: `Find the mode of ${list(xs)}.`,
        answer: { display: String(m), kind: 'number' },
        steps: [step(`Sort the values: ${list([...xs].sort((a, b) => a - b))}.`), step(`${m} appears most often (${xs.filter((x) => x === m).length} times), so it is the mode.`)],
        hint: 'The mode is the value that appears most often.',
      };
    }
    const n = kind === 'median' ? rng.pick([6, 7, 8]) : rng.int(5, 8);
    const xs = Array.from({ length: n }, () => rng.int(-5, 40));
    const sorted = [...xs].sort((a, b) => a - b);
    if (kind === 'range') {
      const r = sorted[n - 1]! - sorted[0]!;
      return {
        prompt: `Find the range of ${list(xs)}.`,
        answer: { display: num(r), kind: 'number' },
        steps: [step(`The largest value is ${num(sorted[n - 1]!)} and the smallest is ${num(sorted[0]!)}.`), step(`Range = ${num(sorted[n - 1]!)} − ${sorted[0]! < 0 ? `(${num(sorted[0]!)})` : sorted[0]} = ${num(r)}.`)],
        hint: 'Range = largest − smallest.',
      };
    }
    const steps = [step(`Sort the values: ${list(sorted)}.`)];
    let med: number;
    if (n % 2) {
      med = sorted[(n - 1) / 2]!;
      steps.push(step(`With ${n} values, the middle one is number ${(n + 1) / 2}: ${num(med)}.`));
    } else {
      const a = sorted[n / 2 - 1]!, b = sorted[n / 2]!;
      med = (a + b) / 2;
      steps.push(step(`With ${n} values, the two middle ones are ${num(a)} and ${num(b)}.`));
      steps.push(step(`Average them: (${num(a)} + ${num(b)}) ÷ 2 = ${trim(med)}.`));
    }
    return {
      prompt: `Find the median of ${list(xs)}.`,
      answer: { display: trim(med), kind: 'number' },
      steps,
      hint: 'Sort first; the median is the middle value (or the average of the two middle values).',
    };
  }
  const n = rng.int(5, 6);
  const xs = Array.from({ length: n }, () => rng.int(1, 20));
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = new D(sum).div(n);
  const sq = xs.map((x) => new D(x).minus(mean).pow(2));
  const variance = sq.reduce((a, b) => a.plus(b), new D(0)).div(n);
  const sd = variance.sqrt();
  const shown = sd.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
  return {
    prompt: `Find the population standard deviation of ${list(xs)}. Round to 2 decimal places.`,
    answer: { display: shown, kind: 'number' },
    steps: [
      step(`Mean: ${sum} ÷ ${n} = ${trim(mean.toNumber(), 4)}.`, `\\mu = ${trim(mean.toNumber(), 4)}`),
      step(`Square each distance from the mean: ${sq.map((s) => trim(s.toNumber(), 4)).join(', ')}.`),
      step(`Average the squares to get the variance: ${trim(variance.toNumber(), 4)}.`, `\\sigma^2 = ${trim(variance.toNumber(), 4)}`),
      step(`Take the square root: √${trim(variance.toNumber(), 4)} ≈ ${shown}.`, `\\sigma \\approx ${shown}`),
    ],
    hint: 'σ = √(average of the squared distances from the mean).',
  };
}

// ---------- geometry ----------

export function geometry(rng: Rng, diff: Difficulty): Draft {
  const u = rng.pick(['cm', 'm', 'in', 'ft']);
  if (diff === 1) {
    const kind = rng.pick(['rectArea', 'rectPerim', 'triArea'] as const);
    if (kind === 'triArea') {
      const b = rng.int(2, 20), h = rng.int(1, 10) * 2;
      const a = (b * h) / 2;
      return {
        prompt: `A triangle has base ${b} ${u} and height ${h} ${u}. Find its area.`,
        answer: { display: `${a} ${u}²`, tex: `${a}\\ \\text{${u}}^2`, kind: 'number' },
        steps: [step('Area of a triangle = ½ × base × height.', 'A = \\tfrac12 bh'), step(`½ × ${b} × ${h} = ${a}.`, `A = ${a}`)],
        hint: 'A triangle is half of a rectangle with the same base and height.',
      };
    }
    const w = rng.int(2, 20), l = rng.int(2, 20);
    if (kind === 'rectArea') {
      return {
        prompt: `A rectangle is ${l} ${u} long and ${w} ${u} wide. Find its area.`,
        answer: { display: `${l * w} ${u}²`, tex: `${l * w}\\ \\text{${u}}^2`, kind: 'number' },
        steps: [step('Area of a rectangle = length × width.', 'A = lw'), step(`${l} × ${w} = ${l * w}.`, `A = ${l * w}`)],
        hint: 'Area counts the unit squares inside: length × width.',
      };
    }
    return {
      prompt: `A rectangle is ${l} ${u} long and ${w} ${u} wide. Find its perimeter.`,
      answer: { display: `${2 * (l + w)} ${u}`, tex: `${2 * (l + w)}\\ \\text{${u}}`, kind: 'number' },
      steps: [step('Perimeter of a rectangle = 2 × (length + width).', 'P = 2(l + w)'), step(`2 × (${l} + ${w}) = ${2 * (l + w)}.`, `P = ${2 * (l + w)}`)],
      hint: 'Perimeter is the distance all the way around.',
    };
  }
  if (diff === 2) {
    if (rng.chance(0.5)) {
      const r = rng.int(1, 12);
      const area = rng.chance(0.5);
      const v = area ? r * r : 2 * r;
      const pi = `${v === 1 ? '' : v}π`;
      return {
        prompt: `A circle has radius ${r} ${u}. Find its ${area ? 'area' : 'circumference'}. Leave your answer in terms of π.`,
        answer: { display: `${pi} ${u}${area ? '²' : ''}`, tex: `${v === 1 ? '' : v}\\pi\\ \\text{${u}}${area ? '^2' : ''}`, kind: 'number' },
        steps: area
          ? [step('Area of a circle = πr².', 'A = \\pi r^2'), step(`r² = ${r}² = ${v}, so A = ${pi}.`, `A = ${v}\\pi`)]
          : [step('Circumference = 2πr.', 'C = 2\\pi r'), step(`2 × ${r} = ${v}, so C = ${pi}.`, `C = ${v}\\pi`)],
        hint: area ? 'Area = πr².' : 'Circumference = 2πr.',
      };
    }
    const [a0, b0, c0] = rng.pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29]] as const);
    const k = a0 > 5 ? 1 : rng.int(1, 4);
    const a = a0 * k, b = b0 * k, c = c0 * k;
    if (rng.chance(0.5)) {
      return {
        prompt: `A right triangle has legs ${a} ${u} and ${b} ${u}. Find the hypotenuse.`,
        answer: { display: `${c} ${u}`, kind: 'number' },
        steps: [step('Pythagoras: c² = a² + b².', 'c^2 = a^2 + b^2'), step(`${a}² + ${b}² = ${a * a} + ${b * b} = ${c * c}.`, `c^2 = ${c * c}`), step(`Take the square root: c = √${c * c} = ${c}.`, `c = ${c}`)],
        hint: 'The hypotenuse is the longest side: c² = a² + b².',
      };
    }
    return {
      prompt: `A right triangle has hypotenuse ${c} ${u} and one leg ${a} ${u}. Find the other leg.`,
      answer: { display: `${b} ${u}`, kind: 'number' },
      steps: [step('Pythagoras: a² + b² = c², so b² = c² − a².', 'b^2 = c^2 - a^2'), step(`${c}² − ${a}² = ${c * c} − ${a * a} = ${b * b}.`, `b^2 = ${b * b}`), step(`Take the square root: b = √${b * b} = ${b}.`, `b = ${b}`)],
      hint: 'Subtract the square of the known leg from the square of the hypotenuse.',
    };
  }
  const kind = rng.pick(['cylinder', 'cone', 'sphere', 'hyp'] as const);
  if (kind === 'hyp') {
    let a: number, b: number;
    do {
      a = rng.int(2, 15);
      b = rng.int(2, 15);
    } while (Number.isInteger(Math.sqrt(a * a + b * b)));
    const s = a * a + b * b;
    const c = new D(s).sqrt().toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
    return {
      prompt: `A right triangle has legs ${a} ${u} and ${b} ${u}. Find the hypotenuse. Round to 2 decimal places.`,
      answer: { display: `${c} ${u}`, kind: 'number' },
      steps: [step('Pythagoras: c² = a² + b².', 'c^2 = a^2 + b^2'), step(`${a}² + ${b}² = ${a * a} + ${b * b} = ${s}.`, `c^2 = ${s}`), step(`c = √${s} ≈ ${c}.`, `c \\approx ${c}`)],
      hint: 'c² = a² + b², then take the square root.',
    };
  }
  const r = kind === 'sphere' ? rng.pick([1, 2, 3, 3, 6, 6, 9]) : rng.int(1, 9);
  const h = kind === 'cone' ? 3 * rng.int(1, 6) : rng.int(1, 15);
  const v = kind === 'cylinder' ? r * r * h : kind === 'cone' ? (r * r * h) / 3 : (4 * r ** 3) / 3;
  const vStr = Number.isInteger(v) ? `${v === 1 ? '' : v}π` : `${4 * r ** 3}π/3`;
  const prompt =
    kind === 'sphere'
      ? `Find the volume of a sphere with radius ${r} ${u}. Leave your answer in terms of π.`
      : `Find the volume of a ${kind} with radius ${r} ${u} and height ${h} ${u}. Leave your answer in terms of π.`;
  const steps =
    kind === 'cylinder'
      ? [step('Volume of a cylinder = πr²h.', 'V = \\pi r^2 h'), step(`${r}² × ${h} = ${r * r} × ${h} = ${v}.`, `V = ${v}\\pi`)]
      : kind === 'cone'
        ? [step('Volume of a cone = ⅓πr²h.', 'V = \\tfrac13 \\pi r^2 h'), step(`${r}² × ${h} = ${r * r * h}.`), step(`Divide by 3: ${r * r * h} ÷ 3 = ${v}.`, `V = ${v}\\pi`)]
        : [step('Volume of a sphere = ⁴⁄₃πr³.', 'V = \\tfrac43 \\pi r^3'), step(`${r}³ = ${r ** 3}.`), step(`4 × ${r ** 3} ÷ 3 = ${trim(v, 4)}, so V = ${vStr}.`, `V = ${vStr.replace('π', '\\pi')}`)];
  return {
    prompt,
    answer: { display: `${vStr} ${u}³`, tex: `${vStr.replace('π', '\\pi')}\\ \\text{${u}}^3`, kind: 'number' },
    steps,
    hint: kind === 'cylinder' ? 'V = πr²h.' : kind === 'cone' ? 'A cone is a third of the cylinder: V = ⅓πr²h.' : 'V = ⁴⁄₃πr³.',
  };
}

// ---------- money ----------

export function moneyTopic(rng: Rng, diff: Difficulty): Draft {
  if (diff === 1) {
    const p = rng.pick([10, 15, 18, 20, 25]);
    const b = bill(rng, 12, 150);
    const tip = cents(b.mul(p).div(100));
    const exact = b.mul(p).div(100);
    const total = rng.chance(0.4);
    const ans = total ? b.plus(tip) : tip;
    return {
      prompt: total ? `What is the total of a ${money(b.toNumber())} bill with a ${p}% tip?` : `What is a ${p}% tip on ${money(b.toNumber())}?`,
      answer: { display: money(ans.toNumber()), kind: 'number' },
      steps: [
        step(`Write ${p}% as a decimal: ${dstr(new D(p).div(100))}.`),
        step(`Multiply: ${b.toFixed(2)} × ${dstr(new D(p).div(100))} = ${exact.toString()}${exact.eq(tip) ? '' : `, which rounds to ${tip.toFixed(2)}`}.`, `\\$${tip.toFixed(2)}`),
        ...(total ? [step(`Add the tip to the bill: ${b.toFixed(2)} + ${tip.toFixed(2)} = ${ans.toFixed(2)}.`, `\\$${ans.toFixed(2)}`)] : []),
      ],
      hint: 'Tip = bill × percent ÷ 100. Round to the nearest cent.',
    };
  }
  if (diff === 2) {
    if (rng.chance(0.5)) {
      const price = new D(rng.int(8, 120) * 5);
      const off = rng.pick([10, 15, 20, 25, 30, 40, 50]);
      const tax = rng.pick([5, 6, 7, 8, 8.25, 9.5, 10]);
      const sale = cents(price.mul(100 - off).div(100));
      const exactTotal = sale.mul(new D(100).plus(tax)).div(100);
      const total = cents(exactTotal);
      return {
        prompt: `A ${dollars(price)} jacket is ${off}% off, and sales tax is ${tax}%. What do you pay?`,
        answer: { display: money(total.toNumber()), kind: 'number' },
        steps: [
          step(`Apply the discount: ${off}% off leaves ${100 - off}%, so ${price.toString()} × ${dstr(new D(100 - off).div(100))} = ${sale.toFixed(2)}.`),
          step(`Add tax: ${sale.toFixed(2)} × ${dstr(new D(100).plus(tax).div(100))} = ${exactTotal.toString()}${exactTotal.eq(total) ? '' : `, which rounds to ${total.toFixed(2)}`}.`, `\\$${total.toFixed(2)}`),
        ],
        hint: 'Take the discount off first, then add tax on the sale price.',
      };
    }
    const b = bill(rng, 40, 250);
    const p = rng.pick([15, 18, 20]);
    const n = rng.int(2, 6);
    const tip = cents(b.mul(p).div(100));
    const total = b.plus(tip);
    const each = cents(total.div(n));
    return {
      prompt: `A ${money(b.toNumber())} bill gets a ${p}% tip and is split evenly among ${n} people. How much does each person pay? Round to the nearest cent.`,
      answer: { display: money(each.toNumber()), kind: 'number' },
      steps: [
        step(`Tip: ${b.toFixed(2)} × ${dstr(new D(p).div(100))} = ${tip.toFixed(2)} (to the cent).`),
        step(`Total: ${b.toFixed(2)} + ${tip.toFixed(2)} = ${total.toFixed(2)}.`),
        step(`Split: ${total.toFixed(2)} ÷ ${n} ≈ ${each.toFixed(2)}.`, `\\$${each.toFixed(2)}`),
      ],
      hint: 'Find the total with tip first, then divide by the number of people.',
    };
  }
  const P = new D(rng.int(5, 100) * 100);
  const r = rng.pick([2, 3, 4, 5, 6, 8]);
  const t = rng.int(2, 10);
  if (rng.chance(0.3)) {
    const I = P.mul(r).mul(t).div(100);
    return {
      prompt: `Find the simple interest on ${dollars(P)} at ${r}% per year for ${t} years.`,
      answer: { display: money(I.toNumber()), kind: 'number' },
      steps: [step('Simple interest = principal × rate × time.', 'I = Prt'), step(`${P.toString()} × ${dstr(new D(r).div(100))} × ${t} = ${I.toFixed(2)}.`, `I = \\$${I.toFixed(2)}`)],
      hint: 'I = P × r × t, with r as a decimal.',
    };
  }
  const monthly = rng.chance(0.4);
  const n = monthly ? 12 : 1;
  const growth = new D(1).plus(new D(r).div(100 * n)).pow(n * t);
  const A = cents(P.mul(growth));
  const factor = monthly ? `(1 + ${dstr(new D(r).div(100))}/12)^${12 * t}` : `${dstr(new D(1).plus(new D(r).div(100)))}^${t}`;
  return {
    prompt: `${dollars(P)} is invested at ${r}% per year, compounded ${monthly ? 'monthly' : 'annually'}. What is it worth after ${t} years? Round to the nearest cent.`,
    answer: { display: money(A.toNumber()), kind: 'number' },
    steps: [
      step(`Compound interest: A = P(1 + r/n)^(nt), with n = ${n}.`, 'A = P\\left(1 + \\frac{r}{n}\\right)^{nt}'),
      step(`Growth factor: ${factor} ≈ ${growth.toSignificantDigits(8).toString()}.`),
      step(`Multiply: ${P.toString()} × ${growth.toSignificantDigits(8).toString()} ≈ ${A.toFixed(2)}.`, `A \\approx \\$${A.toFixed(2)}`),
    ],
    hint: 'Each period multiplies the balance by (1 + rate per period).',
  };
}

