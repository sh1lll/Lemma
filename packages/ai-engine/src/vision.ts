import { AIError } from './errors';
import type { AIProvider, ImageMediaType } from './types';

export interface ExtractedProblem {
  /** Lemma query text, editable by the user before computing (e.g. "solve 2x + 3 = 7"). */
  query: string;
  /** The problem as written, in LaTeX. */
  latex: string;
  /** Short description: "Linear equation, question 3b". */
  description: string;
}

export interface ImageExtraction {
  problems: ExtractedProblem[];
  /** True when the image contains no maths the model could read. */
  noMathFound: boolean;
  /** Model's note for the user (unreadable parts, what the image shows instead). */
  note?: string;
}

export const EXTRACTION_PROMPT = `Transcribe the maths problem(s) in this image so a calculator can run them. Do NOT solve anything, do not simplify, and do not compute any value; copy numbers exactly as they appear.

For each distinct problem, give:
- "query": the problem rewritten as Lemma calculator input in plain text, using phrasings like "solve x^2 - 5x + 6 = 0", "derivative of x^2 sin(x)", "integrate x^2 from 0 to 3", "mean of 3, 5, 7", "monthly payment on a $20,000 loan at 6% over 5 years", "50 miles to km", "12 * (3 + 4)". Use ^ for powers, * for multiplication, sqrt() for roots, [[a,b],[c,d]] for matrices.
- "latex": the problem exactly as written, in LaTeX.
- "description": a few words saying what it is and its label if any (e.g. "Q3(b) quadratic equation").

If something is illegible, transcribe what you can and say so in "note". If there is no maths in the image, return an empty list and explain in "note" what the image shows.

Reply with only this JSON object and nothing else:
{"problems": [{"query": "...", "latex": "...", "description": "..."}], "note": "..."}`;

const MEDIA_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Asks a vision-capable model to transcribe the maths in a photo or screenshot. Never solves.
 * The host shows the returned queries as editable text before running them through `compute`.
 */
export async function extractFromImage(
  provider: AIProvider,
  imageBase64: string,
  mediaType: string,
  opts: { signal?: AbortSignal; hint?: string } = {},
): Promise<ImageExtraction> {
  let data = imageBase64.trim();
  let type = mediaType.toLowerCase();
  const m = /^data:([^;]+);base64,/.exec(data);
  if (m) {
    type = m[1]!.toLowerCase();
    data = data.slice(m[0].length);
  }
  if (type === 'image/jpg') type = 'image/jpeg';
  if (!MEDIA_TYPES.includes(type as ImageMediaType))
    throw new AIError('bad_request', `Unsupported image type "${mediaType}". Use PNG, JPEG, GIF or WebP.`, { provider: provider.id });
  data = data.replace(/\s+/g, '');

  const res = await provider.complete(
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: type as ImageMediaType, data },
            { type: 'text', text: opts.hint ? `${EXTRACTION_PROMPT}\n\nThe user adds: ${opts.hint}` : EXTRACTION_PROMPT },
          ],
        },
      ],
      maxTokens: 4000,
    },
    opts.signal,
  );
  if (res.stopReason === 'refusal') return { problems: [], noMathFound: true, note: res.text.trim() || 'The model declined to read this image.' };
  return parseExtraction(res.text);
}

/** Parses the model's JSON reply (tolerating code fences and surrounding prose). Exported for tests. */
export function parseExtraction(text: string): ImageExtraction {
  const json = findJSONObject(text);
  if (json === null) {
    if (/no (?:math|maths|mathematics|equations?|problems?)/i.test(text)) return { problems: [], noMathFound: true, note: text.trim() };
    throw new AIError('bad_response', "Couldn't read the problems from that image. Try a clearer photo, or type the problem instead.", { detail: text.slice(0, 300) });
  }
  const obj = json as { problems?: unknown; note?: unknown };
  const list = Array.isArray(obj.problems) ? obj.problems : [];
  const problems: ExtractedProblem[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    const query = typeof q.query === 'string' ? q.query.trim() : '';
    const latex = typeof q.latex === 'string' ? q.latex.trim() : '';
    if (!query && !latex) continue;
    problems.push({ query: query || latex, latex, description: typeof q.description === 'string' ? q.description.trim() : '' });
  }
  const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : undefined;
  return { problems, noMathFound: problems.length === 0, ...(note ? { note } : {}) };
}

function findJSONObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  return null;
}
