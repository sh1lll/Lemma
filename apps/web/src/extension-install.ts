/**
 * "Add to browser". Browsers never let a website install an extension by itself; the most automatic path each
 * one allows is used:
 *  - Chrome, Edge, Brave, Opera, Arc: the extension's store page (one click on "Add") once it's published;
 *  - Firefox: a signed .xpi, which Firefox installs after one "Add" prompt (or the add-ons site listing);
 *  - Safari: the Mac App Store listing (Safari extensions ship inside a Mac app).
 * Until a store link is set below, it offers the packaged extension as a download with short guided steps.
 */

/** Fill these in after publishing (see apps/extension/STORES.md). Empty means "not published yet". */
export const EXTENSION_LINKS = {
  chromeWebStore: '',
  edgeAddons: '',
  firefoxXpi: '',
  firefoxAddons: '',
  safariAppStore: '',
};

/** Packaged builds served next to the app (copied from apps/extension/dist at build time). */
const DOWNLOADS = { chromium: 'extension/lemma-chrome.zip', firefox: 'extension/lemma-firefox.zip' };

/** Where the web app lives; the desktop app sends people here to install in their real browser. */
export const WEB_APP_URL = 'https://lemma.app';

export type BrowserKind = 'desktop-app' | 'chrome' | 'edge' | 'brave' | 'opera' | 'arc' | 'firefox' | 'safari' | 'ios' | 'android' | 'other';

export interface Detected {
  kind: BrowserKind;
  name: string;
  family: 'chromium' | 'firefox' | 'safari' | 'none';
}

export function detectBrowser(ua = navigator.userAgent, nav: Navigator & { brave?: unknown } = navigator): Detected {
  // The desktop app is Chromium inside, but extensions belong in the browser you actually use.
  if (/Electron\//.test(ua)) return { kind: 'desktop-app', name: 'the desktop app', family: 'none' };
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return { kind: 'ios', name: 'Safari on iPhone or iPad', family: 'safari' };
  if (/Android/.test(ua) && !/Firefox/.test(ua)) return { kind: 'android', name: 'Android', family: 'none' };
  if (/Firefox\//.test(ua)) return { kind: 'firefox', name: 'Firefox', family: 'firefox' };
  if (/Edg\//.test(ua)) return { kind: 'edge', name: 'Microsoft Edge', family: 'chromium' };
  if (/OPR\//.test(ua)) return { kind: 'opera', name: 'Opera', family: 'chromium' };
  if (nav.brave) return { kind: 'brave', name: 'Brave', family: 'chromium' };
  if (typeof getComputedStyle === 'function' && getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title')) return { kind: 'arc', name: 'Arc', family: 'chromium' };
  if (/Chrome\//.test(ua)) return { kind: 'chrome', name: 'Chrome', family: 'chromium' };
  if (/Safari\//.test(ua)) return { kind: 'safari', name: 'Safari', family: 'safari' };
  return { kind: 'other', name: 'this browser', family: 'none' };
}

export interface InstallPlan {
  /** What the main button does. */
  action: { kind: 'open'; url: string; label: string } | { kind: 'download'; url: string; label: string } | { kind: 'none'; label: string };
  /** Plain steps shown under the button (empty when one click is all it takes). */
  steps: string[];
  /** A browser-internal page the user should open (can't be linked from a website), shown with a Copy button. */
  copy?: string;
  note?: string;
}

export function installPlan(b: Detected, links = EXTENSION_LINKS): InstallPlan {
  switch (b.family) {
    case 'chromium': {
      const store = b.kind === 'edge' ? links.edgeAddons || links.chromeWebStore : links.chromeWebStore;
      if (store) return { action: { kind: 'open', url: store, label: `Add to ${b.name}` }, steps: [], note: 'Opens the store page. Click “Add” there; your browser asks you to confirm.' };
      const page = b.kind === 'edge' ? 'edge://extensions' : b.kind === 'opera' ? 'opera://extensions' : b.kind === 'brave' ? 'brave://extensions' : 'chrome://extensions';
      return {
        action: { kind: 'download', url: DOWNLOADS.chromium, label: `Download for ${b.name}` },
        steps: ['Unzip the download.', `Open ${page} and switch on Developer mode (top right).`, 'Click “Load unpacked” and choose the unzipped folder.'],
        copy: page,
        note: 'The store listing isn’t live yet, so this is the manual install. Once it’s published, this button adds it in one click.',
      };
    }
    case 'firefox':
      if (links.firefoxXpi) return { action: { kind: 'open', url: links.firefoxXpi, label: 'Add to Firefox' }, steps: [], note: 'Firefox asks you to confirm with “Add”.' };
      if (links.firefoxAddons) return { action: { kind: 'open', url: links.firefoxAddons, label: 'Add to Firefox' }, steps: [], note: 'Opens Firefox Add-ons. Click “Add to Firefox” there.' };
      return {
        action: { kind: 'download', url: DOWNLOADS.firefox, label: 'Download for Firefox' },
        steps: ['Open about:debugging, then “This Firefox”.', 'Click “Load Temporary Add-on…” and choose the downloaded .zip.'],
        copy: 'about:debugging#/runtime/this-firefox',
        note: 'Until it’s signed by Mozilla, Firefox keeps it only until you restart. Once signed, this button installs it for good with one prompt.',
      };
    case 'safari':
      if (links.safariAppStore) return { action: { kind: 'open', url: links.safariAppStore, label: 'Get it for Safari' }, steps: ['Install the app from the App Store.', 'In Safari, open Settings → Extensions and turn on Lemma.'] };
      return { action: { kind: 'none', label: 'Coming to Safari' }, steps: [], note: 'Safari extensions ship through the App Store inside a Mac or iPhone app. It isn’t published there yet.' };
    default:
      if (b.kind === 'desktop-app')
        return { action: { kind: 'open', url: `${WEB_APP_URL}/#add-to-browser`, label: 'Open in my browser' }, steps: [], note: 'Extensions are added from your web browser. This opens Lemma there, on the install page.' };
      return { action: { kind: 'none', label: 'Not available here' }, steps: [], note: b.kind === 'android' ? 'Chrome on Android doesn’t support extensions. On a computer, open Lemma in Chrome, Edge, Firefox or Safari.' : 'Open Lemma in Chrome, Edge, Brave, Firefox or Safari on a computer to add the extension.' };
  }
}

/** Renders the button, its steps and notes into `root`. */
export function renderInstall(root: HTMLElement, opts: { toast: (m: string) => void; detected?: Detected; links?: typeof EXTENSION_LINKS } = { toast: () => undefined }): void {
  const b = opts.detected ?? detectBrowser();
  const plan = installPlan(b, opts.links);
  root.replaceChildren();
  const btn = document.createElement(plan.action.kind === 'none' ? 'button' : 'a');
  btn.className = 'btn primary ext-install-btn';
  btn.textContent = plan.action.label;
  if (btn instanceof HTMLAnchorElement && plan.action.kind !== 'none') {
    btn.href = plan.action.url;
    if (plan.action.kind === 'download') btn.download = plan.action.url.split('/').pop()!;
    else {
      btn.target = '_blank';
      btn.rel = 'noopener';
    }
  } else (btn as HTMLButtonElement).disabled = true;
  root.append(btn);
  if (plan.steps.length) {
    const ol = document.createElement('ol');
    ol.className = 'ext-install-steps';
    for (const s of plan.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      ol.append(li);
    }
    root.append(ol);
  }
  if (plan.copy) {
    const row = document.createElement('div');
    row.className = 'ext-install-copy';
    const code = document.createElement('code');
    code.textContent = plan.copy;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'link';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', `Copy ${plan.copy}`);
    copy.addEventListener('click', () =>
      void navigator.clipboard?.writeText(plan.copy!).then(
        () => opts.toast(`Copied ${plan.copy}: paste it into the address bar`),
        () => opts.toast('Clipboard is unavailable here'),
      ),
    );
    row.append(code, copy);
    root.append(row);
  }
  if (plan.note) {
    const p = document.createElement('p');
    p.className = 'fine';
    p.textContent = plan.note;
    root.append(p);
  }
}
