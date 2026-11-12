export type AIErrorCode =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'model_not_found'
  | 'bad_request'
  | 'too_large'
  | 'network'
  | 'aborted'
  | 'bad_response'
  | 'unknown';

/** An AI request failure. `message` is written for the user; `detail` keeps the provider's own text. */
export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly opts: { provider?: string; status?: number; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AIError';
  }
  get status(): number | undefined {
    return this.opts.status;
  }
  get detail(): string | undefined {
    return this.opts.detail;
  }
  get retryAfterSeconds(): number | undefined {
    return this.opts.retryAfterSeconds;
  }
  /** Worth retrying automatically (rate limit, overload, transient server error). */
  get retryable(): boolean {
    return this.code === 'rate_limit' || this.code === 'overloaded' || this.code === 'server';
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof AIError && e.code === 'aborted') ||
    (typeof e === 'object' && e !== null && 'name' in e && (e as { name: unknown }).name === 'AbortError')
  );
}

export function abortedError(provider?: string): AIError {
  return new AIError('aborted', 'Stopped.', { provider });
}

interface ErrorContext {
  provider: string;
  providerName: string;
  model: string;
  baseUrl: string;
  /** Extra hint for network failures, e.g. how to allow browser origins for a local server. */
  networkHint?: string;
}

/** Pulls the provider's message out of `{error:{type,message}}`, `{error:"..."}` or `{message}` bodies. */
export function readErrorBody(body: string): { type?: string; message?: string } {
  try {
    const j = JSON.parse(body) as unknown;
    if (j && typeof j === 'object') {
      const err = (j as { error?: unknown }).error;
      if (typeof err === 'string') return { message: err };
      if (err && typeof err === 'object') {
        const e = err as { type?: unknown; code?: unknown; message?: unknown };
        return {
          type: typeof e.type === 'string' ? e.type : typeof e.code === 'string' ? e.code : undefined,
          message: typeof e.message === 'string' ? e.message : undefined,
        };
      }
      const m = (j as { message?: unknown }).message;
      if (typeof m === 'string') return { message: m };
    }
  } catch {
    // Not JSON (an HTML error page from a proxy, say).
  }
  return { message: body.trim().slice(0, 300) || undefined };
}

/** Maps an HTTP status (plus the provider's error type) to a clear, user-facing AIError. */
export function httpError(status: number, body: string, ctx: ErrorContext, retryAfter?: string | null): AIError {
  const { type, message: detail } = readErrorBody(body);
  const base = { provider: ctx.provider, status, detail };
  const retryAfterSeconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : undefined;
  const t = type ?? '';
  if (status === 401 || t === 'authentication_error' || t === 'invalid_api_key')
    return new AIError('auth', `${ctx.providerName} rejected the API key. Check the key in Settings.`, base);
  if (status === 403 || t === 'permission_error')
    return new AIError('permission', `This ${ctx.providerName} key isn't allowed to use ${ctx.model}.${detail ? ` (${detail})` : ''}`, base);
  if (status === 429 || t === 'rate_limit_error' || t === 'rate_limit_exceeded')
    return new AIError(
      'rate_limit',
      `${ctx.providerName} rate limit reached. Try again ${retryAfterSeconds ? `in ${Math.ceil(retryAfterSeconds)} s` : 'in a moment'}.`,
      { ...base, retryAfterSeconds },
    );
  if (status === 529 || t === 'overloaded_error' || status === 503)
    return new AIError('overloaded', `${ctx.providerName} is overloaded right now. Try again shortly.`, { ...base, retryAfterSeconds });
  if (status === 404 || t === 'not_found_error' || t === 'model_not_found' || /model.*not (?:be )?found|not found.*model|does not exist/i.test(detail ?? ''))
    return new AIError(
      'model_not_found',
      `Model "${ctx.model}" isn't available at ${hostOf(ctx.baseUrl)}. Check the model name${ctx.provider === 'openai-compatible' ? ' and base URL (it usually ends in /v1)' : ''}.`,
      base,
    );
  if (status === 413 || t === 'request_too_large')
    return new AIError('too_large', 'That request is too large (often an oversized image). Try a smaller image or a shorter conversation.', base);
  if (status >= 500) return new AIError('server', `${ctx.providerName} had a server error (${status}). Try again.`, base);
  if (status === 400 || t === 'invalid_request_error')
    return new AIError('bad_request', `${ctx.providerName} couldn't process the request${detail ? `: ${detail}` : '.'}`, base);
  return new AIError('unknown', `${ctx.providerName} returned an error (${status})${detail ? `: ${detail}` : '.'}`, base);
}

/** An error object that arrived inside an otherwise successful stream. */
export function streamError(type: string | undefined, detail: string | undefined, ctx: ErrorContext): AIError {
  const status =
    type === 'overloaded_error' ? 529 : type === 'rate_limit_error' ? 429 : type === 'authentication_error' ? 401 : type === 'api_error' ? 500 : 0;
  if (status) return httpError(status, JSON.stringify({ error: { type, message: detail } }), ctx);
  return new AIError('unknown', `${ctx.providerName} stopped with an error${detail ? `: ${detail}` : '.'}`, { provider: ctx.provider, detail });
}

/** fetch() itself threw: offline, DNS, refused connection, TLS, or a browser CORS block (indistinguishable from JS). */
export function networkError(e: unknown, ctx: ErrorContext): AIError {
  if (isAbortError(e)) return abortedError(ctx.provider);
  const detail = e instanceof Error ? e.message : String(e);
  const browser = typeof window !== 'undefined';
  const msg =
    `Couldn't reach ${ctx.providerName} at ${hostOf(ctx.baseUrl)}. Check your internet connection` +
    (browser ? ' — in a browser this can also be a CORS block by the server' : '') +
    (ctx.networkHint ? `. ${ctx.networkHint}` : '.');
  return new AIError('network', msg, { provider: ctx.provider, detail });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
