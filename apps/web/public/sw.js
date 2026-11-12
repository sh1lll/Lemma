// Offline support.
// - Build files under /assets/ have content-hashed names, so a cached copy is never stale: cache-first.
// - The app shell ("/"), the manifest and the icons keep their names across deploys: network-first, with the
//   cached copy as the offline fallback (cache-first would pin an old manifest/icon forever).
// - Every deploy leaves the previous build's files behind. Whenever a new shell is seen (and on activate),
//   cached build files the current shell can no longer reach are marked, and deleted at the next check if still
//   unreachable, so the cache holds at most one build's leftovers instead of growing with every deploy.
const SHELL_CACHE = 'lemma-shell-v3';
const ASSET_CACHE = 'lemma-assets-v3';
// Versioned, immutable third-party runtimes (Pyodide/SymPy) are cached so the algebra engine works offline.
const CDN_CACHE = 'lemma-cdn-v1';
const KEEP = [SHELL_CACHE, ASSET_CACHE, CDN_CACHE];
const CDN_PREFIXES = ['https://cdn.jsdelivr.net/pyodide/', 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@'];
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

const isBuildFile = (url) => url.origin === location.origin && url.pathname.startsWith('/assets/');

self.addEventListener('install', (e) => {
  // "no-cache" so a fresh install never stores a stale HTTP-cached shell. Icons are best-effort.
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? c.put(u, r) : u === '/' ? Promise.reject(new Error('shell')) : null), (err) => (u === '/' ? Promise.reject(err) : null)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      // Older caches (lemma-v2 kept every build's files under one name) go entirely, after their build files move
      // over so the app keeps working offline; the prune below drops the ones the current shell can't reach.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lemma-') && !KEEP.includes(k)).map((k) => adopt(k).then(() => caches.delete(k)))))
      .then(() => self.clients.claim())
      .then(() => caches.match('/', { cacheName: SHELL_CACHE }))
      .then((res) => (res ? res.text().then(pruneBuildFiles) : null))
      .catch(() => {}),
  );
});

/** Copies an old cache's build files into the current asset cache. */
async function adopt(name) {
  const from = await caches.open(name);
  const to = await caches.open(ASSET_CACHE);
  for (const req of await from.keys()) {
    if (!isBuildFile(new URL(req.url)) || (await to.match(req))) continue;
    const res = await from.match(req);
    if (res && res.status === 200) await to.put(new URL(req.url).pathname, res);
  }
}

/** File names a text asset refers to: "./chunk-AbC123.js", "assets/x-Q1w2E3r4.css", url(/assets/font-….woff2). */
function referencedNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/[\w.-]+\.(?:m?js|css|wasm|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|json|onnx|data|zip|whl|txt)\b/g)) out.add(m[0]);
  return out;
}

const PENDING = '/__sw/prune-pending';

/**
 * Deletes cached build files the given shell can't reach. Reachability follows references through the shell's
 * own files (fetched if this page hasn't cached them yet) and then through cached files only: a file behind an
 * uncached chunk could not be used offline anyway. A file is deleted only when it is unreachable at two checks in
 * a row, because the page that triggered the first check may still be loading (and caching) the new build's lazy
 * chunks: an unchanged chunk the new build still uses is reachable again by the next check.
 */
async function pruneBuildFiles(shellHtml) {
  const cache = await caches.open(ASSET_CACHE);
  const shell = await caches.open(SHELL_CACHE);
  const cached = new Map(); // file name → Request
  for (const req of await cache.keys()) cached.set(new URL(req.url).pathname.replace(/^\/assets\//, ''), req);
  const reachable = new Set();
  const queue = [];
  const visit = (name) => {
    if (reachable.has(name)) return;
    reachable.add(name);
    if (/\.(?:m?js|css)$/.test(name)) queue.push(name);
  };
  const direct = [...shellHtml.matchAll(/(?:src|href)=["']\/?assets\/([^"'?#]+)/g)].map((m) => m[1]);
  for (const name of direct) visit(name);
  while (queue.length) {
    const name = queue.shift();
    let res = await cache.match('/assets/' + name);
    if (!res && direct.includes(name)) {
      try {
        const net = await fetch('/assets/' + name);
        if (net.ok) {
          await cache.put('/assets/' + name, net.clone());
          res = net;
        }
      } catch {
        // Offline: keep everything rather than prune on partial knowledge.
        return;
      }
    }
    if (!res) continue;
    for (const ref of referencedNames(await res.text())) visit(ref);
  }
  const unreachable = [...cached.keys()].filter((name) => !reachable.has(name));
  const before = await shell.match(PENDING).then((r) => (r ? r.json() : []), () => []);
  const doomed = unreachable.filter((name) => before.includes(name));
  await Promise.all(doomed.map((name) => cache.delete(cached.get(name))));
  const pending = unreachable.filter((name) => !doomed.includes(name));
  await shell.put(PENDING, new Response(JSON.stringify(pending), { headers: { 'content-type': 'application/json' } }));
  return pending.length;
}

/** Network first, falling back to the cache; good responses refresh the cached copy. */
function networkFirst(e, req, key, cacheName, onFresh) {
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(
            caches.open(cacheName).then(async (c) => {
              const old = onFresh ? await c.match(key) : null;
              await c.put(key, copy.clone());
              if (onFresh) await onFresh(copy, old);
            }),
          );
        }
        return res;
      })
      .catch(() => caches.match(key, { cacheName }).then((hit) => hit || Response.error())),
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'GET' && CDN_PREFIXES.some((p) => req.url.startsWith(p))) {
    e.respondWith(
      caches.open(CDN_CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    const isShell = url.pathname === '/' || url.pathname === '/index.html';
    if (!isShell) {
      // Other pages (harnesses, deep links) aren't cached; offline they fall back to the app shell.
      e.respondWith(fetch(req).catch(() => caches.match('/', { cacheName: SHELL_CACHE }).then((hit) => hit || Response.error())));
      return;
    }
    // Only a good copy of the app shell may become the offline fallback. A changed shell means a new deploy:
    // prune the previous build's files.
    networkFirst(e, req, '/', SHELL_CACHE, async (fresh, old) => {
      const html = await fresh.text();
      const changed = !old || (await old.text()) !== html;
      const waiting = await caches.match(PENDING, { cacheName: SHELL_CACHE }).then((r) => (r ? r.json() : []), () => []);
      if (changed || waiting.length) await pruneBuildFiles(html);
    });
    return;
  }

  if (isBuildFile(url)) {
    e.respondWith(
      caches.open(ASSET_CACHE).then((c) =>
        c.match(req, { ignoreSearch: true }).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              // Partial (206) and opaque responses can't be replayed safely; only whole files are cached.
              if (res.status === 200) {
                const copy = res.clone();
                e.waitUntil(c.put(url.pathname, copy));
              }
              return res;
            }),
        ),
      ),
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    // Manifest and icons: always the deployed version when online, the cached one offline.
    networkFirst(e, req, url.pathname, SHELL_CACHE);
  }
  // Anything else same-origin goes to the network untouched.
});
