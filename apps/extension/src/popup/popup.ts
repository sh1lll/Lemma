import { APP_URL } from '../config';
import { mountCalculator } from '../ui/calculator';
import { $ } from '../ui/dom';
import { openPanel } from '../ui/panel';
import { initTheme } from '../ui/theme';

void initTheme();
mountCalculator($('#calc'), { autofocus: true });

const full = $('#full') as HTMLAnchorElement;
full.href = APP_URL;
const status = $('#status');

$('#options').addEventListener('click', () => void chrome.runtime.openOptionsPage().then(() => window.close()));

$('#panel').addEventListener('click', async () => {
  // Safari has no side panel: the same page opens in a tab.
  if (!(await openPanel())) await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
  window.close();
});

// The popup click grants activeTab for the current tab, which is what lets the background capture it.
$('#screen').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openPanel(tab?.windowId);
  try {
    await chrome.runtime.sendMessage({ type: 'lemma:start-region', tabId: tab?.id });
    window.close();
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : 'This page cannot be captured.';
  }
});
