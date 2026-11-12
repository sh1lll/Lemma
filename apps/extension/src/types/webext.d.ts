/**
 * The small slice of the WebExtensions API this extension uses (no @types/chrome in the workspace).
 * Promise-returning forms only: Chrome MV3 and Firefox MV3 both return promises from `chrome.*`.
 */
declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
    }
    interface Port {
      name: string;
      postMessage(msg: unknown): void;
      disconnect(): void;
      onDisconnect: Event<(p: Port) => void>;
      onMessage: Event<(msg: unknown, p: Port) => void>;
    }
    interface InstalledDetails {
      reason: string;
    }
    const id: string;
    function getURL(path: string): string;
    function sendMessage<T = unknown>(msg: unknown): Promise<T>;
    function connect(info?: { name?: string }): Port;
    function openOptionsPage(): Promise<void>;
    const onMessage: Event<(msg: unknown, sender: MessageSender, sendResponse: (r?: unknown) => void) => boolean | void | Promise<unknown>>;
    const onConnect: Event<(p: Port) => void>;
    const onInstalled: Event<(d: InstalledDetails) => void>;
    const onStartup: Event<() => void>;
  }

  interface Event<F> {
    addListener(f: F): void;
    removeListener(f: F): void;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      url?: string;
      active: boolean;
    }
    function query(q: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
    function get(id: number): Promise<Tab>;
    /** The tab this extension page is in; undefined in a popup or side panel. */
    function getCurrent(): Promise<Tab | undefined>;
    function create(p: { url: string; active?: boolean }): Promise<Tab>;
    function sendMessage<T = unknown>(tabId: number, msg: unknown, opts?: { frameId?: number }): Promise<T>;
    function captureVisibleTab(windowId: number, opts: { format: 'png' | 'jpeg'; quality?: number }): Promise<string>;
  }

  namespace scripting {
    function executeScript(p: { target: { tabId: number; frameIds?: number[]; allFrames?: boolean }; files?: string[]; func?: (...a: never[]) => unknown; args?: unknown[] }): Promise<{ result?: unknown; frameId: number }[]>;
  }

  namespace contextMenus {
    interface OnClickData {
      menuItemId: string | number;
      selectionText?: string;
      frameId?: number;
      pageUrl?: string;
    }
    function create(p: { id: string; title: string; contexts: string[]; parentId?: string }): void;
    function removeAll(): Promise<void>;
    const onClicked: Event<(info: OnClickData, tab?: tabs.Tab) => void>;
  }

  namespace commands {
    const onCommand: Event<(command: string, tab?: tabs.Tab) => void>;
  }

  namespace storage {
    interface Area {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const sync: Area;
    const local: Area;
    const session: Area | undefined;
    const onChanged: Event<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>;
  }

  namespace sidePanel {
    function open(o: { windowId?: number; tabId?: number }): Promise<void>;
    function setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void>;
  }
}

/** Firefox exposes `browser.*`; only the sidebar is used through it (Chrome has no sidebar_action). */
declare namespace browser {
  namespace sidebarAction {
    function open(): Promise<void>;
  }
}
