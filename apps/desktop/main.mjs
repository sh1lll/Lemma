// Lemma desktop shell. It wraps the same web build (apps/web/dist) and adds what a browser can't:
// a global hotkey, a floating always-on-top quick calculator, and a tray/menu-bar icon.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, systemPreferences, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportLegacyStorage, LEGACY_SCHEME, moveLegacyFolder, registerLegacy } from './legacy.mjs';
import { registerLocalModel } from './llm.mjs';
import { isAppUrl, isExternalWebUrl, resolveWebFile } from './security.mjs';
import { registerSync } from './sync.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.LEMMA_DEV_URL;
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(here, '../web/dist');
const ORIGIN = 'lemma://app';
/** `LEMMA_SMOKE=1 electron .` loads both windows hidden, checks a calculation in each, prints JSON and quits. */
const SMOKE = process.env.LEMMA_SMOKE === '1';

const SHORTCUTS = {
  overlay: 'CommandOrControl+Shift+Space',
  listen: 'CommandOrControl+Shift+M',
};

// A privileged custom scheme gives the app a stable secure origin (needed for the mic, Cache API and workers)
// without running a local HTTP server.
protocol.registerSchemesAsPrivileged([
  { scheme: 'lemma', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  // The address from before the rename, opened once to carry its saved data across (legacy.mjs).
  { scheme: LEGACY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Menus and dialogs use the app name; the npm package name ("@lemma/desktop") would show otherwise. Keep the
// data folder where it has always been so existing history, notebooks and sync settings stay put.
const userData = app.getPath('userData');
moveLegacyFolder(app.getPath('appData'), userData);
app.setName('Lemma');
app.setPath('userData', userData);

// A second launch hands over to the running instance (second-instance → showMain) and creates nothing itself:
// app.quit() is asynchronous, so without this guard it would still build windows, a tray icon and IPC handlers.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
// Windows only shows notifications (timer alerts) for apps with an explicit AppUserModelID.
if (process.platform === 'win32') app.setAppUserModelId('app.lemma.desktop');
// Linux without a compositor renders transparent windows black, so the overlay is opaque there.
const TRANSPARENT_OVERLAY = process.platform !== 'linux';

/** @type {BrowserWindow | null} */ let mainWin = null;
/** @type {BrowserWindow | null} */ let overlay = null;
/** @type {Tray | null} */ let tray = null;
let quitting = false;

const pageUrl = (query = '') => (DEV_URL ?? ORIGIN) + '/' + query;

function serveWeb() {
  protocol.handle('lemma', (req) => {
    // Never serve outside the bundled web root (see resolveWebFile for why a prefix check isn't enough).
    const file = resolveWebFile(WEB_ROOT, req.url);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Is this one of Lemma's own pages (not a file dropped on the window, not a web page)? */
const trusted = (url) => isAppUrl(url ?? '', DEV_URL);
/** IPC is answered only for the app's own top-level page: the bridge can read the sync passphrase. */
const trustedSender = (e) => !!e.senderFrame && e.senderFrame === e.sender.mainFrame && trusted(e.senderFrame.url);

function allowMicrophone() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(permission === 'media' && trusted(details.requestingUrl ?? wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && trusted(origin ?? ''));
}

const webPreferences = {
  preload: path.join(here, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
};

function openExternalLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Every window stays on the app's own pages. Without this, dropping a file anywhere on a window (or a link that
// slips through without target=_blank) navigates it to file:// or a web page, and that page would get the
// preload bridge (sync folder writes, the saved sync passphrase, the native model).
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e, url) => {
    if (trusted(url)) return;
    e.preventDefault();
    if (isExternalWebUrl(url)) shell.openExternal(url);
  });
  wc.on('will-redirect', (e, url) => {
    if (!trusted(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

function createMain() {
  mainWin = new BrowserWindow({
    width: 760,
    height: 920,
    minWidth: 360,
    minHeight: 480,
    title: 'Lemma',
    backgroundColor: '#0e0f11',
    show: false,
    webPreferences,
  });
  openExternalLinks(mainWin);
  mainWin.loadURL(pageUrl());
  mainWin.once('ready-to-show', () => !SMOKE && mainWin?.show());
  // Closing the window keeps Lemma in the tray so the hotkey still works; Quit is in the tray menu.
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin?.hide();
  });
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 640,
    height: 150,
    frame: false,
    transparent: TRANSPARENT_OVERLAY,
    backgroundColor: TRANSPARENT_OVERLAY ? '#00000000' : '#0e0f11',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    webPreferences,
  });
  overlay.setAlwaysOnTop(true, 'floating');
  // skipTransformProcessType: without it, macOS turns the whole app into a background (UIElement) process:
  // no Dock icon, no menu bar, no Cmd-Tab.
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  openExternalLinks(overlay);
  overlay.loadURL(pageUrl('?overlay=1'));
  overlay.on('blur', () => overlay?.hide());
}

function showOverlay({ listen = false } = {}) {
  if (!overlay) return;
  if (overlay.isVisible() && !listen) {
    overlay.hide();
    return;
  }
  // Open on the display the cursor is on, a third of the way down.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = overlay.getSize();
  overlay.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.22));
  overlay.show();
  overlay.focus();
  overlay.webContents.send('overlay:shown', { listen });
}

function showMain() {
  if (!mainWin) createMain();
  mainWin.show();
  mainWin.focus();
}

function createTray() {
  const img =
    process.platform === 'darwin'
      ? nativeImage.createFromPath(path.join(here, 'icons/trayTemplate.png'))
      : nativeImage.createFromPath(path.join(here, 'icons/icon-32.png'));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Lemma');
  const accel = (s) => s.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Quick calculator    ${accel(SHORTCUTS.overlay)}`, click: () => showOverlay() },
      { label: `Speak a calculation    ${accel(SHORTCUTS.listen)}`, click: () => showOverlay({ listen: true }) },
      { label: 'Open Lemma', click: showMain },
      { type: 'separator' },
      // Electron supports login items on macOS and Windows only.
      ...(process.platform === 'linux'
        ? []
        : [
            {
              label: 'Open at login',
              type: 'checkbox',
              checked: app.getLoginItemSettings().openAtLogin,
              click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
            },
            { type: 'separator' },
          ]),
      { label: 'Quit Lemma', role: 'quit' },
    ]),
  );
  if (process.platform !== 'darwin') tray.on('click', () => showOverlay());
}

function registerShortcuts() {
  const failed = [];
  if (!globalShortcut.register(SHORTCUTS.overlay, () => showOverlay())) failed.push(SHORTCUTS.overlay);
  if (!globalShortcut.register(SHORTCUTS.listen, () => showOverlay({ listen: true }))) failed.push(SHORTCUTS.listen);
  // Another app owns the combination: say so rather than failing silently.
  if (failed.length) tray?.setToolTip(`Lemma — shortcut unavailable: ${failed.join(', ')}`);
}

if (primary) {
  registerLegacy(userData, trustedSender);
  registerLocalModel(trustedSender);
  registerSync(trustedSender);
}
ipcMain.on('overlay:hide', (e) => trustedSender(e) && overlay?.hide());
ipcMain.on('overlay:resize', (e, height) => {
  if (!trustedSender(e) || !overlay || typeof height !== 'number' || !Number.isFinite(height)) return;
  const [w] = overlay.getSize();
  overlay.setSize(w, Math.max(110, Math.min(Math.round(height), 640)));
});
ipcMain.on('app:open-main', (e) => {
  if (!trustedSender(e)) return;
  overlay?.hide();
  showMain();
});
ipcMain.handle('app:info', () => ({ platform: process.platform, shortcuts: SHORTCUTS, version: app.getVersion() }));
// First launch: the web app shows a one-time notice naming the quick-calculator shortcut (asked once, then remembered).
ipcMain.handle('app:first-run', (e) => {
  if (!trustedSender(e)) return false;
  const flag = path.join(userData, 'welcomed');
  if (fs.existsSync(flag)) return false;
  try {
    fs.writeFileSync(flag, new Date().toISOString());
  } catch {
    /* read-only profile: show it anyway */
  }
  // Written the way each system writes it: ⌘⇧Space on a Mac, Ctrl+Shift+Space elsewhere.
  const keys = (s) => (process.platform === 'darwin' ? s.replace('CommandOrControl+', '⌘').replace('Shift+', '⇧') : s.replace('CommandOrControl', 'Ctrl'));
  return { overlay: keys(SHORTCUTS.overlay), listen: keys(SHORTCUTS.listen), openAtLogin: process.platform !== 'linux' && app.getLoginItemSettings().openAtLogin };
});
// Only ever turned on by the user pressing the notice's button (or the tray menu item).
ipcMain.handle('app:open-at-login', (e) => {
  if (!trustedSender(e) || process.platform === 'linux') return false;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  return true;
});

app.on('second-instance', showMain);
// System shutdown, `kill`, service managers: quit properly (closing the window alone only hides it to the tray).
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    quitting = true;
    app.quit();
  });
}
app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('activate', showMain);

app.whenReady().then(async () => {
  if (!primary) return;
  if (process.platform === 'darwin') {
    app.dock?.setIcon(path.join(here, 'icons/icon-512.png'));
    // Ask once up front so the first spoken calculation isn't interrupted by the system prompt.
    if (!SMOKE && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }
  }
  if (!DEV_URL) serveWeb();
  await exportLegacyStorage(userData);
  allowMicrophone();
  createMain();
  createOverlay();
  createTray();
  registerShortcuts();
  if (process.argv.includes('--overlay')) showOverlay();
  if (SMOKE) runSmoke();
});

async function runSmoke() {
  // Results go straight to a file when LEMMA_SMOKE_OUT is set: console output to a redirected stdout is
  // buffered and lost if the process is killed.
  const { appendFileSync } = await import('node:fs');
  const log = (line) => (process.env.LEMMA_SMOKE_OUT ? appendFileSync(process.env.LEMMA_SMOKE_OUT, line + '\n') : console.log(line));
  // Retype until the answer shows (up to 15 s): on a slow machine the page may not be listening yet, or the
  // answer takes longer than a fixed wait (CI's Mac showed "0" after 300 ms).
  const probe = `(async () => {
    const i = document.getElementById('input');
    for (let k = 0; k < 60 && !document.getElementById('value').innerText.includes('120'); k++) {
      i.value = '20 percent of 450 plus 30'; i.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 250));
    }
    return {
      value: document.getElementById('value').innerText,
      overlay: document.documentElement.classList.contains('overlay'),
      bridge: typeof window.lemmaDesktop,
      speech: 'webkitSpeechRecognition' in window,
      worklet: typeof AudioWorkletNode,
    };
  })()`;
  // Anything that swaps a window's page mid-test, so a failure says which window and why.
  for (const [name, win] of [['main', mainWin], ['overlay', overlay]]) {
    win.webContents.on('did-start-navigation', (d) => d.isMainFrame && log(`NAV ${name} ${d.url} by=${d.initiator?.url ?? 'shell'}`));
    win.webContents.on('render-process-gone', (_e, d) => log(`GONE ${name} ${JSON.stringify(d)}`));
  }
  // A window whose page hasn't started loading yet has no URL; it isn't ready either (a slow machine gets here first).
  const wait = (win) => new Promise((r) => (win.webContents.isLoading() || !win.webContents.getURL() ? win.webContents.once('did-finish-load', r) : r()));
  try {
    await Promise.all([wait(mainWin), wait(overlay)]);
    const result = {
      main: await mainWin.webContents.executeJavaScript(probe),
      overlay: await overlay.webContents.executeJavaScript(probe),
      shortcuts: Object.fromEntries(Object.entries(SHORTCUTS).map(([k, v]) => [k, globalShortcut.isRegistered(v)])),
      tray: !!tray,
    };
    log('SMOKE ' + JSON.stringify(result));
    // LEMMA_SMOKE_QUERIES="q1;;q2": submit each in the main window and print what it shows.
    // "ask:<question>" goes to the assistant using the built-in model (LEMMA_SMOKE_MODEL, default Qwen3 0.6B).
    const queries = (process.env.LEMMA_SMOKE_QUERIES ?? '').split(';;').filter(Boolean);
    if (queries.some((q) => q.startsWith('ask:'))) {
      const model = process.env.LEMMA_SMOKE_MODEL ?? 'onnx-community/Qwen3-0.6B-ONNX';
      await mainWin.webContents.executeJavaScript(`(() => {
        const s = JSON.parse(localStorage.getItem('lemma.settings.v1') || '{}');
        Object.assign(s, { aiEnabled: true, aiProvider: 'builtin', aiModels: { builtin: ${JSON.stringify(model)} } });
        localStorage.setItem('lemma.settings.v1', JSON.stringify(s));
      })()`);
      mainWin.webContents.reload();
      await new Promise((r) => mainWin.webContents.once('did-finish-load', r));
      await mainWin.webContents.executeJavaScript(`new Promise((r) => setTimeout(() => { document.getElementById('assistant-toggle').click(); r(); }, 800))`);
    }
    for (const q of queries.filter((x) => x.startsWith('ask:'))) {
      const t0 = Date.now();
      const shown = await mainWin.webContents.executeJavaScript(`(async () => {
        const n = document.querySelectorAll('.msg.assistant').length + 1;
        const i = document.getElementById('input');
        i.value = ${JSON.stringify(q.slice(4))};
        document.getElementById('ask').requestSubmit();
        for (let k = 0; k < 1800; k++) {
          await new Promise((r) => setTimeout(r, 500));
          const msgs = document.querySelectorAll('.msg.assistant');
          const m = msgs[msgs.length - 1];
          if (msgs.length >= n && !m.querySelector('.typing') && m.innerText.trim().length > 5) {
            return { chips: [...m.querySelectorAll('.tool-chip')].map((c) => c.innerText), answer: m.querySelector('.tool-calls + div')?.innerText.slice(0, 200) };
          }
        }
        return { timeout: true };
      })()`);
      log('ASK ' + JSON.stringify({ q: q.slice(4), secs: Math.round((Date.now() - t0) / 1000), ...shown }));
    }
    for (const q of queries.filter((x) => !x.startsWith('ask:'))) {
      const shown = await mainWin.webContents.executeJavaScript(`(async () => {
        const i = document.getElementById('input');
        i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input'));
        document.getElementById('ask').requestSubmit();
        for (let k = 0; k < 600; k++) {
          await new Promise((r) => setTimeout(r, 100));
          if (document.querySelector('#history li')?.innerText.startsWith(${JSON.stringify(q.slice(0, 12))})) break;
        }
        return { value: document.getElementById('value').innerText, graph: !!document.querySelector('.graph canvas'), meta: document.getElementById('meta').innerText.slice(0, 80) };
      })()`);
      log('QUERY ' + JSON.stringify({ q, ...shown }));
    }
    if (process.env.LEMMA_SMOKE_SHOT) {
      const { writeFileSync } = await import('node:fs');
      overlay.showInactive();
      await new Promise((r) => setTimeout(r, 600));
      writeFileSync(process.env.LEMMA_SMOKE_SHOT, (await overlay.webContents.capturePage()).toPNG());
    }
  } catch (e) {
    log('SMOKE-ERROR ' + (e?.stack ?? e));
  }
  quitting = true;
  app.quit();
}

app.on('window-all-closed', () => {
  // Stay resident in the tray on every platform.
});
