/**
 * Long-form, on-device lecture transcription. Audio never leaves the device: files are decoded locally,
 * the microphone is captured into memory, and the existing Whisper worker transcribes 30 s windows.
 */
import { findSeam, windows } from '@lemma/lecture-engine';
import type { WorkerIn, WorkerOut } from '../whisper/worker';
import { MAX_STREAM_HOURS, MAX_WHOLE_DECODE_HOURS, openAudio, RATE, readAll, type AudioDeps, type AudioSource, type BlobLike } from './audio-source';

export { RATE, MAX_STREAM_HOURS, MAX_WHOLE_DECODE_HOURS, type AudioSource };

export interface TranscriptSegment {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
}

export interface TranscribeOptions {
  /** Called after each window: windows done, windows total, transcript so far. */
  onProgress?(done: number, total: number, partial: string): void;
  /** Model download/compile status ("Downloading speech model… 40%"), empty string when ready. */
  onStatus?(status: string): void;
  signal?: AbortSignal;
  /** Window length and overlap in seconds (defaults 30 and 2). */
  windowSec?: number;
  overlapSec?: number;
}

const abortError = () => new DOMException('Transcription was cancelled', 'AbortError');

// ── Decoding ────────────────────────────────────────────────────────────────

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Older Safari only has the callback form.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, (e) => reject(e ?? new Error('Could not decode this audio file')));
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/** Duration from the file's metadata via a media element, without decoding (null if it can't tell). */
function probeDuration(file: BlobLike): Promise<number | null> {
  if (typeof document === 'undefined' || !(file instanceof Blob)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('audio');
    const done = (v: number | null) => {
      clearTimeout(timer);
      a.removeAttribute('src');
      a.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

const browserDeps = (): AudioDeps => {
  // An OfflineAudioContext decodes without needing a user gesture or an audio output device, and at 16 kHz the
  // browser resamples while decoding.
  const ctx = new OfflineAudioContext(1, 1, RATE);
  return { decode: (data) => decode(ctx, data), probeDuration };
};

/**
 * Opens an audio file for transcription without decoding all of it: WAV and MP3 are decoded slice by slice as
 * {@link transcribeLong} reaches them; other formats are decoded whole (up to {@link MAX_WHOLE_DECODE_HOURS}).
 * Throws a readable error for files that are too long or can't be decoded.
 */
export function openAudioFile(file: Blob): Promise<AudioSource> {
  return openAudio(file, browserDeps());
}

/**
 * Decodes any format the browser supports and returns 16 kHz mono PCM. The whole result is one array
 * (230 MB per hour), so recordings over {@link MAX_WHOLE_DECODE_HOURS} are refused; pass {@link openAudioFile}'s
 * source to {@link transcribeLong} to handle longer ones without holding them in memory.
 */
export async function decodeAudioFile(file: Blob): Promise<Float32Array> {
  return readAll(await openAudioFile(file));
}

// ── Whisper worker (one shared instance) ────────────────────────────────────

interface Pending {
  resolve(text: string): void;
  reject(err: Error): void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const statusListeners = new Set<(s: string) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../whisper/worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === 'progress') statusListeners.forEach((l) => l(`Downloading speech model… ${m.percent}%`));
    else if (m.type === 'ready') statusListeners.forEach((l) => l(''));
    else if (m.type === 'result') {
      pending.get(m.id)?.resolve(m.text);
      pending.delete(m.id);
    } else if (m.type === 'error') {
      const err = new Error(`Speech model error: ${m.message}`);
      if (m.id !== undefined) {
        pending.get(m.id)?.reject(err);
        pending.delete(m.id);
      } else {
        // Model failed to load: nothing queued can succeed.
        for (const p of pending.values()) p.reject(err);
        pending.clear();
      }
      statusListeners.forEach((l) => l(err.message));
    }
  };
  w.onerror = (e) => {
    const err = new Error(`Speech worker failed: ${e.message || 'unknown error'}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  w.postMessage({ type: 'load' } satisfies WorkerIn);
  worker = w;
  return w;
}

/** Starts downloading/compiling the model before the first transcription. */
export function preloadLectureModel(onStatus?: (s: string) => void): void {
  if (onStatus) statusListeners.add(onStatus);
  ensureWorker();
}

function transcribeWindow(audio: Float32Array, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(abortError());
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      // The worker finishes the window it is on; its result is simply discarded.
      pending.delete(id);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (t) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(t);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    ensureWorker().postMessage({ type: 'transcribe', id, audio } satisfies WorkerIn, [audio.buffer]);
  });
}

function cleanText(text: string): string {
  // Whisper marks non-speech as [BLANK_AUDIO], (music), *applause* etc.
  return text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, '').replace(/\s+/g, ' ').trim();
}

function rms(a: Float32Array, from: number, to: number): number {
  let sum = 0;
  // Every 4th sample is plenty to tell silence from speech.
  let n = 0;
  for (let i = from; i < to; i += 4) {
    const v = a[i]!;
    sum += v * v;
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** Whisper invents text ("Thank you.") on silence, so near-silent windows are not sent at all. */
const SILENCE_RMS = 0.003;

/**
 * Transcribes long 16 kHz mono audio in overlapping 30 s windows with the on-device Whisper model.
 * Words heard in both halves of an overlap are written once. Rejects with an AbortError when `signal` fires.
 * `audio` may be an {@link AudioSource} (from {@link openAudioFile}): each window is then decoded only when
 * it is reached, so memory stays at about one window however long the recording is.
 */
export async function transcribeLong(audio: Float32Array | AudioSource, opts: TranscribeOptions = {}): Promise<TranscriptSegment[]> {
  const { signal, onProgress, onStatus } = opts;
  if (signal?.aborted) throw abortError();
  const wins = windows(audio.length, RATE, { windowSec: opts.windowSec, overlapSec: opts.overlapSec });
  const overlap = Math.round((opts.overlapSec ?? 2) * RATE);
  const segments: TranscriptSegment[] = [];
  if (!wins.length) return segments;
  if (onStatus) statusListeners.add(onStatus);
  try {
    ensureWorker();
    for (let i = 0; i < wins.length; i++) {
      if (signal?.aborted) throw abortError();
      const w = wins[i]!;
      // Segment times split each overlap down the middle, so segments are contiguous.
      const start = (i === 0 ? 0 : w.start + overlap / 2) / RATE;
      const end = (i === wins.length - 1 ? w.end : w.end - overlap / 2) / RATE;
      let text = '';
      const slice = audio instanceof Float32Array ? audio.slice(w.start, w.end) : await audio.read(w.start, w.end);
      if (signal?.aborted) throw abortError();
      if (rms(slice, 0, slice.length) >= SILENCE_RMS) {
        text = cleanText(await transcribeWindow(slice, signal));
      }
      const prev = segments[segments.length - 1];
      if (prev && prev.text && text) {
        const { keepA, skipB } = findSeam(prev.text, text);
        prev.text = prev.text.split(/\s+/).slice(0, keepA).join(' ');
        text = text.split(/\s+/).slice(skipB).join(' ');
      }
      segments.push({ text, start, end });
      onProgress?.(i + 1, wins.length, joinText(segments));
    }
  } finally {
    if (onStatus) statusListeners.delete(onStatus);
  }
  return segments.filter((s) => s.text);
}

const joinText = (segs: TranscriptSegment[]) =>
  segs
    .map((s) => s.text)
    .filter(Boolean)
    .join(' ');

// ── Microphone recording ────────────────────────────────────────────────────

export interface LectureRecording {
  /** Stops capture and returns everything recorded as 16 kHz mono PCM. Rejects if the mic could not be opened. */
  stop(): Promise<Float32Array>;
  /** Recent input level, 0…1 (RMS, lightly smoothed) — for a level meter. */
  level(): number;
  /** Seconds of audio captured so far. */
  elapsed(): number;
  /** Resolves once the microphone is live; rejects with a readable error if access fails. */
  ready: Promise<void>;
}

const TAP_WORKLET = `
class LectureTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('lemma-lecture-tap', LectureTap);
`;

function micError(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return new Error('Microphone access was blocked. Allow it in your system or browser settings.');
  if (name === 'NotFoundError') return new Error('No microphone was found.');
  return new Error('Could not open the microphone.');
}

/**
 * Records the microphone into memory as 16 kHz mono. Uses an AudioWorklet where available and falls back
 * to ScriptProcessor. Nothing is written to disk or sent anywhere.
 */
export function recordLecture(): LectureRecording {
  const chunks: Float32Array[] = [];
  let samples = 0;
  let lvl = 0;
  let carry = 0;
  let stopped = false;
  let teardown: (() => void) | null = null;

  const push = (input: Float32Array, rate: number) => {
    if (stopped) return;
    const ratio = rate / RATE;
    // Linear resample with a fractional read position carried across chunks.
    const n = Math.max(0, Math.ceil((input.length - carry) / ratio));
    const out = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = carry + i * ratio;
      const j = Math.floor(x);
      const f = x - j;
      const v = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? input[j] ?? 0) * f;
      out[i] = v;
      sum += v * v;
    }
    carry = carry + n * ratio - input.length;
    chunks.push(out);
    samples += n;
    const r = Math.sqrt(sum / Math.max(1, n));
    lvl = Math.max(r, lvl * 0.85);
  };

  const ready = (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // A lecture hall is not a phone call: keep gain control, but let the room sound through.
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw micError(e);
    }
    // From here on the microphone is live: if the audio graph can't be built, release it again instead of
    // leaving the recording indicator on with nothing listening.
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      await build(stream, ctx);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      throw e instanceof Error && /microphone/i.test(e.message) ? e : new Error('Could not start recording from the microphone.');
    }
  })();
  // Callers that only use stop() still see the error there; avoid an unhandled rejection meanwhile.
  ready.catch(() => {});

  async function build(stream: MediaStream, ctx: AudioContext): Promise<void> {
    const src = ctx.createMediaStreamSource(stream);
    // Keep the graph pulling without playing the room back through the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    let node: AudioNode;
    if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const tap = new AudioWorkletNode(ctx, 'lemma-lecture-tap');
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data, ctx.sampleRate);
      node = tap;
    } else {
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0).slice(), ctx.sampleRate);
      node = proc;
    }
    src.connect(node);
    node.connect(mute);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    teardown = () => {
      if (node instanceof AudioWorkletNode) node.port.onmessage = null;
      else (node as ScriptProcessorNode).onaudioprocess = null;
      src.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    // stop() may have been called while permission was pending.
    if (stopped) teardown();
  }

  return {
    ready,
    level: () => Math.min(1, lvl * 4),
    elapsed: () => samples / RATE,
    async stop() {
      if (!stopped) {
        stopped = true;
        teardown?.();
      }
      await ready;
      const out = new Float32Array(samples);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
  };
}
