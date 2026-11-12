import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Typesets LaTeX into an element; falls back to the source text if KaTeX can't parse it. */
export function renderMath(el: HTMLElement, latex: string): void {
  try {
    katex.render(latex, el, { displayMode: true, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    el.textContent = latex;
  }
}

export function renderInlineMath(el: HTMLElement, latex: string, display: boolean): void {
  try {
    katex.render(latex, el, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    el.textContent = latex;
  }
}
