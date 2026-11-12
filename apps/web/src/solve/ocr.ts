import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { cleanOcr } from '../../../extension/src/ui/ocr-clean';

/**
 * On-device text reading for photos, drawings and worksheets (tesseract.js, loaded on first use; its English
 * data, about 10 MB, downloads once from the tesseract.js CDN and is cached). Then the extension's OCR → math
 * tidy-up plus a few math-specific fixes. The result is always shown for editing before anything is solved.
 */
type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
export type Progress = (status: string, progress: number) => void;

let worker: Promise<OcrWorker> | null = null;
let onProgress: Progress = () => {};

function getWorker(): Promise<OcrWorker> {
  worker ??= import('tesseract.js')
    .then(({ createWorker }) =>
      createWorker('eng', 1, {
        workerPath: tesseractWorkerUrl,
        logger: (m: { status: string; progress: number }) => {
          const s = m.status.replace(/^recognizing text$/, 'Reading').replace(/^loading (.*)$/, 'Loading $1').replace(/^initializing (.*)$/, 'Starting $1');
          onProgress(`${s[0]?.toUpperCase() ?? ''}${s.slice(1)}…`, m.progress);
        },
      }),
    )
    .catch((e: unknown) => {
      worker = null;
      throw e;
    });
  return worker;
}

/** Grayscale, stretch contrast and scale so text is ~40 px tall: tesseract reads printed math far better. */
export function prepare(src: CanvasImageSource & { width: number; height: number }, crop?: { x: number; y: number; w: number; h: number }, minSide = 900): HTMLCanvasElement {
  const c = crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  const scale = Math.min(4, Math.max(1, minSide / Math.max(1, Math.min(c.w, c.h) * 2.2)));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w * scale));
  out.height = Math.max(1, Math.round(c.h * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(1, hi - lo);
  // Dark text on light paper either way: invert light-on-dark screenshots.
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i]!;
  const invert = sum / (d.length / 4) < 110;
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i]! - lo) / span) * 255;
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Starts the reader (and its one-time data download) ahead of the first photo, e.g. when the picker opens. */
export function warmOcr(): void {
  getWorker().catch(() => undefined);
}

/** One line of text the reader found, with where it is in the image it was given (pixels). */
export interface OcrLine {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The reader's own confidence, 0–100. */
  confidence: number;
  /** Made from lines on top of each other (a fraction, a power): never trusted as read. */
  stacked?: boolean;
}

export async function recognize(image: HTMLCanvasElement | Blob, progress: Progress = () => {}, mode: 'block' | 'line' = 'block'): Promise<string> {
  return (await recognizeLines(image, progress, mode)).text;
}

/** The text plus each line's position, so a worksheet's problems can be tapped one by one. */
export async function recognizeLines(image: HTMLCanvasElement | Blob, progress: Progress = () => {}, mode: 'block' | 'line' = 'block'): Promise<{ text: string; lines: OcrLine[] }> {
  onProgress = progress;
  progress('Loading the text reader (the first time downloads about 10 MB once)…', 0);
  const w = await getWorker();
  await w.setParameters({
    tessedit_pageseg_mode: (mode === 'line' ? '7' : '6') as never,
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: mode === 'line' ? '0123456789+-=()[]xyzabcdnt/*^.,<>|' : '',
  });
  const { data } = await w.recognize(image);
  progress('Done', 1);
  return { text: data.text, lines: (data.lines ?? []).map((l) => ({ text: l.text, box: l.bbox, confidence: l.confidence })) };
}

/**
 * Likely misreads in a line of math, each as a one-tap fix: [label, fixed line]. Only fixes that change the line
 * and are plausible for it are offered (a letter S between digits is almost always a 5, and so on).
 */
export function misreadFixes(line: string): [string, string][] {
  const out: [string, string][] = [];
  const add = (label: string, fixed: string) => {
    if (fixed !== line && !out.some(([, f]) => f === fixed)) out.push([label, fixed]);
  };
  const digitish: [RegExp, string, string][] = [
    [/[Ss](?=\d)|(?<=\d)[Ss]/g, '5', 'S → 5'],
    [/[Oo](?=\d)|(?<=\d)[Oo]/g, '0', 'O → 0'],
    [/[lI|](?=\d)|(?<=\d)[lI|]/g, '1', 'l → 1'],
    [/[zZ](?=\d)|(?<=\d)[zZ]/g, '2', 'z → 2'],
    [/B(?=\d)|(?<=\d)B/g, '8', 'B → 8'],
    [/[gq](?=\d)|(?<=\d)[gq]/g, '9', 'g → 9'],
    [/b(?=\d)|(?<=\d)b(?![a-z])/g, '6', 'b → 6'],
  ];
  for (const [re, to, label] of digitish) add(label, line.replace(re, to));
  // "3x4" is often a times sign read as x; "3 * 4" may be an x (a variable) read as a times sign.
  if (/\dx\d/.test(line)) add('x → ×', line.replace(/(?<=\d)x(?=\d)/g, ' * '));
  if (/\d\s*\*\s*[a-z(]|\d\s*\*\s*\d/i.test(line) && !/[a-z]/i.test(line.replace(/sqrt|sin|cos|tan|log|ln/gi, ''))) add('× → x', line.replace(/\s*\*\s*/g, 'x'));
  // Powers that came out flat: "x2" → x², "x3" → x³.
  if (/\b[a-z]\d\b/.test(line)) add('x2 → x²', line.replace(/\b([a-z])(\d)\b/g, '$1^$2'));
  // A square root read as a V; a small raised power read as a plain digit ("2³" → "23").
  if (/V(?=\s*[\d(])/.test(line)) add('V → √', line.replace(/V\s*(\d[\d.]*)/g, 'sqrt($1)').replace(/V(?=\s*\()/g, 'sqrt'));
  // Not after "=" (that's an answer side), and not ×⁰ or ×¹, which nobody writes.
  const pow = /(?:^|[\s+\-*/(])(\d)([2-9])(?=$|[\s+\-*/)])/.exec(line.split('=')[0]!);
  if (pow) {
    const m = pow;
    add(`${m[1]}${m[2]} → ${m[1]}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[+m[2]!]}`, line.replace(`${m[1]}${m[2]}`, `${m[1]}^${m[2]}`));
  }
  if (/(?<=\d)X\b/.test(line)) add('X → x', line.replace(/(?<=\d)X\b/g, 'x'));
  // Minus signs read as dashes or tildes; a division sign read as plus.
  if (/[~—–]/.test(line)) add('— → −', line.replace(/[~—–]/g, '-'));
  if (/\d\s*\+\s*\d/.test(line) && !/=/.test(line)) add('+ → ÷', line.replace(/(?<=\d)\s*\+\s*(?=\d)/, ' / '));
  return out.slice(0, 5);
}

/**
 * Why a line that was read shouldn't be trusted as it stands (null when it looks fine). A likely misread is shown
 * for checking, never answered: a wrong answer that looks right is worse than none.
 * `others` are the other lines found in the same picture, for spotting stacked layouts (fractions, powers).
 */
export function doubtOf(q: string, l: OcrLine | null, others: OcrLine[] = []): string | null {
  if (/^[\d.,\s]+$/.test(q)) return 'Only a number was read, so part of this problem may be missing';
  if (/V\s*\d|\|/.test(l?.text ?? q)) return 'A square root or bar may have been misread';
  if (!l) return null;
  if (l.stacked) return 'This looks like a fraction or a power, which is often misread';
  // Only very low confidence counts: on maths the reader's own score barely separates right lines from wrong ones
  // (40 for a correct "3x + 5 = 20", 69 for a garbled fraction), so the layout checks below do the real work.
  if (l.confidence < 25) return 'This part of the photo is hard to read';
  const h = l.box.y1 - l.box.y0;
  const heights = others.map((o) => o.box.y1 - o.box.y0).sort((a, b) => a - b);
  const median = heights.length ? heights[heights.length >> 1]! : h;
  // A line much shorter or taller than the rest, or one sitting right on top of another: a fraction or a
  // raised power, which this reader flattens ("¾ + ⅙" comes out as "341").
  if (heights.length > 2 && (h < median * 0.6 || h > median * 1.7)) return 'This looks like a fraction or a power, which is often misread';
  const stacked = others.some((o) => {
    if (o === l) return false;
    const overlapX = Math.min(o.box.x1, l.box.x1) - Math.max(o.box.x0, l.box.x0);
    const gap = Math.max(o.box.y0 - l.box.y1, l.box.y0 - o.box.y1);
    return overlapX > 0.3 * Math.min(o.box.x1 - o.box.x0, l.box.x1 - l.box.x0) && gap < h * 0.45;
  });
  return stacked ? 'This looks like a fraction or a power, which is often misread' : null;
}

/**
 * The reader's best guess for a doubtful line: the near-certain misreads put right (a root read as V, a capital X
 * after a number, letters inside numbers), and, where the layout says a power was there, a flattened power raised
 * again. The user sees this typeset and edits it if it doesn't match the photo.
 */
export function bestGuess(line: string, doubt: string | null): string {
  const sure = ['V → √', 'X → x', 'S → 5', 'O → 0', 'l → 1'];
  let g = line;
  for (let i = 0; i < 6; i++) {
    const fix = misreadFixes(g).find(([label]) => sure.includes(label) || (/power|root/.test(doubt ?? '') && /^\d\d → /.test(label)));
    if (!fix) break;
    g = fix[1];
  }
  return g;
}

/** OCR text → calculator lines: the extension's tidy-up plus math fixes. One problem per line. */
export function mathFromOcr(text: string): string[] {
  const pre = text
    .replace(/[“”]/g, '"')
    .replace(/[×✕]/g, ' * ')
    .replace(/÷/g, ' / ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√\s*\(?([\w.]+)\)?/g, 'sqrt($1)');
  return cleanOcr(pre)
    .split('\n')
    .map((l) =>
      l
        // Question numbers and bullets: "1.", "2)", "(a)", "Q3:".
        .replace(/^\s*(?:Q\s*)?(?:\d{1,2}|[a-h])\s*[.):]\s+(?=\S)/i, '')
        .replace(/^\s*\(\s*(?:\d{1,2}|[a-h])\s*\)\s*/i, '')
        // Letters read inside numbers: O → 0, l/I → 1.
        .replace(/(?<=\d)[oO](?=\d)|(?<=\d)[oO]\b(?=\s*[+\-*/=)])/g, '0')
        .replace(/(?<=\d)[lI](?=\d)/g, '1')
        // A doubled x from the serif glyph ("3Xx") is one x; a capital X after a number is the variable ("3X + 5").
        .replace(/X(?=x)|(?<=x)X/g, '')
        .replace(/(?<=\d)X\b/g, 'x')
        // "x2 + 5x" is x²: a variable followed by a lone 2 or 3 before an operator or the end.
        .replace(/\b([a-z])([23])(?=\s*(?:[+\-=)<>]|$))/g, '$1^$2')
        // Doubled operators from noise.
        .replace(/\s*([+\-*/=])\s*\1+\s*/g, ' $1 ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l.length >= 2 && /\d|[a-z]\s*[=^]/i.test(l));
}

/** A worksheet's text → one question per item, joining wrapped lines. */
export function splitQuestions(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  const start = /^(?:Q\s*)?(?:\d{1,2}|[a-h])\s*[.):]\s+|^\(\s*(?:\d{1,2}|[a-h])\s*\)\s*/i;
  let cur = '';
  const numbered = lines.some((l) => start.test(l));
  for (const l of lines) {
    if (/^(?:name|date|class|period|score|worksheet|page \d+)\b/i.test(l)) continue;
    if (!numbered) {
      out.push(l);
      continue;
    }
    if (start.test(l)) {
      if (cur) out.push(cur);
      cur = l;
    } else if (cur) cur += ` ${l}`;
  }
  if (cur) out.push(cur);
  return out.flatMap((q) => mathFromOcr(q)).slice(0, 60);
}
