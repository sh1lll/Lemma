/**
 * The user's own symbols and the recently used ones, kept on this device (and in backups/sync: see sync.ts).
 * Small on purpose: the calculator reads custom values from here, the catalog itself loads with the menu.
 */

export interface CustomSymbol {
  id: string;
  /** What gets inserted: one character or any snippet. */
  text: string;
  name: string;
  /** Optional value ("1.618…"): lets the symbol be used in calculations. */
  value?: string;
  updated: number;
}

export const CUSTOM_KEY = 'lemma.symbols.v1';
const RECENT_KEY = 'lemma.symbols.recent.v1';
const RECENT_LIMIT = 16;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the change lasts for this visit only.
  }
}

let custom: CustomSymbol[] | null = null;
export const loadCustom = (): CustomSymbol[] => (custom ??= read<CustomSymbol[]>(CUSTOM_KEY, []).filter((s) => s && typeof s.text === 'string' && s.text));
export function saveCustom(list: CustomSymbol[]): void {
  custom = list;
  write(CUSTOM_KEY, list);
}
/** Forget the cached list (a restore or another tab changed storage). */
export const reloadCustom = (): void => void (custom = null);

export const loadRecent = (): string[] => read<string[]>(RECENT_KEY, []).filter((s) => typeof s === 'string');
export function noteRecent(text: string): void {
  write(RECENT_KEY, [text, ...loadRecent().filter((t) => t !== text)].slice(0, RECENT_LIMIT));
}

const plainLetters = /[A-Za-z0-9_]/;
/**
 * Custom symbols with a value stand for that value in calculations: "2ψ" with ψ = 2.5 is read as 2·(2.5).
 * Only symbols that aren't ordinary letters or digits are replaced, so a snippet like "g" never breaks "log".
 */
export function withCustomValues(input: string): string {
  const list = loadCustom();
  if (!list.length) return input;
  let out = input;
  for (const s of [...list].sort((a, b) => b.text.length - a.text.length)) {
    const v = s.value?.trim();
    if (!v || plainLetters.test(s.text) || !out.includes(s.text)) continue;
    out = out.split(s.text).join(`(${v})`);
  }
  return out;
}
