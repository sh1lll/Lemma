import { loadSettings, type Settings } from '../core/settings';
import './theme.css';

/** Applies the light/dark choice from settings (system by default) and keeps it in sync with the options page. */
export async function initTheme(): Promise<Settings> {
  const s = await loadSettings();
  apply(s.theme);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' && c.theme) apply((c.theme.newValue as Settings['theme']) ?? 'system');
  });
  return s;
}

function apply(t: Settings['theme']) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
