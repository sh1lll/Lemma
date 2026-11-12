/**
 * Settings → Data (backup, and under More the sync folder and server). Backups are encrypted files the user keeps anywhere; the desktop app can also
 * sync through a folder (iCloud Drive, Dropbox, OneDrive…). Loaded on demand: the crypto and merge code is
 * not part of the startup bundle.
 */
import { LEGACY } from '@lemma/sync-engine/src/legacy';

export interface SyncBridge {
  status(): Promise<{ folder: string | null; hasPassphrase: boolean; keychain: boolean }>;
  chooseFolder(): Promise<string | null>;
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  savePassphrase(p: string | null): Promise<void>;
  passphrase(): Promise<string | null>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Asks for a passphrase. `confirm` adds a repeat field and a strength check (for creating new encrypted data). */
async function askPassphrase(why: string, confirm: boolean, offerRemember = false): Promise<{ passphrase: string; remember: boolean } | null> {
  const { estimatePassphraseStrength } = await import('./sync');
  const dialog = $<HTMLDialogElement>('passphrase');
  const p1 = $<HTMLInputElement>('pp1');
  const p2 = $<HTMLInputElement>('pp2');
  const strength = $('pp-strength');
  const ok = $<HTMLButtonElement>('pp-ok');
  $('passphrase-why').textContent = why;
  $('pp2-row').hidden = !confirm;
  $('pp-remember-row').hidden = !offerRemember;
  p1.value = p2.value = '';
  p1.autocomplete = p2.autocomplete = confirm ? 'new-password' : 'current-password';
  const check = () => {
    if (!confirm) {
      strength.textContent = '';
      ok.disabled = !p1.value;
      return;
    }
    const s = estimatePassphraseStrength(p1.value);
    const mismatch = p2.value && p2.value !== p1.value;
    strength.textContent = mismatch ? 'The passphrases don’t match.' : s.reason;
    strength.dataset.score = String(s.score);
    ok.disabled = s.score < 2 || p1.value !== p2.value;
  };
  p1.oninput = p2.oninput = check;
  check();
  dialog.showModal();
  p1.focus();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const value = p1.value;
        p1.value = p2.value = '';
        resolve(dialog.returnValue === 'ok' && value ? { passphrase: value, remember: $<HTMLInputElement>('pp-remember').checked } : null);
      },
      { once: true },
    );
  });
}

/** A toast to show after the reload that follows a restore. sessionStorage may throw (private mode, blocked storage). */
const PENDING = 'lemma.sync-toast';
const later = (msg: string) => {
  try {
    sessionStorage.setItem(PENDING, msg);
  } catch {
    // The reload simply happens without the summary.
  }
};
const takeLater = (): string | null => {
  try {
    const m = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    return m;
  } catch {
    return null;
  }
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function initSync(toast: (m: string) => void, bridge?: SyncBridge): void {
  // "Sync your devices" (top of Data): opens the sync rows under More and puts the cursor in the server address.
  document.getElementById('sync-setup')?.addEventListener('click', () => {
    const url = document.getElementById('sync-server-url') as HTMLInputElement | null;
    const more = url?.closest('details');
    if (more) more.open = true;
    url?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    url?.focus({ preventScroll: true });
  });
  $('sync-backup').addEventListener('click', async () => {
    const got = await askPassphrase('Choose a passphrase for this backup. You’ll need it to restore; it can’t be recovered.', true);
    if (!got) return;
    try {
      const { exportBackup } = await import('./sync');
      const { bytes, name } = await exportBackup(got.passphrase);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(`Saved ${name}`);
    } catch (e) {
      toast(message(e));
    }
  });

  const file = $<HTMLInputElement>('sync-file');
  // Backups made before the rename can still be restored.
  file.accept += `,${LEGACY.fileExtension}`;
  $('sync-restore').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (f.size > 50_000_000) return toast('That file is too large to be an Lemma backup');
    const got = await askPassphrase(`Enter the passphrase for ${f.name}. Its contents will be merged with what’s on this device; nothing here is lost.`, false);
    if (!got) return;
    try {
      const { importAndMerge } = await import('./sync');
      const summary = await importAndMerge(new Uint8Array(await f.arrayBuffer()), got.passphrase);
      later(`Restored: ${summary}`);
      location.reload();
    } catch (e) {
      toast(message(e));
    }
  });

  const after = takeLater();
  if (after) setTimeout(() => toast(after), 300);

  if (bridge) void initFolderSync(bridge, toast);
  initServerSync(toast, bridge);
}

/** Something the user is in the middle of: the exam simulator, the whiteboard, a notebook, any open dialog, or a half-typed question. */
const busy = () =>
  !!document.querySelector('.ex-view:not(.leaving), .wb-view:not(.leaving), dialog[open]:not(.closing)') ||
  document.documentElement.classList.contains('notebook-open') ||
  !!(document.getElementById('input') as HTMLInputElement | null)?.value.trim();

async function initFolderSync(bridge: SyncBridge, toast: (m: string) => void): Promise<void> {
  const row = document.querySelector<HTMLElement>('.sync-folder')!;
  const label = $('sync-folder-label');
  const now = $<HTMLButtonElement>('sync-now');
  row.hidden = false;
  const refresh = async () => {
    const s = await bridge.status();
    label.textContent = s.folder ? `Sync folder: ${s.folder}` : 'Sync folder: not set';
    now.disabled = !s.folder;
    return s;
  };

  const passphrase = async (creating: boolean): Promise<string | null> => {
    const saved = await bridge.passphrase().catch(() => null);
    if (saved) return saved;
    const s = await bridge.status();
    const got = await askPassphrase(
      creating ? 'Choose a passphrase for the sync file. Use the same one on every device.' : 'Enter the passphrase you use for Lemma sync.',
      creating,
      s.keychain,
    );
    if (got?.remember && s.keychain) await bridge.savePassphrase(got.passphrase).catch(() => undefined);
    return got?.passphrase ?? null;
  };

  let running = false;
  const syncNow = async (quiet: boolean) => {
    if (running) return;
    // A background sync that brings changes reloads the page; never do that under an exam, a board or a notebook
    // in progress. It runs again on the next focus or interval.
    if (quiet && busy()) return;
    const s = await refresh();
    if (!s.folder) return;
    if (quiet && !s.hasPassphrase) return; // background sync never prompts
    running = true;
    try {
      const existing = await bridge.read();
      const p = await passphrase(!existing);
      if (!p) return;
      const { syncWithFile } = await import('./sync');
      const { summary, changedHere } = await syncWithFile(async () => existing, (b) => bridge.write(b), p);
      // The app reads its data at startup, so changes from another device show after a reload.
      if (changedHere) {
        later(`Synced: ${summary}`);
        location.reload();
      } else if (!quiet) toast(`Synced: ${summary}`);
    } catch (e) {
      if ((e as { code?: string }).code === 'wrong-passphrase') await bridge.savePassphrase(null).catch(() => undefined);
      if (!quiet) toast(message(e));
    } finally {
      running = false;
    }
  };

  $('sync-folder').addEventListener('click', async () => {
    if (await bridge.chooseFolder()) await syncNow(false);
  });
  now.addEventListener('click', () => void syncNow(false));
  await refresh();
  // Pick up changes from other devices at launch, when the window regains focus, and every 5 minutes.
  void syncNow(true);
  window.addEventListener('focus', () => void syncNow(true));
  setInterval(() => void syncNow(true), 5 * 60_000);
}

// ---------------------------------------------------------------------------
// Optional sync server (apps/sync-server): URL + Sync now + automatic every N minutes, same passphrase.
// ---------------------------------------------------------------------------

const SERVER_CONFIG = 'lemma.sync-server.v1';
/** Carries the passphrase across the reload that follows a sync that changed data here; read and deleted at once. */
const SERVER_HANDOFF = 'lemma.sync-server-pass';

interface ServerConfig {
  url: string;
  /** Minutes between automatic syncs; 0 = only when asked. */
  every: number;
  last?: number;
}

const readConfig = (): ServerConfig => {
  try {
    const c = JSON.parse(localStorage.getItem(SERVER_CONFIG) ?? 'null') as Partial<ServerConfig> | null;
    return { url: typeof c?.url === 'string' ? c.url : '', every: Number(c?.every) || 0, last: Number(c?.last) || undefined };
  } catch {
    return { url: '', every: 0 };
  }
};
const writeConfig = (c: ServerConfig) => {
  try {
    localStorage.setItem(SERVER_CONFIG, JSON.stringify(c));
  } catch {
    // Settings last for this session.
  }
};
const takeHandoff = (): string | null => {
  try {
    const p = sessionStorage.getItem(SERVER_HANDOFF);
    sessionStorage.removeItem(SERVER_HANDOFF);
    return p;
  } catch {
    return null;
  }
};

function serverControls(): { url: HTMLInputElement; every: HTMLSelectElement; now: HTMLButtonElement; status: HTMLElement } | null {
  const anchor = document.querySelector<HTMLElement>('.sync-folder') ?? document.querySelector<HTMLElement>('.sync-actions');
  if (!anchor) return null;
  const make = <T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): T => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e as T;
  };
  const url = make<HTMLInputElement>('input', { id: 'sync-server-url', type: 'url', inputMode: 'url', spellcheck: false, autocomplete: 'off', placeholder: 'https://sync.example.com', size: 22 });
  const every = make<HTMLSelectElement>('select', { id: 'sync-server-every' });
  for (const [v, label] of [['0', 'Off'], ['5', 'Every 5 min'], ['15', 'Every 15 min'], ['30', 'Every 30 min'], ['60', 'Every hour']]) every.append(make('option', { value: v, textContent: label }));
  const now = make<HTMLButtonElement>('button', { type: 'button', className: 'nb-btn', id: 'sync-server-now', textContent: 'Sync now' });
  const status = make('p', { className: 'fine', id: 'sync-server-status' });
  status.setAttribute('aria-live', 'polite');
  const row1 = make('label', { className: 'row sync-server' }, make('span', {}, 'Sync server'), url);
  const row2 = make('div', { className: 'row sync-server-actions' }, make('label', {}, 'Auto sync ', every), now);
  anchor.after(row1, row2, status);
  return { url, every, now, status };
}

function initServerSync(toast: (m: string) => void, bridge?: SyncBridge): void {
  const ui = serverControls();
  if (!ui) return;
  let config = readConfig();
  let pass: string | null = takeHandoff();
  let running = false;
  ui.url.value = config.url;
  ui.every.value = String(config.every);
  if (ui.every.selectedIndex < 0) ui.every.value = '0';

  const describe = (extra?: string) => {
    const parts: string[] = [];
    if (extra) parts.push(extra);
    else if (!config.url) parts.push('Your own server. It only ever sees locked data.');
    else if (config.last) parts.push(`Last synced ${new Date(config.last).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}.`);
    else parts.push('Not synced yet.');
    if (config.url && config.every && !pass && !extra) parts.push('Auto sync starts after one Sync now.');
    ui.status.textContent = parts.join(' ');
    ui.now.disabled = !config.url || running;
  };

  const save = () => {
    const raw = ui.url.value.trim();
    config = { ...config, every: Number(ui.every.value) || 0 };
    if (!raw) {
      config = { ...config, url: '', last: undefined };
      writeConfig(config);
      return describe();
    }
    void import('./sync').then(({ normalizeServerUrl }) => {
      const url = normalizeServerUrl(raw);
      if (!url) return describe('Use an https:// address (plain http only works for this computer).');
      if (url !== config.url) config = { ...config, url, last: undefined };
      ui.url.value = url;
      writeConfig(config);
      describe();
    });
  };
  ui.url.addEventListener('change', save);
  ui.every.addEventListener('change', save);
  // Enter in the address must not submit (and close) the settings sheet.
  ui.url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  const getPass = async (): Promise<string | null> => {
    if (pass) return pass;
    const saved = bridge ? await bridge.passphrase().catch(() => null) : null;
    if (saved) return (pass = saved);
    const got = await askPassphrase('Enter the passphrase you use for Lemma sync, the same on every device. It never leaves this device; the server only stores encrypted data.', false);
    return got?.passphrase ?? null;
  };

  const syncNow = async (quiet: boolean) => {
    if (running || !config.url) return;
    if (quiet && !pass) return; // automatic sync never prompts
    if (quiet && !navigator.onLine) return;
    // A sync that brings changes reloads the page: never in the background while something is in progress.
    if (quiet && busy()) return;
    const p = await getPass();
    if (!p) return;
    running = true;
    describe('Syncing…');
    try {
      const { syncWithServer, estimatePassphraseStrength } = await import('./sync');
      const result = await syncWithServer(config.url, p, {
        confirmCreate: () => {
          if (quiet) return false;
          if (estimatePassphraseStrength(p).score < 2) throw new Error('Nothing is stored under this passphrase yet. To start syncing, choose a stronger passphrase.');
          return confirm('This server has nothing stored for this passphrase yet.\n\nStart syncing this device’s data to it? (If you already sync another device, check the passphrase for typos first.)');
        },
      });
      pass = p;
      config = { ...readConfig(), url: config.url, every: config.every, last: Date.now() };
      writeConfig(config);
      if (result.changedHere) {
        // The app reads its data at startup, so changes from another device show after a reload.
        try {
          sessionStorage.setItem(SERVER_HANDOFF, p);
        } catch {
          // Automatic sync pauses until the next "Sync now".
        }
        later(`Synced: ${result.summary}`);
        location.reload();
        return;
      }
      if (!quiet) toast(`Synced: ${result.summary}`);
      running = false;
      describe();
    } catch (e) {
      running = false;
      const code = (e as { code?: string }).code;
      if (code === 'wrong-passphrase' || code === 'corrupt-file') pass = null;
      if (code === 'corrupt-file') describe('The copy on the server failed its integrity check (it was altered or damaged). Nothing on this device was changed.');
      else describe(message(e));
      if (!quiet) toast(message(e));
    }
  };

  ui.now.addEventListener('click', () => void syncNow(false));
  describe();
  // With a passphrase in memory: sync when the period has passed (checked every minute), and when back online.
  const due = () => config.every > 0 && Date.now() - (config.last ?? 0) >= config.every * 60_000;
  setInterval(() => {
    if (due()) void syncNow(true);
  }, 60_000);
  window.addEventListener('online', () => void (due() && syncNow(true)));
  // Back to this device from another one (phone ↔ laptop): catch up straight away rather than at the next period,
  // as long as nothing is being typed and no sheet is open (a sync that brings changes reloads the page).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !config.every || !pass) return;
    if (Date.now() - (config.last ?? 0) < 60_000) return;
    void syncNow(true);
  });
  if (pass && due()) void syncNow(true);
}
