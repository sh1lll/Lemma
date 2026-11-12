import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Runs public/sw.js against an in-memory Cache API and a fake network, through two deploys and an outage.
 * (A real-browser run of the same flow, including the v2 → v3 cache migration, was done while writing it.)
 */
const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://lemma.test';

type Site = Record<string, string>;

function harness(initial: Site) {
  let site = initial;
  let online = true;
  const stores = new Map<string, Map<string, Response>>();
  type Req = { url: string } | string;
  const key = (r: Req) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: Req, o?: { ignoreSearch?: boolean }) => {
        const k = key(r);
        const hit = m.get(o?.ignoreSearch ? k.split('?')[0]! : k);
        return hit?.clone();
      },
      put: async (r: Req, res: Response) => void m.set(key(r), res.clone()),
      delete: async (r: Req) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((k) => new Request(k)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: Req, o?: { cacheName?: string }) => {
      for (const n of o?.cacheName ? [o.cacheName] : [...stores.keys()]) {
        const hit = await (await open(n)).match(r);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const fetchFn = async (r: Req) => {
    if (!online) throw new TypeError('offline');
    const path = new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
    const body = site[path];
    return body === undefined ? new Response('nf', { status: 404 }) : new Response(body, { status: 200 });
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } };
  new Function('self', 'caches', 'fetch', 'location', 'Response', 'Request', 'URL', SOURCE)(self, caches, fetchFn, new URL(ORIGIN), Response, Request, URL);

  /** Dispatches an event and waits for everything it handed to waitUntil / respondWith. */
  async function dispatch(type: string, extra: object = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const e = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (response = p) };
    listeners[type]!(e);
    const res = response ? await response : undefined;
    // waitUntil can be called later (inside respondWith's chain); settle until nothing new arrives.
    for (let n = 0; n < waits.length; n++) await waits[n];
    return res;
  }
  const get = (path: string, mode: 'navigate' | 'same-origin' = 'same-origin') =>
    dispatch('fetch', { request: { url: ORIGIN + path, method: 'GET', mode } }).then(async (r) => (r ? { status: r.status, text: r.type === 'error' ? null : await r.text() } : null));
  return {
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    get,
    deploy: (s: Site) => (site = s),
    setOnline: (v: boolean) => (online = v),
    seed: async (name: string, entries: Site) => {
      const c = await open(name);
      for (const [p, b] of Object.entries(entries)) await c.put(p, new Response(b));
    },
    assets: () => [...(stores.get('lemma-assets-v3')?.keys() ?? [])].map((k) => new URL(k).pathname).sort(),
    cacheNames: () => [...stores.keys()].sort(),
  };
}

const v1: Site = {
  '/': '<script type="module" src="/assets/index-AAAAAAAA.js"></script>',
  '/assets/index-AAAAAAAA.js': `import('./lazy-LLLLLLLL.js')`,
  '/assets/lazy-LLLLLLLL.js': `import './shared-SSSSSSSS.js'; new URL('model-OLD11111.wasm', import.meta.url)`,
  '/assets/shared-SSSSSSSS.js': 'export const s = 1',
  '/assets/model-OLD11111.wasm': 'big',
  '/manifest.webmanifest': '{"name":"v1"}',
  '/icon.svg': '<svg>v1</svg>',
};
const v2: Site = {
  '/': '<script type="module" src="/assets/index-BBBBBBBB.js"></script>',
  '/assets/index-BBBBBBBB.js': `import('./lazy-MMMMMMMM.js')`,
  '/assets/lazy-MMMMMMMM.js': `import './shared-SSSSSSSS.js'`,
  '/assets/shared-SSSSSSSS.js': 'export const s = 1',
  '/manifest.webmanifest': '{"name":"v2"}',
  '/icon.svg': '<svg>v2</svg>',
};
const loadApp = async (h: ReturnType<typeof harness>, site: Site) => {
  await h.get('/', 'navigate');
  for (const p of Object.keys(site).filter((p) => p.startsWith('/assets/'))) await h.get(p);
};

describe('service worker', () => {
  it('drops the previous build after a deploy, keeps files the new build still uses, and works offline', async () => {
    const h = harness(v1);
    await h.install();
    await h.activate();
    await loadApp(h, v1);
    expect(h.assets()).toEqual(['/assets/index-AAAAAAAA.js', '/assets/lazy-LLLLLLLL.js', '/assets/model-OLD11111.wasm', '/assets/shared-SSSSSSSS.js']);

    h.deploy(v2);
    // The first visit after a deploy only marks old files (the page may still be caching the new build's chunks)…
    await h.get('/', 'navigate');
    await h.get('/assets/index-BBBBBBBB.js');
    await h.get('/assets/lazy-MMMMMMMM.js');
    await h.get('/assets/shared-SSSSSSSS.js');
    expect(h.assets()).toContain('/assets/model-OLD11111.wasm');
    // …the next one deletes those still unreachable. The unchanged shared chunk survives.
    await h.get('/', 'navigate');
    expect(h.assets()).toEqual(['/assets/index-BBBBBBBB.js', '/assets/lazy-MMMMMMMM.js', '/assets/shared-SSSSSSSS.js']);

    // Manifest and icon follow the deploy online, and come from the cache offline.
    expect((await h.get('/manifest.webmanifest'))!.text).toBe('{"name":"v2"}');
    expect((await h.get('/icon.svg'))!.text).toBe('<svg>v2</svg>');
    h.setOnline(false);
    expect((await h.get('/', 'navigate'))!.text).toBe(v2['/']);
    expect((await h.get('/manifest.webmanifest'))!.text).toBe('{"name":"v2"}');
    expect((await h.get('/assets/lazy-MMMMMMMM.js'))!.text).toBe(v2['/assets/lazy-MMMMMMMM.js']);
    // Offline navigations never prune.
    expect(h.assets()).toHaveLength(3);
  });

  it('migrates the old single cache: deletes it but keeps its build files for offline use', async () => {
    const h = harness(v1);
    await h.seed('lemma-v2', { ...v1, '/assets/index-OLDBUILD.js': 'stale' });
    await h.install();
    await h.activate();
    expect(h.cacheNames()).toEqual(['lemma-assets-v3', 'lemma-shell-v3']);
    expect(h.assets()).toContain('/assets/lazy-LLLLLLLL.js');
    h.setOnline(false);
    expect((await h.get('/assets/lazy-LLLLLLLL.js'))!.text).toBe(v1['/assets/lazy-LLLLLLLL.js']);
    h.setOnline(true);
    // The stale build's entry is unreachable: marked at activate, gone at the next check.
    await h.get('/', 'navigate');
    expect(h.assets()).not.toContain('/assets/index-OLDBUILD.js');
    expect(h.assets()).toContain('/assets/lazy-LLLLLLLL.js');
  });
});
