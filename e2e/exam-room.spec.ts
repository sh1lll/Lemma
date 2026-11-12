import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The exam room isn't wired into the app yet, so these tests drive the dev-only harness
// (apps/web/exam-harness.html) on its own Vite dev server. Chromium only; timers use page.clock.
const PORT = 5313;
const HARNESS = `http://localhost:${PORT}/exam-harness.html`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PDF = readFileSync(new URL('./fixtures/exam-quiz.pdf', import.meta.url));

test.describe.configure({ mode: 'serial' });
test.skip(() => test.info().project.name !== 'chromium', 'chromium project only');

let server: ChildProcess | null = null;

async function up(): Promise<boolean> {
  try {
    return (await fetch(HARNESS)).ok;
  } catch {
    return false;
  }
}

test.beforeAll(async ({}, info) => {
  if (info.project.name !== 'chromium') return;
  test.setTimeout(60_000);
  if (await up()) return;
  server = spawn('npx', ['vite', 'apps/web', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  if (!(await up())) throw new Error('exam harness dev server did not start');
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.clock.install({ time: new Date('2026-10-30T09:00:00') });
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors, 'uncaught page errors').toEqual([]);
});

async function start(page: Page, room: string) {
  await page.goto(`${HARNESS}?room=${room}`);
  await page.getByRole('button', { name: 'Start' }).click();
  const close = page.locator('[data-act="dir-close"]');
  if (await close.count()) await close.click();
}

const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const next = (page: Page) => page.locator('[data-act="next"]').click();

test('imports a PDF and a text file, reviews the profile, builds and starts', async ({ page }) => {
  await page.goto(`${HARNESS}?view=hub`);
  await page.getByRole('button', { name: 'Import my tests' }).click();
  await page.locator('#ex-file').setInputFiles([
    { name: 'exam-quiz.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'study-guide.txt', mimeType: 'text/plain', buffer: Buffer.from('Unit 5 study guide\nTopics you should know:\n- Solving linear equations like 3x - 4 = 11\n- Percent of a number\n- Area of rectangles\n') },
  ]);
  const pdf = page.locator('.ex-doc', { hasText: 'exam-quiz.pdf' });
  await expect(pdf.locator('.ex-doc-found')).toContainText('4 questions', { timeout: 15_000 });
  await expect(pdf.locator('.ex-doc-found')).toContainText('20 min');
  await expect(pdf.locator('.ex-doc-found')).toContainText('key for 4');
  await expect(pdf.getByLabel('Answer key for exam-quiz.pdf')).toHaveValue(/1 B/);
  const txt = page.locator('.ex-doc', { hasText: 'study-guide.txt' });
  await expect(txt.locator('.ex-doc-kind')).toHaveText('Study guide');
  // Fix something: change the time limit.
  await pdf.getByLabel('Time limit in minutes for exam-quiz.pdf').fill('25');
  await pdf.getByLabel('Time limit in minutes for exam-quiz.pdf').dispatchEvent('change');

  await page.getByRole('button', { name: 'Use these to build my exam' }).click();
  await expect(page.getByRole('heading', { name: 'What your exam will match' })).toBeVisible();
  await expect(page.locator('.ex-obs li').first()).toBeVisible();
  await expect(page.locator('.ex-obs')).toContainText('Name, Date, Period');
  await page.getByRole('button', { name: 'Build exam and start' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.ex-pp-item')).toHaveCount(4);
  await expect(page.locator('.ex-pp-clock-time')).toHaveText(/2[45]:\d\d/);
});

test('digital adaptive: answer, flag, eliminate, navigate, timer, break, routing, lock, results', async ({ page }) => {
  await start(page, 'digital-adaptive');
  const time = page.locator('.ex-dg-time');
  await expect(time).toHaveText(/^[56]:\d\d$/);
  await page.getByRole('button', { name: 'Hide timer' }).click();
  await expect(time).toBeHidden();

  await radio(page, 'B: 5').click();
  await expect(radio(page, 'B: 5')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-act="mark"]').click();
  await expect(page.locator('[data-act="mark"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-act="abc"]').click();
  await page.getByRole('button', { name: 'Cross out choice A' }).click();
  await expect(page.locator('.ex-ch-row').first()).toHaveClass(/is-struck/);

  await next(page);
  await radio(page, 'C: $30').click();
  await page.locator('[data-act="nav"]').click();
  const pop = page.getByRole('dialog', { name: /Module 1: Math questions/ });
  await expect(pop.getByRole('button', { name: /Question 1, answered, marked for review/ })).toBeVisible();
  await pop.getByRole('button', { name: /^Question 3, unanswered/ }).click();
  await expect(page.locator('[data-act="nav"]')).toHaveText(/Question 3 of 4/);
  await page.getByLabel('Answer to question 3').fill('3');
  await next(page);
  await page.keyboard.press('c');
  await expect(radio(page, 'C: 9')).toHaveAttribute('aria-checked', 'true');

  // 6:00 module, warning at 5 minutes; the hidden timer comes back in the last 5 minutes.
  await page.clock.runFor(62_000);
  await expect(page.locator('.ex-banner')).toContainText('5 minutes remaining');
  await expect(time).toBeVisible();
  await expect(time).toHaveText(/^4:\d\d$/);
  await expect(page.getByRole('button', { name: 'Hide timer' })).toBeHidden();

  await next(page);
  await expect(page.getByRole('heading', { name: 'Check Your Work' })).toBeVisible();
  await next(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();

  // Break with its own timer.
  await expect(page.locator('.ex-break-time')).toHaveText('1:00');
  await page.clock.runFor(10_000);
  await expect(page.locator('.ex-break-time')).toHaveText(/^0:5\d$/);
  await page.getByRole('button', { name: 'Resume testing' }).click();

  // All of module 1 right → the harder module 2.
  await expect(page.locator('.ex-dg-title')).toHaveText('Module 2: Math');
  await expect(page.locator('.ex-prompt-text')).toContainText('2x + y = 7');
  // Section lock: no way back into module 1.
  await expect(page.locator('[data-act="back"]')).toHaveCount(0);
  await page.locator('[data-act="nav"]').click();
  await expect(page.locator('.ex-nav-pop .ex-nav-cell')).toHaveCount(4);
  await page.keyboard.press('Escape');

  await radio(page, 'C: 3').click();
  await next(page);
  await radio(page, 'A: 3').click(); // wrong on purpose
  await page.locator('[data-act="nav"]').click();
  await page.getByRole('button', { name: 'Go to Review Page' }).click();
  await next(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();

  await expect(page.locator('.ex-res-big-n')).toBeVisible();
  await expect(page.locator('.ex-res-est')).toHaveText('estimate');
  await expect(page.locator('.ex-res-topics li[data-topic]').first()).toBeVisible();
  expect(await page.locator('.ex-res-topics li[data-topic]').count()).toBeGreaterThan(2);
  expect(await page.locator('.ex-res-pace rect').count()).toBe(8);
  await page.getByRole('button', { name: /^Missed/ }).click();
  const missed = page.locator('.ex-res-q').first();
  await missed.locator('summary').click();
  await missed.getByRole('button', { name: 'Practice this' }).click();
  await missed.getByRole('button', { name: 'Watch a lesson' }).click();
  const calls = await page.evaluate(() => (window as any).examHarness.calls);
  expect(calls.practice.length).toBe(1);
  expect(calls.lesson.length).toBe(1);
});

test('digital linear: calculator per section, time-up auto-submit, section lock', async ({ page }) => {
  await start(page, 'digital-linear');
  await expect(page.locator('[data-act="tool-calc"]')).toHaveCount(0); // part 1: no calculator
  await radio(page, 'A: 6x − 6').click();
  await next(page);
  await page.keyboard.press('b');
  await page.locator('[data-act="mark"]').click();
  await page.locator('[data-act="abc"]').click();
  await page.getByRole('button', { name: 'Cross out choice D' }).click();
  await expect(page.locator('.ex-ch-row').nth(3)).toHaveClass(/is-struck/);
  await page.locator('[data-act="back"]').click();
  await expect(page.locator('[data-act="nav"]')).toHaveText(/Question 1 of 4/);

  await page.clock.runFor(8 * 60_000 + 1000);
  const dlg = page.getByRole('dialog', { name: 'Time is up' });
  await expect(dlg).toContainText('Part 1: No calculator');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.ex-dg-title')).toHaveText('Part 2: Calculator');
  await expect(page.locator('[data-act="back"]')).toHaveCount(0);
  await page.locator('[data-act="tool-calc"]').click();
  await page.getByLabel('Calculator input').fill('12*7');
  await page.getByLabel('Calculator input').press('Enter');
  await expect(page.locator('.ex-calc-a').last()).toHaveText(/84/);
  // DEG/RAD switch: degrees by default, radians after one press.
  const angle = page.getByRole('button', { name: /^Angle mode/ });
  await expect(angle).toHaveText('DEG');
  await page.getByLabel('Calculator input').fill('sin(90)');
  await page.getByLabel('Calculator input').press('Enter');
  await expect(page.locator('.ex-calc-a').last()).toHaveText(/^1$/);
  await angle.click();
  await expect(angle).toHaveText('RAD');
  await page.getByLabel('Calculator input').fill('sin(pi/2)');
  await page.getByLabel('Calculator input').press('Enter');
  await expect(page.locator('.ex-calc-a').last()).toHaveText(/^1$/);
});

test('paper: bubbles, cross-out, circle, pages, clock, autosave and resume, turn in', async ({ page }) => {
  await start(page, 'paper');
  await page.getByLabel('Name').fill('Sam');
  await radio(page, 'B: x = 5').click();
  await expect(radio(page, 'B: x = 5')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-act="cross"]').click();
  await page.getByRole('radio', { name: 'C: (4, 5)' }).click();
  await expect(page.locator('.ex-pp-choice', { hasText: '(4, 5)' })).toHaveClass(/is-struck/);
  await page.locator('[data-act="cross"]').click();
  await page.getByRole('button', { name: 'Question 3: circle to come back to it' }).click();
  await expect(page.getByRole('button', { name: 'Question 3: circle to come back to it' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Answer to question 3').fill('54.40');
  await page.getByRole('button', { name: 'Hide clock' }).click();
  await expect(page.locator('.ex-pp-clock')).toContainText('Clock hidden');
  await page.locator('[data-act="pages"]').click();
  await page.getByRole('button', { name: /^Question 6, unanswered/ }).click();
  await expect(page.locator('.ex-pp-item[data-qid="p6"]')).toBeInViewport();
  expect(await page.locator('.ex-pp-page').count()).toBeGreaterThan(1);
  await expect(page.locator('.ex-pp-pageno').first()).toHaveText(/Page 1 of \d/);

  // Autosave every few seconds; reload resumes the same sitting.
  await page.clock.runFor(4000);
  await page.reload();
  await expect(page.getByLabel('Name')).toHaveValue('Sam');
  await expect(radio(page, 'B: x = 5')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ex-pp-choice', { hasText: '(4, 5)' })).toHaveClass(/is-struck/);
  await expect(page.getByLabel('Answer to question 3')).toHaveValue('54.40');
  await expect(page.locator('.ex-pp-clock')).toContainText('Clock hidden');

  await page.locator('[data-act="turnin"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn in' }).click();
  await expect(page.locator('.ex-res-big-n')).toBeVisible();
  await expect(page.locator('.ex-res-topics li[data-topic="system"]')).toBeVisible();

  // History on the hub.
  await page.getByRole('button', { name: '← Exam center' }).click();
  await expect(page.locator('.ex-hist-item')).toContainText('Algebra 1');
});

test('free response: part answers with typeset preview, work, time-up submits the exam', async ({ page }) => {
  await start(page, 'free-response');
  await radio(page, 'C: 10').click();
  await next(page);
  await next(page);
  await next(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  const close = page.locator('[data-act="dir-close"]');
  if (await close.count()) await close.click();
  await expect(page.locator('.ex-fr-part')).toHaveCount(3);
  await page.getByLabel('Answer to part (a)').fill('2x - 4');
  await expect(page.locator('.ex-fr-part[data-part="a"] .ex-mi-math .katex')).toBeVisible();
  await page.getByRole('textbox', { name: 'Work for part (a)' }).fill("f'(x) = 2x - 4");
  await page.getByLabel('Answer to part (b)').fill('2');
  await page.clock.runFor(12 * 60_000 + 1000);
  await expect(page.locator('.ex-res-warn')).toContainText('Time ran out');
  await expect(page.locator('.ex-res-q').first()).toBeVisible();
});

test('continue a saved exam from the hub', async ({ page }) => {
  await start(page, 'digital-linear');
  await radio(page, 'A: 6x − 6').click();
  await page.locator('[data-act="tool-more"]').click();
  await page.getByRole('menuitem', { name: 'Save and exit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save and exit' }).click();
  await expect(page.getByRole('heading', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue exam' }).click();
  await expect(radio(page, 'A: 6x − 6')).toHaveAttribute('aria-checked', 'true');
});

for (const room of ['digital-adaptive', 'digital-linear', 'paper', 'free-response']) {
  test(`phone width layout: ${room}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page, room);
    const overflow = await page.evaluate(() => {
      const r = document.querySelector('.ex-room') as HTMLElement;
      return { doc: document.documentElement.scrollWidth, room: r.scrollWidth, w: innerWidth };
    });
    expect(overflow.doc).toBeLessThanOrEqual(overflow.w);
    expect(overflow.room).toBeLessThanOrEqual(overflow.w);
    const primary = room === 'paper' ? page.locator('[data-act="turnin"]') : page.locator('[data-act="next"]');
    await expect(primary).toBeInViewport();
    const box = await primary.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Regressions from the bug sweep

test('time running out while "Finish this module?" is open does not hand in the next module', async ({ page }) => {
  await start(page, 'digital-adaptive');
  await page.locator('[data-act="nav"]').click();
  await page.getByRole('button', { name: 'Go to Review Page' }).click();
  await next(page);
  await expect(page.getByRole('dialog', { name: /Finish Module 1/ })).toBeVisible();
  await page.clock.runFor(6 * 60_000 + 1000);
  // The stale question is withdrawn; only the time-up notice remains.
  await expect(page.getByRole('dialog', { name: /Finish Module 1/ })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Time is up' }).getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Resume testing' }).click();
  await expect(page.locator('.ex-dg-title')).toHaveText('Module 2: Math');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.locator('.ex-res-big-n')).toHaveCount(0);
});

test('one tab at a time: a second tab takes the exam over, and a finished exam stays finished', async ({ page }) => {
  await start(page, 'digital-linear');
  await radio(page, 'A: 6x − 6').click();
  await page.clock.runFor(4000); // autosave
  const other = await page.context().newPage();
  await other.goto(`${HARNESS}?room=digital-linear`);
  await expect(page.getByRole('heading', { name: 'This exam is open in another tab' })).toBeVisible();
  const close = other.locator('[data-act="dir-close"]');
  if (await close.isVisible()) await close.click();
  await expect(radio(other, 'A: 6x − 6')).toHaveAttribute('aria-checked', 'true');
  await other.locator('[data-act="next"]').click();
  await other.keyboard.press('b');
  await other.waitForTimeout(3600); // the other tab's real-time autosave
  const saved = await other.evaluate(() => JSON.parse(localStorage.getItem('lemma.exam.run.v1')!).attempt.answers);
  expect(saved).toEqual({ l1: 'A', l2: 'B' });

  // Take it back in the first tab and turn it in; the other tab stops and doesn't bring it back.
  await page.getByRole('button', { name: 'Continue here instead' }).click();
  await expect(other.getByRole('heading', { name: 'This exam is open in another tab' })).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.locator('[data-act="nav"]').click();
    await page.getByRole('button', { name: 'Go to Review Page' }).click();
    await next(page);
    await page.getByRole('dialog').getByRole('button', { name: /Continue|Submit/ }).click();
  }
  await expect(page.locator('.ex-res-big-n')).toBeVisible();
  await other.waitForTimeout(3600);
  expect(await other.evaluate(() => localStorage.getItem('lemma.exam.run.v1'))).toBeNull();
  await other.close();
});

test('keyboard only: focus lands in the room after Start; letters toggle select-all choices', async ({ page }) => {
  await page.goto(`${HARNESS}?view=hub`);
  await page.evaluate(() => {
    const w = window as any;
    const ex = w.examHarness.SAMPLES['digital-linear']();
    Object.assign(ex.questions[0], { type: 'multi', answer: ['A', 'C'], prompt: `Select all that apply. ${ex.questions[0].prompt}` });
    w.examApi.startExam(document.getElementById('app'), ex, w.examHarness.host);
  });
  await expect(page.getByRole('button', { name: 'Start' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-act="dir-close"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ex-dg-dir')).toBeHidden();
  await page.keyboard.press('a');
  await page.keyboard.press('c');
  const checked = () => page.getByRole('checkbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')));
  expect(await checked()).toEqual(['true', 'false', 'true', 'false']);
  await page.keyboard.press('a');
  expect(await checked()).toEqual(['false', 'false', 'true', 'false']);
});

/** A one-page PDF with Helvetica text at the given positions. */
function pdf(lines: [number, number, string][]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = lines.map(([x, y, s]) => `BT /F1 11 Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('imports a two-column PDF test column by column', async ({ page }) => {
  const twoCol = pdf([
    [72, 740, 'Geometry Quiz 3'],
    [72, 720, 'Name: ____________________   Date: __________'],
    [72, 690, '1. What is the area of a circle'], [320, 690, '2. Find the slope of the line'],
    [72, 676, 'with radius 3?'], [320, 676, 'through (1, 2) and (3, 8).'],
    [72, 660, 'A. 6 pi'], [150, 660, 'B. 9 pi'], [320, 660, 'A. 2'], [400, 660, 'B. 3'],
    [72, 646, 'C. 12 pi'], [150, 646, 'D. 18 pi'], [320, 646, 'C. 4'], [400, 646, 'D. 6'],
    [72, 616, '3. What is the perimeter of a square with side 5?'], [72, 602, 'A. 10      B. 20      C. 25      D. 15'],
    [72, 572, 'Answer Key'], [72, 556, '1. B   2. B   3. B'],
  ]);
  await page.goto(`${HARNESS}?view=hub`);
  await page.getByRole('button', { name: 'Import my tests' }).click();
  await page.locator('#ex-file').setInputFiles([{ name: 'two-column.pdf', mimeType: 'application/pdf', buffer: twoCol }]);
  const doc = page.locator('.ex-doc', { hasText: 'two-column.pdf' });
  await expect(doc.locator('.ex-doc-found')).toContainText('3 questions', { timeout: 15_000 });
  await expect(doc.locator('.ex-doc-found')).toContainText('key for 3');
});

test('phone width: the start screen fits and names formats as unofficial', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HARNESS}?room=paper&fresh`);
  const card = await page.locator('.ex-intro-card').boundingBox();
  expect(card!.x + card!.width).toBeLessThanOrEqual(390);
  await page.goto(`${HARNESS}?view=hub`);
  await expect(page.locator('.ex-tm-note')).toContainText('Unofficial practice formats');
});

test('AP-style return: from Part B back to Part A without a calculator, on Part B’s clock', async ({ page }) => {
  await page.goto(`${HARNESS}?view=hub`);
  await page.evaluate(() => {
    const w = window as any;
    const exam = w.examHarness.SAMPLES.paper();
    const ids = exam.questions.map((q: any) => q.id);
    exam.id = 'return-rule';
    exam.profile.rules.showTimer = 'always';
    exam.profile.sections = [
      { id: 'a', title: 'Section II, Part A — Calculator', minutes: 3, calculator: true, questionIds: ids.slice(0, 3), canReturn: false },
      { id: 'b', title: 'Section II, Part B — No calculator', minutes: 4, calculator: false, questionIds: ids.slice(3), canReturn: true, returnTo: { section: 'a', calculator: false } },
    ];
    w.examApi.startExam(document.getElementById('app'), exam, w.examHarness.host);
  });
  await page.getByRole('button', { name: 'Start' }).click();

  // Part A: calculator, no way "back" yet.
  await expect(page.locator('[data-act="calc"]')).toHaveCount(1);
  await expect(page.locator('[data-act="return"]')).toHaveCount(0);
  await radio(page, 'B: x = 5').click();
  await page.locator('[data-act="turnin"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn in' }).click();

  // Part B: no calculator; Part A can be reopened.
  await expect(page.locator('.ex-pp-bar-title')).toHaveText('Section II, Part B — No calculator');
  await expect(page.locator('[data-act="calc"]')).toHaveCount(0);
  await expect(page.locator('.ex-pp-clock-time')).toHaveText('4:00');
  await page.locator('[data-act="return"]').click();
  await expect(page.locator('.ex-pp-bar-title')).toHaveText('Section II, Part A — Calculator');
  await expect(page.locator('.ex-pp-visit')).toContainText('no calculator');
  await expect(page.locator('.ex-pp-item')).toHaveCount(3);
  await expect(page.locator('[data-act="calc"]')).toHaveCount(0); // Part A's calculator stays closed
  await expect(radio(page, 'B: x = 5')).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Answer to question 3').fill('54.40');

  // Time back in Part A comes off Part B's clock (Part A's own time is over).
  await page.clock.runFor(60_000);
  await expect(page.locator('.ex-pp-clock-time')).toHaveText(/^(2:59|3:00)$/);

  await page.locator('.ex-pp-bar [data-act="leave-return"]').click();
  await expect(page.locator('.ex-pp-bar-title')).toHaveText('Section II, Part B — No calculator');
  await expect(page.locator('.ex-pp-item')).toHaveCount(3);
  await expect(page.locator('.ex-pp-visit')).toHaveCount(0);

  // Part B's time running out ends both; the answer changed in Part A counts.
  await page.locator('[data-act="return"]').click();
  await page.clock.runFor(3 * 60_000 + 1000);
  await expect(page.locator('.ex-res-big-n')).toBeVisible();
  const q3 = page.locator('.ex-res-q').nth(2);
  await expect(q3.locator('.ex-res-q-pts')).toHaveText('3/3');
});
