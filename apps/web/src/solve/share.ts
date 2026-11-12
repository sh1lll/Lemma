import { parseInput } from '@lemma/math-core';
import { toLatex } from '@lemma/steps-engine';
import { h } from './dom';
import type { SolveContext, SolveHost } from './host';
import type { Analysed } from './index';

/**
 * Share and copy: plain text, LaTeX, MathML, a PNG of the typeset answer, and a link that re-runs the input
 * when opened (?q=…). Everything is built from the answer on screen; nothing is sent anywhere.
 */
export function shareLink(input: string): string {
  const u = new URL(location.href);
  u.hash = '';
  u.search = `?q=${encodeURIComponent(input.trim())}`;
  return u.toString();
}

export function answerLatex(host: SolveHost, a: Analysed, display: string): string {
  const o = a.outcome;
  if (o.kind === 'answer' && o.result.math?.[0]) return o.result.math[0].latex;
  if (o.kind === 'calc') {
    try {
      return `${toLatex(parseInput(a.input, host.session))} = ${o.result.fraction && o.result.approximate ? `\\frac{${o.result.fraction.split('/')[0]}}{${o.result.fraction.split('/')[1]}}` : texNum(display)}`;
    } catch {
      // Fall through to text.
    }
  }
  // A number run into its unit ("3.1mi") gets its space back.
  const shown = display.replace(/[\\{}]/g, '').replace(/(\d)(?=[A-Za-zµ°€$£¥])/, '$1 ');
  return `\\text{${a.input.replace(/[\\{}]/g, '')}} = \\text{${shown}}`;
}

const texNum = (s: string) => s.replace(/−/g, '-').replace(/,/g, '{,}').replace(/×10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)/, (_, e: string) => `\\times 10^{${[...e].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c) >= 0 ? String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)) : '-').join('')}}`);

export function answerText(a: Analysed, display: string): string {
  const q = a.input.trim();
  // "solve x^2 = 4" → "x = 2 or x = −2": a second "=" would read as one long equation, so a colon joins them.
  return /=/.test(q) || /=/.test(display) ? `${q}: ${display}` : `${q} = ${display}`;
}

let menuOpen: HTMLElement | null = null;

export function shareMenu(host: SolveHost, ctx: SolveContext, a: Analysed, anchor: HTMLElement): void {
  if (menuOpen) {
    menuOpen.remove();
    menuOpen = null;
    return;
  }
  const latex = answerLatex(host, a, ctx.display);
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      host.toast(`${what} copied`);
    } catch {
      host.toast('Copying isn’t allowed here');
    }
    close();
  };
  const item = (label: string, testid: string, on: () => void) => h('button', { type: 'button', role: 'menuitem', class: 'share-item', 'data-testid': testid, onclick: on }, label);
  const menu = h(
    'div',
    { class: 'share-menu', role: 'menu', 'aria-label': 'Share or copy' },
    item('Copy as text', 'copy-text', () => void copy('Text', answerText(a, ctx.display))),
    item('Copy as LaTeX', 'copy-latex', () => void copy('LaTeX', latex)),
    item('Copy as MathML', 'copy-mathml', () => void import('katex').then((k) => copy('MathML', mathml(k.default.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: true }))))),
    item('Copy image', 'copy-image', () => void copyImage(host, latex).then(close)),
    item('Copy link', 'copy-link', () => void copy('Link', shareLink(a.input))),
  );
  const close = () => {
    menu.remove();
    menuOpen = null;
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: Event) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close();
  };
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      anchor.focus();
    }
  });
  anchor.insertAdjacentElement('afterend', menu);
  menuOpen = menu;
  document.addEventListener('pointerdown', outside, true);
  (menu.firstElementChild as HTMLElement).focus();
}

/** KaTeX's MathML output wraps <math> in a span; keep just the <math> element. */
export function mathml(html: string): string {
  const m = /<math[\s\S]*<\/math>/.exec(html);
  return m ? m[0] : html;
}

async function copyImage(host: SolveHost, latex: string): Promise<void> {
  try {
    const blob = await renderPng(latex);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      host.toast('Image copied');
    } catch {
      // No image clipboard (Firefox, some WebKit): save it instead.
      const a = h('a', { href: URL.createObjectURL(blob), download: 'lemma-answer.png' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      host.toast('Image saved');
    }
  } catch {
    host.toast('Couldn’t make an image of this answer');
  }
}

/** Collects the KaTeX stylesheet with its fonts inlined, so the SVG can be drawn on a canvas. */
let cssCache: Promise<string> | null = null;
function katexCss(): Promise<string> {
  return (cssCache ??= (async () => {
    let css = '';
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of [...rules]) if (/katex/i.test(r.cssText)) css += r.cssText + '\n';
    }
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map((m) => m[1]!))];
    await Promise.all(
      urls.map(async (u) => {
        try {
          const buf = await (await fetch(new URL(u, location.href))).arrayBuffer();
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          css = css.split(u).join(`data:font/woff2;base64,${btoa(bin)}`);
        } catch {
          // A missing font falls back to a system one.
        }
      }),
    );
    // Other formats would trigger more fetches inside the image; drop them.
    return css.replace(/,\s*url\([^)]*\.(?:woff|ttf)[^)]*\)\s*format\([^)]*\)/g, '');
  })());
}

export async function renderPng(latex: string): Promise<Blob> {
  const [{ default: katex }, css] = await Promise.all([import('katex'), katexCss()]);
  const html = katex.renderToString(latex, { displayMode: true, throwOnError: false, output: 'html' });
  const styles = getComputedStyle(document.body);
  const ink = styles.color || '#141416';
  const bg = styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? styles.backgroundColor : '#ffffff';
  // Measure the typeset size off-screen.
  const probe = h('div', { style: 'position:fixed;left:-9999px;top:0;font-size:28px;display:inline-block;padding:0 4px' });
  probe.innerHTML = html;
  document.body.append(probe);
  const w = Math.ceil(probe.getBoundingClientRect().width) + 48;
  const hgt = Math.ceil(probe.getBoundingClientRect().height) + 40;
  probe.remove();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = hgt * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const xhtml = new XMLSerializer().serializeToString(Object.assign(document.createElement('div'), { innerHTML: html }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:28px;color:${ink};padding:20px 24px;display:inline-block"><style>${css.replace(/</g, '\\3c ')}</style>${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  const loaded = new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await loaded;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await toBlob(canvas);
  } catch {
    // Browsers that refuse to rasterise HTML-in-SVG (WebKit taints the canvas): draw the text form instead.
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const fallback = document.createElement('canvas');
    return textPng(fallback, katex.renderToString(latex, { output: 'mathml', throwOnError: false }), ink, bg);
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
}

/** Plain-text rendering of the MathML's text content (used only where HTML-in-SVG can't be drawn). */
function textPng(c: HTMLCanvasElement, mathmlHtml: string, ink: string, bg: string): Promise<Blob> {
  const d = document.createElement('div');
  d.innerHTML = mathmlHtml;
  const ann = d.querySelector('annotation');
  ann?.remove();
  const text = (d.textContent ?? '').replace(/\s+/g, ' ').trim();
  const ctx = c.getContext('2d')!;
  ctx.font = '56px ui-sans-serif, system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 96;
  c.width = w;
  c.height = 140;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = '56px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 70);
  return toBlob(c);
}
