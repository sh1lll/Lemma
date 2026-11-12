import { check, generate, similarTo, TOPICS, type Question, type Topic } from '@lemma/practice-engine';
import type { ToolContext, ToolId } from '../study';
import { addMistake, clearMistake, listMistakes } from './mistakes';
import { button, el, renderSteps, segmented, typeset } from './ui';

export interface PracticeHost {
  toast: (m: string) => void;
  openTool: (id: ToolId, ctx?: ToolContext) => void;
}

/** One question at a time: answer, check, hint, worked steps, next. */
export function mountPractice(body: HTMLElement, ctx: ToolContext, host: PracticeHost): () => void {
  let topic: Topic = 'linear';
  /** Practising your own mistakes: the missed questions again, then fresh ones on their topics. */
  let review = false;
  let reviewTurn = 0;
  let difficulty: 1 | 2 | 3 = 1;
  let q: Question;
  let seed = Math.floor(Math.random() * 1e9);

  const first = ctx.query ? similarTo(ctx.query, { difficulty }) : null;
  if (first) topic = first.topic;

  const hasMistakes = listMistakes().length > 0;
  const topics = segmented(
    [...(hasMistakes ? [{ id: 'mistakes', label: 'Your mistakes' }] : []), ...TOPICS.map((t) => ({ id: t.id, label: t.label }))],
    hasMistakes && !first ? 'mistakes' : topic,
    (id) => {
      review = id === 'mistakes';
      reviewTurn = 0;
      if (!review) topic = id as Topic;
      next();
    },
  );
  review = hasMistakes && !first;
  const levels = segmented(
    [
      { id: '1', label: 'Easy' },
      { id: '2', label: 'Medium' },
      { id: '3', label: 'Hard' },
    ],
    String(difficulty),
    (id) => {
      difficulty = Number(id) as 1 | 2 | 3;
      next();
    },
  );

  const prompt = el('div', { className: 'q-prompt' });
  const promptMath = el('div', { className: 'q-math' });
  const input = el('input', { placeholder: 'Your answer', autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', 'Your answer');
  const feedback = el('p', { className: 'feedback' });
  const hint = el('p', { className: 'fine' });
  const steps = el('div');
  const card = el('div', { className: 'card' }, el('h3', {}, 'Question'), prompt, promptMath);

  const checkBtn = button('Check', () => grade(), 'btn primary');
  const form = el('form', { className: 'answer-field' }, input, checkBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    grade();
  });

  const actions = el(
    'div',
    { className: 'btn-row' },
    button('Hint', () => {
      hint.textContent = q.hint;
    }),
    button('Show steps', () => showSteps()),
    button('Next question', () => next()),
    button('Make a video', () => host.openTool('video', { query: q.prompt, result: q.answer.display, lesson: lessonOf(q) })),
  );

  body.append(el('div', { className: 'tool-controls' }, topics, levels), card, form, feedback, hint, steps, actions);

  let counted = false;
  let revealed = false;

  function show(question: Question) {
    q = question;
    prompt.textContent = q.prompt;
    promptMath.replaceChildren();
    prompt.classList.toggle('with-math', !!q.promptTex);
    if (q.promptTex) typeset(promptMath, q.promptTex, true);
    input.value = '';
    feedback.textContent = '';
    feedback.className = 'feedback';
    hint.textContent = '';
    steps.replaceChildren();
    counted = false;
    revealed = false;
    // On a phone, focusing here would throw the keyboard over the question before it's been read.
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
  }

  function next() {
    seed++;
    if (review) {
      const list = listMistakes();
      if (!list.length) {
        host.toast('All caught up on your mistakes');
        review = false;
        topics.querySelector<HTMLButtonElement>(`[data-id="${topic}"]`)?.click();
        return;
      }
      // The oldest missed question exactly as it was first, then turn about: a fresh one on a missed topic, the
      // next missed question, and so on.
      const exact = reviewTurn++ % 2 === 0;
      const m = exact ? list[0]! : list[Math.floor(Math.random() * list.length)]!;
      return show(exact ? generate(m.topic, { difficulty: m.difficulty, seed: m.seed }) : generate(m.topic, { difficulty: m.difficulty, seed }));
    }
    show(generate(topic, { difficulty, seed }));
  }

  function grade() {
    if (!input.value.trim()) return input.focus();
    const r = check(q, input.value);
    // Progress for the study agenda (tasks like "12 problems on derivatives", spaced review): each question counts
    // once, on its first check, and an answer checked after seeing the steps doesn't count as right.
    if (!counted) {
      counted = true;
      const correct = r.correct && !revealed;
      // Missed (or only right after seeing the steps): kept to practise again. Right first time: learned.
      if (correct) {
        if (clearMistake(q.id) && review) host.toast('Got it, that one’s off your list');
      } else addMistake(q);
      void import('../agenda').then((m) => m.recordActivity({ kind: 'practice', topic: q.topic, correct }));
    }
    feedback.textContent = r.correct ? (/^correct\.?$/i.test(r.feedback) ? 'Right.' : `Right. ${r.feedback}`) : r.close ? r.feedback : `${r.feedback} The answer is ${r.expected}.`;
    feedback.className = `feedback ${r.correct ? 'right' : 'wrong'}`;
    if (!r.correct) showSteps();
  }

  function showSteps() {
    // Looking at the steps before answering: it goes on the list to try again later.
    if (!counted && !revealed) addMistake(q);
    revealed = true;
    steps.replaceChildren(el('h3', { className: 'steps-title' }, 'Steps'), renderSteps(q.steps), el('p', { className: 'feedback' }, `Answer: ${q.answer.display}`));
  }

  if (first) show(first);
  else if (review) next();
  else show(generate(topic, { difficulty, seed }));
  return () => undefined;
}

export function lessonOf(q: Question) {
  return { title: TOPICS.find((t) => t.id === q.topic)?.label ?? 'Practice', question: q.prompt, questionTex: q.promptTex, steps: q.steps, answer: { display: q.answer.display, tex: q.answer.tex } };
}
