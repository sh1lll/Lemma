/**
 * Background (Chrome service worker / Firefox event page). Owns the context menu, the keyboard command,
 * screen capture and the engines for selection actions. Pages are touched only after a user gesture
 * (context menu, command, popup click), which is what grants activeTab for that tab.
 */
import katex from 'katex';
import { MENU_ACTIONS, ACTION_LABELS, type Action } from './core/actions';
import { SESSION_KEYS, type PendingCapture, type PendingQuestion, type SelectionInfo, type ToBackground, type ToContent } from './core/messages';
import { loadSettings } from './core/settings';
import { solve, type Solution } from './core/solve';

const CONTENT = 'content.js';
const isAction = (s: string): s is Action => (MENU_ACTIONS as string[]).includes(s);

// ---------- context menu

async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'lemma', title: 'Lemma', contexts: ['selection'] });
  for (const a of MENU_ACTIONS) chrome.contextMenus.create({ id: a, parentId: 'lemma', title: ACTION_LABELS[a], contexts: ['selection'] });
}
chrome.runtime.onInstalled.addListener(() => void createMenus());
chrome.runtime.onStartup.addListener(() => void createMenus());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (!isAction(id) || tab?.id === undefined) return;
  void runAction(id, tab.id, info.frameId ?? 0, info.selectionText ?? '');
});

async function ensureContent(tabId: number, frameId = 0): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: [CONTENT] });
}

function mathmlFor(s: Solution): Record<string, string> {
  const out: Record<string, string> = {};
  const texes = [s.answer?.tex, s.questionTex, ...s.steps.map((x) => x.tex)].filter((t): t is string => !!t);
  for (const t of texes) {
    try {
      out[t] = katex.renderToString(t, { output: 'mathml', throwOnError: false, strict: 'ignore' });
    } catch {
      /* the bubble falls back to the text */
    }
  }
  return out;
}

/** Runs a selection action on a tab: read the selection, compute locally, show the bubble. */
export async function runAction(action: Action, tabId: number, frameId = 0, fallbackText = ''): Promise<Solution> {
  await ensureContent(tabId, frameId);
  const to = (m: ToContent) => chrome.tabs.sendMessage(tabId, m, { frameId });
  await to({ type: 'lemma:bubble-loading', action });
  let sel: SelectionInfo | undefined;
  try {
    sel = await chrome.tabs.sendMessage<SelectionInfo>(tabId, { type: 'lemma:selection' } satisfies ToContent, { frameId });
  } catch {
    sel = undefined;
  }
  const query = sel?.query || fallbackText;
  const effective: Action = sel?.column && (action === 'calculate' || action === 'solve' || action === 'explain') ? 'average' : action;
  const solution = await solve(effective, query, sel?.column);
  const settings = await loadSettings();
  const tutor = settings.mode === 'tutor' && (effective === 'solve' || effective === 'explain');
  await to({ type: 'lemma:bubble', solution, mathml: mathmlFor(solution), tutor });
  return solution;
}

// ---------- screen capture

let panels = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panels++;
  port.onDisconnect.addListener(() => panels--);
});

const session = () => chrome.storage.session;

export async function startRegion(tabId: number): Promise<void> {
  await ensureContent(tabId);
  await session()?.set({ [SESSION_KEYS.waiting]: true });
  await chrome.tabs.sendMessage(tabId, { type: 'lemma:region' } satisfies ToContent);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

/** Captures the visible tab and crops it to `rect` (CSS pixels of a viewport `vw` wide). Small crops are enlarged for OCR. */
export async function captureRegion(windowId: number, rect: { x: number; y: number; w: number; h: number }, vw: number): Promise<string> {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = bmp.width / Math.max(1, vw);
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rect.w * scale)));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rect.h * scale)));
  // Tesseract reads best with text around 30-40 px tall; enlarge small crops, shrink huge ones.
  const k = Math.min(4, Math.max(sh < 90 ? 90 / sh : 1, 1)) * Math.min(1, 2400 / Math.max(sw, sh));
  const out = new OffscreenCanvas(Math.round(sw * k), Math.round(sh * k));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, out.width, out.height);
  bmp.close();
  return blobToDataUrl(await out.convertToBlob({ type: 'image/png' }));
}

async function deliverCapture(dataUrl: string) {
  const c: PendingCapture = { dataUrl, at: Date.now() };
  await session()?.set({ [SESSION_KEYS.capture]: c, [SESSION_KEYS.waiting]: false });
  // No panel open (it couldn't be opened, or the user closed it): show the review page in a tab instead.
  if (panels <= 0) await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'solve-screen') return;
  // A command is a user gesture: open the panel first, synchronously with it.
  void openPanelForGesture(tab?.windowId);
  void (async () => {
    const t = tab?.id !== undefined ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (t?.id !== undefined) await startRegion(t.id).catch(() => undefined);
  })();
});

function openPanelForGesture(windowId?: number): Promise<boolean> {
  try {
    if (typeof browser !== 'undefined' && browser.sidebarAction) return browser.sidebarAction.open().then(() => true, () => false);
    if (chrome.sidePanel && windowId !== undefined) return chrome.sidePanel.open({ windowId }).then(() => true, () => false);
  } catch {
    /* no panel API */
  }
  return Promise.resolve(false);
}

// ---------- messages from the content script, popup and panel

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const m = msg as ToBackground;
  const tab = sender.tab;
  switch (m.type) {
    case 'lemma:region-done':
      if (!tab) return;
      void captureRegion(tab.windowId, m.rect, m.vw)
        .then(deliverCapture)
        .then(
          () => reply({ ok: true }),
          (e: unknown) => {
            void session()?.set({ [SESSION_KEYS.waiting]: false });
            reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
          },
        );
      return true;
    case 'lemma:region-cancel':
      void session()?.set({ [SESSION_KEYS.waiting]: false });
      return;
    case 'lemma:start-region': {
      void (async () => {
        const id = m.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        if (id === undefined) throw new Error('No tab to capture.');
        await startRegion(id);
      })().then(
        () => reply({ ok: true }),
        (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      return true;
    }
    case 'lemma:open-panel': {
      const p: PendingQuestion = { query: m.query, action: m.action, at: Date.now() };
      // Open first, while the click's user activation still counts; the panel picks the question up from storage.
      const opening = openPanelForGesture(tab?.windowId);
      void session()?.set({ [SESSION_KEYS.pending]: p });
      void opening.then(async (opened) => {
        if (!opened && panels <= 0) await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
      });
      return;
    }
    case 'lemma:open-options':
      void chrome.runtime.openOptionsPage();
      return;
  }
});

// Test hook for the Playwright suite (drives the same code paths the menu and command use).
Object.assign(globalThis, { lemmaTest: { runAction, startRegion, captureRegion, createMenus } });
