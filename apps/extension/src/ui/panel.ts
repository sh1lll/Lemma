/**
 * Opens the side panel (Chrome/Edge/Brave/Arc) or sidebar (Firefox). Both browsers only allow this from a
 * user action, so call it straight from a click or command handler. Returns false when it could not open.
 */
export async function openPanel(windowId?: number): Promise<boolean> {
  try {
    if (typeof browser !== 'undefined' && browser.sidebarAction) {
      await browser.sidebarAction.open();
      return true;
    }
    if (chrome.sidePanel) {
      const wid = windowId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.windowId;
      await chrome.sidePanel.open(wid === undefined ? {} : { windowId: wid });
      return true;
    }
  } catch {
    /* not from a user gesture, or the browser has no panel */
  }
  return false;
}
