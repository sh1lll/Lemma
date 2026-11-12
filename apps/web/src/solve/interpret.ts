import { parseInput } from '@lemma/math-core';
import { toLatex } from '@lemma/steps-engine';
import { h, store, tex } from './dom';
import type { SolveContext, SolveHost } from './host';
import type { Analysed } from './index';

/**
 * "Interpreted as …": what was understood (typeset), plus each assumption that was made, with the other
 * reading one tap away. Tapping re-runs the input with that assumption. Folded behind a small toggle by default;
 * opening or closing it is remembered for later answers.
 */
const OPEN_KEY = 'lemma.interp-open';
interface Assumption {
  text: string;
  alt: string;
  run: () => void;
}

const UNIT_LETTERS: Record<string, string> = { m: 'metres', s: 'seconds', g: 'grams', h: 'hours', l: 'litres', k: 'thousands', t: 'tonnes' };

const REL_TEX: Record<string, string> = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '≤': '\\le', '≥': '\\ge', '!=': '\\ne', '≠': '\\ne' };

/** "solve 2x + 3 = 11 for x" → 2x + 3 = 11, typeset side by side; null when a side doesn't parse. */
function relationLatex(input: string, host: SolveHost): string | null {
  const body = input.replace(/^\s*(?:solve|find)\s+/i, '').replace(/\s+for\s+[a-z]\s*$/i, '');
  const parts = body.split(/\s*(<=|>=|!=|[=<>≤≥≠])\s*/);
  if (parts.length < 3 || parts.length % 2 === 0 || /,/.test(body)) return null;
  try {
    return parts.map((p, i) => (i % 2 ? REL_TEX[p] ?? p : toLatex(parseInput(p, host.session)))).join(' ');
  } catch {
    return null;
  }
}

export function interpretation(host: SolveHost, ctx: SolveContext, a: Analysed): HTMLElement | null {
  const o = a.outcome;
  const input = a.input.trim();
  const assumptions: Assumption[] = [];
  let latex: string | null = null;

  if (o.kind === 'calc' && !o.result.assignment && !o.result.definition) {
    try {
      latex = toLatex(parseInput(input, host.session));
    } catch {
      latex = null;
    }
    // Ambiguous readings the calculator detected (6÷2(1+2), −2², 20% of 450 + 30): "using X · use Y".
    // A running total ("minus 4" continuing the last answer) obviously continues it: no other reading.
    const continuing = /\bans\b/.test(o.result.expression) && !document.getElementById('tape')?.hidden;
    for (const alt of continuing ? [] : o.result.alternatives) {
      assumptions.push({
        text: alt.label === 'implied multiplication first' ? 'Using left-to-right' : alt.label === 'negative number raised to the power' ? 'Power before the minus sign' : 'Using the usual order',
        alt: `use ${alt.label} (= ${alt.formatted.display})`,
        run: () => host.submit(alt.expression),
      });
    }
    // Pull the old "Or, …" buttons into this line instead of showing both.
    if (o.result.alternatives.length) for (const b of ctx.alts.querySelectorAll(':scope > button.alt:not(.chip)')) b.remove();
  } else if (o.kind === 'answer' && a.req?.op === 'solve') {
    latex = relationLatex(input, host);
  } else if (o.kind === 'answer' && o.result.math?.[0] && a.req) {
    const m = o.result.math[0].latex;
    const cut = m.indexOf(' = ');
    latex = cut > 0 && !m.includes('\\Rightarrow') ? m.slice(0, cut) : null;
    // The engine sometimes hands back the left side already worked out ("5 = 5" for |3 + 4i|, "0 = true"):
    // that isn't how the question was read, so show the typed input instead (or nothing).
    const right = cut > 0 ? m.slice(cut + 3) : '';
    const same = (x: string, y: string) => x.replace(/\s|\\[,;!]/g, '') === y.replace(/\s|\\[,;!]/g, '');
    if (latex && (same(latex, right) || /\\text\{(?:true|false)\}|^\s*(?:true|false)\s*$/.test(right) || !/[a-z(|^\\]/i.test(latex))) {
      try {
        latex = toLatex(parseInput(input.replace(/^\s*(?:simplify|evaluate|compute|calculate|solve)\s+/i, ''), host.session));
      } catch {
        latex = null;
      }
    }
  }

  // log without a base: base 10 here.
  if (/\blog\s*\(?(?!\s*_)/i.test(input) && !/\blog\s*_|\blog\s*\(\s*[^,()]+,|\blog\s*base|\blog\d/i.test(input)) {
    assumptions.push({ text: 'Assuming log is base 10', alt: 'use natural log instead', run: () => host.submit(input.replace(/\blog\b/gi, 'ln')) });
  }
  // Trig in degrees or radians.
  if (/\b(?:sin|cos|tan|sec|csc|cot)\s*\(?\s*-?\d/i.test(input) && (o.kind === 'calc' || (o.kind === 'answer' && o.result.kind !== 'symbolic')) && !/°|\bdeg|\brad|π|\bpi\b/i.test(input)) {
    const now = host.angle();
    assumptions.push({ text: `Assuming angles in ${now === 'deg' ? 'degrees' : 'radians'}`, alt: `use ${now === 'deg' ? 'radians' : 'degrees'}`, run: () => {
      host.toggleAngle();
      host.submit(input);
    } });
  }
  // A single letter read as a unit ("5m + 3m" as minutes, "5 m to ft" as metres).
  const unitLetter = /(?:^|[^a-z])\d+(?:\.\d+)?\s*([a-z])\b(?!\s*\()/i.exec(input);
  if (unitLetter && (o.kind === 'convert' || (o.kind === 'answer' && o.result.kind !== 'symbolic' && o.result.kind !== 'hint'))) {
    const L = unitLetter[1]!;
    const unit = o.kind === 'convert' && o.result.source.unit.symbol.toLowerCase() === L.toLowerCase() ? o.result.source.unit.plural : /\d+h \d+m|\bmin/.test(ctx.display) && L === 'm' ? 'minutes' : UNIT_LETTERS[L.toLowerCase()];
    if (unit && !/\b(?:to|in|into)\s+[a-z]/i.test(input.replace(new RegExp(`\\b${L}\\b`), ''))) {
      assumptions.push({ text: `Assuming “${L}” is ${unit}`, alt: 'use it as a variable', run: () => host.submit(`simplify ${input}`) });
    } else if (unit) {
      assumptions.push({ text: `Assuming “${L}” is ${unit}`, alt: 'use it as a variable', run: () => host.submit(`simplify ${input.replace(/\s+(?:to|in|into)\s+.*$/i, '')}`) });
    }
  }

  if (!latex && !assumptions.length) return null;
  const box = h('div', { class: 'interp', id: `interp-${++seq}`, 'data-testid': 'interpretation' });
  if (latex) box.append(h('span', { class: 'interp-label' }, 'Interpreted as'), tex(latex, false, 'interp-math'));
  for (const s of assumptions) {
    const line = h('div', { class: 'assume' }, h('span', {}, s.text), h('span', { class: 'assume-sep', 'aria-hidden': 'true' }, ' · '));
    // Also an "alt" (the reading the calculator offers instead), so it replaces the old "Or, …" buttons.
    const b = h('button', { type: 'button', class: 'link assume-alt alt', title: 'Use this reading instead' }, s.alt);
    b.addEventListener('click', s.run);
    line.append(b);
    box.append(line);
  }
  const n = assumptions.length;
  const label = n ? `How it was read · ${n} assumption${n > 1 ? 's' : ''}` : 'How it was read';
  const toggle = h('button', { type: 'button', class: 'interp-toggle', 'aria-controls': box.id, 'data-testid': 'interp-toggle' }, h('span', {}, label));
  const show = (on: boolean) => {
    toggle.setAttribute('aria-expanded', String(on));
    box.hidden = !on;
  };
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-expanded') !== 'true';
    store.set(OPEN_KEY, on ? '1' : '0');
    show(on);
  });
  show(store.get(OPEN_KEY) === '1');
  return h('div', { class: 'interp-wrap' }, toggle, box);
}

let seq = 0;
