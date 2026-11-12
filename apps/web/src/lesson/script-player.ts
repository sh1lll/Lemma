// Player for lesson scripts: the canvas renderer (script-render.ts) plus controls, narration and captions.
import './lesson.css';
import type { LessonPlayer } from './player';
import { createScriptCanvasRenderer, type ScriptCanvasRenderer } from './script-render';
import { buildScriptTimeline, isStyleId, sceneCaptionAt, sceneIndexAt, STYLE_LOOKS, type LessonScript, type ScriptTimeline, type StyleId } from './script-timeline';
import { formatTime } from './timeline';

export interface ScriptPlayerOptions {
  /** Speak each scene's line with speechSynthesis (default on). */
  narrate?: boolean;
  /** Show the caption bar (default on). */
  captions?: boolean;
  autoplay?: boolean;
}

export interface ScriptPlayer extends LessonPlayer {
  setStyle(s: StyleId): void;
  readonly style: StyleId;
  /** Resolves when the current style is laid out and drawable. */
  readonly ready: Promise<void>;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  voice:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A natural-sounding English voice when the platform has one. */
function pickVoice(): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    return null;
  }
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (!en.length) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|premium|enhanced/i.test(v.name) ? 8 : 0) +
    (/google (us|uk) english|samantha|ava|allison|serena|daniel|aria|jenny|guy/i.test(v.name) ? 4 : 0) +
    (/en[-_]us/i.test(v.lang) ? 2 : /en[-_]gb/i.test(v.lang) ? 1 : 0) +
    (v.localService ? 0.5 : 0) -
    (/compact|eloquence|novelty|whisper|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|zarvox|albert|fred|junior|ralph/i.test(v.name) ? 10 : 0);
  return en.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function createScriptPlayer(container: HTMLElement, script: LessonScript, opts: ScriptPlayerOptions = {}): ScriptPlayer {
  const canSpeak = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  let style: StyleId = isStyleId(script.style) ? script.style : 'chalkboard';
  let tl: ScriptTimeline = buildScriptTimeline(script, style);
  let renderer: ScriptCanvasRenderer | null = null;
  let t = 0;
  let playing = false;
  let narrate = (opts.narrate ?? true) && canSpeak;
  let captions = opts.captions ?? true;
  let raf = 0;
  let anchorPerf = 0;
  let anchorT = 0;
  let activeScene = -1;
  let spokenScene = -1;
  let speaking: { scene: number; done: boolean } | null = null;
  let holdSince = 0;
  let generation = 0;
  let destroyed = false;
  let voice: SpeechSynthesisVoice | null = canSpeak ? pickVoice() : null;

  const root = el('div', 'ol-player ol-script-player');
  root.dataset.state = 'paused';
  root.dataset.ready = 'false';
  const stage = el('div', 'ol-stage ol-script-stage');
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', `Lesson video: ${script.title}`);
  stage.tabIndex = 0;
  const canvas = el('canvas', 'ol-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const loading = el('div', 'ol-loading', 'Preparing the lesson…');
  const caption = el('div', 'ol-caption');
  caption.setAttribute('aria-hidden', 'true');
  const captionText = el('span', 'ol-caption-text');
  caption.append(captionText);
  const showMe = el('button', 'ol-btn ol-showme', 'Show me');
  showMe.type = 'button';
  showMe.hidden = true;
  stage.append(canvas, loading, caption, showMe);

  const live = el('div', 'ol-sr');
  live.setAttribute('aria-live', 'polite');

  const controls = el('div', 'ol-controls');
  const playBtn = el('button', 'ol-btn ol-play');
  playBtn.type = 'button';
  const time = el('span', 'ol-time');
  const scrub = el('input', 'ol-scrub');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.step = '0.01';
  scrub.setAttribute('aria-label', 'Seek');
  const ccBtn = el('button', 'ol-btn ol-icon ol-cc');
  ccBtn.type = 'button';
  ccBtn.innerHTML = ICONS.cc;
  ccBtn.setAttribute('aria-label', 'Captions');
  ccBtn.title = 'Captions';
  const voiceBtn = el('button', 'ol-btn ol-icon ol-voice');
  voiceBtn.type = 'button';
  voiceBtn.innerHTML = ICONS.voice;
  voiceBtn.setAttribute('aria-label', 'Narration');
  voiceBtn.title = canSpeak ? 'Narration' : 'Narration is not available in this browser';
  voiceBtn.disabled = !canSpeak;
  const fullBtn = el('button', 'ol-btn ol-icon ol-full');
  fullBtn.type = 'button';
  fullBtn.innerHTML = ICONS.full;
  fullBtn.setAttribute('aria-label', 'Full screen');
  fullBtn.title = 'Full screen';
  fullBtn.hidden = !(document.fullscreenEnabled && typeof root.requestFullscreen === 'function');
  controls.append(playBtn, time, scrub, ccBtn, voiceBtn, fullBtn);
  root.append(stage, controls, live);
  container.append(root);

  // ---------- narration

  function stopSpeech() {
    if (canSpeak) {
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    speaking = null;
    holdSince = 0;
  }

  function speak(i: number) {
    stopSpeech();
    spokenScene = i;
    const st = tl.scenes[i];
    if (!narrate || !canSpeak || !st?.say) return;
    voice ??= pickVoice();
    const u = new SpeechSynthesisUtterance(st.say);
    u.rate = 1;
    u.pitch = 1;
    u.lang = voice?.lang ?? 'en-US';
    if (voice) u.voice = voice;
    const rec = { scene: i, done: false };
    u.onend = () => (rec.done = true);
    u.onerror = () => (rec.done = true);
    speaking = rec;
    speechSynthesis.speak(u);
  }

  // ---------- drawing + state

  function render() {
    renderer?.draw(t);
    const i = sceneIndexAt(tl, t);
    const st = tl.scenes[i];
    if (i !== activeScene) {
      activeScene = i;
      live.textContent = st?.say ?? '';
      root.dataset.scene = String(i);
      root.dataset.kind = st?.scene.kind ?? '';
      if (playing && i !== spokenScene && st && t - st.start < 1.0) speak(i);
    }
    caption.hidden = !captions || !st?.say;
    // Page through long lines in two-line chunks as they're spoken.
    const shownCaption = st ? sceneCaptionAt(st, t) : '';
    if (captionText.textContent !== shownCaption) captionText.textContent = shownCaption;
    showMe.hidden = !(st?.countdown && t < st.countdown[1] - 0.05);
    scrub.max = String(tl.duration);
    scrub.value = String(t);
    scrub.style.setProperty('--p', `${((t / tl.duration) * 100).toFixed(2)}%`);
    time.textContent = `${formatTime(t)} / ${formatTime(tl.duration)}`;
    root.dataset.time = t.toFixed(2);
  }

  function syncButtons() {
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.dataset.state = playing ? 'playing' : 'paused';
    voiceBtn.setAttribute('aria-pressed', String(narrate));
    ccBtn.setAttribute('aria-pressed', String(captions));
    root.dataset.style = style;
  }

  function frame(now: number) {
    let next = anchorT + (now - anchorPerf) / 1000;
    const st = tl.scenes[sceneIndexAt(tl, t)];
    // The timeline is estimate-based; if the voice runs long, hold the scene's last frame until it finishes
    // rather than cutting the line off (capped, in case the engine never reports the end).
    if (st && speaking && speaking.scene === st.index && !speaking.done && next >= st.end - 0.03) {
      holdSince ||= now;
      if (now - holdSince < Math.max(3000, st.speech * 700)) {
        next = Math.max(t, st.end - 0.03);
        anchorPerf = now;
        anchorT = next;
      }
    } else holdSince = 0;
    t = Math.min(tl.duration, next);
    render();
    if (t >= tl.duration) {
      pause();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (playing || destroyed) return;
    if (t >= tl.duration - 0.01) t = 0;
    playing = true;
    anchorPerf = performance.now();
    anchorT = t;
    syncButtons();
    const i = sceneIndexAt(tl, t);
    const st = tl.scenes[i];
    activeScene = i;
    if (st && t - st.start < 1.5) speak(i);
    else spokenScene = i;
    render();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    stopSpeech();
    syncButtons();
  }

  function seek(next: number) {
    t = Math.min(tl.duration, Math.max(0, Number.isFinite(next) ? next : 0));
    anchorPerf = performance.now();
    anchorT = t;
    // Seeking cancels the current line; the next scene speaks as it starts.
    stopSpeech();
    activeScene = -1;
    spokenScene = sceneIndexAt(tl, t);
    const st = tl.scenes[spokenScene];
    if (playing && st && t - st.start < 0.3) spokenScene = -1;
    render();
  }

  // ---------- (re)building for a style

  function stagePixels(): { width: number; height: number } {
    const cssW = stage.clientWidth || 960;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const k = Math.min(1.5, Math.max(1, Math.round(((cssW * dpr) / 1280) * 4) / 4));
    return { width: Math.round(1280 * k), height: Math.round(720 * k) };
  }

  let readyPromise: Promise<void> = Promise.resolve();

  function build(next: StyleId, keepPosition: boolean) {
    const gen = ++generation;
    const prevTl = tl;
    const prevT = t;
    const wasPlaying = playing;
    if (wasPlaying) pause();
    style = next;
    tl = buildScriptTimeline(script, style);
    if (keepPosition) {
      const i = sceneIndexAt(prevTl, prevT);
      const a = prevTl.scenes[i];
      const b = tl.scenes[i];
      t = a && b ? b.start + ((prevT - a.start) / Math.max(0.01, a.end - a.start)) * (b.end - b.start) : 0;
    }
    activeScene = -1;
    root.dataset.ready = 'false';
    root.dataset.style = style;
    stage.dataset.look = STYLE_LOOKS[style].dark ? 'dark' : 'light';
    loading.hidden = false;
    loading.textContent = 'Preparing the lesson…';
    syncButtons();
    readyPromise = (async () => {
      try {
        const r = await createScriptCanvasRenderer(script, { ...stagePixels(), style, canvas: document.createElement('canvas') });
        if (gen !== generation || destroyed) return;
        // Swap in the freshly drawn canvas only once it's ready, so a style change never flashes blank.
        r.canvas.className = 'ol-canvas';
        r.canvas.setAttribute('aria-hidden', 'true');
        stage.querySelector('.ol-canvas')?.replaceWith(r.canvas);
        renderer = r;
        loading.hidden = true;
        root.dataset.ready = 'true';
        render();
        if (wasPlaying || (opts.autoplay && !keepPosition)) play();
      } catch (e) {
        if (gen !== generation) return;
        loading.textContent = `Could not prepare this lesson: ${(e as Error).message}`;
        throw e;
      }
    })();
    readyPromise.catch(() => {});
    render();
  }

  // ---------- events

  const onPlayClick = () => (playing ? pause() : play());
  const onScrub = () => seek(Number(scrub.value));
  const onVoice = () => {
    narrate = !narrate;
    syncButtons();
    if (!narrate) stopSpeech();
    else if (playing) speak(sceneIndexAt(tl, t));
  };
  const onCc = () => {
    captions = !captions;
    syncButtons();
    render();
  };
  const onShowMe = (e: Event) => {
    e.stopPropagation();
    const st = tl.scenes[sceneIndexAt(tl, t)];
    if (st?.countdown) seek(st.countdown[1]);
  };
  const onFull = () => {
    if (document.fullscreenElement === root) void document.exitFullscreen();
    else void root.requestFullscreen?.().catch(() => {});
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== stage) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      onPlayClick();
    } else if (e.key === 'ArrowRight') seek(t + 5);
    else if (e.key === 'ArrowLeft') seek(t - 5);
    else if (e.key === 'c') onCc();
  };
  const onStageClick = (e: MouseEvent) => {
    if (e.target === showMe) return;
    onPlayClick();
  };
  const onVoices = () => (voice = pickVoice());
  const onReduced = () => build(style, true);

  playBtn.addEventListener('click', onPlayClick);
  scrub.addEventListener('input', onScrub);
  ccBtn.addEventListener('click', onCc);
  voiceBtn.addEventListener('click', onVoice);
  fullBtn.addEventListener('click', onFull);
  showMe.addEventListener('click', onShowMe);
  stage.addEventListener('keydown', onKey);
  stage.addEventListener('click', onStageClick);
  if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', onVoices);
  reducedQuery?.addEventListener?.('change', onReduced);

  syncButtons();
  build(style, false);

  return {
    play,
    pause,
    seek,
    get duration() {
      return tl.duration;
    },
    get currentTime() {
      return t;
    },
    get playing() {
      return playing;
    },
    get style() {
      return style;
    },
    get ready() {
      return readyPromise;
    },
    setStyle(s: StyleId) {
      if (!isStyleId(s) || s === style) return;
      build(s, true);
    },
    destroy() {
      destroyed = true;
      generation++;
      pause();
      if (canSpeak) speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
      reducedQuery?.removeEventListener?.('change', onReduced);
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      root.remove();
    },
  };
}
