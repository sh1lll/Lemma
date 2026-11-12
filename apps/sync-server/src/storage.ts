import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * File-system storage for encrypted sync blobs. One file per sync space, written atomically
 * (temp file, fsync, rename), so a crash leaves either the old or the new version, never half of one.
 *
 * File layout: 4-byte big-endian meta length, meta JSON, then the blob bytes exactly as the client sent them.
 * The server never sees a passphrase or plaintext: only the client-encrypted blob, a SHA-256 of the
 * client's access token, and the blob's SHA-256 (used as the ETag).
 */

export interface StoredMeta {
  /** SHA-256 hex of the bearer token that created this space. */
  tokenHash: string;
  /** Quoted strong ETag: "sha256-hex". */
  etag: string;
  size: number;
  updated: number;
}

export interface Stored {
  meta: StoredMeta;
  blob: Buffer;
}

export const ID_PATTERN = /^[0-9a-f]{64}$/;
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export const etagOf = (blob: Buffer) => `"${sha256(blob)}"`;

/** Constant-time comparison of a presented token with the stored hash. */
export function tokenMatches(token: string, tokenHash: string): boolean {
  const a = Buffer.from(sha256(token), 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class FileStore {
  private locks = new Map<string, Promise<unknown>>();
  private count = -1;

  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private path(id: string) {
    if (!ID_PATTERN.test(id)) throw new Error('bad id');
    return join(this.dir, id.slice(0, 2), `${id}.blob`);
  }

  /** Number of sync spaces on disk (counted once, then tracked). */
  async spaces(): Promise<number> {
    if (this.count >= 0) return this.count;
    let n = 0;
    await mkdir(this.dir, { recursive: true });
    for (const shard of await readdir(this.dir, { withFileTypes: true })) {
      if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
      for (const f of await readdir(join(this.dir, shard.name))) if (f.endsWith('.blob')) n++;
    }
    this.count = n;
    return n;
  }

  async get(id: string): Promise<Stored | null> {
    let raw: Buffer;
    try {
      raw = await readFile(this.path(id));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    // A read counts as use, so a space that's only ever downloaded from doesn't expire (see sweep).
    const now = new Date();
    void utimes(this.path(id), now, now).catch(() => undefined);
    const len = raw.readUInt32BE(0);
    const meta = JSON.parse(raw.subarray(4, 4 + len).toString('utf8')) as StoredMeta;
    return { meta, blob: raw.subarray(4 + len) };
  }

  /** Writes atomically. Callers hold the lock for `id`. */
  async put(id: string, meta: StoredMeta, blob: Buffer): Promise<void> {
    const file = this.path(id);
    const dir = join(this.dir, id.slice(0, 2));
    await mkdir(dir, { recursive: true });
    const head = Buffer.from(JSON.stringify(meta), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(head.length, 0);
    const tmp = join(dir, `.${id}.${randomBytes(6).toString('hex')}.tmp`);
    const fh = await open(tmp, 'wx', 0o600);
    try {
      try {
        await fh.writev([len, head, blob]);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    // Make the rename itself durable.
    const dh = await open(dir, 'r').catch(() => null);
    await dh?.sync().catch(() => undefined);
    await dh?.close();
  }

  async delete(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  /**
   * Deletes sync spaces nobody has read or written for `maxAgeMs`, and temp files a crash left behind.
   * Returns how many spaces went.
   */
  async sweep(maxAgeMs: number, now = Date.now()): Promise<number> {
    let removed = 0;
    await mkdir(this.dir, { recursive: true });
    for (const shard of await readdir(this.dir, { withFileTypes: true })) {
      if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
      for (const f of await readdir(join(this.dir, shard.name))) {
        const file = join(this.dir, shard.name, f);
        const st = await stat(file).catch(() => null);
        if (!st) continue;
        const age = now - st.mtimeMs;
        if (f.endsWith('.tmp') && age > 3600_000) await rm(file, { force: true });
        const id = f.slice(0, -5);
        if (!f.endsWith('.blob') || !ID_PATTERN.test(id) || age <= maxAgeMs) continue;
        // Under the space's lock, and re-checked there, so an upload arriving now isn't deleted.
        await this.withLock(id, async () => {
          const s = await stat(file).catch(() => null);
          if (!s || now - s.mtimeMs <= maxAgeMs) return;
          await rm(file, { force: true });
          removed++;
          this.noteCreated(-1);
        });
      }
    }
    return removed;
  }

  noteCreated(delta: 1 | -1) {
    if (this.count >= 0) this.count += delta;
  }

  /** Serialises read-check-write sequences per sync space (single process). */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }
}
