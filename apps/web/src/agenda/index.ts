import './agenda.css';
import { countUp } from '../motion';
import {
  agendaView,
  diffDays,
  formatDay,
  isAsk,
  parseTask,
  planExam,
  progress,
  relativeDay,
  taskProgress,
  TOPIC_IDS,
  topicLabel,
  topicNoun,
  weekSentence,
  type Activity,
  type PlanItem,
  type ReviewSuggestion,
  type Task,
  type Topic,
} from '@lemma/agenda-engine';
import { WebSpeechRecognizer } from '../speech';
import { accuracyLine, dailyBars } from './charts';
import { CHANGE_EVENT, deleteTask, load, loadPrefs, locale, nowMs, recordActivity, saveTask, savePrefs, today, type RecordResult } from './store';

/**
 * Study agenda (ROADMAP Phase 8). The app calls mountAgenda() to show it and recordActivity() whenever the user
 * studies; both are safe to call in any order. Storage key `lemma.agenda.v1`, sync collection "agenda".
 */

export { recordActivity, warmActivity, type RecordResult } from './store';
export type { ActivityEvent, ActivityKind } from '@lemma/agenda-engine';

export interface AgendaHost {
  toast(m: string): void;
  openPractice(topic?: string): void;
  openExam(): void;
  openLesson(topic: string): void;
  speak?(t: string): void;
}

/** Adds a task from plain language (for a voice command like "add problem set 4 due Friday"). */
export function addTaskFromText(text: string): { task: Task } | { ask: string } {
  const r = parseTask(text, nowMs(), locale());
  if (isAsk(r)) return r;
  saveTask(r);
  return { task: r };
}

// ---------------------------------------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean | undefined> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

const ICONS: Record<string, string> = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
};
function icon(name: keyof typeof ICONS): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ag-ico');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]!);
  s.append(p);
  return s;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

function dueText(t: Task, day: string): string {
  const n = diffDays(day, t.due);
  const when = n < 0 ? `overdue by ${plural(-n, 'day')}` : relativeDay(t.due, day);
  return `${formatDay(t.due, locale())}${t.time ? ` ${t.time}` : ''} · ${when}`;
}

let uid = 0;

// ---------------------------------------------------------------------------------------------------------
// mountAgenda
// ---------------------------------------------------------------------------------------------------------

export function mountAgenda(container: HTMLElement, host: AgendaHost): () => void {
  const root = h('div', { class: 'ag', 'data-agenda': '' });
  container.replaceChildren(root);
  const id = `ag${++uid}`;
  const openPlans = new Set<string>();
  const openEdits = new Set<string>();

  // ---- add form ------------------------------------------------------------------------------------------
  const input = h('input', {
    id: `${id}-input`,
    class: 'ag-input',
    type: 'text',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: 'Problem set 4 due Friday, 12 problems',
    'aria-describedby': `${id}-preview`,
  });
  const preview = h('p', { id: `${id}-preview`, class: 'ag-preview', 'aria-live': 'polite' });
  const rec = new WebSpeechRecognizer();
  const mic = rec.supported ? h('button', { type: 'button', class: 'ag-iconbtn ag-mic', 'aria-label': 'Say a task', 'aria-pressed': 'false' }, icon('mic')) : null;
  const form = h(
    'form',
    { class: 'ag-add', 'aria-label': 'Add a task' },
    h('label', { for: input.id, class: 'ag-label', text: 'Add a task, test or problem set' }),
    h('div', { class: 'ag-addrow' }, input, mic, h('button', { type: 'submit', class: 'ag-btn ag-primary', text: 'Add' })),
    preview,
  );

  const describe = (t: Task) =>
    [
      `${t.kind === 'exam' ? 'On' : 'Due'} ${formatDay(t.due, locale(), { weekday: 'short', month: 'short', day: 'numeric' })}${t.time ? ` ${t.time}` : ''}`,
      t.count ? plural(t.count, 'problem') : '',
      t.scope ?? '',
      t.topics.length ? t.topics.map(topicLabel).join(', ') + (t.topicsGuessed ? ' (guessed)' : '') : '',
    ]
      .filter(Boolean)
      .join(' · ');

  const updatePreview = () => {
    const v = input.value.trim();
    preview.classList.remove('ag-ask');
    if (!v) return void (preview.textContent = 'Try "Calc test on the 14th, chapters 3–4" or "20 integral problems in 2 weeks".');
    const r = parseTask(v, nowMs(), locale(), { id: 'preview' });
    preview.textContent = isAsk(r) ? r.ask : `${r.title}: ${describe(r)}`;
    preview.classList.toggle('ag-ask', isAsk(r));
  };

  const add = (text: string, spoken = false) => {
    const r = addTaskFromText(text);
    if ('ask' in r) {
      preview.textContent = r.ask;
      preview.classList.add('ag-ask');
      if (spoken) host.speak?.(r.ask);
      input.focus();
      return;
    }
    input.value = '';
    updatePreview();
    const msg = `Added ${r.task.title}, ${r.task.kind === 'exam' ? 'on' : 'due'} ${formatDay(r.task.due, locale(), { weekday: 'long', month: 'long', day: 'numeric' })}.`;
    host.toast(msg);
    if (spoken) host.speak?.(msg);
  };

  input.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    add(input.value);
  });
  let listening = false;
  mic?.addEventListener('click', () => {
    if (listening) return rec.stop();
    listening = true;
    mic.setAttribute('aria-pressed', 'true');
    mic.classList.add('ag-on');
    rec.start(
      { lang: locale(), continuous: false, preferOnDevice: true },
      {
        onPartial: (t) => {
          input.value = t;
          updatePreview();
        },
        onFinal: (t) => {
          input.value = t;
          add(t, true);
        },
        onEnd: () => {
          listening = false;
          mic.setAttribute('aria-pressed', 'false');
          mic.classList.remove('ag-on');
        },
        onError: (m) => host.toast(m),
      },
    );
  });
  updatePreview();

  // ---- sections ------------------------------------------------------------------------------------------
  const todayList = h('div', { class: 'ag-list' });
  const upcomingList = h('div', { class: 'ag-list' });
  const progressBox = h('div', { class: 'ag-progress' });
  const undoBar = h('div', { class: 'ag-undo', role: 'status', 'aria-live': 'polite' });
  const section = (key: string, title: string, body: HTMLElement, extra?: HTMLElement) =>
    h('section', { class: `ag-section ag-${key}`, 'aria-labelledby': `${id}-${key}` }, h('h3', { id: `${id}-${key}`, class: 'ag-h', text: title }), extra, body);

  const notifyBox = h('input', { type: 'checkbox', id: `${id}-notify` });
  notifyBox.checked = loadPrefs().notify && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const settings = h(
    'section',
    { class: 'ag-section ag-settings', 'aria-label': 'Agenda settings' },
    h(
      'label',
      { class: 'ag-switch', for: notifyBox.id },
      notifyBox,
      h('span', {}, h('strong', { text: 'Due-today notifications' }), h('span', { class: 'ag-fine', text: 'A browser notification for tasks due today, only while Lemma is open.' })),
    ),
  );
  notifyBox.addEventListener('change', async () => {
    const prefs = loadPrefs();
    if (!notifyBox.checked) return savePrefs({ ...prefs, notify: false });
    if (typeof Notification === 'undefined') {
      notifyBox.checked = false;
      return host.toast('This browser does not support notifications.');
    }
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') {
      notifyBox.checked = false;
      savePrefs({ ...prefs, notify: false });
      return host.toast('Notifications are blocked for this site. You can allow them in the browser’s site settings.');
    }
    savePrefs({ ...prefs, notify: true });
    host.toast('You’ll get a notification for tasks due today while Lemma is open.');
    checkReminders();
  });

  root.append(
    h('header', { class: 'ag-head' }, h('h2', { class: 'ag-title', text: 'Agenda' }), h('p', { class: 'ag-sub', text: 'Problem sets and tests that fill in as you practise, plus what to review today.' })),
    form,
    section('today', 'Today', todayList),
    section('upcoming', 'Upcoming', upcomingList),
    section('progress-sec', 'Progress', progressBox),
    settings,
    undoBar,
  );

  // ---- rendering -----------------------------------------------------------------------------------------
  const practiceBtn = (topic: Topic | undefined, label = 'Practice', aria?: string) => {
    const b = h('button', { type: 'button', class: 'ag-btn', text: label, 'aria-label': aria });
    b.addEventListener('click', () => host.openPractice(topic));
    return b;
  };

  function planItemRow(task: Task, item: PlanItem, compact: boolean): HTMLElement | null {
    if (item.kind === 'exam') return compact ? null : h('li', { class: 'ag-plan-item ag-plan-exam' }, h('span', { text: item.label }));
    const done = item.done;
    const label = h('span', { class: 'ag-plan-label', text: item.label });
    const status = done ? h('span', { class: 'ag-tag ag-ok', text: 'Done' }) : null;
    let action: HTMLElement | null = null;
    if (!done) {
      if (item.kind === 'mock') {
        action = h('button', { type: 'button', class: 'ag-btn ag-primary', text: 'Start mock exam' });
        action.addEventListener('click', () => host.openExam());
      } else action = practiceBtn(item.topic, 'Practice', `Practice ${item.topic ? topicNoun(item.topic) : ''} for ${task.title}`.replace(/\s+/g, ' '));
    }
    return h('li', { class: `ag-plan-item${done ? ' ag-done' : ''}`, 'data-kind': item.kind }, label, status, action);
  }

  function planBlock(task: Task, activities: Activity[], day: string): HTMLElement {
    const plan = planExam(task, day, activities);
    const days = h('ol', { class: 'ag-plan', 'aria-label': `Plan for ${task.title}` });
    for (const d of plan.days) {
      const items = h('ul', { class: 'ag-plan-items' }, ...d.items.map((i) => planItemRow(task, i, false)));
      days.append(h('li', { class: `ag-plan-day${d.day === day ? ' ag-now' : ''}`, 'data-day': d.day }, h('span', { class: 'ag-plan-date', text: d.day === day ? 'Today' : formatDay(d.day, locale()) }), items));
    }
    const weights = plan.weights.length
      ? h('p', { class: 'ag-fine', text: `Focus: ${plan.weights.map((w) => `${topicLabel(w.topic)} ${Math.round(w.share * 100)}%`).join(', ')}. Weaker and less-practised topics get more time.` })
      : null;
    return h('div', { class: 'ag-planbox' }, weights, days);
  }

  function taskCard(task: Task, activities: Activity[], day: string): HTMLElement {
    const p = taskProgress(task, activities);
    const n = diffDays(day, task.due);
    const check = h('input', { type: 'checkbox', class: 'ag-check', 'aria-label': `Mark ${task.title} done`, 'data-focus': `${task.id}:check` });
    check.checked = p.complete;
    check.addEventListener('change', () => saveTask({ ...task, done: check.checked }));

    const tags: HTMLElement[] = [];
    if (task.kind === 'exam') tags.push(h('span', { class: 'ag-tag', text: 'Exam' }));
    if (!p.complete && n < 0) tags.push(h('span', { class: 'ag-tag ag-warn', text: 'Overdue' }));
    else if (!p.complete && n === 0) tags.push(h('span', { class: 'ag-tag ag-warn', text: task.kind === 'exam' ? 'Today' : 'Due today' }));

    const meta = h('p', { class: 'ag-meta', text: [dueText(task, day), task.scope].filter(Boolean).join(' · ') });
    const topics = task.topics.length
      ? h('p', { class: 'ag-topics' }, ...task.topics.map((t) => h('span', { class: 'ag-chip', text: topicLabel(t) })), task.topicsGuessed ? h('span', { class: 'ag-fine', text: 'guessed' }) : null)
      : null;

    let bar: HTMLElement | null = null;
    if (p.total !== undefined) {
      const fill = h('span', { class: 'ag-bar-fill' });
      fill.style.width = `${Math.round((p.fraction ?? 0) * 100)}%`;
      bar = h(
        'div',
        { class: 'ag-progressrow' },
        h('div', { class: 'ag-bar-track', role: 'progressbar', 'aria-label': `${task.title} progress`, 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': Math.min(p.done, p.total), 'aria-valuetext': `${p.done} of ${p.total}` }, fill),
        h('span', { class: 'ag-count', text: `${p.done} of ${p.total}` }),
      );
    } else if (task.kind !== 'exam' && p.done > 0) {
      bar = h('p', { class: 'ag-fine ag-count', text: `${plural(p.done, 'problem')} done` });
    }

    const actions = h('div', { class: 'ag-actions' });
    if (!p.complete) actions.append(practiceBtn(task.topics[0], 'Practice', `Practice for ${task.title}`));
    if (task.kind !== 'exam' && !p.complete) {
      const plus = h('button', { type: 'button', class: 'ag-btn', 'aria-label': `Log one problem for ${task.title} done on paper`, 'data-focus': `${task.id}:plus` }, icon('plus'), '1');
      plus.addEventListener('click', () => saveTask({ ...task, extra: (task.extra ?? 0) + 1 }));
      actions.append(plus);
    }
    if (task.kind === 'exam' && !p.complete && n >= 0) {
      const toggle = h('button', { type: 'button', class: 'ag-btn', 'aria-expanded': String(openPlans.has(task.id)), text: openPlans.has(task.id) ? 'Hide plan' : 'Plan', 'data-focus': `${task.id}:plan` });
      toggle.addEventListener('click', () => {
        if (openPlans.has(task.id)) openPlans.delete(task.id);
        else openPlans.add(task.id);
        render();
      });
      actions.append(toggle);
    }
    const edit = h('button', { type: 'button', class: 'ag-btn', 'aria-expanded': String(openEdits.has(task.id)), text: 'Topics', 'data-focus': `${task.id}:edit` });
    edit.addEventListener('click', () => {
      if (openEdits.has(task.id)) openEdits.delete(task.id);
      else openEdits.add(task.id);
      render();
    });
    actions.append(edit);
    const del = h('button', { type: 'button', class: 'ag-iconbtn', 'aria-label': `Delete ${task.title}` }, icon('close'));
    del.addEventListener('click', () => {
      const gone = deleteTask(task.id);
      if (!gone) return;
      const undo = h('button', { type: 'button', class: 'ag-link', text: 'Undo' });
      undo.addEventListener('click', () => {
        saveTask(gone);
        undoBar.replaceChildren();
      });
      undoBar.replaceChildren(h('span', { text: `Deleted ${gone.title}.` }), undo);
    });
    actions.append(del);

    let editor: HTMLElement | null = null;
    if (openEdits.has(task.id)) {
      editor = h('fieldset', { class: 'ag-topic-edit' }, h('legend', { text: `Topics for ${task.title}` }));
      for (const t of TOPIC_IDS) {
        const cb = h('input', { type: 'checkbox', value: t, 'data-focus': `${task.id}:topic:${t}` });
        cb.checked = task.topics.includes(t);
        cb.addEventListener('change', () => {
          const topics = TOPIC_IDS.filter((x) => (x === t ? cb.checked : task.topics.includes(x)));
          const { topicsGuessed: _g, ...rest } = task;
          saveTask({ ...rest, topics });
        });
        editor.append(h('label', { class: 'ag-topic-opt' }, cb, h('span', { text: topicLabel(t) })));
      }
    }

    const plan = task.kind === 'exam' && openPlans.has(task.id) && n >= 0 ? planBlock(task, activities, day) : null;
    return h(
      'article',
      { class: `ag-task${p.complete ? ' ag-complete' : ''}`, 'data-task': task.id, 'aria-label': task.title },
      check,
      h('div', { class: 'ag-task-body' }, h('h4', { class: 'ag-task-title' }, h('span', { text: task.title }), ...tags), meta, topics, bar, actions, editor, plan),
    );
  }

  function reviewRow(r: ReviewSuggestion): HTMLElement {
    const lesson = h('button', { type: 'button', class: 'ag-btn', text: 'Lesson', 'aria-label': `Lesson on ${topicNoun(r.topic)}` });
    lesson.addEventListener('click', () => host.openLesson(topicLabel(r.topic)));
    return h(
      'article',
      { class: 'ag-review', 'data-topic': r.topic, 'data-reason': r.kind, 'aria-label': r.title },
      h('div', { class: 'ag-task-body' }, h('h4', { class: 'ag-task-title', text: r.title }), h('p', { class: 'ag-meta', text: r.reason }), h('div', { class: 'ag-actions' }, practiceBtn(r.topic, 'Practice', `Practice ${topicNoun(r.topic)}`), lesson)),
    );
  }

  function render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    draw();
    if (focusKey) root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function draw(): void {
    const day = today();
    const { tasks, activities } = load();
    const v = agendaView(tasks, activities, day);

    // Today
    const items: HTMLElement[] = [];
    for (const t of v.dueToday) items.push(taskCard(t, activities, day));
    for (const e of v.examToday) {
      const left = diffDays(day, e.task.due);
      const rows = e.items.map((i) => planItemRow(e.task, i, true)).filter((x): x is HTMLElement => !!x);
      items.push(
        h(
          'article',
          { class: 'ag-review ag-examday', 'data-exam': e.task.id, 'aria-label': `${e.task.title} plan for today` },
          h('div', { class: 'ag-task-body' }, h('h4', { class: 'ag-task-title', text: `${e.task.title} ${left === 0 ? 'is today' : `in ${plural(left, 'day')}`}` }), h('ul', { class: 'ag-plan-items' }, ...rows)),
        ),
      );
    }
    if (v.reviews.length) {
      items.push(h('h4', { class: 'ag-subh', text: 'Review' }));
      for (const r of v.reviews) items.push(reviewRow(r));
    }
    todayList.replaceChildren(...(items.length ? items : [h('p', { class: 'ag-empty', text: 'Nothing due today. Add a task above, or practise anything to keep your streak going.' })]));

    // Upcoming
    const up = v.upcoming.map((t) => taskCard(t, activities, day));
    if (v.finished.length) {
      const det = h('details', { class: 'ag-finished' }, h('summary', { text: `Finished (${v.finished.length})` }), ...v.finished.map((t) => taskCard(t, activities, day)));
      up.push(det);
    }
    upcomingList.replaceChildren(...(up.length ? up : [h('p', { class: 'ag-empty', text: 'No upcoming tasks.' })]));

    // Progress
    const st = progress(activities, day);
    const tile = (label: string, value: string, sub: string, key: string) =>
      h('div', { class: 'ag-tile', 'data-stat': key }, h('span', { class: 'ag-tile-label', text: label }), h('span', { class: 'ag-tile-value', text: value }), h('span', { class: 'ag-fine', text: sub }));
    const streakSub = st.streak.current && !st.streak.activeToday ? 'Study today to keep it' : `Longest ${plural(st.streak.longest, 'day')}`;
    const tiles = h(
      'div',
      { class: 'ag-tiles' },
      tile('Streak', plural(st.streak.current, 'day'), streakSub, 'streak'),
      tile('Last 7 days', plural(st.week.problems, 'problem'), `${plural(st.week.activeDays, 'study day')}`, 'week'),
      tile('Accuracy', pct(st.week.accuracy), st.week.prevAccuracy === null ? 'last 7 days' : `was ${pct(st.week.prevAccuracy)} the week before`, 'accuracy'),
    );
    const max = Math.max(1, ...st.byTopic.map((t) => t.done));
    const topicRows = st.byTopic.length
      ? h(
          'ul',
          { class: 'ag-topic-stats', 'aria-label': 'Problems done per topic' },
          ...st.byTopic.map((t) => {
            const fill = h('span', { class: 'ag-bar-fill' });
            fill.style.width = `${Math.round((t.done / max) * 100)}%`;
            return h(
              'li',
              { 'data-topic': t.topic },
              h('span', { class: 'ag-topic-name', text: t.label }),
              h('span', { class: 'ag-bar-track', 'aria-hidden': 'true' }, fill),
              h('span', { class: 'ag-topic-num', text: `${t.done}${t.accuracy === null ? '' : ` · ${pct(t.accuracy)}`}` }),
            );
          }),
        )
      : h('p', { class: 'ag-empty', text: 'Solve practice problems, tests or calculations and your progress shows up here.' });
    progressBox.replaceChildren(
      tiles,
      h('p', { class: 'ag-week', text: weekSentence(st.week) }),
      h('div', { class: 'ag-charts' }, h('figure', { class: 'ag-fig' }, h('figcaption', { text: 'Problems per day' }), dailyBars(st.daily, locale())), h('figure', { class: 'ag-fig' }, h('figcaption', { text: 'Accuracy by week' }), accuracyLine(st.trend, locale()))),
      h('h4', { class: 'ag-subh', text: 'By topic' }),
      topicRows,
    );
    // The streak ticks up when it's first shown and whenever it grows.
    const streak = tiles.querySelector<HTMLElement>('[data-stat="streak"] .ag-tile-value');
    if (streak && st.streak.current > shownStreak) countUp(streak, 'content');
    shownStreak = st.streak.current;
  }

  let shownStreak = -1;
  // Progress bars fill when the agenda opens, not on every later change.
  root.classList.add('ag-fresh');
  setTimeout(() => root.classList.remove('ag-fresh'), 600);
  render();
  checkReminders();

  const onChange = () => render();
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('lemma.agenda')) render();
  };
  // Re-render at midnight / when the tab comes back so "today" stays right.
  let lastDay = today();
  const onVisible = () => {
    if (document.visibilityState === 'visible' && today() !== lastDay) {
      lastDay = today();
      render();
    }
  };
  const minute = window.setInterval(onVisible, 60_000);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    rec.stop();
    window.clearInterval(minute);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
    root.remove();
  };
}

/** One-line summary for a toast after recordActivity, e.g. "Problem set 4: 8 of 12". */
export function describeProgress(r: RecordResult | null): string | null {
  const a = r?.advanced[0];
  if (!a) return null;
  if (a.total === undefined) return `${a.task.title}: ${plural(a.done, 'problem')} done`;
  return a.complete && a.done === a.total ? `${a.task.title}: all ${a.total} done` : `${a.task.title}: ${a.done} of ${a.total}`;
}

// ---------------------------------------------------------------------------------------------------------
// Due-today notifications (only when switched on, only while the app is open)
// ---------------------------------------------------------------------------------------------------------

export function checkReminders(): number {
  try {
    const prefs = loadPrefs();
    if (!prefs.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
    const day = today();
    const { tasks, activities } = load();
    let sent = 0;
    for (const t of tasks) {
      const p = taskProgress(t, activities);
      if (p.complete || t.due !== day || prefs.notified[t.id] === day) continue;
      const body = t.kind === 'exam' ? `${t.title} is today${t.time ? ` at ${t.time}` : ''}. Good luck.` : p.total !== undefined ? `${p.done} of ${p.total} problems done.` : 'Due today.';
      new Notification(t.kind === 'exam' ? `Today: ${t.title}` : `Due today: ${t.title}`, { body, tag: `lemma-agenda-${t.id}-${day}` });
      prefs.notified[t.id] = day;
      sent++;
    }
    // Forget old entries.
    for (const [k, d] of Object.entries(prefs.notified)) if (d < day) delete prefs.notified[k];
    savePrefs(prefs);
    return sent;
  } catch {
    return 0;
  }
}

if (typeof window !== 'undefined') {
  window.setInterval(checkReminders, 15 * 60_000);
  setTimeout(checkReminders, 0);
}
