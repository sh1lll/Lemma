import { describe, expect, it } from 'vitest';
import { compileFloat, createSession, D, parseInput, type Dec } from '@lemma/math-core';
import { buildTest, check, classify, generate, grade, similarTo, TOPICS, worked, type Difficulty, type Question, type Topic } from '../src/index';

// ---------- independent evaluation helpers (math-core only, no practice-engine internals) ----------

const session = createSession();
session.angle = 'rad';

/** Evaluates text in x (and y) with plain floats. "2x(" is read as 2·x·( as in algebra. */
function fn(text: string): (x: number, y?: number) => number {
  const ast = parseInput(text.replace(/(\d)\s*x\s*\(/g, '$1*x*(').replace(/x(?=y)/g, 'x '), session);
  const f = compileFloat(ast, { angle: 'rad', free: new Set(['x', 'y']) });
  return (x, y = 0) => f({ x, y });
}

/** A single number from an answer display: strips "x =", "$", "%", units, "+ C"; π and roots allowed. */
function value(display: string): number {
  const s = display
    .replace(/^[a-z]\s*=\s*/i, '')
    .replace(/[$,%]/g, '')
    .replace(/\s*(?:°[CF]|[a-zA-Z]+[²³]?(?:\/[a-z]+)?)\s*$/, '')
    .trim();
  return fn(s)(0);
}

const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const round = (x: Dec, p: number) => x.toDecimalPlaces(p, D.ROUND_HALF_UP).toNumber();
const nums = (s: string) => [...s.matchAll(/−?\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace('−', '-')));
const SAMPLES = [0.6, 1.1, 1.7, 2.3];

function finiteDiff(f: (x: number) => number, x: number): number {
  const h = 1e-4;
  return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
}

function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

const UNIT_FACTORS: Record<string, [number, 'mul' | 'div']> = {
  'kilometers>meters': [1000, 'mul'],
  'meters>centimeters': [100, 'mul'],
  'centimeters>millimeters': [10, 'mul'],
  'kilograms>grams': [1000, 'mul'],
  'liters>milliliters': [1000, 'mul'],
  'grams>kilograms': [1000, 'div'],
  'meters>kilometers': [1000, 'div'],
  'milliliters>liters': [1000, 'div'],
  'kilograms>pounds': [0.45359237, 'div'],
  'pounds>kilograms': [0.45359237, 'mul'],
  'miles>kilometers': [1.609344, 'mul'],
  'kilometers>miles': [1.609344, 'div'],
  'inches>centimeters': [2.54, 'mul'],
  'feet>meters': [0.3048, 'mul'],
  'gallons>liters': [3.785411784, 'mul'],
  'kilometers per hour>meters per second': [3.6, 'div'],
  'meters per second>kilometers per hour': [3.6, 'mul'],
  'miles per hour>kilometers per hour': [1.609344, 'mul'],
  'square meters>square centimeters': [10000, 'mul'],
  'square feet>square meters': [0.09290304, 'mul'],
  'liters>cubic centimeters': [1000, 'mul'],
};

/** Recomputes a question's answer from its prompt alone and checks it matches the display. */
function verify(q: Question): void {
  const p = q.prompt;
  const ans = q.answer.display;
  const fail = (why: string) => expect.fail(`${q.id}: ${why}\n  ${p}\n  answer ${ans}`);
  switch (q.topic) {
    case 'arithmetic': {
      const e = /^Evaluate (.+)\.$/.exec(p)![1]!;
      if (!near(fn(e)(0), value(ans))) fail('value differs');
      if (!Number.isInteger(value(ans))) fail('not an integer');
      return;
    }
    case 'fractions': {
      const e = /^Calculate (.+?)\. Give/.exec(p)![1]!;
      if (!near(fn(e)(0), value(ans))) fail('value differs');
      const m = /^−?(\d+)\/(\d+)$/.exec(ans);
      if (m) {
        let [a, b] = [Number(m[1]), Number(m[2])];
        while (b) [a, b] = [b, a % b];
        if (a !== 1) fail('not in simplest form');
      }
      return;
    }
    case 'linear': {
      const [l, r] = /^Solve (.+)\.$/.exec(p)![1]!.split('=') as [string, string];
      const x = value(ans);
      if (!near(fn(l)(x), fn(r)(x))) fail('solution does not satisfy the equation');
      return;
    }
    case 'quadratic': {
      const lhs = /^Solve (.+) = 0\.$/.exec(p)![1]!;
      const f = fn(lhs);
      const roots = ans.split(' or ').map(value);
      for (const x of roots) if (Math.abs(f(x)) > 1e-9 * Math.max(1, Math.abs(f(10)))) fail(`root ${x} does not satisfy`);
      // Fit a, b, c independently to know how many distinct real roots there must be.
      const c = f(0), a = (f(1) + f(-1)) / 2 - c, b = (f(1) - f(-1)) / 2;
      const disc = b * b - 4 * a * c;
      if (roots.length !== (disc > 0 ? 2 : 1)) fail('wrong number of roots');
      return;
    }
    case 'system': {
      const [, e1, e2] = /^Solve the system: (.+) and (.+)\.$/.exec(p)!;
      const [xs, ys] = ans.split(', ') as [string, string];
      const x = value(xs), y = value(ys);
      for (const e of [e1!, e2!]) {
        const [l, r] = e.split('=') as [string, string];
        if (!near(fn(l)(x, y), fn(r)(x, y))) fail('pair does not satisfy');
      }
      return;
    }
    case 'exponents': {
      const e = /^(?:Simplify|Evaluate) (.+)\.$/.exec(p)![1]!;
      const f = fn(e), g = fn(ans);
      for (const x of SAMPLES) if (!near(f(x, x + 0.37), g(x, x + 0.37))) fail('not equivalent');
      return;
    }
    case 'derivative': {
      const f = fn(/f\(x\) = (.+)\.$/.exec(p)![1]!);
      const d = fn(ans);
      for (const x of SAMPLES) if (!near(finiteDiff((t) => f(t), x), d(x), 1e-6)) fail(`derivative wrong at ${x}`);
      return;
    }
    case 'integral': {
      const def = /^Evaluate ∫ from (\S+) to (\S+) of \((.+)\) dx\.$/.exec(p);
      if (def) {
        const f = fn(def[3]!);
        const a = Number(def[1]!.replace('−', '-')), b = Number(def[2]!.replace('−', '-'));
        if (!near(simpson((t) => f(t), a, b), value(ans), 1e-8)) fail('definite integral differs');
        return;
      }
      const integrand = fn(/^Find ∫ \((.+)\) dx\.$/.exec(p)![1]!);
      if (!ans.endsWith(' + C')) fail('missing + C');
      const F = fn(ans.replace(/ \+ C$/, ''));
      for (const x of SAMPLES) if (!near(finiteDiff((t) => F(t), x), integrand(x), 1e-6)) fail(`F' ≠ f at ${x}`);
      return;
    }
    case 'units': {
      const t = /^Convert (−?[\d.]+) (°[CF]) to (°[CF])\.$/.exec(p);
      if (t) {
        const v = Number(t[1]!.replace('−', '-'));
        const r = t[2] === '°F' ? ((v - 32) * 5) / 9 : (v * 9) / 5 + 32;
        if (!near(r, value(ans))) fail('temperature differs');
        return;
      }
      const m = /^Convert ([\d.]+) (.+?) to (.+?)\.( Round to 2 decimal places\.)?$/.exec(p)!;
      const [factor, op] = UNIT_FACTORS[`${m[2]}>${m[3]}`] ?? fail(`unknown units ${m[2]} > ${m[3]}`)!;
      const exact = op === 'mul' ? new D(m[1]!).mul(factor) : new D(m[1]!).div(factor);
      const expected = m[4] ? round(exact, 2) : exact.toNumber();
      if (!near(expected, value(ans))) fail(`expected ${expected}`);
      return;
    }
    case 'stats': {
      const m = /^Find the (.+?) of ([−\d, ]+)\./.exec(p)!;
      const xs = nums(m[2]!);
      const sorted = [...xs].sort((a, b) => a - b);
      const n = xs.length;
      let r: number;
      if (m[1] === 'mean') r = xs.reduce((a, b) => a + b, 0) / n;
      else if (m[1] === 'median') r = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
      else if (m[1] === 'range') r = sorted[n - 1]! - sorted[0]!;
      else if (m[1] === 'mode') {
        const counts = new Map<number, number>();
        xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
        const top = Math.max(...counts.values());
        const modes = [...counts].filter(([, c]) => c === top);
        if (modes.length !== 1) fail('mode not unique');
        r = modes[0]![0];
      } else {
        const mean = xs.reduce((a, b) => a + b, 0) / n;
        r = round(new D(Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n)), 2);
      }
      if (!near(r, value(ans))) fail(`expected ${r}`);
      return;
    }
    case 'geometry': {
      const v = value(ans);
      const ns = nums(p);
      let r: number;
      if (/triangle has base/.test(p)) r = (ns[0]! * ns[1]!) / 2;
      else if (/rectangle.*area/.test(p)) r = ns[0]! * ns[1]!;
      else if (/rectangle.*perimeter/.test(p)) r = 2 * (ns[0]! + ns[1]!);
      else if (/circle.*area/.test(p)) r = Math.PI * ns[0]! ** 2;
      else if (/circumference/.test(p)) r = 2 * Math.PI * ns[0]!;
      else if (/legs .* Find the hypotenuse\. Round/.test(p)) r = round(new D(Math.hypot(ns[0]!, ns[1]!)), 2);
      else if (/legs/.test(p)) r = Math.hypot(ns[0]!, ns[1]!);
      else if (/hypotenuse .* one leg/.test(p)) r = Math.sqrt(ns[0]! ** 2 - ns[1]! ** 2);
      else if (/cylinder/.test(p)) r = Math.PI * ns[0]! ** 2 * ns[1]!;
      else if (/cone/.test(p)) r = (Math.PI * ns[0]! ** 2 * ns[1]!) / 3;
      else if (/sphere/.test(p)) r = (4 / 3) * Math.PI * ns[0]! ** 3;
      else return fail('unknown geometry template');
      if (!near(r, v, 1e-9)) fail(`expected ${r}`);
      return;
    }
    case 'percent': {
      const v = value(ans);
      let r: number;
      let m: RegExpExecArray | null;
      if ((m = /^What is (\d+)% of (\d+)\?$/.exec(p))) r = (Number(m[1]) * Number(m[2])) / 100;
      else if ((m = /^(\d+) is what percent of (\d+)\?$/.exec(p))) r = (Number(m[1]) / Number(m[2])) * 100;
      else if ((m = /^A price goes from \$(\d+) to \$(\d+)\./.exec(p))) r = (Math.abs(Number(m[2]) - Number(m[1])) / Number(m[1])) * 100;
      else if ((m = /^After a (\d+)% discount, a jacket costs \$([\d.,]+)\./.exec(p))) r = Number(m[2]!.replace(',', '')) / (1 - Number(m[1]) / 100);
      else if ((m = /rises (\d+)% and then falls (\d+)%/.exec(p))) r = ((1 + Number(m[1]) / 100) * (1 - Number(m[2]) / 100) - 1) * 100;
      else return fail('unknown percent template');
      if (!near(r, v, 1e-9)) fail(`expected ${r}`);
      return;
    }
    case 'money': {
      const v = value(ans);
      let r: number;
      let m: RegExpExecArray | null;
      const amt = (s: string) => new D(s.replace(/,/g, ''));
      if ((m = /^What is a (\d+)% tip on \$([\d.,]+)\?$/.exec(p))) r = round(amt(m[2]!).mul(m[1]!).div(100), 2);
      else if ((m = /^What is the total of a \$([\d.,]+) bill with a (\d+)% tip\?$/.exec(p))) r = amt(m[1]!).plus(round(amt(m[1]!).mul(m[2]!).div(100), 2)).toNumber();
      else if ((m = /^A \$([\d.,]+) jacket is (\d+)% off, and sales tax is ([\d.]+)%\./.exec(p))) {
        const sale = round(amt(m[1]!).mul(100 - Number(m[2])).div(100), 2);
        r = round(new D(sale).mul(new D(100).plus(m[3]!)).div(100), 2);
      } else if ((m = /^A \$([\d.,]+) bill gets a (\d+)% tip and is split evenly among (\d+) people/.exec(p))) {
        const tip = round(amt(m[1]!).mul(m[2]!).div(100), 2);
        r = round(amt(m[1]!).plus(tip).div(m[3]!), 2);
      } else if ((m = /^Find the simple interest on \$([\d,]+) at (\d+)% per year for (\d+) years\.$/.exec(p))) r = amt(m[1]!).mul(m[2]!).mul(m[3]!).div(100).toNumber();
      else if ((m = /^\$([\d,]+) is invested at (\d+)% per year, compounded (monthly|annually)\. What is it worth after (\d+) years\?/.exec(p))) {
        const k = m[3] === 'monthly' ? 12 : 1;
        r = round(amt(m[1]!).mul(new D(1).plus(new D(m[2]!).div(100 * k)).pow(k * Number(m[4]))), 2);
      } else return fail('unknown money template');
      if (!near(r, v, 1e-12)) fail(`expected ${r}`);
      return;
    }
  }
}

const DIFFS: Difficulty[] = [1, 2, 3];

describe('generated questions', () => {
  for (const { id } of TOPICS) {
    for (const d of DIFFS) {
      it(`${id} difficulty ${d}: 200 seeds verified independently and self-checking`, () => {
        for (let seed = 0; seed < 200; seed++) {
          const q = generate(id, { difficulty: d, seed });
          expect(q.topic).toBe(id);
          expect(q.difficulty).toBe(d);
          expect(q.steps.length).toBeGreaterThan(0);
          expect(q.hint).toBeTruthy();
          for (const s of q.steps) expect(s.text).toMatch(/\S/);
          verify(q);
          const r = check(q, q.answer.display);
          if (!r.correct) expect.fail(`${q.id} self-check failed: ${q.prompt} | ${q.answer.display} | ${r.feedback}`);
        }
      });
    }
  }
});

describe('determinism', () => {
  it('same seed gives the same question; different seeds vary', () => {
    for (const { id } of TOPICS) {
      for (const d of DIFFS) {
        expect(generate(id, { difficulty: d, seed: 42 })).toEqual(generate(id, { difficulty: d, seed: 42 }));
        const prompts = new Set(Array.from({ length: 20 }, (_, s) => generate(id, { difficulty: d, seed: s }).prompt));
        expect(prompts.size).toBeGreaterThan(5);
      }
    }
  });
  it('buildTest is deterministic and has no repeated prompts', () => {
    const opts = { topics: ['linear', 'fractions', 'derivative'] as Topic[], count: 12, seed: 9 };
    const a = buildTest(opts);
    expect(a).toEqual(buildTest(opts));
    expect(a).toHaveLength(12);
    expect(new Set(a.map((q) => q.prompt)).size).toBe(12);
    expect(new Set(a.map((q) => q.topic))).toEqual(new Set(opts.topics));
    expect(a[0]!.difficulty).toBe(1);
    expect(a[11]!.difficulty).toBe(3);
    expect(buildTest({ ...opts, difficulty: 2 }).every((q) => q.difficulty === 2)).toBe(true);
  });
});

function q(topic: Topic, display: string, kind: Question['answer']['kind'], prompt = 'Test.'): Question {
  return { id: 't', topic, difficulty: 1, prompt, answer: { display, kind }, steps: [], hint: '', seed: 0 };
}

describe('check', () => {
  it('accepts equivalent number forms', () => {
    const lin = q('linear', 'x = 4', 'number');
    for (const a of ['4', '4.0', '8/2', 'x = 4', 'x=4', ' 4 ', '4.']) expect(check(lin, a).correct, a).toBe(true);
    const fr = q('fractions', '7/3', 'number');
    for (const a of ['7/3', '14/6', '2 1/3', 'x = 7/3']) expect(check(fr, a).correct, a).toBe(true);
    expect(check(fr, '2.333')).toMatchObject({ correct: false, close: true });
    const m = q('money', '$12.68', 'number');
    for (const a of ['$12.68', '12.68', '12.680', '$ 12.68', '12.675']) expect(check(m, a).correct, a).toBe(true);
    expect(check(m, '12.67')).toMatchObject({ correct: false, close: true });
    const pct = q('percent', '25%', 'number');
    for (const a of ['25%', '25', '25 %']) expect(check(pct, a).correct, a).toBe(true);
    expect(check(pct, '0.25')).toMatchObject({ correct: false, close: true });
    const geo = q('geometry', '25π cm²', 'number');
    for (const a of ['25π', '25 pi', '25π cm²', '25*pi']) expect(check(geo, a).correct, a).toBe(true);
    expect(check(geo, '78.54')).toMatchObject({ correct: false, close: true });
    const unit = q('units', '22.05 lb', 'number', 'Convert 10 kilograms to pounds. Round to 2 decimal places.');
    for (const a of ['22.05', '22.05 lb', '22.046', '22.05 pounds']) expect(check(unit, a).correct, a).toBe(true);
    expect(check(unit, '22.1')).toMatchObject({ correct: false, close: true });
    expect(check(q('linear', 'x = 1,250', 'number'), '1250').correct).toBe(true);
  });

  it('rejects wrong numbers with one-sentence feedback', () => {
    const lin = q('linear', 'x = 4', 'number');
    for (const a of ['5', '-4', '40', 'x = 3', 'banana', '']) {
      const r = check(lin, a);
      expect(r.correct, a).toBe(false);
      expect(r.feedback).toMatch(/^[^.]+\.$/);
      expect(r.expected).toBe('x = 4');
    }
    expect(check(lin, '-4').feedback).toMatch(/sign/);
  });

  it('compares expressions by value', () => {
    const d = q('derivative', '3x^2', 'expression');
    for (const a of ['3x^2', '3*x^2', 'x^2*3', '3 x²', "f'(x) = 3x^2", 'x*x*3', '6x^2/2']) expect(check(d, a).correct, a).toBe(true);
    for (const a of ['3x', 'x^3', '3x^3', '-3x^2', 'y^2', 'z']) expect(check(d, a).correct, a).toBe(false);
    expect(check(d, '-3x^2').feedback).toMatch(/sign/);
    const prod = q('derivative', '3x^2 sin(x) + x^3 cos(x)', 'expression');
    for (const a of ['x^3 cos x + 3x^2 sin x', 'x^2(3sin(x) + x cos(x))', '3x^2sin(x)+x^3cos(x)']) expect(check(prod, a).correct, a).toBe(true);
    expect(check(prod, '3x^2 cos(x)').correct).toBe(false);
    const chain = q('derivative', '24x·(3x^2 + 2)^3', 'expression');
    for (const a of ['24x(3x^2+2)^3', '24x*(3x^2 + 2)^3', '(3x^2+2)^3 * 24x']) expect(check(chain, a).correct, a).toBe(true);
    expect(check(chain, '4(3x^2+2)^3').correct).toBe(false);
    const ex = q('exponents', '4x^5/y^3', 'expression');
    for (const a of ['4x^5/y^3', '4x^5 y^-3', '4 x^5 * y^(-3)']) expect(check(ex, a).correct, a).toBe(true);
    expect(check(ex, '4x^5 y^3').correct).toBe(false);
  });

  it('integrals accept any constant and remind about + C', () => {
    const i = q('integral', 'x^3 + x^2 + C', 'expression');
    expect(check(i, 'x^3 + x^2 + C')).toMatchObject({ correct: true, feedback: 'Correct.' });
    expect(check(i, 'x^2 + x^3 + 5')).toMatchObject({ correct: true });
    expect(check(i, 'x^3 + x^2').feedback).toMatch(/\+ C/);
    expect(check(i, '3x^2 + 2x + C').correct).toBe(false);
    const ln = q('integral', '3 ln|x| + C', 'expression');
    expect(check(ln, '3ln(x) + c').correct).toBe(true);
  });

  it('solution sets are order-insensitive', () => {
    const s = q('quadratic', 'x = 2 or x = 3', 'set');
    for (const a of ['x = 2 or x = 3', 'x = 3 or x = 2', '2, 3', '3,2', '2 and 3', '{2, 3}', 'x=2, x=3']) expect(check(s, a).correct, a).toBe(true);
    expect(check(s, '2').feedback).toMatch(/incomplete/);
    expect(check(s, '2').correct).toBe(false);
    expect(check(s, '2, 4').correct).toBe(false);
    expect(check(s, '-2, -3').correct).toBe(false);
    const irr = q('quadratic', 'x = (−3 + √7)/2 or x = (−3 − √7)/2', 'set');
    for (const a of ['(-3 ± √7)/2', '(-3 - sqrt(7))/2, (-3 + sqrt(7))/2']) expect(check(irr, a).correct, a).toBe(true);
    expect(check(irr, '-0.177, -2.823')).toMatchObject({ correct: false, close: true });
    const rep = q('quadratic', 'x = 3', 'set');
    expect(check(rep, '3').correct).toBe(true);
    expect(check(rep, '3, 3').correct).toBe(true);
  });

  it('a right number in the wrong unit is not correct', () => {
    const m = q('units', '5000 m', 'number', 'Convert 5 kilometers to meters.');
    for (const a of ['5000', '5000 m', '5000m', '5000 meters', '5,000 metres']) expect(check(m, a).correct, a).toBe(true);
    for (const a of ['5000 mm', '5000 km', '5000 ft']) expect(check(m, a), a).toMatchObject({ correct: false, close: true });
    const t = q('units', '37.78 °C', 'number', 'Convert 100 °F to °C. Round to 2 decimal places.');
    for (const a of ['37.78', '37.78 C', '37.78°C', '37.78 degrees celsius']) expect(check(t, a).correct, a).toBe(true);
    expect(check(t, '37.78 °F').correct).toBe(false);
    const geo = q('geometry', '9π cm²', 'number');
    for (const a of ['9π cm^2', '9 pi cm^2', '9π sq cm', '9π square centimeters']) expect(check(geo, a).correct, a).toBe(true);
    expect(check(geo, '9π in²').correct).toBe(false);
    expect(check(q('geometry', '64π cm³', 'number'), '64π cm²').correct).toBe(false);
  });

  it('"percent" written as a word counts as a percent', () => {
    const pct = q('percent', '25%', 'number');
    for (const a of ['25 percent', '25 per cent', '25percent']) expect(check(pct, a).correct, a).toBe(true);
  });

  it('pairs accept named or ordered forms', () => {
    const p = q('system', 'x = 3, y = −2', 'pair');
    for (const a of ['x = 3, y = -2', 'y = -2, x = 3', '(3, -2)', '3, -2', 'x=3 and y=-2', 'x = 6/2; y = −2']) expect(check(p, a).correct, a).toBe(true);
    expect(check(p, '(-2, 3)').feedback).toMatch(/swapped/);
    expect(check(p, '(3, 2)').correct).toBe(false);
  });
});

describe('similarTo', () => {
  const cases: [string, Topic][] = [
    ['solve 2x+3=11', 'linear'],
    ['3(x - 4) = 2x + 1', 'linear'],
    ['x^2 - 5x + 6 = 0', 'quadratic'],
    ['solve 2x² + 3x − 2 = 0', 'quadratic'],
    ['x + y = 10, x - y = 2', 'system'],
    ['3x + 2y = 12, x - 4y = 4', 'system'],
    ['2x+3y=5 and 4x-y=3', 'system'],
    ['derivative of x^3 sin x', 'derivative'],
    ['d/dx (3x^2+2)^4', 'derivative'],
    ['integral of 3x^2 + 2x', 'integral'],
    ['∫ x e^x dx', 'integral'],
    ['15% tip on 84.50', 'money'],
    ['8% tax on $40', 'money'],
    ['20% of 450', 'percent'],
    ['10 kg to lb', 'units'],
    ['98.6 F to C', 'units'],
    ['mean of 2 4 9', 'stats'],
    ['standard deviation of 1 2 3 4', 'stats'],
    ['area of a circle radius 3', 'geometry'],
    ['3/4 + 5/6', 'fractions'],
    ['12 + 4 × 3', 'arithmetic'],
    ['simplify x^3 · x^5', 'exponents'],
  ];
  for (const [query, topic] of cases) {
    it(`"${query}" → ${topic}`, () => {
      expect(classify(query)).toBe(topic);
      const s = similarTo(query, { seed: 3 });
      expect(s?.topic).toBe(topic);
      expect(check(s!, s!.answer.display).correct).toBe(true);
    });
  }
  it('infers difficulty from the query', () => {
    expect(similarTo('derivative of x^3 sin x', { seed: 1 })!.difficulty).toBe(3);
    expect(similarTo('derivative of 3x^2 + 2x', { seed: 1 })!.difficulty).toBe(1);
    expect(similarTo('standard deviation of 1 2 3', { seed: 1 })!.difficulty).toBe(3);
    expect(similarTo('solve 2x+3=11', { seed: 1, difficulty: 3 })!.difficulty).toBe(3);
  });
  it('returns null for things it does not know', () => {
    for (const s of ['hello', 'what time is it', 'weather tomorrow', '']) expect(similarTo(s)).toBeNull();
  });
});

describe('grade', () => {
  it('scores by topic', () => {
    const qs = buildTest({ topics: ['linear', 'money'], count: 4, seed: 5 });
    const answers = qs.map((x, i) => (i === 1 ? 'nope' : x.answer.display));
    const r = grade(qs, answers);
    expect(r.total).toBe(4);
    expect(r.score).toBe(3);
    const totals = Object.values(r.byTopic).reduce((a, b) => a + b.total, 0);
    expect(totals).toBe(4);
    expect(grade(qs, []).score).toBe(0);
  });
});

describe('worked', () => {
  /** Verifies a worked answer independently of how it was produced. */
  const cases: { q: string; title?: RegExp; verify: (display: string) => void }[] = [
    { q: 'solve 2x + 3 = 11', verify: (a) => expect(value(a)).toBe(4) },
    { q: '3(x - 2) = 12', verify: (a) => expect(fn('3(x - 2)')(value(a))).toBeCloseTo(12, 12) },
    { q: '5x - 7 = 2x + 8', verify: (a) => expect(value(a)).toBe(5) },
    { q: '2x + 1 = 4x - 2', verify: (a) => expect(a).toBe('x = 3/2') },
    { q: 'x^2 - 5x + 6 = 0', verify: (a) => expect(a.split(' or ').map(value).sort()).toEqual([2, 3]) },
    { q: '2x^2 + 3x = 2', verify: (a) => a.split(' or ').map(value).forEach((x) => expect(2 * x * x + 3 * x).toBeCloseTo(2, 10)) },
    { q: 'x^2 = 2', verify: (a) => a.split(' or ').map(value).forEach((x) => expect(x * x).toBeCloseTo(2, 10)) },
    { q: 'x^2 + 4x + 4 = 0', verify: (a) => expect(a).toBe('x = −2') },
    { q: 'x/2 + 3 = 5', verify: (a) => expect(a).toBe('x = 4') },
    { q: 'solve 0.5x = 3', verify: (a) => expect(a).toBe('x = 6') },
    { q: '(x+1)/2 = (x-1)/3', verify: (a) => expect(a).toBe('x = −5') },
    { q: 'x/7 = 1/3', verify: (a) => expect(a).toBe('x = 7/3') },
    { q: '0.1x^2 - 0.5x + 0.6 = 0', verify: (a) => expect(a).toBe('x = 2 or x = 3') },
    { q: 'x + y = 10, x - y = 2', verify: (a) => expect(a).toBe('x = 6, y = 4') },
    { q: 'solve 2x + 3y = 12 and x - y = 1', verify: (a) => expect(a).toBe('x = 3, y = 2') },
    {
      q: 'derivative of x^3 sin(x)',
      title: /derivative/,
      verify: (a) => SAMPLES.forEach((x) => expect(fn(a)(x)).toBeCloseTo(finiteDiff((t) => t ** 3 * Math.sin(t), x), 6)),
    },
    { q: 'd/dx (3x^2+2)^4', verify: (a) => SAMPLES.forEach((x) => expect(fn(a)(x)).toBeCloseTo(finiteDiff((t) => (3 * t * t + 2) ** 4, x) , 2)) },
    { q: 'differentiate e^(2x) + ln(x)', verify: (a) => SAMPLES.forEach((x) => expect(fn(a)(x)).toBeCloseTo(2 * Math.exp(2 * x) + 1 / x, 9)) },
    { q: 'derivative of x^2/3 + 1/x', verify: (a) => SAMPLES.forEach((x) => expect(fn(a)(x)).toBeCloseTo((2 * x) / 3 - 1 / x ** 2, 9)) },
    { q: 'integral of 3x^2 + 2x', verify: (a) => SAMPLES.forEach((x) => expect(finiteDiff(fn(a.replace(' + C', '')), x)).toBeCloseTo(3 * x * x + 2 * x, 6)) },
    { q: 'integrate x^2', verify: (a) => expect(a).toBe('x^3/3 + C') },
    { q: '∫ cos(3x) dx', verify: (a) => SAMPLES.forEach((x) => expect(finiteDiff(fn(a.replace(' + C', '')), x)).toBeCloseTo(Math.cos(3 * x), 6)) },
    { q: 'integral from 0 to 2 of x^2 + 1', verify: (a) => expect(value(a)).toBeCloseTo(simpson((t) => t * t + 1, 0, 2), 10) },
    { q: '15% tip on 84.50', verify: (a) => expect(a).toBe('$12.68') },
    { q: 'total with 18% tip on $62.40', verify: (a) => expect(a).toBe(`$${(62.4 + round(new D('62.40').mul('0.18'), 2)).toFixed(2)}`) },
    { q: '20% of 450', verify: (a) => expect(value(a)).toBe(90) },
    { q: '25% off $80', verify: (a) => expect(value(a)).toBe(60) },
    { q: '30 is what percent of 120', verify: (a) => expect(a).toBe('25%') },
    { q: '10 kg to lb', verify: (a) => expect(Number(a.replace(/[^\d.]/g, ''))).toBeCloseTo(10 / 0.45359237, 4) },
    { q: 'convert 5 miles to km', verify: (a) => expect(Number(a.replace(/[^\d.]/g, ''))).toBeCloseTo(5 * 1.609344, 4) },
    { q: '98.6 F to C', verify: (a) => expect(a).toBe('37 °C') },
    { q: 'mean of 2 4 9', verify: (a) => expect(a).toBe('5') },
    { q: 'median of 3, 1, 4, 1, 5, 9', verify: (a) => expect(a).toBe('3.5') },
    // Sample by default, like the answer the stats engine gives; "population" asks for σ.
    { q: 'standard deviation of 2 4 4 4 5 5 7 9', verify: (a) => expect(a).toBe('≈ 2.1381') },
    { q: 'population standard deviation of 2 4 4 4 5 5 7 9', verify: (a) => expect(a).toBe('2') },
    { q: 'area of a circle radius 3', verify: (a) => expect(value(a)).toBeCloseTo(9 * Math.PI, 12) },
    { q: 'volume of a cylinder radius 2 height 5', verify: (a) => expect(value(a)).toBeCloseTo(20 * Math.PI, 12) },
    { q: 'hypotenuse with legs 3 and 4', verify: (a) => expect(a).toBe('5') },
    { q: '3x + 2y = 12, x - 4y = 4', verify: (a) => expect(a).toBe('x = 4, y = 0') },
    { q: 'A right triangle has hypotenuse 10 ft and one leg 6 ft. Find the other leg.', verify: (a) => expect(a).toBe('8 ft') },
    { q: 'hypotenuse is 13 and one leg is 5, find the other leg', verify: (a) => expect(a).toBe('12') },
    { q: 'a right triangle has a hypotenuse of 7 and a leg of 3. find the other leg', verify: (a) => expect(value(a.replace('≈ ', ''))).toBeCloseTo(Math.sqrt(40), 2) },
    { q: 'find the hypotenuse of a triangle with one leg 3 and the other leg 4', verify: (a) => expect(a).toBe('5') },
    { q: 'area of a rectangle 8 by 6', verify: (a) => expect(a).toBe('48') },
    { q: '3/4 + 5/6', verify: (a) => expect(a).toBe('19/12') },
  ];
  for (const c of cases) {
    it(`solves "${c.q}"`, () => {
      const w = worked(c.q);
      expect(w, c.q).not.toBeNull();
      expect(w!.title).toBeTruthy();
      if (c.title) expect(w!.title.toLowerCase()).toMatch(c.title);
      expect(w!.question).toMatch(/\S/);
      expect(w!.steps.length).toBeGreaterThan(0);
      c.verify(w!.answer.display);
    });
  }
  it('names the rule it uses', () => {
    expect(worked('derivative of x^3 sin(x)')!.steps.some((s) => /product rule/i.test(s.text))).toBe(true);
    expect(worked('d/dx (3x^2+2)^4')!.steps.some((s) => /chain rule/i.test(s.text))).toBe(true);
    expect(worked('10 kg to lb')!.steps.some((s) => /1 kg ≈ 2\.20462 lb/.test(s.text))).toBe(true);
  });
  it('agrees with every generated question it can read', () => {
    for (const { id } of TOPICS)
      for (const d of DIFFS)
        for (let seed = 0; seed < 60; seed++) {
          const g = generate(id, { difficulty: d, seed });
          const w = worked(g.prompt);
          if (w) expect(check(g, w.answer.display.replace(/^≈\s*/, '')).correct, `${g.prompt} → ${w.answer.display}`).toBe(true);
        }
  });
  it('returns null instead of guessing', () => {
    for (const s of ['hello', 'x^2 + 2x + 5 = 0', 'hypotenuse 5 and one leg 7, find the other leg', 'derivative of sqrt(x)', 'integral of x e^x', '3 feet to kg', 'mode of 1 2 3', 'solve x^3 = 8', 'x = x', 'what is love', '2 + 2'])
      expect(worked(s), s).toBeNull();
  });
});
