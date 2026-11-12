// Infinite-canvas whiteboard: state, undo, camera, input, chrome and the public Board API.
import './whiteboard.css';
import { icon } from './icons';
import {
  COLOR_TOKENS,
  inflate,
  newId,
  normRect,
  readTheme,
  rectsIntersect,
  resolveColor,
  smoothPoints,
  strokeHit,
  strokeLocalBox,
  union,
  distToSegment,
  type GraphObj,
  type GroupObj,
  type MarkObj,
  type MarkStyle,
  type MathObj,
  type Obj,
  type ObjId,
  type Point,
  type Rect,
  type ShapeKind,
  type ShapeObj,
  type StrokeObj,
  type TextObj,
  type Theme,
} from './model';
import { drawGrid, drawObject, markBounds, measureText, type DrawEnv, type MathImg } from './render';
import { boards, type BoardRecord, type BoardSummary } from './store';

export type { ObjId, Point, Rect, Obj, ShapeKind, MarkStyle, BoardSummary };

export interface PlaceOpts {
  /** Top-left corner in world coordinates. Omitted: `nextSpot`. */
  at?: Point;
  /** Theme token ('ink' | 'muted' | 'accent' | 'warn' | 'blue' | 'plum' | 'ochre'), resolved at draw time, or a literal CSS colour. */
  color?: string;
  /** Text/math: font px in world units. Shapes: stroke width. */
  size?: number;
}

export type Tool = 'select' | 'hand' | 'pen' | 'highlighter' | 'eraser' | 'text' | ShapeKind;

export interface Board {
  addText(text: string, opts?: PlaceOpts): ObjId;
  addMath(tex: string, opts?: PlaceOpts): ObjId;
  addGraph(exprs: string[], opts?: PlaceOpts & { w?: number; h?: number; xRange?: [number, number]; yRange?: [number, number] }): ObjId;
  addShape(
    kind: 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle' | 'numberline' | 'axes',
    opts?: PlaceOpts & { w?: number; h?: number; to?: Point; from?: number; until?: number; label?: string; right?: boolean },
  ): ObjId;
  mark(target: ObjId, style: MarkStyle, opts?: { color?: string }): ObjId;
  group(ids: ObjId[]): ObjId;
  remove(id: ObjId): void;
  move(id: ObjId, by: Point): void;
  /** Scales an object (or a group, with everything in it) by `factor` about its centre. One undo step. */
  scale(id: ObjId, factor: number): void;
  bounds(id: ObjId): Rect | null;
  last(): ObjId | null;
  selection(): ObjId[];
  select(ids: ObjId[]): void;
  nextSpot(w: number, h: number): Point;
  reveal(id: ObjId): void;
  zoomBy(factor: number): void;
  fit(): void;
  undo(): void;
  redo(): void;
  clear(): void;
  exportPng(): Promise<Blob>;
  setCommandText(text: string): void;
  setListening(on: boolean): void;
  status(message: string): void;
  readonly title: string;
  destroy(): void;

  // ---- extras ----
  /** Freehand stroke from world points (flat [x, y, …] or Point[]). Not animated. */
  addStroke(points: Point[] | number[], opts?: { color?: string; size?: number; highlighter?: boolean }): ObjId;
  get(id: ObjId): Obj | undefined;
  /** Every object in paint order (including group children and marks). */
  objects(): Obj[];
  setTool(tool: Tool): void;
  readonly tool: Tool;
  readonly boardId: string;
  camera(): { x: number; y: number; z: number };
  setCamera(cam: { x?: number; y?: number; z?: number }): void;
  toScreen(p: Point): Point;
  toWorld(p: Point): Point;
  rename(title: string): void;
  newBoard(title?: string): Promise<void>;
  openBoard(id: string): Promise<void>;
  listBoards(): Promise<BoardSummary[]>;
  deleteBoard(id: string): Promise<void>;
  /** Saves now (autosave is debounced). */
  flush(): Promise<void>;
  /**
   * Resolves once the saved board has been loaded, or storage has been found unavailable. Usually already
   * settled when createWhiteboard returns; later only when IndexedDB was slow to answer.
   */
  whenLoaded(): Promise<void>;
  /** Resolves when pending math typesetting has finished. */
  ready(): Promise<void>;
  /** Renders synchronously and returns the time in ms (flushes the canvas when `flush`). */
  renderNow(flush?: boolean): number;
  readonly stats: { frames: number[]; lastFrameMs: number; pendingTiles: number };
}

type Cam = { x: number; y: number; z: number };
interface Change {
  id: string;
  before: Obj | null;
  after: Obj | null;
}

/** How long opening waits for storage before showing an empty in-memory board. */
const LOAD_GRACE_MS = 600;
const MIN_Z = 0.1;
const MAX_Z = 8;
const GAP = 28;
const WIDTHS = { pen: [2, 4, 8], highlighter: [14, 24, 36], shape: [2, 3.5, 6] };
const SHAPE_DEFAULTS: Record<ShapeKind, [number, number]> = {
  rect: [200, 120],
  ellipse: [200, 130],
  triangle: [180, 150],
  line: [200, 0],
  arrow: [200, 0],
  numberline: [480, 70],
  axes: [320, 320],
};
const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', p: 'pen', m: 'highlighter', e: 'eraser', t: 'text', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow' };
const TOOL_LABEL: Record<Tool, string> = {
  select: 'Select (V)',
  hand: 'Hand (H)',
  pen: 'Pen (P)',
  highlighter: 'Highlighter (M)',
  eraser: 'Eraser (E)',
  text: 'Text (T)',
  rect: 'Rectangle (R)',
  ellipse: 'Ellipse (O)',
  line: 'Line (L)',
  arrow: 'Arrow (A)',
  triangle: 'Triangle',
  numberline: 'Number line',
  axes: 'Axes',
};
const COLOR_LABEL: Record<string, string> = { ink: 'Ink', accent: 'Accent', warn: 'Warm', blue: 'Blue', plum: 'Plum', ochre: 'Ochre' };

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function relTime(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let exportMod: Promise<typeof import('../lesson/export')> | null = null;
let katexFonts: Promise<void> | null = null;
/**
 * Loads the export module, then waits (briefly) for the KaTeX web fonts: typesetting measures the formula in
 * the document, and measuring with fallback fonts gives a box that clips the formula once the real fonts draw.
 */
const loadExport = () =>
  (exportMod ??= import('../lesson/export').then(async (m) => {
    katexFonts ??= Promise.race([
      Promise.all(
        ['20px KaTeX_Main', 'bold 20px KaTeX_Main', 'italic 20px KaTeX_Math', '20px KaTeX_AMS', '20px KaTeX_Size1', '20px KaTeX_Size2'].map((f) =>
          document.fonts.load(f, 'x=4').catch(() => []),
        ),
      ).then(() => undefined),
      new Promise<void>((r) => setTimeout(r, 3000)),
    ]);
    await katexFonts;
    return m;
  }));

export async function createWhiteboard(
  container: HTMLElement,
  opts: { onCommand(text: string): void; onMic(): void; onClose?(): void; boardId?: string },
): Promise<Board> {
  // ---------- DOM ----------
  const root = document.createElement('div');
  root.className = 'wb-root';
  root.dataset.tool = 'pen';
  const shapeMore: ShapeKind[] = ['triangle', 'numberline', 'axes'];
  root.innerHTML = `
    <canvas class="wb-canvas" aria-label="Whiteboard canvas" role="img"></canvas>
    <textarea class="wb-editor" hidden spellcheck="false" aria-label="Edit text"></textarea>
    <div class="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
      <div class="wb-group">
        ${(['select', 'hand', 'pen', 'highlighter', 'eraser', 'text'] as Tool[]).map((t) => toolBtn(t)).join('')}
      </div>
      <span class="wb-sep"></span>
      <div class="wb-group">
        ${(['rect', 'ellipse', 'line', 'arrow'] as Tool[]).map((t) => toolBtn(t)).join('')}
        <div class="wb-more">
          <button type="button" class="wb-btn wb-more-btn" data-more aria-haspopup="true" aria-expanded="false" title="More shapes">${icon('more')}</button>
          <div class="wb-pop wb-more-menu" role="menu" hidden>
            ${shapeMore.map((t) => `<button type="button" role="menuitem" class="wb-menuitem" data-tool="${t}">${icon(t)}<span>${TOOL_LABEL[t]}</span></button>`).join('')}
          </div>
        </div>
      </div>
      <span class="wb-sep"></span>
      <div class="wb-group wb-swatches" role="radiogroup" aria-label="Colour">
        ${COLOR_TOKENS.map((c) => `<button type="button" class="wb-swatch" role="radio" data-color="${c}" title="${COLOR_LABEL[c]}" aria-label="${COLOR_LABEL[c]}"><span></span></button>`).join('')}
      </div>
      <span class="wb-sep"></span>
      <div class="wb-group" role="radiogroup" aria-label="Stroke width">
        ${[0, 1, 2].map((i) => `<button type="button" class="wb-btn wb-width" role="radio" data-width="${i}" title="${['Thin', 'Medium', 'Thick'][i]}" aria-label="${['Thin', 'Medium', 'Thick'][i]}"><span style="--d:${[3, 6, 10][i]}px"></span></button>`).join('')}
      </div>
      <span class="wb-sep wb-sep-history"></span>
      <div class="wb-group wb-history">
        <button type="button" class="wb-btn" data-act="undo" title="Undo (${isMac ? '⌘' : 'Ctrl+'}Z)" aria-label="Undo">${icon('undo')}</button>
        <button type="button" class="wb-btn" data-act="redo" title="Redo (${isMac ? '⇧⌘' : 'Ctrl+Shift+'}Z)" aria-label="Redo">${icon('redo')}</button>
      </div>
    </div>
    <div class="wb-topright">
      <div class="wb-panel wb-zoom">
        <button type="button" class="wb-btn" data-act="zoom-out" title="Zoom out (−)" aria-label="Zoom out">${icon('minus')}</button>
        <button type="button" class="wb-btn wb-zoom-pct" data-act="zoom-reset" title="Reset to 100%" aria-label="Zoom level">100%</button>
        <button type="button" class="wb-btn" data-act="zoom-in" title="Zoom in (+)" aria-label="Zoom in">${icon('plus')}</button>
        <button type="button" class="wb-btn" data-act="fit" title="Zoom to fit (⇧1)" aria-label="Zoom to fit">${icon('fit')}</button>
      </div>
      <div class="wb-panel wb-boardbar">
        <button type="button" class="wb-btn" data-act="export" title="Export PNG" aria-label="Export PNG">${icon('export')}</button>
        <button type="button" class="wb-btn wb-boards-btn" data-act="boards" aria-haspopup="true" aria-expanded="false" title="Boards"><span class="wb-title"></span>${icon('boards')}</button>
      </div>
      ${opts.onClose ? `<button type="button" class="wb-done" data-act="close" title="Close the whiteboard (Esc). Your board is saved." aria-label="Close whiteboard">${icon('close')}<span>Done</span></button>` : ''}
      <div class="wb-pop wb-boards" hidden>
        <div class="wb-boards-head">
          <input class="wb-rename" type="text" aria-label="Board title" maxlength="80" />
        </div>
        <ul class="wb-board-list" aria-label="Boards"></ul>
        <button type="button" class="wb-menuitem wb-new-board" data-act="new-board">${icon('plus')}<span>New board</span></button>
        <p class="wb-boards-err" hidden></p>
      </div>
    </div>
    <form class="wb-command" autocomplete="off">
      <div class="wb-command-row">
        <input class="wb-command-input" type="text" enterkeyhint="go" aria-label="Command" placeholder="Say or type: solve 2x + 3 = 11 and circle the answer" />
        <button type="button" class="wb-mic" aria-label="Speak a command" aria-pressed="false" title="Speak">${icon('mic')}</button>
      </div>
      <div class="wb-status" role="status" aria-live="polite"></div>
    </form>`;
  function toolBtn(t: Tool): string {
    return `<button type="button" class="wb-btn" data-tool="${t}" title="${TOOL_LABEL[t]}" aria-label="${TOOL_LABEL[t]}" aria-pressed="false">${icon(t)}</button>`;
  }
  container.append(root);

  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('.wb-canvas');
  const ctx = canvas.getContext('2d')!;
  const editor = q<HTMLTextAreaElement>('.wb-editor');
  const cmdForm = q<HTMLFormElement>('.wb-command');
  const cmdInput = q<HTMLInputElement>('.wb-command-input');
  const micBtn = q<HTMLButtonElement>('.wb-mic');
  const statusEl = q<HTMLElement>('.wb-status');
  // Stays up (unlike status messages) while the board can't be saved.
  const noticeEl = document.createElement('div');
  noticeEl.className = 'wb-notice';
  noticeEl.setAttribute('role', 'alert');
  noticeEl.hidden = true;
  root.append(noticeEl);
  const zoomPct = q<HTMLButtonElement>('.wb-zoom-pct');
  const moreBtn = q<HTMLButtonElement>('[data-more]');
  const moreMenu = q<HTMLElement>('.wb-more-menu');
  const boardsBtn = q<HTMLButtonElement>('[data-act="boards"]');
  const boardsPop = q<HTMLElement>('.wb-boards');
  const boardList = q<HTMLUListElement>('.wb-board-list');
  const renameInput = q<HTMLInputElement>('.wb-rename');
  const titleEl = q<HTMLElement>('.wb-title');
  const boardsErr = q<HTMLElement>('.wb-boards-err');

  // ---------- state ----------
  let theme: Theme = readTheme(root);
  let objs: Obj[] = [];
  const byId = new Map<string, Obj>();
  let zNext = 1;
  let history: Change[][] = [];
  let future: Change[][] = [];
  let tx: Map<string, Change> | null = null;
  let cam: Cam = { x: -80, y: -80, z: 1 };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let tool: Tool = 'pen';
  let color = 'ink';
  let widthIdx = 1;
  let selected = new Set<string>();
  const born = new Map<string, number>();
  let lastPlaced: string | null = null;
  let lastAdded: string | null = null;
  let destroyed = false;
  let rec: BoardRecord = { id: newId(), title: 'Untitled board', createdAt: Date.now(), updatedAt: Date.now(), count: 0, objects: [] };
  let persist = true;
  let hiddenId: string | null = null; // object being edited in the textarea
  const stats = { frames: [] as number[], lastFrameMs: 0, pendingTiles: 0 };

  const reduced = () => {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm';
    } catch {
      return false;
    }
  };

  // ---------- object store ----------
  function indexOf(o: Obj): number {
    let lo = 0;
    let hi = objs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (objs[mid]!.z < o.z) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < objs.length && objs[i]!.z === o.z; i++) if (objs[i]!.id === o.id) return i;
    return objs.findIndex((x) => x.id === o.id);
  }
  function insert(o: Obj): void {
    let lo = 0;
    let hi = objs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (objs[mid]!.z <= o.z) lo = mid + 1;
      else hi = mid;
    }
    objs.splice(lo, 0, o);
  }
  function rawPut(o: Obj): void {
    const old = byId.get(o.id);
    if (old) dirtyObj(old.id);
    if (old) {
      const i = indexOf(old);
      if (old.z === o.z && i >= 0) objs[i] = o;
      else {
        if (i >= 0) objs.splice(i, 1);
        insert(o);
      }
    } else insert(o);
    byId.set(o.id, o);
    if (o.kind === 'mark') marksByTarget = null;
    dirtyObj(o.id);
    if (o.z >= zNext) zNext = Math.floor(o.z) + 1;
  }
  function rawDel(id: string): void {
    const old = byId.get(id);
    if (!old) return;
    dirtyObj(id);
    if (old.kind === 'mark') marksByTarget = null;
    const i = indexOf(old);
    if (i >= 0) objs.splice(i, 1);
    byId.delete(id);
    selected.delete(id);
    born.delete(id);
  }
  /** Records and applies a change inside the current transaction. */
  function set(id: string, after: Obj | null): void {
    const before = byId.get(id) ?? null;
    if (tx) {
      const c = tx.get(id);
      if (c) c.after = after;
      else tx.set(id, { id, before, after });
    }
    if (after) rawPut(after);
    else rawDel(id);
  }
  function edit<T>(fn: () => T): T {
    const outer = tx;
    if (!outer) tx = new Map();
    try {
      return fn();
    } finally {
      if (!outer) commitTx();
    }
  }
  /** Closes the open transaction as one undo step. */
  function commitTx(): void {
    if (!tx) return;
    const changes = [...tx.values()].filter((c) => c.before !== c.after);
    tx = null;
    if (changes.length) {
      history.push(changes);
      if (history.length > 300) history.shift();
      future = [];
    }
    changed();
  }
  function applyStep(step: Change[], dir: 'undo' | 'redo'): void {
    const list = dir === 'undo' ? [...step].reverse() : step;
    for (const c of list) {
      const o = dir === 'undo' ? c.before : c.after;
      if (o) rawPut(o);
      else rawDel(c.id);
    }
  }
  function changed(): void {
    for (const id of selected) if (!byId.has(id)) selected.delete(id);
    invalidate(true);
    scheduleSave();
    syncChrome();
  }

  // ---------- bounds ----------
  const bcache = new WeakMap<Obj, Rect>();
  const mathRatio = new Map<string, { w: number; h: number }>();
  function boundsOf(id: string, depth = 0): Rect | null {
    const o = byId.get(id);
    if (!o || depth > 8) return null;
    if (o.kind === 'mark') {
      const t = boundsOf(o.target, depth + 1);
      return t ? markBounds(o.style, t) : null;
    }
    if (o.kind === 'group') {
      let r: Rect | null = null;
      for (const c of o.children) r = union(r, boundsOf(c, depth + 1));
      return r;
    }
    if (o.kind === 'math') {
      const k = mathRatio.get(o.tex);
      return k ? { x: o.x, y: o.y, w: k.w * o.size, h: k.h * o.size } : { x: o.x, y: o.y, w: Math.max(1, o.tex.length) * o.size * 0.42, h: o.size * 1.3 };
    }
    let r = bcache.get(o);
    if (r) return r;
    switch (o.kind) {
      case 'stroke': {
        const b = strokeLocalBox(o.pts);
        r = inflate({ x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h }, o.size / 2);
        break;
      }
      case 'text': {
        const m = measureText(o, theme);
        r = { x: o.x, y: o.y, w: m.w, h: m.h };
        break;
      }
      case 'graph':
        r = { x: o.x, y: o.y, w: o.w, h: o.h };
        break;
      case 'shape': {
        r = normRect(o.x, o.y, o.w, o.h);
        if (o.shape === 'line' || o.shape === 'arrow') r = inflate(r, Math.max(o.size * 2, 6));
        if (o.shape === 'numberline' && o.label) r = { ...r, y: r.y - 26, h: r.h + 26 };
        break;
      }
    }
    bcache.set(o, r);
    return r;
  }
  const topOf = (id: string): string => {
    let o = byId.get(id);
    for (let i = 0; o?.parent && i < 8; i++) {
      const p = byId.get(o.parent);
      if (!p) break;
      o = p;
    }
    return o?.id ?? id;
  };
  function minZ(id: string, depth = 0): number {
    const o = byId.get(id);
    if (!o) return 0;
    if (o.kind === 'group' && depth < 8) return Math.min(...o.children.map((c) => minZ(c, depth + 1)), o.z);
    return o.z;
  }

  // ---------- math images ----------
  const mathImgs = new Map<string, MathImg>();
  const mathAny = new Map<string, MathImg>();
  const mathPending = new Map<string, Promise<void>>();
  function mathLevel(pxPerWorld: number): number {
    const lv = 2 ** Math.ceil(Math.log2(Math.max(0.25, pxPerWorld / 2)));
    return Math.min(4, Math.max(0.5, lv));
  }
  function requestMath(o: MathObj, pxPerWorld: number): { key: string; ready: MathImg | undefined; promise: Promise<void> | undefined } {
    const col = resolveColor(o.color, theme);
    const fontPx = Math.min(480, Math.max(6, Math.round(o.size * mathLevel(pxPerWorld) * 4) / 4));
    const key = `${fontPx}|${col}|${o.tex}`;
    const ready = mathImgs.get(key);
    if (ready) return { key, ready, promise: undefined };
    let p = mathPending.get(key);
    if (!p) {
      p = loadExport()
        // Braces stop KaTeX from line-breaking after relations, which would clip the image.
        .then((m) => m.renderMathImage(`{${o.tex}}`, fontPx, col))
        .then((r) => {
          const img: MathImg = { img: r.img, w: r.w, h: r.h, pad: r.pad, plain: r.plain, fontPx };
          mathImgs.set(key, img);
          mathAny.set(`${col}|${o.tex}`, img);
          dirtyTex(o.tex);
          mathRatio.set(o.tex, { w: r.w / fontPx, h: r.h / fontPx });
        })
        .catch(() => {
          const img: MathImg = { img: null, w: o.tex.length * fontPx * 0.5, h: fontPx * 1.2, pad: 0, plain: o.tex, fontPx };
          mathImgs.set(key, img);
        })
        .finally(() => {
          mathPending.delete(key);
          dirtyTex(o.tex);
          if (!destroyed) invalidate(true);
        });
      mathPending.set(key, p);
    }
    return { key, ready: undefined, promise: p };
  }
  function dirtyTex(tex: string): void {
    for (const m of objs) if (m.kind === 'math' && m.tex === tex) dirtyObj(m.id);
  }
  const mathFor = (pxPerWorld: number) => (o: MathObj): MathImg | undefined => {
    const r = requestMath(o, pxPerWorld);
    return r.ready ?? mathAny.get(`${resolveColor(o.color, theme)}|${o.tex}`);
  };

  // ---------- camera ----------
  const viewRect = (): Rect => ({ x: cam.x, y: cam.y, w: W / cam.z, h: H / cam.z });
  const toScreen = (p: Point): Point => ({ x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z });
  const toWorld = (p: Point): Point => ({ x: p.x / cam.z + cam.x, y: p.y / cam.z + cam.y });
  let camAnim: { from: Cam; to: Cam; t0: number; dur: number } | null = null;
  function setCam(c: Cam): void {
    cam = { x: c.x, y: c.y, z: Math.min(MAX_Z, Math.max(MIN_Z, c.z)) };
    zoomPct.textContent = `${Math.round(cam.z * 100)}%`;
    if (hiddenId || editing) positionEditor();
    invalidate(true);
  }
  function zoomAt(factor: number, sx: number, sy: number): void {
    camAnim = null;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, cam.z * factor));
    const w = toWorld({ x: sx, y: sy });
    setCam({ x: w.x - sx / z, y: w.y - sy / z, z });
  }
  function animateTo(to: Cam): void {
    if (reduced()) {
      camAnim = null;
      setCam(to);
      return;
    }
    camAnim = { from: { ...cam }, to, t0: performance.now(), dur: 340 };
    invalidate(true);
  }
  function camFor(r: Rect, maxZ: number, margin = 64): Cam {
    const z = Math.min(maxZ, MAX_Z, Math.max(MIN_Z, Math.min((W - margin * 2) / Math.max(r.w, 1), (H - margin * 2 - 70) / Math.max(r.h, 1))));
    return { z, x: r.x + r.w / 2 - W / 2 / z, y: r.y + r.h / 2 - (H - 70) / 2 / z };
  }
  function contentBounds(): Rect | null {
    let r: Rect | null = null;
    for (const o of objs) if (o.kind !== 'group') r = union(r, boundsOf(o.id));
    return r;
  }

  // ---------- rendering ----------
  // Committed objects are drawn into 256-device-px tiles per power-of-two zoom level and cached, so pan and
  // zoom only composite bitmaps. Missing tiles render within a per-frame time budget (a coarser or finer
  // cached level stands in meanwhile). Edits invalidate only the tiles under the changed bounds.
  const TILE = 256;
  const FRAME_BUDGET_MS = 9;
  interface Tile {
    c: HTMLCanvasElement;
    x: CanvasRenderingContext2D;
    r: Rect;
    used: number;
  }
  const tiles = new Map<string, Tile>();
  const pool: Tile[] = [];
  let frameNo = 0;
  let marksByTarget: Map<string, string[]> | null = null;
  let raf = 0;
  function invalidate(_scene = false): void {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }
  function marksOn(id: string): string[] | undefined {
    if (!marksByTarget) {
      marksByTarget = new Map();
      for (const o of objs) if (o.kind === 'mark') marksByTarget.get(o.target)?.push(o.id) ?? marksByTarget.set(o.target, [o.id]);
    }
    return marksByTarget.get(id);
  }
  function dirtyRect(r: Rect | null): void {
    if (!r || !tiles.size) return;
    const d = inflate(r, 3);
    for (const [key, t] of tiles) if (rectsIntersect(t.r, d)) {
      tiles.delete(key);
      pool.push(t);
    }
  }
  /**
   * Invalidates the tiles under an object and under every mark whose shape depends on it: marks on the object,
   * on any group it belongs to (however deeply nested), and marks on those marks. Called with the old state
   * before a change and the new state after, so both the old and the new mark outlines are repainted.
   */
  function dirtyObj(id: string): void {
    if (!tiles.size) return;
    const o = byId.get(id);
    if (!o) return;
    if (o.kind !== 'group') dirtyRect(boundsOf(id));
    const marksAround = (target: string, depth: number) => {
      if (depth > 8) return;
      for (const m of marksOn(target) ?? []) {
        const b = boundsOf(m);
        if (b) dirtyRect(inflate(b, 24));
        marksAround(m, depth + 1);
      }
    };
    let cur: Obj | undefined = o;
    for (let d = 0; cur && d < 9; d++) {
      marksAround(cur.id, 0);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
  }
  function dirtyAll(): void {
    for (const t of tiles.values()) pool.push(t);
    tiles.clear();
  }
  function resize(): boolean {
    // Layout size, not the on-screen box: the board opens with a slight zoom that mustn't size the canvas.
    const d = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, root.offsetWidth);
    const h = Math.max(1, root.offsetHeight);
    if (w === W && h === H && d === dpr) return false;
    if (d !== dpr) dirtyAll();
    W = w;
    H = h;
    dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    return true;
  }
  function env(c: CanvasRenderingContext2D, px: number): DrawEnv {
    return { ctx: c, theme, px, boundsOf: (id) => boundsOf(id), math: mathFor(px) };
  }
  const tileKey = (k: number, tx: number, ty: number) => `${k}:${tx}:${ty}`;
  const tileWorld = (k: number) => TILE / 2 ** k;
  let frameCandidates: Obj[] | null = null;
  function renderTile(k: number, tx: number, ty: number): Tile {
    const s = 2 ** k;
    const tw = tileWorld(k);
    const r = { x: tx * tw, y: ty * tw, w: tw, h: tw };
    let t = pool.pop();
    if (!t) {
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      t = { c, x: c.getContext('2d')!, r, used: 0 };
    }
    t.r = r;
    t.used = frameNo;
    const x = t.x;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, TILE, TILE);
    x.setTransform(s, 0, 0, s, -r.x * s, -r.y * s);
    const e = env(x, s);
    const cull = inflate(r, 1 / s);
    if (!frameCandidates) {
      const v = inflate(viewRect(), tileWorld(k));
      frameCandidates = [];
      for (const o of objs) {
        if (o.kind === 'group' || o.id === hiddenId || born.has(o.id)) continue;
        const b = boundsOf(o.id);
        if (b && rectsIntersect(b, v)) frameCandidates.push(o);
      }
    }
    for (const o of frameCandidates) {
      const b = boundsOf(o.id);
      if (b && rectsIntersect(b, cull)) drawObject(e, o, 1);
    }
    tiles.set(tileKey(k, tx, ty), t);
    return t;
  }
  /** Draws a cached tile (or part of one) onto the device-pixel rect of world rect `wr`. */
  function blit(t: Tile, wr: Rect, p: number): void {
    const s = TILE / t.r.w;
    const sx = (wr.x - t.r.x) * s;
    const sy = (wr.y - t.r.y) * s;
    const x0 = Math.round((wr.x - cam.x) * p);
    const y0 = Math.round((wr.y - cam.y) * p);
    const x1 = Math.round((wr.x + wr.w - cam.x) * p);
    const y1 = Math.round((wr.y + wr.h - cam.y) * p);
    if (x1 > x0 && y1 > y0) ctx.drawImage(t.c, sx, sy, wr.w * s, wr.h * s, x0, y0, x1 - x0, y1 - y0);
  }
  /** A stand-in for a missing tile from another zoom level; true when one was drawn. */
  function fallback(k: number, tx: number, ty: number, wr: Rect, p: number): boolean {
    for (let d = 1; d <= 4; d++) {
      const f = 2 ** d;
      const t = tiles.get(tileKey(k - d, Math.floor(tx / f), Math.floor(ty / f)));
      if (t) {
        blit(t, wr, p);
        return true;
      }
    }
    const kids: Tile[] = [];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const t = tiles.get(tileKey(k + 1, tx * 2 + i, ty * 2 + j));
        if (!t) return false;
        kids.push(t);
      }
    for (const t of kids) blit(t, t.r, p);
    return true;
  }
  /** Composites the visible tiles; returns true while some still need rendering. */
  function renderScene(budgetEnd: number): boolean {
    frameNo++;
    frameCandidates = null;
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, canvas.width, canvas.height);
    const p = dpr * cam.z;
    c.setTransform(p, 0, 0, p, -cam.x * p, -cam.y * p);
    const view = viewRect();
    drawGrid(c, theme, view, cam.z);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const k = Math.max(-6, Math.min(6, Math.ceil(Math.log2(p) - 1e-9)));
    const tw = tileWorld(k);
    const tx0 = Math.floor(view.x / tw);
    const ty0 = Math.floor(view.y / tw);
    const tx1 = Math.floor((view.x + view.w) / tw);
    const ty1 = Math.floor((view.y + view.h) / tw);
    let pending = 0;
    let rendered = 0;
    let anyContent: boolean | null = null;
    const need: [number, number][] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) need.push([tx, ty]);
    // Render from the centre outwards so the middle of the screen fills in first.
    const cx = (tx0 + tx1) / 2;
    const cy = (ty0 + ty1) / 2;
    need.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    for (const [tx, ty] of need) {
      const wr = { x: tx * tw, y: ty * tw, w: tw, h: tw };
      let t = tiles.get(tileKey(k, tx, ty));
      if (!t) {
        if (anyContent === null) anyContent = objs.length > 0;
        if (!anyContent) continue;
        if (rendered === 0 || performance.now() < budgetEnd) {
          t = renderTile(k, tx, ty);
          rendered++;
        } else {
          pending++;
          fallback(k, tx, ty, wr, p);
          continue;
        }
      }
      t.used = frameNo;
      blit(t, wr, p);
    }
    // Evict least recently used tiles beyond a cap that comfortably covers two screens.
    const cap = Math.max(200, need.length * 3);
    if (tiles.size > cap) {
      const old = [...tiles.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [key, t] of old.slice(0, tiles.size - cap)) {
        if (t.used === frameNo) break;
        tiles.delete(key);
        if (pool.length < 64) pool.push(t);
      }
    }
    stats.pendingTiles = pending;
    return pending > 0;
  }
  /** Objects animating in are drawn live on top of the tiles. Returns true while any animation runs. */
  function renderLive(now: number): boolean {
    if (!born.size) return false;
    const p = dpr * cam.z;
    ctx.setTransform(p, 0, 0, p, -cam.x * p, -cam.y * p);
    const e = env(ctx, p);
    let running = false;
    for (const o of objs) {
      const t0 = born.get(o.id);
      if (t0 === undefined) continue;
      const u = Math.min(1, (now - t0) / (o.kind === 'mark' ? 520 : 420));
      if (u >= 1) {
        born.delete(o.id);
        dirtyObj(o.id);
        running = true; // one more frame so the tiles pick it up
        continue;
      }
      running = true;
      drawObject(e, o, u);
    }
    return running;
  }
  function renderOverlay(): void {
    const c = ctx;
    const k = dpr * cam.z;
    c.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    // Live stroke
    if (live && live.pts.length >= 3) {
      c.save();
      c.strokeStyle = resolveColor(live.color, theme);
      c.lineWidth = live.size;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      if (live.highlighter) {
        c.globalAlpha = theme.dark ? 0.32 : 0.38;
        if (!theme.dark) c.globalCompositeOperation = 'multiply';
      }
      c.beginPath();
      const p = live.pts;
      c.moveTo(p[0]!, p[1]!);
      for (let i = 3; i < p.length; i += 3) c.lineTo(p[i]!, p[i + 1]!);
      if (p.length === 3) c.lineTo(p[0]! + 0.01, p[1]!);
      c.stroke();
      c.restore();
    }
    if (preview) drawObject(env(c, k), preview, 1);
    // Selection
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = theme.accent;
    c.lineWidth = 1.5;
    for (const id of selected) {
      const b = boundsOf(id);
      if (!b) continue;
      const s = toScreen(b);
      c.strokeRect(Math.round(s.x - 4) + 0.5, Math.round(s.y - 4) + 0.5, Math.round(b.w * cam.z + 8), Math.round(b.h * cam.z + 8));
    }
    for (const h of handles()) {
      c.fillStyle = theme.surface;
      c.beginPath();
      c.roundRect(h.x - 5, h.y - 5, 10, 10, 2);
      c.fill();
      c.stroke();
    }
    if (marquee) {
      const a = toScreen(marquee.a);
      const b = toScreen(marquee.b);
      const r = normRect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.globalAlpha = 0.08;
      c.fillStyle = theme.accent;
      c.fillRect(r.x, r.y, r.w, r.h);
      c.globalAlpha = 1;
      c.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
    if (eraserAt) {
      c.strokeStyle = theme.muted;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(eraserAt.x, eraserAt.y, ERASE_PX, 0, Math.PI * 2);
      c.stroke();
    }
  }
  function frame(now: number): void {
    raf = 0;
    if (destroyed) return;
    const t0 = performance.now();
    if (resize()) positionEditor();
    if (camAnim) {
      const u = Math.min(1, (now - camAnim.t0) / camAnim.dur);
      const e = 1 - (1 - u) ** 3;
      const { from, to } = camAnim;
      // Interpolate zoom geometrically, centre linearly.
      const z = from.z * (to.z / from.z) ** e;
      const fc = { x: from.x + W / 2 / from.z, y: from.y + H / 2 / from.z };
      const tc = { x: to.x + W / 2 / to.z, y: to.y + H / 2 / to.z };
      const cx = fc.x + (tc.x - fc.x) * e;
      const cy = fc.y + (tc.y - fc.y) * e;
      setCam({ x: cx - W / 2 / z, y: cy - H / 2 / z, z });
      if (u >= 1) camAnim = null;
    }
    let again = !!camAnim;
    if (renderScene(t0 + FRAME_BUDGET_MS)) again = true;
    if (renderLive(now)) again = true;
    renderOverlay();
    stats.lastFrameMs = performance.now() - t0;
    stats.frames.push(stats.lastFrameMs);
    if (stats.frames.length > 240) stats.frames.shift();
    if (again) invalidate();
  }
  function renderNow(flush = false): number {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const t0 = performance.now();
    frame(performance.now());
    if (flush) ctx.getImageData(0, 0, 1, 1);
    return performance.now() - t0;
  }

  // ---------- theme ----------
  let themeRaf = 0;
  function refreshTheme(): void {
    if (themeRaf) return;
    themeRaf = requestAnimationFrame(() => {
      themeRaf = 0;
      const next = readTheme(root);
      if (JSON.stringify(next) === JSON.stringify(theme)) return;
      const fontChanged = next.sans !== theme.sans;
      theme = next;
      if (fontChanged) for (const o of objs) if (o.kind === 'text') bcache.delete(o);
      dirtyAll();
      syncChrome();
      invalidate(true);
    });
  }
  const mo = new MutationObserver(refreshTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class', 'data-look'] });
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', refreshTheme);

  // ---------- placement ----------
  function nextSpot(w: number, h: number): Point {
    const view = viewRect();
    const lastB = lastPlaced && byId.has(lastPlaced) ? boundsOf(lastPlaced) : null;
    const p: Point =
      lastB && rectsIntersect(lastB, view)
        ? { x: lastB.x, y: lastB.y + lastB.h + GAP }
        : { x: view.x + view.w / 2 - w / 2, y: view.y + Math.max(view.h * 0.4 - h / 2, 40 / cam.z) };
    const boxes: Rect[] = [];
    for (const o of objs) {
      if (o.kind === 'group') continue;
      const b = boundsOf(o.id);
      if (b) boxes.push(b);
    }
    for (let i = 0; i < 2000; i++) {
      const r = { x: p.x, y: p.y, w, h };
      let bottom = -Infinity;
      for (const b of boxes) if (rectsIntersect(inflate(b, GAP / 2 - 0.01), r)) bottom = Math.max(bottom, b.y + b.h);
      if (bottom === -Infinity) break;
      p.y = bottom + GAP;
    }
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }
  function placed(id: string, animate: boolean): string {
    lastAdded = id;
    const o = byId.get(id);
    if (o && o.kind !== 'mark') lastPlaced = id;
    if (animate && !reduced()) born.set(id, performance.now());
    invalidate(true);
    return id;
  }
  const at = (o: PlaceOpts | undefined, w: number, h: number) => (o?.at ? { x: o.at.x, y: o.at.y } : nextSpot(w, h));

  // ---------- API operations ----------
  function addText(text: string, o?: PlaceOpts): ObjId {
    const size = o?.size ?? 28;
    const m = measureText({ text, size }, theme);
    const p = at(o, m.w, m.h);
    const obj: TextObj = { id: newId(), kind: 'text', z: zNext++, color: o?.color ?? 'ink', x: p.x, y: p.y, text, size };
    edit(() => set(obj.id, obj));
    return placed(obj.id, true);
  }
  function addMath(tex: string, o?: PlaceOpts): ObjId {
    const size = o?.size ?? 36;
    const k = mathRatio.get(tex);
    const w = k ? k.w * size : Math.max(1, tex.length) * size * 0.42;
    const h = k ? k.h * size : size * 1.3;
    const p = at(o, w, h);
    const obj: MathObj = { id: newId(), kind: 'math', z: zNext++, color: o?.color ?? 'ink', x: p.x, y: p.y, tex, size };
    edit(() => set(obj.id, obj));
    requestMath(obj, dpr * cam.z);
    return placed(obj.id, true);
  }
  function addGraph(exprs: string[], o?: PlaceOpts & { w?: number; h?: number; xRange?: [number, number]; yRange?: [number, number] }): ObjId {
    const w = o?.w ?? 480;
    const h = o?.h ?? 320;
    const xRange = o?.xRange ?? [-10, 10];
    const yRange = o?.yRange ?? ([(xRange[0] * h) / w, (xRange[1] * h) / w] as [number, number]);
    const p = at(o, w, h);
    const obj: GraphObj = { id: newId(), kind: 'graph', z: zNext++, color: o?.color ?? 'accent', x: p.x, y: p.y, w, h, exprs: [...exprs], xRange, yRange };
    edit(() => set(obj.id, obj));
    return placed(obj.id, true);
  }
  function addShape(kind: ShapeKind, o?: PlaceOpts & { w?: number; h?: number; to?: Point; from?: number; until?: number; label?: string; right?: boolean }): ObjId {
    const [dw, dh] = SHAPE_DEFAULTS[kind];
    let w = o?.w ?? dw;
    let h = o?.h ?? dh;
    let p: Point;
    if ((kind === 'line' || kind === 'arrow') && o?.to) {
      p = o.at ?? nextSpot(dw, 12);
      w = o.to.x - p.x;
      h = o.to.y - p.y;
    } else p = at(o, Math.abs(w), Math.abs(h) || 12);
    const obj: ShapeObj = {
      id: newId(),
      kind: 'shape',
      shape: kind,
      z: zNext++,
      color: o?.color ?? 'ink',
      x: p.x,
      y: p.y + ((kind === 'line' || kind === 'arrow') && !o?.at && !h ? 6 : 0),
      w,
      h,
      size: o?.size ?? WIDTHS.shape[1]!,
      ...(o?.from !== undefined ? { from: o.from } : {}),
      ...(o?.until !== undefined ? { until: o.until } : {}),
      ...(o?.label ? { label: o.label } : {}),
      ...(o?.right && kind === 'triangle' ? { right: true } : {}),
    };
    edit(() => set(obj.id, obj));
    return placed(obj.id, true);
  }
  function mark(target: ObjId, style: MarkStyle, o?: { color?: string }): ObjId {
    if (!byId.has(target)) throw new Error(`Whiteboard: no object "${target}" to mark`);
    const t = target;
    const z = style === 'highlight' ? minZ(t) - 0.5 + (zNext++ % 1000) * 1e-7 : zNext++;
    const obj: MarkObj = { id: newId(), kind: 'mark', z, color: o?.color ?? 'accent', target: t, style, seed: (Math.random() * 2 ** 31) | 0 };
    edit(() => set(obj.id, obj));
    return placed(obj.id, true);
  }
  function group(ids: ObjId[]): ObjId {
    const tops = [...new Set(ids.filter((id) => byId.has(id)).map(topOf))];
    if (!tops.length) throw new Error('Whiteboard: nothing to group');
    const gid = newId();
    edit(() => {
      for (const id of tops) set(id, { ...byId.get(id)!, parent: gid });
      set(gid, { id: gid, kind: 'group', z: zNext++, color: 'ink', children: tops } satisfies GroupObj);
    });
    return placed(gid, false);
  }
  /**
   * Everything that goes when `ids` go: group contents, groups left empty (up a nested chain), and marks on
   * anything removed (and marks on those marks).
   */
  function killSet(ids: Iterable<string>): Set<string> {
    const kill = new Set<string>();
    const visit = (id: string) => {
      if (kill.has(id) || !byId.has(id)) return;
      kill.add(id);
      const o = byId.get(id)!;
      if (o.kind === 'group') o.children.forEach(visit);
    };
    for (const id of ids) visit(id);
    for (let grew = kill.size > 0; grew; ) {
      grew = false;
      for (const o of objs) {
        if (kill.has(o.id)) continue;
        if ((o.kind === 'mark' && kill.has(o.target)) || (o.kind === 'group' && o.children.every((c) => kill.has(c)))) {
          kill.add(o.id);
          grew = true;
        }
      }
    }
    return kill;
  }
  /** Removes a kill set inside the open transaction, unlinking survivors' groups from what goes. */
  function applyKill(kill: Set<string>): void {
    for (const id of kill) {
      const o = byId.get(id);
      if (o?.parent && !kill.has(o.parent)) {
        const g = byId.get(o.parent);
        if (g?.kind === 'group') set(g.id, { ...g, children: g.children.filter((c) => c !== id) });
      }
    }
    for (const id of kill) set(id, null);
  }
  function removeIds(ids: Iterable<string>): void {
    const kill = killSet(ids);
    if (kill.size) edit(() => applyKill(kill));
  }
  function translated(o: Obj, dx: number, dy: number): Obj {
    if (o.kind === 'mark' || o.kind === 'group') return o;
    return { ...o, x: o.x + dx, y: o.y + dy };
  }
  function movables(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    const visit = (id: string, d: number) => {
      const o = byId.get(id);
      if (!o || d > 8) return;
      if (o.kind === 'group') o.children.forEach((c) => visit(c, d + 1));
      else if (o.kind !== 'mark') out.add(id);
    };
    for (const id of ids) visit(id, 0);
    return [...out];
  }
  function move(id: ObjId, by: Point): void {
    edit(() => {
      for (const m of movables([id])) set(m, translated(byId.get(m)!, by.x, by.y));
    });
  }
  /** `o` scaled by `k` about (cx, cy). Shapes keep their line width; ink strokes scale like a drawing. */
  function scaled(o: Obj, k: number, cx: number, cy: number): Obj {
    if (o.kind === 'mark' || o.kind === 'group') return o;
    const x = cx + (o.x - cx) * k;
    const y = cy + (o.y - cy) * k;
    switch (o.kind) {
      case 'stroke':
        return { ...o, x, y, pts: o.pts.map((v, i) => (i % 3 === 2 ? v : v * k)), size: o.size * k };
      case 'text':
      case 'math':
        return { ...o, x, y, size: o.size * k };
      case 'graph':
      case 'shape':
        return { ...o, x, y, w: o.w * k, h: o.h * k };
    }
  }
  function scale(id: ObjId, factor: number): void {
    const b = boundsOf(id);
    if (!b || !(factor > 0) || factor === 1) return;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    edit(() => {
      for (const m of movables([id])) set(m, scaled(byId.get(m)!, factor, cx, cy));
    });
  }
  function addStroke(points: Point[] | number[], o?: { color?: string; size?: number; highlighter?: boolean }): ObjId {
    const flat: number[] = [];
    if (typeof points[0] === 'number') {
      const p = points as number[];
      for (let i = 0; i + 1 < p.length; i += 2) flat.push(p[i]!, p[i + 1]!, -1);
    } else for (const p of points as Point[]) flat.push(p.x, p.y, -1);
    const ox = flat[0] ?? 0;
    const oy = flat[1] ?? 0;
    for (let i = 0; i < flat.length; i += 3) {
      flat[i] = flat[i]! - ox;
      flat[i + 1] = flat[i + 1]! - oy;
    }
    const obj: StrokeObj = {
      id: newId(),
      kind: 'stroke',
      z: zNext++,
      color: o?.color ?? (o?.highlighter ? 'ochre' : 'ink'),
      x: ox,
      y: oy,
      pts: flat,
      size: o?.size ?? (o?.highlighter ? WIDTHS.highlighter[1]! : WIDTHS.pen[1]!),
      ...(o?.highlighter ? { highlighter: true } : {}),
    };
    edit(() => set(obj.id, obj));
    return placed(obj.id, false);
  }
  function undo(): void {
    if (gesture || tx) return;
    const step = history.pop();
    if (!step) return status('Nothing to undo');
    applyStep(step, 'undo');
    future.push(step);
    changed();
  }
  function redo(): void {
    if (gesture || tx) return;
    const step = future.pop();
    if (!step) return status('Nothing to redo');
    applyStep(step, 'redo');
    history.push(step);
    changed();
  }
  function reveal(id: ObjId): void {
    const b = boundsOf(id);
    if (!b || !W) return;
    const v = viewRect();
    const m = 48 / cam.z;
    const inside = b.x >= v.x + m && b.y >= v.y + m && b.x + b.w <= v.x + v.w - m && b.y + b.h <= v.y + v.h - 90 / cam.z;
    if (inside) return;
    animateTo(camFor(b, cam.z));
  }
  function fit(): void {
    const b = contentBounds();
    if (!b) return animateTo({ x: -W / 2, y: -H / 2, z: 1 });
    animateTo(camFor(b, 2));
  }

  // ---------- status / command bar ----------
  let statusTimer = 0;
  function status(message: string): void {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-shown', !!message);
    clearTimeout(statusTimer);
    if (message) statusTimer = window.setTimeout(() => statusEl.classList.remove('is-shown'), 4200);
  }
  cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cmdInput.value.trim();
    if (text) opts.onCommand(text);
  });
  micBtn.addEventListener('click', () => opts.onMic());
  // Esc in an empty command bar leaves the board too.
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (cmdInput.value) cmdInput.value = '';
    else opts.onClose?.();
  });

  // ---------- persistence ----------
  let saveTimer = 0;
  let saving: Promise<void> = Promise.resolve();
  let dirtySave = false;
  /** Shows (or with null, hides) the "saving unavailable" notice. */
  function notice(message: string | null): void {
    noticeEl.textContent = message ?? '';
    noticeEl.hidden = !message;
  }
  function scheduleSave(): void {
    dirtySave = true;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), 700);
  }
  function snapshot(): BoardRecord {
    return { ...rec, updatedAt: Date.now(), count: objs.length, objects: objs.slice(), camera: { ...cam } };
  }
  function flush(): Promise<void> {
    clearTimeout(saveTimer);
    if (!dirtySave || !persist) return saving;
    dirtySave = false;
    const snap = snapshot();
    rec.updatedAt = snap.updatedAt;
    saving = saving
      .then(() => boards.put(snap))
      .then(() => {
        boards.dropStash(snap.id, snap.updatedAt);
        notice(null);
      })
      .catch((e: Error) => {
        // Every failed save says so (not just the first): the notice stays until a save succeeds, and the
        // edits are stashed so they aren't lost if the page closes.
        status(e.message);
        notice(`Not saved: ${e.message}`);
        if (!destroyed) boards.saveStash(snap);
        dirtySave = true;
      });
    return saving;
  }
  /**
   * Unsaved edits stashed when the page was hidden or unloaded (an IndexedDB write started then can be cut
   * off), if newer than the saved record. They're written back on the next save.
   */
  function withStash(id: string, saved: BoardRecord | undefined): BoardRecord | undefined {
    const s = boards.stash(id);
    if (!s || (saved && s.updatedAt <= saved.updatedAt)) return saved;
    stashed = true;
    return s;
  }
  let stashed = false;
  function loadRecord(r: BoardRecord): void {
    rec = { ...r, objects: [] };
    objs = [];
    byId.clear();
    dirtyAll();
    marksByTarget = null;
    zNext = 1;
    for (const o of r.objects ?? []) rawPut(o);
    history = [];
    future = [];
    selected.clear();
    born.clear();
    lastPlaced = lastAdded = null;
    const top = [...objs].reverse().find((o) => !o.parent && o.kind !== 'mark');
    if (top) lastPlaced = lastAdded = top.id;
    resize();
    camAnim = null;
    setCam(r.camera ?? { x: -W / 2, y: -H / 2.6, z: 1 });
    // An in-memory board (storage not answering) must not become "the last board" to reopen.
    if (persist) boards.setLastId(r.id);
    syncChrome();
    invalidate(true);
  }
  async function openBoard(id: string): Promise<void> {
    await flush();
    const r = withStash(id, await boards.get(id));
    if (!r) throw new Error('That board no longer exists.');
    loadRecord(r);
    saveStashed();
  }
  function saveStashed(): void {
    if (!stashed) return;
    stashed = false;
    dirtySave = true;
    void flush();
  }
  async function newBoard(title?: string): Promise<void> {
    await flush();
    const now = Date.now();
    const r: BoardRecord = { id: newId(), title: title?.trim() || 'Untitled board', createdAt: now, updatedAt: now, count: 0, objects: [] };
    loadRecord(r);
    resize();
    setCam({ x: -W / 2, y: -H / 2.6, z: 1 });
    dirtySave = true;
    await flush();
  }
  async function deleteBoard(id: string): Promise<void> {
    if (id === rec.id) {
      // Drop pending saves of this board first: a save landing after the delete would bring it back.
      clearTimeout(saveTimer);
      dirtySave = false;
      await saving;
    }
    boards.dropStash(id);
    await boards.remove(id);
    if (id === rec.id) {
      dirtySave = false;
      const rest = await boards.list();
      if (rest[0]) await openBoard(rest[0].id);
      else await newBoard();
    }
  }
  function rename(title: string): void {
    rec.title = title.trim() || 'Untitled board';
    syncChrome();
    dirtySave = true;
    void flush();
  }

  // ---------- chrome ----------
  function syncChrome(): void {
    for (const b of root.querySelectorAll<HTMLButtonElement>('.wb-toolbar [data-tool]')) {
      const on = b.dataset.tool === tool;
      b.classList.toggle('is-on', on);
      if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
    }
    moreBtn.classList.toggle('is-on', shapeMore.includes(tool as ShapeKind));
    for (const b of root.querySelectorAll<HTMLButtonElement>('.wb-swatch')) {
      b.setAttribute('aria-checked', String(b.dataset.color === color));
      b.style.setProperty('--sw', resolveColor(b.dataset.color, theme));
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('.wb-width')) b.setAttribute('aria-checked', String(Number(b.dataset.width) === widthIdx));
    q<HTMLButtonElement>('[data-act="undo"]').disabled = !history.length;
    q<HTMLButtonElement>('[data-act="redo"]').disabled = !future.length;
    titleEl.textContent = rec.title;
    boardsBtn.setAttribute('aria-label', `Boards: ${rec.title}`);
    root.dataset.tool = spaceDown ? 'hand' : tool;
  }
  function setTool(t: Tool): void {
    commitEditor();
    tool = t;
    if (t !== 'select') selected.clear();
    eraserAt = null;
    closePops();
    syncChrome();
    invalidate();
  }
  function closePops(except?: HTMLElement): void {
    if (except !== moreMenu) {
      moreMenu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
    }
    if (except !== boardsPop) {
      boardsPop.hidden = true;
      boardsBtn.setAttribute('aria-expanded', 'false');
    }
  }
  async function renderBoardList(): Promise<void> {
    boardsErr.hidden = true;
    renameInput.value = rec.title;
    let list: BoardSummary[];
    try {
      list = persist ? await boards.list() : [];
    } catch (e) {
      boardsErr.textContent = (e as Error).message;
      boardsErr.hidden = false;
      list = [];
    }
    if (!list.some((b) => b.id === rec.id)) list.unshift({ id: rec.id, title: rec.title, createdAt: rec.createdAt, updatedAt: rec.updatedAt, count: objs.length });
    boardList.innerHTML = list
      .map(
        (b) => `<li class="wb-board${b.id === rec.id ? ' is-current' : ''}" data-id="${esc(b.id)}">
          <button type="button" class="wb-board-open" data-open="${esc(b.id)}"${b.id === rec.id ? ' aria-current="true"' : ''}>
            <span class="wb-board-title">${esc(b.id === rec.id ? rec.title : b.title)}</span>
            <span class="wb-board-time">${b.id === rec.id ? 'Open now' : `Edited ${relTime(b.updatedAt)}`}</span>
          </button>
          <button type="button" class="wb-btn wb-board-del" data-del="${esc(b.id)}" title="Delete board" aria-label="Delete ${esc(b.title)}">${icon('trash')}</button>
        </li>`,
      )
      .join('');
  }
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn || !root.contains(btn)) {
      if (!t.closest('.wb-pop')) closePops();
      return;
    }
    if (btn.dataset.tool) setTool(btn.dataset.tool as Tool);
    else if (btn.dataset.more !== undefined) {
      const open = moreMenu.hidden;
      closePops(moreMenu);
      moreMenu.hidden = !open;
      moreBtn.setAttribute('aria-expanded', String(open));
    } else if (btn.dataset.color) {
      color = btn.dataset.color;
      if (selected.size) recolorSelection(color);
      syncChrome();
    } else if (btn.dataset.width) {
      widthIdx = Number(btn.dataset.width);
      syncChrome();
    } else if (btn.dataset.open) {
      const id = btn.dataset.open;
      closePops();
      if (id !== rec.id) openBoard(id).catch((err: Error) => status(err.message));
    } else if (btn.dataset.del) {
      const li = btn.closest<HTMLElement>('li')!;
      const id = btn.dataset.del;
      li.classList.add('is-confirm');
      li.innerHTML = `<span class="wb-confirm-text">Delete this board?</span>
        <button type="button" class="wb-btn wb-danger" data-confirm-del="${esc(id)}">Delete</button>
        <button type="button" class="wb-btn" data-cancel-del>Cancel</button>`;
      li.querySelector<HTMLButtonElement>('[data-cancel-del]')!.focus();
    } else if (btn.dataset.confirmDel) {
      deleteBoard(btn.dataset.confirmDel)
        .then(() => renderBoardList())
        .catch((err: Error) => status(err.message));
    } else if (btn.dataset.cancelDel !== undefined) void renderBoardList();
    else
      switch (btn.dataset.act) {
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'zoom-in':
          zoomAt(1.25, W / 2, H / 2);
          break;
        case 'zoom-out':
          zoomAt(0.8, W / 2, H / 2);
          break;
        case 'zoom-reset':
          zoomAt(1 / cam.z, W / 2, H / 2);
          break;
        case 'fit':
          fit();
          break;
        case 'export':
          void downloadPng();
          break;
        case 'close':
          opts.onClose?.();
          break;
        case 'boards': {
          const open = boardsPop.hidden;
          closePops(boardsPop);
          boardsPop.hidden = !open;
          boardsBtn.setAttribute('aria-expanded', String(open));
          if (open) void renderBoardList();
          break;
        }
        case 'new-board':
          closePops();
          newBoard()
            .then(() => status('New board'))
            .catch((err: Error) => status(err.message));
          break;
      }
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      rename(renameInput.value);
      void renderBoardList();
    } else if (e.key === 'Escape') {
      renameInput.value = rec.title;
      closePops();
    }
  });
  renameInput.addEventListener('change', () => rename(renameInput.value));
  function recolorSelection(c: string): void {
    edit(() => {
      for (const id of movables(selected).concat([...selected].filter((id) => byId.get(id)?.kind === 'mark'))) {
        const o = byId.get(id);
        if (o && o.kind !== 'graph') set(id, { ...o, color: c });
      }
    });
  }
  async function downloadPng(): Promise<void> {
    try {
      const blob = await exportPng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.title.replace(/[\\/:*?"<>|]+/g, '-') || 'board'}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status('Exported PNG');
    } catch (e) {
      status((e as Error).message);
    }
  }

  // ---------- export ----------
  async function exportPng(): Promise<Blob> {
    const pad = 40;
    const frame = () => {
      const b = contentBounds();
      const area = b ? inflate(b, pad) : { x: 0, y: 0, w: 480, h: 320 };
      let scale = Math.min(2, 8000 / Math.max(area.w, area.h));
      if (area.w * area.h * scale * scale > 40e6) scale = Math.sqrt(40e6 / (area.w * area.h));
      return { area, scale };
    };
    // Math is only measured once typeset, and the export size depends on those measurements: typeset, then
    // re-measure (until the frame settles) so a formula added just before exporting isn't clipped.
    let f = frame();
    for (let i = 0; i < 3; i++) {
      await Promise.all(objs.filter((o): o is MathObj => o.kind === 'math').map((o) => requestMath(o, f.scale).promise));
      const next = frame();
      const same = next.scale === f.scale && next.area.x === f.area.x && next.area.y === f.area.y && next.area.w === f.area.w && next.area.h === f.area.h;
      f = next;
      if (same) break;
    }
    const { area, scale } = f;
    const px = scale;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(area.w * scale));
    c.height = Math.max(1, Math.ceil(area.h * scale));
    const x = c.getContext('2d');
    if (!x) throw new Error('Export failed: no canvas.');
    x.fillStyle = theme.bg;
    x.fillRect(0, 0, c.width, c.height);
    x.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
    const e = env(x, px);
    for (const o of objs) if (o.kind !== 'group') drawObject(e, o, 1);
    return new Promise<Blob>((resolve, reject) => c.toBlob((bl) => (bl && bl.size ? resolve(bl) : reject(new Error('Export failed: the image is too large.'))), 'image/png'));
  }

  // ---------- text editor ----------
  let editing: { id: string | null; kind: 'text' | 'math'; x: number; y: number; size: number; color: string } | null = null;
  function positionEditor(): void {
    if (!editing) return;
    const s = toScreen(editing);
    const fs = editing.size * cam.z * (editing.kind === 'math' ? 0.6 : 1);
    editor.style.left = `${s.x}px`;
    editor.style.top = `${s.y}px`;
    editor.style.fontSize = `${fs}px`;
    editor.style.color = resolveColor(editing.color, theme);
    autosize();
  }
  function autosize(): void {
    if (!editing) return;
    const m = measureText({ text: editor.value || ' ', size: editing.size * cam.z * (editing.kind === 'math' ? 0.6 : 1) }, theme);
    editor.style.width = `${Math.max(120, m.w + 40)}px`;
    editor.style.height = `${m.h + 12}px`;
  }
  function openEditor(e: NonNullable<typeof editing>, value: string): void {
    commitEditor();
    editing = e;
    hiddenId = e.id;
    if (e.id) dirtyObj(e.id);
    editor.hidden = false;
    editor.value = value;
    editor.classList.toggle('is-math', e.kind === 'math');
    editor.style.fontFamily = e.kind === 'math' ? theme.mono : theme.sans;
    editor.placeholder = e.kind === 'math' ? 'LaTeX' : 'Type…';
    positionEditor();
    invalidate(true);
    editor.focus({ preventScroll: true });
    editor.select();
    // dblclick and touch can move focus after this handler; take it back once.
    requestAnimationFrame(() => {
      if (editing && document.activeElement !== editor) editor.focus({ preventScroll: true });
    });
  }
  function commitEditor(): void {
    const e = editing;
    if (!e) return;
    editing = null;
    if (hiddenId) dirtyObj(hiddenId);
    hiddenId = null;
    editor.hidden = true;
    const value = e.kind === 'text' ? editor.value.replace(/\s+$/, '') : editor.value.trim();
    const old = e.id ? byId.get(e.id) : undefined;
    if (old) {
      if (!value.trim()) removeIds([old.id]);
      else if (old.kind === 'text' && old.text !== value) edit(() => set(old.id, { ...old, text: value }));
      else if (old.kind === 'math' && old.tex !== value) edit(() => set(old.id, { ...old, tex: value }));
    } else if (value.trim()) {
      const obj: TextObj = { id: newId(), kind: 'text', z: zNext++, color: e.color, x: e.x, y: e.y, text: value, size: e.size };
      edit(() => set(obj.id, obj));
      placed(obj.id, false);
    }
    invalidate(true);
  }
  editor.addEventListener('input', autosize);
  editor.addEventListener('blur', () => commitEditor());
  editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || (e.key === 'Enter' && editing?.kind === 'math')) {
      e.preventDefault();
      commitEditor();
    }
  });

  // ---------- hit testing ----------
  function hitTest(p: Point): string | null {
    const tol = 6 / cam.z;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i]!;
      if (o.kind === 'group') continue;
      const b = boundsOf(o.id);
      if (!b || p.x < b.x - tol || p.y < b.y - tol || p.x > b.x + b.w + tol || p.y > b.y + b.h + tol) continue;
      let hit = true;
      if (o.kind === 'stroke') hit = strokeHit(o, p.x, p.y, tol);
      else if (o.kind === 'shape' && (o.shape === 'line' || o.shape === 'arrow')) hit = distToSegment(p.x, p.y, o.x, o.y, o.x + o.w, o.y + o.h) <= tol + o.size;
      else if (o.kind === 'mark' && o.style !== 'highlight') {
        const inner = inflate(b, -Math.max(tol * 2, 10 / cam.z));
        hit = !(p.x > inner.x && p.y > inner.y && p.x < inner.x + inner.w && p.y < inner.y + inner.h);
      }
      if (hit) return topOf(o.id);
    }
    return null;
  }
  type Handle = { x: number; y: number; id: string; corner: number };
  function handles(): Handle[] {
    if (selected.size !== 1 || gesture?.kind === 'move') return [];
    const id = [...selected][0]!;
    const o = byId.get(id);
    if (!o || !(o.kind === 'shape' || o.kind === 'graph' || o.kind === 'math' || o.kind === 'text')) return [];
    if (o.kind === 'shape' && (o.shape === 'line' || o.shape === 'arrow')) {
      const a = toScreen(o);
      const b = toScreen({ x: o.x + o.w, y: o.y + o.h });
      return [
        { ...a, id, corner: 10 },
        { ...b, id, corner: 11 },
      ];
    }
    const b = boundsOf(id)!;
    const s = toScreen(b);
    const x1 = s.x - 4;
    const y1 = s.y - 4;
    const x2 = s.x + b.w * cam.z + 4;
    const y2 = s.y + b.h * cam.z + 4;
    return [
      { x: x1, y: y1, id, corner: 0 },
      { x: x2, y: y1, id, corner: 1 },
      { x: x2, y: y2, id, corner: 2 },
      { x: x1, y: y2, id, corner: 3 },
    ];
  }

  // ---------- pointer input ----------
  const ERASE_PX = 10;
  type Gesture =
    | { kind: 'draw' }
    | { kind: 'erase'; last: Point }
    | { kind: 'pan'; sx: number; sy: number; cam: Cam }
    | { kind: 'pinch'; mid: Point; dist: number; cam: Cam }
    | { kind: 'move'; start: Point; orig: Map<string, Obj>; moved: boolean }
    | { kind: 'marquee'; base: Set<string> }
    | { kind: 'resize'; id: string; corner: number; orig: Obj; ob: Rect }
    | { kind: 'shape'; start: Point; shape: ShapeKind };
  let gesture: Gesture | null = null;
  let live: { pts: number[]; color: string; size: number; highlighter: boolean; pen: boolean } | null = null;
  let preview: ShapeObj | null = null;
  let marquee: { a: Point; b: Point } | null = null;
  let eraserAt: Point | null = null;
  let spaceDown = false;
  const pointers = new Map<number, { x: number; y: number; type: string }>();

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function cancelGesture(): void {
    if (!gesture) return;
    if (tx) {
      for (const c of [...tx.values()].reverse()) {
        if (c.before) rawPut(c.before);
        else rawDel(c.id);
      }
      tx = null;
    }
    live = null;
    preview = null;
    marquee = null;
    gesture = null;
    invalidate(true);
  }
  function startPinch(): void {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    cancelGesture();
    gesture = { kind: 'pinch', mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cam: { ...cam } };
  }
  function onDown(e: PointerEvent): void {
    if (e.button === 2) return;
    closePops();
    if (editing) {
      commitEditor();
      if (tool !== 'text') return;
    }
    canvas.focus({ preventScroll: true });
    const p = local(e);
    pointers.set(e.pointerId, { ...p, type: e.pointerType });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    const touches = [...pointers.values()].filter((x) => x.type === 'touch').length;
    if (e.pointerType === 'touch' && touches >= 2) return startPinch();
    if (gesture) return;
    e.preventDefault();
    camAnim = null;
    const w = toWorld(p);
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      gesture = { kind: 'pan', sx: p.x, sy: p.y, cam: { ...cam } };
      root.classList.add('is-panning');
      return;
    }
    if (tool === 'pen' || tool === 'highlighter') {
      const hl = tool === 'highlighter';
      const size = (hl ? WIDTHS.highlighter : WIDTHS.pen)[widthIdx]! / cam.z;
      live = { pts: [w.x, w.y, e.pointerType === 'pen' ? e.pressure || 0.5 : -1], color: hl && color === 'ink' ? 'ochre' : color, size, highlighter: hl, pen: e.pointerType === 'pen' };
      gesture = { kind: 'draw' };
      invalidate();
      return;
    }
    if (tool === 'eraser') {
      tx = new Map();
      gesture = { kind: 'erase', last: w };
      eraseAlong(w, w);
      return;
    }
    if (tool === 'text') {
      const hit = hitTest(w);
      const ho = hit ? byId.get(hit) : undefined;
      if (ho?.kind === 'text') return openEditor({ id: ho.id, kind: 'text', x: ho.x, y: ho.y, size: ho.size, color: ho.color }, ho.text);
      openEditor({ id: null, kind: 'text', x: w.x, y: w.y - 14 / cam.z, size: Math.round(28 / cam.z), color }, '');
      return;
    }
    if (tool === 'select') {
      for (const h of handles()) {
        if (Math.abs(h.x - p.x) <= 9 && Math.abs(h.y - p.y) <= 9) {
          const o = byId.get(h.id)!;
          tx = new Map();
          gesture = { kind: 'resize', id: h.id, corner: h.corner, orig: o, ob: boundsOf(h.id)! };
          return;
        }
      }
      const hit = hitTest(w);
      if (hit) {
        if (e.shiftKey) {
          if (selected.has(hit)) selected.delete(hit);
          else selected.add(hit);
          invalidate();
          return;
        }
        if (!selected.has(hit)) selected = new Set([hit]);
        const orig = new Map<string, Obj>();
        for (const id of movables(selected)) orig.set(id, byId.get(id)!);
        gesture = { kind: 'move', start: w, orig, moved: false };
      } else {
        if (!e.shiftKey) selected.clear();
        marquee = { a: w, b: w };
        gesture = { kind: 'marquee', base: new Set(selected) };
      }
      invalidate();
      return;
    }
    // Shape tools
    gesture = { kind: 'shape', start: w, shape: tool };
  }
  function eraseAlong(a: Point, b: Point): void {
    const r = ERASE_PX / cam.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / r));
    const hits = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const y = a.y + ((b.y - a.y) * i) / steps;
      const probe = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
      for (const o of objs) {
        if (o.kind !== 'stroke' || hits.has(o.id)) continue;
        const bb = boundsOf(o.id)!;
        if (rectsIntersect(bb, probe) && strokeHit(o, x, y, r)) hits.add(o.id);
      }
    }
    if (!hits.size) return;
    applyKill(killSet(hits));
    invalidate(true);
  }
  function onMove(e: PointerEvent): void {
    const p = local(e);
    const ptr = pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = p.x;
      ptr.y = p.y;
    }
    if (tool === 'eraser' && (!gesture || gesture.kind === 'erase') && e.pointerType !== 'touch') {
      eraserAt = p;
      invalidate();
    }
    if (!gesture || !ptr) return;
    const w = toWorld(p);
    switch (gesture.kind) {
      case 'pinch': {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const g = gesture;
        const z = Math.min(MAX_Z, Math.max(MIN_Z, (g.cam.z * dist) / g.dist));
        const wx = g.cam.x + g.mid.x / g.cam.z;
        const wy = g.cam.y + g.mid.y / g.cam.z;
        setCam({ x: wx - mid.x / z, y: wy - mid.y / z, z });
        return;
      }
      case 'pan':
        setCam({ x: gesture.cam.x - (p.x - gesture.sx) / cam.z, y: gesture.cam.y - (p.y - gesture.sy) / cam.z, z: cam.z });
        return;
      case 'draw': {
        if (!live) return;
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ce of evs.length ? evs : [e]) {
          const q2 = toWorld(local(ce));
          live.pts.push(q2.x, q2.y, live.pen ? ce.pressure || 0.5 : -1);
        }
        invalidate();
        return;
      }
      case 'erase':
        eraseAlong(gesture.last, w);
        gesture.last = w;
        eraserAt = p;
        return;
      case 'move': {
        const dx = w.x - gesture.start.x;
        const dy = w.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) * cam.z < 3) return;
        if (!gesture.moved) {
          gesture.moved = true;
          tx = new Map();
        }
        for (const [id, o] of gesture.orig) set(id, translated(o, dx, dy));
        invalidate(true);
        return;
      }
      case 'marquee': {
        marquee!.b = w;
        const r = normRect(marquee!.a.x, marquee!.a.y, w.x - marquee!.a.x, w.y - marquee!.a.y);
        const next = new Set(gesture.base);
        if (r.w * cam.z > 2 || r.h * cam.z > 2)
          for (const o of objs) {
            if (o.parent || o.kind === 'group') {
              if (o.kind === 'group') {
                const b = boundsOf(o.id);
                if (b && rectsIntersect(b, r)) next.add(o.id);
              }
              continue;
            }
            const b = boundsOf(o.id);
            if (!b || !rectsIntersect(b, r)) continue;
            if (o.kind === 'stroke' && !(b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h)) {
              // Strokes must be crossed by the marquee, not just near it.
              let inside = false;
              for (let i = 0; i < o.pts.length && !inside; i += 3) {
                const x = o.x + o.pts[i]!;
                const y = o.y + o.pts[i + 1]!;
                inside = x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
              }
              if (!inside) continue;
            }
            next.add(o.id);
          }
        selected = next;
        invalidate();
        return;
      }
      case 'resize': {
        const g = gesture;
        const o = g.orig;
        let next: Obj = o;
        if (o.kind === 'shape' && (g.corner === 10 || g.corner === 11)) {
          next = g.corner === 10 ? { ...o, x: w.x, y: w.y, w: o.x + o.w - w.x, h: o.y + o.h - w.y } : { ...o, w: w.x - o.x, h: w.y - o.y };
        } else {
          const b = g.ob;
          const fx = g.corner === 0 || g.corner === 3 ? b.x + b.w : b.x;
          const fy = g.corner === 0 || g.corner === 1 ? b.y + b.h : b.y;
          let nw = Math.max(16 / cam.z, Math.abs(w.x - fx));
          let nh = Math.max(16 / cam.z, Math.abs(w.y - fy));
          if (o.kind === 'math' || o.kind === 'text' || e.shiftKey) {
            const s = Math.max(nw / b.w, nh / b.h);
            nw = b.w * s;
            nh = b.h * s;
          }
          const nx = w.x < fx ? fx - nw : fx;
          const ny = w.y < fy ? fy - nh : fy;
          if (o.kind === 'math' || o.kind === 'text') {
            const s = nh / b.h;
            next = { ...o, size: Math.max(6, o.size * s), x: nx + (o.x - b.x) * s, y: ny + (o.y - b.y) * s };
          } else if (o.kind === 'shape' || o.kind === 'graph') next = { ...o, x: nx, y: ny, w: nw, h: nh };
        }
        set(g.id, next);
        invalidate(true);
        return;
      }
      case 'shape': {
        const s = gesture.start;
        let dx = w.x - s.x;
        let dy = w.y - s.y;
        const line = gesture.shape === 'line' || gesture.shape === 'arrow';
        if (e.shiftKey) {
          if (line) {
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const d = Math.hypot(dx, dy);
            dx = Math.cos(a) * d;
            dy = Math.sin(a) * d;
          } else {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * m;
            dy = Math.sign(dy || 1) * m;
          }
        }
        const r = line ? { x: s.x, y: s.y, w: dx, h: dy } : normRect(s.x, s.y, dx, dy);
        preview = { id: 'preview', kind: 'shape', shape: gesture.shape, z: 0, color, ...r, size: WIDTHS.shape[widthIdx]! / cam.z };
        invalidate();
        return;
      }
    }
  }
  function onUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.size < 2) gesture = null;
      return;
    }
    gesture = null;
    root.classList.remove('is-panning');
    switch (g.kind) {
      case 'draw': {
        const l = live;
        live = null;
        if (!l || !l.pts.length) break;
        const pts = smoothPoints(l.pts, 0.6 / cam.z);
        const ox = Math.round(pts[0]! * 10) / 10;
        const oy = Math.round(pts[1]! * 10) / 10;
        for (let i = 0; i < pts.length; i += 3) {
          pts[i] = Math.round((pts[i]! - ox) * 100) / 100;
          pts[i + 1] = Math.round((pts[i + 1]! - oy) * 100) / 100;
          pts[i + 2] = l.pen ? Math.round(pts[i + 2]! * 100) / 100 : -1;
        }
        const obj: StrokeObj = { id: newId(), kind: 'stroke', z: zNext++, color: l.color, x: ox, y: oy, pts, size: Math.round(l.size * 100) / 100, ...(l.highlighter ? { highlighter: true } : {}) };
        edit(() => set(obj.id, obj));
        placed(obj.id, false);
        break;
      }
      case 'erase':
      case 'resize':
      case 'move': {
        commitTx();
        break;
      }
      case 'marquee':
        marquee = null;
        break;
      case 'shape': {
        const pv = preview;
        preview = null;
        const small = !pv || Math.hypot(pv.w, pv.h) * cam.z < 6;
        const [dw, dh] = SHAPE_DEFAULTS[g.shape];
        const obj: ShapeObj = small
          ? { id: newId(), kind: 'shape', shape: g.shape, z: zNext++, color, x: g.start.x - (g.shape === 'line' || g.shape === 'arrow' ? 0 : dw / 2), y: g.start.y - dh / 2, w: dw, h: dh, size: WIDTHS.shape[widthIdx]! / cam.z }
          : { ...pv!, id: newId(), z: zNext++ };
        edit(() => set(obj.id, obj));
        placed(obj.id, false);
        tool = 'select';
        selected = new Set([obj.id]);
        syncChrome();
        break;
      }
    }
    invalidate(true);
  }
  function onCancel(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (gesture?.kind === 'pinch' && pointers.size >= 1) {
      gesture = null;
      return;
    }
    cancelGesture();
  }
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', () => {
    if (eraserAt && !gesture) {
      eraserAt = null;
      invalidate();
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', (e) => {
    if (tool !== 'select') return;
    const w = toWorld(local(e));
    const hit = hitTest(w);
    const o = hit ? byId.get(hit) : undefined;
    if (o?.kind === 'text') {
      selected.clear();
      openEditor({ id: o.id, kind: 'text', x: o.x, y: o.y, size: o.size, color: o.color }, o.text);
    } else if (o?.kind === 'math') {
      selected.clear();
      openEditor({ id: o.id, kind: 'math', x: o.x, y: o.y, size: o.size, color: o.color }, o.tex);
    } else if (!o) {
      openEditor({ id: null, kind: 'text', x: w.x, y: w.y - 14 / cam.z, size: Math.round(28 / cam.z), color }, '');
    }
  });
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    camAnim = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const p = local(e);
    if (e.ctrlKey || e.metaKey) {
      const d = Math.max(-60, Math.min(60, e.deltaY * unit));
      zoomAt(Math.exp(-d * 0.01), p.x, p.y);
    } else {
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
      setCam({ x: cam.x + dx / cam.z, y: cam.y + dy / cam.z, z: cam.z });
    }
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });
  // Safari trackpad pinch.
  let gestureZ = 1;
  const gStart = (e: Event) => {
    e.preventDefault();
    gestureZ = cam.z;
  };
  const gChange = (e: Event) => {
    e.preventDefault();
    const ge = e as Event & { scale: number; clientX: number; clientY: number };
    const p = local(ge);
    zoomAt((gestureZ * ge.scale) / cam.z, p.x, p.y);
  };
  canvas.addEventListener('gesturestart', gStart);
  canvas.addEventListener('gesturechange', gChange);

  // ---------- keyboard ----------
  function visible(): boolean {
    return root.isConnected && root.getClientRects().length > 0;
  }
  function onKey(e: KeyboardEvent): void {
    if (destroyed || !visible()) return;
    if (isEditable(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    // Space on a focused button or menu item presses it; it only pans from the canvas.
    if (e.key === ' ' && e.target instanceof Element && e.target.closest('button, a[href], [role="button"], [role="menuitem"], [role="radio"], summary')) return;
    if (e.key === ' ') {
      if (!spaceDown) {
        spaceDown = true;
        syncChrome();
      }
      e.preventDefault();
      return;
    }
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === 'a') {
      e.preventDefault();
      setTool('select');
      selected = new Set(objs.filter((o) => !o.parent).map((o) => o.id));
      invalidate();
      return;
    }
    if (mod && (k === '=' || k === '+' || k === '-')) {
      e.preventDefault();
      zoomAt(k === '-' ? 0.8 : 1.25, W / 2, H / 2);
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected.size) {
        e.preventDefault();
        removeIds([...selected]);
      }
      return;
    }
    if (e.key === 'Escape') {
      // Esc backs out one step at a time: a menu, a drag, the selection, and then the board itself.
      const busy = !!gesture || selected.size > 0 || !!root.querySelector('.wb-pop:not([hidden])');
      if (!busy && opts.onClose) return opts.onClose();
      closePops();
      if (gesture) cancelGesture();
      selected.clear();
      invalidate();
      return;
    }
    if (e.key.startsWith('Arrow') && selected.size) {
      e.preventDefault();
      const d = (e.shiftKey ? 10 : 1) / cam.z;
      const by = { x: e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, y: e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0 };
      edit(() => {
        for (const m of movables(selected)) set(m, translated(byId.get(m)!, by.x, by.y));
      });
      return;
    }
    if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
      fit();
      return;
    }
    if (e.key === ')' || (e.shiftKey && e.code === 'Digit0')) {
      zoomAt(1 / cam.z, W / 2, H / 2);
      return;
    }
    if (e.key === '+' || e.key === '=') return zoomAt(1.25, W / 2, H / 2);
    if (e.key === '-' || e.key === '_') return zoomAt(0.8, W / 2, H / 2);
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      widthIdx = Number(e.key) - 1;
      syncChrome();
      return;
    }
    const t = TOOL_KEYS[k];
    if (t && !e.shiftKey) setTool(t);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ' && spaceDown) {
      spaceDown = false;
      syncChrome();
    }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  const onBlur = () => {
    spaceDown = false;
    syncChrome();
  };
  window.addEventListener('blur', onBlur);

  // ---------- lifecycle ----------
  const ro = new ResizeObserver(() => {
    if (resize()) {
      positionEditor();
      invalidate(true);
    }
  });
  ro.observe(root);
  // Hiding or unloading the page: stash unsaved edits synchronously (the IndexedDB write may not finish), then save.
  const stashNow = () => {
    if (dirtySave && persist) boards.saveStash(snapshot());
  };
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    stashNow();
    void flush();
  };
  const onPageHide = () => {
    stashNow();
    void flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  // Load the board. Storage normally answers in milliseconds and the saved board is there when this returns.
  // When IndexedDB hangs (blocked, private mode, a stuck upgrade) the board opens empty and in memory after a
  // short wait instead of after the store's full timeout; the saved board replaces it if storage answers later,
  // keeping anything drawn meanwhile.
  persist = false;
  loadRecord(rec);
  const loadSaved = async (): Promise<BoardRecord | null> => {
    const wanted = opts.boardId ?? boards.lastId();
    let r = wanted ? withStash(wanted, await boards.get(wanted)) : undefined;
    if (!r) {
      const list = await boards.list();
      if (list[0] && !opts.boardId) r = withStash(list[0].id, await boards.get(list[0].id));
    }
    return r ?? null;
  };
  const apply = async (r: BoardRecord | null, late: boolean) => {
    if (destroyed) return;
    // Things added to the in-memory board while storage was silent are carried over onto the saved one.
    const meanwhile = late ? objs.slice() : [];
    if (late) commitEditor();
    persist = true;
    if (r) {
      loadRecord(r);
      for (const o of meanwhile) rawPut({ ...o, z: o.z + zNext });
      if (meanwhile.length) {
        dirtyAll();
        invalidate(true);
        dirtySave = true;
        void flush();
      }
      saveStashed();
    } else {
      if (opts.boardId) rec.id = opts.boardId;
      if (!late) loadRecord(rec);
      boards.setLastId(rec.id);
      dirtySave = true;
      await flush();
    }
    notice(null);
    if (late) status(meanwhile.length ? 'Storage is back: opened your saved board with what you just added' : 'Storage is back: opened your saved board');
  };
  const failed = (e: unknown) => {
    if (destroyed) return;
    persist = false;
    const msg = (e as Error).message;
    notice(`Saving unavailable — ${msg.replace(/^Boards can't be saved: /, '')} This board works but won't be kept.`);
    status(msg);
  };
  const loading = loadSaved().then(
    (r) => ({ r }),
    (e: unknown) => ({ e }),
  );
  const first = await Promise.race([loading, new Promise<null>((r) => setTimeout(() => r(null), LOAD_GRACE_MS))]);
  let loaded: Promise<void>;
  if (first) {
    loaded = 'e' in first ? Promise.resolve(failed(first.e)) : apply(first.r, false).catch(failed);
    await loaded;
  } else {
    notice('Saving unavailable — storage isn’t responding yet. You can keep working; your board opens here if it answers.');
    loaded = loading.then((x) => ('e' in x ? failed(x.e) : apply(x.r, true))).catch(failed);
  }
  syncChrome();
  invalidate(true);

  const board: Board = {
    addText,
    addMath,
    addGraph,
    addShape,
    mark,
    group,
    remove: (id) => removeIds([id]),
    move,
    scale,
    bounds: (id) => {
      const b = boundsOf(id);
      return b ? { ...b } : null;
    },
    last: () => {
      if (lastAdded && byId.has(lastAdded)) {
        const o = byId.get(lastAdded)!;
        if (o.kind !== 'mark' && !o.parent) return lastAdded;
      }
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i]!;
        if (!o.parent && o.kind !== 'mark') return o.id;
      }
      return null;
    },
    selection: () => [...selected],
    select: (ids) => {
      selected = new Set(ids.filter((id) => byId.has(id)).map(topOf));
      if (selected.size && tool !== 'select') {
        tool = 'select';
        syncChrome();
      }
      invalidate();
    },
    nextSpot,
    reveal,
    zoomBy: (f) => zoomAt(f, W / 2, H / 2),
    fit,
    undo,
    redo,
    clear: () => removeIds(objs.map((o) => o.id)),
    exportPng,
    setCommandText: (t) => {
      cmdInput.value = t;
    },
    setListening: (on) => {
      micBtn.classList.toggle('is-listening', on);
      micBtn.setAttribute('aria-pressed', String(on));
      micBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Speak a command');
    },
    status,
    get title() {
      return rec.title;
    },
    destroy: () => {
      if (destroyed) return;
      commitEditor();
      // Backup first: if the save below fails after the board is gone, its catch no longer stashes.
      stashNow();
      void flush();
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (themeRaf) cancelAnimationFrame(themeRaf);
      clearTimeout(statusTimer);
      mo.disconnect();
      ro.disconnect();
      mq.removeEventListener('change', refreshTheme);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHide);
      root.remove();
    },
    addStroke,
    get: (id) => byId.get(id),
    objects: () => objs.slice(),
    setTool,
    get tool() {
      return tool;
    },
    get boardId() {
      return rec.id;
    },
    camera: () => ({ ...cam }),
    setCamera: (c) => {
      camAnim = null;
      setCam({ x: c.x ?? cam.x, y: c.y ?? cam.y, z: c.z ?? cam.z });
    },
    toScreen,
    toWorld,
    rename,
    newBoard,
    openBoard,
    listBoards: () => boards.list(),
    deleteBoard,
    flush,
    whenLoaded: () => loaded,
    ready: async () => {
      for (const o of objs) if (o.kind === 'math') requestMath(o, dpr * cam.z);
      while (mathPending.size) await Promise.all([...mathPending.values()]);
      renderNow();
    },
    renderNow,
    stats,
  };
  return board;
}
