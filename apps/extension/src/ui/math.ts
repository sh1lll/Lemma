import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Typesets LaTeX with KaTeX (HTML output, no eval); falls back to the source text. */
export function tex(el: HTMLElement, latex: string, display = false): HTMLElement {
  try {
    katex.render(latex, el, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    el.textContent = latex;
  }
  return el;
}
