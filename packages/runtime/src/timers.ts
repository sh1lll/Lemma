import { D, type Answer } from '@lemma/math-core';

/** "set a timer for 12 minutes", "start a 12-minute timer", "timer 90 seconds". */
const UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)`;
const PART = String.raw`(\d+(?:\.\d+)?)\s*-?\s*${UNIT}`;

const SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 };
const toSeconds = (n: string, u: string) => Number(n) * SECONDS[u.startsWith('h') ? 'h' : u.startsWith('m') ? 'm' : 's']!;

export function parseTimer(input: string): Answer | null {
  const s = input.toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (!/\btimer\b|\bcountdown\b|\balarm in\b/.test(s)) return null;
  const parts = [...s.matchAll(new RegExp(PART, 'g'))];
  if (!parts.length) return null;
  const seconds = parts.reduce((t, m) => t + toSeconds(m[1]!, m[2]!), 0);
  if (!(seconds > 0) || seconds > 7 * 86400) return null;
  const label = /\bto (.+)$/.exec(s)?.[1] ?? /\bfor (?:the )?([a-z][a-z ]+)$/.exec(s)?.[1] ?? '';
  const pretty = formatDuration(seconds);
  return {
    ok: true,
    kind: 'timer',
    input,
    expression: label ? `Timer · ${label}` : 'Timer',
    primary: { display: pretty, plain: String(seconds), spoken: `Timer set for ${pretty}` },
    value: new D(seconds),
    notes: ['Runs while Lemma is open'],
    action: { type: 'timer', seconds, label: label || pretty },
  };
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h && `${h}h`, m && `${m}m`, sec && `${sec}s`].filter(Boolean).join(' ') || '0s';
}

export function clock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
