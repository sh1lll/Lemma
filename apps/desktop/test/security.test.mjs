// Run with: npx vitest run --root apps/desktop
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAppUrl, isExternalWebUrl, isValidModelId, resolveWebFile } from '../security.mjs';

describe('lemma:// file mapping', () => {
  const root = '/Applications/Lemma.app/Contents/Resources/web';
  it('serves files inside the web root', () => {
    expect(resolveWebFile(root, 'lemma://app/')).toBe(`${root}/index.html`);
    expect(resolveWebFile(root, 'lemma://app/assets/a%20b.js?x=1')).toBe(`${root}/assets/a b.js`);
  });
  it('refuses a sibling directory that shares the root as a string prefix', () => {
    // The old check was file.startsWith(WEB_ROOT): "/…/web-private/x" passed.
    expect(resolveWebFile(root, 'lemma://app/..%2Fweb-private%2Fsecret.json')).toBeNull();
  });
  it('refuses traversal, absolute paths, NUL and malformed escapes', () => {
    for (const u of ['lemma://app/..%2F..%2Fapp.asar', 'lemma://app/%2Fetc%2Fpasswd', 'lemma://app/a%00.js', 'lemma://app/%E0%A4%A', 'lemma://app/..%2F'])
      expect(resolveWebFile(root, u), u).toSatisfy((f) => f === null || f.startsWith(root + '/'));
    expect(resolveWebFile(root, 'lemma://app/..%2F..%2Fapp.asar')).toBeNull();
    expect(resolveWebFile(root, 'lemma://app/%E0%A4%A')).toBeNull();
  });
  it('handles Windows separators', () => {
    const w = 'C:\\Program Files\\Lemma\\resources\\web';
    expect(resolveWebFile(w, 'lemma://app/assets/x.js', path.win32)).toBe(`${w}\\assets\\x.js`);
    expect(resolveWebFile(w, 'lemma://app/..%5Cweb-private%5Cx', path.win32)).toBeNull();
    expect(resolveWebFile(w, 'lemma://app/C:%5CWindows%5Cwin.ini', path.win32)).toBeNull();
  });
});

describe('trusted pages', () => {
  it('accepts only the app origin (and the dev server origin in development)', () => {
    expect(isAppUrl('lemma://app/?overlay=1', undefined)).toBe(true);
    expect(isAppUrl('file:///Users/me/Downloads/evil.html', undefined)).toBe(false);
    expect(isAppUrl('https://example.com/', undefined)).toBe(false);
    expect(isAppUrl('lemma://other/', undefined)).toBe(false);
    expect(isAppUrl('http://localhost:5178/x', 'http://localhost:5178')).toBe(true);
    expect(isAppUrl('http://localhost:51780/', 'http://localhost:5178')).toBe(false);
    expect(isAppUrl('not a url', 'http://localhost:5178')).toBe(false);
  });
  it('opens only https links externally', () => {
    expect(isExternalWebUrl('https://console.anthropic.com/settings/keys')).toBe(true);
    for (const u of ['file:///etc/passwd', 'smb://host/share', 'javascript:alert(1)', 'http://x', 'ms-msdt:/id']) expect(isExternalWebUrl(u), u).toBe(false);
  });
  it('model ids are plain Hugging Face repo ids', () => {
    expect(isValidModelId('onnx-community/Qwen3-0.6B-ONNX')).toBe(true);
    for (const id of ['../../etc', 'a/../../b', '/abs/path', 'https://evil/x', 'owner/name/extra', 'x'.repeat(200) + '/y', 42]) expect(isValidModelId(id), String(id)).toBe(false);
  });
});
