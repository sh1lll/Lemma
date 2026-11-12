import type { RecognitionHandlers, RecognitionOptions, SpeechRecognizer } from '../speech';
import type { WorkerIn, WorkerOut } from './worker';
import { waitFor } from '../patience';

/**
 * On-device recognition: microphone → AudioWorklet → 16 kHz PCM → energy VAD → Whisper in a worker.
 * While the user speaks, the growing clip is re-transcribed about once a second for live partials;
 * a pause ends the utterance and produces the final text. The pause is the "Wait after I stop" setting, longer when
 * the words heard so far clearly need more ("twelve plus…").
 */

const RATE = 16000;
/** Default pause that ends an utterance; 600 ms cut people off mid-phrase. */
const END_SILENCE_MS = 900;
/** Final transcription starts speculatively this early in a pause, so it is usually done when the pause is confirmed. */
const SPECULATE_MS = 200;
const NO_SPEECH_TIMEOUT_MS = 8000;
const MAX_UTTERANCE_MS = 15000;
const PARTIAL_EVERY_MS = 900;
const PRE_ROLL_MS = 300;

// Batches 128-sample render quanta into ~20 ms chunks to keep message traffic low.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('lemma-tap', Tap);
`;

function clean(text: string): string {
  // Whisper marks non-speech as [BLANK_AUDIO], (music), etc.
  return text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, '').replace(/\s+/g, ' ').trim();
}

class Pcm {
  private chunks: Float32Array[] = [];
  length = 0;
  push(c: Float32Array) {
    this.chunks.push(c);
    this.length += c.length;
  }
  slice(from: number): Float32Array {
    const out = new Float32Array(this.length - from);
    let o = 0;
    let pos = 0;
    for (const c of this.chunks) {
      const end = pos + c.length;
      if (end > from) {
        const s = Math.max(0, from - pos);
        out.set(c.subarray(s), o);
        o += c.length - s;
      }
      pos = end;
    }
    return out;
  }
}

export class WhisperRecognizer implements SpeechRecognizer {
  readonly id = 'whisper';
  readonly privacyNote = 'Heard on this device; audio never leaves it. A 40 MB voice model downloads once, then voice works offline.';

  private worker: Worker | null = null;
  private ready = false;
  private loadWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private nextId = 1;
  private pending = new Map<number, (text: string | null) => void>();
  private statusCb: ((s: string) => void) | null = null;
  private session: { stop(final: boolean): void } | null = null;

  get supported(): boolean {
    return typeof Worker !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';
  }

  /** Starts downloading/compiling the model ahead of the first use. */
  preload(onStatus?: (s: string) => void): void {
    if (onStatus) this.statusCb = onStatus;
    this.ensureWorker();
  }

  /** Downloads and compiles the model if needed; resolves once it can transcribe. */
  whenReady(onStatus?: (s: string) => void): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.loadWaiters.push({ resolve, reject });
      this.preload(onStatus);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') this.statusCb?.(`Downloading speech model… ${m.percent}%`);
      else if (m.type === 'ready') {
        this.ready = true;
        this.statusCb?.('');
        for (const w of this.loadWaiters.splice(0)) w.resolve();
      } else if (m.type === 'result') {
        this.pending.get(m.id)?.(m.text);
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        if (m.id !== undefined) {
          this.pending.get(m.id)?.(null);
          this.pending.delete(m.id);
        }
        this.statusCb?.(`Speech model error: ${m.message}`);
        if (m.id === undefined) for (const w of this.loadWaiters.splice(0)) w.reject(new Error(m.message));
      }
    };
    w.postMessage({ type: 'load' } satisfies WorkerIn);
    this.worker = w;
    return w;
  }

  private transcribe(audio: Float32Array): Promise<string | null> {
    const id = this.nextId++;
    const p = new Promise<string | null>((resolve) => this.pending.set(id, resolve));
    this.ensureWorker().postMessage({ type: 'transcribe', id, audio } satisfies WorkerIn, [audio.buffer]);
    return p;
  }

  start(opts: RecognitionOptions, h: RecognitionHandlers): void {
    this.stop();
    this.statusCb = h.onStatus ?? null;
    this.ensureWorker();
    if (!this.ready) h.onStatus?.('Preparing on-device speech…');
    void this.run(opts, h);
  }

  stop(): void {
    this.session?.stop(true);
    this.session = null;
  }

  private async run(opts: RecognitionOptions, h: RecognitionHandlers): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      h.onError(name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your system or browser settings.' : name === 'NotFoundError' ? 'No microphone was found.' : 'Could not open the microphone.');
      h.onEnd();
      return;
    }

    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, 'lemma-tap');
    src.connect(tap);

    const ratio = ctx.sampleRate / RATE;
    let pcm = new Pcm();
    let carry = 0; // fractional read position carried between chunks for resampling
    let floor = 0.004;
    let voiced = 0;
    let speechStart = -1;
    let lastVoice = 0;
    let startedAt = performance.now();
    let partialBusy = false;
    let lastPartial = 0;
    let finishing = false;
    let closed = false;
    let spec: { voiceAt: number; text: Promise<string | null> } | null = null;
    /** Latest live transcript of this utterance: a trailing "plus" or "of" means wait longer before ending it. */
    let heard = '';
    const endSilence = () => waitFor(heard, opts.patienceMs ?? END_SILENCE_MS);
    const clipFromSpeech = () => pcm.slice(Math.max(0, speechStart - (PRE_ROLL_MS * RATE) / 1000));

    const close = () => {
      if (closed) return;
      closed = true;
      tap.port.onmessage = null;
      src.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (this.session === control) this.session = null;
      h.onEnd();
    };

    const resetUtterance = () => {
      pcm = new Pcm();
      carry = 0;
      voiced = 0;
      speechStart = -1;
      startedAt = performance.now();
      finishing = false;
      spec = null;
      heard = '';
    };

    const finish = async () => {
      if (finishing) return;
      finishing = true;
      if (speechStart < 0) {
        if (!opts.continuous) close();
        else resetUtterance();
        return;
      }
      // Reuse the speculative transcription if no speech arrived after it started.
      const pendingText = spec && spec.voiceAt === lastVoice ? spec.text : this.transcribe(clipFromSpeech());
      if (!opts.continuous) {
        // Release the mic immediately; transcription doesn't need it.
        tap.port.onmessage = null;
        stream.getTracks().forEach((t) => t.stop());
      }
      const text = clean((await pendingText) ?? '');
      if (text) h.onFinal(text);
      if (opts.continuous && !closed) resetUtterance();
      else close();
    };

    const control = {
      stop: (final: boolean) => {
        if (final && speechStart >= 0 && !finishing) {
          opts = { ...opts, continuous: false };
          void finish();
        } else close();
      },
    };
    this.session = control;

    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (finishing) return;
      const input = e.data;
      // Linear resample to 16 kHz.
      const n = Math.ceil((input.length - carry) / ratio);
      const out = new Float32Array(Math.max(0, n));
      let sum = 0;
      for (let i = 0; i < out.length; i++) {
        const x = carry + i * ratio;
        const j = Math.floor(x);
        const f = x - j;
        const v = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? input[j] ?? 0) * f;
        out[i] = v;
        sum += v * v;
      }
      carry = carry + out.length * ratio - input.length;
      pcm.push(out);

      const now = performance.now();
      const rms = Math.sqrt(sum / Math.max(1, out.length));
      h.onLevel?.(Math.min(1, rms * 12));
      const threshold = Math.max(0.012, floor * 3);
      if (rms > threshold) {
        voiced++;
        lastVoice = now;
        if (voiced >= 2 && speechStart < 0) speechStart = Math.max(0, pcm.length - out.length * 2);
      } else {
        voiced = 0;
        // Track background noise only while not speaking.
        if (speechStart < 0) floor = floor * 0.95 + rms * 0.05;
      }

      if (speechStart >= 0) {
        if (now - lastVoice > endSilence() || now - startedAt > MAX_UTTERANCE_MS) return void finish();
        if (now - lastVoice > SPECULATE_MS) {
          if (this.ready && spec?.voiceAt !== lastVoice) {
            const s = { voiceAt: lastVoice, text: this.transcribe(clipFromSpeech()) };
            spec = s;
            // The words up to this pause decide how long the pause must be ("twelve plus" waits longer).
            void s.text.then((t) => {
              const c = clean(t ?? '');
              if (c && spec === s) heard = c;
            });
          }
          return;
        }
        if (this.ready && !partialBusy && now - lastPartial > PARTIAL_EVERY_MS) {
          partialBusy = true;
          lastPartial = now;
          void this.transcribe(clipFromSpeech()).then((t) => {
            partialBusy = false;
            const text = clean(t ?? '');
            if (text && !finishing) {
              heard = text;
              h.onPartial(text);
            }
          });
        }
      } else if (now - startedAt > NO_SPEECH_TIMEOUT_MS && !opts.continuous) {
        close();
      }
    };
  }
}
