import { defaultLocalModel, LOCAL_MODELS } from '@lemma/ai-engine/src/providers/local';
import { listModels, presetById, PROVIDER_PRESETS } from '@lemma/ai-engine/src/providers/presets';
import { localModel, runsNatively } from './local';
import { loadAiKey, saveAiKey, saveSettings, type Settings } from '../storage';

/**
 * The AI section of Settings: any provider, any model. Hosted APIs, local servers (Ollama, LM Studio) or the
 * built-in on-device model. Loaded with the Settings dialog, so it costs the calculator nothing.
 */
export function bindAiSettings(form: HTMLFormElement, settings: Settings, onChange: () => void): () => void {
  const $ = <T extends Element>(sel: string) => form.querySelector(sel) as T;
  const provider = $<HTMLSelectElement>('#ai-provider');
  const hint = $<HTMLElement>('#ai-hint');
  const base = $<HTMLInputElement>('input[name="aiBaseUrl"]');
  const key = $<HTMLInputElement>('input[name="aiKey"]');
  const model = $<HTMLInputElement>('#ai-model');
  const list = $<HTMLDataListElement>('#ai-models');
  const status = $<HTMLElement>('#ai-status');
  const action = $<HTMLButtonElement>('#ai-test');
  const more = $<HTMLDetailsElement>('#ai-more');

  provider.replaceChildren(
    ...PROVIDER_PRESETS.map((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      return o;
    }),
  );

  const fillModels = (ids: string[]) =>
    list.replaceChildren(
      ...ids.map((id) => {
        const o = document.createElement('option');
        o.value = id;
        return o;
      }),
    );

  const sync = () => {
    const p = presetById(settings.aiProvider);
    provider.value = p.id;
    hint.replaceChildren(p.hint);
    if (p.keyUrl) {
      const a = document.createElement('a');
      a.href = p.keyUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = ' Get a key ↗';
      hint.append(a);
    }
    (base.closest('.row') as HTMLElement).hidden = p.kind !== 'openai-compatible' || !(p.local || p.id === 'custom');
    base.placeholder = p.baseUrl ?? 'https://example.com/v1';
    base.value = settings.aiBaseUrls[p.id] ?? '';
    (key.closest('.row') as HTMLElement).hidden = p.kind === 'builtin' || (!!p.local && !p.needsKey);
    key.value = loadAiKey(p.id);
    // A provider that can't work without a key opens "More", where the key goes.
    if (p.needsKey && !key.value) more.open = true;
    model.value = settings.aiModels[p.id] ?? (p.kind === 'builtin' ? defaultLocalModel(runsNatively()) : p.defaultModel);
    model.placeholder = p.kind === 'builtin' ? 'Built-in model or Hugging Face ONNX id' : 'Model id';
    status.textContent = '';
    if (p.kind === 'builtin') {
      // Only models that run here: the browser can't hold the larger one (see LOCAL_MODELS).
      fillModels(LOCAL_MODELS.filter((m) => runsNatively() || m.browser).map((m) => m.id));
      const m = LOCAL_MODELS.find((x) => x.id === model.value);
      action.textContent = localModel(model.value).ready ? 'Ready ✓' : `Download${m ? ` (${m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} GB` : `${m.sizeMB} MB`})` : ''}`;
      status.textContent = m
        ? `${m.label} · ${m.license}${!runsNatively() && !m.browser ? ' · needs the desktop app' : ''}${runsNatively() ? ' · runs natively' : ''}`
        : 'Any transformers.js-compatible ONNX model on Hugging Face';
    } else {
      fillModels([]);
      action.textContent = p.local ? 'Find local models' : 'Load models';
    }
  };

  const save = () => {
    saveSettings(settings);
    onChange();
  };

  provider.addEventListener('change', () => {
    settings.aiProvider = provider.value;
    save();
    sync();
  });
  base.addEventListener('input', () => {
    settings.aiBaseUrls[settings.aiProvider] = base.value.trim();
    save();
  });
  key.addEventListener('input', () => {
    saveAiKey(settings.aiProvider, key.value.trim());
    onChange();
  });
  model.addEventListener('input', () => {
    settings.aiModels[settings.aiProvider] = model.value.trim();
    save();
    if (presetById(settings.aiProvider).kind === 'builtin') sync();
  });

  action.addEventListener('click', async () => {
    const p = presetById(settings.aiProvider);
    if (p.kind === 'builtin') {
      const id = model.value.trim() || p.defaultModel;
      const m = localModel(id);
      if (m.ready) return;
      action.disabled = true;
      m.onStatus = (s) => (status.textContent = s || 'Ready ✓ (cached on this device)');
      m.load(id);
      await m.whenReady().catch((e: unknown) => (status.textContent = `Couldn’t load: ${e instanceof Error ? e.message : e}`));
      action.disabled = false;
      sync();
      return;
    }
    action.disabled = true;
    status.textContent = 'Connecting…';
    try {
      const ids = await listModels(p, { apiKey: loadAiKey(p.id), baseUrl: settings.aiBaseUrls[p.id] });
      fillModels(ids);
      status.textContent = ids.length ? `Connected · ${ids.length} model${ids.length === 1 ? '' : 's'}: pick one in Model` : 'Connected, but no models were listed';
      if (ids.length) {
        if (!ids.includes(model.value)) model.value = ids.includes(p.defaultModel) ? p.defaultModel : ids[0]!;
        settings.aiModels[p.id] = model.value;
        save();
      }
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      action.disabled = false;
    }
  });

  sync();
  return sync;
}
