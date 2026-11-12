/**
 * Appearance. A "look" is a pair of palettes (light and dark); font, text size, density, corners and accent
 * are independent of it. Everything is applied as CSS custom properties on <html>, so every view, the
 * notebook, lesson videos and graphs pick it up without knowing about looks.
 */

export type LookId = 'comfy' | 'paper' | 'dusk' | 'ocean' | 'classic' | 'contrast';
export interface LookSettings {
  theme: 'system' | 'light' | 'dark';
  look: LookId;
  accent: string;
  font: 'rounded' | 'sans' | 'serif' | 'mono';
  textSize: 's' | 'm' | 'l' | 'xl';
  density: 'cozy' | 'compact';
  corners: 'round' | 'soft' | 'square';
  motion: 'full' | 'calm';
  motionAnswers?: boolean;
  motionPanels?: boolean;
  motionContent?: boolean;
  motionFeedback?: boolean;
  motionPress?: boolean;
  motionMic?: boolean;
}

type Palette = { bg: string; surface: string; surface2: string; ink: string; muted: string; faint: string; line: string; accent: string; accentInk: string; warn: string };

const P = (bg: string, surface: string, surface2: string, ink: string, muted: string, faint: string, line: string, accent: string, accentInk: string, warn: string): Palette => ({
  bg, surface, surface2, ink, muted, faint, line, accent, accentInk, warn,
});

/** Contrast: ink/bg ≥ 12:1, muted/bg ≥ 4.5:1 in every palette. */
export const LOOKS: Record<LookId, { label: string; light: Palette; dark: Palette }> = {
  comfy: {
    label: 'Comfy',
    light: P('#f2f0eb', '#fbfaf7', '#e9e6df', '#2a2926', '#68655e', '#a39f96', '#e0ddd5', '#467058', '#f4fbf6', '#a4521f'),
    dark: P('#1b1d1c', '#242725', '#2d302e', '#ecebe6', '#a3a59f', '#6b6e69', '#333735', '#9cc5a8', '#14231a', '#f0a875'),
  },
  paper: {
    label: 'Paper',
    light: P('#fafaf8', '#ffffff', '#f0f0ec', '#1c1c1a', '#616160', '#a6a6a2', '#e4e4df', '#2f5bd3', '#ffffff', '#b3401d'),
    dark: P('#161616', '#1f1f1f', '#2a2a2a', '#f0f0ee', '#a6a6a4', '#686866', '#323232', '#8fb0ff', '#0b1430', '#ffab8a'),
  },
  dusk: {
    label: 'Dusk',
    light: P('#f3eff4', '#fcfafc', '#e9e3eb', '#2b2530', '#6a6170', '#a79fad', '#e0d8e3', '#7a5aa6', '#ffffff', '#b04a3a'),
    dark: P('#1d1a22', '#26222c', '#302b37', '#eee9f2', '#aaa1b2', '#6f6878', '#36313e', '#c2a8e8', '#221733', '#f2a48f'),
  },
  ocean: {
    label: 'Ocean',
    light: P('#eef3f4', '#f9fbfb', '#e1e9ea', '#1f2a2c', '#5b6a6d', '#9aa8aa', '#d6e0e2', '#1b6f80', '#f2fbfd', '#a14a20'),
    dark: P('#141c1f', '#1b2528', '#223033', '#e6eff0', '#9db0b3', '#64767a', '#2a3a3e', '#7fcfdc', '#0b2429', '#f3a77b'),
  },
  classic: {
    label: 'Classic',
    light: P('#f4f3ee', '#ffffff', '#ebeae4', '#141416', '#5e5e64', '#a4a4a8', '#dcdbd4', '#4d6b00', '#f4ffd6', '#a14a00'),
    dark: P('#0e0f11', '#17181b', '#1f2024', '#f2f2ee', '#8d8e94', '#5a5b60', '#2a2b30', '#c8f04a', '#141a00', '#ffb36b'),
  },
  contrast: {
    label: 'High contrast',
    light: P('#ffffff', '#ffffff', '#f0f0f0', '#000000', '#3a3a3a', '#6e6e6e', '#000000', '#0040c0', '#ffffff', '#a00000'),
    dark: P('#000000', '#000000', '#141414', '#ffffff', '#d0d0d0', '#9a9a9a', '#ffffff', '#ffd200', '#000000', '#ff8f8f'),
  },
};

const FONTS: Record<LookSettings['font'], { sans: string; label: string }> = {
  rounded: { label: 'Rounded', sans: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  sans: { label: 'Sans', sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  serif: { label: 'Serif', sans: "ui-serif, 'New York', 'Iowan Old Style', 'Charter', Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', sans: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, monospace" },
};
const SIZES = { s: 0.92, m: 1, l: 1.1, xl: 1.22 };
const RADII = { round: [22, 14], soft: [14, 9], square: [6, 4] };

const dark = (s: LookSettings) => s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

/** Picks black or white text for an accent fill. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#141414' : '#ffffff';
}

export function applyLook(s: LookSettings): void {
  const root = document.documentElement;
  const isDark = dark(s);
  const p = (LOOKS[s.look] ?? LOOKS.comfy)[isDark ? 'dark' : 'light'];
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : p.accent;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface-2': p.surface2,
    '--ink': p.ink,
    '--muted': p.muted,
    '--faint': p.faint,
    '--line': p.line,
    '--accent': accent,
    '--accent-ink': accent === p.accent ? p.accentInk : inkFor(accent),
    '--accent-bg': accent,
    '--accent-soft': `color-mix(in srgb, ${accent} 14%, ${p.surface})`,
    '--warn': p.warn,
    '--mic': accent,
    '--mic-ink': accent === p.accent ? p.accentInk : inkFor(accent),
    '--sans': FONTS[s.font]?.sans ?? FONTS.rounded.sans,
    '--scale': String(SIZES[s.textSize] ?? 1),
    '--gap': s.density === 'compact' ? '10px' : '16px',
    '--radius': `${(RADII[s.corners] ?? RADII.round)[0]}px`,
    '--radius-sm': `${(RADII[s.corners] ?? RADII.round)[1]}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.dataset.look = s.look;
  root.dataset.motion = s.motion;
  // The kinds of motion that may play (motion.ts); none under Calm.
  const on = { answers: s.motionAnswers, panels: s.motionPanels, content: s.motionContent, feedback: s.motionFeedback, press: s.motionPress, mic: s.motionMic };
  root.dataset.anim = s.motion === 'calm' ? '' : Object.keys(on).filter((k) => on[k as keyof typeof on] !== false).join(' ');
  root.dataset.density = s.density;
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = p.bg;
}

/** Re-applies when the OS switches light/dark while the theme follows the system. */
export function watchSystemTheme(get: () => LookSettings): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get().theme === 'system') applyLook(get());
  });
}

export const LOOK_OPTIONS = (Object.keys(LOOKS) as LookId[]).map((id) => ({ id, label: LOOKS[id].label }));
export const FONT_OPTIONS = (Object.keys(FONTS) as LookSettings['font'][]).map((id) => ({ id, label: FONTS[id].label }));

/** Swatches for the look picker: background, surface and accent of the current light/dark mode. */
export function swatch(id: LookId, s: LookSettings): [string, string, string] {
  const p = LOOKS[id][dark(s) ? 'dark' : 'light'];
  return [p.bg, p.surface, p.accent];
}
