// Lemma was called OMNIMATH before (the web side's list of old names is packages/sync-engine/src/legacy.ts).
// The desktop app kept its data in a folder named after the old package, and served its pages from the old
// address; the browser engine files storage by address, so it can't be renamed in place. On the first start after
// the rename this moves the folder, then opens the old address once, unseen, and exports what was stored there;
// the web app (apps/web/src/legacy.ts) writes it under the new names. Delete this file and its three uses
// (main.mjs, preload.cjs) once no installation from before the rename is left.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, ipcMain, protocol } from 'electron';

export const LEGACY_SCHEME = 'omnimath';
const LEGACY_FOLDER = ['@omnimath', 'desktop'];
const DONE = 'legacy-moved';
const DUMP = 'legacy-dump.json';

/**
 * Before anything reads the data folder: what's in the old one moves into the new one (moved, so nothing is
 * duplicated). Electron has usually created the new folder by now, so this goes item by item, and anything already
 * in the new folder stays as it is.
 */
export function moveLegacyFolder(appData, userData) {
  const old = path.join(appData, ...LEGACY_FOLDER);
  if (!fs.existsSync(old) || fs.existsSync(path.join(userData, DONE))) return;
  fs.mkdirSync(userData, { recursive: true });
  for (const item of fs.readdirSync(old)) {
    const to = path.join(userData, item);
    if (!fs.existsSync(to)) fs.renameSync(path.join(old, item), to);
  }
  for (const dir of [old, path.dirname(old)]) {
    try {
      fs.rmdirSync(dir); // only if now empty
    } catch {
      /* something stayed behind (already present in the new folder): leave it */
    }
  }
}

// Runs at the old address: everything in localStorage and IndexedDB, blobs as base64, posted back to the shell.
const EXPORT_PAGE = `<!doctype html><meta charset="utf-8"><script>
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
async function pack(v) {
  if (v instanceof Blob) return { '\\u0000blob': v.type, data: b64(await v.arrayBuffer()) };
  if (v instanceof ArrayBuffer) return { '\\u0000bytes': b64(v) };
  if (ArrayBuffer.isView(v)) return { '\\u0000bytes': b64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) };
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === 'object' && !(v instanceof Date)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await pack(x); return o; }
  return v;
}
const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
(async () => {
  const local = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k); }
  const databases = [];
  for (const info of (await indexedDB.databases?.()) ?? []) {
    const db = await req(indexedDB.open(info.name));
    const names = [...db.objectStoreNames];
    if (!names.length) { db.close(); continue; }
    const tx = db.transaction(names, 'readonly');
    const stores = [];
    for (const n of names) {
      const os = tx.objectStore(n);
      const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
      const indexes = [...os.indexNames].map((i) => { const ix = os.index(i); return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }; });
      const rows = []; for (let i = 0; i < keys.length; i++) rows.push([await pack(keys[i]), await pack(values[i])]);
      stores.push({ name: n, keyPath: os.keyPath, autoIncrement: os.autoIncrement, indexes, rows });
    }
    databases.push({ name: info.name, version: db.version, stores });
    db.close();
  }
  // Nothing there (a fresh install: the engine makes empty storage folders early): no import, no reload.
  const empty = !Object.keys(local).length && !databases.length;
  await fetch('/__export', { method: 'POST', body: empty ? 'null' : JSON.stringify({ local, databases }) });
})().catch((e) => fetch('/__export', { method: 'POST', body: 'null' }));
</script>`;

/**
 * After the app is ready, before the main window opens: export the old address's storage (once). The protocol
 * for the old address serves only the export page and takes its result; nothing else is ever loaded there.
 */
export async function exportLegacyStorage(userData) {
  const done = path.join(userData, DONE);
  if (fs.existsSync(done)) return;
  const hasStorage = ['Local Storage', 'IndexedDB'].some((d) => fs.existsSync(path.join(userData, d)));
  if (!hasStorage) return fs.writeFileSync(done, new Date().toISOString());
  let finish;
  const got = new Promise((ok) => (finish = ok));
  protocol.handle(LEGACY_SCHEME, async (req) => {
    const { pathname } = new URL(req.url);
    if (pathname !== '/__export') return new Response('Not found', { status: 404 });
    if (req.method !== 'POST') return new Response(EXPORT_PAGE, { headers: { 'Content-Type': 'text/html' } });
    finish(await req.text());
    return new Response('ok');
  });
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  void win.loadURL(`${LEGACY_SCHEME}://app/__export`);
  const dump = await Promise.race([got, new Promise((ok) => setTimeout(() => ok('null'), 20_000))]);
  win.destroy();
  protocol.unhandle(LEGACY_SCHEME);
  if (dump && dump !== 'null') fs.writeFileSync(path.join(userData, DUMP), dump);
  else fs.writeFileSync(done, new Date().toISOString());
}

/** The web app asks for the export once, writes it under the new names, then says it's done. */
export function registerLegacy(userData, trustedSender) {
  ipcMain.handle('legacy:dump', (e) => {
    if (!trustedSender(e)) return null;
    const f = path.join(userData, DUMP);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });
  ipcMain.on('legacy:done', (e) => {
    if (!trustedSender(e)) return;
    fs.rmSync(path.join(userData, DUMP), { force: true });
    fs.writeFileSync(path.join(userData, DONE), new Date().toISOString());
  });
}
