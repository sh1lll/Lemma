import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The lesson module isn't wired into the app yet, so these tests drive the dev-only harness
// (apps/web/lesson-harness.html) on its own Vite dev server. Chromium only: video export relies on
// MediaRecorder + canvas.captureStream, and one shared dev server keeps the run simple.
const PORT = 5299;
const HARNESS = `http://localhost:${PORT}/lesson-harness.html`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

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
  if (!(await up())) throw new Error('lesson harness dev server did not start');
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
  await page.goto(HARNESS);
  await expect(page.locator('.ol-stage')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors, 'uncaught page errors').toEqual([]);
});

test('player renders every scene when seeking', async ({ page }) => {
  const duration = await page.evaluate(() => (window as any).lessonHarness.player.duration as number);
  expect(duration).toBeGreaterThan(15);
  const scenes = await page.evaluate(() => {
    const tl = (window as any).lessonApi.buildTimeline((window as any).lessonHarness.sampleLesson);
    return tl.scenes.map((s: any) => ({ kind: s.segment.kind, index: s.segment.index, mid: (s.segment.start + s.segment.end) / 2 }));
  });
  expect(scenes.map((s: { kind: string }) => s.kind)).toEqual(['title', 'question', 'step', 'step', 'step', 'step', 'step', 'answer', 'end']);

  for (const s of scenes as { kind: string; index: number; mid: number }[]) {
    await page.evaluate((t) => (window as any).lessonHarness.player.seek(t), s.mid);
    const sel = s.kind === 'step' ? `.ol-scene[data-step="${s.index}"]` : `.ol-scene[data-kind="${s.kind}"]`;
    const visible = page.locator(sel);
    await expect(visible).toHaveCSS('opacity', '1');
    await expect(visible).toHaveCSS('visibility', 'visible');
    // Exactly one scene is visible at a scene's midpoint.
    expect(await page.locator('.ol-scene').evaluateAll((els) => els.filter((e) => getComputedStyle(e).visibility === 'visible').length)).toBe(1);
    if (s.kind === 'step') {
      await expect(visible.locator('.ol-label')).toHaveText(`Step ${s.index + 1} of 5`);
      await expect(visible.locator('.katex')).toBeVisible();
    }
  }
  // Answer is highlighted by its midpoint.
  const answerMid = (scenes as { kind: string; mid: number }[]).find((s) => s.kind === 'answer')!.mid;
  await page.evaluate((t) => (window as any).lessonHarness.player.seek(t), answerMid);
  expect(Number(await page.locator('.ol-kind-answer').evaluate((e) => getComputedStyle(e).getPropertyValue('--h')))).toBeGreaterThan(0.9);
  await expect(page.locator('.ol-time')).toContainText(' / ');
});

test('play and pause through the controls', async ({ page }) => {
  const playBtn = page.locator('.ol-play');
  await expect(playBtn).toHaveAttribute('aria-label', 'Play');
  await playBtn.click();
  await expect(page.locator('.ol-player')).toHaveAttribute('data-state', 'playing');
  await expect(playBtn).toHaveAttribute('aria-label', 'Pause');
  await page.waitForTimeout(800);
  await playBtn.click();
  await expect(page.locator('.ol-player')).toHaveAttribute('data-state', 'paused');
  const t1 = Number(await page.locator('.ol-player').getAttribute('data-time'));
  expect(t1).toBeGreaterThan(0.4);
  await page.waitForTimeout(500);
  const t2 = Number(await page.locator('.ol-player').getAttribute('data-time'));
  expect(t2).toBe(t1);

  // Scrubber seeks.
  await page.locator('.ol-scrub').fill('10');
  await expect(page.locator('.ol-player')).toHaveAttribute('data-time', '10.00');
  // Narration toggle is off by default and toggles.
  await expect(page.locator('.ol-voice')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.ol-voice').click();
  await expect(page.locator('.ol-voice')).toHaveAttribute('aria-pressed', 'true');
});

test('export produces a playable video blob', async ({ page }) => {
  test.setTimeout(120_000);
  const result = await page.evaluate(async () => {
    const api = (window as any).lessonApi;
    const lesson = (window as any).lessonHarness.sampleLesson;
    const r = await api.createLessonCanvasRenderer(lesson);
    const tl = r.timeline;
    const step = tl.scenes.find((s: any) => s.segment.kind === 'step');
    r.draw((step.segment.start + step.segment.end) / 2);
    const frame = r.canvas.toDataURL('image/png');
    let progressCalls = 0;
    const t0 = performance.now();
    const v = await api.exportLessonVideo(lesson, { onProgress: () => progressCalls++ });
    const elapsed = (performance.now() - t0) / 1000;
    // Decode check: the browser can load the file's metadata.
    const url = URL.createObjectURL(v.blob);
    const video = document.createElement('video');
    video.muted = true;
    const meta = await new Promise<{ w: number; h: number }>((res, rej) => {
      video.onloadedmetadata = () => res({ w: video.videoWidth, h: video.videoHeight });
      video.onerror = () => rej(new Error('video failed to load'));
      video.src = url;
    });
    return { size: v.blob.size, type: v.blob.type, mime: v.mime, ext: v.ext, duration: r.duration, elapsed, progressCalls, meta, frame };
  });
  console.log(`export: ${result.mime} .${result.ext}, ${result.size} bytes, ${result.duration.toFixed(1)}s lesson, took ${result.elapsed.toFixed(1)}s, ${result.meta.w}x${result.meta.h}`);
  expect(result.size).toBeGreaterThan(10_000);
  expect(result.mime).toMatch(/^video\/(mp4|webm)/);
  expect(result.type).toBe(result.mime);
  expect(result.progressCalls).toBeGreaterThan(5);
  expect(result.meta).toEqual({ w: 1280, h: 720 });
  await test.info().attach('step-frame.png', { body: Buffer.from(result.frame.split(',')[1]!, 'base64'), contentType: 'image/png' });
});

test('export never writes VP9 into an MP4, and a cancelled export stops promptly', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const api = (window as any).lessonApi;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const r = { canvas: c, duration: 1, draw: (t: number) => ((g.fillStyle = `hsl(${t * 300},70%,50%)`), g.fillRect(0, 0, 320, 180)) };
    const v = await api.recordCanvas(r, {});
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const t0 = performance.now();
    const err = await api.recordCanvas({ ...r, duration: 10 }, { signal: ac.signal }).then(() => 'none', (e: Error) => e.name);
    return { mime: v.mime as string, ext: v.ext as string, size: v.blob.size as number, err, ms: performance.now() - t0 };
  });
  expect(out.size).toBeGreaterThan(0);
  // An MP4 must carry H.264; otherwise WebM (plays in every browser) is the right container.
  if (out.ext === 'mp4') expect(out.mime).toMatch(/avc1/);
  else expect(out.mime).toMatch(/^video\/webm/);
  expect(out.err).toBe('AbortError');
  expect(out.ms).toBeLessThan(3000);
});

test('gallery save/list/get/remove round-trips and the list UI updates', async ({ page }) => {
  await expect(page.locator('.ol-gallery-empty')).toHaveText('No videos yet. Make one from any answer with Create video.');
  const out = await page.evaluate(async () => {
    const { gallery } = (window as any).lessonApi;
    const lesson = (window as any).lessonHarness.sampleLesson;
    const blob = new Blob([new Uint8Array(4096).fill(7)], { type: 'video/webm' });
    const id = await gallery.save({ lesson, blob, mime: 'video/webm' });
    const list = await gallery.list();
    const rec = await gallery.get(id);
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    return { id, list, rec: { title: rec.title, mime: rec.mime, size: rec.size, steps: rec.lesson.steps.length, first: bytes[0], len: bytes.length } };
  });
  expect(out.list).toHaveLength(1);
  expect(out.list[0]).toMatchObject({ id: out.id, title: 'Solving a quadratic by factoring', size: 4096 });
  expect(out.list[0].duration).toBeGreaterThan(15);
  expect(out.rec).toEqual({ title: 'Solving a quadratic by factoring', mime: 'video/webm', size: 4096, steps: 5, first: 7, len: 4096 });

  const item = page.locator(`.ol-gallery-item[data-id="${out.id}"]`);
  await expect(item.locator('.ol-gallery-title')).toHaveText('Solving a quadratic by factoring');
  await expect(item.locator('.ol-gallery-meta')).toContainText('4 KB');
  const download = page.waitForEvent('download');
  await item.locator('.ol-gallery-download').click();
  expect((await download).suggestedFilename()).toBe('solving-a-quadratic-by-factoring.webm');

  // Delete via the UI (two-step confirm), then via the API on a second record.
  await item.locator('.ol-gallery-delete').click();
  await item.locator('.ol-gallery-delete').click();
  await expect(page.locator('.ol-gallery-empty')).toBeVisible();
  const after = await page.evaluate(async () => {
    const { gallery } = (window as any).lessonApi;
    const id = await gallery.save({ lesson: (window as any).lessonHarness.sampleLesson, blob: new Blob(['x']), mime: 'video/mp4' });
    await gallery.remove(id);
    return { list: await gallery.list(), got: await gallery.get(id) };
  });
  expect(after.list).toEqual([]);
  expect(after.got).toBeUndefined();
});

test('gallery offers the saved WebVTT captions as a download', async ({ page }) => {
  const id = await page.evaluate(async () => {
    const { gallery } = (window as any).lessonApi;
    const vtt = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello.\n';
    return gallery.save({ lesson: (window as any).lessonHarness.sampleLesson, blob: new Blob(['x']), mime: 'video/webm', vtt });
  });
  const item = page.locator(`.ol-gallery-item[data-id="${id}"]`);
  const download = page.waitForEvent('download');
  await item.locator('.ol-gallery-captions').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('solving-a-quadratic-by-factoring.vtt');
  const { readFileSync } = await import('node:fs');
  expect(readFileSync((await d.path())!, 'utf8')).toContain('Hello.');
  // Videos saved without captions get no captions button.
  const plain = await page.evaluate(() => (window as any).lessonApi.gallery.save({ lesson: (window as any).lessonHarness.sampleLesson, blob: new Blob(['y']), mime: 'video/webm' }));
  await expect(page.locator(`.ol-gallery-item[data-id="${plain}"] .ol-gallery-download`)).toBeVisible();
  await expect(page.locator(`.ol-gallery-item[data-id="${plain}"] .ol-gallery-captions`)).toHaveCount(0);
  await page.evaluate(async (ids) => Promise.all(ids.map((x) => (window as any).lessonApi.gallery.remove(x))), [id, plain]);
});

test('gallery throws a clear error when IndexedDB is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
  await page.reload();
  await expect(page.locator('.ol-gallery-error')).toContainText('Video gallery unavailable');
  const msg = await page.evaluate(() => (window as any).lessonApi.gallery.list().then(() => 'ok', (e: Error) => e.message));
  expect(msg).toMatch(/^Video gallery unavailable/);
});

// ---------------------------------------------------------------- lesson scripts (teaching styles)

const STYLES = ['chalkboard', 'marker', 'visual', 'lecture', 'socratic', 'exam', 'quick', 'beginner', 'proof', 'story'] as const;
const scriptUrl = (script: string, extra = '') => `${HARNESS}?script=${script}${extra}`;

/** Replaces speechSynthesis with a recorder; lines "finish" after 20 ms unless window.__holdSpeech is set. */
const stubSpeech = () => {
  const w = window as any;
  w.__spoken = [] as string[];
  w.__pending = [] as SpeechSynthesisUtterance[];
  const fake = {
    speak(u: SpeechSynthesisUtterance) {
      w.__spoken.push(u.text);
      if (w.__holdSpeech) w.__pending.push(u);
      else setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 20);
    },
    cancel() {
      w.__cancels = (w.__cancels ?? 0) + 1;
    },
    getVoices: () => [],
    addEventListener() {},
    removeEventListener() {},
    speaking: false,
    pending: false,
    paused: false,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
};

async function openScript(page: import('@playwright/test').Page, script: string, extra = '') {
  await page.goto(scriptUrl(script, extra));
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
}

test('scripts: every scene draws in every style, and styles look different', async ({ page }) => {
  test.setTimeout(180_000);
  await openScript(page, 'lecture', '&narrate=0');
  const out = await page.evaluate(async (styles) => {
    const api = (window as any).lessonApi;
    const scripts = (window as any).lessonHarness.scripts;
    const thumb = (c: HTMLCanvasElement) => {
      const t = document.createElement('canvas');
      t.width = 160;
      t.height = 90;
      const g = t.getContext('2d')!;
      g.drawImage(c, 0, 0, 160, 90);
      return g.getImageData(0, 0, 160, 90).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 60) n++;
      return n / (a.length / 4);
    };
    const meanDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4) / 3;
    };
    const res: Record<string, { coverage: Record<string, number[]>; sig: number[] }> = {};
    const sigs: Record<string, Uint8ClampedArray> = {};
    for (const style of styles) {
      const coverage: Record<string, number[]> = {};
      for (const key of ['equation', 'graph', 'lecture']) {
        const s = { ...scripts[key], style };
        const blank = await api.createScriptCanvasRenderer({ ...s, scenes: [] }, { style });
        blank.draw(0);
        const bg = thumb(blank.canvas);
        const r = await api.createScriptCanvasRenderer(s, { style });
        coverage[key] = r.timeline.scenes.map((sc: any) => {
          r.draw(sc.end - 0.15);
          return diff(thumb(r.canvas), bg);
        });
        if (key === 'equation') {
          const st = r.timeline.scenes.find((x: any) => x.scene.kind === 'step');
          r.draw(st.end - 0.15);
          sigs[style] = thumb(r.canvas);
        }
      }
      res[style] = { coverage, sig: [] };
    }
    const pairs: [string, string, number][] = [];
    for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) pairs.push([styles[i]!, styles[j]!, meanDiff(sigs[styles[i]!]!, sigs[styles[j]!]!)]);
    return { res, pairs };
  }, [...STYLES]);
  for (const style of STYLES) {
    for (const [key, cov] of Object.entries(out.res[style]!.coverage)) {
      cov.forEach((c, i) => expect(c, `${style}/${key} scene ${i} draws something`).toBeGreaterThan(0.004));
    }
  }
  const minPair = out.pairs.reduce((a, b) => (b[2] < a[2] ? b : a));
  console.log(`closest styles: ${minPair[0]} vs ${minPair[1]} (mean |Δ| ${minPair[2].toFixed(2)})`);
  for (const [a, b, d] of out.pairs) expect(d, `${a} vs ${b} look different`).toBeGreaterThan(2);
});

test('scripts: handwriting reveals left to right with the pen, and fades instead under reduced motion', async ({ page }) => {
  await openScript(page, 'equation', '&narrate=0');
  const out = await page.evaluate(async () => {
    const api = (window as any).lessonApi;
    const s = (window as any).lessonHarness.script;
    const count = (c: HTMLCanvasElement, bg: Uint8ClampedArray) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i]! - bg[i]!) + Math.abs(d[i + 1]! - bg[i + 1]!) + Math.abs(d[i + 2]! - bg[i + 2]!) > 90) n++;
      return n;
    };
    const run = async (reducedMotion: boolean) => {
      const r = await api.createScriptCanvasRenderer(s, { style: 'chalkboard', reducedMotion });
      const st = r.timeline.scenes.find((x: any) => x.scene.kind === 'step');
      const [t0, t1] = st.beats.tex;
      r.draw(t0 - 0.02);
      const before = r.canvas.getContext('2d')!.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
      const counts = [0.25, 0.5, 0.75, 1].map((f) => {
        r.draw(t0 + (t1 - t0) * f);
        return count(r.canvas, before);
      });
      return counts;
    };
    return { normal: await run(false), reduced: await run(true) };
  });
  const n = out.normal;
  expect(n[0]).toBeGreaterThan(0);
  expect(n[1]).toBeGreaterThan(n[0]);
  expect(n[2]).toBeGreaterThan(n[1]);
  // Reduced motion: no clip sweep or pen, so the line is fully there (faded in) early on.
  expect(out.reduced[1]).toBeGreaterThan(n[1]);
});

test('scripts: captions show each line, and the player can switch style', async ({ page }) => {
  await page.addInitScript(stubSpeech);
  await openScript(page, 'equation');
  const scenes = await page.evaluate(() => {
    const api = (window as any).lessonApi;
    return api.buildScriptTimeline((window as any).lessonHarness.script).scenes.map((s: any) => ({ say: s.say, mid: (s.start + s.end) / 2 }));
  });
  for (const [i, s] of (scenes as { say: string; mid: number }[]).entries()) {
    await page.evaluate((t) => (window as any).lessonHarness.player.seek(t), s.mid);
    await expect(page.locator('.ol-script-player')).toHaveAttribute('data-scene', String(i));
    await expect(page.locator('.ol-caption')).toHaveText(s.say);
    await expect(page.locator('.ol-caption')).toBeVisible();
  }
  await expect(page.locator('.ol-cc')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.ol-cc').click();
  await expect(page.locator('.ol-caption')).toBeHidden();
  await page.locator('.ol-cc').click();
  await expect(page.locator('.ol-caption')).toBeVisible();

  const before = await page.evaluate(() => (window as any).lessonHarness.player.duration);
  await page.locator('#style-pick').selectOption('visual');
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-style', 'visual');
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  const after = await page.evaluate(() => (window as any).lessonHarness.player.duration);
  expect(after).not.toBe(before);
  // Style change keeps the position in the lesson (same scene).
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-scene', String(scenes.length - 1));
});

test('scripts: narration speaks each line, holds a long line, and seeking cancels it', async ({ page }) => {
  await page.addInitScript(stubSpeech);
  await openScript(page, 'equation');
  await expect(page.locator('.ol-voice')).toHaveAttribute('aria-pressed', 'true');
  const says = await page.evaluate(() => (window as any).lessonHarness.script.scenes.map((s: any) => s.say));
  await page.locator('.ol-play').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual([says[0]]);
  // Jump to the start of scene 2 while playing: it speaks that line.
  const start2 = await page.evaluate(() => (window as any).lessonApi.buildScriptTimeline((window as any).lessonHarness.script).scenes[2].start);
  await page.evaluate((t) => (window as any).lessonHarness.player.seek(t + 0.05), start2);
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toBe(says[2]);
  await page.locator('.ol-play').click();

  // A line that runs long holds its scene until it ends.
  await page.evaluate(() => ((window as any).__holdSpeech = true));
  const sc = await page.evaluate(() => (window as any).lessonApi.buildScriptTimeline((window as any).lessonHarness.script).scenes[1]);
  await page.evaluate((t) => (window as any).lessonHarness.player.seek(t), sc.start);
  const cancelsBefore = await page.evaluate(() => (window as any).__cancels ?? 0);
  await page.locator('.ol-play').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.at(-1))).toBe(says[1]);
  await page.waitForTimeout((sc.end - sc.start) * 1000 + 900);
  const held = Number(await page.locator('.ol-script-player').getAttribute('data-time'));
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-scene', '1');
  expect(held).toBeGreaterThan(sc.end - 0.2);
  // The line ends: playback moves on to the next scene.
  await page.evaluate(() => {
    const w = window as any;
    w.__holdSpeech = false;
    for (const u of w.__pending) u.onend?.(new Event('end'));
  });
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-scene', '2');
  // Seeking cancels speech.
  await page.evaluate(() => (window as any).lessonHarness.player.seek(1));
  expect(await page.evaluate(() => (window as any).__cancels)).toBeGreaterThan(cancelsBefore);
  await page.locator('.ol-play').click();
});

test('scripts: pause scene shows a countdown and "Show me" skips ahead', async ({ page }) => {
  await page.addInitScript(stubSpeech);
  await openScript(page, 'lecture');
  const info = await page.evaluate(async () => {
    const api = (window as any).lessonApi;
    const s = (window as any).lessonHarness.script;
    const r = await api.createScriptCanvasRenderer(s, { style: s.style });
    const st = r.timeline.scenes.find((x: any) => x.scene.kind === 'pause');
    const [c0, c1] = st.countdown;
    const snap = (t: number) => {
      r.draw(t);
      return r.canvas.getContext('2d')!.getImageData(0, 0, r.canvas.width, r.canvas.height).data;
    };
    const a = snap(c0 + 0.2);
    const b = snap((c0 + c1) / 2);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 40) changed++;
    return { index: st.index, start: st.start, c0, c1, end: st.end, changed, total: a.length / 4 };
  });
  // Only the countdown ring changes while the viewer thinks.
  expect(info.changed).toBeGreaterThan(50);
  expect(info.changed / info.total).toBeLessThan(0.05);
  await page.evaluate((t) => (window as any).lessonHarness.player.seek(t), info.c0 + 0.5);
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-kind', 'pause');
  const showMe = page.locator('.ol-showme');
  await expect(showMe).toBeVisible();
  await page.locator('.ol-play').click();
  await showMe.click();
  await expect(showMe).toBeHidden();
  expect(Number(await page.locator('.ol-script-player').getAttribute('data-time'))).toBeGreaterThanOrEqual(info.c1 - 0.05);
  await expect(page.locator('.ol-script-player')).toHaveAttribute('data-state', 'playing');
  await page.locator('.ol-play').click();
});

test('scripts: export yields a video with burned captions plus WebVTT cues per scene, and saves to the gallery', async ({ page }) => {
  test.setTimeout(120_000);
  await openScript(page, 'equation', '&narrate=0');
  const out = await page.evaluate(async () => {
    const api = (window as any).lessonApi;
    const full = (window as any).lessonHarness.script;
    const script = { ...full, title: 'Short export', scenes: full.scenes.slice(0, 3) };
    const tl = api.buildScriptTimeline(script);
    // Burned captions: the caption band differs from the same frame without captions.
    const withCap = await api.createScriptCanvasRenderer(script, { captions: true });
    const noCap = await api.createScriptCanvasRenderer(script, { captions: false });
    const mid = (tl.scenes[1].start + tl.scenes[1].end) / 2;
    withCap.draw(mid);
    noCap.draw(mid);
    const band = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 630, 1280, 70).data;
    const a = band(withCap.canvas);
    const b = band(noCap.canvas);
    let capDiff = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 40) capDiff++;
    const v = await api.exportScriptVideo(script);
    const url = URL.createObjectURL(v.blob);
    const video = document.createElement('video');
    video.muted = true;
    const meta = await new Promise<{ w: number; h: number }>((res, rej) => {
      video.onloadedmetadata = () => res({ w: video.videoWidth, h: video.videoHeight });
      video.onerror = () => rej(new Error('video failed to load'));
      video.src = url;
    });
    const id = await api.gallery.save({ lesson: script, blob: v.blob, mime: v.mime, vtt: v.vtt });
    const list = await api.gallery.list();
    const rec = await api.gallery.get(id);
    return {
      size: v.blob.size,
      mime: v.mime,
      vtt: v.vtt as string,
      meta,
      capDiff,
      scenes: tl.scenes.map((s: any) => ({ say: s.say, start: s.start, end: s.end })),
      listed: list.find((x: any) => x.id === id),
      stored: { scenes: rec.lesson.scenes.length, vtt: rec.vtt },
      id,
    };
  });
  expect(out.size).toBeGreaterThan(10_000);
  expect(out.mime).toMatch(/^video\/(mp4|webm)/);
  expect(out.meta).toEqual({ w: 1280, h: 720 });
  expect(out.capDiff).toBeGreaterThan(500);
  // WebVTT: one cue per narrated scene, matching its text and timing.
  expect(out.vtt.startsWith('WEBVTT\n')).toBe(true);
  const cues = [...out.vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})\n(.+)/g)].map((m) => ({
    start: +m[1]! * 3600 + +m[2]! * 60 + +m[3]! + +m[4]! / 1000,
    end: +m[5]! * 3600 + +m[6]! * 60 + +m[7]! + +m[8]! / 1000,
    text: m[9],
  }));
  expect(cues.map((c) => c.text)).toEqual(out.scenes.map((s: { say: string }) => s.say));
  cues.forEach((c, i) => {
    expect(c.start).toBeCloseTo(out.scenes[i]!.start, 2);
    expect(c.end).toBeCloseTo(out.scenes[i]!.end, 2);
  });
  expect(out.listed).toMatchObject({ title: 'Short export', style: 'Chalkboard' });
  expect(out.stored).toEqual({ scenes: 3, vtt: out.vtt });
  const item = page.locator(`.ol-gallery-item[data-id="${out.id}"]`);
  await expect(item.locator('.ol-gallery-meta')).toContainText('Chalkboard · ');
});

test('lecture recording: a blocked mic gives a clear error, and a failed audio graph releases the mic', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const m = await import('/src/lecture/transcribe.ts' as string);
    const res: Record<string, unknown> = {};
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    let rec = m.recordLecture();
    res.denied = await rec.ready.then(() => 'ok', (e: Error) => e.message);
    res.deniedStop = await rec.stop().then(() => 'ok', (e: Error) => e.message);
    // The mic opens, then the worklet can't load: the track must be stopped, not left recording.
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    ac.createOscillator().connect(dest);
    const track = dest.stream.getAudioTracks()[0]!;
    navigator.mediaDevices.getUserMedia = async () => new MediaStream([track]);
    const orig = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = () => Promise.reject(new Error('blocked'));
    rec = m.recordLecture();
    res.failed = await rec.ready.then(() => 'ok', (e: Error) => e.message);
    res.track = track.readyState;
    AudioWorklet.prototype.addModule = orig;
    return res;
  });
  expect(out.denied).toMatch(/Microphone access was blocked/);
  expect(out.deniedStop).toMatch(/Microphone access was blocked/);
  expect(out.failed).toMatch(/Could not start recording/);
  expect(out.track).toBe('ended');
});
