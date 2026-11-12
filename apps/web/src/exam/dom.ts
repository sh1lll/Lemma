import { renderInlineMath } from '../math-render';

type AttrVal = string | number | boolean | null | undefined | ((e: Event) => void);
export type Kid = Node | string | number | null | undefined | false;

/** Tiny element builder. `on…` keys add listeners; `value`/`checked` set properties; booleans toggle attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, AttrVal> | null, ...kids: (Kid | Kid[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as unknown as HTMLInputElement).checked = !!v;
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(typeof k === 'number' ? String(k) : k);
  return el;
}

export const svgNS = 'http://www.w3.org/2000/svg';

const ICONS: Record<string, string> = {
  flag: '<path d="M6 3v18M6 4h11l-2.5 4L17 12H6"/>',
  bookmark: '<path d="M7 3h10v18l-5-4-5 4z"/>',
  calc: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  ref: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a3 3 0 0 0-3 3"/><path d="M20 4v14h-6"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  highlight: '<path d="M4 20h7M14.5 4.5l5 5-8 8H6.5v-5z"/>',
  scratch: '<path d="M3 17c3-4 5-6 7-6s1 4 3 4 4-6 8-8"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name: keyof typeof ICONS | string, cls = 'ex-ico'): SVGSVGElement {
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = ICONS[name] ?? '';
  return s;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

/** m:ss, or h:mm:ss for an hour or more. */
export function clock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function spoken(ms: number): string {
  const m = Math.ceil(ms / 60000);
  return m <= 1 ? 'less than a minute' : `${m} minutes`;
}

/** A math span: TeX typeset with KaTeX when given, else plain text. */
export function mathSpan(text: string, tex?: string, display = false): HTMLElement {
  const el = h('span', { class: display ? 'ex-math ex-math-block' : 'ex-math' });
  if (tex) renderInlineMath(el, tex, display);
  else el.textContent = text;
  return el;
}

/**
 * Plain typed math ("x^2 + 3x/2", "sqrt(5)", "pi r^2", "<=") to TeX for the live preview under answer boxes.
 * Deliberately forgiving: anything it doesn't understand passes through.
 */
export function asciiToTex(s: string): string {
  let t = s.trim();
  if (!t) return '';
  t = t
    .replace(/\\/g, '\\backslash ')
    .replace(/<=|≤/g, '\\le ')
    .replace(/>=|≥/g, '\\ge ')
    .replace(/!=|≠/g, '\\ne ')
    .replace(/\+-|±/g, '\\pm ')
    .replace(/\*|×/g, '\\cdot ')
    .replace(/÷/g, '\\div ')
    .replace(/\bpi\b|π/g, '\\pi ')
    .replace(/\btheta\b|θ/g, '\\theta ')
    .replace(/\binf(?:inity)?\b|∞/g, '\\infty ')
    .replace(/\b(sin|cos|tan|ln|log|lim)\b/g, '\\$1 ');
  // sqrt(...) and roots with balanced parentheses.
  const group = (src: string, open: number): [string, number] => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return [src.slice(open + 1, i), i + 1];
    }
    return [src.slice(open + 1), src.length];
  };
  let guard = 0;
  while (/sqrt\s*\(|√\s*\(/.test(t) && guard++ < 20) {
    const m = /sqrt\s*\(|√\s*\(/.exec(t)!;
    const [inner, end] = group(t, m.index + m[0].length - 1);
    t = `${t.slice(0, m.index)}\\sqrt{${inner}}${t.slice(end)}`;
  }
  t = t.replace(/√(\w+)/g, '\\sqrt{$1}');
  // a/b where both sides are simple atoms or parenthesised groups.
  const atom = String.raw`(\([^()]*\)|-?[\w.]+(?:\^\{[^}]*\}|\^-?[\w.]+)?)`;
  t = t.replace(new RegExp(`${atom}\\s*/\\s*${atom}`, 'g'), (_m, a: string, b: string) => `\\frac{${a.replace(/^\((.*)\)$/, '$1')}}{${b.replace(/^\((.*)\)$/, '$1')}}`);
  t = t.replace(/\^\(([^()]*)\)/g, '^{$1}').replace(/\^(-?[\w.]{2,})/g, '^{$1}');
  return t;
}

/** append() that skips null/false, for conditional children. */
export function add(el: Element, ...kids: Kid[]): void {
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(typeof k === 'number' ? String(k) : k);
}

/** replaceChildren() that skips null/false. */
export function fill(el: Element, ...kids: Kid[]): void {
  el.replaceChildren();
  add(el, ...kids);
}
