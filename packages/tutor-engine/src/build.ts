/**
 * Script builders: one explain and one lecture recipe per teaching style. Every number on screen comes
 * from practice-engine's verified steps or from math-core (checks, pictures); nothing here invents math.
 */
import { generate, similarTo, type Difficulty, type Question, type Step, type Topic } from '@lemma/practice-engine';
import { EXTRAS, type Extras } from './extras';
import { checkFor, fromQuestion, pictureFor, type CheckLine, type Item, type Picture } from './items';
import { speak } from './speak';
import { NOTES, questionMatches, type Line, type MistakeNote, type RuleNote, type Subtopic, type TopicNote } from './topics';
import type { Ink, LessonScript, Scene, StyleId, StyleInfo } from './types';

export const STYLES: StyleInfo[] = [
  { id: 'chalkboard', label: 'Chalkboard', blurb: 'Patient and conversational: thinks out loud, explains why each move is allowed, one example done slowly.' },
  { id: 'marker', label: 'Marker', blurb: 'Brisk and direct: here is the pattern, here is the rule, then quick examples that get harder.' },
  { id: 'visual', label: 'Visual', blurb: 'Picture first: see the idea on a graph, then do the algebra and find the answer on the picture.' },
  { id: 'lecture', label: 'Lecture', blurb: 'Thorough and structured: definition, rule, why it works, examples, a common mistake, summary.' },
  { id: 'socratic', label: 'Socratic', blurb: 'Asks before it tells: pauses for you to try each key move, then ends with a question to practise.' },
  { id: 'exam', label: 'Exam prep', blurb: 'Spot the pattern, use the fast method, dodge the classic trap, check in seconds.' },
  { id: 'quick', label: 'Quick', blurb: 'Under a minute or so: the answer, the one idea that makes it click, one line of working.' },
  { id: 'beginner', label: 'Beginner', blurb: 'Plain words and tiny steps for anyone new or nervous: every term defined, nothing assumed.' },
  { id: 'proof', label: 'Proof', blurb: 'For stronger students: why the rule is true, then the rule in action, then where it stops working.' },
  { id: 'story', label: 'Story', blurb: 'Starts with a real-world puzzle, uses the math to solve it, and ends by answering the puzzle in plain words.' },
];

export const STYLE_IDS = STYLES.map((s) => s.id);

// ---------- small helpers ----------

/** Deterministic pick from a list of phrasings. */
function pick<T>(xs: readonly T[], seed: number, salt: number): T {
  const h = Math.imul((seed >>> 0) ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return xs[h % xs.length]!;
}

/** Stable seed from text when the caller gives none. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hasTex = (t: string | undefined): t is string => !!t && t.trim().length > 0;

function step(text: string, tex: string | undefined, say: string, ink?: Ink, why?: string): Scene {
  const s: Scene = { kind: 'step', text, say };
  if (hasTex(tex)) s.tex = tex;
  if (ink) s.ink = ink;
  if (why) s.why = why;
  return s;
}

function concept(heading: string, body: string, say: string, tex?: string): Scene {
  const s: Scene = { kind: 'concept', heading, body, say };
  if (hasTex(tex)) s.tex = tex;
  return s;
}

const ruleScene = (r: RuleNote, say?: string): Scene => (r.note ? { kind: 'rule', heading: r.heading, tex: r.tex, note: r.note, say: say ?? r.say } : { kind: 'rule', heading: r.heading, tex: r.tex, say: say ?? r.say });

function mistakeScene(m: MistakeNote, lead = ''): Scene {
  const s: Scene = { kind: 'mistake', wrong: m.wrong, right: m.right, say: `${lead}${m.say}` };
  if (hasTex(m.wrongTex)) s.wrongTex = m.wrongTex;
  if (hasTex(m.rightTex)) s.rightTex = m.rightTex;
  return s;
}

function problemScene(it: Item, say: string, label?: string): Scene {
  const s: Scene = { kind: 'problem', text: it.text, say };
  if (label) s.label = label;
  if (hasTex(it.tex)) s.tex = it.tex;
  return s;
}

function answerScene(it: Item, say: string): Scene {
  const s: Scene = { kind: 'answer', display: it.answer.display, say };
  if (hasTex(it.answer.tex)) s.tex = it.answer.tex;
  return s;
}

function graphScene(p: Picture, say?: string, withMarks = true): Scene {
  const s: Scene = { kind: 'graph', exprs: p.exprs, caption: p.caption, say: say ?? p.say };
  if (p.xRange) s.xRange = p.xRange;
  if (p.yRange) s.yRange = p.yRange;
  if (withMarks && p.mark?.length) s.mark = p.mark;
  return s;
}

function checkScene(c: CheckLine, ink: Ink = 'second', lead = ''): Scene {
  const say = /[,:]\s$/.test(lead) ? `${lead}${lowerFirst(c.say)}` : `${lead}${c.say}`;
  return step(c.text, c.tex, say, ink, 'An independent check, not a repeat of the working.');
}

const lineStep = (l: Line, ink?: Ink): Scene => step(l.text, l.tex, l.say, ink);

/** Why a move is allowed, from the wording of the step. */
const WHY: [RegExp, string][] = [
  [/(?:Add|Subtract) .+ (?:to|from) both sides/i, 'Doing the same thing to both sides keeps them equal.'],
  [/Divide both sides|Divide by/i, 'Dividing both sides by the same non-zero number keeps them equal.'],
  [/Expand the brackets/i, 'The number outside multiplies every term inside.'],
  [/Move everything to one side/i, 'With zero on one side, a product of factors can be split up.'],
  [/two numbers that multiply/i, 'Those two numbers rebuild the middle term and the constant when the brackets are multiplied out.'],
  [/Split the middle term/i, 'Splitting the middle term lets us factor in pairs.'],
  [/Factor/i, 'A product is easier to reason about than a sum.'],
  [/Set each factor to zero/i, 'If a product is zero, one of its factors must be zero.'],
  [/quadratic formula/i, 'The formula is completing the square, done once for every quadratic.'],
  [/Discriminant/i, 'b² − 4ac is what sits under the square root.'],
  [/Simplify the root/i, 'Pull square factors out of the root.'],
  [/Add the two equations|Subtract the second equation/i, 'Adding or subtracting equal amounts keeps things equal, and it cancels a variable.'],
  [/Multiply the first equation/i, 'Scaling a whole equation keeps it true.'],
  [/^Substitute/i, 'Once one value is known, the other equation gives the second.'],
  [/^Check both equations/i, 'A pair is only a solution if it works in both.'],
  [/Chain rule/i, 'The inside changes too, so its rate multiplies in.'],
  [/Product rule/i, 'Each factor takes a turn being differentiated.'],
  [/^Power rule: bring down/i, 'The old power comes down in front and the new power is one less.'],
  [/has derivative 0/i, 'A constant does not change, so its rate of change is zero.'],
  [/The derivative of .+ is/i, 'This is a standard derivative worth remembering.'],
  [/^Power rule: raise/i, 'Integration runs the power rule backwards.'],
  [/constant of integration/i, 'Every constant differentiates to zero, so we cannot know which one was there.'],
  [/upper limit|lower limit/i, 'A definite integral is the change in the antiderivative between the limits.'],
  [/^Subtract: /i, 'Top limit minus bottom limit.'],
  [/least common denominator/i, 'Pieces must be the same size before they can be added.'],
  [/^Rewrite/i, 'Multiplying top and bottom by the same number does not change the value.'],
  [/Multiply the numerators/i, 'A fraction of a fraction: multiply straight across.'],
  [/reciprocal/i, 'Dividing by a number is the same as multiplying by its flip.'],
  [/Simplify by dividing/i, 'Dividing top and bottom by the same number keeps the value.'],
  [/as a decimal/i, 'Percent means per hundred.'],
  [/conversion/i, 'A conversion fact is a fraction equal to one, so the amount does not change.'],
  [/Add the values/i, 'The mean shares the total out equally.'],
  [/Sort the values/i, 'The median is about position, so the order matters.'],
  [/Pythagoras/i, 'This holds only because the triangle has a right angle.'],
  [/Area of|Volume of|Circumference|Perimeter/i, 'Pick the formula that links what we know to what we want.'],
  [/Parentheses first|Multiply (?:before|first)|Divide before/i, 'Stronger operations come first.'],
  [/Same base/i, 'Exponents count copies of the base.'],
  [/Power of a power/i, 'Each copy is itself a group of copies, so the counts multiply.'],
];
const whyFor = (text: string) => WHY.find(([re]) => re.test(text))?.[1];

const MOVE = /both sides|^Subtract|^Add (?!the values|it to|the results|the constant)|^Divide|Multiply the first|^Factor|^Substitute|Chain rule|Product rule|^Expand|^Split/i;

function inkFor(i: number, n: number, text: string): Ink {
  if (i === n - 1) return 'good';
  return MOVE.test(text) ? 'accent' : 'main';
}

type Mode = 'slow' | 'brisk' | 'plain' | 'tiny';

const SLOW_LEADS = ['First, ', 'Next, ', 'Now, ', 'Then, ', 'After that, ', 'And now, '];

/** Step scenes from verified steps. */
function stepsOf(it: Item, mode: Mode, seed: number, from = 0, to = it.steps.length): Scene[] {
  const out: Scene[] = [];
  const n = it.steps.length;
  for (let i = from; i < to; i++) {
    const s = it.steps[i]!;
    const why = whyFor(s.text);
    const ink = mode === 'brisk' ? (i === n - 1 ? 'good' : undefined) : inkFor(i, n, s.text);
    const spoken = speak(s.text);
    if (mode === 'tiny') {
      out.push(...tinySteps(s, ink, why));
      continue;
    }
    let say = spoken;
    if (mode === 'slow') {
      const lead = i === 0 ? pick(['Let us start here. ', 'Here is a sensible first move. ', 'So where do we begin? '], seed, i) : SLOW_LEADS[Math.min(i, SLOW_LEADS.length - 1)]!;
      say = `${lead}${lead.endsWith(', ') ? lowerFirst(spoken) : spoken}${why ? ` Why is that allowed? ${why}` : ''}`;
    }
    out.push(step(s.text, s.tex, say, ink, mode === 'brisk' ? undefined : why));
  }
  return out;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Beginner pacing: break a step into its sentences, each written and said on its own. */
function tinySteps(s: Step, ink: Ink | undefined, why: string | undefined): Scene[] {
  const parts = s.text
    .split(/(?<=[.;])\s+(?=[A-Z])|,\s+(?=which |so |then )/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [step(s.text, s.tex, `${speak(s.text)}${why ? ` ${why}` : ''}`, ink, why)];
  return parts.map((p, k) => {
    const last = k === parts.length - 1;
    const text = /[.;]$/.test(p) ? p : `${p}.`;
    return step(text.replace(/^(which|so|then)\b/, (w) => w[0]!.toUpperCase() + w.slice(1)), last ? s.tex : undefined, `${speak(text)}${last && why ? ` ${why}` : ''}`, last ? ink : 'main', last ? why : undefined);
  });
}

function practiceScene(q: Question, lead: string): Scene {
  const s: Scene = { kind: 'practice', text: q.prompt, answer: q.answer.display, say: `${lead} ${speak(q.prompt)}` };
  if (hasTex(q.promptTex)) s.tex = q.promptTex;
  return s;
}

/** A fresh question of the same kind, never identical to `avoid`. */
function practiceQuestion(topic: Topic, sub: Subtopic | undefined, seed: number, avoid: string[], query?: string, difficulty?: Difficulty): Question {
  for (let k = 0; k < 60; k++) {
    const s = (seed + 7919 * (k + 1)) >>> 0;
    const q = query && k < 10 ? similarTo(query, { seed: s }) : generate(topic, { difficulty: difficulty ?? sub?.difficulties[0] ?? 2, seed: s });
    if (q && !avoid.includes(q.prompt) && questionMatches(q, sub)) return q;
  }
  return generate(topic, { difficulty: 1, seed });
}

/** What to call the answer in a sentence. */
const answerSay = (it: Item) => speak(it.answer.display);

// ---------- context ----------

export interface Ctx {
  note: TopicNote;
  ex: Extras;
  sub?: Subtopic;
  seed: number;
}

export function ctxFor(topic: Topic, sub: Subtopic | undefined, seed: number): Ctx {
  return sub ? { note: NOTES[topic], ex: EXTRAS[topic], sub, seed } : { note: NOTES[topic], ex: EXTRAS[topic], seed };
}

const mainRule = (c: Ctx): RuleNote => c.sub?.rule ?? c.note.rules[0]!;
const mainMistake = (c: Ctx): MistakeNote => c.sub?.mistake ?? c.note.mistakes[0]!;
const mainWhy = (c: Ctx) => c.sub?.why ?? c.note.why;

/** For an explain: the subtopic the user's own problem actually uses, if one is recognisable. */
export function subFor(it: Item): Subtopic | undefined {
  const hay = `${it.text}\n${it.steps.map((s) => s.text).join('\n')}`;
  return NOTES[it.topic].subtopics.find((s) => s.match && s.match.test(hay) && (s.rule || s.mistake || s.why));
}

function title(text: string, subtitle: string, say: string): Scene {
  return { kind: 'title', title: text, subtitle, say };
}

// ---------- explain ----------

export function buildExplain(style: StyleId, it: Item, c: Ctx, query: string): Scene[] {
  const check = checkFor(it);
  const sd = c.seed;
  const q = it.text;
  const n = it.steps.length;
  const scenes: Scene[] = [];
  const practice = () => practiceQuestion(it.topic, c.sub, sd, [it.text], query);

  switch (style) {
    case 'chalkboard': {
      scenes.push(title(it.title, q, pick(['Let us work through this one together, slowly.', 'Grab a coffee; we are going to take this one step at a time.', 'Here is one to work through together, at an easy pace.'], sd, 1)));
      scenes.push(problemScene(it, `Here is the question. ${speak(q)}`));
      scenes.push(concept('What are we really asking?', c.note.asking, `So what are we really asking here? ${askBody(c.note.asking)}`));
      scenes.push(...stepsOf(it, 'slow', sd));
      if (check) scenes.push(checkScene(check, 'second', 'Before we trust it, '));
      scenes.push(answerScene(it, `So the answer is ${answerSay(it)}.`));
      scenes.push(concept('The big idea', c.note.bigIdea, `Step back for a second. ${c.note.bigIdea}`));
      break;
    }
    case 'marker': {
      const r = mainRule(c);
      scenes.push(title(it.title, q, 'Here is the pattern, then we use it.'));
      scenes.push(ruleScene(r, `The rule. ${r.say}`));
      scenes.push(problemScene(it, speak(q), 'Your problem'));
      scenes.push(...stepsOf(it, 'brisk', sd));
      scenes.push(answerScene(it, `Answer: ${answerSay(it)}.`));
      if (check) scenes.push(checkScene(check, 'second'));
      // One more of the same kind, a notch harder, to lock the pattern in.
      const more = fromQuestion(practiceQuestion(it.topic, c.sub, sd, [it.text], query, 2));
      scenes.push(problemScene(more, `Same pattern, one more. ${speak(more.text)}`, 'One more'));
      scenes.push(...stepsOf(more, 'brisk', sd));
      scenes.push(answerScene(more, `Answer: ${answerSay(more)}.`));
      break;
    }
    case 'visual': {
      const pic = pictureFor(it);
      scenes.push(title(it.title, q, 'Let us see this one before we calculate it.'));
      scenes.push(graphScene(pic, undefined, false));
      scenes.push(problemScene(it, `Now the question in symbols. ${speak(q)}`));
      scenes.push(concept('What to notice', c.note.graphHelps, `What to notice. ${c.note.graphHelps} Now the algebra, which tells us exactly what the picture shows roughly.`));
      scenes.push(...stepsOf(it, 'plain', sd));
      if (check) scenes.push(checkScene(check));
      scenes.push(answerScene(it, `The answer is ${answerSay(it)}.`));
      scenes.push(graphScene(pic, `Back to the picture. ${pic.mark?.length ? 'The marked point is our answer, sitting exactly where the picture said it would.' : 'The picture and the algebra agree.'}`));
      break;
    }
    case 'lecture': {
      const r = mainRule(c);
      scenes.push(title(it.title, q, `In this lesson we solve one problem completely and look at the idea behind it.`));
      scenes.push(concept('Definition', c.note.definition, c.note.defSay, c.note.definitionTex));
      scenes.push(ruleScene(r));
      scenes.push(problemScene(it, `Our problem: ${speak(q)}`, 'Example'));
      scenes.push(...stepsOf(it, 'plain', sd));
      if (check) scenes.push(checkScene(check, 'second', 'Next, '));
      scenes.push(answerScene(it, `Therefore, ${answerSay(it)}.`));
      scenes.push(mistakeScene(mainMistake(c), 'A common mistake to avoid. '));
      scenes.push({ kind: 'summary', points: c.note.summary, say: `To summarise. ${c.note.summary.map(speak).join(' ')}` });
      break;
    }
    case 'socratic': {
      scenes.push(title(it.title, q, 'I will ask before I tell. Have a go at each question before the answer appears.'));
      scenes.push(problemScene(it, `Here is the problem. ${speak(q)}`));
      scenes.push({ kind: 'pause', prompt: 'What would you do first?', seconds: 7, say: 'What would you do first? Pause and decide before I show you.' });
      const first = stepsOf(it, 'plain', sd, 0, Math.max(1, n - 1));
      if (first[0]) first[0].say = `Here is one good first move. ${first[0].say ?? ''}`;
      scenes.push(...(n > 1 ? first : []));
      scenes.push({ kind: 'pause', prompt: n > 1 ? 'What is the last move?' : 'What would finish it?', seconds: 5, say: 'One move left. What is it?' });
      scenes.push(...stepsOf(it, 'plain', sd, Math.max(0, n - 1)));
      if (check) scenes.push(checkScene(check, 'second', 'How could we know it is right? '));
      scenes.push(answerScene(it, `So the answer is ${answerSay(it)}. Did you get there?`));
      scenes.push(practiceScene(practice(), 'Now one for you to try on your own.'));
      break;
    }
    case 'exam': {
      const p = c.note.pattern;
      scenes.push(title(it.title, q, 'Exam technique: spot it, solve it fast, check it.'));
      scenes.push(concept('Spot the pattern', `When you see ${p.see}, think: ${p.think}.`, `When you see ${p.see}, think: ${p.think}.`));
      scenes.push(problemScene(it, speak(q)));
      scenes.push(...stepsOf(it, 'brisk', sd));
      scenes.push(answerScene(it, `Answer: ${answerSay(it)}.`));
      scenes.push(mistakeScene(mainMistake(c), 'The classic trap. '));
      if (check) scenes.push(checkScene(check, 'second', 'Exam habit, ten seconds: '));
      else scenes.push(concept('Time-saving check', c.note.checkTip, c.note.checkTip));
      scenes.push(practiceScene(practice(), 'Exam-style practice.'));
      break;
    }
    case 'quick': {
      scenes.push(title(it.title, q, `Quick one: ${speak(q)}`));
      scenes.push(answerScene(it, `The answer is ${answerSay(it)}.`));
      scenes.push(concept('The idea', c.note.oneIdea, `The idea that makes it click: ${c.note.oneIdea}`));
      scenes.push(ruleScene(mainRule(c), `In symbols: ${mainRule(c).say}`));
      const key = [...it.steps].reverse().find((s) => hasTex(s.tex)) ?? it.steps[n - 1];
      if (key) scenes.push(step(key.text, key.tex, speak(key.text), 'good'));
      if (check) scenes.push(checkScene(check, 'second', 'And to be sure, '));
      break;
    }
    case 'beginner': {
      const ec = c.ex.easyCheck;
      scenes.push(title(it.title, q, 'No rush and no tricks. We will take this in very small steps.'));
      scenes.push(concept('Words we will use', c.ex.terms.map((t) => `${t.term}: ${t.meaning}`).join('. ') + '.', `Before we start, a few words. ${c.ex.terms.map((t) => `${cap(t.term)} means ${t.meaning}.`).join(' ')}`));
      scenes.push(concept('Think of it like this', c.ex.analogy, c.ex.analogy));
      scenes.push({ kind: 'pause', prompt: ec.prompt, seconds: 5, say: `A warm-up, just to check we are together. ${ec.prompt}` });
      scenes.push(concept('Warm-up answer', ec.answer, `${ec.answer} If you got that, you are ready.`));
      scenes.push(problemScene(it, `Here is our question. ${speak(q)} It looks busier than it is.`));
      scenes.push(...stepsOf(it, 'tiny', sd));
      if (check) scenes.push(checkScene(check, 'second', 'One last thing, because checking is always allowed: '));
      scenes.push(answerScene(it, `And that is it: ${answerSay(it)}. That was every step there is.`));
      scenes.push(concept('Remember', c.note.oneIdea, `If you remember one thing, make it this: ${c.note.oneIdea}`));
      break;
    }
    case 'proof': {
      const r = mainRule(c);
      const w = mainWhy(c);
      scenes.push(title(it.title, q, 'Before using the rule, let us see why it is true.'));
      scenes.push(ruleScene(r, `The rule we will rely on. ${r.say} But why should we believe it?`));
      scenes.push(concept(w.heading, w.intro, w.intro));
      scenes.push(...w.steps.map((l, i) => lineStep(l, i === w.steps.length - 1 ? 'good' : 'second')));
      scenes.push(problemScene(it, `Now apply it. ${speak(q)}`, 'Application'));
      scenes.push(...stepsOf(it, 'plain', sd));
      if (check) scenes.push(checkScene(check));
      scenes.push(answerScene(it, `So ${answerSay(it)}.`));
      scenes.push(concept('Where this breaks', c.ex.breaks.text, c.ex.breaks.say, c.ex.breaks.tex));
      break;
    }
    case 'story': {
      const st = c.ex.story;
      scenes.push(title(it.title, q, 'A small puzzle first.'));
      scenes.push(concept('The situation', st.setup, st.setup));
      scenes.push(concept('The question', st.bridge, st.bridge));
      scenes.push(problemScene(it, `In symbols, the question is: ${speak(q)}`));
      scenes.push(...stepsOf(it, 'plain', sd));
      if (check) scenes.push(checkScene(check));
      scenes.push(answerScene(it, `The math says ${answerSay(it)}.`));
      const closing = st.close.replace('{answer}', it.answer.display);
      scenes.push(concept('Back to the story', closing, st.close.replace('{answer}', answerSay(it))));
      break;
    }
  }
  return scenes;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const askBody = (s: string) => cap(s.replace(/^What we (?:are )?really (?:asking|want)(?: is)?:?\s*/, ''));

// ---------- lecture ----------

/** Examples at rising difficulty, focused on the subtopic when it can be shown. */
export function examplesFor(topic: Topic, sub: Subtopic | undefined, count: number, seed: number): Item[] {
  const diffs: Difficulty[] = sub ? sub.difficulties : [1, 2, 3];
  const plan: Difficulty[] = [];
  for (let i = 0; i < count; i++) plan.push(count === 1 ? diffs[0]! : diffs[Math.min(diffs.length - 1, Math.round((i * (diffs.length - 1)) / (count - 1)))]!);
  const seen = new Set<string>();
  const out: Item[] = [];
  plan.forEach((d, i) => {
    let found: Question | null = null;
    for (let k = 0; k < 400 && !found; k++) {
      const q = generate(topic, { difficulty: d, seed: (seed + 104729 * i + 31 * k) >>> 0 });
      if (!seen.has(q.prompt) && questionMatches(q, sub)) found = q;
    }
    if (!found) found = generate(topic, { difficulty: d, seed: (seed + i) >>> 0 });
    seen.add(found.prompt);
    out.push(fromQuestion(found));
  });
  return out;
}

const ORD = ['First example', 'Second example', 'Third example', 'Fourth example', 'Fifth example'];

export function buildLecture(style: StyleId, ex: Item[], c: Ctx, name: string): Scene[] {
  const sd = c.seed;
  const note = c.note;
  const r = mainRule(c);
  const scenes: Scene[] = [];
  const caveat = c.sub?.caveat;
  const rules = c.sub?.rule ? [c.sub.rule] : note.rules;
  const avoid = ex.map((e) => e.text);
  const practice = (lead: string) => practiceScene(practiceQuestion(note.id, c.sub, sd, avoid, undefined, c.sub?.difficulties[c.sub.difficulties.length - 1] ?? 2), lead);
  const say = (e: Item, i: number, lead?: string) => `${lead ?? `${ORD[i] ?? 'Next example'}.`} ${speak(e.text)}`;
  const answer = (e: Item, lead = 'So the answer is') => answerScene(e, `${lead} ${answerSay(e)}.`);

  switch (style) {
    case 'chalkboard': {
      scenes.push(title(name, 'A slow walk through the idea', pick([`Let us talk about ${name.toLowerCase()}, slowly and properly.`, `Today: ${name.toLowerCase()}. No rush.`], sd, 2)));
      scenes.push(concept('What is it?', note.definition, `${note.defSay} ${note.hook}`, note.definitionTex));
      scenes.push(ruleScene(r, `Here is the rule we will lean on. ${r.say}`));
      if (caveat) scenes.push(concept('A note on the examples', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, i === 0 ? `Let us try one together. ${speak(e.text)} So what are we really asking here? ${askBody(note.asking)}` : `One more, a little harder. ${speak(e.text)}`, i === 0 ? 'Together' : 'One more'));
        scenes.push(...stepsOf(e, i === 0 ? 'slow' : 'plain', sd + i));
        scenes.push(answer(e));
      });
      scenes.push(concept('The big idea', note.bigIdea, `So, stepping back. ${note.bigIdea}`));
      break;
    }
    case 'marker': {
      scenes.push(title(name, 'Pattern, rule, examples', `${name}. Here is the pattern.`));
      scenes.push(concept('The pattern', `When you see ${note.pattern.see}: ${note.pattern.think}.`, `When you see ${note.pattern.see}, ${note.pattern.think}.`));
      for (const rr of rules) scenes.push(ruleScene(rr));
      if (caveat) scenes.push(concept('Note', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, speak(e.text), `${i + 1}`));
        scenes.push(...stepsOf(e, 'brisk', sd + i));
        scenes.push(answer(e, 'Answer:'));
      });
      break;
    }
    case 'visual': {
      const first = ex[0]!;
      const pic = pictureFor(first);
      scenes.push(title(name, 'See it first', `${name}, starting with a picture.`));
      scenes.push(graphScene({ ...note.graph }, note.graph.say));
      scenes.push(concept('What to notice', note.graphHelps, `What to notice. ${note.graphHelps}`));
      scenes.push(ruleScene(r, `Now the rule that describes what we just saw. ${r.say}`));
      if (caveat) scenes.push(concept('A note on the examples', caveat, caveat));
      ex.forEach((e, i) => {
        const p = i === 0 ? pic : pictureFor(e);
        scenes.push(problemScene(e, say(e, i)));
        scenes.push(graphScene(p, undefined, false));
        scenes.push(...stepsOf(e, 'plain', sd + i));
        scenes.push(answer(e));
        if (p.mark?.length) scenes.push(graphScene(p, 'And there it is on the picture.'));
      });
      scenes.push({ kind: 'summary', points: note.summary, say: `In short: ${note.summary.map(speak).join(' ')}` });
      break;
    }
    case 'lecture': {
      const w = mainWhy(c);
      scenes.push(title(name, 'Definition, rule, reasons, examples', `This lecture covers ${name.toLowerCase()}: what it is, the rule, why the rule works, two examples, and a common mistake.`));
      scenes.push(concept('Definition', note.definition, note.defSay, note.definitionTex));
      for (const rr of rules) scenes.push(ruleScene(rr));
      scenes.push(concept(w.heading, w.intro, `Why does this work? ${w.intro}`));
      scenes.push(...w.steps.map((l) => lineStep(l, 'second')));
      if (caveat) scenes.push(concept('About the examples', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, say(e, i), ORD[i] ?? 'Example'));
        scenes.push(...stepsOf(e, 'plain', sd + i));
        const ch = i === ex.length - 1 ? checkFor(e) : null;
        if (ch) scenes.push(checkScene(ch));
        scenes.push(answer(e, 'Therefore'));
      });
      for (const m of c.sub?.mistake ? [c.sub.mistake] : note.mistakes) scenes.push(mistakeScene(m, 'A common mistake. '));
      scenes.push(concept('Where it shows up', note.hook, note.hook));
      scenes.push({ kind: 'summary', points: note.summary, say: `To summarise. ${note.summary.map(speak).join(' ')}` });
      break;
    }
    case 'socratic': {
      scenes.push(title(name, 'Questions first', `Let us explore ${name.toLowerCase()} by asking questions.`));
      scenes.push(concept('A question to start', note.asking, `${note.asking} Hold that question in mind.`));
      scenes.push({ kind: 'pause', prompt: `What do you already know about ${name.toLowerCase()}?`, seconds: 6, say: 'Before I say anything else, what do you already know about this? Take a moment.' });
      scenes.push(ruleScene(r, `Here is the rule. ${r.say}`));
      if (caveat) scenes.push(concept('About the examples', caveat, caveat));
      ex.forEach((e, i) => {
        const n = e.steps.length;
        scenes.push(problemScene(e, say(e, i)));
        scenes.push({ kind: 'pause', prompt: 'What would you do first?', seconds: 6, say: 'What would you do first?' });
        if (n > 1) scenes.push(...stepsOf(e, 'plain', sd + i, 0, n - 1));
        scenes.push({ kind: 'pause', prompt: 'And the final step?', seconds: 5, say: 'What finishes it?' });
        scenes.push(...stepsOf(e, 'plain', sd + i, n - 1));
        scenes.push(answer(e));
      });
      scenes.push(practice('Your turn. Try this one, then check the answer at the end.'));
      break;
    }
    case 'exam': {
      scenes.push(title(name, 'Exam technique', `${name} for the exam: recognise it, solve it fast, avoid the trap.`));
      scenes.push(concept('Spot the pattern', `When you see ${note.pattern.see}, think: ${note.pattern.think}.`, `When you see ${note.pattern.see}, think: ${note.pattern.think}.`));
      for (const rr of rules) scenes.push(ruleScene(rr, `The fast method. ${rr.say}`));
      if (caveat) scenes.push(concept('Note', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, speak(e.text), `Q${i + 1}`));
        scenes.push(...stepsOf(e, 'brisk', sd + i));
        scenes.push(answer(e, 'Answer:'));
      });
      scenes.push(mistakeScene(mainMistake(c), 'The classic trap. '));
      const ch = checkFor(ex[ex.length - 1]!);
      scenes.push(concept('Time-saving check', c.note.checkTip, c.note.checkTip));
      if (ch) scenes.push(checkScene(ch, 'second', 'On the last question, '));
      scenes.push(practice('Practice question. Give yourself a minute.'));
      break;
    }
    case 'quick': {
      const e = ex[0]!;
      const key = [...e.steps].reverse().find((s) => hasTex(s.tex)) ?? e.steps[e.steps.length - 1];
      scenes.push(title(name, 'In about a minute', `${name} in about a minute.`));
      scenes.push(ruleScene(r));
      scenes.push(concept('The idea', note.oneIdea, `The idea: ${note.oneIdea}`));
      scenes.push(problemScene(e, `For example: ${speak(e.text)}`));
      if (key) scenes.push(step(key.text, key.tex, speak(key.text), 'good'));
      scenes.push(answer(e, 'Answer:'));
      scenes.push(mistakeScene(mainMistake(c), 'One thing to watch: '));
      break;
    }
    case 'beginner': {
      const ec = c.ex.easyCheck;
      scenes.push(title(name, 'From the very beginning', `${name}, from the very beginning. Nothing is assumed, and nobody is being tested.`));
      scenes.push(concept('Words we will use', c.ex.terms.map((t) => `${t.term}: ${t.meaning}`).join('. ') + '.', `First, a few words. ${c.ex.terms.map((t) => `${cap(t.term)} means ${t.meaning}.`).join(' ')}`));
      scenes.push(concept('Think of it like this', c.ex.analogy, c.ex.analogy));
      scenes.push(concept('What it is', note.definition, note.defSay, note.definitionTex));
      scenes.push(ruleScene(r, `Here is the one rule to hold on to. ${r.say}`));
      scenes.push({ kind: 'pause', prompt: ec.prompt, seconds: 5, say: `Quick warm-up. ${ec.prompt}` });
      scenes.push(concept('Warm-up answer', ec.answer, `${ec.answer} Good.`));
      if (caveat) scenes.push(concept('About the examples', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, i === 0 ? `Our first example. ${speak(e.text)} One small step at a time.` : `Another one, using exactly the same steps. ${speak(e.text)}`));
        scenes.push(...stepsOf(e, 'tiny', sd + i));
        scenes.push(answer(e, 'And we are done:'));
      });
      scenes.push({ kind: 'summary', points: note.summary, say: `Here is everything on one card. ${note.summary.map(speak).join(' ')} That is genuinely all of it.` });
      break;
    }
    case 'proof': {
      const w = mainWhy(c);
      scenes.push(title(name, 'Why it is true, then how to use it', `${name}: first we prove the rule, then we use it, then we find where it fails.`));
      scenes.push(concept('Definition', note.definition, note.defSay, note.definitionTex));
      scenes.push(concept(w.heading, w.intro, `Claim: the rule below holds. ${w.intro}`));
      scenes.push(...w.steps.map((l, i) => lineStep(l, i === w.steps.length - 1 ? 'good' : 'second')));
      scenes.push(ruleScene(r, `That justifies the rule. ${r.say}`));
      if (caveat) scenes.push(concept('About the examples', caveat, caveat));
      ex.forEach((e, i) => {
        scenes.push(problemScene(e, i === 0 ? `Now an application. ${speak(e.text)}` : `And a harder one. ${speak(e.text)}`, i === 0 ? 'Application' : 'Harder'));
        scenes.push(...stepsOf(e, 'plain', sd + i));
        scenes.push(answer(e, 'So'));
      });
      scenes.push(concept('Where this breaks', c.ex.breaks.text, c.ex.breaks.say, c.ex.breaks.tex));
      break;
    }
    case 'story': {
      const st = c.ex.story;
      const first = ex[0]!;
      scenes.push(title(name, 'A puzzle first', 'Start with a small puzzle.'));
      scenes.push(concept('The situation', st.setup, st.setup));
      scenes.push(concept('The question', st.bridge, st.bridge));
      scenes.push(concept('The tool', note.definition, note.defSay, note.definitionTex));
      scenes.push(ruleScene(r));
      if (caveat) scenes.push(concept('About the examples', caveat, caveat));
      ex.slice(1).forEach((e, i) => {
        scenes.push(problemScene(e, `A warm-up of the same kind. ${speak(e.text)}`, 'Warm-up'));
        scenes.push(...stepsOf(e, 'plain', sd + i + 1));
        scenes.push(answer(e));
      });
      scenes.push(problemScene(first, `Now the story's question, in symbols. ${speak(first.text)}`, 'The story'));
      scenes.push(...stepsOf(first, 'plain', sd));
      scenes.push(answer(first, 'The math gives'));
      scenes.push(concept('Back to the story', st.close.replace('{answer}', first.answer.display), st.close.replace('{answer}', answerSay(first))));
      break;
    }
  }
  return scenes;
}

export type { LessonScript };
