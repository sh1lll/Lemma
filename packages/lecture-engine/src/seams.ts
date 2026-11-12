/**
 * Pure helpers for long-form transcription: fixed windows with overlap, and stitching the text of
 * neighbouring windows so words heard in both overlaps appear once.
 */

export interface Window {
  /** First sample (inclusive). */
  start: number;
  /** Last sample (exclusive). */
  end: number;
}

export interface WindowOptions {
  /** Window length in seconds. Whisper's receptive field is 30 s. Default 30. */
  windowSec?: number;
  /** Overlap between neighbouring windows in seconds. Default 2. */
  overlapSec?: number;
}

/** Splits `lengthSamples` of audio at `rate` Hz into overlapping windows covering every sample. */
export function windows(lengthSamples: number, rate: number, opts: WindowOptions = {}): Window[] {
  const win = Math.max(1, Math.round((opts.windowSec ?? 30) * rate));
  const overlap = Math.min(win - 1, Math.max(0, Math.round((opts.overlapSec ?? 2) * rate)));
  const step = win - overlap;
  const len = Math.max(0, Math.floor(lengthSamples));
  const out: Window[] = [];
  if (len === 0) return out;
  for (let start = 0; ; start += step) {
    const end = Math.min(start + win, len);
    out.push({ start, end });
    if (end >= len) break;
  }
  return out;
}

export interface Seam {
  /** Words of `a` to keep (a trailing fragment cut by the window edge is dropped). */
  keepA: number;
  /** Words at the start of `b` to drop because `a` already has them (or they are a cut-off fragment). */
  skipB: number;
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** How many tail words of `a` may be searched for the overlap (2 s of speech is ~6 words). */
const MAX_OVERLAP = 16;
/** Whisper often garbles the first/last word at a hard cut, so the match may start this far in. */
const EDGE_SLACK = 2;

/**
 * Finds where the end of `a` and the start of `b` describe the same audio. The longest run of equal words
 * that ends at (or one word before) the end of `a` and starts near the start of `b` wins.
 */
export function findSeam(a: string, b: string): Seam {
  const A = words(a);
  const B = words(b);
  const An = A.map(norm);
  const Bn = B.map(norm);
  let best = { len: 0, i: A.length, j: 0, tail: 0 };
  const from = Math.max(0, A.length - MAX_OVERLAP);
  for (let j = 0; j <= Math.min(EDGE_SLACK, Bn.length - 1); j++) {
    for (let i = from; i < An.length; i++) {
      let k = 0;
      while (i + k < An.length && j + k < Bn.length && An[i + k] && An[i + k] === Bn[j + k]) k++;
      const tail = An.length - (i + k);
      if (k === 0 || tail > 1) continue;
      // A single shared short word ("the", "a") is coincidence, not overlap.
      if (k === 1 && (An[i]!.length < 4 || tail > 0)) continue;
      if (k > best.len || (k === best.len && tail < best.tail)) best = { len: k, i, j, tail };
    }
  }
  if (best.len === 0) return { keepA: A.length, skipB: 0 };
  // Keep `a` through the overlap (Whisper capitalises window starts, so a's casing is the natural one) and let
  // `b` supply the last shared word, whose punctuation reflects what follows it.
  return { keepA: best.i + best.len - 1, skipB: best.j + best.len - 1 };
}

/** Joins two window transcripts, writing words heard in both windows once. */
export function mergeSeams(a: string, b: string): string {
  const A = words(a);
  const B = words(b);
  if (!A.length) return B.join(' ');
  if (!B.length) return A.join(' ');
  const { keepA, skipB } = findSeam(a, b);
  return [...A.slice(0, keepA), ...B.slice(skipB)].join(' ');
}
