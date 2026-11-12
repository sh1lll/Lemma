import type { StyleId } from '@lemma/tutor-engine';

/** User settings, kept in storage.sync so they follow the browser profile. Nothing here leaves the browser otherwise. */
export interface Settings {
  /** Teaching style for "Watch lesson". */
  tutorStyle: StyleId;
  /** Tutor mode (hints, then steps, then the answer) or answers first. Tutor is the default. */
  mode: 'tutor' | 'answer';
  /** When on, "Fill" stays disabled until the steps for that answer have been opened. */
  learningFirst: boolean;
  /** Domains where filling answers is turned off (the user marks these as assessments). */
  assessmentDomains: string[];
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  tutorStyle: 'chalkboard',
  mode: 'tutor',
  learningFirst: true,
  assessmentDomains: [],
  theme: 'system',
};

const STYLE_SET = new Set<string>(['chalkboard', 'marker', 'visual', 'lecture', 'socratic', 'exam', 'quick', 'beginner', 'proof', 'story']);

/** Validates whatever storage holds (older versions, hand edits) into a complete Settings object. */
export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw.tutorStyle === 'string' && STYLE_SET.has(raw.tutorStyle)) s.tutorStyle = raw.tutorStyle as StyleId;
  if (raw.mode === 'tutor' || raw.mode === 'answer') s.mode = raw.mode;
  if (typeof raw.learningFirst === 'boolean') s.learningFirst = raw.learningFirst;
  if (Array.isArray(raw.assessmentDomains)) s.assessmentDomains = raw.assessmentDomains.map((d) => normalizeDomain(String(d))).filter((d): d is string => !!d);
  if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') s.theme = raw.theme;
  return s;
}

/** "https://www.Quiz.example.edu/path" → "www.quiz.example.edu". Returns null for things that aren't host names. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(d) && !/^\[[0-9a-f:]+\]$/.test(d)) return null;
  return d;
}

/** True when `hostname` is one of the domains or a subdomain of one. */
export function isAssessmentHost(hostname: string, domains: readonly string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

export async function loadSettings(): Promise<Settings> {
  try {
    return normalizeSettings(await chrome.storage.sync.get(null));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch as Record<string, unknown>);
}
