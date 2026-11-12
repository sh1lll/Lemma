/**
 * Provider-independent speech. The app talks only to these interfaces, so a Whisper/WASM or native
 * recogniser can replace the Web Speech implementation without touching UI code.
 */

export interface RecognitionHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onEnd(): void;
  onError(message: string): void;
  /** Progress such as model download; empty string clears it. */
  onStatus?(message: string): void;
  /** Loudness 0–1, for recognizers that hear the microphone themselves (browser recognition doesn't say). */
  onLevel?(level: number): void;
}

export interface RecognitionOptions {
  lang: string;
  continuous: boolean;
  preferOnDevice: boolean;
  /** How long a pause ends a phrase, for recognizers that decide that themselves (on-device). Default 900 ms. */
  patienceMs?: number;
}

export interface SpeechRecognizer {
  readonly id: string;
  readonly supported: boolean;
  /** Human-readable note about where audio is processed, shown in Settings. */
  readonly privacyNote: string;
  start(opts: RecognitionOptions, h: RecognitionHandlers): void;
  stop(): void;
}

export interface SpeechSynth {
  readonly supported: boolean;
  speak(text: string, opts: { lang: string; rate: number }): void;
  cancel(): void;
}

// Minimal typings: the Web Speech recognition API is not in lib.dom for every TS version.
interface WSRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type WSCtor = new () => WSRecognition;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in your browser’s site settings.',
  'service-not-allowed': 'Speech recognition is disabled in this browser.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser’s speech service is unreachable. Calculation still works offline; type instead.',
  'language-not-supported': 'This language isn’t available for voice input.',
};

export class WebSpeechRecognizer implements SpeechRecognizer {
  readonly id = 'web-speech';
  private readonly Ctor: WSCtor | undefined;
  private rec: WSRecognition | null = null;

  constructor() {
    const w = globalThis as unknown as { SpeechRecognition?: WSCtor; webkitSpeechRecognition?: WSCtor };
    this.Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  }

  get supported(): boolean {
    return !!this.Ctor;
  }

  get privacyNote(): string {
    return this.Ctor
      ? 'Your browser listens. Some browsers send audio to their maker to understand it. Lemma never keeps audio.'
      : 'This browser can’t listen. Typing works everywhere.';
  }

  start(opts: RecognitionOptions, h: RecognitionHandlers, allowOnDevice = true): void {
    if (!this.Ctor) return h.onError('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari.');
    this.stop();
    const rec = new this.Ctor();
    rec.lang = opts.lang;
    rec.continuous = opts.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const onDevice = allowOnDevice && opts.preferOnDevice && 'processLocally' in rec;
    if (onDevice) rec.processLocally = true;

    let retried = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) h.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      if (interim) h.onPartial(interim.trim());
    };
    rec.onerror = (e) => {
      if (onDevice && (e.error === 'language-not-supported' || e.error === 'service-not-allowed')) {
        // On-device model not installed for this language: fall back to the browser default once.
        retried = true;
        this.start(opts, h, false);
        return;
      }
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      h.onError(ERRORS[e.error] ?? `Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      if (retried) return;
      if (this.rec === rec) this.rec = null;
      h.onEnd();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      h.onError(err instanceof Error ? err.message : 'Could not start voice input');
    }
  }

  stop(): void {
    this.rec?.stop();
    this.rec = null;
  }
}

export class BrowserSynth implements SpeechSynth {
  get supported(): boolean {
    return 'speechSynthesis' in globalThis;
  }

  speak(text: string, opts: { lang: string; rate: number }): void {
    if (!this.supported) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang;
    u.rate = opts.rate;
    speechSynthesis.speak(u);
  }

  cancel(): void {
    if (this.supported) speechSynthesis.cancel();
  }
}
