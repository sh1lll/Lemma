/** Tiny DOM helpers for the solve features (no framework, like the rest of the app). */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function svgIcon(paths: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}

let katexMod: Promise<typeof import('../math-render')> | null = null;
const mathRender = () => (katexMod ??= import('../math-render'));

/** Typesets LaTeX into a fresh element (inline or display); the plain text shows until KaTeX lands. */
export function tex(latex: string, display = false, cls = 'math-s'): HTMLElement {
  const el = h(display ? 'div' : 'span', { class: cls });
  el.textContent = latex.replace(/\\[a-z]+\{?|[{}]/gi, ' ').replace(/\s+/g, ' ').trim();
  void mathRender().then((m) => m.renderInlineMath(el, latex, display));
  return el;
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string): void {
    try {
      localStorage.setItem(key, v);
    } catch {
      // Remembering is a convenience.
    }
  },
};
