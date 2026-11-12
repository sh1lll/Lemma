import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession, freeNames, parseInput } from '@lemma/math-core';
import { TOPICS, worked, type Topic } from '@lemma/practice-engine';
import { checkFor, estimateSeconds, explain, lecture, speak, STYLES, topicFor, verifyCheck, type LessonScript, type Scene, type StyleId } from '../src/index';
import { fromWorked, valueOf } from '../src/items';

const STYLE_IDS = STYLES.map((s) => s.id);

/** One question per topic that worked() can solve, plus a few variants. */
const QUERIES = [
  'solve 2x + 3 = 11',
  'solve 3(x - 2) = 9',
  'x/2 + 3 = 5',
  '3x + 2y = 12, x - 4y = 4',
  'hypotenuse 10 and one leg 6, find the other leg',
  'x^2 - 5x + 6 = 0',
  'x^2 - 7x - 1 = 0',
  '2x + y = 7 and x - y = 2',
  'derivative of x^3 + 2x',
  'derivative of sin(x^2)',
  'integral of 3x^2 + 2',
  'integral from 0 to 2 of x^2',
  '15% tip on 84.50',
  '20% of 450',
  '30% off $80',
  '12 is what percent of 48',
  '5 km to miles',
  '100 f to c',
  'mean of 3, 5, 7, 9',
  'median of 4 1 9 7',
  'standard deviation of 2 4 4 4 5 5 7 9',
  'area of a circle with radius 3',
  'hypotenuse of 3 and 4',
  '1/2 + 1/3',
  '3/4 * 2/5',
  'volume of a cylinder with radius 2 and height 5',
];

const session = (() => {
  const s = createSession();
  s.angle = 'rad';
  return s;
})();

function balanced(tex: string): boolean {
  let d = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') d++;
    if (c === '}' && --d < 0) return false;
  }
  return d === 0;
}

function texesOf(s: Scene): string[] {
  const out: string[] = [];
  for (const k of ['tex', 'wrongTex', 'rightTex'] as const) {
    const v = (s as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out.push(v as string);
  }
  return out;
}

function commonChecks(sc: LessonScript) {
  expect(sc.scenes[0]!.kind).toBe('title');
  for (const s of sc.scenes) {
    for (const t of texesOf(s)) {
      expect(t.trim().length, JSON.stringify(s)).toBeGreaterThan(0);
      expect(balanced(t), t).toBe(true);
    }
    expect(s.say?.trim().length ?? 0, JSON.stringify(s)).toBeGreaterThan(0);
    // Spoken lines read numbers and symbols aloud: no digits, carets, backslashes or braces.
    expect(s.say!, JSON.stringify(s)).not.toMatch(/[\d\\^{}=×÷√π²³]/);
    if (s.kind === 'graph') {
      expect(s.exprs.length).toBeGreaterThan(0);
      for (const e of s.exprs) {
        const ast = parseInput(e, session);
        expect(freeNames(ast).filter((n) => n !== 'x'), e).toEqual([]);
      }
    }
    if (s.kind === 'pause') expect(s.seconds).toBeGreaterThanOrEqual(4);
  }
  expect(JSON.stringify(sc)).not.toMatch(/\p{Extended_Pictographic}/u);
  // The narrator never says the same line twice in a row.
  sc.scenes.forEach((s, i) => {
    if (i) expect(s.say, JSON.stringify(s)).not.toBe(sc.scenes[i - 1]!.say);
  });
}

function styleChecks(style: StyleId, sc: LessonScript) {
  const kinds = sc.scenes.map((s) => s.kind);
  const firstStep = kinds.indexOf('step');
  const firstProblem = kinds.indexOf('problem');
  switch (style) {
    case 'visual':
      expect(kinds.indexOf('graph')).toBeGreaterThan(-1);
      expect(kinds.indexOf('graph')).toBeLessThan(firstStep);
      break;
    case 'socratic':
      expect(kinds.filter((k) => k === 'pause').length).toBeGreaterThanOrEqual(1);
      expect(kinds).toContain('practice');
      for (const p of sc.scenes) if (p.kind === 'pause') expect(p.seconds).toBeLessThanOrEqual(8);
      break;
    case 'exam':
      expect(kinds).toContain('mistake');
      expect(kinds).toContain('practice');
      break;
    case 'lecture':
      expect(kinds).toContain('rule');
      expect(kinds).toContain('summary');
      expect(kinds).toContain('mistake');
      break;
    case 'quick':
      expect(estimateSeconds(sc)).toBeLessThanOrEqual(90);
      expect(kinds.indexOf('answer')).toBeLessThan(sc.kind === 'explain' ? kinds.indexOf('step') : Infinity);
      break;
    case 'beginner': {
      expect(kinds).toContain('pause');
      const heads = sc.scenes.filter((s) => s.kind === 'concept').map((s) => (s as { heading: string }).heading);
      expect(heads).toContain('Words we will use');
      expect(heads).toContain('Think of it like this');
      break;
    }
    case 'proof': {
      expect(firstStep).toBeLessThan(firstProblem);
      const last = sc.scenes[sc.scenes.length - 1]!;
      expect(last.kind === 'concept' && last.heading === 'Where this breaks').toBe(true);
      break;
    }
    case 'story': {
      const s1 = sc.scenes[1]!;
      expect(s1.kind === 'concept' && s1.heading === 'The situation').toBe(true);
      const last = sc.scenes[sc.scenes.length - 1]!;
      expect(last.kind === 'concept' && last.heading === 'Back to the story').toBe(true);
      const answers = sc.scenes.filter((s) => s.kind === 'answer').map((s) => (s as { display: string }).display);
      expect(answers.some((a) => (last as { body: string }).body.includes(a))).toBe(true);
      break;
    }
    case 'chalkboard': {
      const inks = sc.scenes.filter((s) => s.kind === 'step').map((s) => (s as { ink?: string }).ink);
      expect(inks).toContain('good');
      expect(sc.scenes[sc.scenes.length - 1]!.kind).toBe('concept');
      break;
    }
    case 'marker':
      expect(kinds).toContain('rule');
      break;
  }
}

describe('styles', () => {
  it('has all ten styles with original blurbs', () => {
    expect(STYLE_IDS.sort()).toEqual(['beginner', 'chalkboard', 'exam', 'lecture', 'marker', 'proof', 'quick', 'socratic', 'story', 'visual']);
    for (const s of STYLES) expect(s.blurb.length).toBeGreaterThan(20);
  });
});

describe('explain', () => {
  it('returns null for questions worked() cannot solve', () => {
    expect(explain('what is the meaning of life', 'chalkboard')).toBeNull();
    expect(explain('2+3*4', 'quick')).toBeNull();
  });

  for (const q of QUERIES) {
    for (const style of STYLE_IDS) {
      it(`${style}: ${q}`, () => {
        const sc = explain(q, style)!;
        expect(sc).not.toBeNull();
        expect(sc.kind).toBe('explain');
        expect(sc.style).toBe(style);
        commonChecks(sc);
        styleChecks(style, sc);
        const w = worked(q)!;
        const answers = sc.scenes.filter((s) => s.kind === 'answer');
        expect(answers.length).toBeGreaterThanOrEqual(1);
        // The user's answer is exactly practice-engine's verified answer.
        expect((answers[0] as { display: string }).display).toBe(w.answer.display);
        // Every verified step appears, in order.
        const texts = sc.scenes.filter((s) => s.kind === 'step').map((s) => (s as { text: string }).text).join('\n');
        if (style !== 'quick' && style !== 'beginner') for (const st of w.steps) expect(texts).toContain(st.text);
      });
    }
  }

  it('check steps recompute correctly with math-core, for every query', () => {
    for (const q of QUERIES) {
      const item = fromWorked(worked(q)!, q);
      const c = checkFor(item);
      expect(c, q).not.toBeNull();
      expect(verifyCheck(c!), q).toBe(true);
      const sc = explain(q, 'chalkboard')!;
      expect(sc.scenes.some((s) => s.kind === 'step' && s.text === c!.text), q).toBe(true);
    }
  });

  it('a wrong answer fails its check', () => {
    const item = fromWorked(worked('solve 2x + 3 = 11')!, 'solve 2x + 3 = 11');
    const bad = checkFor({ ...item, answer: { display: 'x = 5' } });
    expect(bad).toBeNull();
  });

  it('visual explain marks the answer on the closing graph', () => {
    const sc = explain('x^2 - 5x + 6 = 0', 'visual')!;
    const graphs = sc.scenes.filter((s) => s.kind === 'graph');
    const last = graphs[graphs.length - 1] as { mark?: { x: number; y: number }[] };
    expect(last.mark?.map((m) => m.x).sort()).toEqual([2, 3]);
  });
});

describe('lecture', () => {
  for (const t of TOPICS) {
    for (const style of STYLE_IDS) {
      it(`${style}: ${t.id}`, () => {
        const sc = lecture(t.id, style, { seed: 42 })!;
        expect(sc).not.toBeNull();
        expect(sc.kind).toBe('lecture');
        commonChecks(sc);
        styleChecks(style, sc);
        const problems = sc.scenes.filter((s) => s.kind === 'problem');
        if (style !== 'quick') expect(problems.length).toBeGreaterThanOrEqual(2);
        else expect(problems.length).toBeGreaterThanOrEqual(1);
        expect(sc.scenes.filter((s) => s.kind === 'answer').length).toBe(problems.length);
      });
    }
  }

  it('lecture answers agree with worked() wherever worked() can solve the example', () => {
    let verified = 0;
    for (const t of TOPICS) {
      for (const seed of [1, 2, 3]) {
        const sc = lecture(t.id, 'marker', { seed, examples: 3 })!;
        const sc2 = sc.scenes;
        for (let i = 0; i < sc2.length; i++) {
          const p = sc2[i]!;
          if (p.kind !== 'problem') continue;
          const a = sc2.slice(i).find((s) => s.kind === 'answer') as { display: string };
          const w = worked(p.text.replace(/\s*(?:Give the answer in simplest form|Round to [^.]+|Leave your answer in terms of π)\.?/g, ''));
          if (!w) continue;
          const va = valueOf(a.display), vw = valueOf(w.answer.display);
          if (va !== null && vw !== null && !/ or |, /.test(a.display)) expect(Math.abs(va - vw), `${p.text}: ${a.display} vs ${w.answer.display}`).toBeLessThan(0.006);
          else expect(a.display.replace(/\s|−|-/g, ''), p.text).toBe(w.answer.display.replace(/\s|−|-/g, ''));
          verified++;
        }
      }
    }
    expect(verified).toBeGreaterThan(40);
  });

  it('accepts topic phrases and focuses on the named subtopic', () => {
    const chain = lecture('the chain rule', 'marker', { seed: 5 })!;
    expect(chain.title).toBe('The chain rule');
    const steps = chain.scenes.filter((s) => s.kind === 'step').map((s) => (s as { text: string }).text);
    expect(steps.filter((s) => /Chain rule/.test(s)).length).toBeGreaterThanOrEqual(3);
    expect(chain.scenes.some((s) => s.kind === 'rule' && s.heading === 'Chain rule')).toBe(true);

    const prod = lecture('product rule', 'lecture', { seed: 5 })!;
    expect(prod.scenes.filter((s) => s.kind === 'step' && /Product rule/.test(s.text)).length).toBeGreaterThanOrEqual(2);

    const pyth = lecture('pythagorean theorem', 'exam', { seed: 9 })!;
    for (const p of pyth.scenes.filter((s) => s.kind === 'problem')) expect((p as { text: string }).text).toMatch(/right triangle/);

    const cts = lecture('completing the square', 'lecture', { seed: 1 })!;
    expect(cts.scenes.some((s) => s.kind === 'concept' && /quadratic formula/.test(s.body))).toBe(true);

    const sd = lecture('standard deviation', 'chalkboard', { seed: 3 })!;
    for (const p of sd.scenes.filter((s) => s.kind === 'problem')) expect((p as { text: string }).text).toMatch(/standard deviation/);

    expect(lecture('underwater basket weaving', 'quick')).toBeNull();
  });

  it('never repeats the closing step as the answer line (quadratic formula, proof style)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const sc = lecture('quadratic', 'proof', { seed })!;
      sc.scenes.forEach((s, i) => i && expect(s.say).not.toBe(sc.scenes[i - 1]!.say));
    }
  });

  it('honours the examples option', () => {
    const sc = lecture('linear', 'marker', { seed: 1, examples: 4 })!;
    expect(sc.scenes.filter((s) => s.kind === 'problem').length).toBe(4);
  });
});

describe('determinism', () => {
  it('same seed, same script; different seed, different examples', () => {
    for (const style of STYLE_IDS) {
      expect(lecture('derivative', style, { seed: 7 })).toEqual(lecture('derivative', style, { seed: 7 }));
      expect(explain('solve 2x + 3 = 11', style, { seed: 3 })).toEqual(explain('solve 2x + 3 = 11', style, { seed: 3 }));
      expect(explain('solve 2x + 3 = 11', style)).toEqual(explain('solve 2x + 3 = 11', style));
    }
    expect(JSON.stringify(lecture('quadratic', 'marker', { seed: 1 }))).not.toBe(JSON.stringify(lecture('quadratic', 'marker', { seed: 2 })));
  });
});

describe('topicFor', () => {
  const cases: [string, Topic][] = [
    ['chain rule', 'derivative'],
    ['the product rule', 'derivative'],
    ['power rule', 'derivative'],
    ['derivatives', 'derivative'],
    ['slope', 'linear'],
    ['solving equations', 'linear'],
    ['factoring', 'quadratic'],
    ['completing the square', 'quadratic'],
    ['the quadratic formula', 'quadratic'],
    ['simultaneous equations', 'system'],
    ['discount', 'money'],
    ['sales tax', 'money'],
    ['tip', 'money'],
    ['compound interest', 'money'],
    ['mean', 'stats'],
    ['median', 'stats'],
    ['standard deviation', 'stats'],
    ['area', 'geometry'],
    ['volume', 'geometry'],
    ['pythagorean', 'geometry'],
    ['pythagorean theorem', 'geometry'],
    ['unit conversion', 'units'],
    ['exponent laws', 'exponents'],
    ['negative exponents', 'exponents'],
    ['fractions', 'fractions'],
    ['percent', 'percent'],
    ['percentages', 'percent'],
    ['order of operations', 'arithmetic'],
    ['integration by parts', 'integral'],
    ['definite integrals', 'integral'],
    ['u-substitution', 'integral'],
    ['power rule for integrals', 'integral'],
    ['integrating with the power rule', 'integral'],
    ['simple interest', 'money'],
  ];
  for (const [p, t] of cases) it(`${p} → ${t}`, () => expect(topicFor(p)).toBe(t));
  it('a simple-interest lecture teaches simple interest, not compound', () => {
    const sc = lecture('simple interest', 'marker')!;
    expect(sc.title).toBe('Simple interest');
    const problems = sc.scenes.filter((s) => s.kind === 'problem').map((s) => (s as { text: string }).text);
    expect(problems.length).toBeGreaterThan(0);
    for (const t of problems) expect(t).toMatch(/simple interest/);
  });
  it('unknown phrases give null', () => expect(topicFor('knitting')).toBeNull());
});

describe('speech', () => {
  it('reads math the way a tutor says it', () => {
    expect(speak('2x + 3 = 11')).toBe('two x plus three equals eleven');
    expect(speak('x^2 − 5x + 6 = 0')).toBe('x squared minus five x plus six equals zero');
    expect(speak('$12.68')).toBe('twelve dollars and sixty-eight cents');
    expect(speak('x = −1/12')).toBe('x equals negative one twelfth');
    expect(speak('A = πr²')).toBe('A equals pi r squared');
    expect(speak('5 km')).toBe('five kilometers');
  });
  it('speaks units after π, inches before "to", bracket products and definite integrals clearly', () => {
    expect(speak('9π cm²')).toBe('nine pi square centimeters');
    expect(speak('64π cm³')).toBe('sixty-four pi cubic centimeters');
    expect(speak('V = 2πh')).toBe('V equals two pi h');
    expect(speak('Convert 5 in to cm.')).toBe('Convert five inches to centimeters.');
    expect(speak('(x − 2)(x − 3) = 0')).toBe('x minus two, times x minus three equals zero');
    expect(speak('∫ from 0 to 2 of (x^2) dx')).toBe('the integral from zero to two of x squared d x');
    expect(speak('Find ∫ (x^2) dx.')).toBe('Find the integral of x squared d x.');
  });
});

describe('timing', () => {
  it('quick explains fit in about a minute, lectures run longer', () => {
    for (const q of QUERIES) expect(estimateSeconds(explain(q, 'quick')!)).toBeLessThanOrEqual(90);
    expect(estimateSeconds(lecture('derivative', 'lecture')!)).toBeGreaterThan(90);
  });
});

describe('originality', () => {
  // Well-known tutors, channels and brands that must never appear in scripts or source.
  const BANNED = [
    'Khan', 'Sal Khan', '3Blue1Brown', 'Grant Sanderson', 'Organic Chemistry Tutor', 'Professor Leonard', 'PatrickJMT', 'Numberphile', 'Eddie Woo',
    'Mathologer', 'blackpenredpen', 'Krista King', 'Brian McLogan', 'Math Antics', 'Mashup Math', 'Corbettmaths', 'Mr Barton', 'Paul’s Online', "Paul's Online",
    'Dr. Trefor', 'Trefor Bazett', 'Michel van Biezen', 'tecmath', 'JensenMath', 'Nancy Pi', 'Tibees', 'Stand-up Maths', 'Matt Parker', 'Vsauce', 'Mathispower4u',
    'Brilliant', 'Chegg', 'Mathway', 'Photomath', 'Wolfram', 'Desmos', 'YouTube', 'TikTok',
  ];
  it('no real names in any script', () => {
    const all: string[] = [];
    for (const style of STYLE_IDS) {
      for (const q of QUERIES) all.push(JSON.stringify(explain(q, style)));
      for (const t of TOPICS) all.push(JSON.stringify(lecture(t.id, style, { seed: 3 })));
    }
    const text = all.join('\n');
    for (const name of BANNED) expect(text.toLowerCase()).not.toContain(name.toLowerCase());
  });
  it('no real names in the source', () => {
    const dir = join(__dirname, '../src');
    const text = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n').toLowerCase();
    for (const name of BANNED) expect(text).not.toContain(name.toLowerCase());
  });
});
