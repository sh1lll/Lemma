import './lesson.css';
import { renderInlineMath } from '../math-render';
import {
  activeSceneIndex,
  answerHighlight,
  buildTimeline,
  formatTime,
  sceneVisual,
  visualAt,
  type Block,
  type Lesson,
  type Scene,
} from './timeline';

export interface LessonPlayer {
  play(): void;
  pause(): void;
  seek(t: number): void;
  readonly duration: number;
  readonly currentTime: number;
  readonly playing: boolean;
  destroy(): void;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  voice:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Builds the DOM for one block. Shared vocabulary with the canvas renderer (see export.ts). */
export function renderBlock(b: Block): HTMLElement {
  switch (b.kind) {
    case 'label':
      return el('p', 'ol-label', b.text);
    case 'heading':
      return el('h2', 'ol-heading', b.text);
    case 'text':
      return el('p', `ol-text ol-${b.size} ol-${b.tone}`, b.text);
    case 'math': {
      const m = el('div', `ol-math ol-math-${b.size}`);
      const inner = el('span', 'ol-math-inner');
      renderInlineMath(inner, `\\displaystyle ${b.tex}`, false);
      m.append(inner);
      return m;
    }
    case 'answer': {
      const box = el('div', 'ol-answer');
      if (b.tex) {
        const inner = el('span', 'ol-math-inner');
        renderInlineMath(inner, `\\displaystyle ${b.tex}`, false);
        box.append(inner);
      } else box.append(el('span', 'ol-answer-text', b.display));
      return box;
    }
  }
}

export function createLessonPlayer(container: HTMLElement, lesson: Lesson, opts: { narrate?: boolean } = {}): LessonPlayer {
  const tl = buildTimeline(lesson);
  const duration = tl.duration;
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const canSpeak = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

  let t = 0;
  let playing = false;
  let narrate = !!opts.narrate && canSpeak;
  let raf = 0;
  let anchorPerf = 0;
  let anchorT = 0;
  let spokenScene = -1;
  let announcedScene = -1;

  const root = el('div', 'ol-player');
  root.dataset.state = 'paused';
  const stage = el('div', 'ol-stage');
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', `Lesson: ${lesson.title}`);
  stage.tabIndex = 0;

  const header = tl.header ? el('div', 'ol-header') : null;
  if (header && tl.header) {
    header.append(el('span', 'ol-header-label', 'Question'), el('span', 'ol-header-text', tl.header.text));
    header.setAttribute('aria-hidden', 'true');
    stage.append(header);
  }

  const sceneEls = tl.scenes.map((scene: Scene) => {
    const s = el('section', `ol-scene ol-${scene.align} ol-kind-${scene.segment.kind}`);
    s.dataset.kind = scene.segment.kind;
    if (scene.segment.kind === 'step') s.dataset.step = String(scene.segment.index);
    for (const b of scene.blocks) s.append(renderBlock(b));
    stage.append(s);
    return s;
  });

  const live = el('div', 'ol-sr');
  live.setAttribute('aria-live', 'polite');

  // Controls
  const controls = el('div', 'ol-controls');
  const playBtn = el('button', 'ol-btn ol-play');
  playBtn.type = 'button';
  const time = el('span', 'ol-time');
  const scrub = el('input', 'ol-scrub');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(duration);
  scrub.step = '0.01';
  scrub.setAttribute('aria-label', 'Seek');
  const voiceBtn = el('button', 'ol-btn ol-icon ol-voice');
  voiceBtn.type = 'button';
  voiceBtn.innerHTML = ICONS.voice;
  voiceBtn.setAttribute('aria-label', 'Narration');
  voiceBtn.title = canSpeak ? 'Read steps aloud' : 'Narration is not available in this browser';
  voiceBtn.disabled = !canSpeak;
  const fullBtn = el('button', 'ol-btn ol-icon ol-full');
  fullBtn.type = 'button';
  fullBtn.innerHTML = ICONS.full;
  fullBtn.setAttribute('aria-label', 'Full screen');
  fullBtn.title = 'Full screen';
  fullBtn.hidden = !(document.fullscreenEnabled && typeof root.requestFullscreen === 'function');
  controls.append(playBtn, time, scrub, voiceBtn, fullBtn);

  root.append(stage, controls, live);
  container.append(root);

  const reduced = () => !!reducedQuery?.matches;

  function speak(i: number) {
    if (!narrate || !canSpeak) return;
    speechSynthesis.cancel();
    const text = tl.scenes[i]?.segment.speech;
    spokenScene = i;
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  function render() {
    const r = reduced();
    tl.scenes.forEach((scene, i) => {
      const v = sceneVisual(scene, t, duration, r);
      const e = sceneEls[i]!;
      e.style.opacity = v.opacity.toFixed(3);
      e.style.transform = v.dy ? `translateY(calc(var(--u) * ${v.dy.toFixed(2)}))` : '';
      e.style.visibility = v.opacity > 0.001 ? 'visible' : 'hidden';
      if (scene.segment.kind === 'answer') e.style.setProperty('--h', answerHighlight(scene, t, r).toFixed(3));
    });
    if (header && tl.header) {
      const v = visualAt(tl.header.start, tl.header.end, t, r);
      header.style.opacity = v.opacity.toFixed(3);
      header.style.visibility = v.opacity > 0.001 ? 'visible' : 'hidden';
    }
    const active = activeSceneIndex(tl, t);
    if (active !== announcedScene) {
      announcedScene = active;
      const seg = tl.scenes[active]?.segment;
      live.textContent = seg?.speech ?? '';
      root.dataset.scene = seg ? (seg.kind === 'step' ? `step-${seg.index}` : seg.kind) : '';
      if (playing && active !== spokenScene) speak(active);
    }
    scrub.value = String(t);
    scrub.style.setProperty('--p', `${((t / duration) * 100).toFixed(2)}%`);
    time.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    root.dataset.time = t.toFixed(2);
  }

  function syncButtons() {
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.dataset.state = playing ? 'playing' : 'paused';
    voiceBtn.setAttribute('aria-pressed', String(narrate));
  }

  function frame(now: number) {
    t = Math.min(duration, anchorT + (now - anchorPerf) / 1000);
    render();
    if (t >= duration) {
      pause();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (playing) return;
    if (t >= duration - 0.01) t = 0;
    playing = true;
    anchorPerf = performance.now();
    anchorT = t;
    spokenScene = -1;
    announcedScene = -1; // re-announce (and narrate) the current scene
    syncButtons();
    render();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    if (canSpeak) speechSynthesis.cancel();
    spokenScene = -1;
    syncButtons();
  }

  function seek(next: number) {
    t = Math.min(duration, Math.max(0, Number.isFinite(next) ? next : 0));
    anchorPerf = performance.now();
    anchorT = t;
    if (playing && canSpeak && narrate) {
      speechSynthesis.cancel();
      spokenScene = -1;
      announcedScene = -1;
    }
    render();
  }

  const onPlayClick = () => (playing ? pause() : play());
  const onScrub = () => seek(Number(scrub.value));
  const onVoice = () => {
    narrate = !narrate;
    syncButtons();
    if (!narrate && canSpeak) speechSynthesis.cancel();
    else if (playing) speak(activeSceneIndex(tl, t));
  };
  const onFull = () => {
    if (document.fullscreenElement === root) void document.exitFullscreen();
    else void root.requestFullscreen?.().catch(() => {});
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      onPlayClick();
    } else if (e.key === 'ArrowRight') seek(t + 5);
    else if (e.key === 'ArrowLeft') seek(t - 5);
  };
  const onReduced = () => render();

  playBtn.addEventListener('click', onPlayClick);
  scrub.addEventListener('input', onScrub);
  voiceBtn.addEventListener('click', onVoice);
  fullBtn.addEventListener('click', onFull);
  stage.addEventListener('keydown', onKey);
  stage.addEventListener('click', onPlayClick);
  reducedQuery?.addEventListener?.('change', onReduced);

  syncButtons();
  render();

  return {
    play,
    pause,
    seek,
    duration,
    get currentTime() {
      return t;
    },
    get playing() {
      return playing;
    },
    destroy() {
      pause();
      reducedQuery?.removeEventListener?.('change', onReduced);
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      root.remove();
    },
  };
}
