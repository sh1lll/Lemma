import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { orderColumns } from '@lemma/exam-engine';
import { engine } from './engine';
import type { ImportedDoc } from './types';

/**
 * Turning uploads into text, all on this device: PDFs through pdf.js (line structure rebuilt from text item
 * positions; scanned pages fall back to OCR), photos and scans through tesseract.js, and plain text as is.
 * The engine then reads the text (engine.importText).
 */

export type Progress = (message: string, fraction?: number) => void;

export interface Extracted {
  name: string;
  text: string;
  /** Text of each PDF page, so running headers/footers can be recognised. */
  pageTexts?: string[];
  pages?: number;
  ocr?: boolean;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Groups pdf.js text items into lines by baseline, then orders and spaces them by x position. */
export function itemsToLines(items: TextItemLike[]): string[] {
  const rows: { y: number; h: number; parts: { x: number; w: number; s: string }[]; gap?: boolean }[] = [];
  for (const it of items) {
    // pdf.js emits whitespace-only items that span the gap between runs; they would hide column gaps.
    if (!it.str.trim()) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const hgt = Math.abs(it.transform[3] ?? it.height ?? 10) || 10;
    const row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, Math.min(r.h, hgt) * 0.45));
    if (row) row.parts.push({ x, w: it.width, s: it.str });
    else rows.push({ y, h: hgt, parts: [{ x, w: it.width, s: it.str }] });
  }
  rows.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  let prevY: number | null = null;
  let prevH = 10;
  // Two-column pages are read column by column (see orderColumns).
  for (const r of orderColumns(rows)) {
    // A blank line where the vertical gap is much larger than a line, so paragraphs/questions stay apart.
    if (r.gap || (prevY !== null && prevY - r.y > Math.max(prevH, r.h) * 1.9)) out.push('');
    r.parts.sort((a, b) => a.x - b.x);
    let line = '';
    let end: number | null = null;
    for (const p of r.parts) {
      if (end !== null) {
        const gap = p.x - end;
        if (gap > r.h * 1.5) line += '    ';
        else if (gap > r.h * 0.12 && !line.endsWith(' ') && !p.s.startsWith(' ')) line += ' ';
      }
      line += p.s;
      end = p.x + p.w;
    }
    out.push(line.replace(/\s+$/, ''));
    prevY = r.y;
    prevH = r.h;
  }
  return out;
}

export async function extractPdf(file: Blob, name: string, progress: Progress = () => {}): Promise<Extracted> {
  progress('Opening PDF…', 0);
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  let ocrUsed = false;
  for (let i = 1; i <= doc.numPages; i++) {
    progress(`Reading page ${i} of ${doc.numPages}…`, (i - 1) / doc.numPages);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lines = itemsToLines(content.items.filter((x): x is TextItemLike & typeof x => 'str' in x) as TextItemLike[]);
    if (lines.join('').trim().length < 20) {
      // Scanned page: render it and read it with OCR.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
        const text = await ocr(canvas, (m, f) => progress(`Page ${i}: ${m}`, ((i - 1) + (f ?? 0)) / doc.numPages));
        lines = text.split('\n');
        ocrUsed = true;
      }
    }
    pages.push(lines.join('\n'));
  }
  await doc.destroy();
  progress('Done', 1);
  return { name, text: pages.join('\n\n'), pageTexts: pages, pages: doc.numPages, ocr: ocrUsed };
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<OcrWorker> | null = null;
let ocrProgress: Progress = () => {};

/** Reads text from an image on this device. The first use downloads English language data (~10 MB) from the tesseract.js CDN; later uses are offline-cached by the browser. */
export async function ocr(image: Blob | HTMLCanvasElement, progress: Progress = () => {}): Promise<string> {
  ocrProgress = progress;
  if (!worker) {
    progress('Loading the text reader (first time downloads language data once)…', 0);
    worker = import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, {
        workerPath: tesseractWorkerUrl,
        logger: (m: { status: string; progress: number }) => {
          const status = m.status.replace(/^recognizing text$/, 'Reading text').replace(/^loading (.*)$/, 'Loading $1').replace(/^initializing (.*)$/, 'Starting $1');
          ocrProgress(`${status[0]?.toUpperCase() ?? ''}${status.slice(1)}…`, m.progress);
        },
      }),
    );
    worker.catch(() => (worker = null));
  }
  const w = await worker;
  const { data } = await w.recognize(image);
  return data.text;
}

export async function extractFile(file: File, progress: Progress = () => {}): Promise<Extracted> {
  const name = file.name || 'Untitled';
  const type = file.type || '';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return extractPdf(file, name, progress);
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/i.test(name)) {
    const text = await ocr(file, progress);
    progress('Done', 1);
    return { name, text, ocr: true };
  }
  progress('Reading…', 0.5);
  const text = await file.text();
  progress('Done', 1);
  return { name, text };
}

export function toDoc(x: Extracted): ImportedDoc {
  const doc = engine.importText(x.text, x.name, x.pageTexts);
  if (x.ocr) doc.warnings.push('Read with OCR: check numbers and symbols, which OCR sometimes misreads.');
  return doc;
}
