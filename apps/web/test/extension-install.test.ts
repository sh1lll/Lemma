import { describe, expect, it } from 'vitest';
import { detectBrowser, installPlan, EXTENSION_LINKS } from '../src/extension-install';

const UA = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:142.0) Gecko/20100101 Firefox/142.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  electron: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) lemma/0.1.0 Chrome/140.0.0.0 Electron/45.1.0 Safari/537.36',
};
const nav = (extra: Record<string, unknown> = {}) => ({ maxTouchPoints: 0, ...extra }) as unknown as Navigator;
// detectBrowser checks a CSS variable for Arc; give it a document stub in Node.
globalThis.getComputedStyle ??= (() => ({ getPropertyValue: () => '' })) as never;
globalThis.document ??= { documentElement: {} } as never;

describe('Add to browser', () => {
  it('detects browsers', () => {
    expect(detectBrowser(UA.chrome, nav()).kind).toBe('chrome');
    expect(detectBrowser(UA.chrome, nav({ brave: {} })).kind).toBe('brave');
    expect(detectBrowser(UA.edge, nav()).kind).toBe('edge');
    expect(detectBrowser(UA.firefox, nav()).kind).toBe('firefox');
    expect(detectBrowser(UA.safari, nav()).kind).toBe('safari');
    expect(detectBrowser(UA.iphone, nav()).kind).toBe('ios');
    expect(detectBrowser(UA.android, nav()).kind).toBe('android');
    expect(detectBrowser(UA.electron, nav()).kind).toBe('desktop-app');
  });

  it('unpublished: Chromium browsers get the download and steps, with the right extensions page', () => {
    const p = installPlan(detectBrowser(UA.edge, nav()));
    expect(p.action.kind).toBe('download');
    expect(p.copy).toBe('edge://extensions');
    expect(p.steps.join(' ')).toMatch(/Load unpacked/);
  });

  it('published: one click to the store, and a signed Firefox file installs with one prompt', () => {
    const links = { ...EXTENSION_LINKS, chromeWebStore: 'https://chromewebstore.google.com/detail/x', firefoxXpi: 'https://example.org/lemma.xpi' };
    const c = installPlan(detectBrowser(UA.chrome, nav()), links);
    expect(c.action).toMatchObject({ kind: 'open', url: links.chromeWebStore });
    expect(c.steps).toHaveLength(0);
    expect(installPlan(detectBrowser(UA.firefox, nav()), links).action).toMatchObject({ kind: 'open', url: links.firefoxXpi });
  });

  it('places without extensions say so; the desktop app sends you to your browser', () => {
    expect(installPlan(detectBrowser(UA.android, nav())).action.kind).toBe('none');
    expect(installPlan(detectBrowser(UA.iphone, nav())).note).toMatch(/App Store/);
    expect(installPlan(detectBrowser(UA.electron, nav())).action).toMatchObject({ kind: 'open', label: 'Open in my browser' });
  });
});
