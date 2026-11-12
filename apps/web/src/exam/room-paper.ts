import { mountCalculator } from './calculator';
import { clear, clock, h, icon, mathSpan } from './dom';
import { banner, breakScreen, closeDialogs, dialog, floatingPanel, fullscreenWatch, introScreen, liveRegion, mathInput, pauseScreen, typing, type RoomView } from './room-kit';
import { exitFullscreen, LAST_MINUTES_MS, type ExamRun } from './run';
import { scratchPad } from './scratch';
import type { ExamHost, ExamQuestion } from './types';

/**
 * Printed test on a desk: letter-size pages with a Name/Date/Period header, an instructions box, question
 * numbers and point values in the left margin, bubbles to fill, show-work space, page numbers and
 * "go on" marks. The page stays paper-coloured in dark mode (it's paper); only the desk dims.
 */

// Rough space each item takes on a printed page, in "lines". A page holds about 40.
const PAGE_LINES = 40;
const FIRST_PAGE_HEADER = 13;

function weight(q: ExamQuestion, showWork: boolean): number {
  const promptLines = Math.ceil(q.prompt.length / 80) + (q.tex ? 2 : 0) + (q.figure ? q.figure.split('\n').length : 0);
  if (q.type === 'free') return promptLines + (q.parts?.length ?? 1) * 7;
  const answer = q.choices?.length ? Math.ceil(q.choices.length / (q.choices.every((c) => c.text.length < 18) ? 4 : 1)) + 1 : 2;
  return promptLines + answer + (showWork ? 7 : 1) + 1;
}

export function paginate(qs: ExamQuestion[], showWork: boolean): ExamQuestion[][] {
  const pages: ExamQuestion[][] = [[]];
  let used = FIRST_PAGE_HEADER;
  for (const q of qs) {
    const w = weight(q, showWork);
    if (used + w > PAGE_LINES && pages[pages.length - 1]!.length) {
      pages.push([]);
      used = 2;
    }
    pages[pages.length - 1]!.push(q);
    used += w;
  }
  return pages;
}

export function mountPaperRoom(root: HTMLElement, run: ExamRun, host: ExamHost, opts: { onExit(): void }): RoomView {
  root.className = 'ex-room ex-pp';
  root.setAttribute('aria-label', `${run.profile.name}, practice test`);
  const p = run.profile;
  const say = liveRegion(root);
  const stage = h('div', { class: 'ex-pp-stage' });
  root.append(stage);
  const warn = banner(root);
  const unwatch = fullscreenWatch(run, root, warn);
  let crossOut = false;
  let calcOpen = false;
  let pagesOpen = false;
  let calc: ReturnType<typeof mountCalculator> | null = null;
  let breakView: ReturnType<typeof breakScreen> | null = null;
  let clockEl: HTMLElement | null = null;
  let io: IntersectionObserver | null = null;
  const showWork = p.tools.scratch;

  const calcKind = () => (p.tools.calculator === 'none' ? null : p.tools.calculator);
  const calcAllowed = () => !!calcKind() && run.calculatorAllowed();

  // ---- toolbar on the desk edge

  function toolbar(): HTMLElement {
    const left = run.timeLeft();
    clockEl = h('div', { class: 'ex-pp-clock', role: 'timer', 'aria-label': 'Time remaining' });
    const tool = (label: string, ico: string, pressed: boolean | null, act: string, on: () => void) =>
      h('button', { type: 'button', class: 'ex-pp-tool', 'aria-pressed': pressed === null ? null : String(pressed), 'data-act': act, onclick: on }, icon(ico), h('span', { class: 'ex-pp-tool-label' }, label));
    return h('div', { class: 'ex-pp-bar', role: 'toolbar', 'aria-label': 'Test tools' },
      h('div', { class: 'ex-pp-bar-l' }, h('span', { class: 'ex-pp-bar-title' }, run.viewSection.title)),
      left === null ? h('span', { class: 'ex-pp-clock is-untimed' }, 'Untimed') : clockEl,
      h('div', { class: 'ex-pp-bar-r' },
        p.tools.eliminator ? tool('Cross out', 'scratch', crossOut, 'cross', () => ((crossOut = !crossOut), render(), say(crossOut ? 'Cross-out pencil: tap a choice to cross it out' : 'Fill pencil: tap a bubble to fill it'))) : null,
        calcAllowed() ? tool('Calculator', 'calc', calcOpen, 'calc', () => ((calcOpen = !calcOpen), render())) : null,
        tool('Pages', 'ref', pagesOpen, 'pages', () => ((pagesOpen = !pagesOpen), render())),
        // AP-style return: from this part back to an earlier one (and back again), on this part's clock.
        run.visiting
          ? h('button', { type: 'button', class: 'ex-pp-tool ex-pp-return', 'data-act': 'leave-return', onclick: () => run.leaveReturn() }, icon('ref'), h('span', { class: 'ex-pp-tool-label' }, `Back to ${shortTitle()}`))
          : run.returnTarget()
            ? h('button', { type: 'button', class: 'ex-pp-tool ex-pp-return', 'data-act': 'return', onclick: () => run.visitReturn() }, icon('ref'), h('span', { class: 'ex-pp-tool-label' }, `Go to ${shortOf(run.returnTarget()!.title)}`))
            : null,
        p.rules.allowPause ? tool('Pause', 'pause', null, 'pause', () => run.setPaused(true)) : null,
        tool('Exit', 'close', null, 'exit', () => void saveExit()),
        h('button', { type: 'button', class: 'ex-pp-turnin', 'data-act': 'turnin', onclick: () => void turnIn() }, run.isLastSection ? 'Turn in' : `Turn in ${shortTitle()}`),
      ),
    );
  }

  /** "Section II, Part B — …" → "Part B": the last "Part/Section X" in a title. */
  const shortOf = (title: string) => [...title.matchAll(/\b(?:part|section)\s+[^\s,—–-]+/gi)].at(-1)?.[0] ?? 'part';
  const shortTitle = () => shortOf(run.section.title);

  function paintClock(): void {
    if (!clockEl) return;
    const left = run.timeLeft();
    if (left === null) return;
    clear(clockEl);
    const visible = run.timerVisible();
    clockEl.classList.toggle('is-urgent', left <= LAST_MINUTES_MS);
    clockEl.classList.toggle('is-hidden', !visible);
    const face = analogFace(left);
    if (visible) clockEl.append(face, h('span', { class: 'ex-pp-clock-time' }, clock(left)), h('span', { class: 'ex-pp-clock-label' }, 'left'));
    else clockEl.append(face, h('span', { class: 'ex-pp-clock-label' }, 'Clock hidden'));
    if (run.canHideTimer()) clockEl.append(h('button', { type: 'button', class: 'ex-pp-clock-btn', 'data-act': 'timer', 'aria-label': visible ? 'Hide clock' : 'Show clock', onclick: () => (run.toggleTimer(), paintClock()) }, visible ? 'Hide' : 'Show'));
    clockEl.setAttribute('aria-label', visible ? `Time remaining ${clock(left)}` : 'Clock hidden');
  }

  // A little wall clock that moves with real time; the minute hand sweeps the hour.
  function analogFace(_left: number): SVGSVGElement {
    const now = new Date(Date.now());
    const m = now.getMinutes() + now.getSeconds() / 60;
    const hr = (now.getHours() % 12) + m / 60;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('class', 'ex-pp-face');
    s.setAttribute('aria-hidden', 'true');
    const ang = (v: number, of: number) => (v / of) * 2 * Math.PI;
    const hand = (a: number, len: number, w: number) => `<line x1="16" y1="16" x2="${16 + Math.sin(a) * len}" y2="${16 - Math.cos(a) * len}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/>`;
    let ticks = '';
    for (let i = 0; i < 12; i++) ticks += `<line x1="${16 + Math.sin(ang(i, 12)) * 12}" y1="${16 - Math.cos(ang(i, 12)) * 12}" x2="${16 + Math.sin(ang(i, 12)) * 13.5}" y2="${16 - Math.cos(ang(i, 12)) * 13.5}" stroke="currentColor" stroke-width="1"/>`;
    s.innerHTML = `<circle cx="16" cy="16" r="15" fill="#fff" stroke="currentColor" stroke-width="1.5"/>${ticks}${hand(ang(hr, 12), 7, 2)}${hand(ang(m, 60), 10.5, 1.4)}<circle cx="16" cy="16" r="1.2" fill="currentColor"/>`;
    return s;
  }

  // ---- pages

  function header(): HTMLElement {
    const field = (key: string, label: string, size: string) =>
      h('label', { class: `ex-pp-field ex-pp-field-${size}` }, h('span', null, `${label}`),
        h('input', { class: 'ex-pp-line', type: 'text', value: run.st.work[key] ?? '', 'aria-label': label, autocomplete: 'off', oninput: (e: Event) => run.setWork(key, (e.target as HTMLInputElement).value) }));
    const total = run.questions().reduce((n, q) => n + q.points, 0);
    const s = run.viewSection;
    return h('div', { class: 'ex-pp-head' },
      h('div', { class: 'ex-pp-fields' }, field('__name', 'Name', 'l'), field('__date', 'Date', 'm'), field('__period', 'Period', 's')),
      h('h1', { class: 'ex-pp-title' }, p.name),
      h('p', { class: 'ex-pp-sub' }, [s.title !== p.name ? s.title : null, run.visiting ? `On ${shortTitle()}’s time` : s.minutes ? `${s.minutes} minutes` : null, `${total} points`, calcAllowed() ? 'Calculator allowed' : 'No calculator'].filter(Boolean).join('  ·  ')),
      h('div', { class: 'ex-pp-instr' }, h('strong', null, 'Directions: '), s.instructions ?? 'Answer every question. Show your work in the space provided. Fill in the bubble completely for multiple-choice questions.'),
    );
  }

  function choiceList(q: ExamQuestion): HTMLElement {
    const ans = run.attempt.answers[q.id];
    const struck = run.eliminated(q.id);
    const short = (q.choices ?? []).every((c) => c.text.length < 18);
    return h('ol', { class: `ex-pp-choices${short ? ' is-row' : ''}`, style: `--n:${q.choices?.length ?? 4}`, role: q.type === 'multi' ? 'group' : 'radiogroup', 'aria-label': `Choices for question ${q.number}` }, (q.choices ?? []).map((c) => {
      const filled = Array.isArray(ans) ? ans.includes(c.id) : ans === c.id;
      const isStruck = struck.includes(c.id);
      const act = () => {
        if (crossOut) {
          run.toggleEliminate(q.id, c.id);
          say(`${c.id} ${run.eliminated(q.id).includes(c.id) ? 'crossed out' : 'restored'}`);
        } else {
          if (isStruck) run.toggleEliminate(q.id, c.id);
          if (q.type === 'multi') {
            const cur = Array.isArray(ans) ? ans : [];
            run.setAnswer(q.id, filled ? cur.filter((x) => x !== c.id) : [...cur, c.id].sort());
          } else run.setAnswer(q.id, filled ? undefined : c.id);
        }
        repaintItem(q);
      };
      return h('li', { class: `ex-pp-choice${filled ? ' is-filled' : ''}${isStruck ? ' is-struck' : ''}` },
        h('button', {
          type: 'button',
          class: 'ex-pp-bubble',
          role: q.type === 'multi' ? 'checkbox' : 'radio',
          'aria-checked': String(filled),
          'aria-label': `${c.id}: ${c.text}${isStruck ? ', crossed out' : ''}`,
          'data-choice': c.id,
          onclick: act,
        }, h('span', { class: 'ex-pp-bubble-o', 'aria-hidden': 'true' }, c.id)),
        h('span', { class: 'ex-pp-choice-text', onclick: act }, c.tex ? mathSpan(c.text, c.tex) : c.text),
      );
    }));
  }

  function workArea(q: ExamQuestion, lines = 5): HTMLElement {
    const box = h('div', { class: 'ex-pp-work' });
    const hasDrawing = !!run.st.drawings[q.id];
    const hasText = !!run.st.work[q.id];
    const body = h('div', { class: 'ex-pp-work-body' });
    body.style.minHeight = `${lines * 1.6}em`;
    const showDraw = () => {
      clear(body);
      body.append(scratchPad({ label: `Work for question ${q.number}`, height: lines * 26, ...(run.st.drawings[q.id] ? { initial: run.st.drawings[q.id]! } : {}), ink: '#33302a', onChange: (d) => run.setDrawing(q.id, d) }));
    };
    const showType = () => {
      clear(body);
      const ta = h('textarea', { class: 'ex-pp-work-text', rows: String(lines), 'aria-label': `Typed work for question ${q.number}`, placeholder: 'Type your work', oninput: (e: Event) => run.setWork(q.id, (e.target as HTMLTextAreaElement).value) });
      ta.value = run.st.work[q.id] ?? '';
      body.append(ta);
      ta.focus();
    };
    box.append(
      h('div', { class: 'ex-pp-work-tools' },
        h('span', { class: 'ex-pp-work-label' }, 'Show your work'),
        h('button', { type: 'button', class: 'ex-pp-link', onclick: showDraw, 'aria-label': `Draw work for question ${q.number}` }, 'Draw'),
        h('button', { type: 'button', class: 'ex-pp-link', onclick: showType, 'aria-label': `Type work for question ${q.number}` }, 'Type'),
        host.openScratch ? h('button', { type: 'button', class: 'ex-pp-link', onclick: () => host.openScratch!() }, 'Open whiteboard') : null,
      ),
      body,
    );
    if (hasDrawing) showDraw();
    else if (hasText) {
      const ta = h('textarea', { class: 'ex-pp-work-text', rows: String(lines), 'aria-label': `Typed work for question ${q.number}`, oninput: (e: Event) => run.setWork(q.id, (e.target as HTMLTextAreaElement).value) });
      ta.value = run.st.work[q.id] ?? '';
      body.append(ta);
    }
    return box;
  }

  function answerLine(q: ExamQuestion): HTMLElement {
    const cur = run.attempt.answers[q.id];
    return h('div', { class: 'ex-pp-answer' }, h('span', { class: 'ex-pp-answer-label' }, 'Answer:'),
      mathInput({ value: typeof cur === 'string' ? cur : '', label: `Answer to question ${q.number}`, preview: 'Preview', className: 'ex-pp-line', onInput: (v) => (run.setAnswer(q.id, v.trim() ? v : undefined), markAnswered(q)) }));
  }

  function item(q: ExamQuestion, index: number): HTMLElement {
    const flagged = run.flagged(q.id);
    const body = h('div', { class: 'ex-pp-body' },
      q.figure ? h('pre', { class: 'ex-figure' }, q.figure) : null,
      h('p', { class: 'ex-pp-prompt' }, q.prompt),
      q.tex ? mathSpan(q.prompt, q.tex, true) : null,
    );
    if (q.type === 'free' && q.parts?.length) {
      const ans = run.attempt.answers[q.id];
      const given = ans && typeof ans === 'object' && !Array.isArray(ans) ? ans : {};
      body.append(h('ol', { class: 'ex-pp-parts' }, q.parts.map((pt) => h('li', { class: 'ex-pp-part' },
        h('p', null, h('span', { class: 'ex-pp-part-label' }, `(${pt.label}) `), pt.prompt, h('span', { class: 'ex-pp-part-pts' }, ` [${pt.points}]`)),
        pt.tex ? mathSpan(pt.prompt, pt.tex, true) : null,
        showWork ? workArea({ ...q, id: `${q.id}#${pt.label}`, number: q.number }, 4) : null,
        h('div', { class: 'ex-pp-answer' }, h('span', { class: 'ex-pp-answer-label' }, 'Answer:'), mathInput({ value: given[pt.label] ?? '', label: `Answer to question ${q.number} part ${pt.label}`, preview: 'Preview', className: 'ex-pp-line', onInput: (v) => (run.setPart(q.id, pt.label, v), markAnswered(q)) })),
      ))));
    } else if (q.choices?.length) {
      body.append(choiceList(q));
      if (showWork) body.append(workArea(q, 4));
    } else {
      if (showWork) body.append(workArea(q, 5));
      body.append(answerLine(q));
    }
    return h('section', { class: `ex-pp-item${run.answered(q.id) ? ' is-answered' : ''}`, 'data-qid': q.id, 'data-index': index, 'aria-label': `Question ${q.number}, ${q.points} point${q.points === 1 ? '' : 's'}` },
      h('div', { class: 'ex-pp-margin' },
        h('button', { type: 'button', class: `ex-pp-num${flagged ? ' is-circled' : ''}`, 'aria-pressed': String(flagged), 'aria-label': `Question ${q.number}: circle to come back to it`, title: 'Circle to come back later', onclick: (e: Event) => {
          const on = run.toggleFlag(q.id);
          (e.currentTarget as HTMLElement).classList.toggle('is-circled', on);
          (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(on));
          say(on ? `Question ${q.number} circled` : `Question ${q.number} uncircled`);
        } }, `${q.number}.`),
        p.observations.some((o) => /point/i.test(o)) || q.points !== 1 || p.family === 'class' || p.family === 'custom' ? h('span', { class: 'ex-pp-pts' }, `(${q.points} pt${q.points === 1 ? '' : 's'})`) : null,
      ),
      body,
    );
  }

  function repaintItem(q: ExamQuestion) {
    const old = stage.querySelector(`.ex-pp-item[data-qid="${CSS.escape(q.id)}"]`);
    if (!old) return;
    const idx = Number((old as HTMLElement).dataset.index);
    const fresh = item(q, idx);
    old.replaceWith(fresh);
    io?.observe(fresh);
    (fresh.querySelector('[aria-checked="true"]') as HTMLElement | null ?? fresh.querySelector('.ex-pp-bubble') as HTMLElement | null)?.focus();
  }

  function markAnswered(q: ExamQuestion) {
    stage.querySelector(`.ex-pp-item[data-qid="${CSS.escape(q.id)}"]`)?.classList.toggle('is-answered', run.answered(q.id));
  }

  function pagesPopover(pages: ExamQuestion[][]): HTMLElement {
    const pop = h('div', { class: 'ex-pp-pages', role: 'dialog', 'aria-label': 'Pages' },
      h('div', { class: 'ex-nav-pop-head' }, h('h2', null, 'Jump to'), h('button', { type: 'button', class: 'ex-panel-x', 'aria-label': 'Close page list', onclick: () => ((pagesOpen = false), render()) }, icon('close'))),
      h('ol', { class: 'ex-pp-pagelist' }, pages.map((qs, i) => h('li', null,
        h('span', { class: 'ex-pp-pagelist-p' }, `Page ${i + 1}`),
        h('span', { class: 'ex-pp-pagelist-qs' }, qs.map((q) => h('button', {
          type: 'button',
          class: `ex-nav-cell${run.answered(q.id) ? ' is-answered' : ''}${run.flagged(q.id) ? ' is-flagged' : ''}`,
          'aria-label': `Question ${q.number}, ${run.answered(q.id) ? 'answered' : 'unanswered'}${run.flagged(q.id) ? ', circled' : ''}`,
          onclick: () => {
            pagesOpen = false;
            render();
            const el = stage.querySelector(`.ex-pp-item[data-qid="${CSS.escape(q.id)}"]`) as HTMLElement | null;
            el?.scrollIntoView({ block: 'start' });
            (el?.querySelector('button, input') as HTMLElement | null)?.focus({ preventScroll: true });
          },
        }, String(q.number)))),
      ))),
    );
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (e.stopPropagation(), (pagesOpen = false), render());
    });
    queueMicrotask(() => (pop.querySelector('.ex-nav-cell') as HTMLElement | null)?.focus());
    return pop;
  }

  async function saveExit() {
    const r = await dialog(root, { title: 'Save and exit?', body: ['Your answers, work and remaining time are saved on this device. Continue later from the exam center.'], actions: [{ label: 'Keep working' }, { label: 'Save and exit', primary: true }] });
    if (r === 'Save and exit') {
      run.save();
      exitFullscreen();
      opts.onExit();
    }
  }

  async function turnIn() {
    const sid = run.section.id;
    const qs = run.questions();
    const unanswered = qs.filter((q) => !run.answered(q.id)).length;
    const last = run.isLastSection;
    const r = await dialog(root, {
      title: last ? 'Turn in your test?' : `Turn in ${shortTitle()}?`,
      body: [unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} still blank.` : 'Every question has an answer.', last ? 'You can’t make changes after you turn it in.' : run.section.canReturn ? 'You can come back to this part later.' : 'You won’t get this part back.'],
      actions: [{ label: 'Keep working' }, { label: 'Turn in', primary: true }],
    });
    if (r === 'Turn in') run.submitSection(false, sid);
  }

  // ---- render

  function render(): void {
    io?.disconnect();
    io = null;
    const scroll = (stage.querySelector('.ex-pp-desk') as HTMLElement | null)?.scrollTop ?? 0;
    const sameSection = stage.dataset.section === run.viewSection.id && stage.dataset.phase === run.st.phase;
    clear(stage);
    root.querySelectorAll('.ex-menu').forEach((x) => x.remove());
    breakView = null;
    clockEl = null;
    const st = run.st;
    stage.dataset.phase = st.phase;
    if (st.phase === 'intro') return void stage.append(introScreen(run, root, () => warn.show('Full screen isn’t available here, so the test fills this window instead.')));
    if (st.phase === 'break') {
      breakView = breakScreen(run);
      stage.append(breakView.el);
      return keepFocus();
    }
    if (st.phase === 'done') return;
    stage.dataset.section = run.viewSection.id;
    const qs = run.questions();
    const pages = paginate(qs, showWork);
    const desk = h('div', { class: 'ex-pp-desk' });
    let idx = 0;
    pages.forEach((pq, pi) => {
      const page = h('article', { class: 'ex-pp-page', tabindex: '-1', 'aria-label': `Page ${pi + 1} of ${pages.length}` });
      if (pi === 0) page.append(header());
      else page.append(h('div', { class: 'ex-pp-runhead', 'aria-hidden': 'true' }, h('span', null, p.name), h('span', null, run.viewSection.title)));
      const list = h('div', { class: 'ex-pp-items' });
      for (const q of pq) list.append(item(q, idx++));
      page.append(list);
      const lastPage = pi === pages.length - 1;
      page.append(h('footer', { class: 'ex-pp-foot' },
        lastPage && run.visiting
          ? h('div', { class: 'ex-pp-stop' }, h('span', null, `End of ${run.viewSection.title}.`),
            h('button', { type: 'button', class: 'ex-btn ex-pp-turnin-end', 'data-act': 'leave-return', onclick: () => run.leaveReturn() }, `Back to ${shortTitle()}`))
          : lastPage
          ? h('div', { class: 'ex-pp-stop' }, h('strong', null, 'STOP'), h('span', null, run.isLastSection ? 'This is the end of the test. If you finish early, check your work.' : `End of ${run.section.title}. Check your work on this part only.`),
            h('button', { type: 'button', class: 'ex-btn ex-pp-turnin-end', onclick: () => void turnIn() }, run.isLastSection ? 'Turn in test' : `Turn in ${shortTitle()}`))
          : h('div', { class: 'ex-pp-goon', 'aria-hidden': 'true' }, 'Go on to the next page ', h('span', null, '▸')),
        h('div', { class: 'ex-pp-pageno' }, `Page ${pi + 1} of ${pages.length}`),
      ));
      desk.append(page);
    });
    if (run.canReturnToPrevious()) desk.prepend(h('button', { type: 'button', class: 'ex-btn ex-pp-prev', onclick: () => run.back() }, '← Back to the previous part'));
    if (run.visiting) {
      desk.prepend(h('div', { class: 'ex-pp-visit', role: 'status' },
        h('strong', null, `Back in ${shortOf(run.viewSection.title)}`),
        ` — ${calcAllowed() ? 'calculator allowed' : 'no calculator'}. Time here comes out of ${shortTitle()}.`));
    }
    const bar = toolbar();
    stage.append(bar, desk);
    if (calcOpen && calcAllowed()) {
      calc ??= mountCalculator(host, calcKind()!);
      stage.append(floatingPanel(root, { title: 'Calculator', className: 'ex-pp-calc', body: calc.root, onClose: () => ((calcOpen = false), render()) }));
    }
    if (pagesOpen) stage.append(pagesPopover(pages));
    if (st.paused) stage.append(pauseScreen(run));
    stage.classList.toggle('is-crossing', crossOut);
    paintClock();
    if (sameSection) desk.scrollTop = scroll;
    keepFocus();
    // The question nearest the top of the view is "current" for pacing.
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.4) run.st.q = Number((e.target as HTMLElement).dataset.index);
    }, { root: desk, threshold: [0.4, 0.8] });
    desk.querySelectorAll('.ex-pp-item').forEach((el) => io!.observe(el));
  }

  /** Focus fell to the page body (Start, a new part, a break): put it on the test so keyboard users can go on. */
  function keepFocus(): void {
    const a = document.activeElement;
    if ((a && a !== document.body && root.contains(a)) || root.querySelector('.ex-dialog-wrap')) return;
    const target = (stage.querySelector('.ex-break .ex-btn-primary') ?? stage.querySelector('.ex-pp-page')) as HTMLElement | null;
    target?.focus({ preventScroll: true });
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (pagesOpen || calcOpen)) {
      pagesOpen = false;
      calcOpen = false;
      render();
      return;
    }
    if (typing(e) || run.st.phase !== 'section') return;
    if (e.key.toLowerCase() === 'x' && p.tools.eliminator) {
      crossOut = !crossOut;
      render();
      say(crossOut ? 'Cross-out pencil' : 'Fill pencil');
    }
  };
  root.addEventListener('keydown', onKey);

  return {
    render,
    tick() {
      if (breakView) breakView.tick();
      else paintClock();
    },
    warn(m) {
      warn.show(m);
      say(m);
    },
    notice(m) {
      closeDialogs(root);
      setTimeout(() => root.isConnected && run.st.phase !== 'done' && void dialog(root, { title: 'Pencils down', body: [m], actions: [{ label: 'OK', primary: true }] }), 0);
    },
    destroy() {
      io?.disconnect();
      root.removeEventListener('keydown', onKey);
      unwatch();
      calc?.destroy();
    },
  };
}
