import { AIError, abortedError, httpError, networkError } from '../errors';

export interface HttpContext {
  provider: string;
  providerName: string;
  model: string;
  baseUrl: string;
  networkHint?: string;
  /** fetch implementation; defaults to globalThis.fetch (looked up per call so tests can stub it). */
  fetch?: typeof fetch;
  /** Automatic retries for 429 / overloaded / 5xx before any output has streamed. Default 2. */
  maxRetries?: number;
}

/**
 * POSTs JSON and returns the successful streaming Response. Retries transient failures with backoff
 * (honouring retry-after, capped), and maps every failure to a user-facing AIError.
 */
export async function postJSON(url: string, headers: Record<string, string>, body: unknown, ctx: HttpContext, signal?: AbortSignal): Promise<Response> {
  const maxRetries = ctx.maxRetries ?? 2;
  const doFetch = ctx.fetch ?? globalThis.fetch;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortedError(ctx.provider);
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    } catch (e) {
      throw networkError(e, ctx);
    }
    if (res.ok) {
      if (!res.body) throw new AIError('bad_response', `${ctx.providerName} returned an empty response.`, { provider: ctx.provider });
      return res;
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      // Body unreadable; the status is enough.
    }
    const err = httpError(res.status, text, ctx, res.headers.get('retry-after'));
    if (!err.retryable || attempt >= maxRetries) throw err;
    const wait = Math.min(err.retryAfterSeconds !== undefined ? err.retryAfterSeconds * 1000 : 500 * 2 ** attempt, 20_000);
    await sleep(wait, signal, ctx.provider);
  }
}

function sleep(ms: number, signal: AbortSignal | undefined, provider: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError(provider));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortedError(provider));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Strict JSON parse of streamed tool arguments; reports failure instead of guessing. */
export function parseToolArgs(raw: string): { args: Record<string, unknown>; error?: string } {
  if (!raw.trim()) return { args: {} };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return { args: v as Record<string, unknown> };
    return { args: {}, error: 'Tool arguments must be a JSON object.' };
  } catch (e) {
    return { args: {}, error: `Tool arguments were not valid JSON (${e instanceof Error ? e.message : 'parse error'}): ${raw.slice(0, 200)}` };
  }
}
