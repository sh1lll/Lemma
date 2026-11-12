/**
 * End-of-speech patience for voice input.
 *
 * Recognizers often call a phrase "final" while the speaker is only drawing breath ("twelve plus" … "eight"), and
 * some browsers send many short finals for one sentence. The gate below holds each final for a short pause and joins
 * whatever follows inside that pause into the same phrase, so a phrase is used only once the speaker has finished.
 * The pause is longer when the words so far clearly need more ("plus", "divided by", "twenty", an open bracket).
 */

export type Patience = 'short' | 'normal' | 'long';

/** How long to wait after the speaker stops, per the "Wait after I stop" setting. */
export const PATIENCE_MS: Record<Patience, number> = { short: 500, normal: 900, long: 1500 };

export const patienceMs = (p: Patience | undefined): number => PATIENCE_MS[p ?? 'normal'] ?? PATIENCE_MS.normal;

/** Words a phrase rarely ends on: something more is coming. Includes tens and scale words ("twenty" → "twenty five"). */
const CONNECTOR_END =
  /(?:\b(?:plus|minus|times|multiplied(?: by)?|divided(?: by)?|over|by|of|and|or|to|into|in|from|as|the|a|an|is|are|what'?s|whats|what|equals?|equal to|power|root|log|sine?|cos(?:ine)?|tan(?:gent)?|point|negative|than|with|add|subtract|take away|mod(?:ulo)?|then|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)|[-+*/×÷^=(,·−])\s*$/i;

/** Words a continuation starts with: what follows belongs to the phrase before it. */
const CONTINUES_START =
  /^\s*(?:[-+*/×÷^=)%·−]|\d|(?:plus|minus|times|multiplied|divided|over|by|of|and|or|to|into|in|as|then|point|squared|cubed|percent|factorial|equals?|add|subtract|take away|mod(?:ulo)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|halves|quarters?|thirds?|fifths?|tenths?)\b)/i;

/** A continuation that is a fresh step on the previous result ("…times three" after "twelve plus eight"). */
const OPERATOR_START = /^\s*(?:[+*/×÷·]|(?:plus|minus|times|multiplied by|divided by|add|subtract|take away)\b)/i;

/** Already a calculation of its own (so a following "times 3" is a step on its result). */
const HAS_OPERATION = /[-+*/×÷^−]|\b(?:plus|minus|times|multiplied|divided|over|of|squared|cubed|root|percent|to|in)\b/i;

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ');

/** True when the words so far obviously need more (a trailing "plus", "of", "twenty", an unclosed bracket…). */
export function needsMore(text: string): boolean {
  const t = text.trim().replace(/[.!?]+$/g, '');
  if (!t) return false;
  const open = (t.match(/\(/g) ?? []).length - (t.match(/\)/g) ?? []).length;
  return open > 0 || CONNECTOR_END.test(t);
}

/** How long to wait after this text before using it. */
export function waitFor(text: string, base: number, long = Math.round(base * 1.8)): number {
  return needsMore(text) ? Math.max(long, base) : base;
}

/** Whether `next`, heard right after `prev`, belongs to the same phrase. */
export function continues(prev: string, next: string): boolean {
  const p = norm(prev);
  const n = norm(next);
  if (!p) return false;
  // Browsers that resend the whole phrase so far ("12 plus" then "12 plus 8"), or repeat it.
  if (n.startsWith(p)) return true;
  return needsMore(prev) || CONTINUES_START.test(next);
}

/**
 * Joins two pieces of one phrase. A fresh operator after a finished piece becomes a step on its result
 * ("12 plus 8" + "times 3" → "12 plus 8 then times 3" = 60, as said), not a change of precedence;
 * "what is twenty five" + "times four" is simply one phrase.
 */
export function joinPhrases(prev: string, next: string): string {
  const a = prev.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  if (norm(b).startsWith(norm(a))) return b;
  if (!needsMore(a) && OPERATOR_START.test(b) && HAS_OPERATION.test(a)) return `${a.replace(/[.!?,]+$/g, '')} then ${b}`;
  return `${a.replace(/[.!?]+$/g, '')} ${b}`;
}

export interface PhraseGateOptions {
  /** Pause after a final before using it (ms). */
  wait(): number;
  /** Pause when the words so far need more (ms). Defaults to 1.8 × wait. */
  longWait?(): number;
  /** The finished phrase. */
  commit(text: string): void;
  /** What has been heard so far (held phrase plus the words still coming), for display. */
  show?(text: string): void;
  /** Runs before a final is held: return true when it was a command handled on the spot (the gate does nothing else). */
  instant?(text: string): boolean;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

export class PhraseGate {
  private held = '';
  private timer: unknown = null;

  constructor(private readonly o: PhraseGateOptions) {}

  /** The phrase waiting for the speaker to finish ('' when none). */
  get pending(): string {
    return this.held;
  }

  /** Words still being heard. Speech continuing means the speaker hasn't finished: hold the phrase until the next final. */
  partial(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.held) {
      // A final is due shortly; if it never comes (the browser dropped it), use what was held.
      this.schedule(Math.max(2500, this.o.wait() * 3));
      this.o.show?.(joinPhrases(this.held, t));
    } else this.o.show?.(t);
  }

  final(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.o.instant?.(t)) return;
    if (this.held && continues(this.held, t)) this.held = joinPhrases(this.held, t);
    else {
      // Something new: the held phrase was complete.
      this.flush();
      this.held = t;
    }
    this.o.show?.(this.held);
    const base = this.o.wait();
    this.schedule(waitFor(this.held, base, this.o.longWait?.() ?? Math.round(base * 1.8)));
  }

  /** Uses the held phrase now. */
  flush(): void {
    this.clear();
    const t = this.held;
    this.held = '';
    if (t) this.o.commit(t);
  }

  /** Drops the held phrase without using it. Returns what was dropped. */
  cancel(): string {
    this.clear();
    const t = this.held;
    this.held = '';
    return t;
  }

  private schedule(ms: number) {
    this.clear();
    this.timer = (this.o.setTimer ?? ((f, m) => setTimeout(f, m)))(() => {
      this.timer = null;
      this.flush();
    }, ms);
  }

  private clear() {
    if (this.timer !== null) (this.o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }
}
