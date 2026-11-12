import type { CalcSuccess } from '@lemma/math-core';
import { answerForms, type AnswerForm } from './forms';
import { createDock, getPrefs, MathKeyboard, onPrefs, ROW4, type Dock, type Field, type KeyboardOptions } from './keyboard';

/** Entry point for the calculator (a lazy chunk): the Scientific keyboard, the docked keyboard, answer forms. */
export { createDock, MathKeyboard, ROW4, type Dock, type Field, type KeyboardOptions };

export interface ScientificHost {
  input: HTMLInputElement;
  enter(): void;
  action(act: string): void;
  openSymbols(f: Field | null): void;
  angle: KeyboardOptions['angle'];
}

let sci: MathKeyboard | null = null;

/** The Scientific mode keyboard, in place of the old keypad. One instance, moved into `container`. */
export function scientific(container: HTMLElement, host: ScientificHost): MathKeyboard {
  sci ??= new MathKeyboard({
    label: 'Scientific keyboard',
    accepts: (f) => f === host.input,
    fallback: () => host.input,
    row4: ROW4.sci,
    memory: true,
    enter: () => host.enter(),
    action: (act) => host.action(act),
    openSymbols: (f) => host.openSymbols(f),
    angle: host.angle,
  });
  if (sci.root.parentElement !== container) container.replaceChildren(sci.root);
  return sci;
}

export interface Forms {
  /** Called with each calculation shown: offers its other forms (fraction, mixed number, exact). */
  hook(r: CalcSuccess): void;
  /** S⇔D, or a tap on the answer: the next form. False when there's nothing else to show. */
  cycle(): boolean;
}

/** Fraction ⇄ decimal (S⇔D), mixed numbers and exact forms on the answer line. */
export function formsController(valueEl: HTMLElement): Forms {
  let forms: AnswerForm[] = [];
  let i = 0;
  let last: CalcSuccess | null = null;
  const show = () => {
    valueEl.textContent = forms[i]!.text;
    valueEl.dataset.form = forms[i]!.kind;
  };
  const cycle = () => {
    if (forms.length < 2 || !valueEl.classList.contains('switchable')) return false;
    i = (i + 1) % forms.length;
    show();
    return true;
  };
  const hook = (r: CalcSuccess) => {
    last = r;
    forms = answerForms({ display: r.formatted.display, fraction: r.fraction, value: r.value }, getPrefs());
    i = 0;
    if (forms.length < 2) {
      valueEl.removeAttribute('title');
      delete valueEl.dataset.form;
      return;
    }
    valueEl.classList.add('switchable');
    valueEl.title = 'Tap to switch: decimal, fraction, exact';
    show();
  };
  valueEl.addEventListener('click', () => {
    if (window.getSelection()?.toString()) return; // selecting text to copy isn't a tap
    cycle();
  });
  // "Exact first" / "mixed numbers" changed: redraw the answer on screen in the new order.
  onPrefs(() => last && valueEl.classList.contains('switchable') && hook(last));
  return { hook, cycle };
}
