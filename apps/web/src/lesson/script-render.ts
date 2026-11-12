// Canvas renderer for lesson scripts. One synchronous draw(t) shared by the player and the video exporter.
//
// Two engines:
//  - board (chalkboard, marker, socratic, exam): everything is written by hand onto one long page that scrolls
//    up as it fills. Words use Caveat/Kalam; math is KaTeX (renderMathImage) in chalk/marker colours, revealed
//    by a clip that moves left to right with a chalk or marker tip following the ink.
//  - slide (visual, lecture, quick): typeset scenes that fade, rise and slide; worked steps stack and scroll,
//    graphs draw their axes, trace their curves and pop their marks.
// Everything (sprites, paths, scroll keyframes) is laid out once up front, so frames are cheap and seekable.
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import { parseGraph, sampleExplicit, niceStep, type Polyline } from '@lemma/graph-engine';
import { createSession } from '@lemma/math-core';
import { renderMathImage } from './export';
import { texToPlain } from './timeline';
import {
  buildScriptTimeline,
  sceneIndexAt,
  type Ink,
  type LessonScript,
  type Scene,
  type ScriptSceneTiming,
  type ScriptTimeline,
  type StyleId,
  sceneCaptionAt,
} from './script-timeline';

// ---------------------------------------------------------------- looks

interface RenderLook {
  id: StyleId;
  engine: 'board' | 'slide';
  dark: boolean;
  ink: Record<Ink, string>;
  pen: 'chalk' | 'marker' | null;
  /** Handwriting font and the factor that evens out its visual size. */
  hand: string;
  handScale: number;
  handWeight: number;
  handBold: number;
  /** Typeset faces (slide engine; also board captions). */
  face: string;
  headFace: string;
  /** Type size multiplier for the slide engine. */
  size: number;
  chalk: boolean;
  /** Board math size multiplier. */
  math?: number;
  card: { fill: string; stroke: string };
  /** Mistake panels. */
  bad: { fill: string; edge: string };
  goodPanel: { fill: string; edge: string };
}

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const CAVEAT = "Caveat, 'Segoe Print', 'Bradley Hand', cursive";
const KALAM = "Kalam, 'Segoe Print', 'Bradley Hand', cursive";

const CHALK_INK: Record<Ink, string> = {
  main: '#f4f1e8',
  accent: '#f7dc6f',
  second: '#f6a9c0',
  third: '#9cd3f5',
  muted: '#aab4ad',
  warn: '#ff9b85',
  good: '#aee59f',
};

const LOOKS: Record<StyleId, RenderLook> = {
  chalkboard: {
    id: 'chalkboard', engine: 'board', dark: true, ink: CHALK_INK, pen: 'chalk', hand: CAVEAT, handScale: 1.28, handWeight: 500, handBold: 700,
    face: SANS, headFace: SANS, size: 1, chalk: true,
    card: { fill: 'rgba(20,32,26,0.96)', stroke: '#f7dc6f' },
    bad: { fill: 'rgba(255,155,133,0.10)', edge: '#ff9b85' }, goodPanel: { fill: 'rgba(174,229,159,0.10)', edge: '#aee59f' },
  },
  socratic: {
    id: 'socratic', engine: 'board', dark: true, ink: { ...CHALK_INK, accent: '#ffcf6b', third: '#8fd0ff' }, pen: 'chalk', hand: CAVEAT, handScale: 1.28, handWeight: 500, handBold: 700,
    face: SANS, headFace: SANS, size: 1, chalk: true,
    card: { fill: 'rgba(24,27,30,0.97)', stroke: '#ffcf6b' },
    bad: { fill: 'rgba(255,155,133,0.10)', edge: '#ff9b85' }, goodPanel: { fill: 'rgba(174,229,159,0.10)', edge: '#aee59f' },
  },
  marker: {
    id: 'marker', engine: 'board', dark: false,
    ink: { main: '#1f2229', accent: '#1d5fd1', second: '#d0342c', third: '#16884a', muted: '#7a828e', warn: '#d0342c', good: '#16884a' },
    pen: 'marker', hand: KALAM, handScale: 1, handWeight: 400, handBold: 700, face: SANS, headFace: SANS, size: 1, chalk: false,
    card: { fill: '#ffffff', stroke: '#1d5fd1' },
    bad: { fill: 'rgba(208,52,44,0.07)', edge: '#d0342c' }, goodPanel: { fill: 'rgba(22,136,74,0.08)', edge: '#16884a' },
  },
  exam: {
    id: 'exam', engine: 'board', dark: false,
    ink: { main: '#1d2330', accent: '#c2410c', second: '#7c3aed', third: '#0f766e', muted: '#757d8a', warn: '#dc2626', good: '#15803d' },
    pen: 'marker', hand: KALAM, handScale: 1, handWeight: 400, handBold: 700, face: SANS, headFace: SANS, size: 1, chalk: false,
    card: { fill: '#ffffff', stroke: '#c2410c' },
    bad: { fill: 'rgba(220,38,38,0.08)', edge: '#dc2626' }, goodPanel: { fill: 'rgba(21,128,61,0.08)', edge: '#15803d' },
  },
  visual: {
    id: 'visual', engine: 'slide', dark: true,
    ink: { main: '#eef3ff', accent: '#ffcb57', second: '#ff86b0', third: '#69c9ff', muted: '#93a4cc', warn: '#ff7b7b', good: '#79e2a6' },
    pen: null, hand: SANS, handScale: 1, handWeight: 400, handBold: 700, face: SANS, headFace: SANS, size: 1, chalk: false,
    card: { fill: 'rgba(255,255,255,0.06)', stroke: '#ffcb57' },
    bad: { fill: 'rgba(255,123,123,0.10)', edge: '#ff7b7b' }, goodPanel: { fill: 'rgba(121,226,166,0.10)', edge: '#79e2a6' },
  },
  quick: {
    id: 'quick', engine: 'slide', dark: true,
    ink: { main: '#ffffff', accent: '#c6f432', second: '#ff7ac6', third: '#5ad1ff', muted: '#a7a2bd', warn: '#ff6b6b', good: '#6ef0a0' },
    pen: null, hand: SANS, handScale: 1, handWeight: 400, handBold: 800, face: SANS, headFace: SANS, size: 1.18, chalk: false,
    card: { fill: 'rgba(198,244,50,0.08)', stroke: '#c6f432' },
    bad: { fill: 'rgba(255,107,107,0.12)', edge: '#ff6b6b' }, goodPanel: { fill: 'rgba(110,240,160,0.12)', edge: '#6ef0a0' },
  },
  lecture: {
    id: 'lecture', engine: 'slide', dark: false,
    ink: { main: '#1b2333', accent: '#2450a6', second: '#b5452b', third: '#0f766e', muted: '#687083', warn: '#b42318', good: '#157f3b' },
    pen: null, hand: SANS, handScale: 1, handWeight: 400, handBold: 700, face: SANS, headFace: SERIF, size: 1, chalk: false,
    card: { fill: '#ffffff', stroke: '#2450a6' },
    bad: { fill: 'rgba(180,35,24,0.06)', edge: '#b42318' }, goodPanel: { fill: 'rgba(21,127,59,0.07)', edge: '#157f3b' },
  },
  beginner: {
    id: 'beginner', engine: 'board', dark: false,
    ink: { main: '#2b2d42', accent: '#ff7a59', second: '#8e6cef', third: '#2a9df4', muted: '#8a8fa3', warn: '#e5484d', good: '#2f9e6b' },
    pen: 'marker', hand: KALAM, handScale: 1.16, handWeight: 400, handBold: 700, face: SANS, headFace: SANS, size: 1, chalk: false, math: 1.15,
    card: { fill: '#ffffff', stroke: '#ff7a59' },
    bad: { fill: 'rgba(229,72,77,0.08)', edge: '#e5484d' }, goodPanel: { fill: 'rgba(47,158,107,0.09)', edge: '#2f9e6b' },
  },
  proof: {
    id: 'proof', engine: 'slide', dark: false,
    ink: { main: '#1a1d24', accent: '#8a5a00', second: '#7a3b8f', third: '#245a8a', muted: '#6b6f7a', warn: '#a3261b', good: '#1f6b3a' },
    pen: null, hand: SERIF, handScale: 1, handWeight: 400, handBold: 700, face: SERIF, headFace: SERIF, size: 1, chalk: false,
    card: { fill: '#ffffff', stroke: '#8a5a00' },
    bad: { fill: 'rgba(163,38,27,0.05)', edge: '#a3261b' }, goodPanel: { fill: 'rgba(31,107,58,0.06)', edge: '#1f6b3a' },
  },
  story: {
    id: 'story', engine: 'board', dark: false,
    ink: { main: '#3b2a1e', accent: '#b5562b', second: '#7a4e9a', third: '#2f6f8f', muted: '#8c7a66', warn: '#b23a2a', good: '#2f7d4a' },
    pen: 'marker', hand: CAVEAT, handScale: 1.3, handWeight: 500, handBold: 700, face: SANS, headFace: SERIF, size: 1, chalk: false,
    card: { fill: '#fbf3e4', stroke: '#b5562b' },
    bad: { fill: 'rgba(178,58,42,0.08)', edge: '#b23a2a' }, goodPanel: { fill: 'rgba(47,125,74,0.08)', edge: '#2f7d4a' },
  },
};

const lookFor = (s: StyleId): RenderLook => LOOKS[s] ?? LOOKS.chalkboard;

// ---------------------------------------------------------------- geometry + easing

const VW = 1280;
const VH = 720;
/** Content stays above the caption band. */
const VIEW_TOP = 44;
const VIEW_BOTTOM = 596;
const OUT = 0.4;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
const backOut = (x: number) => {
  const v = clamp01(x);
  const c1 = 1.9;
  return 1 + (c1 + 1) * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- items

interface Sprite {
  c: HTMLCanvasElement;
  /** Logical content box (1280x720 units) and the padding baked around it. */
  w: number;
  h: number;
  pad: number;
  /** Vertical centre of the ink per 2-unit column, relative to the content top (for the pen tip). */
  ink: Float32Array;
}

interface Key {
  t: number;
  dur: number;
  dx?: number;
  dy?: number;
  s?: number;
  a?: number;
}

type Reveal = 'write' | 'draw' | 'fade' | 'rise' | 'pop' | 'grow';

interface ItemBase {
  group: number;
  from: number;
  until: number;
  t0: number;
  t1: number;
  reveal: Reveal;
  keys?: Key[];
  /** Ink colour for the pen tip while this is being written. */
  pen?: string;
}

type Item = ItemBase &
  (
    | { k: 'sprite'; s: Sprite; x: number; y: number; scale: number }
    | { k: 'path'; polys: number[][]; lens: number[]; total: number; color: string; width: number; clip?: [number, number, number, number]; glow?: number; head?: boolean; fill?: string }
    | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; lw?: number; shadow?: boolean }
    | { k: 'dot'; x: number; y: number; r: number; color: string; ring?: string }
    | { k: 'ring'; x: number; y: number; r: number; color: string; track: string; textColor: string; font: string; c0: number; c1: number }
  );

interface Group {
  keys: { t0: number; t1: number; a: number; b: number }[];
  target: number;
  lastT: number;
  clip?: [number, number, number, number];
}

export interface ScriptCanvasRenderer {
  canvas: HTMLCanvasElement;
  duration: number;
  timeline: ScriptTimeline;
  style: StyleId;
  draw(t: number): void;
  sceneAt(t: number): number;
}

export interface ScriptRenderOptions {
  width?: number;
  height?: number;
  style?: StyleId;
  /** Burn the narration line into the frame as a caption bar (exports). */
  captions?: boolean;
  reducedMotion?: boolean;
  canvas?: HTMLCanvasElement;
}

let handFonts: Promise<unknown> | null = null;
function loadHandFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  handFonts ??= Promise.race([
    Promise.all(['500 40px Caveat', '700 40px Caveat', '400 40px Kalam', '700 40px Kalam'].map((f) => document.fonts.load(f, 'Ax=1').catch(() => []))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  return handFonts;
}

// ---------------------------------------------------------------- textures

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

let grainCanvas: HTMLCanvasElement | null = null;
/** Speckled alpha used to knock holes in chalk strokes. */
function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = makeCanvas(192, 192);
  const g = c.getContext('2d')!;
  const r = rng(7);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.6})`;
    const s = 0.6 + r() * 1.5;
    g.fillRect(r() * 192, r() * 192, s, s * (0.5 + r()));
  }
  grainCanvas = c;
  return c;
}

function noise(g: CanvasRenderingContext2D, W: number, H: number, amount: number, seed: number) {
  try {
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const r = rng(seed);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amount;
      d[i] = d[i]! + n;
      d[i + 1] = d[i + 1]! + n;
      d[i + 2] = d[i + 2]! + n;
    }
    g.putImageData(img, 0, 0);
  } catch {
    /* tainted or unavailable: skip the texture */
  }
}

function background(look: RenderLook, W: number, H: number): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  const u = W / VW;
  const radial = (inner: string, outer: string, cx = 0.5, cy = 0.42) => {
    const gr = g.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, Math.hypot(W, H) * 0.62);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  const smudges = (count: number, alpha: number, seed: number) => {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = (80 + r() * 260) * u;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${alpha * (0.5 + r())})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.save();
      g.translate(x, y);
      g.scale(1.8 + r(), 0.6 + r() * 0.5);
      g.translate(-x, -y);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  };
  switch (look.id) {
    case 'chalkboard':
      radial('#2d4a3c', '#132019');
      smudges(16, 0.022, 3);
      noise(g, W, H, 15, 11);
      break;
    case 'socratic':
      radial('#2e3438', '#121517');
      smudges(16, 0.02, 5);
      noise(g, W, H, 14, 13);
      break;
    case 'marker':
      g.fillStyle = '#fbfbf9';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 5, 17);
      break;
    case 'exam':
      g.fillStyle = '#fffdf7';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 5, 19);
      break;
    case 'visual': {
      const lin = g.createLinearGradient(0, 0, 0, H);
      lin.addColorStop(0, '#11245a');
      lin.addColorStop(1, '#091431');
      g.fillStyle = lin;
      g.fillRect(0, 0, W, H);
      const gr = g.createRadialGradient(W * 0.2, H * 0.1, 0, W * 0.2, H * 0.1, W * 0.7);
      gr.addColorStop(0, 'rgba(70,120,255,0.22)');
      gr.addColorStop(1, 'rgba(70,120,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(160,190,255,0.08)';
      for (let x = 40; x < VW; x += 40) for (let y = 40; y < VH; y += 40) g.fillRect(x * u - u, y * u - u, 2 * u, 2 * u);
      break;
    }
    case 'quick': {
      const lin = g.createLinearGradient(0, 0, W, H);
      lin.addColorStop(0, '#1a1530');
      lin.addColorStop(1, '#0c0a14');
      g.fillStyle = lin;
      g.fillRect(0, 0, W, H);
      const gr = g.createRadialGradient(W * 0.95, H * 0.05, 0, W * 0.95, H * 0.05, W * 0.55);
      gr.addColorStop(0, 'rgba(198,244,50,0.14)');
      gr.addColorStop(1, 'rgba(198,244,50,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      break;
    }
    case 'lecture':
      g.fillStyle = '#f7f5f0';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 4, 23);
      break;
    case 'proof':
      g.fillStyle = '#fcfcfa';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 3, 29);
      break;
    case 'beginner':
      beginnerBackdrop(g, W, H, u);
      break;
    case 'story': {
      radial('#f8efdd', '#ead8b8', 0.5, 0.45);
      smudges(10, 0.05, 31);
      noise(g, W, H, 9, 37);
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      v.addColorStop(0, 'rgba(90,50,20,0)');
      v.addColorStop(1, 'rgba(90,50,20,0.22)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      break;
    }
  }
  if (look.dark && look.engine === 'board') {
    // Soft vignette, like a real board under classroom light.
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
  return c;
}

/** Soft cream page with pastel blobs and a few doodles at the edges (beginner). */
function beginnerBackdrop(g: CanvasRenderingContext2D, W: number, H: number, u: number) {
  g.fillStyle = '#fff8ee';
  g.fillRect(0, 0, W, H);
  const blob = (x: number, y: number, r: number, color: string) => {
    const gr = g.createRadialGradient(x * u, y * u, 0, x * u, y * u, r * u);
    gr.addColorStop(0, color);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect((x - r) * u, (y - r) * u, r * 2 * u, r * 2 * u);
  };
  blob(40, 30, 260, 'rgba(255,190,150,0.55)');
  blob(1250, 60, 240, 'rgba(160,210,255,0.5)');
  blob(1220, 700, 280, 'rgba(180,235,200,0.55)');
  blob(60, 700, 220, 'rgba(210,190,255,0.45)');
  g.save();
  g.scale(u, u);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const star = (cx: number, cy: number, r: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  star(1210, 120, 16, 'rgba(255,170,60,0.75)');
  star(1168, 84, 8, 'rgba(255,122,89,0.6)');
  star(58, 626, 12, 'rgba(142,108,239,0.55)');
  g.strokeStyle = 'rgba(42,157,244,0.45)';
  g.lineWidth = 5;
  g.beginPath();
  for (let x = 0; x <= 90; x += 3) g.lineTo(28 + x, 92 + Math.sin(x / 9) * 7);
  g.stroke();
  const dots: [number, number, string][] = [
    [1234, 560, 'rgba(47,158,107,0.5)'], [1196, 610, 'rgba(255,122,89,0.45)'], [92, 150, 'rgba(255,122,89,0.45)'], [36, 560, 'rgba(42,157,244,0.4)'],
  ];
  for (const [x, y, c] of dots) {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** A dusk landscape built from shapes: the story style's title and closing card. */
function storyVignette(W: number, H: number): HTMLCanvasElement {
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  const u = W / VW;
  g.scale(u, u);
  const sky = g.createLinearGradient(0, 0, 0, VH);
  sky.addColorStop(0, '#24163a');
  sky.addColorStop(0.45, '#7a2f4a');
  sky.addColorStop(0.72, '#e0703f');
  sky.addColorStop(0.9, '#f7b267');
  g.fillStyle = sky;
  g.fillRect(0, 0, VW, VH);
  const r = rng(41);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,240,220,${0.25 + r() * 0.6})`;
    const s = 0.8 + r() * 1.8;
    g.fillRect(r() * VW, r() * 260, s, s);
  }
  const sun = g.createRadialGradient(930, 470, 0, 930, 470, 260);
  sun.addColorStop(0, 'rgba(255,226,160,0.95)');
  sun.addColorStop(0.28, 'rgba(255,190,110,0.55)');
  sun.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = sun;
  g.fillRect(600, 200, 660, 520);
  g.fillStyle = '#ffe1a0';
  g.beginPath();
  g.arc(930, 470, 64, 0, Math.PI * 2);
  g.fill();
  const hill = (base: number, amp: number, f1: number, f2: number, ph: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, VH);
    for (let x = 0; x <= VW; x += 8) g.lineTo(x, base + Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 + ph * 2) * amp * 0.45);
    g.lineTo(VW, VH);
    g.closePath();
    g.fill();
  };
  hill(500, 26, 0.004, 0.011, 1.2, '#8a3b4a');
  hill(548, 30, 0.0052, 0.013, 2.4, '#5a2438');
  hill(606, 22, 0.0047, 0.017, 0.4, '#2c1424');
  // House with a lit window, and trees, on the front hill.
  const hx = 300;
  const hy = 590;
  g.fillStyle = '#1d0d18';
  g.fillRect(hx, hy - 54, 84, 60);
  g.beginPath();
  g.moveTo(hx - 12, hy - 52);
  g.lineTo(hx + 42, hy - 96);
  g.lineTo(hx + 96, hy - 52);
  g.closePath();
  g.fill();
  g.fillRect(hx + 58, hy - 92, 12, 26);
  g.fillStyle = '#ffd27a';
  g.fillRect(hx + 18, hy - 38, 18, 18);
  const glow = g.createRadialGradient(hx + 27, hy - 29, 0, hx + 27, hy - 29, 60);
  glow.addColorStop(0, 'rgba(255,210,122,0.35)');
  glow.addColorStop(1, 'rgba(255,210,122,0)');
  g.fillStyle = glow;
  g.fillRect(hx - 40, hy - 100, 140, 140);
  g.fillStyle = '#1d0d18';
  for (const [tx, ty, s] of [[190, 600, 1], [460, 596, 0.8], [1080, 598, 1.2], [1150, 606, 0.85]] as const) {
    g.fillRect(tx - 4 * s, ty - 40 * s, 8 * s, 44 * s);
    for (const [dx, dy, rr] of [[0, -62, 26], [-16, -46, 20], [16, -44, 20]] as const) {
      g.beginPath();
      g.arc(tx + dx * s, ty + dy * s, rr * s, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = 'rgba(30,12,24,0.8)';
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  for (const [bx, by, s] of [[760, 250, 1], [800, 230, 0.8], [720, 280, 0.7]] as const) {
    g.beginPath();
    g.moveTo(bx - 14 * s, by - 6 * s);
    g.quadraticCurveTo(bx - 6 * s, by - 9 * s, bx, by);
    g.quadraticCurveTo(bx + 6 * s, by - 9 * s, bx + 14 * s, by - 6 * s);
    g.stroke();
  }
  // Letterbox bars for a cinematic frame.
  g.fillStyle = '#0d0710';
  g.fillRect(0, 0, VW, 34);
  g.fillRect(0, VH - 34, VW, 34);
  g.setTransform(1, 0, 0, 1, 0, 0);
  noise(g, W, H, 10, 43);
  return c;
}

// ---------------------------------------------------------------- the renderer

export async function createScriptCanvasRenderer(script: LessonScript, opts: ScriptRenderOptions = {}): Promise<ScriptCanvasRenderer> {
  const W = Math.round(opts.width ?? 1280);
  const H = Math.round(opts.height ?? 720);
  const u = Math.min(W / VW, H / VH);
  const ox = (W - VW * u) / 2;
  const oy = (H - VH * u) / 2;
  const style: StyleId = opts.style ?? script.style;
  const tl = buildScriptTimeline(script, style);
  const look = lookFor(tl.style);
  const reduced = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const burnCaptions = !!opts.captions;

  const canvas = opts.canvas ?? document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available.');

  await loadHandFonts();
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const bg = background(look, W, H);
  const measure = makeCanvas(4, 4).getContext('2d')!;
  const items: Item[] = [];
  const groups: Group[] = [];
  let seed = 101;

  const newGroup = (clip?: Group['clip']): number => {
    groups.push({ keys: [], target: 0, lastT: -Infinity, ...(clip ? { clip } : {}) });
    return groups.length - 1;
  };

  // ---------- sprites

  function finishSprite(c: HTMLCanvasElement, w: number, h: number, pad: number, chalk: boolean): Sprite {
    const g = c.getContext('2d')!;
    if (chalk) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = 0.55;
      const pat = g.createPattern(grain(), 'repeat');
      if (pat) {
        g.fillStyle = pat;
        g.fillRect(0, 0, c.width, c.height);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    const cols = Math.max(1, Math.ceil(w / 2));
    const ink = new Float32Array(cols).fill(NaN);
    try {
      const data = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < cols; i++) {
        const cx = Math.min(c.width - 1, Math.floor((pad + i * 2 + 1) * u));
        let sum = 0;
        let n = 0;
        for (let y = 0; y < c.height; y += 2) {
          const a = data[(y * c.width + cx) * 4 + 3]!;
          if (a > 40) {
            sum += y;
            n++;
          }
        }
        if (n) ink[i] = sum / n / u - pad;
      }
    } catch {
      /* no profile: the pen rides the middle of the line */
    }
    let last = h * 0.55;
    for (let i = 0; i < cols; i++) {
      if (Number.isNaN(ink[i]!)) ink[i] = last;
      else last = ink[i]!;
    }
    return { c, w, h, pad, ink };
  }

  function textSprite(text: string, family: string, weight: number, px: number, color: string, chalk = look.chalk, italic = false): Sprite {
    const font = `${italic ? 'italic ' : ''}${weight} ${px}px ${family}`;
    measure.font = font;
    const w = Math.max(1, measure.measureText(text).width);
    const h = px * 1.28;
    const pad = px * 0.35;
    const c = makeCanvas((w + pad * 2) * u, (h + pad * 2) * u);
    const g = c.getContext('2d')!;
    g.scale(u, u);
    g.translate(pad, pad);
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    if (chalk) {
      g.shadowColor = withAlpha(color, 0.55);
      g.shadowBlur = 2.2 * u;
    }
    g.fillText(text, 0, h * 0.54);
    return finishSprite(c, w, h, pad, chalk);
  }

  async function mathSprite(tex: string, px: number, color: string, chalk = look.chalk): Promise<Sprite> {
    const m = await renderMathImage(tex, px * u, color);
    if (!m.img) return textSprite(m.plain, look.face, 400, px * 0.85, color, chalk);
    const w = m.w / u;
    const h = m.h / u;
    const pad = m.pad / u;
    const c = makeCanvas((w + pad * 2) * u, (h + pad * 2) * u);
    const g = c.getContext('2d')!;
    if (chalk) {
      g.shadowColor = withAlpha(color, 0.5);
      g.shadowBlur = 2 * u;
    }
    g.drawImage(m.img, 0, 0, c.width, c.height);
    return finishSprite(c, w, h, pad, chalk);
  }

  function wrap(text: string, family: string, weight: number, px: number, maxW: number, italic = false): string[] {
    measure.font = `${italic ? 'italic ' : ''}${weight} ${px}px ${family}`;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure.measureText(next).width > maxW) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  function textLines(text: string, family: string, weight: number, px: number, color: string, maxW: number, italic = false): Sprite[] {
    return wrap(text, family, weight, px, maxW, italic).map((l) => textSprite(l, family, weight, px, color, look.chalk, italic));
  }

  // ---------- item helpers

  type Win = [number, number];
  const base = (group: number, win: Win, until: number, reveal: Reveal, from = win[0]): ItemBase => ({ group, from, until, t0: win[0], t1: win[1], reveal });

  function addSprite(s: Sprite, x: number, y: number, group: number, win: Win, until: number, reveal: Reveal, scale = 1, pen?: string): Item {
    const it: Item = { ...base(group, win, until, reveal), k: 'sprite', s, x, y, scale, ...(pen ? { pen } : {}) };
    items.push(it);
    return it;
  }

  /** Writes lines one after another inside `win`, each taking time in proportion to its width. */
  function writeLines(lines: Sprite[], x: number | ((s: Sprite, scale: number) => number), y: number, gap: number, group: number, win: Win, until: number, reveal: Reveal, pen?: string, maxW = Infinity): number {
    const scales = lines.map((s) => Math.min(1, maxW / s.w));
    const total = lines.reduce((a, s, i) => a + s.w * scales[i]!, 0) || 1;
    let t = win[0];
    lines.forEach((s, i) => {
      const sc = scales[i]!;
      const d = ((win[1] - win[0]) * s.w * sc) / total;
      const xx = typeof x === 'number' ? x : x(s, sc);
      addSprite(s, xx, y, group, [t, t + d], until, reveal, sc, pen);
      t += d;
      y += s.h * sc + gap;
    });
    return y - gap;
  }

  function measurePath(polys: number[][]): { lens: number[]; total: number } {
    const lens = polys.map((p) => {
      let L = 0;
      for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
      return L;
    });
    return { lens, total: lens.reduce((a, b) => a + b, 0) || 1 };
  }

  function addPath(polys: number[][], color: string, width: number, group: number, win: Win, until: number, extra: Partial<Extract<Item, { k: 'path' }>> = {}, reveal: Reveal = 'draw'): Item {
    const m = measurePath(polys);
    const it: Item = { ...base(group, win, until, reveal), k: 'path', polys, ...m, color, width, ...extra };
    items.push(it);
    return it;
  }

  /** Hand wobble: resample a polyline and push it sideways with smooth noise. */
  function rough(pts: number[], amp: number, step = 12): number[] {
    const r = rng(seed++);
    const p1 = r() * 6.28;
    const p2 = r() * 6.28;
    const out: number[] = [];
    let s = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i]!;
      const y0 = pts[i + 1]!;
      const x1 = pts[i + 2]!;
      const y1 = pts[i + 3]!;
      const L = Math.hypot(x1 - x0, y1 - y0) || 1;
      const n = Math.max(1, Math.ceil(L / step));
      const nx = -(y1 - y0) / L;
      const ny = (x1 - x0) / L;
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const off = amp * (Math.sin(s * 0.021 + p1) * 0.65 + Math.sin(s * 0.057 + p2) * 0.35);
        out.push(x0 + (x1 - x0) * f + nx * off, y0 + (y1 - y0) * f + ny * off);
        s += L / n;
      }
    }
    out.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    return out;
  }

  const handBox = (x: number, y: number, w: number, h: number): number[] => {
    const o = 7;
    return rough([x - o, y + 2, x + w + 3, y - 3, x + w + 2, y + h + 2, x - 2, y + h + 4, x - 4, y - 6, x + 18, y - 4], 1.6);
  };

  // ---------- scroll

  /** Scrolls `group` (if needed) so [top, bottom] is in view by time t; `fresh` starts a clean page. */
  function ensureVisible(gi: number, top: number, bottom: number, t: number, view: [number, number], fresh = false) {
    const g = groups[gi]!;
    let need = g.target;
    if (fresh) need = Math.max(need, top - view[0]);
    else if (bottom - g.target > view[1]) need = Math.min(bottom - view[1] + 90, top - view[0]);
    if (need <= g.target + 0.5) return;
    const t0 = Math.max(g.lastT, t - 0.1);
    const t1 = t0 + (fresh ? 0.8 : 0.65);
    g.keys.push({ t0, t1, a: g.target, b: need });
    g.target = need;
    g.lastT = t1;
  }

  function scrollAt(g: Group, t: number): number {
    let v = 0;
    for (const k of g.keys) {
      if (t <= k.t0) break;
      v = reduced ? k.b : k.a + (k.b - k.a) * easeInOut((t - k.t0) / Math.max(0.01, k.t1 - k.t0));
    }
    return v;
  }

  const beat = (st: ScriptSceneTiming, key: string): Win => st.beats[key] ?? [st.start + 0.35, st.start + 0.8];
  const inkOf = (i: Ink | undefined, fallback: Ink = 'main') => look.ink[i ?? fallback] ?? look.ink.main;

  // ---------- graph (both engines)

  interface GraphGeom {
    x: number;
    y: number;
    w: number;
    h: number;
    xr: [number, number];
    yr: [number, number];
    sx: (v: number) => number;
    sy: (v: number) => number;
    curves: { polys: number[][]; label: string; end: [number, number] | null }[];
  }

  function graphGeom(scene: Extract<Scene, { kind: 'graph' }>, x: number, y: number, w: number, h: number): GraphGeom {
    const xr: [number, number] = scene.xRange && scene.xRange[1] > scene.xRange[0] ? scene.xRange : [-5, 5];
    const session = createSession();
    const fns: { f: (env: Record<string, number>) => number; label: string }[] = [];
    for (const e of scene.exprs) {
      try {
        const spec = parseGraph(e, session);
        for (const it of spec.items) if (it.kind === 'explicit') fns.push({ f: it.f, label: e });
      } catch {
        /* skip expressions the graph engine can't read */
      }
    }
    let yr: [number, number];
    if (scene.yRange && scene.yRange[1] > scene.yRange[0]) yr = scene.yRange;
    else {
      const ys: number[] = [];
      for (const { f } of fns)
        for (let i = 0; i <= 160; i++) {
          const v = f({ x: xr[0] + ((xr[1] - xr[0]) * i) / 160 });
          if (Number.isFinite(v)) ys.push(v);
        }
      for (const m of scene.mark ?? []) ys.push(m.y);
      ys.sort((a, b) => a - b);
      let lo = ys.length ? ys[Math.floor(ys.length * 0.03)]! : -5;
      let hi = ys.length ? ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.97))]! : 5;
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
      if (hi - lo < 1e-6) {
        lo -= 1;
        hi += 1;
      }
      const padY = (hi - lo) * 0.12;
      yr = [lo - padY, hi + padY];
    }
    const sx = (v: number) => x + ((v - xr[0]) / (xr[1] - xr[0])) * w;
    const sy = (v: number) => y + h - ((v - yr[0]) / (yr[1] - yr[0])) * h;
    const vp = { xMin: xr[0], xMax: xr[1], yMin: yr[0], yMax: yr[1] };
    const curves = fns.map(({ f, label }) => {
      let lines: Polyline[] = [];
      try {
        lines = sampleExplicit(f, {}, vp, w);
      } catch {
        lines = [];
      }
      // Split where the curve leaves the box so the trace never streaks across the frame.
      const polys: number[][] = [];
      let end: [number, number] | null = null;
      const yPad = (yr[1] - yr[0]) * 0.02;
      for (const pl of lines) {
        let cur: number[] = [];
        for (let i = 0; i < pl.length; i += 2) {
          const wx = pl[i]!;
          const wy = pl[i + 1]!;
          if (!Number.isFinite(wy) || wy < yr[0] - yPad || wy > yr[1] + yPad) {
            if (cur.length >= 4) polys.push(cur);
            cur = [];
            continue;
          }
          cur.push(sx(wx), sy(wy));
          end = [sx(wx), sy(wy)];
        }
        if (cur.length >= 4) polys.push(cur);
      }
      return { polys, label, end };
    });
    return { x, y, w, h, xr, yr, sx, sy, curves };
  }

  const exprTex = (e: string): string => {
    let s = e.trim().replace(/^y\s*=\s*/i, '');
    s = s.replace(/\*/g, '\\cdot ').replace(/\b(sin|cos|tan|ln|log|exp)\b/g, '\\$1').replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}');
    return `y = ${s}`;
  };

  const fmtTick = (v: number) => {
    const r = Math.round(v * 1000) / 1000;
    return r < 0 ? `−${Math.abs(r)}` : String(r);
  };

  async function drawGraph(scene: Extract<Scene, { kind: 'graph' }>, st: ScriptSceneTiming, gi: number, x: number, y: number, w: number, h: number, until: number, board: boolean): Promise<number> {
    const G = graphGeom(scene, x, y, w, h);
    const axesWin = beat(st, 'axes');
    const axisColor = board ? withAlpha(look.ink.main, 0.85) : withAlpha(look.ink.main, 0.75);
    const ax = Math.min(G.x + G.w, Math.max(G.x, G.sx(0)));
    const ay = Math.min(G.y + G.h, Math.max(G.y, G.sy(0)));
    // Grid (slide engine only) and ticks.
    const step = niceStep(G.xr[1] - G.xr[0], 8);
    const ystep = niceStep(G.yr[1] - G.yr[0], 6);
    const ticks: number[][] = [];
    const labels: { s: Sprite; x: number; y: number }[] = [];
    const tickPx = board ? 18 * look.handScale : 15;
    const tickFamily = board ? look.hand : look.face;
    const tickColor = look.ink.muted;
    const grid: number[][] = [];
    for (let v = Math.ceil(G.xr[0] / step) * step; v <= G.xr[1] + 1e-9; v += step) {
      const px = G.sx(v);
      if (Math.abs(v) < 1e-9 || px < G.x + 8 || px > G.x + G.w - 8) continue;
      ticks.push([px, ay - 5, px, ay + 5]);
      grid.push([px, G.y, px, G.y + G.h]);
      const s = textSprite(fmtTick(v), tickFamily, board ? look.handWeight : 500, tickPx, tickColor);
      labels.push({ s, x: px - s.w / 2, y: Math.min(G.y + G.h - s.h, ay + 7) });
    }
    for (let v = Math.ceil(G.yr[0] / ystep) * ystep; v <= G.yr[1] + 1e-9; v += ystep) {
      const py = G.sy(v);
      if (Math.abs(v) < 1e-9 || py < G.y + 8 || py > G.y + G.h - 8) continue;
      ticks.push([ax - 5, py, ax + 5, py]);
      grid.push([G.x, py, G.x + G.w, py]);
      const s = textSprite(fmtTick(v), tickFamily, board ? look.handWeight : 500, tickPx, tickColor);
      labels.push({ s, x: Math.max(G.x, ax - 10 - s.w), y: py - s.h / 2 });
    }
    if (!board && grid.length) addPath(grid, withAlpha(look.ink.main, look.dark ? 0.07 : 0.08), 1, gi, axesWin, until, {}, 'fade');
    const xAxis = [G.x, ay, G.x + G.w, ay];
    const yAxis = [ax, G.y + G.h, ax, G.y];
    const arrow = (x0: number, y0: number, dx: number, dy: number) => [x0 - dx * 10 - dy * 6, y0 - dy * 10 + dx * 6, x0, y0, x0 - dx * 10 + dy * 6, y0 - dy * 10 - dx * 6];
    const half: Win = [axesWin[0], axesWin[0] + (axesWin[1] - axesWin[0]) * 0.75];
    const pen = board ? look.ink.main : undefined;
    addPath(board ? [rough(xAxis, 1.2), arrow(G.x + G.w, ay, 1, 0)] : [xAxis, arrow(G.x + G.w, ay, 1, 0)], axisColor, board ? 3 : 2, gi, [half[0], (half[0] + half[1]) / 2], until, pen ? { } : {}).pen = pen;
    addPath(board ? [rough(yAxis, 1.2), arrow(ax, G.y, 0, -1)] : [yAxis, arrow(ax, G.y, 0, -1)], axisColor, board ? 3 : 2, gi, [(half[0] + half[1]) / 2, half[1]], until).pen = pen;
    if (ticks.length) addPath(ticks, axisColor, board ? 2.5 : 1.5, gi, [half[1], axesWin[1]], until, {}, 'fade');
    for (const l of labels) addSprite(l.s, l.x, l.y, gi, [half[1], axesWin[1]], until, 'fade');

    const curveInks: Ink[] = ['accent', 'third', 'second', 'good'];
    // Keep labels clear of each other and of the marks.
    const placed: [number, number, number, number][] = (scene.mark ?? []).map((m) => [G.sx(m.x) - 14, G.sy(m.y) - 44, 190, 58]);
    const curvePts: [number, number][] = [];
    for (const cv of G.curves) for (const pl of cv.polys) for (let q = 0; q < pl.length; q += 6) curvePts.push([pl[q]!, pl[q + 1]!]);
    for (let i = 0; i < G.curves.length; i++) {
      const cv = G.curves[i]!;
      const win = beat(st, `curve${i}`);
      const color = look.ink[curveInks[i % curveInks.length]!];
      const traceEnd = win[0] + (win[1] - win[0]) * 0.78;
      if (cv.polys.length) {
        const p = addPath(board ? cv.polys.map((pl) => rough(pl, 0.8, 16)) : cv.polys, color, board ? 3.6 : 4, gi, [win[0], traceEnd], until, {
          clip: [G.x - 2, G.y - 2, G.w + 4, G.h + 4],
          ...(board ? {} : { glow: 10, head: true }),
        });
        if (board) p.pen = color;
      }
      if (cv.end) {
        const lab = board ? await mathSprite(exprTex(cv.label), 26, color) : await mathSprite(exprTex(cv.label), 22, color);
        // Label the curve where it doesn't collide with another label: try points along the curve, and
        // either side of each.
        const pts: [number, number][] = [];
        for (const pl of cv.polys) for (let q = 0; q < pl.length; q += 2) pts.push([pl[q]!, pl[q + 1]!]);
        let spot: [number, number] | null = null;
        const fits = (x: number, y: number) =>
          x >= G.x &&
          y >= G.y &&
          x + lab.w <= G.x + G.w &&
          y + lab.h <= G.y + G.h &&
          !placed.some((r) => x < r[0] + r[2] && x + lab.w > r[0] && y < r[1] + r[3] && y + lab.h > r[1]) &&
          !curvePts.some(([px, py]) => px > x - 4 && px < x + lab.w + 4 && py > y - 4 && py < y + lab.h + 4);
        for (const f of [0.9, 0.8, 0.7, 0.6, 0.45, 0.3, 0.15]) {
          const pt = pts[Math.min(pts.length - 1, Math.floor(pts.length * f))];
          if (!pt) continue;
          for (const [dx, dy] of [[12, 4], [-lab.w - 12, -lab.h - 4], [12, -lab.h - 6], [-lab.w - 12, 6]] as const) {
            if (fits(pt[0] + dx, pt[1] + dy)) {
              spot = [pt[0] + dx, pt[1] + dy];
              break;
            }
          }
          if (spot) break;
        }
        spot ??= [Math.min(G.x + G.w - lab.w, cv.end[0] - lab.w - 6), Math.max(G.y, Math.min(G.y + G.h - lab.h, cv.end[1] + 8))];
        placed.push([spot[0] - 4, spot[1] - 4, lab.w + 8, lab.h + 8]);
        addSprite(lab, spot[0], spot[1], gi, [traceEnd, win[1]], until, board ? 'write' : 'fade', 1, board ? color : undefined);
      }
    }
    for (const [i, m] of (scene.mark ?? []).entries()) {
      const win = beat(st, `mark${i}`);
      const mx = G.sx(m.x);
      const my = G.sy(m.y);
      if (mx < G.x - 1 || mx > G.x + G.w + 1 || my < G.y - 1 || my > G.y + G.h + 1) continue;
      items.push({ ...base(gi, [win[0], win[0] + 0.35], until, 'pop'), k: 'dot', x: mx, y: my, r: board ? 6.5 : 7, color: look.ink.second, ...(board ? {} : { ring: withAlpha(look.ink.second, 0.35) }) });
      if (m.label) {
        if (board) {
          const s = textSprite(m.label, look.hand, look.handWeight, 24 * look.handScale, look.ink.second);
          const lx = Math.min(G.x + G.w - s.w, mx + 12);
          addSprite(s, lx, my - s.h - 6, gi, [win[0] + 0.1, win[1]], until, 'write', 1, look.ink.second);
        } else {
          const s = textSprite(m.label, look.face, 600, 17 * look.size, look.dark ? '#0b1430' : '#ffffff', false);
          const bw = s.w + 18;
          const bh = s.h + 6;
          const bx = Math.min(G.x + G.w - bw, mx + 12);
          const by = my - bh - 10;
          items.push({ ...base(gi, [win[0] + 0.08, win[1]], until, 'pop'), k: 'rect', x: bx, y: by, w: bw, h: bh, r: bh / 2, fill: look.ink.second });
          addSprite(s, bx + 9, by + 3, gi, [win[0] + 0.08, win[1]], until, 'pop');
        }
      }
    }
    let bottom = G.y + G.h;
    if (scene.caption) {
      const cw = beat(st, 'caption');
      const lines = board
        ? textLines(scene.caption, look.hand, look.handWeight, 28 * look.handScale, look.ink.muted, G.w + 200)
        : textLines(scene.caption, look.face, 400, 22 * look.size, look.ink.muted, 900);
      const y0 = bottom + 14;
      bottom = writeLines(lines, board ? G.x : (s) => VW / 2 - s.w / 2, y0, 2, gi, cw, until, board ? 'write' : 'rise', board ? look.ink.muted : undefined);
    }
    return bottom;
  }

  // ---------- pause card (both engines)

  function pauseCard(st: ScriptSceneTiming, scene: Extract<Scene, { kind: 'pause' }>, gi: number, until: number, overlay: boolean) {
    const big = look.id === 'socratic' || look.engine === 'slide';
    const cw = big ? 820 : 640;
    const board = look.engine === 'board';
    const card = beat(st, 'card');
    const promptWin = beat(st, 'prompt');
    const cd = st.countdown ?? [st.end - 5, st.end];
    if (overlay) items.push({ ...base(gi, [card[0], card[0] + 0.4], until, 'fade'), k: 'rect', x: -10, y: -10, w: VW + 20, h: VH + 20, r: 0, fill: look.dark ? 'rgba(0,0,0,0.55)' : 'rgba(250,250,247,0.78)' });
    const head = ['socratic', 'quick', 'visual', 'beginner'].includes(look.id) ? 'Your turn' : 'Pause and try';
    const headS = board
      ? textSprite(head, look.hand, look.handBold, (big ? 66 : 48) * look.handScale, look.ink.accent)
      : textSprite(head, look.headFace, 700, 54 * look.size, look.ink.accent, false);
    const textW = cw - 220;
    const lines = board
      ? textLines(scene.prompt, look.hand, look.handWeight, 30 * look.handScale, look.ink.main, textW)
      : textLines(scene.prompt, look.face, 400, 28 * look.size, look.ink.main, textW);
    const textH = lines.reduce((a, s) => a + s.h + 2, 0);
    const ch = Math.max(big ? 300 : 230, headS.h + textH + 110);
    const cx = (VW - cw) / 2;
    const cy = Math.max(60, (VIEW_BOTTOM + VIEW_TOP - ch) / 2);
    if (board) {
      items.push({ ...base(gi, card, until, 'fade'), k: 'rect', x: cx, y: cy, w: cw, h: ch, r: 18, fill: look.card.fill, shadow: !look.dark });
      addPath([handBox(cx + 10, cy + 10, cw - 20, ch - 20)], look.card.stroke, look.chalk ? 3.2 : 3, gi, card, until).pen = look.card.stroke;
    } else {
      items.push({ ...base(gi, card, until, 'pop'), k: 'rect', x: cx, y: cy, w: cw, h: ch, r: 24, fill: look.dark ? 'rgba(255,255,255,0.07)' : '#ffffff', stroke: withAlpha(look.ink.accent, 0.6), lw: 2, shadow: !look.dark });
    }
    const tx = cx + 48;
    const contentTop = cy + Math.max(36, (ch - (headS.h + 8 + textH)) / 2);
    addSprite(headS, tx, contentTop, gi, [card[0] + 0.1, card[1] + 0.3], until, board ? 'write' : 'rise', 1, board ? look.ink.accent : undefined);
    writeLines(lines, tx, contentTop + 8 + headS.h, 2, gi, promptWin, until, board ? 'write' : 'rise', board ? look.ink.main : undefined);
    const r = big ? 62 : 52;
    items.push({
      ...base(gi, card, until, 'fade'),
      k: 'ring',
      x: cx + cw - 56 - r,
      y: cy + ch / 2,
      r,
      color: look.ink.accent,
      track: withAlpha(look.ink.main, look.dark ? 0.16 : 0.12),
      textColor: look.ink.main,
      font: board ? `${look.handBold} ${44 * look.handScale}px ${look.hand}` : `700 40px ${look.face}`,
      c0: cd[0],
      c1: cd[1],
    });
  }

  // ======================================================== BOARD ENGINE

  async function layoutBoard() {
    const gi = newGroup();
    const L = 100;
    const R = 1180;
    const hasWhy = script.scenes.some((s) => s.kind === 'step' && !!s.why);
    const mainR = hasWhy ? 850 : R;
    const noteL = 884;
    const hs = look.handScale;
    const HW = look.handWeight;
    const HB = look.handBold;
    const hand = (text: string, px: number, color: string, maxW: number, weight = HW) => textLines(text, look.hand, weight, px * hs, color, maxW);
    const noteFont = CAVEAT;
    const INF = Infinity;
    let y = 58;
    let wrote = false;
    /** Something besides the title is on the board (a new example then starts on a clean part). */
    let work = false;
    const GAP = 26;
    const view: [number, number] = [VIEW_TOP, VIEW_BOTTOM];

    const pen = (c: string) => (look.pen ? c : undefined);
    const M = look.math ?? 1;
    const bmath = (tex: string, px: number, color: string) => mathSprite(tex, px * M, color);
    const onePerPage = look.id === 'beginner';
    const story = look.id === 'story';
    const vign = story ? storyVignette(W, H) : null;
    const vSprite = (): Sprite => ({ c: vign!, w: VW, h: VH, pad: 0, ink: new Float32Array(1) });
    let lastAnswer = -1;
    tl.scenes.forEach((s, i) => s.scene.kind === 'answer' && (lastAnswer = i));

    /** Story: the opening title card and the closing card that answers the story's question. */
    async function storyCard(st: ScriptSceneTiming, closing: boolean) {
      const sc = st.scene;
      const until = st.end;
      const it = addSprite(vSprite(), 0, 0, -1, closing ? [st.start, st.start + 0.9] : [st.start - 1, st.start], until, 'fade');
      it.from = it.t0;
      it.keys = [{ t: st.start, dur: Math.max(1, st.end - st.start), s: 1.06, dx: -38, dy: -22 }];
      const cream = '#fff3e2';
      const gold = '#ffd58a';
      if (!closing && sc.kind === 'title') {
        const lines = textLines(sc.title, SERIF, 700, 62, cream, 1000);
        const sub = sc.subtitle ? textLines(sc.subtitle, SERIF, 400, 27, '#ffe2c4', 900, true) : [];
        let yy = writeLines(lines, (s) => VW / 2 - s.w / 2, 120, 0, -1, beat(st, 'title'), until, 'rise');
        items.push({ ...base(-1, beat(st, 'rule'), until, 'grow'), k: 'rect', x: VW / 2 - 60, y: yy + 16, w: 120, h: 3, r: 1.5, fill: gold });
        yy += 34;
        if (sub.length) writeLines(sub, (s) => VW / 2 - s.w / 2, yy, 0, -1, beat(st, 'subtitle'), until, 'rise');
        return;
      }
      if (sc.kind !== 'answer') return;
      items.push({ ...base(-1, [st.start, st.start + 0.9], until, 'fade'), k: 'rect', x: 0, y: 0, w: VW, h: VH, r: 0, fill: 'rgba(16,8,18,0.5)' });
      let question = '';
      for (let i = st.index - 1; i >= 0; i--) {
        const q = tl.scenes[i]!.scene;
        if (q.kind === 'problem') {
          question = q.text;
          break;
        }
      }
      const label = textSprite('AND SO', SANS, 700, 16, gold, false);
      const qLines = question ? textLines(question, SERIF, 400, 26, '#f6e6d2', 900, true).slice(0, 3) : [];
      const ans = sc.tex ? await mathSprite(sc.tex, 60, '#ffffff', false) : textSprite(sc.display, SERIF, 700, 56, '#ffffff', false);
      const k = Math.min(1, 1000 / ans.w);
      const hgt = label.h + 16 + qLines.reduce((a, s) => a + s.h, 0) + 30 + ans.h * k + 30;
      let yy = Math.max(70, (VH - hgt) / 2 - 40);
      addSprite(label, VW / 2 - label.w / 2, yy, -1, [st.start + 0.4, st.start + 0.9], until, 'fade');
      yy = writeLines(qLines, (s) => VW / 2 - s.w / 2, yy + label.h + 16, 0, -1, [st.start + 0.5, st.start + 1.2], until, 'rise');
      const aw = beat(st, 'answer');
      addSprite(ans, VW / 2 - (ans.w * k) / 2, yy + 30, -1, [Math.max(aw[0], st.start + 1), Math.max(aw[0], st.start + 1) + 0.8], until, 'rise', k);
      items.push({ ...base(-1, beat(st, 'box'), until, 'grow'), k: 'rect', x: VW / 2 - (ans.w * k) / 2, y: yy + 30 + ans.h * k + 18, w: ans.w * k, h: 3, r: 1.5, fill: gold });
    }

    for (const st of tl.scenes) {
      const sc = st.scene;
      if (story && (sc.kind === 'title' || st.index === lastAnswer)) {
        await storyCard(st, sc.kind !== 'title');
        continue;
      }
      const g0 = groups[gi]!;
      const saved = { n: g0.keys.length, target: g0.target, lastT: g0.lastT };
      if (onePerPage && wrote && sc.kind !== 'pause') y += VIEW_BOTTOM;
      const blockTop = y;
      const firstItem = items.length;
      switch (sc.kind) {
        case 'title': {
          const lines = hand(sc.title, 54, look.ink.main, R - L - 80, HB);
          const sub = sc.subtitle ? hand(sc.subtitle, 28, look.ink.muted, R - L - 120) : [];
          const hgt = lines.reduce((a, s) => a + s.h, 0) + 24 + sub.reduce((a, s) => a + s.h, 0);
          ensureVisible(gi, blockTop, blockTop + hgt, st.start, view, wrote);
          let yy = writeLines(lines, (s) => VW / 2 - s.w / 2, y + 6, 0, gi, beat(st, 'title'), INF, 'write', pen(look.ink.main));
          const wmax = Math.max(...lines.map((s) => s.w));
          addPath([rough([VW / 2 - wmax / 2 - 10, yy + 6, VW / 2 + wmax / 2 + 14, yy + 2], 2)], look.ink.accent, look.chalk ? 4 : 3.5, gi, beat(st, 'rule'), INF).pen = pen(look.ink.accent);
          yy += 22;
          if (sub.length) yy = writeLines(sub, (s) => VW / 2 - s.w / 2, yy, 0, gi, beat(st, 'subtitle'), INF, 'write', pen(look.ink.muted));
          y = yy + GAP + 10;
          break;
        }
        case 'concept': {
          const head = hand(sc.heading, 36, look.ink.accent, R - L, HB);
          const body = hand(sc.body, 30, look.ink.main, R - L);
          const tex = sc.tex ? await bmath(sc.tex, 42, look.ink.main) : null;
          const hgt = head.reduce((a, s) => a + s.h, 0) + 10 + body.reduce((a, s) => a + s.h, 0) + (tex ? tex.h + 16 : 0);
          ensureVisible(gi, blockTop, blockTop + hgt, st.start, view, work);
          let yy = writeLines(head, L, y, 0, gi, beat(st, 'heading'), INF, 'write', pen(look.ink.accent));
          yy += 10;
          yy = writeLines(body, L, yy, 0, gi, beat(st, 'body'), INF, 'write', pen(look.ink.main));
          if (tex) {
            const sc2 = Math.min(1, (R - L - 40) / tex.w);
            addSprite(tex, L + 30, yy + 16, gi, beat(st, 'tex'), INF, 'write', sc2, pen(look.ink.main));
            yy += 16 + tex.h * sc2;
          }
          y = yy + GAP;
          break;
        }
        case 'rule': {
          const head = hand(sc.heading, 30, look.ink.accent, R - L, HB);
          const tex = await bmath(sc.tex, 50, look.ink.main);
          const note = sc.note ? hand(sc.note, 26, look.ink.muted, R - L - 60) : [];
          const k = Math.min(1, (R - L - 120) / tex.w);
          const hgt = head.reduce((a, s) => a + s.h, 0) + 30 + tex.h * k + 30 + note.reduce((a, s) => a + s.h, 0);
          ensureVisible(gi, blockTop, blockTop + hgt, st.start, view, work);
          let yy = writeLines(head, L, y, 0, gi, beat(st, 'heading'), INF, 'write', pen(look.ink.accent));
          yy += 26;
          const tx = Math.max(L + 30, VW / 2 - (tex.w * k) / 2);
          addSprite(tex, tx, yy, gi, beat(st, 'tex'), INF, 'write', k, pen(look.ink.main));
          addPath([handBox(tx - 26, yy - 16, tex.w * k + 52, tex.h * k + 32)], look.ink.accent, look.chalk ? 3.4 : 3, gi, beat(st, 'box'), INF).pen = pen(look.ink.accent);
          yy += tex.h * k + 30;
          if (note.length) yy = writeLines(note, (s) => VW / 2 - s.w / 2, yy, 0, gi, beat(st, 'note'), INF, 'write', pen(look.ink.muted));
          y = yy + GAP;
          break;
        }
        case 'problem': {
          const label = hand(sc.label ?? 'Example', 26, look.ink.accent, 400, HB);
          const text = sc.text ? hand(sc.text, 32, look.ink.main, R - L) : [];
          const tex = sc.tex ? await bmath(sc.tex, 46, look.ink.main) : null;
          const hgt = label[0]!.h + 6 + text.reduce((a, s) => a + s.h, 0) + (tex ? tex.h + 14 : 0);
          // A new example starts on a clean part of the board.
          if (work) y += 40;
          ensureVisible(gi, y, y + hgt, st.start, view, work);
          let yy = writeLines(label, L, y, 0, gi, beat(st, 'label'), INF, 'write', pen(look.ink.accent));
          addPath([rough([L - 4, yy + 2, L + label[0]!.w + 8, yy], 1.2)], look.ink.accent, 2.6, gi, [beat(st, 'label')[1] - 0.15, beat(st, 'label')[1]], INF).pen = pen(look.ink.accent);
          yy += 8;
          if (text.length) yy = writeLines(text, L, yy, 0, gi, beat(st, 'text'), INF, 'write', pen(look.ink.main));
          if (tex) {
            const k = Math.min(1, (R - L - 40) / tex.w);
            addSprite(tex, L + 24, yy + 12, gi, beat(st, 'tex'), INF, 'write', k, pen(look.ink.main));
            yy += 12 + tex.h * k;
          }
          y = yy + GAP + 6;
          break;
        }
        case 'step': {
          const color = inkOf(sc.ink);
          const hasTex = !!sc.tex;
          const colW = mainR - L - 20;
          const text = sc.text ? hand(sc.text, hasTex ? 25 : 30, hasTex ? look.ink.muted : color, colW) : [];
          const tex = sc.tex ? await bmath(sc.tex, 42, color) : null;
          const k = tex ? Math.min(1, (colW - 30) / tex.w) : 1;
          // Margin note: a short arrow just after the line, then the note in a smaller hand.
          const lineEnd = tex ? L + 26 + tex.w * k : L + Math.max(0, ...text.map((s) => s.w));
          const noteX = Math.min(noteL, lineEnd + 84);
          const why = sc.why ? textLines(sc.why, noteFont, 500, 25 * 1.25, look.ink.accent, R - noteX) : [];
          const textH = text.reduce((a, s) => a + s.h, 0);
          const whyH = why.reduce((a, s) => a + s.h - 6, 0);
          const hgt = Math.max(textH + (tex ? tex.h * k + 4 : 0), whyH);
          ensureVisible(gi, blockTop, blockTop + hgt, st.start, view);
          let yy = y;
          if (text.length) yy = writeLines(text, L, yy, 0, gi, beat(st, 'text'), INF, 'write', pen(text[0] ? (hasTex ? look.ink.muted : color) : color));
          let mathMid = yy;
          if (tex) {
            addSprite(tex, L + 26, yy + 2, gi, beat(st, 'tex'), INF, 'write', k, pen(color));
            mathMid = yy + 2 + (tex.h * k) / 2;
            yy += 4 + tex.h * k;
          }
          if (why.length) {
            const w = beat(st, 'why');
            const arrowEnd = noteX - 60;
            const ay = tex ? mathMid : yy - (text[text.length - 1]?.h ?? 30) / 2;
            const arrowWin: Win = [w[0], w[0] + Math.min(0.35, (w[1] - w[0]) * 0.3)];
            addPath([rough([noteX - 12, ay, arrowEnd, ay + 2], 1), [arrowEnd + 9, ay - 6, arrowEnd, ay + 2, arrowEnd + 10, ay + 9]], withAlpha(look.ink.accent, 0.9), 2.4, gi, arrowWin, INF).pen = pen(look.ink.accent);
            const wy0 = Math.max(blockTop - 4, ay - (whyH + 6) / 2);
            writeLines(why, noteX, wy0, -6, gi, [arrowWin[1], w[1]], INF, 'write', pen(look.ink.accent));
          }
          y = Math.max(yy, blockTop + whyH) + 22;
          break;
        }
        case 'mistake': {
          const exam = look.id === 'exam';
          const colW = (R - L - 40) / 2;
          const lx = L;
          const rx = L + colW + 40;
          const wrongC = look.ink.warn;
          const rightC = look.ink.good;
          const headPx = 26;
          const hL = hand(exam ? '✗  TRAP' : 'Not this:', headPx, wrongC, colW, HB);
          const hR = hand(exam ? '✓  DO THIS' : 'Do this:', headPx, rightC, colW, HB);
          const pad = exam ? 22 : 0;
          const wl = hand(sc.wrong, 27, wrongC, colW - pad * 2);
          const rl = hand(sc.right, 27, rightC, colW - pad * 2);
          const wt = sc.wrongTex ? await bmath(sc.wrongTex, 38, wrongC) : null;
          const rt = sc.rightTex ? await bmath(sc.rightTex, 38, rightC) : null;
          const colH = (lines: Sprite[], t: Sprite | null) => hL[0]!.h + 6 + lines.reduce((a, s) => a + s.h, 0) + (t ? 10 + t.h * Math.min(1, (colW - pad * 2) / t.w) : 0);
          const hgt = Math.max(colH(wl, wt), colH(rl, rt)) + pad * 2;
          ensureVisible(gi, blockTop, blockTop + hgt, st.start, view);
          const col = (x: number, head: Sprite[], lines: Sprite[], t: Sprite | null, color: string, kText: string, kTex: string): { box: [number, number, number, number] | null } => {
            const tw = beat(st, kText);
            if (exam) {
              items.push({ ...base(gi, [tw[0] - 0.3, tw[0]], INF, 'fade'), k: 'rect', x, y, w: colW, h: hgt, r: 14, fill: color === wrongC ? look.bad.fill : look.goodPanel.fill });
              items.push({ ...base(gi, [tw[0] - 0.3, tw[0]], INF, 'fade'), k: 'rect', x, y, w: 6, h: hgt, r: 3, fill: color });
            }
            let yy = writeLines(head, x + pad, y + pad, 0, gi, [tw[0], tw[0] + 0.5], INF, 'write', pen(color));
            yy += 6;
            yy = writeLines(lines, x + pad, yy, 0, gi, [tw[0] + 0.5, tw[1]], INF, 'write', pen(color));
            let box: [number, number, number, number] | null = null;
            if (t) {
              const k = Math.min(1, (colW - pad * 2) / t.w);
              addSprite(t, x + pad + 6, yy + 10, gi, beat(st, kTex), INF, 'write', k, pen(color));
              box = [x + pad + 6, yy + 10, t.w * k, t.h * k];
            } else box = [x + pad, yy - lines.reduce((a, s) => a + s.h, 0), Math.max(...lines.map((s) => s.w)), lines.reduce((a, s) => a + s.h, 0)];
            return { box };
          };
          const a = col(lx, hL, wl, wt, wrongC, 'wrong', 'wrongTex');
          const b = col(rx, hR, rl, rt, rightC, 'right', 'rightTex');
          if (a.box) {
            const [bx, by, bw, bh] = a.box;
            addPath([rough([bx - 6, by + bh * 0.85, bx + bw + 6, by + bh * 0.2], 1.4)], wrongC, look.chalk ? 4 : 3.4, gi, beat(st, 'cross'), INF).pen = pen(wrongC);
          }
          if (b.box) {
            const [bx, by, bw, bh] = b.box;
            const cx = Math.min(rx + colW - 30, bx + bw + 18);
            const cy = by + bh / 2;
            addPath([rough([cx, cy, cx + 9, cy + 11, cx + 28, cy - 16], 0.8, 6)], rightC, look.chalk ? 4 : 3.6, gi, beat(st, 'check'), INF).pen = pen(rightC);
          }
          y = blockTop + hgt + GAP;
          break;
        }
        case 'graph': {
          const gw = Math.min(700, R - L - 120);
          const gh = 300;
          const capH = sc.caption ? 50 : 0;
          if (work) y += 20;
          ensureVisible(gi, y, y + gh + capH + 10, st.start, view, work);
          const gx = VW / 2 - gw / 2;
          const bottom = await drawGraph(sc, st, gi, gx, y + 8, gw, gh, INF, true);
          y = bottom + GAP + 6;
          break;
        }
        case 'answer': {
          const color = look.ink.good;
          const s = sc.tex ? await bmath(sc.tex, 50, color) : textSprite(sc.display, look.hand, HB, 44 * hs, color);
          const k = Math.min(1, (R - L - 120) / s.w);
          const hgt = s.h * k + 40;
          ensureVisible(gi, blockTop, blockTop + hgt + 10, st.start, view);
          const x = L + 40;
          addSprite(s, x, y + 20, gi, beat(st, 'answer'), INF, 'write', k, pen(color));
          addPath([handBox(x - 24, y + 4, s.w * k + 48, s.h * k + 32), rough([x - 18, y + s.h * k + 46, x + s.w * k + 30, y + s.h * k + 42], 1.5)], look.ink.accent, look.chalk ? 3.6 : 3.2, gi, beat(st, 'box'), INF).pen = pen(look.ink.accent);
          if (onePerPage) {
            // A little sparkle on the answer.
            const cx = x + s.w * k + 34;
            const cy = y + 2;
            const star: number[] = [];
            for (let i = 0; i <= 8; i++) {
              const a = -Math.PI / 2 + (i * Math.PI) / 4;
              const r = i % 2 ? 6 : 17;
              star.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
            addPath([star], '#ffb020', 3.5, gi, [beat(st, 'box')[1], beat(st, 'box')[1] + 0.4], INF).pen = pen('#ffb020');
          }
          y += hgt + GAP + 14;
          break;
        }
        case 'summary': {
          const head = hand('Summary', 36, look.ink.accent, 600, HB);
          const pts = sc.points.map((p) => hand(p, 29, look.ink.main, R - L - 60));
          const hgt = head[0]!.h + 12 + pts.reduce((a, l) => a + l.reduce((b, s) => b + s.h, 0) + 6, 0);
          if (work) y += 24;
          ensureVisible(gi, y, y + hgt, st.start, view, work);
          let yy = writeLines(head, L, y, 0, gi, beat(st, 'heading'), INF, 'write', pen(look.ink.accent));
          addPath([rough([L - 4, yy + 2, L + head[0]!.w + 10, yy - 1], 1.2)], look.ink.accent, 2.8, gi, [beat(st, 'heading')[1] - 0.2, beat(st, 'heading')[1]], INF).pen = pen(look.ink.accent);
          yy += 12;
          pts.forEach((lines, i) => {
            const w = beat(st, `p${i}`);
            items.push({ ...base(gi, [w[0], w[0] + 0.2], INF, 'pop'), k: 'dot', x: L + 10, y: yy + lines[0]!.h * 0.55, r: 5, color: look.ink.accent });
            yy = writeLines(lines, L + 34, yy, 0, gi, [w[0] + 0.15, w[1]], INF, 'write', pen(look.ink.main)) + 6;
          });
          y = yy + GAP;
          break;
        }
        case 'practice': {
          const label = hand('Try this:', 28, look.ink.accent, 400, HB);
          const text = hand(sc.text, 30, look.ink.main, R - L - 40);
          const tex = sc.tex ? await bmath(sc.tex, 42, look.ink.main) : null;
          const ans = hand(`Answer: ${sc.answer}`, 26, look.ink.muted, R - L - 60);
          const hgt = label[0]!.h + text.reduce((a, s) => a + s.h, 0) + (tex ? tex.h + 10 : 0) + 16 + ans.reduce((a, s) => a + s.h, 0);
          if (work) y += 24;
          ensureVisible(gi, y, y + hgt, st.start, view);
          let yy = writeLines(label, L, y, 0, gi, beat(st, 'label'), INF, 'write', pen(look.ink.accent));
          yy = writeLines(text, L + 20, yy + 4, 0, gi, beat(st, 'text'), INF, 'write', pen(look.ink.main));
          if (tex) {
            const k = Math.min(1, (R - L - 80) / tex.w);
            addSprite(tex, L + 40, yy + 10, gi, beat(st, 'tex'), INF, 'write', k, pen(look.ink.main));
            yy += 10 + tex.h * k;
          }
          yy = writeLines(ans, L + 20, yy + 16, 0, gi, beat(st, 'answer'), INF, 'write', pen(look.ink.muted));
          y = yy + GAP;
          break;
        }
        case 'pause': {
          pauseCard(st, sc, -1, st.end, true);
          break;
        }
      }
      if (onePerPage && sc.kind !== 'pause') {
        // One idea at a time: each scene gets its own page, centred in view.
        const h = y - GAP - blockTop;
        const room = VIEW_BOTTOM - VIEW_TOP;
        // ...and centred across the page too.
        let minX = Infinity;
        let maxX = -Infinity;
        const scene = items.slice(firstItem).filter((it) => it.group === gi);
        for (const it of scene) {
          if (it.k === 'sprite') {
            minX = Math.min(minX, it.x);
            maxX = Math.max(maxX, it.x + it.s.w * it.scale);
          } else if (it.k === 'path') {
            for (const pl of it.polys) for (let q = 0; q < pl.length; q += 2) (minX = Math.min(minX, pl[q]!)), (maxX = Math.max(maxX, pl[q]!));
          }
        }
        const dx = Number.isFinite(minX) ? Math.max(0, (VW - (minX + maxX)) / 2) : 0;
        if (dx > 1)
          for (const it of scene) {
            if (it.k === 'sprite' || it.k === 'rect' || it.k === 'dot') it.x += dx;
            else if (it.k === 'path') it.polys = it.polys.map((pl) => pl.map((v, q) => (q % 2 ? v : v + dx)));
          }
        if (h <= room) {
          g0.keys.length = saved.n;
          g0.target = saved.target;
          g0.lastT = saved.lastT;
          const target = blockTop - VIEW_TOP - (room - h) / 2;
          if (Math.abs(target - g0.target) > 0.5) {
            const first = !wrote;
            const t0 = first ? -1 : Math.max(g0.lastT, st.start - 0.05);
            const t1 = first ? 0 : t0 + 0.8;
            g0.keys.push({ t0, t1, a: g0.target, b: target });
            g0.target = target;
            g0.lastT = t1;
          }
        }
      }
      if (sc.kind !== 'pause') wrote = true;
      if (sc.kind !== 'pause' && sc.kind !== 'title') work = true;
    }
  }

  // ======================================================== SLIDE ENGINE

  async function layoutSlide() {
    const S = look.size;
    const proof = look.id === 'proof';
    const lecture = look.id === 'lecture' || proof;
    const quick = look.id === 'quick';
    const F = look.face;
    const HF = look.headFace;
    const ink = look.ink;
    const sansLines = (text: string, px: number, color: string, maxW: number, weight = 400, family = F) => textLines(text, family, weight, px * S, color, maxW);
    const centerX = (s: Sprite, k: number) => VW / 2 - (s.w * k) / 2;
    const L = lecture ? 100 : 140;
    const R = lecture ? 1180 : 1140;
    const n = tl.scenes.length;

    // Lecture chrome: footer on every slide but the title.
    if (look.id === 'lecture') {
      // Running head, top right (the bottom belongs to captions).
      const foot = textSprite(script.title, F, 500, 15, ink.muted, false);
      const brand = textSprite('Lemma LECTURE', F, 700, 12, withAlpha(ink.accent, 0.9), false);
      const first = tl.scenes.find((s) => s.scene.kind !== 'title');
      if (first) {
        addSprite(brand, R - brand.w, 52, -1, [first.start, first.start + 0.5], Infinity, 'fade');
        addSprite(foot, R - foot.w, 52 + brand.h + 2, -1, [first.start, first.start + 0.5], Infinity, 'fade');
      }
    }

    if (quick) {
      // Quick: a lime progress bar races along the top of the frame.
      items.push({ ...base(-1, [0, tl.duration], Infinity, 'draw'), k: 'rect', x: 0, y: 0, w: VW, h: 6, r: 0, fill: ink.accent });
    }

    /** Lecture slide heading with its rule; returns the y where content starts. */
    const slideHeading = (text: string, st: ScriptSceneTiming, until: number, gi: number): number => {
      if (!lecture) return 0;
      const s = textSprite(text, HF, 700, 36, ink.main, false);
      const k = Math.min(1, (R - L - 300) / s.w);
      addSprite(s, L, 48, gi, [st.start + 0.2, st.start + 0.7], until, 'rise', k);
      addPath([[L, 112, R, 112]], withAlpha(ink.main, 0.14), 1.5, gi, [st.start + 0.2, st.start + 0.9], until, {}, 'grow');
      addPath([[L, 112, L + 64, 112]], ink.accent, 4, gi, [st.start + 0.3, st.start + 0.9], until, {}, 'grow');
      return 150;
    };

    /** Vertically centres a block of height h in the content band. */
    const centerTop = (h: number, top = 70) => Math.max(top, (top + VIEW_BOTTOM - h) / 2);

    let i = 0;
    while (i < n) {
      const st = tl.scenes[i]!;
      const sc = st.scene;
      // ---- worked run: [problem] step* [answer]
      if (sc.kind === 'problem' || sc.kind === 'step' || (sc.kind === 'answer' && i > 0 && (tl.scenes[i - 1]!.scene.kind === 'step' || tl.scenes[i - 1]!.scene.kind === 'problem'))) {
        let j = i;
        if (tl.scenes[j]!.scene.kind === 'problem') j++;
        while (j < n && tl.scenes[j]!.scene.kind === 'step') j++;
        if (j < n && tl.scenes[j]!.scene.kind === 'answer') j++;
        await layoutRun(tl.scenes.slice(i, j));
        i = j;
        continue;
      }
      const until = st.end;
      const gi = newGroup();
      switch (sc.kind) {
        case 'title': {
          const label = textSprite(proof ? 'PROOF' : script.kind === 'lecture' ? 'LECTURE' : 'WORKED EXAMPLE', F, 700, 15 * S, ink.accent, false);
          const lines = sansLines(sc.title, quick ? 72 : lecture ? 58 : 62, ink.main, quick ? 1080 : 1000, quick ? 800 : 700, lecture ? HF : F);
          const sub = sc.subtitle ? sansLines(sc.subtitle, 26, ink.muted, 900) : [];
          const th = lines.reduce((a, s) => a + s.h, 0);
          const hgt = label.h + 18 + th + 26 + sub.reduce((a, s) => a + s.h, 0);
          const top = centerTop(hgt, 60);
          const left = lecture || quick;
          const xf = (s: Sprite) => (left ? L + (lecture ? 36 : 0) : VW / 2 - s.w / 2);
          addSprite(label, xf(label), top, gi, [st.start + 0.2, st.start + 0.6], until, 'fade');
          let yy = writeLines(lines, xf, top + label.h + 14, 0, gi, beat(st, 'title'), until, 'rise');
          if (lecture) items.push({ ...base(gi, beat(st, 'rule'), until, 'grow'), k: 'rect', x: L, y: top, w: 8, h: yy - top, r: 4, fill: ink.accent });
          else if (quick) items.push({ ...base(gi, beat(st, 'rule'), until, 'grow'), k: 'rect', x: L, y: yy + 12, w: 180, h: 12, r: 6, fill: ink.accent });
          else addPath([[VW / 2 - 90, yy + 18, VW / 2 + 90, yy + 18]], ink.accent, 4, gi, beat(st, 'rule'), until, { glow: 8 }, 'grow');
          yy += quick ? 40 : 34;
          if (sub.length) writeLines(sub, xf, yy, 0, gi, beat(st, 'subtitle'), until, 'rise');
          break;
        }
        case 'concept':
        case 'rule': {
          const top0 = slideHeading(sc.heading, st, until, gi);
          const headS = lecture ? [] : sansLines(sc.heading, quick ? 50 : 40, sc.kind === 'rule' ? ink.accent : ink.main, 1000, 700);
          const body = sc.kind === 'concept' ? sansLines(sc.body, 28, ink.main, lecture ? R - L : 1000) : [];
          const texPx = sc.kind === 'rule' ? 60 : 48;
          const tex = sc.tex ? await mathSprite(sc.tex, texPx * S, ink.main, false) : null;
          const note = sc.kind === 'rule' && sc.note ? sansLines(sc.note, 22, ink.muted, 900) : [];
          const k = tex ? Math.min(1, (R - L - 120) / tex.w) : 1;
          const card = sc.kind === 'rule';
          const texBlockH = tex ? tex.h * k + (card ? 80 : 0) : 0;
          const hgt = headS.reduce((a, s) => a + s.h, 0) + (headS.length ? 24 : 0) + body.reduce((a, s) => a + s.h + 4, 0) + (tex ? 30 + texBlockH : 0) + (note.length ? 24 + note.reduce((a, s) => a + s.h, 0) : 0);
          let yy = lecture ? Math.max(top0, centerTop(hgt, top0)) : centerTop(hgt);
          const xf = (s: Sprite, kk: number) => (lecture ? L : centerX(s, kk));
          if (headS.length) yy = writeLines(headS, (s) => centerX(s, 1), yy, 0, gi, beat(st, 'heading'), until, 'rise') + 24;
          if (body.length) yy = writeLines(body, xf, yy, 4, gi, beat(st, 'body'), until, 'rise') + 4;
          if (tex) {
            yy += 30;
            const tx = lecture && !card ? L + 40 : centerX(tex, k);
            if (card) {
              const cw = tex.w * k + 120;
              const cx = lecture ? VW / 2 - cw / 2 : VW / 2 - cw / 2;
              items.push({ ...base(gi, beat(st, 'tex'), until, 'pop'), k: 'rect', x: cx, y: yy, w: cw, h: texBlockH, r: 20, fill: look.card.fill, stroke: withAlpha(ink.accent, 0.7), lw: 2.5, shadow: !look.dark });
              addSprite(tex, VW / 2 - (tex.w * k) / 2, yy + 40, gi, beat(st, 'tex'), until, 'fade', k);
              items.push({ ...base(gi, beat(st, 'box'), until, 'grow'), k: 'rect', x: cx, y: yy + texBlockH - 5, w: cw, h: 5, r: 2.5, fill: ink.accent });
            } else addSprite(tex, tx, yy, gi, beat(st, 'tex'), until, 'rise', k);
            yy += texBlockH;
          }
          if (note.length) writeLines(note, (s) => centerX(s, 1), yy + 24, 0, gi, beat(st, 'note'), until, 'rise');
          break;
        }
        case 'pause':
          slideHeading('Your turn', st, until, gi);
          pauseCard(st, sc, gi, until, false);
          break;
        case 'mistake': {
          const top0 = slideHeading('Common mistake', st, until, gi);
          const colW = 470;
          const gap = 40;
          const lx = VW / 2 - colW - gap / 2;
          const rx = VW / 2 + gap / 2;
          const mk = async (x: number, head: string, text: string, tex: string | undefined, color: string, panel: { fill: string; edge: string }, kText: string, kTex: string, mark: 'x' | 'check') => {
            const hs = textSprite(head, F, 700, 18 * S, color, false);
            const lines = sansLines(text, 24, ink.main, colW - 60);
            const ts = tex ? await mathSprite(tex, 36 * S, ink.main, false) : null;
            const k = ts ? Math.min(1, (colW - 60) / ts.w) : 1;
            const h = 30 + hs.h + 16 + lines.reduce((a, s) => a + s.h, 0) + (ts ? 22 + ts.h * k : 0) + 34;
            return { x, hs, lines, ts, k, h, color, panel, kText, kTex, mark };
          };
          const A = await mk(lx, '✗  COMMON MISTAKE', sc.wrong, sc.wrongTex, look.ink.warn, look.bad, 'wrong', 'wrongTex', 'x');
          const B = await mk(rx, '✓  DO THIS INSTEAD', sc.right, sc.rightTex, look.ink.good, look.goodPanel, 'right', 'rightTex', 'check');
          const h = Math.max(A.h, B.h);
          const top = lecture ? Math.max(top0 + 10, centerTop(h, top0)) : centerTop(h);
          for (const P of [A, B]) {
            const w0 = beat(st, P.kText);
            const w1 = beat(st, P.kTex);
            items.push({ ...base(gi, [w0[0], w0[0] + 0.45], until, 'rise'), k: 'rect', x: P.x, y: top, w: colW, h, r: 18, fill: P.panel.fill, stroke: withAlpha(P.panel.edge, 0.45), lw: 1.5 });
            items.push({ ...base(gi, [w0[0] + 0.1, w0[0] + 0.6], until, 'grow'), k: 'rect', x: P.x, y: top, w: colW, h: 5, r: 2.5, fill: P.panel.edge });
            addSprite(P.hs, P.x + 30, top + 30, gi, [w0[0] + 0.1, w0[1]], until, 'fade');
            let yy = writeLines(P.lines, P.x + 30, top + 30 + P.hs.h + 16, 0, gi, [w0[0] + 0.2, w0[1] + 0.2], until, 'rise');
            if (P.ts) {
              addSprite(P.ts, P.x + 30, yy + 22, gi, w1[1] > w1[0] ? w1 : w0, until, 'rise', P.k);
              yy += 22 + P.ts.h * P.k;
              if (P.mark === 'x') addPath([[P.x + 24, yy - P.ts.h * P.k * 0.25, P.x + 36 + P.ts.w * P.k, yy - P.ts.h * P.k * 0.75]], P.panel.edge, 3.5, gi, beat(st, 'cross'), until);
            }
          }
          break;
        }
        case 'graph': {
          const top0 = slideHeading(sc.caption && sc.caption.length < 60 ? sc.caption : 'Graph', st, until, gi);
          const gw = lecture ? 860 : 860;
          const gh = lecture ? 400 : 420;
          const gx = VW / 2 - gw / 2;
          const gy = lecture ? top0 + 6 : sc.caption ? 70 : 110;
          await drawGraph(lecture && sc.caption && sc.caption.length < 60 ? { ...sc, caption: undefined } : sc, st, gi, gx, gy, gw, gh, until, false);
          break;
        }
        case 'summary': {
          const top0 = slideHeading('Summary', st, until, gi);
          const head = lecture ? null : textSprite('Summary', F, quick ? 800 : 700, 42 * S, ink.main, false);
          const rows = sc.points.map((p) => sansLines(p, lecture ? 31 : 29, ink.main, lecture ? R - L - 80 : 820));
          const hgt = (head ? head.h + 30 : 0) + rows.reduce((a, r) => a + r.reduce((b, s) => b + s.h, 0) + 20, 0);
          let yy = lecture ? Math.max(top0, centerTop(hgt, top0)) : centerTop(hgt);
          const x0 = lecture ? L + 50 : VW / 2 - 400;
          if (head) {
            addSprite(head, x0 - 50, yy, gi, beat(st, 'heading'), until, 'rise');
            yy += head.h + 30;
          }
          rows.forEach((lines, idx) => {
            const w = beat(st, `p${idx}`);
            const rowY = yy;
            if (lecture) {
              const num = textSprite(String(idx + 1), F, 700, 16, '#ffffff', false);
              items.push({ ...base(gi, [w[0], w[0] + 0.35], until, 'pop'), k: 'dot', x: x0 - 30, y: rowY + lines[0]!.h / 2, r: 15, color: ink.accent });
              addSprite(num, x0 - 30 - num.w / 2, rowY + lines[0]!.h / 2 - num.h / 2, gi, [w[0], w[0] + 0.35], until, 'pop');
            } else {
              addPath([[x0 - 40, rowY + lines[0]!.h * 0.55, x0 - 32, rowY + lines[0]!.h * 0.55 + 9, x0 - 16, rowY + lines[0]!.h * 0.55 - 10]], ink.accent, 4, gi, [w[0], w[0] + 0.3], until);
            }
            yy = writeLines(lines, x0, rowY, 0, gi, [w[0] + 0.05, w[1] + 0.1], until, 'rise') + 26;
          });
          break;
        }
        case 'practice': {
          const top0 = slideHeading('Practice', st, until, gi);
          const label = textSprite('TRY THIS', F, 700, 16 * S, ink.accent, false);
          const text = sansLines(sc.text, 30, ink.main, lecture ? R - L : 900);
          const tex = sc.tex ? await mathSprite(sc.tex, 46 * S, ink.main, false) : null;
          const ans = textSprite(`Answer: ${sc.answer}`, F, 600, 22 * S, look.dark ? '#0b1430' : '#ffffff', false);
          const k = tex ? Math.min(1, (R - L - 80) / tex.w) : 1;
          const hgt = label.h + 16 + text.reduce((a, s) => a + s.h, 0) + (tex ? 24 + tex.h * k : 0) + 40 + ans.h + 16;
          let yy = lecture ? Math.max(top0, centerTop(hgt, top0)) : centerTop(hgt);
          const xf = (s: Sprite, kk = 1) => (lecture ? L : centerX(s, kk));
          addSprite(label, xf(label), yy, gi, beat(st, 'label'), until, 'fade');
          yy = writeLines(text, xf, yy + label.h + 16, 0, gi, beat(st, 'text'), until, 'rise');
          if (tex) {
            addSprite(tex, lecture ? L + 30 : centerX(tex, k), yy + 24, gi, beat(st, 'tex'), until, 'rise', k);
            yy += 24 + tex.h * k;
          }
          const aw = ans.w + 36;
          const ax = lecture ? L : VW / 2 - aw / 2;
          items.push({ ...base(gi, beat(st, 'answer'), until, 'pop'), k: 'rect', x: ax, y: yy + 40, w: aw, h: ans.h + 16, r: (ans.h + 16) / 2, fill: ink.good });
          addSprite(ans, ax + 18, yy + 48, gi, beat(st, 'answer'), until, 'pop');
          break;
        }
        case 'answer': {
          await answerCard(sc, st, gi, until, null);
          break;
        }
        default:
          break;
      }
      i++;
    }

    async function answerCard(sc: Extract<Scene, { kind: 'answer' }>, st: ScriptSceneTiming, gi: number, until: number, at: { y: number } | null): Promise<number> {
      const color = ink.main;
      const s = sc.tex ? await mathSprite(sc.tex, 52 * S, color, false) : textSprite(sc.display, F, 700, 44 * S, color, false);
      const label = textSprite('ANSWER', F, 700, 15 * S, ink.good, false);
      const k = Math.min(1, 860 / s.w);
      const cw = Math.max(s.w * k, label.w) + 100;
      const ch = label.h + 12 + s.h * k + 56;
      const y = at ? at.y : centerTop(ch);
      const x = lecture && at ? L + 50 : VW / 2 - cw / 2;
      const aw = beat(st, 'answer');
      items.push({ ...base(gi, [aw[0], aw[0] + 0.5], until, 'pop'), k: 'rect', x, y, w: cw, h: ch, r: 20, fill: withAlpha(ink.good, look.dark ? 0.12 : 0.08), stroke: ink.good, lw: 2.5, shadow: !look.dark });
      addSprite(label, x + 50, y + 24, gi, [aw[0] + 0.15, aw[1]], until, 'fade');
      addSprite(s, x + 50, y + 24 + label.h + 12, gi, [aw[0] + 0.2, aw[1] + 0.2], until, 'rise', k);
      if (!lecture) addPath([[x + 14, y + ch - 1, x + cw - 14, y + ch - 1]], ink.good, 3, gi, beat(st, 'box'), until, { glow: 10 }, 'grow');
      return y + ch;
    }

    async function layoutRun(run: ScriptSceneTiming[]) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const until = last.end;
      const headerGi = newGroup();
      let contentTop = lecture ? 150 : 150;
      const problem = first.scene.kind === 'problem' ? (first.scene as Extract<Scene, { kind: 'problem' }>) : null;
      const firstStep = run.find((s) => s.scene.kind !== 'problem');
      // ---- problem: full-size first, then (visual/quick) it moves up and shrinks into a header for the steps
      if (problem) {
        const st = first;
        const label = textSprite((problem.label ?? 'Problem').toUpperCase(), F, 700, 15 * S, ink.accent, false);
        const text = problem.text ? sansLines(problem.text, lecture ? 26 : 34, ink.main, lecture ? R - L : 960) : [];
        const tex = problem.tex ? await mathSprite(problem.tex, (lecture ? 38 : 52) * S, ink.main, false) : null;
        const k = tex ? Math.min(1, (R - L - 40) / tex.w) : 1;
        if (lecture) {
          slideHeading(problem.label ?? 'Example', st, until, headerGi);
          let yy = 140;
          yy = writeLines(text, L, yy, 0, headerGi, beat(st, 'text'), until, 'rise');
          if (tex) {
            addSprite(tex, L, yy + 8, headerGi, beat(st, 'tex'), until, 'rise', k);
            yy += 8 + tex.h * k;
          }
          contentTop = yy + 30;
        } else {
          const hgt = label.h + 16 + text.reduce((a, s) => a + s.h, 0) + (tex ? 18 + tex.h * k : 0);
          const top = centerTop(hgt);
          const shrink = 0.6;
          const T = firstStep ? firstStep.start + 0.05 : Infinity;
          addSprite(label, centerX(label, 1), top, headerGi, beat(st, 'label'), firstStep ? T + 0.3 : until, 'fade');
          // Header geometry after the move.
          let hy = 34;
          let yy = top + label.h + 16;
          const move = (s: Sprite, kk: number, y0: number) => {
            const it = addSprite(s, centerX(s, kk), y0, headerGi, [0, 0], until, 'rise', kk);
            const w1 = s.w * kk * shrink;
            if (firstStep) it.keys = [{ t: T, dur: 0.8, dx: VW / 2 - w1 / 2 - centerX(s, kk), dy: hy - y0, s: shrink, a: 0.85 }];
            hy += s.h * kk * shrink + 2;
            return it;
          };
          const tw = beat(st, 'text');
          const txw = beat(st, 'tex');
          for (const [idx, s] of text.entries()) {
            const it = move(s, 1, yy);
            const d = (tw[1] - tw[0]) / text.length;
            it.t0 = it.from = tw[0] + d * idx;
            it.t1 = it.t0 + Math.max(0.4, d);
            yy += s.h;
          }
          if (tex) {
            yy += 18;
            const it = move(tex, k, yy);
            it.t0 = it.from = txw[0];
            it.t1 = txw[1];
          }
          contentTop = Math.max(150, hy + 26);
          if (firstStep) items.push({ ...base(headerGi, [T + 0.4, T + 1], until, 'grow'), k: 'rect', x: VW / 2 - 40, y: hy + 8, w: 80, h: 3, r: 1.5, fill: withAlpha(ink.accent, 0.8) });
        }
      } else if (lecture) {
        slideHeading(proof ? 'Proof' : 'Worked solution', first, until, headerGi);
      }
      const stepScenes = run.filter((s) => s.scene.kind === 'step');
      let keyIdx = stepScenes.findIndex((s) => s.scene.kind === 'step' && (s.scene.ink === 'accent' || s.scene.ink === 'second'));
      if (keyIdx < 0 && stepScenes.length >= 2) keyIdx = Math.floor((stepScenes.length - 1) / 2);
      let lastRow: { y: number; h: number } | null = null;

      // ---- steps (and answer): a column that scrolls; older steps dim.
      const gi = newGroup([0, contentTop - 8, VW, VH - contentTop + 8]);
      const view: [number, number] = [contentTop, VIEW_BOTTOM];
      let y = contentTop + (lecture ? 0 : 10);
      const blocks: { st: ScriptSceneTiming; items: Item[] }[] = [];
      let num = 0;
      for (const st of run) {
        const sc = st.scene;
        if (sc.kind === 'problem') continue;
        const startIdx = items.length;
        if (sc.kind === 'step') {
          num++;
          const color = inkOf(sc.ink);
          if (proof) {
            // Numbered justification lines: (n) | statement ........ reason
            const ruleX = L + 70;
            const tx = L + 96;
            const jx = 830;
            const mainW = jx - tx - 30;
            const tex = sc.tex ? await mathSprite(sc.tex, 34, color, false) : null;
            const k = tex ? Math.min(1, mainW / tex.w) : 1;
            const mainText = !tex && sc.text ? textLines(sc.text, HF, 400, 25, color, mainW) : [];
            const just = [
              ...(tex && sc.text ? textLines(sc.text, HF, 400, 23, ink.muted, R - jx, true) : []),
              ...(sc.why ? textLines(`— ${sc.why}`, HF, 400, 20, ink.muted, R - jx, true) : []),
            ];
            const mainH = tex ? tex.h * k : mainText.reduce((a, s) => a + s.h, 0);
            const hgt = Math.max(mainH, just.reduce((a, s) => a + s.h, 0), 34);
            ensureVisible(gi, y - 10, y + hgt + 10, st.start, view);
            const tw = beat(st, 'text');
            const xw = beat(st, 'tex');
            const isKey = num - 1 === keyIdx;
            if (isKey) {
              const tag = textSprite('KEY STEP', SANS, 700, 12, ink.accent, false);
              y += tag.h + 4;
              items.push({ ...base(gi, [xw[1], xw[1] + 0.5], until, 'fade'), k: 'rect', x: L + 4, y: y - 16 - tag.h, w: R - L - 4, h: hgt + 26 + tag.h, r: 8, fill: withAlpha(ink.accent, 0.09) });
              items.push({ ...base(gi, [xw[1], xw[1] + 0.5], until, 'grow'), k: 'rect', x: L + 4, y: y - 16 - tag.h, w: 4, h: hgt + 26 + tag.h, r: 2, fill: ink.accent });
              addSprite(tag, tx, y - tag.h - 6, gi, [xw[1], xw[1] + 0.5], until, 'fade');
            }
            const ns = textSprite(`(${num})`, HF, 400, 20, ink.muted, false);
            addSprite(ns, L + 10, y + Math.min(hgt, 40) / 2 - ns.h / 2, gi, [tw[0], tw[0] + 0.4], until, 'fade');
            addPath([[ruleX, y - 10, ruleX, y + hgt + 10]], withAlpha(ink.main, 0.28), 1.2, gi, [tw[0], tw[0] + 0.5], until);
            if (tex) addSprite(tex, tx, y, gi, xw[1] > xw[0] ? xw : tw, until, 'rise', k);
            else writeLines(mainText, tx, y, 0, gi, tw, until, 'rise');
            if (just.length) writeLines(just, jx, y + 2, 0, gi, sc.why ? [tw[0] + 0.2, beat(st, 'why')[1]] : tw, until, 'fade');
            lastRow = { y, h: hgt };
            y += hgt + 24;
          } else if (lecture) {
            const tx = L + 50;
            const textW = sc.why ? 620 : R - tx;
            const text = sc.text ? sansLines(sc.text, 24, ink.main, textW) : [];
            const tex = sc.tex ? await mathSprite(sc.tex, 36, color, false) : null;
            const k = tex ? Math.min(1, textW / tex.w) : 1;
            const why = sc.why ? sansLines(sc.why, 21, ink.muted, R - 880 - 20, 400) : [];
            const hgt = Math.max(text.reduce((a, s) => a + s.h, 0) + (tex ? 8 + tex.h * k : 0), why.reduce((a, s) => a + s.h, 0) + 8);
            ensureVisible(gi, y, y + hgt, st.start, view);
            const ns = textSprite(String(num), F, 700, 16, '#ffffff', false);
            const tw = beat(st, 'text');
            items.push({ ...base(gi, [tw[0], tw[0] + 0.35], until, 'pop'), k: 'dot', x: L + 16, y: y + 18, r: 16, color: ink.accent });
            addSprite(ns, L + 16 - ns.w / 2, y + 18 - ns.h / 2, gi, [tw[0], tw[0] + 0.35], until, 'pop');
            let yy = text.length ? writeLines(text, tx, y, 0, gi, tw, until, 'rise') : y;
            if (tex) {
              addSprite(tex, tx, yy + 8, gi, beat(st, 'tex'), until, 'rise', k);
              yy += 8 + tex.h * k;
            }
            if (why.length) {
              const ww = beat(st, 'why');
              items.push({ ...base(gi, ww, until, 'grow'), k: 'rect', x: 880, y: y + 2, w: 3, h: why.reduce((a, s) => a + s.h, 0) + 4, r: 1.5, fill: withAlpha(ink.accent, 0.6) });
              writeLines(why, 896, y + 4, 0, gi, ww, until, 'fade');
            }
            y = Math.max(yy, y + hgt) + 26;
          } else {
            const text = sc.text ? sansLines(sc.text, quick ? 26 : 23, quick ? ink.main : ink.muted, 900, quick ? 700 : 400) : [];
            const tex = sc.tex ? await mathSprite(sc.tex, quick ? 64 : 46, color, false) : null;
            const k = tex ? Math.min(1, 1000 / tex.w) : 1;
            const why = sc.why ? textSprite(sc.why, F, 600, 18 * S, ink.accent, false) : null;
            const hgt = text.reduce((a, s) => a + s.h, 0) + (tex ? 6 + tex.h * k : 0) + (why ? 16 + why.h + 10 : 0);
            ensureVisible(gi, y, y + hgt, st.start, view);
            let yy = text.length ? writeLines(text, (s) => centerX(s, 1), y, 0, gi, beat(st, 'text'), until, 'rise') : y;
            if (tex) {
              addSprite(tex, centerX(tex, k), yy + 6, gi, beat(st, 'tex'), until, 'rise', k);
              yy += 6 + tex.h * k;
            }
            if (why) {
              const ww = beat(st, 'why');
              const pw = Math.min(1000, why.w + 32);
              const px = VW / 2 - pw / 2;
              items.push({ ...base(gi, ww, until, 'pop'), k: 'rect', x: px, y: yy + 14, w: pw, h: why.h + 10, r: (why.h + 10) / 2, fill: withAlpha(ink.accent, 0.13), stroke: withAlpha(ink.accent, 0.4), lw: 1 });
              addSprite(why, px + 16, yy + 19, gi, ww, until, 'pop', Math.min(1, (pw - 32) / why.w));
              yy += 14 + why.h + 10;
            }
            y = yy + (quick ? 30 : 34);
          }
        } else if (sc.kind === 'answer') {
          // Answer card at the bottom of the column.
          const est = 160;
          ensureVisible(gi, y, y + est, st.start, view);
          const top = y + 4;
          y = (await answerCard(sc, st, gi, until, { y: top })) + 24;
          lastRow = { y: top, h: y - 24 - top };
        }
        blocks.push({ st, items: items.slice(startIdx) });
      }
      if (proof && lastRow) {
        const tomb = textSprite('∎', SERIF, 400, 30, ink.main, false);
        addSprite(tomb, R - tomb.w - 6, lastRow.y + lastRow.h + 14, gi, [last.end - 1.3, last.end - 0.9], until, 'fade');
      }
      // Earlier steps dim as each new one arrives.
      for (let b = 0; b < blocks.length - 1; b++) {
        const next = blocks[b + 1]!.st;
        for (const it of blocks[b]!.items) (it.keys ??= []).push({ t: next.start + 0.2, dur: 0.6, a: proof ? 0.72 : lecture ? 0.5 : 0.38 });
      }
    }
  }

  if (look.engine === 'board') await layoutBoard();
  else await layoutSlide();

  // ---------------------------------------------------------------- drawing

  function keyState(keys: Key[] | undefined, t: number) {
    let dx = 0;
    let dy = 0;
    let s = 1;
    let a = 1;
    if (!keys) return { dx, dy, s, a };
    for (const k of keys) {
      if (t <= k.t) break;
      const e = reduced ? 1 : easeInOut((t - k.t) / k.dur);
      dx += ((k.dx ?? dx) - dx) * e;
      dy += ((k.dy ?? dy) - dy) * e;
      s += ((k.s ?? s) - s) * e;
      a += ((k.a ?? a) - a) * e;
    }
    return { dx, dy, s, a };
  }

  function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const q = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + q, y);
    c.arcTo(x + w, y, x + w, y + h, q);
    c.arcTo(x + w, y + h, x, y + h, q);
    c.arcTo(x, y + h, x, y, q);
    c.arcTo(x, y, x + w, y, q);
    c.closePath();
  }

  /** Strokes the first `len` units of a multi-polyline path; returns the pen point. */
  function strokePartial(c: CanvasRenderingContext2D, it: Extract<Item, { k: 'path' }>, len: number): [number, number] | null {
    let left = len;
    let pt: [number, number] | null = null;
    c.beginPath();
    for (let p = 0; p < it.polys.length && left > 0; p++) {
      const pl = it.polys[p]!;
      c.moveTo(pl[0]!, pl[1]!);
      pt = [pl[0]!, pl[1]!];
      for (let i = 2; i < pl.length; i += 2) {
        const x0 = pl[i - 2]!;
        const y0 = pl[i - 1]!;
        const x1 = pl[i]!;
        const y1 = pl[i + 1]!;
        const d = Math.hypot(x1 - x0, y1 - y0);
        if (d >= left) {
          const f = d ? left / d : 0;
          pt = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
          c.lineTo(pt[0], pt[1]);
          left = 0;
          break;
        }
        c.lineTo(x1, y1);
        pt = [x1, y1];
        left -= d;
      }
    }
    c.stroke();
    return pt;
  }

  interface PenAt {
    x: number;
    y: number;
    color: string;
    alpha: number;
  }

  function drawItem(c: CanvasRenderingContext2D, it: Item, t: number, scroll: number): PenAt | null {
    if (t < it.from || t > it.until + OUT) return null;
    if (t < it.t0) return null;
    const span = Math.max(0.001, it.t1 - it.t0);
    const prog = clamp01((t - it.t0) / span);
    let a = 1;
    let p = 1;
    let sc = 1;
    let dy = 0;
    if (reduced) a = ease((t - it.t0) / 0.35);
    else
      switch (it.reveal) {
        case 'write':
        case 'draw':
          p = prog;
          break;
        case 'fade':
          a = ease(prog);
          break;
        case 'rise':
          a = ease(prog);
          dy = (1 - ease(prog)) * 16;
          break;
        case 'pop':
          sc = 0.6 + 0.4 * backOut(prog);
          a = clamp01(prog * 2.5);
          break;
        case 'grow':
          p = ease(prog);
          break;
      }
    if (t > it.until) a *= 1 - clamp01((t - it.until) / OUT);
    const ks = keyState(it.keys, t);
    a *= ks.a;
    if (a <= 0.003) return null;
    let pen: PenAt | null = null;
    c.save();
    c.globalAlpha = a;
    c.translate(0, -scroll + dy);
    switch (it.k) {
      case 'sprite': {
        const s = it.s;
        const k = it.scale * ks.s;
        const x = it.x + ks.dx;
        const y = it.y + ks.dy;
        if (sc !== 1) {
          c.translate(x + (s.w * k) / 2, y + (s.h * k) / 2);
          c.scale(sc, sc);
          c.translate(-(x + (s.w * k) / 2), -(y + (s.h * k) / 2));
        }
        if (p < 1) {
          const rx = s.w * p;
          c.beginPath();
          c.rect(x - s.pad * k, y - s.pad * k - 40, s.pad * k + rx * k, (s.h + s.pad * 2) * k + 80);
          c.clip();
          if (it.pen) {
            const col = Math.min(s.ink.length - 1, Math.max(0, Math.floor(rx / 2)));
            pen = { x: x + rx * k, y: y + (s.ink[col] ?? s.h / 2) * k, color: it.pen, alpha: 1 };
          }
        }
        c.drawImage(s.c, x - s.pad * k, y - s.pad * k, (s.w + s.pad * 2) * k, (s.h + s.pad * 2) * k);
        break;
      }
      case 'path': {
        if (it.clip) {
          c.beginPath();
          c.rect(...it.clip);
          c.clip();
        }
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = it.color;
        c.lineWidth = it.width;
        if (look.chalk) {
          c.shadowColor = withAlpha(it.color, 0.5);
          c.shadowBlur = 3 * u;
          c.globalAlpha = a * 0.92;
        } else if (it.glow) {
          c.shadowColor = withAlpha(it.color, 0.6);
          c.shadowBlur = it.glow * u;
        }
        const pt = strokePartial(c, it, it.total * p);
        if (p < 1 && pt) {
          if (it.pen) pen = { x: pt[0], y: pt[1], color: it.pen, alpha: 1 };
          if (it.head && !reduced) {
            c.shadowBlur = 16 * u;
            c.fillStyle = '#ffffff';
            c.beginPath();
            c.arc(pt[0], pt[1], 5.5, 0, Math.PI * 2);
            c.fill();
          }
        }
        break;
      }
      case 'rect': {
        const w = it.reveal === 'grow' || it.reveal === 'draw' ? it.w * p : it.w;
        if (w <= 0.5) break;
        if (sc !== 1) {
          c.translate(it.x + it.w / 2, it.y + it.h / 2);
          c.scale(sc, sc);
          c.translate(-(it.x + it.w / 2), -(it.y + it.h / 2));
        }
        rr(c, it.x, it.y, w, it.h, it.r);
        if (it.shadow) {
          c.shadowColor = 'rgba(20,30,50,0.14)';
          c.shadowBlur = 24 * u;
          c.shadowOffsetY = 6 * u;
        }
        if (it.fill) {
          c.fillStyle = it.fill;
          c.fill();
        }
        c.shadowColor = 'transparent';
        if (it.stroke) {
          c.strokeStyle = it.stroke;
          c.lineWidth = it.lw ?? 2;
          c.stroke();
        }
        break;
      }
      case 'dot': {
        c.translate(it.x, it.y);
        c.scale(sc, sc);
        if (it.ring) {
          c.fillStyle = it.ring;
          c.beginPath();
          c.arc(0, 0, it.r * 2.2, 0, Math.PI * 2);
          c.fill();
        }
        if (look.chalk) {
          c.shadowColor = withAlpha(it.color, 0.6);
          c.shadowBlur = 4 * u;
        }
        c.fillStyle = it.color;
        c.beginPath();
        c.arc(0, 0, it.r, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'ring': {
        const total = it.c1 - it.c0;
        const left = t < it.c0 ? total : Math.max(0, it.c1 - t);
        const frac = total > 0 ? left / total : 0;
        c.lineCap = 'round';
        c.lineWidth = 9;
        c.strokeStyle = it.track;
        c.beginPath();
        c.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        c.stroke();
        if (frac > 0) {
          c.strokeStyle = it.color;
          if (look.dark) {
            c.shadowColor = withAlpha(it.color, 0.5);
            c.shadowBlur = 10 * u;
          }
          c.beginPath();
          c.arc(it.x, it.y, it.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
          c.stroke();
          c.shadowColor = 'transparent';
        }
        c.fillStyle = it.textColor;
        c.font = it.font;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(left > 0 ? String(Math.ceil(left - 1e-6)) : '✓', it.x, it.y + 2);
        break;
      }
    }
    c.restore();
    if (pen) {
      pen.y += -scroll + dy;
      pen.alpha = a;
    }
    return pen;
  }

  function drawPen(c: CanvasRenderingContext2D, pen: PenAt, t: number) {
    const wob = Math.sin(t * 31) * 1.2;
    c.save();
    c.globalAlpha = pen.alpha;
    c.translate(pen.x, pen.y + wob);
    if (look.pen === 'chalk') {
      c.rotate(0.72);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      rr(c, 6, 4, 64, 14, 5);
      c.fill();
      const g = c.createLinearGradient(0, -7, 0, 7);
      g.addColorStop(0, '#fbfaf5');
      g.addColorStop(0.6, '#e9e6dc');
      g.addColorStop(1, '#c9c5b8');
      c.fillStyle = g;
      rr(c, 0, -7, 64, 14, 5);
      c.fill();
      c.fillStyle = withAlpha(pen.color, 0.9);
      rr(c, 0, -7, 7, 14, 3);
      c.fill();
    } else {
      c.rotate(0.78);
      c.fillStyle = 'rgba(15,20,30,0.18)';
      rr(c, 22, 8, 132, 26, 9);
      c.fill();
      // nib
      c.fillStyle = pen.color;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(12, -5);
      c.lineTo(12, 5);
      c.closePath();
      c.fill();
      // collar + barrel
      c.fillStyle = '#d9dde3';
      rr(c, 12, -9, 14, 18, 3);
      c.fill();
      const g = c.createLinearGradient(0, -12, 0, 12);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#eef0f3');
      g.addColorStop(1, '#c7ccd4');
      c.fillStyle = g;
      rr(c, 26, -12, 104, 24, 7);
      c.fill();
      c.fillStyle = pen.color;
      rr(c, 96, -12.5, 38, 25, 8);
      c.fill();
    }
    c.restore();
  }

  function drawPaper(c: CanvasRenderingContext2D, scroll: number) {
    if (look.id === 'marker') {
      c.strokeStyle = 'rgba(80,120,190,0.13)';
      c.lineWidth = 1.2;
      const step = 46;
      const off = -((scroll % step) + step) % step;
      c.beginPath();
      for (let y = 96 + off; y < VH; y += step) {
        c.moveTo(0, y);
        c.lineTo(VW, y);
      }
      c.stroke();
      c.strokeStyle = 'rgba(214,70,70,0.25)';
      c.beginPath();
      c.moveTo(70, 0);
      c.lineTo(70, VH);
      c.stroke();
    } else if (look.id === 'exam') {
      const step = 32;
      const off = -((scroll % step) + step) % step;
      c.strokeStyle = 'rgba(60,110,180,0.09)';
      c.lineWidth = 1;
      c.beginPath();
      for (let y = off; y < VH; y += step) {
        c.moveTo(0, y);
        c.lineTo(VW, y);
      }
      for (let x = 16; x < VW; x += step) {
        c.moveTo(x, 0);
        c.lineTo(x, VH);
      }
      c.stroke();
    }
  }

  function drawCaption(c: CanvasRenderingContext2D, t: number) {
    const idx = sceneIndexAt(tl, t);
    const st = tl.scenes[idx];
    if (!st || !st.say) return;
    const a = Math.min(clamp01((t - st.start) / 0.25), st.index === tl.scenes.length - 1 ? 1 : clamp01((st.end - t) / 0.2));
    if (a <= 0) return;
    const px = 25;
    const font = `500 ${px}px ${SANS}`;
    measure.font = font;
    // Long narration pages through two-line chunks in time with the speech, instead of being squeezed.
    const shown = wrapCached(sceneCaptionAt(st, t), font, 1040).slice(0, 2);
    c.save();
    c.globalAlpha = a;
    c.font = font;
    const widths = shown.map((l) => Math.min(1040, c.measureText(l).width));
    const bw = Math.max(...widths) + 44;
    const lh = px * 1.38;
    const bh = shown.length * lh + 20;
    const bx = VW / 2 - bw / 2;
    const by = VH - 22 - bh;
    rr(c, bx, by, bw, bh, 12);
    c.fillStyle = 'rgba(8,10,14,0.74)';
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    shown.forEach((l, i) => c.fillText(l, VW / 2, by + 10 + lh * (i + 0.5), 1040));
    c.restore();
  }

  const wrapMemo = new Map<string, string[]>();
  function wrapCached(text: string, font: string, maxW: number): string[] {
    const key = `${font}|${maxW}|${text}`;
    let v = wrapMemo.get(key);
    if (!v) {
      measure.font = font;
      v = [];
      let line = '';
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure.measureText(next).width > maxW) {
          v.push(line);
          line = word;
        } else line = next;
      }
      if (line) v.push(line);
      wrapMemo.set(key, v);
    }
    return v;
  }

  function draw(tIn: number) {
    const t = Math.max(0, Math.min(tl.duration, Number.isFinite(tIn) ? tIn : 0));
    const c = ctx!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.drawImage(bg, 0, 0, W, H);
    c.setTransform(u, 0, 0, u, ox, oy);
    const scrolls = groups.map((g) => scrollAt(g, t));
    if (look.engine === 'board') drawPaper(c, scrolls[0] ?? 0);
    let active: PenAt | null = null;
    let resting: { pen: PenAt; at: number } | null = null;
    let currentGroup = -2;
    for (const it of items) {
      if (it.group !== currentGroup) {
        if (currentGroup !== -2) c.restore();
        c.save();
        currentGroup = it.group;
        const g = groups[it.group];
        if (g?.clip) {
          c.beginPath();
          c.rect(...g.clip);
          c.clip();
        }
      }
      const pen = drawItem(c, it, t, it.group >= 0 ? (scrolls[it.group] ?? 0) : 0);
      if (pen) active = pen;
      else if (it.pen && look.pen && !reduced && t > it.t1 && t < it.t1 + 0.3 && t >= it.from && (!resting || it.t1 > resting.at)) {
        // Just finished: let the pen linger a moment at the end of the stroke instead of vanishing.
        const end = endPoint(it, it.group >= 0 ? (scrolls[it.group] ?? 0) : 0);
        if (end) resting = { pen: { ...end, color: it.pen, alpha: 1 - (t - it.t1) / 0.3 }, at: it.t1 };
      }
    }
    if (currentGroup !== -2) c.restore();
    if (look.pen && !reduced) {
      const p = active ?? resting?.pen ?? null;
      if (p) drawPen(c, p, t);
    }
    if (burnCaptions) drawCaption(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  function endPoint(it: Item, scroll: number): { x: number; y: number } | null {
    if (it.k === 'sprite') {
      const s = it.s;
      return { x: it.x + s.w * it.scale, y: it.y + (s.ink[s.ink.length - 1] ?? s.h / 2) * it.scale - scroll };
    }
    if (it.k === 'path') {
      const pl = it.polys[it.polys.length - 1];
      if (!pl || pl.length < 2) return null;
      return { x: pl[pl.length - 2]!, y: pl[pl.length - 1]! - scroll };
    }
    return null;
  }

  draw(0);
  return { canvas, duration: tl.duration, timeline: tl, style: tl.style, draw, sceneAt: (t) => sceneIndexAt(tl, t) };
}
