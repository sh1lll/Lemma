// Folder sync for the desktop app. The renderer encrypts before anything reaches here; this process only stores
// the chosen folder and (optionally) the passphrase, protected by the OS keychain via safeStorage.
import { app, dialog, ipcMain, safeStorage } from 'electron';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_SYNC_BYTES } from './security.mjs';

const FILE = 'Lemma.lemmasync';
const configPath = () => path.join(app.getPath('userData'), 'sync.json');

async function config() {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
const save = async (c) => {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(configPath(), JSON.stringify(c));
};

/** @param {(e: Electron.IpcMainInvokeEvent) => boolean} trusted only the app's own page may use these */
export function registerSync(trusted) {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error('Not allowed');
      return fn(e, ...args);
    });
  handle('sync:status', async () => {
    const c = await config();
    return { folder: c.folder ?? null, hasPassphrase: !!c.passphrase, keychain: safeStorage.isEncryptionAvailable() };
  });
  handle('sync:choose', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder to sync Lemma through', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await save({ ...(await config()), folder: r.filePaths[0] });
    return r.filePaths[0];
  });
  handle('sync:read', async () => {
    const { folder } = await config();
    if (!folder) throw new Error('No sync folder chosen');
    try {
      const file = path.join(folder, FILE);
      // Anything can land in a shared cloud folder; don't pull a multi-GB file into memory.
      if ((await stat(file)).size > MAX_SYNC_BYTES) throw new Error('The sync file is too large to be an Lemma sync file');
      return new Uint8Array(await readFile(file));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  });
  handle('sync:write', async (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SYNC_BYTES) throw new Error('Sync data must be bytes, at most 64 MB');
    const { folder } = await config();
    if (!folder) throw new Error('No sync folder chosen');
    // Write then rename, so a cloud client never picks up a half-written file.
    const tmp = path.join(folder, `${FILE}.tmp`);
    await writeFile(tmp, Buffer.from(bytes));
    await rename(tmp, path.join(folder, FILE));
  });
  handle('sync:save-passphrase', async (_e, p) => {
    if (p != null && typeof p !== 'string') throw new Error('Passphrase must be text');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available');
    await save({ ...(await config()), passphrase: p ? safeStorage.encryptString(p).toString('base64') : undefined });
  });
  handle('sync:passphrase', async () => {
    const c = await config();
    if (!c.passphrase || !safeStorage.isEncryptionAvailable()) return null;
    // A keychain entry that can't be read (made under the app's old name, or on another computer): ask again.
    try {
      return safeStorage.decryptString(Buffer.from(c.passphrase, 'base64'));
    } catch {
      return null;
    }
  });
}
