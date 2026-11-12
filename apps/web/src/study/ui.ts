/** Small DOM helpers shared by the study tools. */

type Props<T> = Partial<Omit<T, 'style'>> & Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

export function button(label: string, on: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', { type: 'button', className, textContent: label });
  b.addEventListener('click', on);
  return b;
}

/** A row of pill toggles; one is pressed at a time (or several with `multi`). */
export function segmented(options: { id: string; label: string }[], selected: string | string[], on: (id: string, all: string[]) => void, multi = false): HTMLElement {
  const box = el('div', { className: 'seg' });
  box.setAttribute('role', multi ? 'group' : 'radiogroup');
  let chosen = new Set(Array.isArray(selected) ? selected : [selected]);
  for (const o of options) {
    const b = el('button', { type: 'button', textContent: o.label });
    b.dataset.id = o.id;
    b.setAttribute('aria-pressed', String(chosen.has(o.id)));
    b.addEventListener('click', () => {
      if (multi) {
        if (chosen.has(o.id) && chosen.size > 1) chosen.delete(o.id);
        else chosen.add(o.id);
      } else chosen = new Set([o.id]);
      for (const x of box.querySelectorAll<HTMLButtonElement>('button')) x.setAttribute('aria-pressed', String(chosen.has(x.dataset.id!)));
      on(o.id, [...chosen]);
    });
    box.append(b);
  }
  return box;
}

/** Typesets LaTeX (KaTeX loads on first use). */
export function typeset(target: HTMLElement, tex: string, display = false): void {
  target.textContent = tex;
  void import('../math-render').then(({ renderInlineMath }) => renderInlineMath(target, tex, display));
}

export function renderSteps(steps: { text: string; tex?: string }[]): HTMLOListElement {
  const ol = el('ol', { className: 'steps' });
  for (const s of steps) {
    const li = el('li', {}, s.text);
    if (s.tex) {
      const m = el('div', { className: 'step-math' });
      typeset(m, s.tex, false);
      li.append(m);
    }
    ol.append(li);
  }
  return ol;
}
