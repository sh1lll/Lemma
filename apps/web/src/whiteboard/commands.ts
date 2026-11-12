import type { Board, ObjId, Point } from './engine';
import { normalize } from '@lemma/math-core';
import { splitMath } from '../notes';

/**
 * What you say (or type) on the whiteboard, done on the whiteboard. Deterministic: math is solved by Lemma's
 * own engines (worked steps where it can show them), never guessed. Returns a short line for the status bar.
 *
 *   "solve 2x + 3 = 11 and circle the answer"   question, steps, answer, circled
 *   "derivative of x^3 sin x, just the answer"   question and answer only
 *   "graph sin x and x^2/4"                      a plot
 *   "write the chain rule is f'(g(x))·g'(x)"     text, math typeset
 *   "draw a number line from -5 to 5"            shapes, axes, number lines
 *   "circle that", "box the answer", "underline it", "check it", "cross it out"
 *   "make it bigger", "make that a lot smaller", "make it twice as big", "label it triangle ABC"
 *   "draw a right triangle", "draw a circle with radius 5", "draw a 6 by 3 rectangle"
 *   "put the answer there"                       answers the selected (or last) question in place
 *   "move it left", "erase that", "undo", "redo", "zoom in", "show everything", "clear the board"
 *
 * Like a person at a whiteboard, it follows a run of instructions one at a time and keeps working on the line it
 * just wrote:
 *   "write x^2 - 5x + 6, then factor it, then circle it"      three steps, in order
 *   "add 3 to both sides", "divide by 2", "plug in x = 4"     the next line of working, with a note beside it
 *   "next one", "I'm going to go to the next one"             a fresh spot below everything, for a new problem
 *   "below that, write …", "next to it, draw a circle"        where to put the next thing
 *   "3x + 3"                                                  written as it is (nothing to work out)
 *   "um", "okay", "let me think"                              ignored
 */

export interface CommandDeps {
  /** Worked steps for a question, if Lemma can show them. */
  worked(query: string): Promise<{ question: string; questionTex?: string; steps: { text: string; tex?: string }[]; answer: { display: string; tex?: string } } | null>;
  /** The calculator's answer as display text, or an error message. */
  compute(query: string): Promise<{ ok: true; display: string } | { ok: false; message: string }>;
  toTex(plain: string): string;
}

type MarkStyle = 'circle' | 'box' | 'underline' | 'highlight' | 'check' | 'strike';

/** What this layer placed, so "that", "the answer" and "put the answer there" can refer back to it. */
interface Placed {
  kind: 'question' | 'answer' | 'text' | 'math' | 'graph' | 'shape' | 'mark' | 'group';
  query?: string;
}

export class BoardCommands {
  private placed = new Map<ObjId, Placed>();
  private lastAnswer: ObjId | null = null;
  /** The answer inside each solved group: "circle it" right after solving circles the answer, not the working. */
  private answerOf = new Map<ObjId, ObjId>();
  private lastQuestion: { id: ObjId; query: string } | null = null;
  /** The line being worked on: "factor it", "add 3 to both sides" and "plug in x = 2" continue under it. */
  private current: { id: ObjId; expr: string } | null = null;
  /** Where the next thing goes, when the last instruction said ("next one", "below that"). Used once. */
  private nextAt: Point | null = null;

  constructor(
    private board: Board,
    private deps: CommandDeps,
  ) {}

  /** Carries out everything said, one instruction at a time, in order. Returns what the last ones did. */
  async run(raw: string): Promise<string> {
    const done: string[] = [];
    for (const step of splitSteps(raw)) {
      const r = await this.step(step);
      if (r) done.push(r);
    }
    return done.slice(-3).join(' · ');
  }

  private async step(raw: string): Promise<string> {
    // Leading filler ("okay", "can you", "please") goes from both the lower-cased command and the original
    // wording, which is what gets written or solved.
    const said = raw
      .trim()
      .replace(/^(?:(?:ok(?:ay)?|hey|so|now|and|then|please|can you|could you|would you|i want you to|let'?s)[\s,]+)+/i, '')
      .replace(/[\s,]+please[.!?]*$/i, '')
      .replace(/(?:[\s,]+(?:and|then|so|also|um+|uh+))+[.!?,]*$/i, '')
      .trim();
    const t = said
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .trim();
    // Stray words between instructions ("and", "so then", "uh okay") are not instructions.
    if (!t || FILLER.test(t) || t.split(/[\s,]+/).every((w) => CONNECTIVES.has(w))) return '';

    // ---- where to work next: "next one", "new line", "below that, …" ----
    if (NEXT_PROBLEM.test(t) && !/\d|=/.test(t) && !looksMathy(t)) return this.newProblem();
    if (/^(?:(?:go to |start |on )?(?:the |a )?(?:next|new) line|skip a line|leave (?:a )?(?:space|gap)(?: below)?)$/.test(t)) return this.newLine();
    const where = placeHint(said);
    if (where) {
      const id = this.target();
      const b = id ? this.board.bounds(id) : null;
      if (b) this.nextAt = where.dir === 'right' ? { x: b.x + b.w + 60, y: b.y } : where.dir === 'above' ? { x: b.x, y: b.y - 120 } : { x: b.x, y: b.y + b.h + 40 };
      if (!where.rest) return b ? 'Ready' : '';
      return this.step(where.rest);
    }

    // ---- board control ----
    if (/^(?:undo|scratch that|take that back|go back|never ?mind)(?: (?:that|it|the last (?:one|thing|step)))?$/.test(t)) return this.board.undo(), 'Undone';
    if (/^redo(?: (?:that|it))?$/.test(t)) return this.board.redo(), 'Redone';
    if (/^(?:clear|wipe|erase|clean|delete|remove)(?: the| my)? (?:board|whiteboard|everything|all)$|^(?:start over|clear)$/.test(t)) {
      this.board.clear();
      this.placed.clear();
      this.answerOf.clear();
      this.lastAnswer = null;
      this.lastQuestion = null;
      this.current = null;
      this.nextAt = null;
      return 'Cleared. Say “undo” to bring it back';
    }
    if (/^(?:erase|delete|remove|rub out) (?:that|it|this|the last one|the last thing)$/.test(t)) {
      const id = this.target();
      if (!id) return 'Nothing to erase';
      this.board.remove(id);
      return 'Erased';
    }
    const zm = /^zoom (in|out)(?: (?:a (?:bit|little)(?: bit)?|slightly|a lot|more))?$/.exec(t);
    if (zm) {
      const f = /a lot/.test(t) ? 2 : /bit|little|slightly/.test(t) ? 1.15 : 1.4;
      return this.board.zoomBy(zm[1] === 'in' ? f : 1 / f), zm[1] === 'in' ? 'Zoomed in' : 'Zoomed out';
    }
    if (/^(?:reset (?:the )?zoom|zoom to 100(?: ?%| percent)?|actual size|normal size)$/.test(t)) {
      const z = this.board.camera?.().z;
      if (z) this.board.zoomBy(1 / z);
      return 'Zoom 100%';
    }
    if (/^(?:fit|show (?:me )?everything|zoom to fit|see everything|zoom out all the way)$/.test(t)) return this.board.fit(), 'Showing everything';
    const mv = /^move (?:it|that|this|the answer) (?:to the )?(left|right|up|down)(?: (?:a (?:lot|bit|little)(?: bit)?|slightly|more))?$/.exec(t);
    if (mv) {
      const id = /the answer/.test(t) ? (this.alive(this.lastAnswer) ?? this.target()) : this.target();
      if (!id) return 'Nothing to move';
      const d = /a lot/.test(t) ? 400 : /bit|little|slightly/.test(t) ? 60 : 180;
      const by: Point = { left: { x: -d, y: 0 }, right: { x: d, y: 0 }, up: { x: 0, y: -d }, down: { x: 0, y: d } }[mv[1] as 'left']!;
      this.board.move(id, by);
      return `Moved ${mv[1]}`;
    }

    // ---- size: "make it bigger", "make that a lot smaller", "make it twice as big", "shrink it" ----
    const sz = this.resize(t);
    if (sz) return sz;

    // ---- "label it triangle ABC", "label that x squared" ----
    const lb = /^(?:label|caption|name|title) (?:it|that|this|the answer|the (?:shape|graph|circle|triangle|square|rectangle|line|arrow))(?: (?:as|with|:)?\s*(.*))?$/.exec(t);
    if (lb) {
      // The label keeps the case it was said or typed in ("triangle ABC").
      const orig = said.replace(/[.!?]+$/, '');
      const body = (lb[1] ? orig.slice(orig.length - lb[1].length) : '').trim().replace(/^["“']|["”']$/g, '');
      if (!body) return 'Say the label, like “label it triangle ABC”';
      const id = /the answer/.test(t) ? (this.alive(this.lastAnswer) ?? this.target()) : this.target();
      if (!id) return 'Nothing to label yet';
      return this.label(id, body);
    }

    // ---- "cross it out", "cross out the answer", "strike that out" ----
    if (/^(?:cross|strike|scratch|x) (?:it|that|this|the answer|the result|the last one) (?:out|through|off)$|^(?:cross|strike) (?:out|through) (?:it|that|this|the answer|the result|the last one)$|^cross (?:it|that|this) off$/.test(t)) {
      let target = /answer|result/.test(t) ? (this.alive(this.lastAnswer) ?? this.target()) : this.target();
      if (target) target = this.alive(this.answerOf.get(target)) ?? target;
      if (!target) return 'Nothing to cross out';
      this.mark(target, 'strike');
      return DONE.strike;
    }

    // ---- marks: "circle that", "box the answer", "underline it" ----
    const mk =
      /^(circle|box|underline|highlight|check|tick|check ?mark)(?: (?:that|it|this|the answer|the result|the last one|answer))?(?: off)?$/.exec(t) ??
      /^(?:put|add|give it) an? (check|tick|check ?mark)(?: (?:on|next to|by) (?:that|it|this|the answer|the result))?$/.exec(t) ??
      // "draw a circle" is a shape; "draw a circle around it" marks.
      /^(?:put|add|draw) an? (circle|box|underline) (?:around|on|under) (?:that|it|this|the answer|the result)$/.exec(t);
    if (mk) {
      let target = /answer|result/.test(t) ? (this.alive(this.lastAnswer) ?? this.target()) : this.target();
      if (target) target = this.alive(this.answerOf.get(target)) ?? target;
      if (!target) return 'Nothing to mark yet';
      const style = styleOf(mk[1]!);
      this.mark(target, style);
      return DONE[style];
    }

    // ---- the next line of working on what was just written: "factor it", "add 3 to both sides" ----
    const fu = await this.followUp(t);
    if (fu) return fu;

    // ---- "put the answer there" / "what's the answer" ----
    if (/^(?:put|write|show|add) the answer(?: (?:there|here|next to it|below it|under it))?$|^what'?s the answer$|^answer (?:it|that)$|^solve (?:it|that|this)$/.test(t)) {
      const sel = this.board.selection()[0];
      const last = this.lastQuestion && this.alive(this.lastQuestion.id) ? this.lastQuestion : null;
      const q = (sel && this.placed.get(sel)?.query) ?? last?.query;
      const anchor = (sel && this.placed.get(sel)?.query ? sel : null) ?? last?.id ?? null;
      if (!q || !anchor) return 'Write or say a question first';
      return this.answerAt(q, anchor, 'circle');
    }

    // ---- shapes ----
    const shape = this.shape(t);
    if (shape) return shape;

    // ---- graphs ----
    const g = /^(?:graph|plot|sketch|draw)(?: (?:the|a) graph)?(?: of)?\s+(.+)$/.exec(t);
    if (g && (!/^draw\b/.test(t) || /^draw (?:the|a) graph/.test(t))) {
      let body = g[1]!;
      // "from -5 to 5", "for x from -5 to 5", "between -5 and 5": the x range.
      let xRange: [number, number] | undefined;
      const rg = /\s+(?:(?:for|with) x\s+)?(?:from (.+?) to (.+)|between (.+?) and (.+))$/.exec(body);
      if (rg) {
        const a = spokenNumber(rg[1] ?? rg[3]!);
        const b = spokenNumber(rg[2] ?? rg[4]!);
        if (a !== null && b !== null && a !== b) {
          xRange = [Math.min(a, b), Math.max(a, b)];
          body = body.slice(0, rg.index);
        }
      }
      const exprs = body
        .split(/\s*(?:,|\band\b)\s*/)
        .map((e) =>
          spokenMath(e.trim())
            // "y = 2x + 1", "f(x) = x^2": the right-hand side is what's plotted.
            .replace(/^(?:y|[a-z]\s*\(\s*x\s*\))\s*=\s*/, '')
            .trim(),
        )
        .filter(Boolean);
      if (!exprs.length) return 'Say what to graph, like “graph sin x”';
      const id = this.board.addGraph(exprs, { ...(xRange ? { xRange } : {}), ...this.place() });
      this.placed.set(id, { kind: 'graph' });
      this.board.reveal(id);
      return `Graphed ${exprs.join(', ')}`;
    }

    // ---- writing ----
    const title = /^(?:write|add|put)(?: a| the)? (?:title|heading)(?: called| saying| that says)?\s*:?\s+(.+)$/i.exec(said);
    if (title) {
      const id = this.board.addText(title[1]!.trim(), { size: 44, ...this.place() });
      this.placed.set(id, { kind: 'text' });
      this.board.reveal(id);
      return 'Written';
    }
    const w = /^(?:write|note|jot down|put|add)(?: down)?\s*:?\s+(.+)$/.exec(said.replace(/^[^a-z]*/i, ''));
    if (w && !/^(?:the answer|a (?:circle|box))/i.test(w[1]!)) {
      let text = w[1]!.trim();
      // "write a squared plus b squared equals c squared" is written as math; words stay words.
      const spoken = spokenMath(text);
      if (spoken !== text && splitMath(spoken).every((r) => r.math || !r.text.trim())) text = spoken;
      const runs = splitMath(text);
      const mathOnly = runs.length === 1 && runs[0]!.math;
      let id: ObjId;
      if (!runs.some((x) => x.math)) id = this.board.addText(text, this.place());
      else if (mathOnly) id = this.board.addMath(this.deps.toTex(text), this.place());
      else {
        // "chain rule: f'(g(x))·g'(x)": the words as text, the formula typeset, side by side on one line.
        const start = this.spot(Math.max(320, text.length * 16), 60);
        let x = start.x;
        const parts: ObjId[] = [];
        for (const run of runs) {
          const t = run.text.trim();
          if (!t) continue;
          const part = run.math ? this.board.addMath(this.deps.toTex(t), { at: { x, y: start.y }, size: 32 }) : this.board.addText(t, { at: { x, y: start.y + 4 }, size: 26 });
          await this.board.ready();
          const b = this.board.bounds(part);
          x = (b ? b.x + b.w : x + t.length * 14) + 12;
          parts.push(part);
        }
        id = parts.length > 1 ? this.board.group(parts) : parts[0]!;
      }
      this.placed.set(id, { kind: 'text', query: mathOnly ? text : undefined });
      if (mathOnly) {
        this.lastQuestion = { id, query: text };
        this.current = { id, expr: text };
      }
      this.board.reveal(id);
      return 'Written';
    }

    // ---- anything else: a math question, solved on the board ----
    return this.solve(said);
  }

  /** Places question → steps → answer as one group, and marks the answer. */
  private async solve(said: string): Promise<string> {
    let style: MarkStyle | null = 'box';
    let withSteps = true;
    let q = said.trim().replace(/[.!?]+$/, '');
    const tail = /(?:,|\s)\s*(?:and\s+)?(circle|box|underline|highlight|check)(?: (?:the|its))? (?:answer|result)$/i.exec(q);
    if (tail) {
      style = styleOf(tail[1]!.toLowerCase());
      q = q.slice(0, tail.index).trim();
    }
    if (/(?:,|\s)\s*(?:and\s+)?(?:put|write|show) the answer(?: there| here)?$/i.test(q)) {
      style = 'circle';
      q = q.replace(/(?:,|\s)\s*(?:and\s+)?(?:put|write|show) the answer(?: there| here)?$/i, '').trim();
    }
    if (/(?:,|\s)\s*(?:just|only) the answer$|,?\s*answer only$/i.test(q)) {
      withSteps = false;
      q = q.replace(/(?:,|\s)\s*(?:just|only) the answer$|,?\s*answer only$/i, '').trim();
    }
    if (/(?:,|\s)\s*(?:step by step|show (?:me )?(?:the|your) (?:steps|work(?:ing)?))$/i.test(q)) {
      q = q.replace(/(?:,|\s)\s*(?:step by step|show (?:me )?(?:the|your) (?:steps|work(?:ing)?))$/i, '').trim();
    }
    q = q.replace(/^(?:what(?:'s| is)|how much is|calculate|compute|work out|find|figure out)\s+/i, (m) => (/^find/i.test(m) ? m : ''));
    if (!q) return '';
    if (NOT_MATH.test(q)) return notUnderstood(q);
    // Spoken math ("x squared minus 4 equals 0") is solved and written as math (x^2 - 4 = 0).
    const spoken = spokenMath(q);
    let w = await this.deps.worked(q);
    if (spoken && spoken !== q) {
      w ??= await this.deps.worked(spoken);
      q = spoken;
    }
    if (w) {
      const steps = withSteps ? w.steps : [];
      const lines = 2 + steps.length * 1.6;
      const origin = this.spot(640, Math.round(lines * 64));
      const ids: ObjId[] = [];
      let y = origin.y;
      // Math sizes are known only once typeset, so each line is measured after it's ready.
      const put = async (id: ObjId, gap = 18) => {
        ids.push(id);
        await this.board.ready();
        const b = this.board.bounds(id);
        y = (b ? b.y + b.h : y + 48) + gap;
        return id;
      };
      const qid = await put(w.questionTex ? this.board.addMath(w.questionTex, { at: { x: origin.x, y }, size: 38 }) : this.board.addText(w.question, { at: { x: origin.x, y }, size: 30 }), 26);
      // The last step is often the answer itself ("x = 4"): show it once, as the answer.
      const same = (a?: string, b?: string) => !!a && !!b && a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
      const shown = steps.length && same(steps.at(-1)!.tex, w.answer.tex ?? w.answer.display) ? steps.slice(0, -1).concat({ text: steps.at(-1)!.text }) : steps;
      for (const s of shown) {
        await put(this.board.addText(s.text, { at: { x: origin.x + 8, y }, size: 20, color: 'muted' }), s.tex ? 6 : 14);
        if (s.tex) await put(this.board.addMath(s.tex, { at: { x: origin.x + 8, y }, size: 28 }), 16);
      }
      const aid = await put(w.answer.tex ? this.board.addMath(w.answer.tex, { at: { x: origin.x, y: y + 6 }, size: 40 }) : this.board.addText(w.answer.display, { at: { x: origin.x, y: y + 6 }, size: 34 }));
      if (style) this.mark(aid, style);
      const gid = this.board.group(ids);
      this.answerOf.set(gid, aid);
      this.placed.set(gid, { kind: 'group', query: q });
      this.placed.set(qid, { kind: 'question', query: q });
      this.placed.set(aid, { kind: 'answer' });
      this.lastAnswer = aid;
      this.lastQuestion = { id: qid, query: q };
      this.current = { id: aid, expr: plain(w.answer.display) };
      this.board.reveal(gid);
      return `${w.answer.display}${steps.length ? ` · ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}`;
    }

    const r = await this.deps.compute(q);
    if (!r.ok) return /^unknown name\b/i.test(r.message) && !looksMathy(q) ? notUnderstood(q) : r.message;
    // Some phrases compute to something with nothing to write (a graph request, a note): never write "= ".
    if (!r.display?.trim() || r.display === 'undefined') return notUnderstood(q);
    const origin = this.spot(560, 140);
    // "factor 10x^2 + 2x + 1": the instruction as a word, the expression as math (not "factor" in italics).
    const verb = /^(factor|expand|simplify|solve|evaluate|differentiate|integrate)\s+(.+)$/i.exec(q);
    const qid = this.board.addMath(verb ? `\\text{${cap(verb[1]!)}}\\;\\; ${this.deps.toTex(verb[2]!)}` : this.deps.toTex(q), { at: origin, size: 34 });
    // It's already in that form: say why, like a teacher would, instead of writing the same thing again.
    if (verb && /^(?:factor|expand|simplify)$/i.test(verb[1]!) && squash(r.display) === squash(verb[2]!)) {
      const expr = verb[2]!.trim();
      const why = await this.unchanged(verb[1]!.toLowerCase(), expr);
      await this.board.ready();
      const qb = this.board.bounds(qid);
      const nid = this.board.addText(why, { at: { x: origin.x, y: (qb ? qb.y + qb.h : origin.y + 50) + 18 }, size: 22, color: 'muted' });
      const gid = this.board.group([qid, nid]);
      this.placed.set(gid, { kind: 'group', query: expr });
      this.placed.set(qid, { kind: 'question', query: expr });
      this.placed.set(nid, { kind: 'text' });
      this.answerOf.set(gid, qid);
      this.lastQuestion = { id: qid, query: expr };
      this.current = { id: qid, expr };
      this.board.reveal(gid);
      return why;
    }
    // Nothing to work out ("3x + 3" comes back as 3x + 3): write it as said, like dictation, and work from it.
    if (squash(r.display) === squash(q)) {
      this.placed.set(qid, { kind: 'question', query: q });
      this.lastQuestion = { id: qid, query: q };
      this.current = { id: qid, expr: q };
      this.board.reveal(qid);
      return 'Written';
    }
    await this.board.ready();
    const qb = this.board.bounds(qid);
    // "x = ±i" already says what equals what: no second "=" in front.
    const aid = this.board.addText(/=/.test(r.display) ? r.display : `= ${r.display}`, { at: { x: origin.x, y: (qb ? qb.y + qb.h : origin.y + 50) + 20 }, size: 34 });
    if (style) this.mark(aid, style);
    const gid = this.board.group([qid, aid]);
    this.answerOf.set(gid, aid);
    this.placed.set(gid, { kind: 'group', query: q });
    this.placed.set(qid, { kind: 'question', query: q });
    this.placed.set(aid, { kind: 'answer' });
    this.lastAnswer = aid;
    this.lastQuestion = { id: qid, query: q };
    this.current = { id: aid, expr: plain(r.display) };
    this.board.reveal(gid);
    return r.display;
  }

  /** Answers a question that's already on the board, right next to it. */
  private async answerAt(q: string, anchor: ObjId, style: MarkStyle): Promise<string> {
    const r = await this.deps.compute(spokenMath(q) || q);
    if (!r.ok) return r.message;
    if (!r.display?.trim()) return 'Lemma couldn’t work that out';
    const b = this.board.bounds(anchor);
    const at = b ? { x: b.x + b.w + 40, y: b.y + Math.max(0, b.h / 2 - 22) } : undefined;
    const aid = this.board.addText(/=/.test(r.display) ? r.display : `= ${r.display}`, { at, size: 34 });
    this.mark(aid, style);
    this.placed.set(aid, { kind: 'answer' });
    this.lastAnswer = aid;
    this.current = { id: aid, expr: plain(r.display) };
    this.board.reveal(aid);
    return r.display;
  }

  /**
   * The next line of working on the current line, the way a person would write it underneath: "factor it" → = (x − 2)(x − 3),
   * "add 3 to both sides" → the new equation with "+ 3" noted beside it, "plug in x = 4" → its value. Null when `t`
   * isn't one of these, or there's nothing to work on.
   */
  private async followUp(t: string): Promise<string | null> {
    const cur = this.current && this.alive(this.current.id) ? this.current : null;
    if (!cur) return null;
    const E = cur.expr;
    const isEq = /=/.test(E) && !/,|\bor\b/.test(E);
    const ref = '(?:it|that|this|the answer|the result|the expression|the equation|everything)';
    const u = t
      .replace(/\s+(?:to|from|on|of) both sides(?: of (?:it|that|this|the equation))?/, '')
      .replace(/\bboth sides(?: of (?:it|that|this|the equation))?\s+/, '')
      .replace(/^(?:now|next|then)\s+/, '');
    const amount = (x: string | undefined) => {
      const v = x ? plain(spokenMath(x.trim())) : '';
      return v && /^[-+]?(?:[\d.]+|[\d.]*[a-z](?:\^\d+)?|\(.+\)|[\d.]+\/[\d.]+|pi|π)$/.test(v.replace(/\s+/g, '')) ? v : null;
    };
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^(factor|expand|simplify)(?: ${ref})?(?: (?:out|fully|completely|again|more))?$`).exec(u))) {
      const op = m[1]!;
      return this.workOn(cur, isEq, (x) => `${op} ${x}`, op === 'simplify' ? 'simplified' : op === 'factor' ? 'factored' : 'expanded', true);
    }
    if ((m = new RegExp(`^(?:multiply(?: ${ref})? by|times) (.+)$`).exec(u))) {
      const n = amount(m[1]);
      if (n) return this.workOn(cur, isEq, (x) => `expand (${x})*(${n})`, `× ${n}`, false);
    }
    if ((m = new RegExp(`^divide(?: ${ref})? by (.+)$`).exec(u))) {
      const n = amount(m[1]);
      if (n) return this.workOn(cur, isEq, (x) => `simplify (${x})/(${n})`, `÷ ${n}`, false);
    }
    if ((m = new RegExp(`^(?:add|plus) (.+?)(?: to ${ref})?$`).exec(u))) {
      const n = amount(m[1]);
      if (n) return this.workOn(cur, isEq, (x) => `simplify (${x}) + (${n})`, `+ ${n}`, false);
    }
    if ((m = new RegExp(`^(?:subtract|minus|take away|take off) (.+?)(?: from ${ref})?$`).exec(u))) {
      const n = amount(m[1]);
      if (n) return this.workOn(cur, isEq, (x) => `simplify (${x}) - (${n})`, `− ${n}`, false);
    }
    if ((m = new RegExp(`^(square|cube)(?: ${ref})?$`).exec(u))) {
      const p = m[1] === 'square' ? 2 : 3;
      return this.workOn(cur, isEq, (x) => `expand (${x})^${p}`, m[1] === 'square' ? 'squared' : 'cubed', false);
    }
    if (!isEq && new RegExp(`^(?:differentiate(?: ${ref})?|(?:take|find|get) the derivative(?: of ${ref})?|derivative(?: of ${ref})?)$`).test(u))
      return this.workOn(cur, false, (x) => `derivative of ${x}`, 'derivative', false);
    if (!isEq && new RegExp(`^(?:integrate(?: ${ref})?|(?:take|find|get) the integral(?: of ${ref})?|integral(?: of ${ref})?)$`).test(u))
      return this.workOn(cur, false, (x) => `integrate ${x}`, 'integral', false);
    // "plug in x = 4", "let x be 4", "when x is 4", "evaluate it at x = 4", "plug in 4 for x", "check x = 4".
    const said1 = /^(?:plug in|plug|put in|sub in|substitute|let|if|when|what if|try|check|evaluate(?: it| that| this)? (?:at|for|when|with)|at|with) ([a-z]) (?:=|equals|is|is equal to|as|be|to) (.+)$/.exec(u);
    const said2 = /^(?:plug|put|sub(?:stitute)?) (?:in )?(.+?) (?:in )?for ([a-z])$/.exec(u);
    const sv = said1 ? [said1[1]!, said1[2]!] : said2 ? [said2[2]!, said2[1]!] : null;
    if (sv) {
      const [v, raw] = sv as [string, string];
      const n = amount(raw);
      const hasV = new RegExp(`(?<![a-z])${v}(?![a-z])`);
      if (n && hasV.test(E)) {
        const sub = (x: string) => x.replace(new RegExp(`(?<![a-z])${v}(?![a-z])`, 'g'), `(${n})`);
        return this.workOn(cur, isEq, (x) => sub(x), `${v} = ${n}`, true);
      }
    }
    // "set it equal to 0": the expression becomes an equation to work on.
    if (!isEq && (m = new RegExp(`^set ${ref} (?:equal )?to (.+)$`).exec(u))) {
      const n = amount(m[1]);
      if (n) return this.writeLine(cur, `${E} = ${n}`, '');
    }
    // "solve it", "solve for x", "find x" on an equation: the answer, boxed, under the working.
    if (isEq && /^(?:solve(?: (?:it|that|this|the equation))?(?: for [a-z])?|find [a-z]|what(?:'s| is) [a-z])$/.test(u)) {
      const r = await this.deps.compute(`solve ${E}`);
      if (!r.ok) return r.message;
      const msg = await this.writeLine(cur, plain(r.display), 'solved');
      const line = this.current?.id;
      if (line) this.mark(this.alive(this.answerOf.get(line)) ?? line, 'box');
      return msg;
    }
    return null;
  }

  /** Works `make` on the current expression (each side of an equation), and writes the result as the next line. */
  private async workOn(cur: { id: ObjId; expr: string }, isEq: boolean, make: (side: string) => string, note: string, equal: boolean): Promise<string> {
    const sides = isEq ? cur.expr.split('=').map((x) => x.trim()) : [cur.expr];
    const out: string[] = [];
    for (const side of sides) {
      const r = await this.deps.compute(make(side));
      if (!r.ok) return r.message;
      if (!r.display?.trim()) return 'Lemma couldn’t work that out';
      out.push(plain(r.display));
    }
    const expr = out.join(' = ');
    if (squash(expr) === squash(cur.expr) && equal) return `Already ${note}`;
    return this.writeLine(cur, expr, note, equal && !isEq);
  }

  /** Writes `expr` under the current line (with "=" in front when it's the same value), a note beside it, and works from it next. */
  private async writeLine(cur: { id: ObjId; expr: string }, expr: string, note: string, equal = false): Promise<string> {
    const b = this.board.bounds(cur.id);
    const at = this.nextAt ?? (b ? { x: b.x, y: b.y + b.h + 30 } : undefined);
    this.nextAt = null;
    const tex = (x: string) =>
      x
        .split('=')
        .map((p) => (p.trim() ? this.deps.toTex(p.trim()) : ''))
        .join(' = ');
    const id = this.board.addMath(equal ? `= ${tex(expr)}` : tex(expr), { at, size: 34 });
    let line = id;
    if (note) {
      await this.board.ready();
      const lb = this.board.bounds(id);
      const nid = this.board.addText(note, { at: lb ? { x: lb.x + lb.w + 28, y: lb.y + lb.h / 2 - 13 } : undefined, size: 20, color: 'muted' });
      this.placed.set(nid, { kind: 'text' });
      // Line and note move together; "circle it" still circles the line.
      line = this.board.group([id, nid]);
      this.answerOf.set(line, id);
      this.placed.set(line, { kind: 'group' });
    }
    this.placed.set(id, { kind: 'answer', query: expr });
    this.lastAnswer = id;
    this.lastQuestion = { id, query: expr };
    this.current = { id, expr };
    this.board.reveal(line);
    return note ? `${note}: ${expr}` : expr;
  }

  /** Why factor / expand / simplify left an expression as it was. */
  private async unchanged(op: string, expr: string): Promise<string> {
    if (op === 'expand') return 'Already expanded';
    if (op === 'simplify') return 'Already as simple as it gets';
    const vars = [...new Set(expr.match(/(?<![a-z])[a-z](?![a-z])/gi) ?? [])];
    if (vars.length !== 1) return 'Doesn’t factor any further';
    const roots = await this.deps.compute(`solve ${expr} = 0`);
    if (!roots.ok || !roots.display.trim()) return 'Doesn’t factor any further';
    const d = roots.display;
    if (/\bi\b|\di\b|no (?:real )?solution/i.test(d)) return `Doesn’t factor over the real numbers: ${expr} = 0 has no real roots`;
    if (/√|sqrt/.test(d)) return `Doesn’t factor with whole numbers. Its roots are ${d}`;
    return 'Doesn’t factor any further';
  }

  /** "Next one": the next thing goes in a fresh spot below everything on the board, lined up with what came before. */
  private newProblem(): string {
    let bottom = -Infinity;
    for (const o of this.board.objects()) {
      if (o.kind === 'group') continue;
      const b = this.board.bounds(o.id);
      if (b) bottom = Math.max(bottom, b.y + b.h);
    }
    this.current = null;
    if (!Number.isFinite(bottom)) return 'Ready for the next one';
    const last = this.board.last();
    const lb = last ? this.board.bounds(last) : null;
    const left = lb?.x ?? this.board.nextSpot(560, 140).x;
    this.nextAt = { x: left, y: bottom + 120 };
    return 'Ready for the next one';
  }

  /** "New line": the next thing goes just under the last thing written. */
  private newLine(): string {
    const last = this.board.last();
    const b = last ? this.board.bounds(last) : null;
    if (b) this.nextAt = { x: b.x, y: b.y + b.h + 70 };
    return 'New line';
  }

  /** Where the next thing goes: the spot an instruction asked for, else the board's next free spot. */
  private spot(w: number, h: number): Point {
    const p = this.nextAt;
    this.nextAt = null;
    return p ?? this.board.nextSpot(w, h);
  }

  private place(): { at?: Point } {
    const p = this.nextAt;
    this.nextAt = null;
    return p ? { at: p } : {};
  }

  private addShape(kind: Parameters<Board['addShape']>[0], opts: NonNullable<Parameters<Board['addShape']>[1]>): ObjId {
    return this.board.addShape(kind, { ...opts, ...this.place() });
  }

  private shape(t: string): string | null {
    const m = /^(?:draw|add|make|put)\s+(?:a |an |the )?(.+)$/.exec(t);
    if (!m) return null;
    let what = m[1]!;
    const nl = /^number ?line(?: (?:from|going from|between) (.+?) (?:to|and) (.+))?$/.exec(what);
    if (nl) {
      const from = nl[1] ? spokenNumber(nl[1]) : -5;
      const until = nl[2] ? spokenNumber(nl[2]) : 5;
      if (from === null || until === null || from === until) return 'Say the ends, like “draw a number line from -5 to 5”';
      const id = this.addShape('numberline', { from: Math.min(from, until), until: Math.max(from, until), w: 640, h: 80 });
      return this.placedShape(id, `Number line from ${Math.min(from, until)} to ${Math.max(from, until)}`);
    }
    const kinds: [RegExp, Parameters<Board['addShape']>[0], string, { w?: number; h?: number }][] = [
      [/^(?:coordinate (?:plane|grid|axes)|axes|x ?y axes|grid)$/, 'axes', 'Axes', { w: 420, h: 420 }],
      [/^circle$/, 'ellipse', 'Circle', { w: 200, h: 200 }],
      [/^(?:oval|ellipse)$/, 'ellipse', 'Ellipse', { w: 280, h: 170 }],
      [/^square$/, 'rect', 'Square', { w: 200, h: 200 }],
      [/^(?:rectangle|box)$/, 'rect', 'Rectangle', { w: 300, h: 180 }],
      [/^triangle$/, 'triangle', 'Triangle', { w: 240, h: 200 }],
      [/^arrow$/, 'arrow', 'Arrow', { w: 220, h: 0 }],
      [/^(?:line|straight line)$/, 'line', 'Line', { w: 260, h: 0 }],
    ];
    // "a big circle", "a small square", "a circle with radius 5": the size words scale the default.
    let scale = 1;
    const adj = /^(big|large|huge|giant|small|little|tiny)\s+/.exec(what);
    if (adj) {
      scale = { big: 1.6, large: 1.6, huge: 2.4, giant: 2.4, small: 0.6, little: 0.6, tiny: 0.35 }[adj[1] as 'big'];
      what = what.slice(adj[0].length);
    }
    // "a right triangle", "a right-angled triangle": right angle marked.
    if (/^right(?:[- ]angled?)? triangle$|^triangle with a right angle$/.test(what)) {
      const id = this.addShape('triangle', { w: 240 * scale, h: 180 * scale, right: true });
      return this.placedShape(id, 'Right triangle');
    }
    // Sizes said in units ("radius 5", "side 4", "6 by 3"): drawn at UNIT world px per unit and labelled.
    const sized = this.sizedShape(what);
    if (sized) return sized;
    what = what.replace(/\s+(?:with (?:a )?(?:radius|side(?: length)?|width|length|diameter)(?: of)? .+|(?:of )?(?:radius|side) .+)$/, '');
    for (const [re, kind, label, size] of kinds) {
      if (!re.test(what)) continue;
      const id = this.addShape(kind, { w: (size.w ?? 0) * scale, h: (size.h ?? 0) * scale });
      return this.placedShape(id, label);
    }
    return null;
  }

  /** "circle with radius 5", "circle of diameter 3", "square with side 4", "6 by 3 rectangle", "rectangle 6 by 3". */
  private sizedShape(what: string): string | null {
    const UNIT = 20;
    const num = `(-?\\d+(?:\\.\\d+)?|[a-z]+(?: [a-z]+)?)`;
    const clamp = (px: number) => Math.max(16, Math.min(1600, px));
    const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
    const circle = new RegExp(`^circle (?:with (?:a )?|of )?(radius|diameter)(?: of| is| =)? ${num}$`).exec(what);
    if (circle) {
      const v = spokenNumber(circle[2]!);
      if (v === null || v <= 0) return 'Say a positive size, like “a circle with radius 5”';
      const d = circle[1] === 'radius' ? 2 * v : v;
      const id = this.addShape('ellipse', { w: clamp(d * UNIT), h: clamp(d * UNIT), label: circle[1] === 'radius' ? `r = ${fmt(v)}` : `d = ${fmt(v)}` });
      return this.placedShape(id, `Circle with ${circle[1]} ${fmt(v)}`);
    }
    const square = new RegExp(`^square (?:with (?:a )?|of )?side(?: length)?(?: of| is| =)? ${num}$`).exec(what);
    if (square) {
      const v = spokenNumber(square[1]!);
      if (v === null || v <= 0) return 'Say a positive size, like “a square with side 4”';
      const id = this.addShape('rect', { w: clamp(v * UNIT), h: clamp(v * UNIT), label: fmt(v) });
      return this.placedShape(id, `Square with side ${fmt(v)}`);
    }
    const rect =
      new RegExp(`^${num} (?:by|x|×) ${num} (?:rectangle|box)$`).exec(what) ??
      new RegExp(`^(?:rectangle|box)(?: of| with sides?)? ${num} (?:by|x|×) ${num}$`).exec(what);
    if (rect) {
      const a = spokenNumber(rect[1]!);
      const b = spokenNumber(rect[2]!);
      if (a === null || b === null || a <= 0 || b <= 0) return 'Say positive sizes, like “a 6 by 3 rectangle”';
      const id = this.addShape('rect', { w: clamp(a * UNIT), h: clamp(b * UNIT), label: `${fmt(a)} × ${fmt(b)}` });
      return this.placedShape(id, `Rectangle ${fmt(a)} by ${fmt(b)}`);
    }
    return null;
  }

  /** "make it bigger / smaller / a lot bigger / twice as big / half the size", "enlarge it", "shrink it", "scale it by 3". */
  private resize(t: string): string | null {
    const ref = '(?:it|that|this|the answer|the (?:shape|graph|circle|triangle|square|rectangle|text|drawing|last one))';
    const m =
      new RegExp(`^(?:make|get) ${ref} (a (?:lot|little|bit|little bit) |much |slightly |even )?(bigger|larger|smaller)$`).exec(t) ??
      new RegExp(`^(enlarge|grow|shrink|scale up|scale down)(?: ${ref})?( a (?:lot|little|bit|little bit)| slightly)?$`).exec(t) ??
      new RegExp(`^(?:make|scale) ${ref} (twice as (?:big|large)|double (?:the|its) size|three times as (?:big|large)|triple (?:the|its) size|half (?:the|its) size|half as (?:big|large)|a third (?:the|of its) size)$`).exec(t) ??
      new RegExp(`^(?:scale|resize|zoom) ${ref} (?:by|to) (\\d+(?:\\.\\d+)?)(?: ?%| percent| times)?$`).exec(t);
    if (!m) return null;
    let factor: number;
    const words = m.slice(1).filter(Boolean).join(' ');
    if (/^\d/.test(words)) {
      const v = Number(words);
      factor = /%|percent/.test(t) ? v / 100 : v;
    } else if (/twice|double/.test(words)) factor = 2;
    else if (/three times|triple/.test(words)) factor = 3;
    else if (/half/.test(words)) factor = 0.5;
    else if (/third/.test(words)) factor = 1 / 3;
    else {
      const up = /bigger|larger|enlarge|grow|scale up/.test(words);
      const amount = /a lot|much/.test(words) ? 2 : /little|bit|slightly/.test(words) ? 1.15 : 1.4;
      factor = up ? amount : 1 / amount;
    }
    if (!(factor > 0.05 && factor < 20) || factor === 1) return 'Say how much, like “make it twice as big”';
    const id = /the answer/.test(t) ? (this.alive(this.lastAnswer) ?? this.target()) : this.target();
    if (!id) return 'Nothing to resize yet';
    this.board.scale(id, factor);
    this.board.reveal(id);
    return factor > 1 ? 'Bigger' : 'Smaller';
  }

  /** Writes a label under (or for wide things, beside) an object. */
  private label(id: ObjId, text: string): string {
    const b = this.board.bounds(id);
    if (!b) return 'Nothing to label yet';
    const spoken = spokenMath(text);
    const asMath = (spoken !== text && splitMath(spoken).every((r) => r.math || !r.text.trim())) || looksMathy(text);
    const at = { x: b.x, y: b.y + b.h + 14 };
    const lid = asMath ? this.board.addMath(this.deps.toTex(spoken !== text ? spoken : text), { at, size: 28 }) : this.board.addText(text, { at, size: 24 });
    // Centre it under the object once its size is known.
    const lb = this.board.bounds(lid);
    if (lb && lb.w < b.w) this.board.move(lid, { x: (b.w - lb.w) / 2, y: 0 });
    this.placed.set(lid, { kind: 'text' });
    this.board.reveal(lid);
    return 'Labelled';
  }

  private placedShape(id: ObjId, label: string): string {
    this.placed.set(id, { kind: 'shape' });
    this.board.reveal(id);
    return label;
  }

  private mark(target: ObjId, style: MarkStyle): void {
    const id = this.board.mark(target, style);
    this.placed.set(id, { kind: 'mark' });
  }

  /** "that": the selection, else the last thing placed (skipping marks, which point at something else). */
  private target(): ObjId | null {
    const sel = this.board.selection()[0];
    if (sel) return sel;
    const last = this.board.last();
    if (last && this.placed.get(last)?.kind === 'mark') return this.alive(this.lastAnswer) ?? last;
    return last;
  }

  /** The id if it's still on the board (undo, erase or clear can take back what this layer placed). */
  private alive(id: ObjId | null | undefined): ObjId | null {
    return id && this.board.bounds(id) ? id : null;
  }
}

/** Splits a run of instructions into steps: sentences, "then", "after that", "finally", and "and" before a new action. */
export function splitSteps(raw: string): string[] {
  return raw
    .split(
      /(?<!\d)[.!?;]+(?!\d)\s*|,?\s+\b(?:and then|then|after that|afterwards|finally|lastly)\b[\s,]*|,?\s+and (?=(?:write|draw|graph|plot|sketch|label|factor|expand|simplify|go to|move on|start)\b)/i,
    )
    .map((x) => (x ?? '').replace(/^(?:first(?:ly)?|to start|start by|begin by|step \w+)[\s,:]+/i, '').trim())
    .filter(Boolean);
}

/** Things people say at a board that aren't instructions. */
const FILLER =
  /^(?:u+m+|u+h+m*|h+m+|e+r+m*|ok(?:ay)?|alright|all right|right|so|well|let'?s see|let me (?:think|see)|got it|cool|nice|great|good|perfect|yes|yeah|yep|no|nope|thanks?(?: you)?|hold on|wait|one sec(?:ond)?|hm+ ok(?:ay)?)$/;

const CONNECTIVES = new Set(
  'and then so also but or plus um uh uhh umm er erm hmm like okay ok alright right now next well yeah yes just actually basically anyway oh ah the a an it that this'.split(' '),
);

/** "Next one", "I'm going to go to the next one", "moving on", "new problem". */
const NEXT_PROBLEM =
  /\b(?:(?:the )?next (?:one|problem|question|example|exercise|part)|move on|moving on|new (?:problem|question|example|section|page)|another (?:one|problem|question|example)|start (?:a )?(?:new|fresh) (?:one|problem|section|page))\b/;

/** "below that, write x = 4", "write x = 4 next to it": where the next thing goes, and the rest of the instruction. */
function placeHint(said: string): { dir: 'below' | 'right' | 'above'; rest: string } | null {
  const spot = '(below|under|underneath|beneath|next to|beside|to the right of|right of|above|over)';
  const ref = '(?:it|that|this|the answer|the last one)';
  const word = (w: string): 'below' | 'right' | 'above' => (/next|beside|right/.test(w) ? 'right' : /above|over/.test(w) ? 'above' : 'below');
  const lead = new RegExp(`^${spot} ${ref}[\\s,:]*(.*)$`, 'i').exec(said);
  if (lead) return { dir: word(lead[1]!.toLowerCase()), rest: lead[2]!.trim() };
  const tail = new RegExp(`^(.+?)[\\s,]+${spot} ${ref}[.!?]*$`, 'i').exec(said);
  if (tail && /^(?:write|put|add|draw|graph|plot|note|jot)\b/i.test(tail[1]!)) return { dir: word(tail[2]!.toLowerCase()), rest: tail[1]!.trim() };
  const side = /^(.+?)[\s,]+(?:on the right|to the right)[.!?]*$/i.exec(said);
  if (side && /^(?:write|put|add|draw|graph|plot)\b/i.test(side[1]!)) return { dir: 'right', rest: side[1]!.trim() };
  return null;
}

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** The calculator's display text as typed math, so it can be worked on again: "3x² − 2" → "3x^2 - 2". */
export function plain(display: string): string {
  return display
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join('')}`)
    .replace(/−/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .trim();
}

/** For comparing two ways of writing the same thing: "3x + 3", "3*x+3". */
function squash(s: string): string {
  return plain(s)
    .toLowerCase()
    .replace(/[\s*]/g, '');
}

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1).toLowerCase();

function styleOf(word: string): MarkStyle {
  if (word.startsWith('check') || word === 'tick') return 'check';
  return word as MarkStyle;
}

const DONE: Record<MarkStyle, string> = { circle: 'Circled', box: 'Boxed', underline: 'Underlined', highlight: 'Highlighted', check: 'Checked', strike: 'Crossed out' };

/** Board actions Lemma doesn't do by voice yet: answered with a hint, never sent to the calculator. */
const NOT_MATH = /^(?:draw|make|label|name|cross|strike|move|zoom|rotate|turn|flip|resize|scale|shrink|enlarge|select|copy|duplicate|paste|colou?r|fill|shade|connect|join|extend|scroll|pan|open|save|export|rename|delete|erase|remove|undo|redo|clear)\b/i;

function notUnderstood(q: string): string {
  if (q.split(/\s+/).length <= 3) return `Didn’t catch an instruction in “${q}”. Try “write …”, “circle it” or a math question`;
  return `Not sure how to do “${q}” on the board yet. Try “draw a circle”, “circle it”, “move it left” or a math question`;
}

/** Spoken math to symbols: "x squared minus 4 equals 0" → "x^2 - 4 = 0", "negative five" → "-5". Unchanged without spoken math. */
export function spokenMath(s: string): string {
  if (!SPOKEN.test(s)) return s;
  const n = normalize(
    s
      .replace(/\bis equal to\b|\bequals\b/gi, '=')
      // "e to the x", "2 to the 10th", "x to the power of 3".
      .replace(/\b([a-z]|\d+(?:\.\d+)?|\)) to the (?:power of )?(\d+|[a-z]\b)(?:st|nd|rd|th)?(?: power)?/gi, '$1^$2'),
  ).text;
  return n
    .replace(/\s+\^\s*/g, '^')
    .replace(/\b(sqrt|cbrt) (\d+(?:\.\d+)?|[a-z])\b/g, '$1($2)')
    .replace(/(^|[=(,]\s*)- (?=\d)/g, '$1-')
    .replace(/\s+/g, ' ')
    .trim();
}
const SPOKEN =
  /\b(?:plus|minus|times|over|squared|cubed|equals?|is equal to|divided by|multiplied by|negative|to the|square root|cube root|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|third|quarter)\b/i;

/** "-5", "negative five", "minus 2.5" → a number; null when it isn't one. */
export function spokenNumber(s: string): number | null {
  const t = spokenMath(s.trim()).replace(/\s+/g, '');
  return /^[-+]?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

export function looksMathy(s: string): boolean {
  return /[=^+*/×÷√∫π]|\d\s*[a-z]\b|\b[a-z]\s*\(|\bd\/dx\b/i.test(s);
}
