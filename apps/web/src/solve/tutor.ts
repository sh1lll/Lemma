import type { Step, StepList } from '@lemma/steps-engine';
import { h, tex } from './dom';
import type { SolveContext, SolveHost } from './host';
import type { Analysed } from './index';

/**
 * "Ask about this": a small panel seeded with the problem, the answer and the steps. With an AI provider it
 * forwards questions to the assistant, which can only explain: every number it uses goes through Lemma's
 * compute tool (the assistant's grounding guard). Without AI it offers deterministic help: any step explained
 * in more detail, a similar practice question, and a video lesson.
 */
const GENERIC: [RegExp, string][] = [
  [/^(?:Case \d: )?(?:Subtract|Add) .* (?:from|to) both sides/, 'Doing the same thing to both sides keeps the equation balanced. Here it moves a term from one side to the other, so the unknown ends up alone.'],
  [/^(?:Case \d: )?(?:Divide|Multiply) both sides/, 'Multiplying or dividing both sides by the same non-zero number keeps them equal. It is used here to leave the unknown with a coefficient of 1.'],
  [/flip/, 'When both sides of an inequality are multiplied or divided by a negative number, their order reverses: 2 < 3 but −2 > −3. That is why the sign flips.'],
  [/^Expand/, 'Multiply every term inside the brackets by what is outside (or each term by each term), then collect like terms.'],
  [/^Move every term to one side/, 'Subtracting the right-hand side from both sides gives an equation of the form (something) = 0, which is the starting point for factoring or the quadratic formula.'],
  [/Find two numbers/, 'For x² + bx + c, two numbers p and q with p·q = c and p + q = b give x² + bx + c = (x + p)(x + q). Expanding the brackets shows why.'],
  [/product is zero/, 'If A·B = 0, then A = 0 or B = 0, because a product of non-zero numbers is never zero. So each factor gives its own equation.'],
  [/quadratic formula/, 'Completing the square on ax² + bx + c = 0 gives x = (−b ± √(b² − 4ac)) / 2a. The ± gives the two solutions.'],
  [/discriminant/, 'b² − 4ac decides how many real solutions there are: positive means two, zero means one, negative means none.'],
  [/^Power rule/, 'Bring the exponent down in front, then lower the exponent by one: d/dx xⁿ = n·xⁿ⁻¹.'],
  [/^Sum rule/, 'The derivative of a sum is the sum of the derivatives, so each term can be done on its own.'],
  [/^Constant multiple/, 'A constant factor just comes along: d/dx (c·f) = c·f′.'],
  [/^Product rule/, 'When two functions are multiplied, each takes a turn being differentiated while the other stays the same: (uw)′ = u′w + uw′.'],
  [/^Quotient rule/, 'For a fraction u/w: (u′w − uw′) / w². Low d-high minus high d-low, over low squared.'],
  [/^Chain rule/, 'For a function inside a function, differentiate the outside (keeping the inside as it is), then multiply by the derivative of the inside.'],
  [/^Put the pieces together/, 'Each part was worked out on the lines above. This line puts those results back into the rule.'],
  [/^Simplify/, 'The same value, written more compactly: like terms are combined and common factors cancelled.'],
  [/^Check/, 'Putting each answer back into the original problem confirms it really works, and catches answers created by squaring or multiplying by an expression.'],
  [/Substitute u =/, 'Substitution reverses the chain rule: name the inside u, replace dx using du = u′dx, and the integral becomes a simpler one in u.'],
  [/by parts/, 'Integration by parts reverses the product rule: ∫u dv = uv − ∫v du. Choose u to get simpler when differentiated.'],
  [/partial fractions/i, 'A fraction with a factored denominator splits into simpler fractions, one per factor; each of those integrates to a logarithm or a power.'],
  [/L'Hôpital/, 'If a fraction gives 0/0 or ∞/∞, its limit equals the limit of (derivative of the top)/(derivative of the bottom), when that exists.'],
  [/highest power/, 'Dividing top and bottom by the highest power leaves terms like 1/x, which go to 0 as x grows, so only the leading coefficients remain.'],
  [/row/i, 'Row operations (swap rows, scale a row, add a multiple of one row to another) do not change the solutions of the system, so the matrix can be simplified step by step.'],
  [/^Factor/, 'Factoring writes the expression as a product. Expanding the product gives back the original, which is how this step was checked.'],
  [/^Take out the common factor/, 'Every term shares this factor, so it can be written once outside a bracket (the distributive law in reverse).'],
];

export function explainStep(s: Step): string {
  if (s.detail) return s.detail;
  for (const [re, text] of GENERIC) if (re.test(s.reason)) return text;
  return s.verified === true ? 'The app checked that this line has the same value (or the same solutions) as the line before it.' : 'This line follows from the one before it by the rule named.';
}

export function openTutor(host: SolveHost, ctx: SolveContext, a: Analysed, o: { list: StepList | null; focus?: number; step?: Step; getSteps?: () => Promise<StepList | null> }): void {
  ctx.alts.querySelector('.tutor')?.remove();
  const panel = h('section', { class: 'tutor', 'aria-label': 'Ask about this', 'data-testid': 'tutor' });
  const close = h('button', { type: 'button', class: 'icon-btn ghost tutor-close', 'aria-label': 'Close', onclick: () => panel.remove() }, '×');
  panel.append(h('div', { class: 'tutor-head' }, h('h3', {}, 'Ask about this'), close));
  panel.append(h('p', { class: 'tutor-ctx' }, h('span', {}, a.input.trim()), h('span', { class: 'tutor-eq' }, ' = '), h('b', {}, ctx.display)));

  if (host.aiReady()) {
    const box = h('textarea', { class: 'tutor-input', rows: '2', placeholder: 'Ask anything about this answer…', 'aria-label': 'Your question' });
    const send = h('button', { type: 'button', class: 'chip primary' }, 'Ask');
    send.addEventListener('click', async () => {
      const q = box.value.trim() || 'Explain how this answer is found.';
      const steps = (o.list ?? (await o.getSteps?.().catch(() => null)) ?? null)?.steps.map((s, i) => `${i + 1}. ${s.reason}`).join('\n');
      const grounded = `About this problem: ${a.input.trim()}\nLemma computed the answer: ${ctx.display}\n${steps ? `Its verified steps:\n${steps}\n` : ''}Do not change or recompute these numbers yourself; use the compute tool for any number you need.\nMy question: ${q}`;
      box.value = '';
      void host.assistant().then((x) => x.ask(grounded));
      host.toast('Sent to the assistant');
    });
    panel.append(h('div', { class: 'tutor-ask' }, box, send), h('p', { class: 'tutor-note' }, 'Numbers come from Lemma; the assistant only explains them.'));
  }

  const help = h('div', { class: 'tutor-help' });
  const detail = h('div', { class: 'tutor-detail', 'aria-live': 'polite' });
  const showStep = (s: Step, i: number) => {
    detail.replaceChildren(h('p', { class: 'tutor-step-title' }, `Step ${i + 1}: ${s.reason}`), s.latex ? tex(s.latex, true, 'step-math') : '', h('p', {}, explainStep(s)));
  };
  const explainBtn = h('button', { type: 'button', class: 'chip', 'data-testid': 'tutor-explain' }, 'Explain a step');
  explainBtn.addEventListener('click', async () => {
    const list = o.list ?? (await o.getSteps?.().catch(() => null)) ?? null;
    if (!list) {
      detail.replaceChildren(h('p', {}, 'There is no step-by-step method for this answer, so there are no steps to explain.'));
      return;
    }
    const pick = h('ol', { class: 'tutor-steps' });
    list.steps.forEach((s, i) => pick.append(h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => showStep(s, i) }, s.reason))));
    detail.replaceChildren(h('p', { class: 'tutor-note' }, 'Pick a step:'), pick);
  });
  help.append(
    explainBtn,
    h('button', { type: 'button', class: 'chip', 'data-testid': 'tutor-practice', onclick: () => host.openTool('practice', { query: a.input }) }, 'Similar practice problem'),
    h('button', { type: 'button', class: 'chip', 'data-testid': 'tutor-video', onclick: () => host.openTool('video', { query: a.input, result: ctx.display }) }, 'Video lesson'),
  );
  panel.append(help, detail);
  // Right under the actions (above the report, which may still be filling in).
  const report = ctx.alts.querySelector('.report');
  if (report) report.before(panel);
  else ctx.alts.append(panel);
  if (o.step && o.focus !== undefined) showStep(o.step, o.focus);
  panel.scrollIntoView({ block: 'nearest' });
}
