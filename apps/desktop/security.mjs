// Pure security checks for the desktop shell (no Electron import, so they are unit-tested in apps/desktop/test).
import path from 'node:path';

/**
 * Maps an lemma:// request URL to a file inside `root`, or null when it would leave it. A plain
 * `startsWith(root)` check is not enough: "/x/web" is a prefix of the sibling "/x/web-private/…".
 * @param {string} root absolute web root
 * @param {string} url request URL
 * @param {typeof path} [p] path flavour (tests pass path.win32)
 */
export function resolveWebFile(root, url, p = path) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null; // malformed URL or % escape
  }
  if (rel.includes('\0')) return null;
  rel = rel.replace(/^[/\\]+/, '') || 'index.html';
  const base = p.resolve(root);
  const file = p.resolve(base, rel);
  const r = p.relative(base, file);
  if (!r || r === '..' || r.startsWith('..' + p.sep) || p.isAbsolute(r)) return null;
  return file;
}

/**
 * Is `url` one of the app's own pages? Compares whole origins, so "http://localhost:51780" doesn't pass for a
 * dev server on :5178, and nothing else (file://, https://…) does.
 * @param {string} url
 * @param {string | undefined} devUrl
 */
export function isAppUrl(url, devUrl) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'lemma:' && u.host === 'app') return true;
  if (!devUrl) return false;
  try {
    return u.origin === new URL(devUrl).origin;
  } catch {
    return false;
  }
}

/** Only web links leave the app, and only to the system browser. */
export function isExternalWebUrl(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Hugging Face repo ids ("owner/name"): no paths, no URLs, nothing that could step outside the model cache. */
export function isValidModelId(id) {
  return typeof id === 'string' && id.length <= 96 && /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(id) && !id.includes('..');
}

/** Largest sync file the renderer may write (the encrypted snapshot is typically well under 1 MB). */
export const MAX_SYNC_BYTES = 64 * 1024 * 1024;

/** Upper bound on tokens per native generation (the app asks for ≤ 1024). */
export const MAX_NEW_TOKENS = 4096;
