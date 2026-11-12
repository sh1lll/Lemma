import { buildTest, check, grade, similarTo, TOPICS, type Question, type Topic } from '@lemma/practice-engine';
import type { ToolContext } from '../study';
import type { PracticeHost } from './practice';
import { lessonOf } from './practice';
import { countUp } from '../motion';
import { button, el, renderSteps, segmented, typeset } from './ui';

/** A short test: pick topics and length, answer one question per screen, then a score by topic and a review. */
export function mountTest(body: HTMLElement, ctx: ToolContext, host: PracticeHost): () => void {
  const fromQuery = ctx.query ? similarTo(ctx.query) : null;
  let topics: Topic[] = fromQuery ? [fromQuery.topic] : ['linear', 'percent', 'derivative'];
  let count = 10;
  let difficulty: 1 | 2 | 3 = 2;

  setup();
  return () => undefined;

  function setup() {
    body.replaceChildren(
      el('div', { className: 'card' }, el('h3', {}, 'Topics'), segmented(TOPICS.map((t) => ({ id: t.id, label: t.label })), topics, (_id, all) => (topics = all as Topic[]), true)),
      el(
        'div',
        { className: 'card' },
        el('h3', {}, 'Length'),
        segmented(
          ['5', '10', '20'].map((n) => ({ id: n, label: `${n} questions` })),
          String(count),
          (id) => (count = Number(id)),
        ),
        el('h3', { style: 'margin-top:14px' } as never, 'Difficulty'),
        segmented(
          [
            { id: '1', label: 'Easy' },
            { id: '2', label: 'Medium' },
            { id: '3', label: 'Hard' },
          ],
          String(difficulty),
          (id) => (difficulty = Number(id) as 1 | 2 | 3),
        ),
      ),
      el('div', { className: 'btn-row' }, button('Start test', () => run(buildTest({ topics, count, difficulty, seed: Math.floor(Math.random() * 1e9) })), 'btn primary')),
    );
  }

  function run(questions: Question[]) {
    const answers: string[] = questions.map(() => '');
    let i = 0;
    const bar = el('div', { className: 'progress' }, el('i'));
    const counter = el('p', { className: 'fine' });
    const prompt = el('div', { className: 'q-prompt' });
    const math = el('div', { className: 'q-math' });
    const input = el('input', { placeholder: 'Your answer', autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', 'Your answer');
    const form = el('form', { className: 'answer-field' }, input, button('Next', () => go(1), 'btn primary'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go(1);
    });
    const back = button('Previous', () => go(-1));
    const finish = button('Finish', () => done());
    body.replaceChildren(bar, counter, el('div', { className: 'card' }, prompt, math), form, el('div', { className: 'btn-row' }, back, finish));
    show();

    function show() {
      const q = questions[i]!;
      (bar.firstElementChild as HTMLElement).style.width = `${(i / questions.length) * 100}%`;
      counter.textContent = `Question ${i + 1} of ${questions.length}`;
      prompt.textContent = q.prompt;
      math.replaceChildren();
      prompt.classList.toggle('with-math', !!q.promptTex);
      if (q.promptTex) typeset(math, q.promptTex, true);
      input.value = answers[i] ?? '';
      back.disabled = i === 0;
      input.focus();
    }
    function go(step: number) {
      answers[i] = input.value;
      if (step > 0 && i === questions.length - 1) return done();
      i = Math.max(0, Math.min(questions.length - 1, i + step));
      show();
    }
    function done() {
      answers[i] = input.value;
      results(questions, answers);
    }
  }

  function results(questions: Question[], answers: string[]) {
    const r = grade(questions, answers);
    void import('../agenda').then((m) => questions.forEach((q, k) => m.recordActivity({ kind: 'test', topic: q.topic, correct: check(q, answers[k] ?? '').correct })));
    const pct = Math.round((r.score / Math.max(1, r.total)) * 100);
    const byTopic = el(
      'ul',
      { className: 'by-topic' },
      ...Object.entries(r.byTopic).map(([t, v]) => el('li', {}, el('span', {}, TOPICS.find((x) => x.id === t)?.label ?? t), el('span', {}, `${v.right} / ${v.total}`))),
    );
    const review = el('ol', { className: 'review' });
    questions.forEach((q, k) => {
      const c = check(q, answers[k] ?? '');
      const steps = el('div');
      const li = el(
        'li',
        { className: c.correct ? 'right' : 'wrong' },
        el('div', { className: 'q-prompt small' }, q.prompt),
        el('p', { className: `feedback ${c.correct ? 'right' : 'wrong'}` }, c.correct ? `Right: ${answers[k]}` : `${answers[k]?.trim() ? `You wrote ${answers[k]}. ` : 'Skipped. '}Answer: ${q.answer.display}`),
        el(
          'div',
          { className: 'btn-row' },
          button('Steps', () => steps.replaceChildren(steps.childElementCount ? '' : renderSteps(q.steps))),
          button('Make a video', () => host.openTool('video', { query: q.prompt, result: q.answer.display, lesson: lessonOf(q) })),
        ),
        steps,
      );
      review.append(li);
    });
    const wrong = questions.filter((q, k) => !check(q, answers[k] ?? '').correct);
    const score = el('div', { className: 'score' }, `${r.score} / ${r.total}`);
    body.replaceChildren(
      el('div', { className: 'card score-card' }, score, el('p', { className: 'fine' }, `${pct}%`), byTopic),
      el(
        'div',
        { className: 'btn-row' },
        button('New test', () => setup(), 'btn primary'),
        ...(wrong.length ? [button(`Retry the ${wrong.length} I missed`, () => run(wrong.map((q) => ({ ...q }))))] : []),
      ),
      review,
    );
    countUp(score);
  }
}
