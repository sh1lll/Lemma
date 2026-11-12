import './solve.css';
import { delatex, type Answer } from '@lemma/math-core';
import type { Outcome } from '@lemma/runtime';
import { fromSym, plainSteps, stepsRequest, type StepList } from '@lemma/steps-engine';
import { complexRequest, expressionRequest, parseSymbolic, type SymRequest } from '@lemma/symbolic-engine';
import { h, store, svgIcon } from './dom';
import { ICON, type SolveContext, type SolveHost } from './host';
import { interpretation } from './interpret';
import { buildReport } from './report';
import { shareMenu } from './share';
import { renderSteps } from './steps-view';
import { openTutor } from './tutor';

export type { SolveContext, SolveHost } from './host';

/**
 * Everything that follows a committed answer, added without ever delaying it: "Interpreted as …" with
 * alternatives, a "Show steps" toggle (worked solution, computed on demand and remembered open or closed),
 * action chips for a bare expression, Share and "Ask about this", and the full report below.
 */
const STEPS_KEY = 'lemma.steps-open';

export interface Analysed {
  input: string;
  outcome: Outcome;
  req: SymRequest | null;
  /** A single-variable expression worth a function report, in SymPy syntax, and its variable. */
  fn: { expr: string; v: string } | null;
  /** Letters in a bare expression (for "Solve for…"), or null when the input isn't a bare expression. */
  bare: { text: string; vars: string[] } | null;
  answer: Answer | null;
}

const symbolsOf = (srcs: string[]) => [...new Set(srcs.flatMap((s) => [...s.matchAll(/Symbol\('([^']+)'\)/g)].map((m) => m[1]!)))];

export function analyse(host: SolveHost, input: string, outcome: Outcome): Analysed {
  const text = /\\[a-z]|[\^_]\{/i.test(input) ? delatex(input) : input;
  let req: SymRequest | null = null;
  const answer = outcome.kind === 'answer' ? outcome.result : null;
  if (answer?.kind === 'symbolic') {
    try {
      req = parseSymbolic(text, host.session) ?? expressionRequest(text, host.session) ?? complexRequest(text, host.session);
    } catch {
      req = null;
    }
  }
  let fn: Analysed['fn'] = null;
  let bare: Analysed['bare'] = null;
  if (req) {
    const vs = symbolsOf(req.exprs.slice(0, 1));
    const fnOps = new Set(['simplify', 'factor', 'expand', 'diff', 'integrate', 'trigsimp', 'apart', 'together']);
    if (fnOps.has(req.op) && vs.length === 1 && req.exprs.length === 1 && req.lower === undefined && !/Matrix/.test(req.exprs[0]!)) fn = { expr: req.exprs[0]!, v: vs[0]! };
    if ((req.op === 'simplify' && req.mode === 'bare') || req.op === 'polydiv') bare = { text: text.trim(), vars: symbolsOf(req.exprs) };
  }
  return { input: text, outcome, req, fn, bare, answer };
}

export function afterAnswer(host: SolveHost, ctx: SolveContext): void {
  const a = analyse(host, ctx.input, ctx.outcome);
  if (!ctx.alive()) return;
  // "Interpreted as …" and assumptions, at the top of the details.
  const interp = interpretation(host, ctx, a);
  if (interp) ctx.detail.prepend(interp);

  // Show steps.
  const stepsSlot = h('div', { class: 'steps-slot' });
  const source = stepSource(host, a);
  if (source) {
    const toggle = h('button', { type: 'button', class: 'steps-toggle', 'aria-expanded': 'false', 'data-testid': 'show-steps' }, svgIcon(ICON.steps), h('span', {}, 'Show steps'));
    const body = h('div', { class: 'steps-body', hidden: true });
    let loaded: Promise<StepList | null> | null = null;
    const open = (on: boolean, remember: boolean) => {
      toggle.setAttribute('aria-expanded', String(on));
      (toggle.lastElementChild as HTMLElement).textContent = on ? 'Hide steps' : 'Show steps';
      body.hidden = !on;
      if (remember) store.set(STEPS_KEY, on ? '1' : '0');
      if (on && !loaded) {
        body.replaceChildren(h('p', { class: 'steps-wait' }, 'Working out the steps…'));
        loaded = source().then(
          (list) => {
            if (!ctx.alive()) return list;
            if (!list) body.replaceChildren(h('p', { class: 'steps-none' }, 'No step-by-step method for this one. The answer above is still exact.'));
            else body.replaceChildren(renderSteps(list, { onAsk: (st, i) => openTutor(host, ctx, a, { list, focus: i, step: st }) }));
            return list;
          },
          () => {
            body.replaceChildren(h('p', { class: 'steps-none' }, 'The steps could not be worked out this time.'));
            return null;
          },
        );
      }
    };
    toggle.addEventListener('click', () => open(toggle.getAttribute('aria-expanded') !== 'true', true));
    stepsSlot.append(toggle, body);
    ctx.detail.append(stepsSlot);
    // Line by line, the steps start open (until folded once; that choice is remembered). One line, they start folded.
    const saved = store.get(STEPS_KEY);
    if (saved === '1' || (saved === null && document.documentElement.dataset.working === 'lines')) open(true, false);
    (ctx as SolveContext & { steps?: () => Promise<StepList | null> }).steps = () => (loaded ?? source());
  }

  // Action chips for a bare expression ("What do you want to do?").
  if (a.bare) actionChips(host, ctx, a);
  host.chip('Share', ICON.share, (b) => shareMenu(host, ctx, a, b));
  host.chip('Ask about this', ICON.ask, () => openTutor(host, ctx, a, { list: null, getSteps: source ?? undefined }));

  // The full report, section by section, after the answer has painted.
  requestAnimationFrame(() => {
    if (ctx.alive()) buildReport(host, ctx, a);
  });
}

/** How to get the worked solution for this answer, or null when there is none to offer. */
export function stepSource(host: SolveHost, a: Analysed): (() => Promise<StepList | null>) | null {
  const o = a.outcome;
  if (a.req) {
    const sreq = stepsRequest(a.req);
    if (!sreq) return null;
    return () => host.symbolic().run(sreq).then((r) => fromSym(r));
  }
  let list: StepList | null = null;
  try {
    if (o.kind === 'convert') list = plainSteps(a.input, { conversion: o.result as never });
    else if (o.kind === 'calc') list = o.result.assignment || o.result.definition ? null : plainSteps(a.input);
    else if (o.kind === 'answer') list = plainSteps(a.input, { answer: o.result });
  } catch {
    list = null;
  }
  return list ? () => Promise.resolve(list) : null;
}

const ACTIONS: [label: string, icon: keyof typeof ICON, make: (e: string, v: string, n: number) => string | null][] = [
  ['Simplify', 'simplify', (e) => `simplify ${e}`],
  ['Factor', 'factor', (e) => `factor ${e}`],
  ['Expand', 'expand', (e) => `expand ${e}`],
  ['Find roots', 'roots', (e, v, n) => (n === 1 ? `solve ${e} = 0` : null)],
  ['Graph', 'graph', (e, v, n) => (n <= 1 ? `graph ${e}` : null)],
  ['Derivative', 'derivative', (e, v, n) => (n === 1 ? `derivative of ${e}` : `derivative of ${e} with respect to ${v}`)],
  ['Integral', 'integral', (e, v, n) => (n === 1 ? `integrate ${e}` : `integrate ${e} d${v}`)],
  ['Domain & range', 'domain', (e, v, n) => (n === 1 ? `domain and range of ${e}` : null)],
];

function actionChips(host: SolveHost, ctx: SolveContext, a: Analysed) {
  const { text, vars } = a.bare!;
  const v = vars.includes('x') ? 'x' : vars[0] ?? 'x';
  const e = /^[\w^.]+$/.test(text) ? text : `(${text})`;
  const prompt = h('div', { class: 'action-prompt', hidden: true });
  const made: HTMLButtonElement[] = [];
  const add = (label: string, icon: keyof typeof ICON, on: () => void) => {
    const b = host.chip(label, ICON[icon], on);
    b.classList.add('action-chip');
    b.dataset.action = label;
    made.push(b);
  };
  for (const [label, icon, make] of ACTIONS) {
    const q = make(e, v, vars.length);
    if (q) add(label, icon, () => host.submit(q));
  }
  add('Evaluate at…', 'evaluate', () => ask(prompt, vars.map((x) => `${x} =`), 'Evaluate', (vals) => host.submit(`${text} at ${vars.map((x, i) => `${x} = ${vals[i]}`).join(', ')}`)));
  add('Solve for…', 'solveFor', () => {
    if (vars.length <= 1) ask(prompt, [`${text} =`], 'Solve', ([rhs]) => host.submit(`solve ${text} = ${rhs || '0'} for ${v}`), '0');
    else {
      prompt.hidden = false;
      prompt.replaceChildren(h('span', { class: 'action-title' }, 'Solve for'), ...vars.map((x) => h('button', { type: 'button', class: 'chip', onclick: () => host.submit(`solve ${text} = 0 for ${x}`) }, x)));
    }
  });
  // The choices lead the row (before Save note, Practice…), in their own order.
  const items = made[0]?.parentElement;
  if (items) {
    items.prepend(...made);
    [...items.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
  }
  ctx.alts.append(prompt);
}

/** A small inline form under the action chips ("x = [ ]  Evaluate"). */
function ask(box: HTMLElement, labels: string[], go: string, run: (vals: string[]) => void, placeholder = '') {
  box.hidden = false;
  const inputs = labels.map((l) => h('input', { class: 'action-input', 'aria-label': l, placeholder, inputmode: 'decimal', autocomplete: 'off' }));
  const form = h('form', { class: 'action-form' });
  labels.forEach((l, i) => form.append(h('label', {}, h('span', {}, l), inputs[i]!)));
  form.append(h('button', { type: 'submit', class: 'chip primary' }, go));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const vals = inputs.map((x) => x.value.trim());
    if (vals.some((x) => !x) && !placeholder) return inputs.find((x) => !x.value.trim())?.focus();
    run(vals);
  });
  box.replaceChildren(form);
  inputs[0]?.focus();
}
