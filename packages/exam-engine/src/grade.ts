/**
 * Grading: exact MC, select-all (partial credit only where the family uses it), numeric with format
 * tolerance (fractions ≡ decimals, SAT-style grid-in decimals), expression equivalence via practice-engine,
 * multi-part questions part by part (rubric-only parts are left to self-grading). Scores per profile.
 */
import type { Topic } from '@lemma/practice-engine';
import type { Attempt, Exam, ExamQuestion, Result, Section } from './types';
import { answerKind, evalNumber, gradable, matches, near } from './math';
import { familyRules, type FamilyRules } from './presets';
import { round } from './util';

interface Graded {
  earned: number;
  /** Points that were machine-graded (rubric-only parts excluded). */
  possible: number;
  correct: boolean | 'partial';
  expected?: string;
  feedback: string;
}

const clean = (s: string) => s.trim().replace(/−/g, '-');

/** Numeric answer check with the family's format rules. */
export function gradeNumeric(key: string, user: string, rules: Pick<FamilyRules, 'gridIn' | 'roundedOk'>, prompt = ''): { correct: boolean; feedback: string } {
  const u = clean(user);
  if (!u) return { correct: false, feedback: 'No answer.' };
  const kv = evalNumber(key);
  const uv = evalNumber(u);
  if (kv !== null && uv !== null) {
    if (near(uv, kv, 1e-9)) return { correct: true, feedback: 'Correct.' };
    const dec = /\.(\d+)$/.exec(u.replace(/^[a-z]\s*=\s*/i, ''))?.[1]?.length ?? 0;
    if (dec > 0) {
      const err = Math.abs(uv - kv);
      // Grid-in: a decimal that fills the answer space (5 characters; the minus sign doesn't count) may be
      // truncated or rounded: 2/3 → .6666, .6667, 0.666, 0.667 are accepted; .66, .67, 0.67 are not.
      const chars = u.replace(/^-/, '').length;
      if (rules.gridIn && chars >= 5 && err < 10 ** -dec) return { correct: true, feedback: 'Correct (decimal fills the answer space).' };
      const roundTo = /round(?:ed)? to (?:the nearest )?(\d+) decimal|nearest (tenth|hundredth|thousandth|cent)/i.exec(prompt);
      const places = roundTo ? (roundTo[1] ? Number(roundTo[1]) : { tenth: 1, hundredth: 2, thousandth: 3, cent: 2 }[roundTo[2]!.toLowerCase()]!) : null;
      if (places !== null && dec >= places && err <= 0.5 * 10 ** -places + 1e-9) return { correct: true, feedback: 'Correct (rounded as asked).' };
      const terminates = Math.abs(kv * 10 ** dec - Math.round(kv * 10 ** dec)) < 1e-9;
      if (rules.roundedOk && dec >= 2 && !terminates && err <= 0.5 * 10 ** -dec + 1e-9) return { correct: true, feedback: `Correct (rounded; exact answer ${key}).` };
      if (rules.gridIn && err < 10 ** -dec) return { correct: false, feedback: `Close, but a decimal answer must fill the answer space (e.g. ${kv.toFixed(4).replace(/^0/, '')}); exact answer ${key}.` };
    }
    if (near(uv, -kv, 1e-9) && kv !== 0) return { correct: false, feedback: `Check the sign; the answer is ${key}.` };
    return { correct: false, feedback: `Not quite; the answer is ${key}.` };
  }
  return matches(key, u, prompt);
}

const compact = (s: string) => s.toLowerCase().replace(/−/g, '-').replace(/\*/g, '').replace(/\s+/g, '').replace(/^[a-z](?:\([a-z]\))?=/, '');

/** Is there a + or − outside every bracket (after the leading sign)? */
function topLevelSum(s: string): boolean {
  let depth = 0;
  const t = compact(s);
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if ((c === '+' || c === '-') && depth === 0 && i > 0 && !/[*/^(e]/.test(t[i - 1]!)) return true;
  }
  return false;
}

/**
 * The top-level factors of a product ("2(x+3)(x-1)^2" → 2, (x+3), (x-1)^2), or null when it isn't one.
 * Each comes with its multiplicity (an integer exponent) and whether it has a variable in it.
 */
function productFactors(s: string): { text: string; times: number; variable: boolean }[] | null {
  const t = compact(s).replace(/^[-+]/, '');
  const out: { text: string; times: number; variable: boolean }[] = [];
  let i = 0;
  const power = () => {
    const m = /^\^(\d+)/.exec(t.slice(i)) ?? /^\^\((\d+)\)/.exec(t.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[1]);
  };
  while (i < t.length) {
    const c = t[i]!;
    if (c === '*' || c === '·' || c === '×') {
      i++;
      continue;
    }
    if (c === '(' || c === '[') {
      let depth = 0;
      const start = i;
      for (; i < t.length; i++) {
        if (t[i] === '(' || t[i] === '[') depth++;
        else if ((t[i] === ')' || t[i] === ']') && --depth === 0) break;
      }
      if (depth !== 0) return null;
      const text = t.slice(start + 1, i);
      i++;
      out.push({ text, times: power(), variable: /[a-z]/.test(text) });
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(t.slice(i));
    if (num) {
      i += num[0].length;
      out.push({ text: num[0], times: power(), variable: false });
      continue;
    }
    if (/[a-z]/.test(c)) {
      i++;
      out.push({ text: c, times: power(), variable: true });
      continue;
    }
    return null; // "/", "+" at top level, functions…: not a plain product
  }
  return out;
}

/** Integer coefficients of a polynomial factor like "2x+6" or "x^2+2x-3" (null if it isn't that simple). */
function intCoefficients(poly: string): number[] | null {
  const terms = poly.replace(/-/g, '+-').split('+').filter(Boolean);
  const out: number[] = [];
  for (const term of terms) {
    const m = /^(-?)(\d*)([a-z](?:\^\d+)?)*$/.exec(term);
    if (!m) return null;
    out.push(Number(m[2] || '1'));
  }
  return out;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/**
 * "Factor completely": an answer that is a product but has fewer non-constant factors than the key (counting
 * repeats) still has a factor that factors further, e.g. 2(x² + 2x − 3) for 2(x + 3)(x − 1). An answer that
 * leaves a common numeric factor inside a bracket, e.g. (2x + 6)(x − 1), hasn't taken out the GCF.
 */
function incompleteFactoring(key: string, user: string): string | null {
  const k = productFactors(key);
  const u = productFactors(user);
  if (!k || !u) return null;
  const count = (fs: typeof k) => fs.filter((f) => f.variable).reduce((n, f) => n + f.times, 0);
  // The bracket most likely to factor further: a sum with the highest power in it (x² − 1 rather than x + 1).
  const deg = (f: { text: string }) => Math.max(1, ...[...f.text.matchAll(/\^(\d+)/g)].map((m) => Number(m[1])), /[a-z]\*?[a-z]/.test(f.text) ? 2 : 1);
  const left = u.filter((f) => f.variable && /[+-]/.test(f.text.slice(1))).sort((a, b) => deg(b) - deg(a))[0];
  if (count(u) < count(k)) {
    return `Equivalent, but not factored completely${left ? `: ${left.text.replace(/\*/g, '')} still factors` : ''}.`;
  }
  const keyConst = k.filter((f) => !f.variable).reduce((n, f) => n * Number(f.text) ** f.times, 1);
  if (Math.abs(keyConst) > 1) {
    for (const f of u) {
      if (!f.variable || !/[+-]/.test(f.text.slice(1))) continue;
      const cs = intCoefficients(f.text);
      const g = cs ? cs.reduce(gcd, 0) : 1;
      if (g > 1) return `Equivalent, but not factored completely: take the common factor ${g} out of ${f.text}.`;
    }
  }
  return null;
}

/**
 * Questions that ask for a form ("Factor…", "Simplify…", "…in vertex form") are not answered by an equivalent
 * expression in the wrong form, least of all by the expression the question started with. Returns why, or null.
 */
export function formProblem(prompt: string, key: string, user: string): string | null {
  const p = prompt.toLowerCase();
  const u = compact(user);
  const k = compact(key);
  if (!u || u === k || answerKind(key) !== 'expression') return null;
  const asks = /\bfactor(?:ize)?\b(?!ing)/.test(p) && !/\bsolve\b/.test(p) ? 'factored' : /vertex form/.test(p) ? 'in vertex form' : /\bsimplif/.test(p) ? 'simplified' : /\bexpand|\bmultiply out|standard form/.test(p) ? 'expanded' : /\bwrite\b.*\bform\b|\brewrite\b|\bcombine like terms/.test(p) ? 'rewritten as asked' : null;
  if (!asks) return null;
  // The student's answer is (a copy of) the expression in the question.
  if (u.length >= 3 && /[a-z]/.test(u) && compact(prompt).includes(u) && !compact(prompt).includes(k)) return `That is the expression from the question; it still needs to be ${asks}.`;
  if (asks === 'factored' && !topLevelSum(key) && topLevelSum(user)) return 'Equivalent, but not factored: write it as a product.';
  if (asks === 'factored' && !topLevelSum(key)) {
    const why = incompleteFactoring(key, user);
    if (why) return why;
  }
  if (asks === 'in vertex form' && /\)\^2/.test(k) && !/\)\^2/.test(u)) return 'Equivalent, but not in vertex form a(x − h)^2 + k.';
  if (asks === 'expanded' && !/\)\s*(?:\^|\()/.test(k) && /\)\s*(?:\^|\()/.test(u)) return 'Equivalent, but not expanded: multiply it out.';
  return null;
}

function gradeValue(type: ExamQuestion['type'], key: string, user: string, rules: FamilyRules, prompt: string): { correct: boolean; feedback: string } | null {
  if (!user.trim()) return { correct: false, feedback: 'No answer.' };
  if (!gradable(key)) return null; // text key: needs a human
  if (type === 'numeric' || (evalNumber(key) !== null && evalNumber(clean(user)) !== null)) return gradeNumeric(key, user, rules, prompt);
  const r = matches(key, clean(user), prompt);
  if (r.correct) {
    const why = formProblem(prompt, key, clean(user));
    if (why) return { correct: false, feedback: `${why} The answer is ${key}.` };
  }
  return r;
}

function choiceText(q: ExamQuestion, id: string): string {
  return q.choices?.find((c) => c.id === id)?.text ?? '';
}

/** Grades one question. */
export function gradeQuestion(q: ExamQuestion, answer: Attempt['answers'][string] | undefined, rules: FamilyRules): Graded {
  const pts = q.points;
  if (q.type === 'mc' && q.choices) {
    const key = String(q.answer ?? '');
    const expected = `${key}. ${choiceText(q, key)}`;
    let u = typeof answer === 'string' ? answer.trim() : Array.isArray(answer) ? (answer[0] ?? '') : '';
    if (u.length > 1) u = q.choices.find((c) => c.text.replace(/\s+/g, '') === u.replace(/\s+/g, ''))?.id ?? u.replace(/^\(?([A-Ha-h])[.)]?$/, '$1');
    if (!u) return { earned: 0, possible: pts, correct: false, expected, feedback: 'No answer.' };
    const ok = u.toUpperCase() === key.toUpperCase();
    return { earned: ok ? pts : 0, possible: pts, correct: ok, expected, feedback: ok ? 'Correct.' : `The answer is ${expected}.` };
  }
  if (q.type === 'multi' && q.choices) {
    const key = new Set((Array.isArray(q.answer) ? q.answer : String(q.answer ?? '').split(/\s*,\s*/)).map((s) => s.toUpperCase()));
    const expected = [...key].join(', ');
    const picked = new Set((Array.isArray(answer) ? answer : typeof answer === 'string' ? answer.split(/[\s,]+/) : []).filter(Boolean).map((s) => s.toUpperCase()));
    if (!picked.size) return { earned: 0, possible: pts, correct: false, expected, feedback: 'No answer.' };
    const right = [...picked].filter((p) => key.has(p)).length;
    const wrong = picked.size - right;
    if (right === key.size && wrong === 0) return { earned: pts, possible: pts, correct: true, expected, feedback: 'Correct.' };
    if (rules.multiPartial) {
      const frac = Math.max(0, (right - wrong) / key.size);
      const earned = round(frac * pts, 2);
      return { earned, possible: pts, correct: earned > 0 ? 'partial' : false, expected, feedback: `${right} of ${key.size} correct choices${wrong ? `, ${wrong} wrong` : ''}; partial credit. Answer: ${expected}.` };
    }
    return { earned: 0, possible: pts, correct: false, expected, feedback: `Every correct choice is needed (no partial credit). Answer: ${expected}.` };
  }
  if (q.parts?.length) {
    const given: Record<string, string> = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
    let earned = 0;
    let possible = 0;
    let selfPts = 0;
    let allRight = true;
    const notes: string[] = [];
    for (const p of q.parts) {
      const u = given[p.label] ?? (q.parts.length === 1 && typeof answer === 'string' ? answer : '');
      const r = p.answer !== undefined ? gradeValue(p.type, p.answer, u, rules, `${q.prompt} ${p.prompt}`) : null;
      if (!r) {
        selfPts += p.points;
        allRight = false;
        notes.push(`(${p.label}) self-grade${p.rubric?.length ? ` with the rubric: ${p.rubric.join('; ')}` : p.answer ? `: compare with “${p.answer}”` : ''}`);
        continue;
      }
      possible += p.points;
      if (r.correct) earned += p.points;
      else allRight = false;
      notes.push(`(${p.label}) ${r.feedback}`);
    }
    const expected = q.parts.filter((p) => p.answer !== undefined).map((p) => `(${p.label}) ${p.answer}`).join('  ') || undefined;
    const feedback = (selfPts ? `Self-grade: ${selfPts} pts are not auto-graded. ` : '') + notes.join(' ');
    const correct: Graded['correct'] = allRight && !selfPts ? true : earned > 0 ? 'partial' : false;
    return { earned, possible, correct, ...(expected ? { expected } : {}), feedback };
  }
  const key = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
  if (key === undefined) return { earned: 0, possible: 0, correct: false, feedback: 'Self-grade: no answer key for this question.' };
  const u = typeof answer === 'string' ? answer : Array.isArray(answer) ? answer.join(', ') : '';
  const r = gradeValue(q.type, key, u, rules, q.prompt);
  if (!r) return { earned: 0, possible: 0, correct: false, expected: key, feedback: `Self-grade: compare your answer with the key “${key}”.` };
  return { earned: r.correct ? pts : 0, possible: pts, correct: r.correct, expected: key, feedback: r.feedback };
}

// ---------- routing ----------

function routeFromOrder(section: Section, attempt: Attempt): 'easy' | 'hard' | null {
  for (const s of attempt.sectionOrder) {
    const m = new RegExp(`^${section.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:.\\-/ ](easy|hard)$`).exec(s);
    if (m) return m[1] as 'easy' | 'hard';
  }
  return null;
}

/**
 * Which module-2 pool to give: 'hard' when the student earned at least `threshold` of module 1's points,
 * else 'easy'. `sectionId` may be the adaptive section itself or the section it follows. Record the
 * route in attempt.sectionOrder as "<sectionId>:<route>" (e.g. "m2:hard").
 */
export function adaptiveNext(exam: Exam, attempt: Attempt, sectionId: string): 'easy' | 'hard' {
  const sections = exam.profile.sections;
  const target = sections.find((s) => s.id === sectionId && s.adaptive) ?? sections.find((s) => s.adaptive?.after === sectionId);
  if (!target?.adaptive) throw new Error(`No adaptive section at or after "${sectionId}"`);
  const prev = sections.find((s) => s.id === target.adaptive!.after);
  if (!prev) throw new Error(`Adaptive section "${target.id}" follows missing "${target.adaptive.after}"`);
  const rules = familyRules(exam.profile.family, exam.profile);
  const ids = idsTaken(exam, attempt, prev);
  let earned = 0, possible = 0;
  for (const id of ids) {
    const q = exam.questions.find((x) => x.id === id);
    if (!q) continue;
    const g = gradeQuestion(q, attempt.answers[id], rules);
    earned += g.earned;
    possible += g.possible;
  }
  return possible > 0 && earned / possible >= target.adaptive.threshold ? 'hard' : 'easy';
}

function idsTaken(exam: Exam, attempt: Attempt, s: Section): string[] {
  if (!s.adaptive) return s.questionIds;
  const route = routeFromOrder(s, attempt) ?? adaptiveNext(exam, attempt, s.id);
  return route === 'easy' ? s.adaptive.easy : s.adaptive.hard;
}

// ---------- scoring ----------

function scoreLabel(exam: Exam, percent: number, routes: ('easy' | 'hard')[]): { score: string; estimate: boolean } {
  const sc = exam.profile.scoring;
  const p = percent / 100;
  if (sc.kind === 'scaled' && sc.min !== undefined && sc.max !== undefined) {
    // Easier module-2 routes cap the reachable score (as on real adaptive tests); the factor is a rough stand-in.
    const cap = routes.includes('easy') ? 0.8 : 1;
    const raw = sc.min + (sc.max - sc.min) * p * cap;
    const stepSize = sc.max - sc.min >= 300 ? 10 : 1;
    const v = Math.round(raw / stepSize) * stepSize;
    return { score: `≈ ${v} (estimate)`, estimate: true };
  }
  const band = sc.bands?.find((b) => percent >= b.minPercent)?.label;
  if (sc.kind === 'band') return { score: `${band ?? '—'} (estimate)`, estimate: true };
  if (sc.kind === 'points') return { score: `${round(percent, 1)}%`, estimate: false };
  return { score: band ? `${band} (${round(percent, 1)}%)` : `${round(percent, 1)}%`, estimate: false };
}

export function grade(exam: Exam, attempt: Attempt): Result {
  const rules = familyRules(exam.profile.family, exam.profile);
  const penalty = exam.profile.scoring.guessingPenalty ?? 0;
  const perQuestion: Result['perQuestion'] = [];
  const bySection: Result['bySection'] = [];
  const topics = new Map<Topic, { right: number; total: number }>();
  const routes: ('easy' | 'hard')[] = [];
  const onPaceAt: string[] = [];
  const slowest: { id: string; ratio: number }[] = [];
  let raw = 0, possible = 0;

  for (const s of exam.profile.sections) {
    if (s.adaptive) routes.push(routeFromOrder(s, attempt) ?? adaptiveNext(exam, attempt, s.id));
    const ids = idsTaken(exam, attempt, s);
    let sRaw = 0, sPossible = 0;
    const times: number[] = [];
    for (const id of ids) {
      const q = exam.questions.find((x) => x.id === id);
      if (!q) continue;
      const g = gradeQuestion(q, attempt.answers[id], rules);
      let earned = g.earned;
      const answered = attempt.answers[id] !== undefined && attempt.answers[id] !== '';
      if (penalty && (q.type === 'mc' || q.type === 'multi') && answered && g.correct === false) earned -= penalty * q.points;
      sRaw += earned;
      sPossible += g.possible;
      const timeMs = attempt.timeSpent[id] ?? 0;
      times.push(timeMs);
      perQuestion.push({ id, correct: g.correct, earned, points: q.points, ...(g.expected !== undefined ? { expected: g.expected } : {}), feedback: g.feedback, timeMs });
      if (q.topic && g.possible > 0) {
        const t = topics.get(q.topic) ?? { right: 0, total: 0 };
        t.total++;
        if (g.correct === true) t.right++;
        topics.set(q.topic, t);
      }
    }
    raw += sRaw;
    possible += sPossible;
    bySection.push({ id: s.id, title: s.title, raw: round(sRaw, 2), possible: round(sPossible, 2) });

    // Pacing: on pace while cumulative time stays within the section's per-question budget; "slowest" are
    // questions that took far longer (≥ 2×) than the section average.
    const spent = times.filter((t) => t > 0);
    const avg = spent.length ? spent.reduce((a, b) => a + b, 0) / spent.length : 0;
    let cum = 0;
    ids.forEach((id, k) => {
      cum += times[k] ?? 0;
      if (s.minutes !== null && times[k]! > 0 && cum <= (s.minutes * 60000 * (k + 1)) / ids.length) onPaceAt.push(id);
      if (avg > 0 && (times[k] ?? 0) >= 2 * avg && spent.length >= 3) slowest.push({ id, ratio: times[k]! / avg });
    });
  }

  raw = round(raw, 2);
  possible = round(possible, 2);
  const percent = possible > 0 ? round((Math.max(0, raw) / possible) * 100, 1) : 0;
  const { score, estimate } = scoreLabel(exam, percent, routes);
  return {
    raw,
    possible,
    percent,
    score,
    estimate,
    bySection,
    byTopic: [...topics.entries()].map(([topic, v]) => ({ topic, ...v })),
    perQuestion,
    pacing: { onPaceAt, slowest: slowest.sort((a, b) => b.ratio - a.ratio).map((x) => x.id) },
  };
}
