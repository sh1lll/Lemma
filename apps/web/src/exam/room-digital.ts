import { mountCalculator, referenceSheet } from './calculator';
import { clear, clock, h, icon } from './dom';
import {
  banner,
  breakScreen,
  choicesView,
  closeDialogs,
  dialog,
  floatingPanel,
  fullscreenWatch,
  introScreen,
  liveRegion,
  pauseScreen,
  promptView,
  responseView,
  typing,
  type RoomView,
} from './room-kit';
import { exitFullscreen, LAST_MINUTES_MS, type ExamRun } from './run';
import type { ExamHost, ExamQuestion } from './types';

/**
 * Screen-based testing room, used for both the adaptive (module) format and the linear one. Deliberately
 * light in every theme: testing apps keep one fixed, high-contrast palette so every student sees the same
 * screen. Original layout and visuals; no product names or marks.
 */
export interface DigitalOptions {
  variant: 'adaptive' | 'linear' | 'free';
  onExit(): void;
  /** Free-response rooms render multi-part questions their own way. */
  renderQuestion?(q: ExamQuestion, ctx: { run: ExamRun; root: HTMLElement; host: ExamHost; onChange(): void }): HTMLElement | null;
}

export function mountDigitalRoom(root: HTMLElement, run: ExamRun, host: ExamHost, opts: DigitalOptions): RoomView {
  root.className = `ex-room ex-dg ex-dg-${opts.variant}${opts.variant === 'free' ? ' ex-fr' : ''}`;
  root.setAttribute('aria-label', `${run.profile.name}, practice exam`);
  const p = run.profile;
  const say = liveRegion(root);
  let calcOpen = false;
  let refOpen = false;
  let navOpen = false;
  let dirOpen = false;
  let elim = false; // eliminator mode (per room, like the toggle on screen tests)
  let calc: ReturnType<typeof mountCalculator> | null = null;
  let breakView: ReturnType<typeof breakScreen> | null = null;
  let timeEl: HTMLElement | null = null;
  let timerBox: HTMLElement | null = null;
  const stage = h('div', { class: 'ex-dg-stage' });
  root.append(stage);
  const warn = banner(root);
  const unwatch = fullscreenWatch(run, root, warn);

  const calcKind = () => (p.tools.calculator === 'none' ? null : p.tools.calculator);
  const calcAllowed = () => !!calcKind() && run.calculatorAllowed();
  const refSource = () => p.tools.referenceSheet ?? p.tools.formulaSheet;

  // ---- header

  function header(): HTMLElement {
    const s = run.viewSection;
    timeEl = h('span', { class: 'ex-dg-time', role: 'timer', 'aria-label': 'Time remaining' });
    const hideBtn = h('button', { type: 'button', class: 'ex-dg-timer-toggle', 'data-act': 'timer', onclick: () => (run.toggleTimer(), paintTimer()) });
    timerBox = h('div', { class: 'ex-dg-timer' }, timeEl, hideBtn);
    const tools = h('div', { class: 'ex-dg-tools' });
    if (calcAllowed()) tools.append(toolBtn('calc', 'Calculator', calcOpen, () => ((calcOpen = !calcOpen), render())));
    if (refSource()) tools.append(toolBtn('ref', opts.variant === 'free' ? 'Formulas' : 'Reference', refOpen, () => ((refOpen = !refOpen), render())));
    if (host.openScratch && opts.variant === 'free') tools.append(toolBtn('scratch', 'Scratch', false, () => host.openScratch!()));
    // AP-style return to an earlier part on this part's clock, and back.
    if (run.visiting) tools.append(h('button', { type: 'button', class: 'ex-dg-tool', 'data-act': 'leave-return', onclick: () => run.leaveReturn() }, icon('ref'), h('span', { class: 'ex-dg-tool-label' }, `Back to ${run.section.title}`)));
    else if (run.returnTarget()) tools.append(h('button', { type: 'button', class: 'ex-dg-tool', 'data-act': 'return', onclick: () => run.visitReturn() }, icon('ref'), h('span', { class: 'ex-dg-tool-label' }, `Go to ${run.returnTarget()!.title}`)));
    tools.append(toolBtn('more', 'More', false, (e) => moreMenu(e.currentTarget as HTMLElement)));
    return h('header', { class: 'ex-dg-top' },
      h('div', { class: 'ex-dg-top-l' },
        h('h1', { class: 'ex-dg-title' }, s.title),
        h('button', { type: 'button', class: 'ex-dg-dir-btn', 'aria-expanded': String(dirOpen), 'aria-controls': 'ex-dg-dir', 'data-act': 'dir', onclick: () => ((dirOpen = !dirOpen), dirOpen || run.dismissDirections(), render()) }, 'Directions', icon(dirOpen ? 'up' : 'down', 'ex-ico ex-ico-sm')),
      ),
      timerBox,
      tools,
    );
  }

  function toolBtn(ico: string, label: string, pressed: boolean, on: (e: Event) => void): HTMLElement {
    return h('button', { type: 'button', class: 'ex-dg-tool', 'aria-label': label, title: label, 'aria-pressed': ico === 'more' ? null : String(pressed), 'aria-haspopup': ico === 'more' ? 'menu' : null, 'data-act': `tool-${ico}`, onclick: on }, icon(ico), h('span', { class: 'ex-dg-tool-label' }, label));
  }

  function paintTimer(): void {
    if (!timeEl || !timerBox) return;
    const left = run.timeLeft();
    const btn = timerBox.querySelector('button')!;
    if (left === null) {
      timerBox.hidden = true;
      return;
    }
    const visible = run.timerVisible();
    timeEl.textContent = visible ? clock(left) : '';
    timeEl.hidden = !visible;
    timerBox.classList.toggle('is-hidden', !visible);
    timerBox.classList.toggle('is-urgent', left <= LAST_MINUTES_MS);
    timeEl.setAttribute('aria-label', `Time remaining ${clock(left)}`);
    btn.hidden = !run.canHideTimer();
    clear(btn);
    btn.append(visible ? 'Hide' : 'Show');
    btn.setAttribute('aria-label', visible ? 'Hide timer' : 'Show timer');
    if (!visible) timerBox.prepend(timeEl);
    const ico = timerBox.querySelector('.ex-ico');
    if (!visible && !ico) timerBox.insertBefore(icon('clock'), btn);
    if (visible && ico) ico.remove();
  }

  function moreMenu(anchor: HTMLElement): void {
    const close = () => menu.remove();
    const item = (label: string, on: () => void) => h('button', { type: 'button', role: 'menuitem', class: 'ex-menu-item', onclick: () => (close(), on()) }, label);
    const menu = h('div', { class: 'ex-menu', role: 'menu', 'aria-label': 'More' },
      p.rules.allowPause ? item('Pause', () => run.setPaused(true)) : null,
      item('Keyboard shortcuts', () => void shortcuts()),
      item('Save and exit', () => void saveExit()),
    );
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (close(), anchor.focus());
    });
    root.append(menu);
    const r = anchor.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    menu.style.top = `${r.bottom - rr.top + 6}px`;
    menu.style.right = `${Math.max(8, rr.right - r.right)}px`;
    (menu.querySelector('button') as HTMLElement | null)?.focus();
    setTimeout(() => root.addEventListener('pointerdown', function off(e) {
      if (!menu.contains(e.target as Node)) close();
      root.removeEventListener('pointerdown', off);
    }), 0);
  }

  async function shortcuts() {
    await dialog(root, {
      title: 'Keyboard shortcuts',
      body: [h('dl', { class: 'ex-keys' },
        ...[
          ['→ / ←', 'Next / back'],
          ['A – E', 'Choose an answer'],
          ['Shift + A – E', 'Cross out a choice'],
          ['M', 'Mark for review'],
          ['Q', 'Open the question list'],
          ['Esc', 'Close a panel'],
        ].flatMap(([k, v]) => [h('dt', null, h('kbd', null, k!)), h('dd', null, v!)]))],
      actions: [{ label: 'Close', primary: true }],
    });
  }

  async function saveExit() {
    const r = await dialog(root, { title: 'Save and exit?', body: ['Your answers and remaining time are saved on this device. Continue later from the exam center.'], actions: [{ label: 'Keep testing' }, { label: 'Save and exit', primary: true }] });
    if (r === 'Save and exit') {
      run.save();
      exitFullscreen();
      opts.onExit();
    }
  }

  // ---- question

  function questionCard(q: ExamQuestion): HTMLElement {
    const flagged = run.flagged(q.id);
    const hasChoices = !!q.choices?.length;
    const head = h('div', { class: 'ex-dg-qhead' },
      h('span', { class: 'ex-dg-qnum', 'aria-label': `Question ${run.st.q + 1}` }, String(run.st.q + 1)),
      p.tools.markForReview
        ? h('button', { type: 'button', class: 'ex-dg-mark', 'aria-pressed': String(flagged), 'data-act': 'mark', onclick: () => toggleMark() }, icon('bookmark', `ex-ico${flagged ? ' is-on' : ''}`), h('span', null, 'Mark for Review'))
        : null,
      h('span', { class: 'ex-dg-qhead-gap' }),
      hasChoices && p.tools.eliminator
        ? h('button', { type: 'button', class: 'ex-dg-abc', 'aria-pressed': String(elim), 'aria-label': 'Answer eliminator', title: 'Cross out answer choices', 'data-act': 'abc', onclick: () => ((elim = !elim), render()) }, h('span', null, 'ABC'))
        : null,
    );
    const custom = opts.renderQuestion?.(q, { run, root, host, onChange: paintNavState });
    if (custom) return h('article', { class: 'ex-dg-q ex-fr-q', tabindex: '-1', 'aria-label': `Question ${run.st.q + 1} of ${run.ids().length}` }, head, custom);
    const body = h('div', { class: 'ex-dg-qbody' }, promptView(run, q, { highlight: p.tools.highlighter, root }));
    if (hasChoices) body.append(choicesView(run, q, { eliminate: elim && p.tools.eliminator, onChange: paintNavState }));
    else body.append(h('div', { class: 'ex-dg-spr' }, responseView(run, q, paintNavState), q.type === 'numeric' ? sprHelp() : null));
    return h('article', { class: 'ex-dg-q', tabindex: '-1', 'aria-label': `Question ${run.st.q + 1} of ${run.ids().length}` }, head, body);
  }

  function sprHelp(): HTMLElement {
    return h('details', { class: 'ex-dg-sprhelp' }, h('summary', null, 'How to enter your answer'),
      h('ul', null,
        h('li', null, 'If you find more than one correct answer, enter only one.'),
        h('li', null, 'Enter fractions like 3/4 and decimals like 0.75; either form is fine unless the question says otherwise.'),
        h('li', null, 'Negative answers start with a minus sign.'),
        h('li', null, 'Don’t enter symbols such as %, $, or units.'),
      ));
  }

  function toggleMark() {
    const on = run.toggleFlag();
    say(on ? 'Marked for review' : 'Unmarked');
    const b = root.querySelector('.ex-dg-mark');
    b?.setAttribute('aria-pressed', String(on));
    b?.querySelector('.ex-ico')?.classList.toggle('is-on', on);
    paintNavState();
  }

  // ---- navigator and review

  function navGrid(onPick: (i: number) => void): HTMLElement {
    const ids = run.ids();
    return h('div', { class: 'ex-nav-grid', role: 'list' }, ids.map((id, i) => {
      const answered = run.answered(id);
      const flagged = run.flagged(id);
      const current = i === run.st.q && run.st.phase === 'section';
      const label = `Question ${i + 1}, ${answered ? 'answered' : 'unanswered'}${flagged ? ', marked for review' : ''}${current ? ', current' : ''}`;
      return h('div', { role: 'listitem' }, h('button', {
        type: 'button',
        class: `ex-nav-cell${answered ? ' is-answered' : ''}${flagged ? ' is-flagged' : ''}${current ? ' is-current' : ''}`,
        'aria-label': label,
        'data-q': i + 1,
        onclick: () => onPick(i),
      }, current ? icon('pin', 'ex-ico ex-nav-pin') : null, String(i + 1), flagged ? icon('bookmark', 'ex-ico ex-nav-flag') : null));
    }));
  }

  function legend(): HTMLElement {
    return h('div', { class: 'ex-nav-legend', 'aria-hidden': 'true' },
      h('span', null, icon('pin', 'ex-ico'), 'Current'),
      h('span', null, h('i', { class: 'ex-nav-swatch is-unanswered' }), 'Unanswered'),
      h('span', null, icon('bookmark', 'ex-ico is-on'), 'For Review'),
    );
  }

  function navPopover(): HTMLElement {
    const pop = h('div', { class: 'ex-nav-pop', role: 'dialog', 'aria-label': `${run.section.title} questions` },
      h('div', { class: 'ex-nav-pop-head' }, h('h2', null, `${run.section.title} Questions`), h('button', { type: 'button', class: 'ex-panel-x', 'aria-label': 'Close question list', onclick: () => ((navOpen = false), render()) }, icon('close'))),
      legend(),
      navGrid((i) => {
        navOpen = false;
        run.go(i);
      }),
      h('button', { type: 'button', class: 'ex-btn ex-btn-outline ex-nav-review', onclick: () => ((navOpen = false), run.review()) }, 'Go to Review Page'),
    );
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        navOpen = false;
        render();
        (root.querySelector('.ex-dg-navbtn') as HTMLElement | null)?.focus();
      }
    });
    queueMicrotask(() => (pop.querySelector('.is-current') as HTMLElement | null ?? pop.querySelector('.ex-nav-cell') as HTMLElement | null)?.focus());
    return pop;
  }

  function reviewPage(): HTMLElement {
    const ids = run.ids();
    const unanswered = ids.filter((id) => !run.answered(id)).length;
    const flagged = ids.filter((id) => run.flagged(id)).length;
    return h('div', { class: 'ex-dg-review' },
      h('h2', { class: 'ex-dg-review-title', tabindex: '-1' }, 'Check Your Work'),
      h('p', null, run.isLastSection ? 'This is the end of the exam. Look over your answers before you submit.' : 'Look over your answers before you move on. Once you continue, you can’t come back to this part.'),
      h('p', null, 'Select a question number to return to it. ', h('strong', null, `${unanswered} unanswered`), ', ', h('strong', null, `${flagged} marked for review`), '.'),
      h('section', { class: 'ex-dg-review-card', 'aria-label': `${run.section.title} questions` },
        h('div', { class: 'ex-dg-review-head' }, h('h3', null, `${run.section.title} Questions`), legend()),
        navGrid((i) => run.go(i)),
      ),
    );
  }

  // ---- footer

  function footer(): HTMLElement {
    const reviewing = run.st.phase === 'review';
    const n = run.ids().length;
    const backOk = reviewing || run.st.q > 0 || run.canReturnToPrevious();
    return h('footer', { class: 'ex-dg-bot' },
      h('div', { class: 'ex-dg-who' }, h('span', { class: 'ex-dg-who-name' }, 'Practice session'), h('span', { class: 'ex-dg-who-exam' }, p.name)),
      reviewing
        ? h('span', { class: 'ex-dg-navbtn-gap' })
        : h('button', { type: 'button', class: 'ex-dg-navbtn', 'aria-expanded': String(navOpen), 'aria-haspopup': 'dialog', 'data-act': 'nav', onclick: () => ((navOpen = !navOpen), render()) }, `Question ${run.st.q + 1} of ${n}`, icon(navOpen ? 'down' : 'up', 'ex-ico ex-ico-sm')),
      h('div', { class: 'ex-dg-move' },
        backOk ? h('button', { type: 'button', class: 'ex-btn ex-btn-pill', 'data-act': 'back', onclick: () => run.back() }, 'Back') : null,
        h('button', { type: 'button', class: 'ex-btn ex-btn-pill ex-btn-primary', 'data-act': 'next', onclick: () => (reviewing ? (run.visiting ? run.leaveReturn() : void submit()) : run.next()) }, reviewing ? (run.visiting ? 'Back' : run.isLastSection ? 'Submit' : 'Next') : 'Next'),
      ),
    );
  }

  async function submit() {
    const sid = run.section.id;
    const unanswered = run.ids().filter((id) => !run.answered(id)).length;
    const last = run.isLastSection;
    const r = await dialog(root, {
      title: last ? 'Submit your exam?' : `Finish ${run.section.title}?`,
      body: [
        unanswered ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. There is no penalty for guessing.` : 'You’ve answered every question.',
        run.section.canReturn || last ? '' : 'You won’t be able to return to this part.',
      ].filter(Boolean),
      actions: [{ label: 'Return to review' }, { label: last ? 'Submit' : 'Continue', primary: true }],
    });
    if (r === 'Submit' || r === 'Continue') run.submitSection(false, sid);
  }

  function paintNavState() {
    // Answer state shows up in the navigator; nothing else on screen needs a rebuild.
    if (navOpen) render();
  }

  // ---- render

  function render(): void {
    const focusAct = (document.activeElement as HTMLElement | null)?.dataset?.act;
    clear(stage);
    root.querySelectorAll('.ex-hl-tools, .ex-menu').forEach((x) => x.remove());
    breakView = null;
    timeEl = null;
    const st = run.st;
    if (st.phase === 'intro') {
      stage.append(introScreen(run, root, () => warn.show('Full screen isn’t available here, so the exam fills this window instead.')));
      return;
    }
    if (st.phase === 'break') {
      breakView = breakScreen(run);
      stage.append(breakView.el);
      keepFocus();
      return;
    }
    if (st.phase === 'done') return;
    if (st.directions && !dirOpen) dirOpen = true;
    const s = run.viewSection;
    const top = header();
    const directions = h('div', { id: 'ex-dg-dir', class: 'ex-dg-dir', hidden: !dirOpen, role: 'region', 'aria-label': 'Directions' },
      h('div', { class: 'ex-dg-dir-inner' },
        h('h2', null, 'Directions'),
        h('p', null, s.instructions ?? 'Answer each question. You may move back and forth within this part and change your answers until time runs out.'),
        calcAllowed() ? h('p', null, 'A calculator is available from the toolbar.') : h('p', null, 'No calculator is allowed in this part.'),
        h('button', { type: 'button', class: 'ex-btn ex-btn-primary', 'data-act': 'dir-close', onclick: () => ((dirOpen = false), run.dismissDirections(), render()) }, 'Close'),
      ));
    const main = h('main', { class: `ex-dg-main${calcOpen && calcAllowed() ? ' has-calc' : ''}` });
    if (calcOpen && calcAllowed()) {
      calc ??= mountCalculator(host, calcKind()!);
      main.append(floatingPanel(root, { title: 'Calculator', className: 'ex-dg-calc', body: calc.root, onClose: () => ((calcOpen = false), render()) }));
    }
    const pane = h('div', { class: 'ex-dg-pane' });
    if (st.phase === 'review') pane.append(reviewPage());
    else {
      const q = run.question();
      if (q) pane.append(questionCard(q));
    }
    main.append(pane);
    if (refOpen && refSource()) main.append(floatingPanel(root, { title: 'Reference', className: 'ex-dg-ref', body: referenceSheet(refSource()), onClose: () => ((refOpen = false), render()) }));
    stage.append(top, directions, h('div', { class: 'ex-dg-rule', 'aria-hidden': 'true' }), main, footer());
    if (navOpen && st.phase === 'section') stage.append(navPopover());
    if (st.paused) stage.append(pauseScreen(run));
    paintTimer();
    if (focusAct) (stage.querySelector(`[data-act="${focusAct}"]`) as HTMLElement | null)?.focus();
    else if (st.phase === 'review') (stage.querySelector('.ex-dg-review-title') as HTMLElement | null)?.focus();
    keepFocus();
  }

  /**
   * After Start, a section change or a break, the focused control is gone and focus falls to the page body,
   * where the room's keys (Esc, A–E, arrows) don't reach. Put it back inside the room.
   */
  function keepFocus(): void {
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) return;
    if (root.querySelector('.ex-dialog-wrap')) return;
    const target = (stage.querySelector('.ex-break .ex-btn-primary') ?? (dirOpen ? stage.querySelector('[data-act="dir-close"]') : null) ?? stage.querySelector('.ex-dg-q')) as HTMLElement | null;
    target?.focus({ preventScroll: true });
  }

  // ---- keyboard

  const onKey = (e: KeyboardEvent) => {
    // While paused the questions are hidden and the clock is stopped: no answering or moving around.
    if ((run.st.phase !== 'section' && run.st.phase !== 'review') || run.st.paused) return;
    if (e.key === 'Escape') {
      if (navOpen) navOpen = false;
      else if (refOpen) refOpen = false;
      else if (dirOpen) ((dirOpen = false), run.dismissDirections());
      else return;
      render();
      return;
    }
    if (typing(e) || e.metaKey || e.ctrlKey || root.querySelector('.ex-dialog-wrap')) return;
    const q = run.question();
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowRight' && run.st.phase === 'section') (e.preventDefault(), run.next());
    else if (e.key === 'ArrowLeft') (e.preventDefault(), run.back());
    else if (k === 'm' && !e.altKey && run.st.phase === 'section' && p.tools.markForReview) toggleMark();
    else if (k === 'q' && run.st.phase === 'section') ((navOpen = !navOpen), render());
    else if (q?.choices && /^[a-e]$/.test(k) && run.st.phase === 'section') {
      const c = q.choices.find((x) => x.id.toLowerCase() === k);
      if (!c) return;
      e.preventDefault();
      let msg: string;
      if (e.shiftKey && p.tools.eliminator) msg = run.toggleEliminate(q.id, c.id) ? `Choice ${c.id} crossed out` : `Choice ${c.id} restored`;
      else if (run.eliminated(q.id).includes(c.id)) msg = `Choice ${c.id} is crossed out`;
      else if (q.type === 'multi') {
        // Select-all-that-apply: a letter toggles that choice and keeps the others.
        const cur = run.attempt.answers[q.id];
        const list = Array.isArray(cur) ? cur : [];
        const on = !list.includes(c.id);
        run.setAnswer(q.id, on ? [...list, c.id].sort() : list.filter((x) => x !== c.id));
        msg = `Choice ${c.id} ${on ? 'selected' : 'cleared'}`;
      } else {
        run.setAnswer(q.id, c.id);
        msg = `Choice ${c.id} selected`;
      }
      render();
      say(msg);
    }
  };
  root.addEventListener('keydown', onKey);

  return {
    render,
    tick() {
      if (breakView) breakView.tick();
      else paintTimer();
    },
    warn(m) {
      warn.show(m);
      say(m);
    },
    notice(m) {
      closeDialogs(root);
      setTimeout(() => root.isConnected && run.st.phase !== 'done' && void dialog(root, { title: 'Time is up', body: [m], actions: [{ label: 'OK', primary: true }] }), 0);
    },
    destroy() {
      root.removeEventListener('keydown', onKey);
      unwatch();
      calc?.destroy();
    },
  };
}
