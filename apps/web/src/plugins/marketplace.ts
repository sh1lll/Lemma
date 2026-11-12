import {
  CATEGORIES,
  compareReleases,
  ed25519Supported,
  findUpdates,
  MarketplaceError,
  searchEntries,
  verifyManifest,
  verifySignedIndex,
  type Category,
  type MarketplaceBundle,
  type MarketplaceEntry,
  type MarketplaceIndex,
} from '@lemma/marketplace';
import type { PluginManifest } from '@lemma/plugin-engine';
import type { InstalledPlugin } from './host';

/**
 * Extensions → Marketplace. Reads a signed static index (packages/marketplace): online when a URL is configured and
 * the signature verifies, otherwise the copy bundled with the app, so it works offline. Every manifest is checked
 * against the SHA-256 in the signed index before the normal install (and script approval) runs.
 * No ratings or reviews are shown: there is no honest source for them yet.
 */

/** Where the published index lives (any static host). Empty: the bundled copy only. */
export const MARKETPLACE_URL = '';
/** Optional override, e.g. a self-hosted or staging index. It still has to be signed with a key the app trusts. */
const URL_KEY = 'lemma.marketplace-url';
/** Newest online index time accepted, so a host can't roll the listing back to an older signed version. */
const SEEN_KEY = 'lemma.marketplace-seen.v1';

export interface Market {
  index: MarketplaceIndex;
  source: 'online' | 'built-in';
  /** Why the online index wasn't used, if one is configured. */
  note?: string;
  manifest(entry: MarketplaceEntry): Promise<PluginManifest>;
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

async function bundled(): Promise<Market> {
  const raw = (await import('@lemma/marketplace/bundle.json?raw')).default;
  const bundle = JSON.parse(raw) as MarketplaceBundle;
  // The bundled copy ships inside the app, so it's as trusted as the app; still verify it where the browser can.
  const index = (await ed25519Supported()) ? await verifySignedIndex(bundle.signed) : bundle.signed.index;
  return { index, source: 'built-in', manifest: (e) => verifyManifest(e, bundle.manifests[e.id]) };
}

async function online(url: string, floor: string): Promise<Market> {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new MarketplaceError(`The online marketplace returned ${res.status}`);
  const index = await verifySignedIndex(await res.json());
  const seen = read(SEEN_KEY) ?? '';
  const newest = seen > floor ? seen : floor;
  if (index.generated < newest) throw new MarketplaceError('The online marketplace is older than a version already seen');
  try {
    localStorage.setItem(SEEN_KEY, index.generated);
  } catch {
    // Rollback protection lasts for this session.
  }
  return {
    index,
    source: 'online',
    async manifest(e) {
      const r = await fetch(new URL(e.path, new URL(url, location.href)), { cache: 'no-cache', credentials: 'omit', signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new MarketplaceError(`Couldn’t download “${e.name}” (${r.status})`);
      return verifyManifest(e, await r.json());
    },
  };
}

let cached: Promise<Market> | null = null;

export function loadMarket(): Promise<Market> {
  cached ??= (async () => {
    const local = await bundled();
    const url = read(URL_KEY) || MARKETPLACE_URL;
    if (!url) return local;
    try {
      return await online(url, local.index.generated);
    } catch (e) {
      return { ...local, note: `${e instanceof Error ? e.message : String(e)}. Showing the copy built into the app.` };
    }
  })();
  cached.catch(() => (cached = null));
  return cached;
}

export async function updatesFor(installed: InstalledPlugin[]): Promise<number> {
  const m = await loadMarket();
  return findUpdates(
    installed.map((p) => p.manifest),
    m.index,
  ).length;
}

// Search and filter survive the re-render that follows an install.
let query = '';
let category: Category | '' = '';

export interface MarketContext {
  installed(): InstalledPlugin[];
  /** The manager's install (asks for approval for scripts). Resolves false if the user declined. */
  install(m: PluginManifest): boolean;
  toast(m: string): void;
  el(tag: string, props?: Record<string, unknown>, ...kids: (Node | string)[]): HTMLElement;
}

export async function renderMarketplace(root: HTMLElement, ctx: MarketContext): Promise<void> {
  const { el } = ctx;
  const status = el('p', { className: 'fine market-status' }, 'Loading the marketplace…');
  root.append(status);
  let market: Market;
  try {
    market = await loadMarket();
  } catch (e) {
    status.textContent = `The marketplace couldn’t be loaded: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  const when = new Date(market.index.generated).toLocaleDateString([], { dateStyle: 'medium' });
  status.textContent = `${market.source === 'online' ? 'Online listing' : 'Listing built into the app'}, updated ${when}. Every listing is signed by Lemma and checked before install. No ratings or reviews yet.`;
  if (market.note) root.append(el('p', { className: 'fine market-note', role: 'status' }, market.note));

  const search = el('input', { type: 'search', placeholder: 'Search extensions', value: query, className: 'market-search' }) as HTMLInputElement;
  search.setAttribute('aria-label', 'Search extensions');
  const cat = el('select', { className: 'market-category' }) as HTMLSelectElement;
  cat.setAttribute('aria-label', 'Category');
  cat.append(el('option', { value: '', textContent: 'All categories' }));
  for (const [k, label] of Object.entries(CATEGORIES)) cat.append(el('option', { value: k, textContent: label }));
  cat.value = category;
  const results = el('div', { className: 'market-results' });
  const filters = el('div', { className: 'row market-filters' }, search, cat);
  // Layout without touching style.css: wrap on narrow screens instead of overflowing.
  Object.assign(filters.style, { flexWrap: 'wrap', gap: '8px' });
  Object.assign(search.style, { flex: '1 1 12em', minWidth: '0' });
  Object.assign(cat.style, { flex: '0 1 auto', maxWidth: '100%' });
  root.append(filters, results);

  const installedRelease = (id: string) => ctx.installed().find((p) => p.manifest.id === id)?.manifest.release;

  const act = (e: MarketplaceEntry, label: string, b: HTMLButtonElement) => async () => {
    b.disabled = true;
    b.textContent = 'Checking…';
    try {
      const m = await market.manifest(e);
      if (!ctx.install(m)) {
        b.disabled = false;
        b.textContent = label;
      }
    } catch (err) {
      b.disabled = false;
      b.textContent = label;
      ctx.toast(err instanceof Error ? err.message : String(err));
    }
  };

  const card = (e: MarketplaceEntry) => {
    const have = installedRelease(e.id);
    const actions: HTMLElement[] = [];
    if (have === undefined || compareReleases(e.release, have) > 0) {
      const label = have === undefined ? 'Install' : `Update to ${e.release}`;
      const b = el('button', { type: 'button', className: have === undefined ? 'nb-btn' : 'nb-btn primary', textContent: label }) as HTMLButtonElement;
      b.setAttribute('aria-label', `${label}: ${e.name}`);
      b.addEventListener('click', act(e, label, b));
      actions.push(b);
    }
    if (have !== undefined) actions.unshift(el('span', { className: 'fine' }, have === e.release ? 'Installed ✓' : `Installed ${have}`));
    const perms = e.kind === 'script' ? (e.permissions.length ? ` · internet: ${e.permissions.join(', ')}` : ' · no internet access') : '';
    return el(
      'div',
      { className: 'ext market-entry' },
      el('div', { className: 'ext-head' }, el('strong', {}, e.name), el('span', { className: `ext-kind ${e.kind}` }, e.kind === 'formula' ? 'formula · runs no code' : 'script · sandboxed')),
      el('p', { className: 'fine' }, e.description),
      el('code', { className: 'ext-example' }, e.examples[0] ?? ''),
      el('p', { className: 'fine' }, `${CATEGORIES[e.category]} · by ${e.author} · version ${e.release}${perms}`),
      el('div', { className: 'ext-actions' }, ...actions),
    );
  };

  const draw = () => {
    results.replaceChildren();
    const updates = findUpdates(
      ctx.installed().map((p) => p.manifest),
      market.index,
    );
    if (updates.length && !query && !category) {
      results.append(el('h3', {}, updates.length === 1 ? '1 update' : `${updates.length} updates`));
      for (const u of updates) results.append(card(u.to));
      results.append(el('h3', {}, 'All extensions'));
    }
    const list = searchEntries(market.index.entries, query, category);
    if (!list.length) results.append(el('p', { className: 'fine' }, 'No extensions match.'));
    for (const e of list) results.append(card(e));
  };

  search.addEventListener('input', () => {
    query = search.value;
    draw();
  });
  // Enter must not submit (and close) the dialog's form.
  search.addEventListener('keydown', (ev) => ev.key === 'Enter' && ev.preventDefault());
  cat.addEventListener('change', () => {
    category = cat.value as Category | '';
    draw();
  });
  draw();
}
