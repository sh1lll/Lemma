/**
 * buildExam: fills every section slot of a profile with a question that has a verified answer — a variant
 * of the student's own question when Lemma can recompute it, otherwise a practice-engine question of
 * the same topic, difficulty and type.
 */
import { generate, TOPICS, type Difficulty, type Question, type Topic } from '@lemma/practice-engine';
import type { Choice, Exam, ExamProfile, ExamQuestion, Part, QuestionType, Section } from './types';
import { distractors } from './distractors';
import { answerKind, evalNumber, formatLike, fractionOf, gradable, matches, near, solve, trimNum } from './math';
import { familyRules, parseSlot, type FamilyRules, type SlotType } from './presets';
import { pretty } from './text';
import { allocate, clamp, hashString, mixSeed, Rng, slug } from './util';
import { makeVariant, solveImported } from './variants';

export const QC_CHOICES: Choice[] = [
  { id: 'A', text: 'Quantity A is greater.' },
  { id: 'B', text: 'Quantity B is greater.' },
  { id: 'C', text: 'The two quantities are equal.' },
  { id: 'D', text: 'The relationship cannot be determined from the information given.' },
];

interface SlotPlan {
  type: SlotType;
  points: number;
  topic: Topic;
  difficulty: Difficulty;
  template?: ExamQuestion;
  choices: number;
  calculator: boolean;
}

interface Ctx {
  rules: FamilyRules;
  imported: ExamQuestion[];
  used: Set<string>;
  reuse: boolean;
  family: ExamProfile['family'];
}

const LETTERS = 'ABCDEFGH';
const EXPRESSION_TOPICS: Topic[] = ['derivative', 'integral', 'exponents'];

// ---------- helpers ----------

function stripVar(display: string): string {
  return display.replace(/^\s*[a-z]\s*=\s*/i, '').trim();
}

/** Plain number for numeric entry: "$3,943.81" → "3943.81", "35 ft²" → "35", "x = 1/4" → "1/4". */
function bareNumber(display: string): string | null {
  if (/π|√/.test(display)) return null;
  const s = stripVar(display).replace(/\$/g, '').replace(/,(?=\d{3})/g, '');
  const m = /^[−-]?\d+(?:\.\d+)?(?:\/\d+)?/.exec(s.replace(/−/g, '-'));
  if (!m) return null;
  const v = evalNumber(m[0]);
  return v === null ? null : pretty(m[0]);
}

function shuffleChoices(key: string, wrong: string[], rng: Rng): { choices: Choice[]; answer: string } {
  const texts = rng.shuffle([key, ...wrong]);
  const choices = texts.map((text, i) => ({ id: LETTERS[i]!, text }));
  return { choices, answer: choices[texts.indexOf(key)]!.id };
}

function partsFromQuestions(qs: Question[], points: number[], labels: string[]): Part[] {
  return qs.map((g, i) => {
    const kind = g.answer.kind;
    return { label: labels[i]!, prompt: g.prompt, points: points[i]!, answer: g.answer.display, type: kind === 'expression' ? 'expression' : 'numeric' };
  });
}

function splitPoints(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  const out = Array.from({ length: n }, () => base);
  out[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100;
  return out;
}

/** A generated question whose answer suits the slot type (numeric entry needs a plain number, etc.). */
function generateFor(topic: Topic, difficulty: Difficulty, type: SlotType, seed: number): Question | null {
  // Prefer hand-writable answers (no radicals): try the asked difficulty, then one easier, then accept radicals.
  const tries: [Difficulty, boolean][] = [];
  for (let k = 0; k < 8; k++) tries.push([difficulty, false]);
  if (difficulty > 1) for (let k = 0; k < 6; k++) tries.push([(difficulty - 1) as Difficulty, false]);
  for (let k = 0; k < 4; k++) tries.push([difficulty, true]);
  for (const [k, [d, radicalsOk]] of tries.entries()) {
    const g = generate(topic, { difficulty: d, seed: mixSeed(seed, k) });
    if (!radicalsOk && /√/.test(g.answer.display)) continue;
    const kind = g.answer.kind;
    if (type === 'expression' && kind !== 'expression') continue;
    if ((type === 'numeric' || type === 'qc') && kind === 'expression') continue;
    if (type === 'numeric' && kind === 'number' && !bareNumber(g.answer.display)) continue;
    if (type === 'numeric' && kind === 'set' && /√/.test(g.answer.display)) continue;
    if (type === 'numeric' && kind === 'pair' && /\//.test(g.answer.display)) continue;
    if ((type === 'mc' || type === 'qc' || type === 'multi') && /√/.test(g.answer.display)) continue;
    return g;
  }
  return null;
}

// ---------- question makers ----------

function mcFrom(prompt: string, key: string, topic: Topic, n: number, rng: Rng): { choices: Choice[]; answer: string } {
  return shuffleChoices(key, distractors(key, n - 1, { prompt, topic, rng }), rng);
}

/** Quantitative comparison from a generated computation. */
function qcFrom(g: Question, rng: Rng): { prompt: string; answer: string } | null {
  const p = g.prompt.replace(/\s+/g, ' ');
  if (g.answer.kind === 'set') {
    const eq = /^Solve (.+)\.$/.exec(p)?.[1];
    const roots = (g.answer.display.match(/[−-]?\d+(?:\/\d+)?/g) ?? []).map((r) => evalNumber(r)!).filter((v) => v !== null);
    if (!eq || roots.length < 2) return null;
    const lo = Math.min(...roots), hi = Math.max(...roots);
    const mode = rng.int(0, 2);
    const b = mode === 0 ? Math.floor(lo) - rng.int(1, 3) : mode === 1 ? Math.ceil(hi) + rng.int(1, 3) : Math.round((lo + hi) / 2 * 2) / 2;
    const answer = b < lo ? 'A' : b > hi ? 'B' : 'D';
    if (near(b, lo) || near(b, hi)) return null;
    return { prompt: `${eq}\nQuantity A: x\nQuantity B: ${pretty(trimNum(b))}`, answer };
  }
  if (g.answer.kind !== 'number') return null;
  const bare = bareNumber(g.answer.display);
  if (!bare) return null;
  const v = evalNumber(bare)!;
  let a: string;
  let info = '';
  const lin = /^Solve (.+= .+)\.$/.exec(p);
  const evalM = /^(?:Evaluate|Calculate) (.+?)\.(?: Give the answer in simplest form\.)?$/.exec(p);
  const pct = /^What is (\d+(?:\.\d+)?% of [\d,.$]+)\?$/.exec(p);
  if (lin) [info, a] = [lin[1]!, 'x'];
  else if (evalM) a = evalM[1]!;
  else if (pct) a = pct[1]!;
  else {
    const find = /^Find (the .+?)\.?$/i.exec(p) ?? /^What is (.+?)\?$/i.exec(p);
    a = find ? find[1]!.charAt(0).toUpperCase() + find[1]!.slice(1) : `The answer to: ${p}`;
  }
  const r = rng.int(0, 2);
  const step = Number.isInteger(v) ? rng.int(1, 3) : 0.25;
  const b = r === 0 ? v : r === 1 ? v + step : v - step;
  const answer = near(v, b) ? 'C' : v > b ? 'A' : 'B';
  const bShown = Number.isInteger(b) ? String(b) : formatLike(b, fractionOf(b, 12) ? '1/2' : '0.25');
  return { prompt: `${info ? info + '\n' : ''}Quantity A: ${a}\nQuantity B: ${pretty(bShown)}`, answer };
}

/** Select-all: solutions of a quadratic, or values equal to a computed answer. */
function multiFrom(g: Question, n: number, rng: Rng): { prompt: string; choices: Choice[]; answer: string[] } | null {
  if (g.answer.kind === 'set' && !/√/.test(g.answer.display)) {
    const eq = /^Solve (.+)\.$/.exec(g.prompt)?.[1];
    const roots = (g.answer.display.match(/[−-]?\d+(?:\/\d+)?/g) ?? []).map((r) => pretty(r));
    if (!eq || roots.length < 2) return null;
    const vals = roots.map((r) => evalNumber(r)!);
    const wrong: string[] = [];
    for (const c of [...vals.map((v) => -v), ...vals.map((v) => v + 1), ...vals.map((v) => v - 1), ...vals.map((v) => v * 2)]) {
      const s = pretty(formatLike(c, roots[0]!.replace(/^[−-]/, '')));
      if (!vals.some((v) => near(v, c)) && !wrong.includes(s) && !roots.includes(s)) wrong.push(s);
    }
    const texts = rng.shuffle([...roots, ...wrong.slice(0, Math.max(1, n - roots.length))]);
    const choices = texts.map((text, i) => ({ id: LETTERS[i]!, text }));
    return { prompt: `Which of the following are solutions of ${eq}? Select all that apply.`, choices, answer: choices.filter((c) => roots.includes(c.text)).map((c) => c.id) };
  }
  const bare = bareNumber(g.answer.display);
  if (!bare) return null;
  const v = evalNumber(bare)!;
  const forms = new Set<string>([pretty(bare)]);
  const f = fractionOf(v, 100);
  if (f && f.d !== 1) forms.add(pretty(`${f.n}/${f.d}`)).add(pretty(`${f.n * 2}/${f.d * 2}`));
  if (Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-9) forms.add(pretty(String(v)));
  if (f && f.d === 1) forms.add(pretty(`${v * 2}/2`)).add(pretty(`${v * 3}/3`));
  const right = [...forms].slice(0, 3);
  const wrong = distractors(right[0]!, n - right.length, { prompt: g.prompt, topic: g.topic, rng });
  const texts = rng.shuffle([...right, ...wrong]);
  const choices = texts.map((text, i) => ({ id: LETTERS[i]!, text }));
  return { prompt: `${g.prompt} Select all choices that are equal to the answer.`, choices, answer: choices.filter((c) => right.includes(c.text)).map((c) => c.id) };
}

/** A fresh question of the slot's type from practice-engine. */
function generated(plan: SlotPlan, seed: number, ctx: Ctx): Omit<ExamQuestion, 'id' | 'number'> | null {
  const rng = new Rng(mixSeed(seed, 7));
  const base = { points: plan.points, topic: plan.topic, difficulty: plan.difficulty, calculator: plan.calculator, origin: 'generated' as const };
  const topicsToTry: Topic[] = plan.type === 'expression' ? [plan.topic, ...EXPRESSION_TOPICS] : [plan.topic, 'linear', 'arithmetic', 'percent', 'fractions'];
  for (const [ti, topic] of topicsToTry.entries()) {
    const g = generateFor(topic, plan.difficulty, plan.type, mixSeed(seed, 100 + ti));
    if (!g) continue;
    const steps = g.steps.map((s) => ({ ...s }));
    const withTopic = { ...base, topic };
    switch (plan.type) {
      case 'mc': {
        const { choices, answer } = mcFrom(g.prompt, g.answer.display, topic, plan.choices, rng);
        if (choices.length < plan.choices) continue;
        return { ...withTopic, type: 'mc', prompt: g.prompt, choices, answer, steps };
      }
      case 'qc': {
        const qc = qcFrom(g, rng);
        if (!qc) continue;
        return { ...withTopic, type: 'mc', prompt: qc.prompt, choices: QC_CHOICES.map((c) => ({ ...c })), answer: qc.answer, steps };
      }
      case 'multi': {
        const m = multiFrom(g, Math.max(5, plan.choices), rng);
        if (!m || m.answer.length < 1) continue;
        return { ...withTopic, type: 'multi', prompt: m.prompt, choices: m.choices, answer: m.answer, steps };
      }
      case 'numeric': {
        let prompt = g.prompt;
        let answer: string | null;
        if (g.answer.kind === 'set') {
          const roots = (g.answer.display.match(/[−-]?\d+(?:\/\d+)?/g) ?? []).map((r) => evalNumber(r)!);
          const hi = Math.max(...roots);
          answer = pretty(trimNum(hi));
          prompt += roots.length > 1 ? ' Enter the greater solution.' : '';
        } else if (g.answer.kind === 'pair') {
          answer = bareNumber(/x\s*=\s*([^,]+)/.exec(g.answer.display)?.[1] ?? '');
          prompt += ' Enter the value of x.';
        } else answer = bareNumber(g.answer.display);
        if (!answer) continue;
        return { ...withTopic, type: 'numeric', prompt, answer, steps };
      }
      case 'expression':
        return { ...withTopic, type: 'expression', prompt: g.prompt, answer: g.answer.display, steps };
      case 'short':
        return { ...withTopic, type: 'short', prompt: g.prompt, answer: g.answer.display, steps };
      case 'free': {
        const tplParts = plan.template?.parts?.filter((p) => p.answer !== undefined);
        const nParts = tplParts?.length || (plan.points >= 9 ? 3 : 2);
        const qs: Question[] = [g];
        for (let k = 1; k < nParts; k++) {
          const d = clamp(plan.difficulty - 1 + k, 1, 3) as Difficulty;
          const next = generateFor(topic, d, 'short', mixSeed(seed, 200 + k));
          if (next && !qs.some((x) => x.prompt === next.prompt)) qs.push(next);
        }
        const labels = tplParts?.length === qs.length ? tplParts.map((p) => p.label) : ['a', 'b', 'c', 'd', 'e'];
        const pts = tplParts?.length === qs.length && tplParts.every((p) => p.points > 0) ? tplParts.map((p) => p.points) : splitPoints(plan.points, qs.length);
        const parts = partsFromQuestions(qs, pts, labels);
        const label = TOPICS.find((t) => t.id === topic)?.label ?? topic;
        return { ...withTopic, type: 'free', prompt: `${label}: answer each part. Show your work.`, parts, steps: qs.flatMap((x, i) => x.steps.map((s) => ({ ...s, text: `(${labels[i]}) ${s.text}` }))) };
      }
    }
  }
  return null;
}

/** A variant of an imported question in the slot's type, or the imported question itself when reusing. */
function fromImported(src: ExamQuestion, plan: SlotPlan, seed: number, ctx: Ctx): Omit<ExamQuestion, 'id' | 'number'> | null {
  const rng = new Rng(mixSeed(seed, 11));
  const base = { points: plan.points, topic: src.topic ?? plan.topic, difficulty: plan.difficulty, calculator: plan.calculator };
  if (ctx.reuse && plan.template === src && reusable(src)) {
    const copy = structuredClone(src);
    const steps = solveImported(src)?.steps;
    return { ...copy, ...base, type: src.type, origin: 'imported', ...(steps ? { steps } : {}) };
  }
  if (plan.type === 'qc' || plan.type === 'multi') return null;
  const v = makeVariant(src, rng);
  if (!v) return null;
  // A free-response stem used as a single-answer item drops its "show your work" sentence.
  if (plan.type !== 'free') v.prompt = v.prompt.replace(/\s*Show (?:all )?(?:of )?your work\.?/i, '').trim();
  const figure = src.figure ? { figure: src.figure } : {};
  switch (plan.type) {
    case 'mc': {
      const keyChoice = src.choices?.find((c) => c.id === src.answer)?.text;
      const key = keyChoice && !/=/.test(keyChoice) ? stripVar(v.answer).replace(/\b[a-z]\s*=\s*/gi, '') : v.answer;
      const { choices, answer } = mcFrom(v.prompt, pretty(key), base.topic, plan.choices, rng);
      if (choices.length < plan.choices) return null;
      return { ...base, ...figure, type: 'mc', prompt: v.prompt, choices, answer, steps: v.steps, origin: 'variant' };
    }
    case 'numeric': {
      const ans = answerKind(v.answer) === 'number' ? bareNumber(v.answer) : null;
      if (!ans) return null;
      return { ...base, ...figure, type: 'numeric', prompt: v.prompt, answer: ans, steps: v.steps, origin: 'variant' };
    }
    case 'expression':
      if (answerKind(v.answer) !== 'expression') return null;
      return { ...base, ...figure, type: 'expression', prompt: v.prompt, answer: v.answer, steps: v.steps, origin: 'variant' };
    case 'short':
    case 'free':
      return { ...base, ...figure, type: plan.type, prompt: v.prompt, answer: v.answer, steps: v.steps, origin: 'variant' };
  }
  return null;
}

/** An imported question can be used verbatim when its key is present and Lemma doesn't contradict it. */
function reusable(q: ExamQuestion): boolean {
  if (q.parts?.length) return q.parts.every((p) => p.answer !== undefined || p.rubric?.length);
  if (q.answer === undefined) return false;
  const key = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
  // Lemma must not contradict the teacher's key when it can solve the question.
  if (solve(q.prompt) && !solveImported(q)) return false;
  if (q.choices) return true;
  return gradable(key) || q.type === 'short';
}

// ---------- verification ----------

/** Checks a built question: key present, choices distinct, key among choices exactly once, gradable keys. */
export function verifyQuestion(q: ExamQuestion): string[] {
  const problems: string[] = [];
  if (q.choices) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
    const texts = q.choices.map((c) => norm(c.text));
    if (new Set(texts).size !== texts.length) problems.push('duplicate choice text');
    if (new Set(q.choices.map((c) => c.id)).size !== q.choices.length) problems.push('duplicate choice id');
    const keys = Array.isArray(q.answer) ? q.answer : q.answer !== undefined ? [q.answer] : [];
    if (!keys.length) problems.push('no key');
    for (const k of keys) if (!q.choices.some((c) => c.id === k)) problems.push(`key ${k} not among choices`);
    if (q.type === 'mc' && keys.length !== 1) problems.push('mc needs exactly one key');
    if (q.type === 'mc' && keys.length === 1 && !/quantity a/i.test(q.prompt)) {
      const keyText = q.choices.find((c) => c.id === keys[0])?.text ?? '';
      const equal = q.choices.filter((c) => c.id !== keys[0] && safeMatch(keyText, c.text));
      if (equal.length) problems.push(`distractor ${equal[0]!.id} equals the key`);
    }
  } else if (q.parts?.length) {
    for (const p of q.parts) if (!(p.answer !== undefined ? gradable(p.answer) : p.rubric?.length)) problems.push(`part ${p.label} has no verified key`);
  } else if (q.answer === undefined) {
    problems.push('no key');
  } else if (!gradable(Array.isArray(q.answer) ? q.answer.join(', ') : q.answer) && q.origin !== 'imported') problems.push('key is not machine-gradable');
  return problems;
}

function safeMatch(a: string, b: string): boolean {
  try {
    return matches(a, b).correct;
  } catch {
    return false;
  }
}

// ---------- planning ----------

function rampDifficulty(i: number, n: number, lo: number, hi: number): Difficulty {
  if (n <= 1) return lo as Difficulty;
  return clamp(lo + Math.floor(((hi - lo + 1) * i) / n), lo, hi) as Difficulty;
}

function planSection(ids: string[], profile: ExamProfile, section: Section, byId: Map<string, ExamQuestion>, rules: FamilyRules, rng: Rng, range: [number, number]): SlotPlan[] {
  const weights = profile.topics.length ? profile.topics.map((t) => ({ key: t.topic, weight: t.weight })) : TOPICS.map((t) => ({ key: t.id, weight: 1 }));
  const nonTemplate = ids.filter((id) => !byId.has(id)).length;
  const topicPool = rng.shuffle(allocate(nonTemplate, weights).flatMap((a) => Array.from({ length: a.count }, () => a.key)));
  const mixTypes = allocate(ids.length, Object.entries(profile.mix).map(([k, w]) => ({ key: k as QuestionType, weight: w ?? 0 }))).flatMap((a) => Array.from({ length: a.count }, () => a.key));
  let t = 0;
  return ids.map((id, i) => {
    const tpl = byId.get(id);
    const difficulty = rampDifficulty(i, ids.length, range[0], range[1]);
    if (tpl) {
      const isQc = /quantity a/i.test(tpl.prompt);
      return { type: isQc ? 'qc' : tpl.type, points: tpl.points, topic: tpl.topic ?? topicPool[0] ?? 'linear', difficulty: (range[0] === 1 && range[1] === 3 ? tpl.difficulty ?? difficulty : difficulty) as Difficulty, template: tpl, choices: tpl.choices?.length ?? rules.choices, calculator: section.calculator };
    }
    const spec = parseSlot(id);
    const type: SlotType = spec?.type ?? mixTypes[i] ?? 'mc';
    return { type, points: spec?.points ?? 1, topic: topicPool[t++] ?? 'linear', difficulty, choices: rules.choices, calculator: section.calculator };
  });
}

// ---------- main ----------

export function buildExam(profile: ExamProfile, sources: { imported: ExamQuestion[] }, opts: { seed?: number; reuseImported?: boolean; now?: number } = {}): Exam {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const rules = familyRules(profile.family, profile);
  const imported = sources.imported.filter((q) => q.prompt);
  const byId = new Map(imported.map((q) => [q.id, q]));
  const ctx: Ctx = { rules, imported, used: new Set(), reuse: !!opts.reuseImported, family: profile.family };
  const examId = `exam-${slug(profile.id)}-${seed.toString(36)}`;
  const questions: ExamQuestion[] = [];
  const sections: Section[] = [];
  let running = 0;
  let slotIndex = 0;

  const fill = (ids: string[], section: Section, range: [number, number], tag: string, numberFrom: number): string[] => {
    const rng = new Rng(mixSeed(seed, hashString(section.id + tag)));
    const plans = planSection(ids, profile, section, byId, rules, rng, range);
    const out: string[] = [];
    plans.forEach((plan, i) => {
      const s = mixSeed(seed, ++slotIndex * 7919);
      let q: Omit<ExamQuestion, 'id' | 'number'> | null = null;
      // 1) the template itself (variant / reuse); 2) another imported question on this topic; 3) generated.
      if (plan.template) q = fromImported(plan.template, plan, s, ctx);
      if (!q && !plan.template) {
        for (const cand of imported) {
          if (ctx.used.has(cand.id) || cand.topic !== plan.topic || /quantity a/i.test(cand.prompt)) continue;
          q = fromImported(cand, plan, s, ctx);
          if (q) {
            ctx.used.add(cand.id);
            break;
          }
        }
      }
      for (let retry = 0; (!q || verifyQuestion(q as ExamQuestion).length) && retry < 6; retry++) q = generated(plan, mixSeed(s, retry), ctx);
      if (!q || verifyQuestion(q as ExamQuestion).length) q = generated({ ...plan, topic: 'arithmetic', difficulty: 1 }, s, ctx);
      if (!q) throw new Error(`could not fill slot ${ids[i]}`);
      const id = `${examId}-${section.id}${tag}-${String(i + 1).padStart(2, '0')}`;
      const number = rules.numberPerSection ? numberFrom + i : ++running;
      const full: ExamQuestion = { ...q, id, number } as ExamQuestion;
      if (plan.template && plan.template.figure && !full.figure && full.origin !== 'generated') full.figure = plan.template.figure;
      questions.push(full);
      out.push(id);
    });
    return out;
  };

  for (const s of profile.sections) {
    const copy: Section = structuredClone(s);
    if (s.adaptive) {
      const easy = fill(s.adaptive.easy, s, [1, 2], 'e', 1);
      const hard = fill(s.adaptive.hard, s, [2, 3], 'h', 1);
      copy.adaptive = { ...s.adaptive, easy, hard };
      copy.questionIds = [];
    } else {
      copy.questionIds = fill(s.questionIds, s, [1, 3], '', 1);
    }
    sections.push(copy);
  }

  return { id: examId, profile: { ...structuredClone(profile), sections }, questions, createdAt: opts.now ?? Date.now(), seed };
}

/** The question ids a student sees in a section, given the adaptive route ('easy' | 'hard'). */
export function sectionQuestionIds(section: Section, route?: 'easy' | 'hard'): string[] {
  if (!section.adaptive) return section.questionIds;
  return route === 'easy' ? section.adaptive.easy : section.adaptive.hard;
}
