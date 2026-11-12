// Dev-only harness, loaded by apps/web/exam-harness.html (`npx vite apps/web`). Not imported by the app.
import '../style.css';
import { calculate, createSession } from '@lemma/math-core';
import * as examApi from './index';
import { openExamCenter, resumeExam, startExam, type ExamHost } from './index';
import { SAMPLES } from './samples';
import { runStore } from './store';
import type { ExamQuestion, Room } from './types';

const $ = (id: string) => document.getElementById(id)!;
const session = createSession();
const calls: { practice: string[]; lesson: string[]; scratch: number } = { practice: [], lesson: [], scratch: 0 };

const host: ExamHost = {
  async compute(q, opts) {
    session.angle = opts?.angle ?? 'deg';
    const r = calculate(q, session);
    return r.ok ? { ok: true, display: r.formatted.display } : { ok: false, message: r.error.message };
  },
  openScratch: () => {
    calls.scratch++;
    host.toast('Whiteboard would open here');
  },
  onPractice: (q: ExamQuestion) => {
    calls.practice.push(q.id);
    host.toast(`Practice: ${q.prompt.slice(0, 40)}`);
  },
  onLesson: (q: ExamQuestion) => {
    calls.lesson.push(q.id);
    host.toast(`Lesson: ${q.prompt.slice(0, 40)}`);
  },
  toast: (m) => ($('toast').textContent = m),
};

$('theme').addEventListener('click', () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
});
$('reset').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

const params = new URLSearchParams(location.search);
const room = params.get('room') as Room | null;
const app = $('app');
if (room && SAMPLES[room]) {
  // Resume a saved sitting of the same sample after a reload; otherwise start fresh.
  const saved = runStore.load();
  if (saved && saved.exam.id === SAMPLES[room]().id && params.get('fresh') === null) resumeExam(app, host);
  else startExam(app, SAMPLES[room](), host);
} else openExamCenter(app, host);

// Exposed for e2e tests.
Object.assign(window, { examApi, examHarness: { host, calls, SAMPLES } });
