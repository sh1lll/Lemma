// The built-in assistant model. It runs in a utility process (llm-worker.mjs): a model too big for this computer
// aborts that process, not the app, and the assistant says so instead of the window vanishing.
// Qwen3 1.7B is one such model under Electron (V8 sandbox buffer limits), so the default is the 0.6B model.
import { app, ipcMain, utilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidModelId } from './security.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let worker = null;
let seq = 0;
/** Requests waiting on the worker: rid → { resolve, reject, onProgress } */
const pending = new Map();

const STOPPED =
  'The built-in model stopped: it needs more memory than it can get here. Choose Qwen3 0.6B in Settings → Assistant, or use another provider.';

function ensureWorker() {
  if (worker) return worker;
  const w = utilityProcess.fork(path.join(here, 'llm-worker.mjs'), [path.join(app.getPath('userData'), 'models')], { serviceName: 'Lemma assistant model' });
  w.on('message', (m) => {
    if (m.type === 'token') return tokenSinks.get(m.id)?.(m.text);
    const p = pending.get(m.rid);
    if (!p) return;
    if (m.type === 'progress') return p.onProgress?.(m.percent);
    pending.delete(m.rid);
    if (m.type === 'done') p.resolve(m.result);
    else p.reject(new Error(m.message));
  });
  w.on('exit', () => {
    if (worker === w) worker = null;
    for (const p of pending.values()) p.reject(new Error(STOPPED));
    pending.clear();
  });
  worker = w;
  return w;
}

/** Streamed tokens for each generation id, to the page that asked. */
const tokenSinks = new Map();

function request(msg, onProgress) {
  const rid = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(rid, { resolve, reject, onProgress });
    ensureWorker().postMessage({ ...msg, rid });
  });
}

/** @param {(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean} trusted only the app's own page may use the model */
export function registerLocalModel(trusted) {
  ipcMain.handle('llm:load', async (e, id) => {
    if (!trusted(e)) throw new Error('Not allowed');
    // The id becomes a download URL and a folder under the model cache: accept Hugging Face repo ids only.
    if (!isValidModelId(id)) throw new Error(`Not a Hugging Face model id: ${String(id).slice(0, 100)}`);
    await request({ type: 'load', id }, (percent) => e.sender.send('llm:progress', percent));
    return { model: id, device: 'native' };
  });

  ipcMain.handle('llm:generate', async (e, { id, model: modelId, req }) => {
    if (!trusted(e)) throw new Error('Not allowed');
    if (!isValidModelId(modelId)) throw new Error(`Not a Hugging Face model id: ${String(modelId).slice(0, 100)}`);
    tokenSinks.set(id, (text) => !e.sender.isDestroyed() && e.sender.send('llm:token', { id, text }));
    try {
      return await request({ type: 'generate', id, model: modelId, req }, (percent) => e.sender.send('llm:progress', percent));
    } finally {
      tokenSinks.delete(id);
    }
  });

  ipcMain.on('llm:abort', (e, id) => trusted(e) && worker?.postMessage({ type: 'abort', id }));
  app.on('will-quit', () => worker?.kill());
}
