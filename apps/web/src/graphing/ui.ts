/** Small DOM helpers for the graphing workspace's controls: plain elements, labelled checks, segmented choices. */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

export function btn(label: string, cls: string, on: (e: MouseEvent) => void, aria?: string): HTMLButtonElement {
  const b = h('button', cls, { type: 'button' });
  if (label.startsWith('<')) b.innerHTML = label;
  else b.textContent = label;
  if (aria) {
    b.setAttribute('aria-label', aria);
    b.title = aria;
  }
  b.addEventListener('click', on);
  return b;
}

export function check(label: string, value: boolean, on: (v: boolean) => void, name?: string): HTMLLabelElement {
  const input = h('input', '', { type: 'checkbox' });
  input.checked = value;
  if (name) input.dataset.setting = name;
  input.addEventListener('change', () => on(input.checked));
  return h('label', 'gw-check', {}, input, h('span', '', { text: label }));
}

/** A row of mutually exclusive buttons (role radiogroup), arrow keys move the choice. */
export function segmented<T extends string>(label: string, options: [T, string][], value: T, on: (v: T) => void): HTMLDivElement {
  const g = h('div', 'gw-seg', { role: 'radiogroup', 'aria-label': label });
  const buttons = options.map(([v, text]) => {
    const b = h('button', '', { type: 'button', role: 'radio', 'aria-checked': String(v === value), 'data-value': v, text });
    b.tabIndex = v === value ? 0 : -1;
    b.addEventListener('click', () => {
      for (const o of buttons) {
        const on2 = o === b;
        o.setAttribute('aria-checked', String(on2));
        o.tabIndex = on2 ? 0 : -1;
      }
      on(v);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = buttons.indexOf(b);
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]!;
      next.click();
      next.focus();
    });
    return b;
  });
  g.append(...buttons);
  return g;
}

export function field(label: string, value: string, on: (v: string) => void, opts: { cls?: string; inputmode?: string; placeholder?: string; type?: string } = {}): HTMLLabelElement {
  const input = h('input', 'gw-field-input', { type: opts.type ?? 'text', spellcheck: 'false', autocomplete: 'off' });
  input.value = value;
  if (opts.inputmode) input.inputMode = opts.inputmode;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener('input', () => on(input.value));
  return h('label', `gw-field ${opts.cls ?? ''}`, {}, h('span', '', { text: label }), input);
}

/** Closes a popover on Escape or a click outside it (and outside its opener). Returns the cleanup. */
export function dismissable(pop: HTMLElement, opener: HTMLElement, close: () => void): () => void {
  // On click (not pointerdown): closing first would shift the layout under the pointer and lose the click.
  const down = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!pop.contains(t) && !opener.contains(t)) close();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      opener.focus();
    }
  };
  document.addEventListener('click', down, true);
  pop.addEventListener('keydown', key);
  return () => {
    document.removeEventListener('click', down, true);
    pop.removeEventListener('keydown', key);
  };
}

export const ICON = {
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5a4 4 0 0 0-5.3 5.1L4.5 16.3a1.6 1.6 0 0 0 2.2 2.2l4.7-4.7a4 4 0 0 0 5.1-5.3l-2.3 2.3-2.2-.4-.4-2.2z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -3)"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12h2" transform="translate(0 -3)"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 16h14"/><circle cx="9" cy="8" r="2"/><circle cx="15" cy="16" r="2"/></svg>',
};
