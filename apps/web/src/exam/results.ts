import { TOPICS } from '@lemma/practice-engine';
import { clock, fill, h, icon, mathSpan, svgNS } from './dom';
import { countUp } from '../motion';
import { history, type HistoryEntry } from './store';
import type { Attempt, Exam, ExamHost, ExamQuestion, Result } from './types';

/** Score report: score, sections, topics, pacing, every question reviewable, and the attempt history. */

const topicLabel = (t: string) => TOPICS.find((x) => x.id === t)?.label ?? t;

function show(a: Attempt['answers'][string] | undefined): string {
  if (a === undefined) return '—';
  if (typeof a === 'string') return a || '—';
  if (Array.isArray(a)) return a.join(', ') || '—';
  return Object.entries(a).map(([k, v]) => `(${k}) ${v}`).join('  ') || '—';
}

function bar(value: number, total: number, label: string): HTMLElement {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return h('div', { class: 'ex-res-bar', role: 'img', 'aria-label': `${label}: ${value} of ${total} (${pct}%)` },
    h('div', { class: 'ex-res-bar-fill', style: `width:${pct}%` }));
}

function pacingChart(exam: Exam, attempt: Attempt, result: Result): SVGSVGElement {
  const qs = result.perQuestion;
  const W = Math.max(320, qs.length * 18 + 40);
  const H = 160;
  const max = Math.max(60_000, ...qs.map((q) => q.timeMs));
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  s.setAttribute('class', 'ex-res-pace');
  s.setAttribute('role', 'img');
  const slow = result.pacing.slowest.map((id) => qs.findIndex((q) => q.id === id) + 1).filter((n) => n > 0);
  s.setAttribute('aria-label', `Time per question. Slowest: ${slow.map((n) => `#${n}`).join(', ') || 'none'}.`);
  const plotH = H - 30;
  const bw = (W - 40) / Math.max(1, qs.length);
  let svg = '';
  // Grid: minute lines.
  for (let m = 1; m * 60_000 <= max; m += max > 6 * 60_000 ? 2 : 1) {
    const y = plotH - (m * 60_000 / max) * (plotH - 10);
    svg += `<line x1="30" x2="${W - 6}" y1="${y}" y2="${y}" class="ex-pace-grid"/><text x="26" y="${y + 3}" class="ex-pace-axis" text-anchor="end">${m}m</text>`;
  }
  // Pace target per section.
  let at = 0;
  for (const entry of attempt.sectionOrder) {
    const sec = exam.profile.sections.find((x) => x.id === entry.split(':')[0]);
    if (!sec) continue;
    const n = qs.filter((q) => exam.questions.find((x) => x.id === q.id) && (sec.questionIds.includes(q.id) || sec.adaptive?.easy.includes(q.id) || sec.adaptive?.hard.includes(q.id))).length;
    if (sec.minutes && n) {
      const pace = (sec.minutes * 60_000) / n;
      const y = plotH - Math.min(1, pace / max) * (plotH - 10);
      svg += `<line x1="${34 + at * bw}" x2="${34 + (at + n) * bw - 4}" y1="${y}" y2="${y}" class="ex-pace-target"/>`;
    }
    at += n;
  }
  qs.forEach((q, i) => {
    const hgt = Math.max(1.5, (q.timeMs / max) * (plotH - 10));
    const cls = q.correct === true ? 'ok' : q.correct === 'partial' ? 'part' : 'miss';
    svg += `<rect x="${34 + i * bw}" y="${plotH - hgt}" width="${Math.max(2, bw - 4)}" height="${hgt}" rx="2" class="ex-pace-${cls}"><title>Question ${i + 1}: ${clock(q.timeMs)}</title></rect>`;
    if (qs.length <= 30 || i % 5 === 4) svg += `<text x="${34 + i * bw + (bw - 4) / 2}" y="${H - 12}" class="ex-pace-axis" text-anchor="middle">${i + 1}</text>`;
  });
  s.innerHTML = svg;
  return s;
}

function trend(entries: HistoryEntry[]): SVGSVGElement | null {
  const pts = [...entries].reverse().slice(-12);
  if (pts.length < 2) return null;
  const W = 240;
  const H = 56;
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  s.setAttribute('class', 'ex-res-trend');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `Score trend: ${pts.map((p) => `${Math.round(p.percent)}%`).join(', ')}`);
  const x = (i: number) => 6 + (i * (W - 12)) / (pts.length - 1);
  const y = (v: number) => H - 6 - (v / 100) * (H - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`).join(' ');
  s.innerHTML = `<path d="${d}" class="ex-trend-line"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.percent)}" r="3" class="ex-trend-dot"><title>${new Date(p.finishedAt).toLocaleDateString()}: ${Math.round(p.percent)}%</title></circle>`).join('')}`;
  return s;
}

function reviewItem(q: ExamQuestion, pq: Result['perQuestion'][number], attempt: Attempt, index: number, host: ExamHost): HTMLElement {
  const mine = attempt.answers[q.id];
  const status = pq.correct === true ? 'Correct' : pq.correct === 'partial' ? 'Partly correct' : mine === undefined ? 'Not answered' : 'Incorrect';
  const cls = pq.correct === true ? 'ok' : pq.correct === 'partial' ? 'part' : 'miss';
  const body = h('div', { class: 'ex-res-q-body' },
    q.figure ? h('pre', { class: 'ex-figure' }, q.figure) : null,
    h('p', { class: 'ex-res-prompt' }, q.prompt),
    q.tex ? mathSpan(q.prompt, q.tex, true) : null,
  );
  if (q.choices?.length) {
    const key = Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : [];
    const chosen = Array.isArray(mine) ? mine : typeof mine === 'string' ? [mine] : [];
    body.append(h('ul', { class: 'ex-res-choices' }, q.choices.map((c) => {
      const isKey = key.includes(c.id);
      const isMine = chosen.includes(c.id);
      return h('li', { class: `${isKey ? 'is-key' : ''} ${isMine ? 'is-mine' : ''}` },
        h('span', { class: 'ex-res-letter' }, c.id), h('span', null, c.tex ? mathSpan(c.text, c.tex) : c.text),
        isKey ? h('span', { class: 'ex-res-tag ok' }, 'Answer') : null,
        isMine && !isKey ? h('span', { class: 'ex-res-tag miss' }, 'Your choice') : isMine ? h('span', { class: 'ex-res-tag ok' }, 'Your choice') : null);
    })));
  } else if (q.parts?.length) {
    const given = mine && typeof mine === 'object' && !Array.isArray(mine) ? mine : {};
    body.append(h('table', { class: 'ex-res-parts' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Part'), h('th', { scope: 'col' }, 'Your answer'), h('th', { scope: 'col' }, 'Key'), h('th', { scope: 'col' }, 'Points'))),
      h('tbody', null, q.parts.map((p) => h('tr', null, h('td', null, `(${p.label})`), h('td', null, given[p.label] ?? '—'), h('td', null, p.answer ?? '—'), h('td', null, String(p.points)))))));
  } else {
    body.append(h('dl', { class: 'ex-res-compare' }, h('dt', null, 'Your answer'), h('dd', null, show(mine)), h('dt', null, 'Answer'), h('dd', null, pq.expected ?? '—')));
  }
  body.append(h('p', { class: 'ex-res-feedback' }, pq.feedback));
  if (q.steps?.length) {
    body.append(h('div', { class: 'ex-res-steps' }, h('h4', null, 'Worked steps'), h('ol', null, q.steps.map((s) => h('li', null, h('p', null, s.text), s.tex ? mathSpan(s.text, s.tex, true) : null)))));
  }
  if (pq.correct !== true && (host.onPractice || host.onLesson)) {
    body.append(h('div', { class: 'ex-res-actions' },
      host.onPractice ? h('button', { type: 'button', class: 'ex-btn', onclick: () => host.onPractice!(q) }, 'Practice this') : null,
      host.onLesson ? h('button', { type: 'button', class: 'ex-btn', onclick: () => host.onLesson!(q) }, 'Watch a lesson') : null,
    ));
  }
  return h('details', { class: `ex-res-q is-${cls}`, 'data-status': cls },
    h('summary', null,
      h('span', { class: `ex-res-dot ${cls}`, 'aria-hidden': 'true' }, icon(cls === 'ok' ? 'check' : cls === 'part' ? 'more' : 'close', 'ex-ico ex-ico-sm')),
      h('span', { class: 'ex-res-q-num' }, `Question ${index + 1}`),
      h('span', { class: 'ex-res-q-topic' }, q.topic ? topicLabel(q.topic) : ''),
      h('span', { class: 'ex-res-q-status' }, status),
      h('span', { class: 'ex-res-q-pts' }, `${pq.earned}/${pq.points}`),
      h('span', { class: 'ex-res-q-time' }, clock(pq.timeMs)),
      attempt.flagged.includes(q.id) ? h('span', { class: 'ex-res-q-flag', title: 'You marked this for review' }, icon('bookmark', 'ex-ico ex-ico-sm is-on')) : null,
    ),
    body,
  );
}

export function renderResults(container: HTMLElement, o: { exam: Exam; attempt: Attempt; result: Result; host: ExamHost; timedOut?: boolean; onDone(): void; onRetake?(): void }): void {
  const { exam, attempt, result, host } = o;
  container.className = 'ex-center ex-results';
  container.replaceChildren();
  const past = history.list().filter((e) => e.name === exam.profile.name);
  const spark = trend(past);
  const duration = (attempt.finishedAt ?? Date.now()) - attempt.startedAt;
  const missed = result.perQuestion.filter((p) => p.correct !== true).length;
  const list = h('div', { class: 'ex-res-list' });
  const paintList = (filter: 'all' | 'missed' | 'marked') => {
    list.replaceChildren();
    result.perQuestion.forEach((pq, i) => {
      const q = exam.questions.find((x) => x.id === pq.id);
      if (!q) return;
      if (filter === 'missed' && pq.correct === true) return;
      if (filter === 'marked' && !attempt.flagged.includes(q.id)) return;
      list.append(reviewItem(q, pq, attempt, i, host));
    });
    if (!list.children.length) list.append(h('p', { class: 'ex-muted' }, filter === 'missed' ? 'Nothing missed. Nice work.' : 'No questions marked.'));
  };
  const filterBtn = (f: 'all' | 'missed' | 'marked', label: string) =>
    h('button', { type: 'button', class: 'ex-chip', 'aria-pressed': String(f === 'all'), onclick: (e: Event) => {
      container.querySelectorAll('.ex-res-filter .ex-chip').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      paintList(f);
    } }, label);
  const topics = [...result.byTopic].sort((a, b) => a.right / Math.max(1, a.total) - b.right / Math.max(1, b.total));

  container.append(
    h('div', { class: 'ex-center-top' },
      h('button', { type: 'button', class: 'ex-back', onclick: o.onDone }, '← Exam center'),
      o.onRetake ? h('button', { type: 'button', class: 'ex-btn', onclick: o.onRetake }, 'New exam like this') : null,
    ),
    h('header', { class: 'ex-res-head' },
      h('p', { class: 'ex-kicker' }, `Results · ${new Date(attempt.finishedAt ?? Date.now()).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`),
      h('h1', null, exam.profile.name),
    ),
    h('section', { class: 'ex-res-score', 'aria-label': 'Score' },
      h('div', { class: 'ex-res-big' },
        h('span', { class: 'ex-res-big-n' }, result.score.replace(/\s*\(estimate\)\s*/, '')),
        result.estimate ? h('span', { class: 'ex-res-est', title: 'Scaled and band scores are estimates from your raw score' }, 'estimate') : null,
      ),
      h('div', { class: 'ex-res-facts' },
        h('p', null, h('strong', null, `${result.raw} of ${result.possible}`), ' points', h('span', { class: 'ex-muted' }, ` · ${result.percent}%`)),
        h('p', { class: 'ex-muted' }, `${result.perQuestion.length} questions · ${missed} to review · ${clock(duration)} total`),
        o.timedOut ? h('p', { class: 'ex-res-warn' }, 'Time ran out; your answers were submitted automatically.') : null,
        spark ? h('div', { class: 'ex-res-trendbox' }, h('span', { class: 'ex-muted' }, 'Your trend'), spark) : null,
      ),
    ),
    h('div', { class: 'ex-res-grid' },
      h('section', { class: 'ex-card', 'aria-labelledby': 'ex-res-sec' }, h('h2', { id: 'ex-res-sec' }, 'By section'),
        h('ul', { class: 'ex-res-rows' }, result.bySection.map((s) => h('li', null, h('div', { class: 'ex-res-row-head' }, h('span', null, s.title), h('span', { class: 'ex-muted' }, `${s.raw}/${s.possible}`)), bar(s.raw, s.possible, s.title))))),
      h('section', { class: 'ex-card ex-res-topics', 'aria-labelledby': 'ex-res-top' }, h('h2', { id: 'ex-res-top' }, 'By topic'),
        topics.length ? h('ul', { class: 'ex-res-rows' }, topics.map((t) => h('li', { 'data-topic': t.topic }, h('div', { class: 'ex-res-row-head' }, h('span', null, topicLabel(t.topic)), h('span', { class: 'ex-muted' }, `${t.right}/${t.total}`)), bar(t.right, t.total, topicLabel(t.topic))))) : h('p', { class: 'ex-muted' }, 'No topics were tagged on these questions.')),
    ),
    h('section', { class: 'ex-card', 'aria-labelledby': 'ex-res-pace' },
      h('h2', { id: 'ex-res-pace' }, 'Pacing'),
      h('p', { class: 'ex-muted' }, `Time on each question. The dashed line is an even pace for the section. ${result.pacing.onPaceAt.length} of ${result.perQuestion.length} on pace.`),
      h('div', { class: 'ex-res-pace-wrap' }, pacingChart(exam, attempt, result)),
      h('p', { class: 'ex-res-legend', 'aria-hidden': 'true' }, h('i', { class: 'ok' }), 'Correct ', h('i', { class: 'part' }), 'Partly ', h('i', { class: 'miss' }), 'Missed'),
    ),
    h('section', { class: 'ex-res-review', 'aria-labelledby': 'ex-res-rev' },
      h('div', { class: 'ex-res-review-head' }, h('h2', { id: 'ex-res-rev' }, 'Review every question'),
        h('div', { class: 'ex-res-filter', role: 'group', 'aria-label': 'Show' }, filterBtn('all', 'All'), filterBtn('missed', `Missed (${missed})`), filterBtn('marked', `Marked (${attempt.flagged.length})`))),
      list,
    ),
  );
  paintList('all');
  const big = container.querySelector<HTMLElement>('.ex-res-big-n');
  if (big) countUp(big);
  container.scrollTop = 0;
  (container.querySelector('h1') as HTMLElement | null)?.setAttribute('tabindex', '-1');
  (container.querySelector('h1') as HTMLElement | null)?.focus();
}

export function renderHistory(container: HTMLElement, o: { onOpen(e: HistoryEntry): void; onBack(): void }): void {
  container.className = 'ex-center ex-history';
  const entries = history.list();
  const spark = trend(entries);
  fill(container,
    h('div', { class: 'ex-center-top' }, h('button', { type: 'button', class: 'ex-back', onclick: o.onBack }, '← Exam center')),
    h('header', { class: 'ex-res-head' }, h('p', { class: 'ex-kicker' }, 'Past attempts'), h('h1', null, 'Your exams')),
    spark ? h('section', { class: 'ex-card ex-hist-trend' }, h('h2', null, 'Score trend'), spark) : null,
    entries.length
      ? h('ol', { class: 'ex-hist-list' }, entries.map((e) => h('li', null,
        h('button', { type: 'button', class: 'ex-hist-item', onclick: () => o.onOpen(e) },
          h('span', { class: 'ex-hist-name' }, e.name),
          h('span', { class: 'ex-muted' }, new Date(e.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
          h('span', { class: 'ex-hist-score' }, e.score.replace(/\s*\(estimate\)/, ''), e.estimate ? h('small', null, ' est.') : null),
          h('span', { class: 'ex-muted' }, `${e.raw}/${e.possible} · ${Math.round(e.percent)}%`),
        ))))
      : h('p', { class: 'ex-muted' }, 'No finished exams yet.'),
  );
}
