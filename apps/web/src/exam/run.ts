import { engine, sectionIdOf } from './engine';
import { history, RUN_STORAGE_KEY, runStore, type SavedRun } from './store';
import type { Attempt, Exam, ExamQuestion, Result, Section } from './types';

/**
 * One sitting of an exam, independent of how the room looks: section flow (adaptive routing, breaks,
 * locks), timers and warnings, answers/flags/eliminations, highlights and work, autosave and resume.
 * Rooms render from it and call its methods; it calls back when something changes.
 */

export type Phase = 'intro' | 'section' | 'review' | 'break' | 'done';

export interface Mark {
  s: number;
  e: number;
  note?: string;
}

export interface RunState {
  phase: Phase;
  sec: number; // index into attempt.sectionOrder
  q: number; // index into the current section's questions
  left: Record<string, number>; // ms remaining per timed section
  breakLeft: number;
  shown: Record<string, string[]>; // question ids per section once routed
  done: string[]; // sections submitted
  timedOut: string[];
  timerHidden: boolean;
  warned: string[];
  marks: Record<string, Mark[]>;
  work: Record<string, string>;
  drawings: Record<string, string>;
  paused: boolean;
  directions: boolean; // show the section directions on entry
  /** Section being revisited under the current section's `returnTo` rule (its clock keeps running). */
  visit?: string | null;
}

export interface RunEvents {
  render(): void;
  tick(): void;
  warn(message: string): void;
  notice(message: string): void;
  finish(result: Result): void;
  /** Another tab took over this sitting, or finished/discarded it; this tab has stopped. */
  elsewhere(reason: 'taken' | 'gone'): void;
}

const TICK_MS = 500;
const SAVE_EVERY_MS = 3000;
export const LAST_MINUTES_MS = 5 * 60_000;

export class ExamRun {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = Date.now();
  private lastSave = 0;
  private dirty = false;
  private onHide = () => this.save();
  private onVis = () => {
    if (document.visibilityState === 'hidden') this.save();
  };
  /** This tab's claim on the saved sitting (one tab runs an exam at a time). */
  readonly tab = Math.random().toString(36).slice(2, 10);
  private claimed = false;
  /** Set when another tab took over or the saved sitting was finished/discarded elsewhere. */
  inactive = false;
  private onStorage = (e: StorageEvent) => {
    if (e.key !== RUN_STORAGE_KEY && e.key !== null) return;
    this.checkOwner();
  };
  ev: RunEvents;

  constructor(
    readonly exam: Exam,
    readonly attempt: Attempt,
    readonly st: RunState,
    ev: Partial<RunEvents> = {},
  ) {
    this.ev = { render() {}, tick() {}, warn() {}, notice() {}, finish() {}, elsewhere() {}, ...ev };
  }

  static create(exam: Exam): ExamRun {
    const first = exam.profile.sections[0];
    if (!first) throw new Error('This exam has no sections.');
    const attempt: Attempt = { examId: exam.id, startedAt: Date.now(), answers: {}, flagged: [], eliminated: {}, timeSpent: {}, sectionOrder: [] };
    const left: Record<string, number> = {};
    for (const s of exam.profile.sections) if (s.minutes !== null && s.minutes > 0) left[s.id] = s.minutes * 60_000;
    const st: RunState = {
      phase: 'intro',
      sec: 0,
      q: 0,
      left,
      breakLeft: 0,
      shown: {},
      done: [],
      timedOut: [],
      timerHidden: exam.profile.rules.showTimer === 'last5',
      warned: [],
      marks: {},
      work: {},
      drawings: {},
      paused: false,
      directions: true,
    };
    const run = new ExamRun(exam, attempt, st);
    const r = engine.route(exam, attempt, first);
    st.shown[first.id] = r.ids;
    attempt.sectionOrder.push(r.entry);
    return run;
  }

  static fromSaved(saved: SavedRun<RunState>): ExamRun {
    return new ExamRun(saved.exam, saved.attempt, saved.st);
  }

  // ---- lifecycle

  start(): void {
    this.last = Date.now();
    this.lastSave = this.last;
    // Opening (or resuming) a sitting here takes it over from any other tab, which then stops.
    this.claim();
    if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
    addEventListener('pagehide', this.onHide);
    addEventListener('storage', this.onStorage);
    document.addEventListener('visibilitychange', this.onVis);
  }

  destroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    removeEventListener('pagehide', this.onHide);
    removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.onVis);
    if (this.st.phase !== 'done') this.save();
  }

  /** Writes this sitting as owned by this tab, whatever is stored. */
  claim(): void {
    if (this.st.phase === 'done') return;
    this.inactive = false;
    this.claimed = runStore.save(this.exam, this.attempt, this.st, this.tab);
    this.lastSave = Date.now();
    this.dirty = false;
  }

  /**
   * Autosave. Only the tab that owns the sitting writes: if another tab took it over, or it was finished or
   * discarded elsewhere (or another exam was started), saving would overwrite that tab's answers or bring a
   * finished exam back, so this tab stops instead.
   */
  save(): void {
    if (this.st.phase === 'done' || this.inactive) return;
    if (this.claimed && !this.checkOwner()) return;
    this.claimed = runStore.save(this.exam, this.attempt, this.st, this.tab) || this.claimed;
    this.lastSave = Date.now();
    this.dirty = false;
  }

  /** True while this tab still owns the saved sitting; otherwise stops this tab and says why. */
  private checkOwner(): boolean {
    if (!this.claimed || this.inactive || this.st.phase === 'done') return !this.inactive;
    const cur = runStore.load<RunState>();
    const same = !!cur && cur.exam.id === this.exam.id && cur.attempt.startedAt === this.attempt.startedAt;
    if (same && (!cur!.owner || cur!.owner === this.tab)) return true;
    this.inactive = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.ev.elsewhere(same ? 'taken' : 'gone');
    return false;
  }

  private changed(): void {
    this.dirty = true;
  }

  // ---- what is where

  get profile() {
    return this.exam.profile;
  }

  get section(): Section {
    const id = sectionIdOf(this.attempt.sectionOrder[this.st.sec] ?? '');
    return this.profile.sections.find((s) => s.id === id) ?? this.profile.sections[0]!;
  }

  get sectionIndex(): number {
    return this.profile.sections.indexOf(this.section);
  }

  /**
   * The section whose questions are on screen: normally the current one; while revisiting an earlier part under
   * the current section's `returnTo` rule, that part (the clock, hand-in and limits stay the current section's).
   */
  get viewSection(): Section {
    const id = this.st.visit;
    if (id && this.returnTarget()?.id === id) return this.profile.sections.find((s) => s.id === id)!;
    return this.section;
  }

  /** True while revisiting an earlier part on this section's clock. */
  get visiting(): boolean {
    return this.viewSection !== this.section;
  }

  /** The earlier part this section lets the student go back to right now, if any (it must have been handed in). */
  returnTarget(): Section | null {
    const rt = this.section.returnTo;
    if (!rt || (this.st.phase !== 'section' && this.st.phase !== 'review')) return null;
    const target = this.profile.sections.find((s) => s.id === rt.section);
    return target && target !== this.section && this.st.done.includes(target.id) ? target : null;
  }

  /** Whether the calculator may be used on what's on screen (a revisited part can be stricter than the section). */
  calculatorAllowed(): boolean {
    if (!this.section.calculator) return false;
    return this.visiting ? !!this.section.returnTo?.calculator : true;
  }

  /** Goes back to the earlier part's questions; this section's clock keeps running. */
  visitReturn(): void {
    const target = this.returnTarget();
    if (!target || this.visiting) return;
    this.st.visit = target.id;
    this.st.q = 0;
    this.st.phase = 'section';
    this.changed();
    this.ev.render();
  }

  /** Back from the revisited part to the current section's questions. */
  leaveReturn(): void {
    if (!this.st.visit) return;
    this.st.visit = null;
    this.st.q = 0;
    this.st.phase = 'section';
    this.changed();
    this.ev.render();
  }

  ids(section: Section = this.viewSection): string[] {
    return this.st.shown[section.id] ?? section.questionIds;
  }

  get qid(): string {
    return this.ids()[this.st.q] ?? this.ids()[0] ?? '';
  }

  question(id: string = this.qid): ExamQuestion | undefined {
    return this.exam.questions.find((q) => q.id === id);
  }

  questions(section: Section = this.viewSection): ExamQuestion[] {
    return this.ids(section)
      .map((id) => this.question(id))
      .filter((q): q is ExamQuestion => !!q);
  }

  answered(id: string): boolean {
    const a = this.attempt.answers[id];
    if (a === undefined) return false;
    if (typeof a === 'string') return a.trim() !== '';
    if (Array.isArray(a)) return a.length > 0;
    return Object.values(a).some((v) => v.trim() !== '');
  }

  flagged(id: string): boolean {
    return this.attempt.flagged.includes(id);
  }

  eliminated(id: string): string[] {
    return this.attempt.eliminated[id] ?? [];
  }

  /** ms left in the current section, or null when it is untimed. */
  timeLeft(section: Section = this.section): number | null {
    const v = this.st.left[section.id];
    return v === undefined ? null : Math.max(0, v);
  }

  timerVisible(): boolean {
    const left = this.timeLeft();
    if (left === null) return false;
    if (this.profile.rules.showTimer === 'always') return true;
    return !this.st.timerHidden || left <= LAST_MINUTES_MS;
  }

  canHideTimer(): boolean {
    const left = this.timeLeft();
    return this.profile.rules.showTimer !== 'always' && left !== null && left > LAST_MINUTES_MS;
  }

  /** Can the student step back into the section before this one? */
  canReturnToPrevious(): boolean {
    if (this.st.sec === 0) return false;
    const prevId = sectionIdOf(this.attempt.sectionOrder[this.st.sec - 1] ?? '');
    const prev = this.profile.sections.find((s) => s.id === prevId);
    return !!prev && prev.canReturn && !this.st.timedOut.includes(prev.id) && (this.timeLeft(prev) ?? 1) > 0;
  }

  get isLastSection(): boolean {
    return this.sectionIndex >= this.profile.sections.length - 1;
  }

  // ---- actions

  begin(): void {
    if (this.st.phase !== 'intro') return;
    this.enterSection();
    this.st.phase = 'section';
    this.save();
    this.ev.render();
  }

  private enterSection(): void {
    const s = this.section;
    const left = this.timeLeft(s);
    // Warnings at or above the section's length would fire immediately; skip them.
    if (left !== null) for (const w of this.profile.rules.warnAtMinutes) if (w * 60_000 >= left) this.st.warned.push(`${s.id}:${w}`);
    this.st.directions = true;
    this.last = Date.now();
  }

  go(index: number): void {
    const n = this.ids().length;
    this.st.q = Math.max(0, Math.min(n - 1, index));
    this.st.phase = 'section';
    this.changed();
    this.ev.render();
  }

  goId(id: string): void {
    const i = this.ids().indexOf(id);
    if (i >= 0) this.go(i);
  }

  next(): void {
    if (this.st.phase === 'review') return;
    if (this.st.q < this.ids().length - 1) this.go(this.st.q + 1);
    else this.review();
  }

  back(): void {
    if (this.st.phase === 'review') return this.go(this.ids().length - 1);
    if (this.st.q > 0) return this.go(this.st.q - 1);
    if (this.visiting) return;
    if (this.canReturnToPrevious()) {
      this.st.sec--;
      this.st.q = this.ids().length - 1;
      this.st.phase = 'section';
      this.changed();
      this.ev.render();
    }
  }

  review(): void {
    this.st.phase = 'review';
    this.changed();
    this.ev.render();
  }

  setAnswer(id: string, value: Attempt['answers'][string] | undefined): void {
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete this.attempt.answers[id];
    else this.attempt.answers[id] = value;
    this.changed();
  }

  setPart(id: string, label: string, value: string): void {
    const cur = this.attempt.answers[id];
    const obj = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur } : {};
    if (value.trim()) obj[label] = value;
    else delete obj[label];
    this.setAnswer(id, Object.keys(obj).length ? obj : undefined);
  }

  toggleFlag(id: string = this.qid): boolean {
    const i = this.attempt.flagged.indexOf(id);
    if (i >= 0) this.attempt.flagged.splice(i, 1);
    else this.attempt.flagged.push(id);
    this.changed();
    return i < 0;
  }

  toggleEliminate(id: string, choice: string): boolean {
    const list = [...this.eliminated(id)];
    const i = list.indexOf(choice);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(choice);
      // Crossing out the selected choice deselects it, as on screen-based tests.
      const a = this.attempt.answers[id];
      if (a === choice) this.setAnswer(id, undefined);
      if (Array.isArray(a) && a.includes(choice)) this.setAnswer(id, a.filter((x) => x !== choice));
    }
    if (list.length) this.attempt.eliminated[id] = list;
    else delete this.attempt.eliminated[id];
    this.changed();
    return i < 0;
  }

  setMarks(id: string, marks: Mark[]): void {
    if (marks.length) this.st.marks[id] = marks;
    else delete this.st.marks[id];
    this.changed();
  }

  setWork(id: string, text: string): void {
    if (text) this.st.work[id] = text;
    else delete this.st.work[id];
    this.changed();
  }

  setDrawing(id: string, dataUrl: string | null): void {
    if (dataUrl) this.st.drawings[id] = dataUrl;
    else delete this.st.drawings[id];
    this.changed();
    this.save();
  }

  toggleTimer(): void {
    if (!this.canHideTimer()) return;
    this.st.timerHidden = !this.st.timerHidden;
    this.changed();
    this.ev.tick();
  }

  setPaused(p: boolean): void {
    if (p && !this.profile.rules.allowPause) return;
    this.st.paused = p;
    this.last = Date.now();
    this.save();
    this.ev.render();
  }

  dismissDirections(): void {
    this.st.directions = false;
    this.changed();
  }

  /**
   * Hand in the current section. Auto-submits pass `auto` so the student is told why. A confirmation dialog
   * passes the id of the section it asked about: if that section is no longer the one in progress (time ran
   * out while the dialog was open), nothing happens, so a stale "Continue" can't hand in the next part.
   */
  submitSection(auto = false, sectionId?: string): void {
    if (this.st.phase === 'done' || this.st.phase === 'intro' || this.st.phase === 'break') return;
    if (sectionId !== undefined && sectionId !== this.section.id) return;
    // Handing in (or running out of time) ends any revisit along with the section.
    this.st.visit = null;
    const s = this.section;
    if (!this.st.done.includes(s.id)) this.st.done.push(s.id);
    if (auto && !this.st.timedOut.includes(s.id)) this.st.timedOut.push(s.id);
    const nextSection = this.profile.sections[this.sectionIndex + 1];
    if (!nextSection) return this.finish();
    // Already visited (we came back into an earlier section): just move forward again.
    const visited = this.attempt.sectionOrder.findIndex((e) => sectionIdOf(e) === nextSection.id);
    if (visited >= 0) {
      this.st.sec = visited;
      this.st.q = 0;
      this.st.phase = 'section';
      this.save();
      return this.ev.render();
    }
    if (s.breakAfterMinutes && s.breakAfterMinutes > 0) {
      this.st.phase = 'break';
      this.st.breakLeft = s.breakAfterMinutes * 60_000;
      this.save();
      return this.ev.render();
    }
    this.advance();
  }

  endBreak(): void {
    if (this.st.phase !== 'break') return;
    this.advance();
  }

  private advance(): void {
    const nextSection = this.profile.sections[this.sectionIndex + 1];
    if (!nextSection) return this.finish();
    const r = engine.route(this.exam, this.attempt, nextSection);
    this.st.shown[nextSection.id] = r.ids;
    this.attempt.sectionOrder.push(r.entry);
    this.st.sec = this.attempt.sectionOrder.length - 1;
    this.st.q = 0;
    this.st.phase = 'section';
    this.enterSection();
    this.save();
    this.ev.render();
  }

  finish(): void {
    if (this.st.phase === 'done' || this.inactive || !this.checkOwner()) return;
    this.attempt.finishedAt = Date.now();
    this.st.phase = 'done';
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const result = engine.grade(this.exam, this.attempt);
    history.add(this.exam, this.attempt, result);
    runStore.clear();
    this.ev.finish(result);
  }

  // ---- clock

  tick(): void {
    if (this.inactive) return;
    const now = Date.now();
    const dt = Math.max(0, now - this.last);
    this.last = now;
    const st = this.st;
    if ((st.phase === 'section' || st.phase === 'review') && !st.paused) {
      const s = this.section;
      if (st.phase === 'section' && this.qid) this.attempt.timeSpent[this.qid] = (this.attempt.timeSpent[this.qid] ?? 0) + dt;
      const left = st.left[s.id];
      if (left !== undefined) {
        st.left[s.id] = left - dt;
        const now = Math.max(0, left - dt);
        for (const w of [...this.profile.rules.warnAtMinutes].sort((a, b) => a - b)) {
          const key = `${s.id}:${w}`;
          if (now <= w * 60_000 && !st.warned.includes(key)) {
            // Only the most urgent crossing is announced when several pass at once.
            for (const v of this.profile.rules.warnAtMinutes) if (v >= w) st.warned.push(`${s.id}:${v}`);
            this.ev.warn(`${w} minute${w === 1 ? '' : 's'} remaining in ${s.title}.`);
            break;
          }
        }
        if (now <= 0) {
          this.ev.notice(this.isLastSection ? `Time is up. Your answers were submitted.` : `Time is up for ${s.title}. Your answers were submitted.`);
          this.submitSection(true);
          return;
        }
      }
      this.dirty = true;
    } else if (st.phase === 'break') {
      st.breakLeft -= dt;
      if (st.breakLeft <= 0) {
        st.breakLeft = 0;
        this.endBreak();
        return;
      }
      this.dirty = true;
    }
    if (this.dirty && now - this.lastSave >= SAVE_EVERY_MS) this.save();
    this.ev.tick();
  }
}

/** Ask for full screen from a click; returns false (and the room stays a full-window overlay) when refused. */
export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  if (document.fullscreenElement) return true;
  const req = el.requestFullscreen?.bind(el) ?? (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(el);
  if (!req) return false;
  try {
    await req();
    return true;
  } catch {
    return false;
  }
}

export function exitFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
