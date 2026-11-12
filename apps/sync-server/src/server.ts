import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { RateLimiter } from './rate-limit.ts';
import { etagOf, FileStore, ID_PATTERN, sha256, TOKEN_PATTERN, tokenMatches } from './storage.ts';

/**
 * Lemma sync server: a zero-knowledge store for encrypted sync blobs.
 *
 *   GET    /healthz            → 200 {"ok":true}
 *   GET    /v1/sync/:id        → 200 blob + ETag | 404
 *   PUT    /v1/sync/:id        → 201 (create, needs If-None-Match: *) | 200 (update, needs If-Match: <etag>)
 *                                412 when the ETag no longer matches (another device wrote first) | 428 without either header
 *   DELETE /v1/sync/:id        → 204 (optional If-Match)
 *
 * `:id` is 64 hex characters derived on the client from the passphrase with its own KDF salt; it reveals nothing
 * about the encryption key. Every request carries `Authorization: Bearer <64 hex>` (derived the same way): the
 * first PUT stores its SHA-256, later requests must match. Bodies must be Lemma encrypted containers
 * (magic "LEMMENC1"); the server cannot and does not decrypt them.
 */

export interface SyncServerOptions {
  dataDir: string;
  /** Exact origins allowed by CORS, e.g. "https://lemma.app". "*" allows any origin (auth is a bearer token, not a cookie). */
  allowedOrigins?: string[];
  /** Largest accepted blob, bytes. */
  maxBlobBytes?: number;
  /** Requests per minute per IP (token bucket, same burst). */
  rateLimitPerMinute?: number;
  /** New sync spaces per hour per IP (token bucket, same burst); much stricter than `rateLimitPerMinute`. */
  createsPerHour?: number;
  /** Maximum number of sync spaces this server will hold. */
  maxSpaces?: number;
  /** Upload bytes held in memory across all requests at once; more gets 503. */
  maxInflightBytes?: number;
  /** Use Fly-Client-IP or the last X-Forwarded-For address (the one the proxy added) as the client IP (only behind a trusted proxy). */
  trustProxy?: boolean;
  /** Days a sync space may go unread and unwritten before it's deleted; 0 keeps spaces forever. */
  expireDays?: number;
  log?: (line: string) => void;
}

export const DEFAULT_ORIGINS = [
  'https://lemma.app',
  'capacitor://localhost', // iOS app
  'https://localhost', // Android app
  'lemma://app', // desktop app
  'http://localhost:5178', // web dev server
  'http://localhost:4178', // web preview
];

const MAGIC = Buffer.from('LEMMENC1');
// Files made before the rename (see packages/sync-engine/src/legacy.ts): still accepted, so a device that hasn't
// opened Lemma yet keeps syncing.
const LEGACY_MAGIC = Buffer.from('OMNIENC1');
const PATH = /^\/v1\/sync\/([^/]+)$/;

class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function createSyncServer(opts: SyncServerOptions): Server & { store: FileStore } {
  const store = new FileStore(opts.dataDir);
  const origins = new Set(opts.allowedOrigins ?? DEFAULT_ORIGINS);
  const maxBlob = opts.maxBlobBytes ?? 10 * 1024 * 1024;
  // 80 × 10 MB fits the 1 GB disk the README suggests, with room for temp files.
  const maxSpaces = opts.maxSpaces ?? 80;
  const maxInflight = opts.maxInflightBytes ?? 64 * 1024 * 1024;
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 120);
  const createsPerHour = opts.createsPerHour ?? 10;
  const createLimiter = new RateLimiter(createsPerHour / 60, createsPerHour);
  let inflight = 0;
  const log = opts.log ?? (() => undefined);

  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) {
      const fly = req.headers['fly-client-ip'];
      if (typeof fly === 'string' && fly) return fly.trim();
      const xff = req.headers['x-forwarded-for'];
      // The client can send its own X-Forwarded-For; only the last entry was added by our proxy.
      if (typeof xff === 'string' && xff) return xff.split(',').at(-1)!.trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const cors = (req: IncomingMessage, res: ServerResponse): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser cross-origin request (curl, native)
    const ok = origins.has('*') || origins.has(origin);
    if (ok) {
      res.setHeader('Access-Control-Allow-Origin', origins.has('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
    }
    return ok;
  };

  /** Buffers the body, counting it in `inflight`; on success the caller must subtract `blob.length` when done. */
  const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBlob) return reject(new HttpError(413, `Blob larger than ${maxBlob} bytes`));
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        inflight -= size;
        req.removeAllListeners('data');
        req.resume();
        reject(e);
      };
      req.on('data', (c: Buffer) => {
        if (size + c.length > maxBlob) return fail(new HttpError(413, `Blob larger than ${maxBlob} bytes`));
        if (inflight + c.length > maxInflight) return fail(new HttpError(503, 'Server busy, try again shortly', { 'Retry-After': '5' }));
        size += c.length;
        inflight += c.length;
        chunks.push(c);
      });
      req.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      req.on('error', fail);
      req.on('close', () => fail(new HttpError(400, 'Upload interrupted')));
    });

  const bearer = (req: IncomingMessage): string => {
    const m = /^Bearer ([0-9a-f]+)$/.exec(req.headers.authorization ?? '');
    if (!m || !TOKEN_PATTERN.test(m[1]!)) throw new HttpError(401, 'Missing or malformed access token', { 'WWW-Authenticate': 'Bearer' });
    return m[1]!;
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const corsOk = cors(req, res);

    if (req.method === 'OPTIONS') {
      if (!corsOk) throw new HttpError(403, 'Origin not allowed');
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match',
        'Access-Control-Max-Age': '600',
      });
      return void res.end();
    }
    if (!corsOk) throw new HttpError(403, 'Origin not allowed');

    if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, service: 'lemma-sync', version: 1 }));
    }

    const ip = clientIp(req);
    const wait = limiter.take(ip);
    if (wait) throw new HttpError(429, 'Too many requests', { 'Retry-After': String(wait) });

    const m = PATH.exec(url.pathname);
    if (!m) throw new HttpError(404, 'Not found');
    const id = m[1]!;
    if (!ID_PATTERN.test(id)) throw new HttpError(400, 'Malformed sync ID');
    const token = bearer(req);

    if (req.method === 'GET' || req.method === 'HEAD') {
      const s = await store.get(id);
      if (!s) throw new HttpError(404, 'Nothing stored for this sync ID');
      if (!tokenMatches(token, s.meta.tokenHash)) throw new HttpError(403, 'Wrong access token');
      if (req.headers['if-none-match'] === s.meta.etag) {
        res.writeHead(304, { ETag: s.meta.etag });
        return void res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(s.blob.length), ETag: s.meta.etag });
      return void res.end(req.method === 'HEAD' ? undefined : s.blob);
    }

    if (req.method === 'PUT') {
      const ifMatch = req.headers['if-match'];
      const ifNoneMatch = req.headers['if-none-match'];
      if (!ifMatch && ifNoneMatch !== '*') throw new HttpError(428, 'Send If-Match with the ETag you downloaded, or If-None-Match: * to create');
      const blob = await readBody(req);
      let result: { etag: string; created: boolean };
      try {
        if (blob.length < 62 + 16 || !(blob.subarray(0, 8).equals(MAGIC) || blob.subarray(0, 8).equals(LEGACY_MAGIC))) throw new HttpError(415, 'Body is not an Lemma encrypted sync file');
        result = await store.withLock(id, async () => {
          const current = await store.get(id);
          if (current) {
            if (!tokenMatches(token, current.meta.tokenHash)) throw new HttpError(403, 'Wrong access token');
            if (ifMatch !== current.meta.etag) throw new HttpError(412, 'Changed by another device; download, merge and retry', { ETag: current.meta.etag });
          } else {
            if (ifMatch) throw new HttpError(412, 'Nothing stored yet; create with If-None-Match: *');
            if ((await store.spaces()) >= maxSpaces) throw new HttpError(507, 'This server is full');
            const wait = createLimiter.take(ip);
            if (wait) throw new HttpError(429, 'Too many new sync spaces from this address', { 'Retry-After': String(wait) });
          }
          const etag = etagOf(blob);
          await store.put(id, { tokenHash: current?.meta.tokenHash ?? sha256(token), etag, size: blob.length, updated: Date.now() }, blob);
          if (!current) store.noteCreated(1);
          return { etag, created: !current };
        });
      } finally {
        inflight -= blob.length;
      }
      res.writeHead(result.created ? 201 : 200, { ETag: result.etag, 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'DELETE') {
      await store.withLock(id, async () => {
        const current = await store.get(id);
        if (!current) throw new HttpError(404, 'Nothing stored for this sync ID');
        if (!tokenMatches(token, current.meta.tokenHash)) throw new HttpError(403, 'Wrong access token');
        const ifMatch = req.headers['if-match'];
        if (ifMatch && ifMatch !== '*' && ifMatch !== current.meta.etag) throw new HttpError(412, 'Changed by another device', { ETag: current.meta.etag });
        await store.delete(id);
        store.noteCreated(-1);
      });
      res.writeHead(204);
      return void res.end();
    }

    throw new HttpError(405, 'Method not allowed', { Allow: 'GET, PUT, DELETE, OPTIONS' });
  }

  const server = createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res)
      .catch((e: unknown) => {
        const err = e instanceof HttpError ? e : new HttpError(500, 'Internal error');
        if (!(e instanceof HttpError)) log(`error: ${e instanceof Error ? e.message : String(e)}`);
        if (res.headersSent) return void res.destroy();
        // A rejected upload may still be streaming: close the connection after replying instead of reading it.
        const close: Record<string, string> = err.status === 413 || err.status === 503 ? { Connection: 'close' } : {};
        res.writeHead(err.status, { ...err.headers, ...close, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      })
      .finally(() => log(`${req.method} ${req.url?.startsWith('/v1/sync/') ? '/v1/sync/…' : req.url} ${res.statusCode} ${Date.now() - t0}ms`));
  });
  // Unused spaces go, so abandoned ones don't fill the server: once at start, then daily.
  const expireDays = opts.expireDays ?? 180;
  if (expireDays > 0) {
    const sweep = () =>
      store
        .sweep(expireDays * 86_400_000)
        .then((n) => n && log(`expired ${n} sync space(s) unused for ${expireDays} days`))
        .catch((e: unknown) => log(`sweep failed: ${e instanceof Error ? e.message : String(e)}`));
    void sweep();
    const timer = setInterval(sweep, 86_400_000);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return Object.assign(server, { store });
}
