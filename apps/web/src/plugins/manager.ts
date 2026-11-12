import { buildFormulaPlugin, CATALOG, PluginError, validateManifest, type PluginManifest } from '@lemma/plugin-engine';
import { loadPlugins, savePlugins, type InstalledPlugin } from './host';

/**
 * The extensions dialog: installed extensions (enable/disable/remove), the curated catalog, the no-code tool
 * builder, and import from a .json file. Script extensions ask for explicit approval, listing what they can do.
 */
export function openExtensions(dialog: HTMLDialogElement, onChange: (list: InstalledPlugin[]) => void, toast: (m: string) => void): void {
  let list = loadPlugins();
  const commit = () => {
    savePlugins(list);
    onChange(list);
    render();
  };

  /** Returns false if the user declined the script approval. */
  const install = (m: PluginManifest): boolean => {
    if (m.kind === 'script') {
      const hosts = (m.permissions ?? []).map((p) => p.replace(/^network:/, ''));
      const ok = confirm(
        `“${m.name}” runs its own code.\n\nIt runs in a sandbox: it can't see your history, notebooks, keys or this page, and it has no internet access${hosts.length ? ` except: ${hosts.join(', ')}` : ''}.\n\nInstall it?`,
      );
      if (!ok) return false;
    }
    const granted = m.kind === 'script' ? (m.permissions ?? []).map((p) => p.replace(/^network:/, '')) : [];
    list = [...list.filter((p) => p.manifest.id !== m.id), { manifest: m, enabled: true, installedAt: Date.now(), granted }];
    commit();
    toast(`Installed “${m.name}”. Try: ${m.examples?.[0]?.input ?? m.templates[0]}`);
    return true;
  };

  // Two views: your extensions (installed, catalog, builder, import) and the marketplace.
  let tab: 'mine' | 'market' = 'mine';
  const market = import('./marketplace');
  const tabs = () => {
    const bar = el('div', { className: 'seg ext-tabs' });
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Extensions view');
    const mk = (id: typeof tab, label: string) => {
      const b = button(label, () => {
        tab = id;
        render();
      }, '');
      b.setAttribute('aria-pressed', String(tab === id));
      b.dataset.tab = id;
      return b;
    };
    const marketBtn = mk('market', 'Marketplace');
    bar.append(mk('mine', 'My extensions'), marketBtn);
    // Update check against the signed index (bundled copy, or online when configured).
    void market
      .then((m) => m.updatesFor(list))
      .then((n) => {
        if (n) marketBtn.textContent = `Marketplace · ${n} ${n === 1 ? 'update' : 'updates'}`;
      })
      .catch(() => undefined);
    return bar;
  };

  function el(tag: 'input', props?: Partial<HTMLInputElement>, ...kids: (Node | string)[]): HTMLInputElement;
  function el(tag: 'a', props?: Partial<HTMLAnchorElement>, ...kids: (Node | string)[]): HTMLAnchorElement;
  function el(tag: string, props?: Record<string, unknown>, ...kids: (Node | string)[]): HTMLElement;
  function el(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElement {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  }

  const card = (m: PluginManifest, actions: HTMLElement[]) =>
    el(
      'div',
      { className: 'ext' },
      el('div', { className: 'ext-head' }, el('strong', {}, m.name), el('span', { className: `ext-kind ${m.kind}` }, m.kind === 'formula' ? 'formula · runs no code' : 'script · sandboxed')),
      el('p', { className: 'fine' }, m.description),
      el('code', { className: 'ext-example' }, m.examples?.[0]?.input ?? m.templates[0]!),
      el('div', { className: 'ext-actions' }, ...actions),
    );

  const button = (label: string, on: () => void, cls = 'nb-btn') => {
    const b = el('button', { type: 'button', className: cls, textContent: label }) as HTMLButtonElement;
    b.addEventListener('click', on);
    return b;
  };

  function render() {
    const body = dialog.querySelector<HTMLElement>('.ext-body')!;
    body.replaceChildren(tabs());
    if (tab === 'market') {
      const root = el('div', { className: 'market' });
      body.append(root);
      void market.then((m) => m.renderMarketplace(root, { installed: () => list, install, toast, el }));
      return;
    }

    body.append(el('h3', {}, 'Installed'));
    if (!list.length) body.append(el('p', { className: 'fine' }, 'No extensions yet. Add one from the catalog, build your own, or import a file.'));
    for (const p of list) {
      const toggle = el('input', { type: 'checkbox', checked: p.enabled });
      toggle.setAttribute('aria-label', `Enable ${p.manifest.name}`);
      toggle.addEventListener('change', () => {
        p.enabled = toggle.checked;
        commit();
      });
      body.append(
        card(p.manifest, [
          el('label', { className: 'ext-toggle' }, toggle, ' Enabled'),
          button('Export', () => {
            const a = el('a', { download: `${p.manifest.id}.lemma-plugin.json`, href: URL.createObjectURL(new Blob([JSON.stringify(p.manifest, null, 2)], { type: 'application/json' })) });
            a.click();
          }),
          button('Remove', () => {
            list = list.filter((x) => x !== p);
            commit();
          }),
        ]),
      );
    }

    body.append(el('h3', {}, 'Catalog'));
    for (const m of CATALOG) {
      const have = list.some((p) => p.manifest.id === m.id);
      body.append(card(m, [have ? el('span', { className: 'fine' }, 'Installed ✓') : button('Install', () => install(m))]));
    }

    // No-code builder
    body.append(el('h3', {}, 'Build your own'));
    const name = el('input', { placeholder: 'Name, e.g. Tile cost' });
    const formula = el('input', { placeholder: 'Formula, e.g. area * price * 1.1' });
    const inputs = el('input', { placeholder: 'Inputs in order, e.g. area m2, price' });
    const phrase = el('input', { placeholder: 'Optional phrase, e.g. tiles for {area} m2 at {price} each' });
    const unit = el('input', { placeholder: 'Result unit (optional)', size: 10 });
    const msg = el('p', { className: 'fine' });
    const builder = el('div', { className: 'ext-builder' }, name, formula, inputs, phrase, unit, msg);
    builder.append(
      button('Create tool', () => {
        try {
          const m = buildFormulaPlugin({
            name: name.value,
            formula: formula.value,
            inputs: inputs.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => {
                const [n = '', ...u] = s.split(/\s+/);
                return { name: n, unit: u.join(' ') || undefined };
              }),
            phrases: phrase.value ? [phrase.value] : [],
            resultUnit: unit.value.trim() || undefined,
          });
          install(m);
        } catch (e) {
          msg.textContent = e instanceof PluginError ? e.message : String(e);
        }
      }, 'nb-btn primary'),
    );
    body.append(builder);

    body.append(el('h3', {}, 'Import'));
    const file = el('input', { type: 'file', accept: '.json,application/json' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 200_000) return toast('That file is too large for an extension');
      try {
        install(validateManifest(JSON.parse(await f.text())));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Not a valid extension');
      }
    });
    body.append(file, el('p', { className: 'fine' }, 'Extensions are .json files in the Lemma extension format. Formula extensions run no code; script extensions run sandboxed, with only the internet access you approve.'));
  }

  render();
  if (!dialog.open) dialog.showModal();
}
