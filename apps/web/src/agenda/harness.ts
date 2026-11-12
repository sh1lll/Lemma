// Dev-only harness, loaded by apps/web/agenda-harness.html (`vite apps/web`). Not imported by the app.
import '../style.css';
import { Temporal } from '@lemma/date-engine';
import { applyLook, type LookId, type LookSettings } from '../look';
import * as agendaApi from './index';
import { describeProgress, mountAgenda, recordActivity, type AgendaHost } from './index';
import { nowMs, setAgendaClock } from './store';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);

// Pinned clock: ?now=2026-10-29T12:00&tz=America/New_York. The clock then runs forward from that instant.
const tz = params.get('tz') ?? 'America/New_York';
const nowParam = params.get('now');
if (nowParam) {
  const start = Temporal.PlainDateTime.from(nowParam).toZonedDateTime(tz).epochMilliseconds;
  const t0 = Date.now();
  setAgendaClock(() => start + (Date.now() - t0), tz);
}

const look: LookSettings = {
  theme: (params.get('theme') as LookSettings['theme']) ?? 'light',
  look: (params.get('look') as LookId) ?? 'comfy',
  accent: '',
  font: 'rounded',
  textSize: 'm',
  density: 'cozy',
  corners: 'round',
  motion: 'full',
};
applyLook(look);

const calls: { practice: (string | undefined)[]; exam: number; lesson: string[]; spoken: string[]; toasts: string[] } = { practice: [], exam: 0, lesson: [], spoken: [], toasts: [] };
const host: AgendaHost = {
  toast: (m) => {
    calls.toasts.push(m);
    $('toast').textContent = m;
  },
  openPractice: (topic) => {
    calls.practice.push(topic);
    host.toast(`Practice${topic ? `: ${topic}` : ''}`);
  },
  openExam: () => {
    calls.exam++;
    host.toast('Exam simulator would open here');
  },
  openLesson: (topic) => {
    calls.lesson.push(topic);
    host.toast(`Lesson: ${topic}`);
  },
  speak: (t) => void calls.spoken.push(t),
};

$('theme').addEventListener('click', () => {
  look.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyLook(look);
});
$('reset').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});
$('solve').addEventListener('click', () => {
  const r = recordActivity({ kind: 'practice', topic: 'derivative', correct: true });
  host.toast(describeProgress(r) ?? 'Logged');
});
$('seed').addEventListener('click', () => {
  const day = 86_400_000;
  const now = nowMs();
  const at = (d: number) => now - d * day;
  for (let d = 20; d >= 1; d--) {
    if (d % 6 === 0) continue;
    for (let i = 0; i < 3 + (d % 4); i++) recordActivity({ kind: 'practice', topic: d % 2 ? 'integral' : 'derivative', correct: (i + d) % 3 !== 0, at: at(d) });
  }
  for (let i = 0; i < 5; i++) recordActivity({ kind: 'test', topic: 'integral', correct: i === 0, at: at(1) });
  recordActivity({ kind: 'lesson', topic: 'stats', at: at(30) });
  agendaApi.addTaskFromText('Problem set 4 due Friday, 12 derivative problems');
  agendaApi.addTaskFromText('Calc test in 9 days, chapters 3-4');
});

let unmount = mountAgenda($('app'), host);

// Exposed for e2e tests.
Object.assign(window, {
  agendaApi,
  agendaHarness: { host, calls, remount: () => (unmount(), (unmount = mountAgenda($('app'), host))), unmount: () => unmount() },
});
