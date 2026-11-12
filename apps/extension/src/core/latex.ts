/**
 * Page math → Lemma input. DOM-free so it is unit-tested; the content script feeds it LaTeX found in
 * KaTeX/MathJax annotations, MathML alttext, or $…$ in the selected text.
 */

/** Reads one brace group starting at s[i] === '{'. Returns the inner text and the index after '}'. */
function group(s: string, i: number): [string, number] {
  if (s[i] !== '{') {
    // \frac12 style: a single token.
    if (s[i] === '\\') {
      const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
      if (m) return [m[0], i + m[0].length];
    }
    return [s[i] ?? '', i + 1];
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

const SYMBOLS: Record<string, string> = {
  cdot: '*', times: '*', ast: '*', div: '/', pm: '±', mp: '∓', pi: 'pi', theta: 'theta', alpha: 'alpha', beta: 'beta',
  infty: 'infinity', le: '<=', leq: '<=', ge: '>=', geq: '>=', ne: '!=', neq: '!=', approx: '≈', lt: '<', gt: '>',
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot', arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  ln: 'ln', log: 'log', exp: 'exp', min: 'min', max: 'max', degree: '°', circ: '°', percent: '%', '%': '%',
  quad: ' ', qquad: ' ', ',': ' ', ';': ' ', '!': '', ':': ' ', displaystyle: '', textstyle: '', left: '', right: '',
  big: '', Big: '', bigg: '', Bigg: '', bigl: '', bigr: '', Bigl: '', Bigr: '', limits: '', nolimits: '',
};

/** Converts a LaTeX math string to Lemma's plain input ("\\frac{3}{4}x + 2 = 5" → "(3)/(4)x + 2 = 5"). */
export function latexToInput(tex: string): string {
  let s = tex.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\(|\\\)$/g, '').replace(/^\\\[|\\\]$/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const name = m?.[1] ?? '';
      i += (m?.[0].length ?? 1);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, j] = group(s, skipWs(s, i));
        const [b, k] = group(s, skipWs(s, j));
        out += `(${latexToInput(a)})/(${latexToInput(b)})`;
        i = k;
      } else if (name === 'sqrt') {
        let n: string | null = null;
        if (s[i] === '[') {
          const close = s.indexOf(']', i);
          n = s.slice(i + 1, close < 0 ? s.length : close);
          i = close < 0 ? s.length : close + 1;
        }
        const [a, j] = group(s, skipWs(s, i));
        out += n ? `(${latexToInput(a)})^(1/(${latexToInput(n)}))` : `sqrt(${latexToInput(a)})`;
        i = j;
      } else if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'operatorname' || name === 'mathit' || name === 'mathbf') {
        const [a, j] = group(s, skipWs(s, i));
        out += name === 'text' || name === 'textrm' ? ` ${a} ` : latexToInput(a);
        i = j;
      } else if (name in SYMBOLS) {
        const v = SYMBOLS[name]!;
        out += /^[a-z]/i.test(v) && /[a-z0-9]$/i.test(out) ? ` ${v}` : v;
      } else if (name === '{' || name === '}') {
        out += name === '{' ? '(' : ')';
      } else {
        out += name;
      }
    } else if (c === '^' || c === '_') {
      const [a, j] = group(s, skipWs(s, i + 1));
      const inner = latexToInput(a);
      if (c === '^') out += /^[\w.]+$/.test(inner) && inner.length === 1 ? `^${inner}` : `^(${inner})`;
      // Subscripts (x_1, \log_2) have no plain-input form; they are dropped.
      i = j;
    } else if (c === '{') {
      const [a, j] = group(s, i);
      out += `(${latexToInput(a)})`;
      i = j;
    } else if (c === '&') {
      i++;
    } else {
      out += c;
      i++;
    }
  }
  s = out
    .replace(/\(\s*([\w.]+)\s*\)\/\(\s*([\w.]+)\s*\)/g, '$1/$2')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function skipWs(s: string, i: number): number {
  while (s[i] === ' ') i++;
  return i;
}

/** Finds $…$, \(…\) or $$…$$ spans in text and returns the text with each span converted. Null when there is no LaTeX. */
export function convertInlineLatex(text: string): string | null {
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;
  let found = false;
  const out = text.replace(re, (_m, a?: string, b?: string, c?: string, d?: string) => {
    found = true;
    return latexToInput(a ?? b ?? c ?? d ?? '');
  });
  if (found) return out.trim();
  // Bare LaTeX without delimiters ("\frac{1}{2} + \sqrt{9}") is common when copying from KaTeX source.
  if (/\\(?:frac|sqrt|cdot|times|left|right|pi|le|ge)\b/.test(text)) return latexToInput(text);
  return null;
}

/** Numbers found in a table cell's text: "$1,299.00" → 1299, "12 kg" → 12, "n/a" → null. */
export function cellNumber(text: string): number | null {
  const t = text.replace(/[\s ]/g, '').replace(/[$€£¥₹%]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(/−/g, '-');
  const m = /^[-+]?\(?\d*\.?\d+(?:e[-+]?\d+)?\)?/i.exec(t);
  if (!m) return null;
  let v = Number(m[0].replace(/[()]/g, ''));
  if (/^\(.*\)$/.test(m[0])) v = -v; // accounting negatives: (12.50)
  return Number.isFinite(v) ? v : null;
}
