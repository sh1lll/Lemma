import { check } from './check';
import { derivative, integral } from './gen-calculus';
import { arithmetic, exponents, fractions, linear, quadratic, system } from './gen-algebra';
import { geometry, moneyTopic, percent, stats, units } from './gen-applied';
import { mixSeed, Rng } from './rng';
import { TOPICS, type Difficulty, type Draft, type GenerateOptions, type Question, type TestResult, type Topic } from './types';

export { check, TOPICS };
export { worked, type Worked } from './worked';
export type { AnswerKind, CheckResult, Difficulty, GenerateOptions, Question, Step, TestResult, Topic } from './types';

const GENERATORS: Record<Topic, (rng: Rng, d: Difficulty) => Draft> = {
  arithmetic,
  fractions,
  percent,
  linear,
  quadratic,
  system,
  exponents,
  derivative,
  integral,
  units,
  stats,
  geometry,
  money: moneyTopic,
};

/** A fresh seed when the caller doesn't supply one. */
function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/** Generates one question. Deterministic for a given topic, difficulty and seed. */
export function generate(topic: Topic, opts: GenerateOptions = {}): Question {
  const gen = GENERATORS[topic];
  if (!gen) throw new Error(`Unknown topic: ${String(topic)}`);
  const difficulty = opts.difficulty ?? 1;
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const draft = gen(new Rng(mixSeed(seed, difficulty * 31 + TOPICS.findIndex((t) => t.id === topic))), difficulty);
  return { id: `${topic}-${difficulty}-${seed}`, topic, difficulty, seed, ...draft };
}

const RULES: { topic: Topic; re: RegExp }[] = [
  { topic: 'derivative', re: /\bderivative\b|\bdifferentiate\b|\bd\s*\/\s*dx\b|\bdy\s*\/\s*dx\b|\b[fgy]\s*['′]\s*\(?x?\)?\s*=|\bslope of the tangent\b/i },
  { topic: 'integral', re: /\bintegra(?:l|te|tion)\b|\bantiderivative\b|∫|\barea under\b/i },
  { topic: 'money', re: /\btip\b|\btax\b|\bdiscount\b|\binterest\b|\bsplit\b|\bbill\b|\bcompound(?:ed)?\b|\b(?:off|sale)\b.*\$|\$.*\b(?:off|sale)\b/i },
  {
    topic: 'units',
    re: /\b\d[\d.,]*\s*(?:°\s*[cf]|[cfk]|degrees? (?:f|c|fahrenheit|celsius)|km\/h|mph|m\/s|kg|kilograms?|g|grams?|lbs?|pounds?|oz|ounces?|mi|miles?|km|kilometers?|kilometres?|m|meters?|metres?|cm|centimeters?|mm|in|inch(?:es)?|ft|feet|foot|yards?|yd|l|liters?|litres?|ml|gal(?:lons?)?|cups?)\s+(?:to|in|into|as)\s+[a-z°]/i,
  },
  { topic: 'stats', re: /\bmean\b|\bmedian\b|\bmode\b|\baverage\b|\bstandard deviation\b|\bstd\b|\bstdev\b|\bvariance\b|\brange of\b/i },
  { topic: 'geometry', re: /\barea\b|\bperimeter\b|\bcircumference\b|\bvolume\b|\bhypotenuse\b|\bpythag|\btriangle\b|\bcircle\b|\brectangle\b|\bsphere\b|\bcylinder\b|\bcone\b|\bradius\b/i },
  { topic: 'system', re: /\bsystem\b|\bsimultaneous\b|(?=.*(?<![a-z])x(?![a-z]).*=)(?=.*(?<![a-z])y(?![a-z]).*=).*(?:,|\band\b|;)/i },
  { topic: 'quadratic', re: /\bquadratic\b|(?:x\s*\^\s*2|x²).*=|\bfactor\b.*(?:x\s*\^\s*2|x²)|\broots? of\b/i },
  { topic: 'linear', re: /\bsolve\b.*=|\b\d*\s*[a-z]\s*[+−-].*=|^\s*[-−\d\s.]*x\s*[+−-]?.*=\s*[-−\d.]+\s*$|\bsolve for\b/i },
  { topic: 'percent', re: /%|\bpercent\b|\bper cent\b/i },
  { topic: 'exponents', re: /\bexponents?\b|\bpowers?\b|\bsimplify\b.*\^|[a-z]\s*\^\s*-?\d+\s*[·*×/÷]\s*[a-z]\s*\^/i },
  { topic: 'fractions', re: /\d+\s*\/\s*\d+|\bfractions?\b|\bhalf\b|\bthirds?\b|\bquarters?\b/i },
  { topic: 'arithmetic', re: /^[\s\d.+\-−*×÷/^()]+$|\bplus\b|\bminus\b|\btimes\b|\bdivided by\b|\border of operations\b/i },
];

/** Picks the topic an Lemma query belongs to, or null. */
export function classify(query: string): Topic | null {
  const q = query.trim();
  if (!q) return null;
  for (const r of RULES) if (r.re.test(q)) return r.topic;
  return null;
}

/** Rough difficulty of the original query, so "similar" means similar. */
function inferDifficulty(topic: Topic, q: string): Difficulty {
  const trig = /\b(?:sin|cos|tan|ln|log|e\s*\^)/i.test(q);
  switch (topic) {
    case 'derivative':
    case 'integral': {
      const product = /x\s*(?:\^\s*\d+)?\s*\*?\s*(?:sin|cos|e\s*\^|ln)|(?:sin|cos|e)\s*\^?\s*\(?\s*\d*x\s*\^/i.test(q) || /\bfrom\b.*\bto\b/i.test(q);
      return product ? 3 : trig ? 2 : 1;
    }
    case 'quadratic':
      return /(?:^|[^\d])([2-9]|\d{2,})\s*x\s*(?:\^\s*2|²)/.test(q) ? 2 : 1;
    case 'system':
      return /\d\s*x/.test(q) ? 2 : 1;
    case 'linear':
      return (q.match(/x/g) ?? []).length > 1 || /\(/.test(q) ? 2 : 1;
    case 'money':
      return /\binterest\b|\bcompound/i.test(q) ? 3 : /\btax\b|\bsplit\b|\bdiscount\b/i.test(q) ? 2 : 1;
    case 'stats':
      return /\bstandard deviation\b|\bstd\b|\bstdev\b|\bvariance\b/i.test(q) ? 3 : /\bmedian\b|\bmode\b|\brange\b/i.test(q) ? 2 : 1;
    case 'units':
      return /\/|\bper\b|square|cubic|²|³/i.test(q) ? 3 : /\b(?:lb|lbs|pounds?|mi|miles?|in|inch|inches|ft|feet|gal|gallons?|°|degrees?|fahrenheit|celsius|mph)\b/i.test(q) ? 2 : 1;
    case 'geometry':
      return /\bvolume\b|\bsphere\b|\bcylinder\b|\bcone\b/i.test(q) ? 3 : /\bcircle\b|\bradius\b|\bhypotenuse\b|\bpythag/i.test(q) ? 2 : 1;
    case 'percent':
      return /\bincrease\b|\bdecrease\b|\bwhat percent\b|\bchange\b/i.test(q) ? 2 : 1;
    default:
      return 1;
  }
}

/** Classifies a query ("solve 2x+3=11", "15% tip on 84.50") and generates a fresh question of the same kind. */
export function similarTo(query: string, opts: GenerateOptions = {}): Question | null {
  const topic = classify(query);
  if (!topic) return null;
  return generate(topic, { difficulty: opts.difficulty ?? inferDifficulty(topic, query), seed: opts.seed });
}

/**
 * A practice test: topics round-robin, no repeated prompts. Without a fixed difficulty the test ramps
 * from easy to hard.
 */
export function buildTest(opts: { topics: Topic[]; count: number; difficulty?: Difficulty; seed?: number }): Question[] {
  const topics = opts.topics.length ? opts.topics : TOPICS.map((t) => t.id);
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const order = new Rng(seed).shuffle(topics);
  const out: Question[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < opts.count; i++) {
    const topic = order[i % order.length]!;
    const difficulty: Difficulty = opts.difficulty ?? (Math.min(3, 1 + Math.floor((3 * i) / Math.max(1, opts.count))) as Difficulty);
    let q: Question;
    let attempt = 0;
    do q = generate(topic, { difficulty, seed: mixSeed(seed, i * 101 + attempt++) });
    while (seen.has(q.prompt) && attempt < 20);
    seen.add(q.prompt);
    out.push(q);
  }
  return out;
}

/** Scores a test. Missing answers count as wrong. */
export function grade(questions: Question[], answers: string[]): TestResult {
  const byTopic: TestResult['byTopic'] = {};
  let score = 0;
  questions.forEach((q, i) => {
    const t = (byTopic[q.topic] ??= { right: 0, total: 0 });
    t.total++;
    const a = answers[i];
    if (a !== undefined && check(q, a).correct) {
      t.right++;
      score++;
    }
  });
  return { score, total: questions.length, byTopic };
}
