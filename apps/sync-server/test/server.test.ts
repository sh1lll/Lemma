import { buildSnapshot, CorruptFileError, encrypt, LEGACY, liveRecords, type SyncRecord, type SyncSnapshot } from '@lemma/sync-engine';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_ID_SALT, serverCredentials, serverIdSalt, syncWithServer, type ServerSyncOptions } from '../../web/src/sync';
import { RateLimiter } from '../src/rate-limit';
import { createSyncServer, type SyncServerOptions } from '../src/server';

const PASS = 'purple elephant tuesday 42';
const ITER = 1000; // sync-ID derivation in tests only; the encryption KDF always uses 600,000 rounds

type Srv = ReturnType<typeof createSyncServer>;
const servers: { srv: Srv; dir: string }[] = [];

async function start(opts: Partial<SyncServerOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'lemmasync-'));
  const srv = createSyncServer({ dataDir: dir, ...opts });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push({ srv, dir });
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, dir, srv };
}

afterAll(async () => {
  for (const { srv, dir } of servers) {
    await new Promise((r) => srv.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

/** An in-memory device: its snapshot is the "local storage". */
function device(name: string, history: string[] = []) {
  const now = Date.now();
  const recs: SyncRecord[] = history.map((h, i) => ({ id: `${name}-${i}`, updated: now + i, device: name, input: h }));
  const d = {
    snap: buildSnapshot({ deviceId: name, collections: { history: recs }, now }) as SyncSnapshot,
    add(input: string) {
      const list = d.snap.collections.history ?? [];
      d.snap = { ...d.snap, collections: { ...d.snap.collections, history: [...list, { id: `${name}-${list.length}-${Math.random()}`, updated: Date.now(), device: name, input }] } };
    },
    inputs: () => liveRecords<{ input: string }>(d.snap.collections.history).map((r) => r.input).sort(),
    opts: (extra: Partial<ServerSyncOptions> = {}): ServerSyncOptions => ({
      iterations: ITER,
      confirmCreate: () => true,
      local: () => ({ snap: d.snap, commit: (m) => (d.snap = m) }),
      ...extra,
    }),
  };
  return d;
}

const blobFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const shard of await readdir(dir)) for (const f of await readdir(join(dir, shard))) out.push(join(dir, shard, f));
  return out;
};

describe('sync server', () => {
  let base: string;
  let dir: string;
  beforeAll(async () => ({ url: base, dir } = await start({ createsPerHour: 1000 }))); // many spaces from one IP

  it('reports health', async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });

  it('two devices sync through it and end up with the same data; the server holds only ciphertext', async () => {
    const a = device('A', ['12+8', 'secret-marker-7731']);
    const b = device('B', ['sqrt 2']);
    let asked = 0;
    const first = await syncWithServer(base, PASS, a.opts({ confirmCreate: () => (asked++, true) }));
    expect(first).toMatchObject({ created: true, uploaded: true });
    expect(asked).toBe(1);
    const second = await syncWithServer(base, PASS, b.opts({ confirmCreate: () => (asked++, true) }));
    expect(asked).toBe(1); // data existed: no "start a new sync space?" question
    expect(second.changedHere).toBe(true);
    expect(second.summary).toMatch(/2 history entries added/);
    await syncWithServer(base, PASS, a.opts());
    expect(a.inputs()).toEqual(['12+8', 'secret-marker-7731', 'sqrt 2']);
    expect(b.inputs()).toEqual(a.inputs());

    // Nothing changed since: the next sync downloads but does not upload.
    expect(await syncWithServer(base, PASS, a.opts())).toMatchObject({ uploaded: false, summary: 'Already up to date' });

    for (const f of await blobFiles(dir)) {
      const raw = await readFile(f);
      expect(raw.includes('secret-marker-7731')).toBe(false);
      expect(raw.includes(PASS)).toBe(false);
      expect(raw.includes('LEMMENC1')).toBe(true);
    }
  });

  it('a concurrent write makes the slower device get 412, re-download, merge and retry', async () => {
    const pass = 'another long passphrase 42';
    const a = device('A', ['a1']);
    const b = device('B', ['b1']);
    await syncWithServer(base, pass, a.opts());
    a.add('a2');
    let raced = false;
    const statuses: number[] = [];
    const racingFetch: typeof fetch = async (url, init) => {
      if (init?.method === 'PUT' && !raced) {
        raced = true; // A uploads between B's download and B's upload
        await syncWithServer(base, pass, a.opts());
      }
      const r = await fetch(url, init);
      statuses.push(r.status);
      return r;
    };
    b.add('b2');
    await syncWithServer(base, pass, b.opts({ fetch: racingFetch }));
    expect(statuses).toEqual([200, 412, 200, 200]);
    await syncWithServer(base, pass, a.opts());
    expect(a.inputs()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(b.inputs()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('of many simultaneous writes with the same If-Match, exactly one wins', async () => {
    const { id, token } = await serverCredentials('parallel writers passphrase', serverIdSalt(base), ITER);
    const blob = await encrypt(device('P').snap, 'parallel writers passphrase');
    const url = `${base}/v1/sync/${id}`;
    const auth = { Authorization: `Bearer ${token}` };
    const created = await fetch(url, { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: blob });
    expect(created.status).toBe(201);
    const etag = created.headers.get('ETag')!;
    const again = await fetch(url, { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: blob });
    expect(again.status).toBe(412);
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const body = new Uint8Array(blob);
        body[body.length - 1] = i; // different bytes → different ETags
        return (await fetch(url, { method: 'PUT', headers: { ...auth, 'If-Match': etag }, body })).status;
      }),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(1);
    expect(results.filter((s) => s === 412)).toHaveLength(11);
    expect((await readdir(join(dir, id.slice(0, 2)))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // Deriving the key from the passphrase is deliberately slow; give it room when the whole suite runs at once.
  }, 30_000);

  it('a wrong passphrase never reaches the real data: it maps to a different, empty sync space', async () => {
    const owner = device('O', ['owner data']);
    await syncWithServer(base, 'the real passphrase 123', owner.opts());
    const intruder = device('X', []);
    await expect(syncWithServer(base, 'the real passphrase 124', intruder.opts({ confirmCreate: () => false }))).rejects.toThrow(/cancelled/);
    expect(intruder.inputs()).toEqual([]);

    // Knowing the sync ID without its token is not enough either.
    const { id } = await serverCredentials('the real passphrase 123', serverIdSalt(base), ITER);
    const { token: wrong } = await serverCredentials('the real passphrase 124', serverIdSalt(base), ITER);
    const r = await fetch(`${base}/v1/sync/${id}`, { headers: { Authorization: `Bearer ${wrong}` } });
    expect(r.status).toBe(403);
    const w = await fetch(`${base}/v1/sync/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${wrong}` } });
    expect(w.status).toBe(403);
  });

  it('a tampered blob is rejected by the client and nothing local changes', async () => {
    const pass = 'tamper test passphrase!';
    const a = device('A', ['original']);
    await syncWithServer(base, pass, a.opts());
    const { id } = await serverCredentials(pass, serverIdSalt(base), ITER);
    const file = join(dir, id.slice(0, 2), `${id}.blob`);
    const raw = await readFile(file);
    raw[raw.length - 20] ^= 0x01; // flip one ciphertext bit
    await writeFile(file, raw);
    const b = device('B', ['mine']);
    const before = JSON.stringify(b.snap);
    await expect(syncWithServer(base, pass, b.opts())).rejects.toBeInstanceOf(CorruptFileError);
    expect(JSON.stringify(b.snap)).toBe(before);
  });

  it('survives a restart: data and ETags come back from disk', async () => {
    const pass = 'restart test passphrase';
    const a = device('A', ['persisted']);
    const first = await start();
    await syncWithServer(first.url, pass, a.opts());
    await new Promise((r) => first.srv.close(r));
    // Same address (the sync ID depends on it), same data directory, new process.
    const port = new URL(first.url).port;
    const srv = createSyncServer({ dataDir: first.dir });
    await new Promise<void>((r) => srv.listen(Number(port), '127.0.0.1', r));
    servers.push({ srv, dir: first.dir });
    const b = device('B', []);
    await syncWithServer(first.url, pass, b.opts());
    expect(b.inputs()).toEqual(['persisted']);
  });

  it('the same passphrase on another server is a different space', async () => {
    const { url: other } = await start();
    const pass = 'shared passphrase on two servers';
    const [a, b] = await Promise.all([serverCredentials(pass, serverIdSalt(base), ITER), serverCredentials(pass, serverIdSalt(other), ITER)]);
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });

  it('refuses to start a new space with a weak passphrase, but still finds existing data', async () => {
    const weak = 'short pass 12';
    await expect(syncWithServer(base, weak, device('W').opts())).rejects.toThrow(/stronger passphrase/);
    // An existing space under the fixed salt keeps working with the same weak passphrase.
    const { id, token } = await serverCredentials(weak, SERVER_ID_SALT, ITER);
    const r = await fetch(`${base}/v1/sync/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' }, body: await encrypt(device('O', ['old']).snap, weak) });
    expect(r.status).toBe(201);
    const w = device('W', []);
    await syncWithServer(base, weak, w.opts({ confirmCreate: () => { throw new Error('must not ask'); } }));
    expect(w.inputs()).toEqual(['old']);
  });

  for (const [name, salt] of [['the fixed salt', SERVER_ID_SALT], ['the pre-rename salt', LEGACY.syncIdSalt]] as const) {
    it(`moves a space stored under ${name} to the new ID, even when this device already has the same data`, async () => {
      const pass = `moving from ${name} passphrase`;
      const a = device('A', ['moved']);
      const old = await serverCredentials(pass, salt, ITER);
      const put = await fetch(`${base}/v1/sync/${old.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${old.token}`, 'If-None-Match': '*' }, body: await encrypt(a.snap, pass) });
      expect(put.status).toBe(201);
      const r = await syncWithServer(base, pass, a.opts({ confirmCreate: () => { throw new Error('must not ask'); } }));
      expect(r).toMatchObject({ created: false, uploaded: true });
      const neu = await serverCredentials(pass, serverIdSalt(base), ITER);
      expect((await fetch(`${base}/v1/sync/${neu.id}`, { headers: { Authorization: `Bearer ${neu.token}` } })).status).toBe(200);
      // Next time it is found directly: nothing to upload.
      expect(await syncWithServer(base, pass, a.opts())).toMatchObject({ uploaded: false });
    });
  }
});

describe('limits and protocol checks', () => {
  const okBlob = async () => encrypt(device('L').snap, 'limits passphrase 99');
  const creds = () => serverCredentials('limits passphrase 99', SERVER_ID_SALT, ITER); // any salt: raw requests

  it('rejects bad requests with precise statuses', async () => {
    const { url } = await start({ maxBlobBytes: 4096 });
    const { id, token } = await creds();
    const auth = { Authorization: `Bearer ${token}` };
    const at = `${url}/v1/sync/${id}`;
    expect((await fetch(`${url}/v1/sync/not-hex`, { headers: auth })).status).toBe(400);
    expect((await fetch(at)).status).toBe(401);
    expect((await fetch(at, { headers: { Authorization: 'Bearer xyz' } })).status).toBe(401);
    expect((await fetch(at, { headers: auth })).status).toBe(404);
    expect((await fetch(at, { method: 'PUT', headers: auth, body: await okBlob() })).status).toBe(428);
    expect((await fetch(at, { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: 'plaintext is refused' })).status).toBe(415);
    expect((await fetch(at, { method: 'PUT', headers: { ...auth, 'If-Match': '"nope"' }, body: await okBlob() })).status).toBe(412);
    const big = new Uint8Array(5000);
    big.set(new TextEncoder().encode('LEMMENC1'));
    expect((await fetch(at, { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: big })).status).toBe(413);
    expect((await fetch(`${url}/v1/other`, { headers: auth })).status).toBe(404);
    expect((await fetch(at, { method: 'POST', headers: auth })).status).toBe(405);
    const put = await fetch(at, { method: 'PUT', headers: { ...auth, 'If-None-Match': '*' }, body: await okBlob() });
    expect(put.status).toBe(201);
    const get = await fetch(at, { headers: { ...auth, 'If-None-Match': put.headers.get('ETag')! } });
    expect(get.status).toBe(304);
    expect((await fetch(at, { method: 'DELETE', headers: auth })).status).toBe(204);
    expect((await fetch(at, { headers: auth })).status).toBe(404);
  });

  it('caps the number of sync spaces', async () => {
    const { url } = await start({ maxSpaces: 1 });
    const blob = await okBlob();
    for (const [p, status] of [['space one passphrase', 201], ['space two passphrase', 507]] as const) {
      const { id, token } = await serverCredentials(p, SERVER_ID_SALT, ITER);
      const r = await fetch(`${url}/v1/sync/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' }, body: blob });
      expect(r.status).toBe(status);
    }
  });

  const create = async (url: string, p: string, body: Uint8Array, headers: Record<string, string> = {}) => {
    const { id, token } = await serverCredentials(p, SERVER_ID_SALT, ITER);
    const r = await fetch(`${url}/v1/sync/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*', ...headers }, body });
    return { r, id, token };
  };

  it('limits new spaces per IP much more tightly than requests; updates are not limited by it', async () => {
    const { url } = await start({ createsPerHour: 2 });
    const blob = await okBlob();
    const first = await create(url, 'create limit one', blob);
    expect(first.r.status).toBe(201);
    expect((await create(url, 'create limit two', blob)).r.status).toBe(201);
    const third = await create(url, 'create limit three', blob);
    expect(third.r.status).toBe(429);
    expect(Number(third.r.headers.get('Retry-After'))).toBeGreaterThan(60);
    const upd = await fetch(`${url}/v1/sync/${first.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${first.token}`, 'If-Match': first.r.headers.get('ETag')! }, body: blob });
    expect(upd.status).toBe(200);
  });

  it('behind a proxy, uses the last X-Forwarded-For entry (a client-supplied first one cannot dodge limits)', async () => {
    const { url } = await start({ createsPerHour: 1, trustProxy: true });
    const blob = await okBlob();
    expect((await create(url, 'xff one', blob, { 'X-Forwarded-For': '1.1.1.1, 9.9.9.9' })).r.status).toBe(201);
    expect((await create(url, 'xff two', blob, { 'X-Forwarded-For': '2.2.2.2, 9.9.9.9' })).r.status).toBe(429);
    expect((await create(url, 'xff three', blob, { 'X-Forwarded-For': '1.1.1.1, 8.8.8.8' })).r.status).toBe(201);
  });

  it('caps upload bytes held in memory and frees them after each request', async () => {
    const blob = await okBlob();
    const { url: tight } = await start({ maxInflightBytes: blob.length - 1 });
    const busy = await create(tight, 'inflight busy', blob);
    expect(busy.r.status).toBe(503);
    expect(busy.r.headers.get('Retry-After')).toBeTruthy();
    const { url } = await start({ maxInflightBytes: blob.length });
    for (const p of ['inflight one', 'inflight two', 'inflight three']) expect((await create(url, p, blob)).r.status).toBe(201);
    expect((await create(url, 'inflight bad', new Uint8Array(blob.length))).r.status).toBe(415); // freed on errors too
    expect((await create(url, 'inflight four', blob)).r.status).toBe(201);
  });

  it('removes the temp file when writing it fails', async () => {
    const { srv, dir } = await start();
    const store = srv.store;
    const id = 'ab'.repeat(32);
    const huge = { length: 1 } as unknown as Buffer; // not a buffer: writev throws after the temp file exists
    await expect(store.put(id, { tokenHash: '', etag: '""', size: 1, updated: 0 }, huge)).rejects.toThrow();
    expect(await readdir(join(dir, 'ab'))).toEqual([]);
  });

  it('rate-limits per IP and says when to retry', async () => {
    const { url } = await start({ rateLimitPerMinute: 5 });
    const { id, token } = await creds();
    const statuses: number[] = [];
    let retry: string | null = null;
    for (let i = 0; i < 7; i++) {
      const r = await fetch(`${url}/v1/sync/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      statuses.push(r.status);
      if (r.status === 429) retry = r.headers.get('Retry-After');
    }
    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(Number(retry)).toBeGreaterThan(0);
    expect((await fetch(`${url}/healthz`)).status).toBe(200); // health checks are not limited
  });

  it('the limiter refills over time and forgets idle clients', () => {
    let t = 0;
    const l = new RateLimiter(60, 2, 10, () => t);
    expect([l.take('ip'), l.take('ip')]).toEqual([0, 0]);
    expect(l.take('ip')).toBe(1);
    t += 1000;
    expect(l.take('ip')).toBe(0);
    for (let i = 0; i < 30; i++) l.take(`ip${i}`); // more keys than maxKeys: still bounded, still works
    t += 60_000;
    l.sweep();
    expect(l.take('new')).toBe(0);
  });

  it('CORS: allowed origins get headers (ETag exposed), others are refused', async () => {
    const { url } = await start({ allowedOrigins: ['https://lemma.app'] });
    const pre = await fetch(`${url}/v1/sync/${'a'.repeat(64)}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://lemma.app', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,if-match' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://lemma.app');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/If-Match/);
    const h = await fetch(`${url}/healthz`, { headers: { Origin: 'https://lemma.app' } });
    expect(h.headers.get('access-control-expose-headers')).toMatch(/ETag/);
    const bad = await fetch(`${url}/v1/sync/${'a'.repeat(64)}`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('expiry', () => {
  it('deletes spaces unused past the limit and stray temp files, and keeps the rest', async () => {
    const { FileStore, sha256 } = await import('../src/storage');
    const { utimes } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'lemma-expire-'));
    const store = new FileStore(dir);
    const meta = { tokenHash: sha256('t'), etag: '"x"', size: 1, updated: 0 };
    const [oldId, freshId, readId] = ['a', 'b', 'c'].map((c) => c.repeat(64));
    for (const id of [oldId, freshId, readId]) await store.put(id, meta, Buffer.from('x'));
    const day = 86_400_000;
    const longAgo = new Date(Date.now() - 200 * day);
    for (const id of [oldId, readId]) await utimes(join(dir, id.slice(0, 2), `${id}.blob`), longAgo, longAgo);
    await writeFile(join(dir, 'aa', '.stray.tmp'), 'x');
    await utimes(join(dir, 'aa', '.stray.tmp'), longAgo, longAgo);
    expect(await store.spaces()).toBe(3);
    await store.get(readId); // reading counts as use
    await new Promise((r) => setTimeout(r, 50));
    expect(await store.sweep(180 * day)).toBe(1);
    expect(await store.get(oldId)).toBeNull();
    expect(await store.get(freshId)).not.toBeNull();
    expect(await store.get(readId)).not.toBeNull();
    expect(await readdir(join(dir, 'aa'))).toEqual([]);
    expect(await store.spaces()).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});
