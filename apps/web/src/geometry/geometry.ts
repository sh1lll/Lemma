import { Construction, GeometryCommands, describe, distanceTo, formatNumber, isTransform, nearestOn, snap, type CommandResult, type Def, type GObj, type Id, type Shape, type Value, type Vec } from '@lemma/geometry-engine';
import { WebSpeechRecognizer } from '../speech';
import { button, el } from '../study/ui';
import { SvgContext } from './svg-canvas';
import './geometry.css';

/**
 * Study → Geometry: a dynamic geometry canvas. Build with the tools or by typing/saying commands ("point A at
 * (1, 2)", "circle centered A through B", "midpoint of AB", "rotate P about A by 90", "slider k from 0 to 5");
 * drag a free point (or a slider) and everything built on it follows. Saved on this device as you go.
 *
 * Keyboard: on the canvas, ] and [ (or PageDown/PageUp) pick the next/previous object, arrow keys move the
 * picked point or slider (Shift for small steps; the view pans when nothing movable is picked), Delete removes
 * it, Escape lets go, Ctrl/⌘+Z undoes, + and − zoom, Enter uses the current tool on the picked object.
 */

export interface GeometryHost {
  toast: (m: string) => void;
}

const STORE_KEY = 'lemma.geometry';

type ToolId =
  | 'move'
  | 'point'
  | 'segment'
  | 'line'
  | 'circle'
  | 'polygon'
  | 'regular'
  | 'midpoint'
  | 'perpendicular'
  | 'parallel'
  | 'perpBisector'
  | 'angleBisector'
  | 'compass'
  | 'tangents'
  | 'intersect'
  | 'reflect'
  | 'rotate'
  | 'translate'
  | 'dilate'
  | 'angle'
  | 'distance'
  | 'slider'
  | 'trace';
/** What a tool's next pick has to be. `point` makes a new point on empty space; `existing` doesn't. */
type Need = 'point' | 'existing' | 'line' | 'curve' | 'circle' | 'shape';
type Group = 'draw' | 'construct' | 'transform' | 'measure';
interface Tool {
  id: ToolId;
  label: string;
  group: Group;
  needs: Need[];
  hint: string;
  /** A number the tool needs (a slider's name works too). */
  param?: { label: string; value: string };
  /** The typed command that does the same thing, from the picks and the number. */
  cmd?: (p: Id[], param: string) => string;
}
const TOOLS: Tool[] = [
  { id: 'move', label: 'Move', group: 'draw', needs: [], hint: 'Drag a point to move it; drag empty space to pan' },
  { id: 'point', label: 'Point', group: 'draw', needs: ['point'], hint: 'Click to place a point' },
  { id: 'segment', label: 'Segment', group: 'draw', needs: ['point', 'point'], hint: 'Pick two points' },
  { id: 'line', label: 'Line', group: 'draw', needs: ['point', 'point'], hint: 'Pick two points' },
  { id: 'circle', label: 'Circle', group: 'draw', needs: ['point', 'point'], hint: 'Pick the centre, then a point on the circle' },
  { id: 'polygon', label: 'Polygon', group: 'draw', needs: [], hint: 'Pick corners; pick the first one again to finish' },
  { id: 'regular', label: 'Regular polygon', group: 'draw', needs: ['point', 'point'], hint: 'Pick two points for one side', param: { label: 'Sides', value: '6' }, cmd: ([a, b], n) => `regular polygon ${a} ${b} ${n}` },
  { id: 'midpoint', label: 'Midpoint', group: 'construct', needs: ['point', 'point'], hint: 'Pick two points' },
  { id: 'perpendicular', label: 'Perpendicular', group: 'construct', needs: ['line', 'point'], hint: 'Pick a line, then a point' },
  { id: 'parallel', label: 'Parallel', group: 'construct', needs: ['line', 'point'], hint: 'Pick a line, then a point' },
  { id: 'perpBisector', label: 'Perp. bisector', group: 'construct', needs: ['point', 'point'], hint: 'Pick two points', cmd: ([a, b]) => `perpendicular bisector of ${a} ${b}` },
  { id: 'angleBisector', label: 'Angle bisector', group: 'construct', needs: ['point', 'point', 'point'], hint: 'Pick three points; the middle one is the vertex', cmd: ([a, b, c]) => `angle bisector of ${a} ${b} ${c}` },
  { id: 'compass', label: 'Compass', group: 'construct', needs: ['point', 'point', 'point'], hint: 'Pick two points for the radius, then the centre', cmd: ([a, b, c]) => `compass ${c} radius ${a} ${b}` },
  { id: 'tangents', label: 'Tangents', group: 'construct', needs: ['point', 'circle'], hint: 'Pick a point, then a circle', cmd: ([p, c]) => `tangents from ${p} to ${c}` },
  { id: 'intersect', label: 'Intersect', group: 'construct', needs: ['curve', 'curve'], hint: 'Pick two lines or circles', cmd: ([a, b]) => `intersect ${a} and ${b}` },
  { id: 'reflect', label: 'Reflect', group: 'transform', needs: ['shape', 'line'], hint: 'Pick what to reflect, then the mirror line', cmd: ([o, l]) => `reflect ${o} over ${l}` },
  { id: 'rotate', label: 'Rotate', group: 'transform', needs: ['shape', 'point'], hint: 'Pick what to turn, then the centre', param: { label: 'Angle °', value: '90' }, cmd: ([o, c], a) => `rotate ${o} about ${c} by ${a}` },
  { id: 'translate', label: 'Translate', group: 'transform', needs: ['shape', 'point', 'point'], hint: 'Pick what to move, then two points for the vector', cmd: ([o, a, b]) => `translate ${o} from ${a} to ${b}` },
  { id: 'dilate', label: 'Dilate', group: 'transform', needs: ['shape', 'point'], hint: 'Pick what to scale, then the centre', param: { label: 'Factor', value: '2' }, cmd: ([o, c], k) => `dilate ${o} from ${c} by ${k}` },
  { id: 'angle', label: 'Angle', group: 'measure', needs: ['point', 'point', 'point'], hint: 'Pick three points; the middle one is the vertex' },
  { id: 'distance', label: 'Length', group: 'measure', needs: ['point', 'point'], hint: 'Pick two points' },
  { id: 'slider', label: 'Slider', group: 'measure', needs: [], hint: 'Click the canvas to add a slider', param: { label: 'Range', value: '0 to 5' } },
  { id: 'trace', label: 'Trace', group: 'measure', needs: ['existing'], hint: 'Pick a point to leave a trail as it moves (pick again to stop)' },
];
const NEED_SAY: Record<Need, string> = {
  point: 'Now a point',
  existing: 'Pick a point',
  line: 'Now a line or segment',
  curve: 'Now another line or circle',
  circle: 'Now a circle',
  shape: 'Pick a point, line, circle or polygon',
};
const NEED_MISS: Record<Need, string> = {
  point: 'Pick a point',
  existing: 'Pick a point that’s already there',
  line: 'Pick a line or segment',
  curve: 'Pick a line, segment or circle',
  circle: 'Pick a circle',
  shape: 'Pick a point, line, circle or polygon',
};
type SnapMode = 'grid' | 'objects' | 'off';

interface Saved {
  version: 1;
  objects: GObj[];
  view?: { cx: number; cy: number; scale: number };
  /** Older saves: true = grid, false = off. */
  snap?: boolean;
  snapMode?: SnapMode;
  labels?: boolean;
  params?: Record<string, string>;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function mountGeometry(body: HTMLElement, host: GeometryHost): () => void {
  const saved = load();
  const fig = saved ? Construction.fromJSON(saved) : new Construction();
  const cmds = new GeometryCommands(fig);
  const view = { cx: 0, cy: 0, scale: 40, ...(saved?.view && Number.isFinite(saved.view.scale) && saved.view.scale > 0 ? saved.view : {}) };
  let snapMode: SnapMode = saved?.snapMode && ['grid', 'objects', 'off'].includes(saved.snapMode) ? saved.snapMode : saved?.snap === false ? 'off' : 'grid';
  let labelsOn = saved?.labels === true;
  const params: Record<string, string> = {};
  for (const t of TOOLS) if (t.param) params[t.id] = typeof saved?.params?.[t.id] === 'string' ? saved.params[t.id]!.slice(0, 40) : t.param.value;
  let tool: ToolId = 'move';
  let picks: Id[] = [];
  let selected: Id | null = null;
  let hover: Id | null = null;
  let firstFit = !saved?.view;
  /** Trails of traced points (null breaks the line where the point didn't exist). Not saved. */
  const trails = new Map<Id, (Vec | null)[]>();
  /** The measurement labels in the last frame (for tests and screen-reader checks). */
  let lastLabels: string[] = [];

  // ---------- DOM ----------
  const root = el('div', { className: 'geo' });
  const toolbar = el('div', { className: 'seg geo-tools' });
  toolbar.setAttribute('role', 'radiogroup');
  toolbar.setAttribute('aria-label', 'Geometry tool');
  let lastGroup: Group | null = null;
  for (const t of TOOLS) {
    if (lastGroup && t.group !== lastGroup) {
      const sep = el('span', { className: 'geo-sep' });
      sep.setAttribute('aria-hidden', 'true');
      toolbar.append(sep);
    }
    lastGroup = t.group;
    const b = el('button', { type: 'button', textContent: t.label, title: t.hint });
    b.dataset.tool = t.id;
    b.dataset.group = t.group;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(t.id === tool));
    b.setAttribute('aria-pressed', String(t.id === tool));
    b.addEventListener('click', () => setTool(t.id));
    toolbar.append(b);
  }

  // The number a tool needs (rotation angle, dilation factor, sides, slider range).
  const paramRow = el('div', { className: 'geo-param' });
  const paramLabel = el('label', { className: 'geo-param-label', htmlFor: 'geo-param-input' });
  const paramInput = el('input', { id: 'geo-param-input', className: 'geo-param-input', autocomplete: 'off', spellcheck: false } as Partial<HTMLInputElement>);
  const paramNote = el('span', { className: 'geo-param-note fine' });
  paramRow.append(paramLabel, paramInput, paramNote);
  paramRow.hidden = true;
  paramInput.addEventListener('input', () => {
    params[tool] = paramInput.value.slice(0, 40);
    save();
  });

  const stage = el('div', { className: 'geo-stage' });
  const canvas = el('canvas', { className: 'geo-canvas', tabIndex: 0 });
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Geometry canvas. ] and [ pick objects, arrow keys move the picked point, Delete removes it.');
  canvas.setAttribute('aria-describedby', 'geo-status');
  stage.append(canvas);

  const sliders = el('div', { className: 'geo-sliders' });
  sliders.setAttribute('aria-label', 'Sliders');
  sliders.setAttribute('role', 'group');

  const form = el('form', { className: 'answer-field geo-command' });
  const input = el('input', { placeholder: 'e.g. point A at (1, 2), rotate A about B by 90', autocomplete: 'off', spellcheck: false } as Partial<HTMLInputElement>);
  input.setAttribute('aria-label', 'Geometry command');
  input.setAttribute('enterkeyhint', 'go');
  const rec = new WebSpeechRecognizer();
  const mic = el('button', { type: 'button', className: 'btn geo-mic', textContent: 'Speak', title: 'Say a command' });
  mic.setAttribute('aria-pressed', 'false');
  mic.hidden = !rec.supported;
  const go = el('button', { type: 'submit', className: 'btn primary', textContent: 'Do it' });
  form.append(input, mic, go);

  const status = el('p', { className: 'geo-status fine', id: 'geo-status' });
  status.setAttribute('aria-live', 'polite');

  const undoBtn = button('Undo', () => act(fig.undo() ? 'Undone' : 'Nothing to undo'));
  const redoBtn = button('Redo', () => act(fig.redo() ? 'Redone' : 'Nothing to redo'));
  const labelsBtn = button('Labels', () => setLabels(!labelsOn));
  labelsBtn.title = 'Show lengths, angles and areas on the figure';
  labelsBtn.classList.add('geo-labels');
  const snapBox = el('div', { className: 'geo-snap' });
  snapBox.setAttribute('role', 'radiogroup');
  snapBox.setAttribute('aria-label', 'Snap');
  snapBox.append(el('span', { className: 'geo-snap-label', textContent: 'Snap' }));
  for (const [id, text, title] of [
    ['grid', 'Grid', 'New and dragged points land on the grid'],
    ['objects', 'Objects', 'Points stick to nearby points, lines and circles'],
    ['off', 'Off', 'No snapping'],
  ] as const) {
    const b = el('button', { type: 'button', textContent: text, title });
    b.dataset.snap = id;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      snapMode = id;
      syncSnap();
      save();
      say(id === 'grid' ? 'Points snap to the grid' : id === 'objects' ? 'Points snap to points and objects' : 'Snapping off');
    });
    snapBox.append(b);
  }
  const fitBtn = button('Fit', () => {
    fit();
    draw();
  });
  const clearBtn = button('Clear', () => act(fig.objects.length ? (fig.clear(), 'Cleared. Undo brings it back') : 'Nothing to clear'));
  const clearTraceBtn = button('Clear trace', () => {
    clearTrails();
    say('Trace cleared');
  });
  const pngBtn = button('Export PNG', () => exportPng());
  const svgBtn = button('Export SVG', () => exportSvg());
  const actions = el('div', { className: 'btn-row geo-actions' }, undoBtn, redoBtn, labelsBtn, snapBox, fitBtn, clearBtn, clearTraceBtn, pngBtn, svgBtn);

  const list = el('ul', { className: 'geo-list' });
  list.setAttribute('aria-label', 'Objects');
  const help = el(
    'details',
    { className: 'geo-help' },
    el('summary', { textContent: 'Commands and keys' }),
    el(
      'p',
      { className: 'fine' },
      '“point A at (1, 2)”, “segment AB”, “line through A and B”, “circle centered A through B”, “circle at A radius 3”, “triangle ABC”, “regular polygon AB 6”, “midpoint of AB”, “perpendicular to AB through C”, “parallel to AB through C”, “perpendicular bisector of AB”, “angle bisector of ABC”, “compass A radius BC”, “tangents from P to c1”, “intersect c1 and AB”.',
    ),
    el('p', { className: 'fine' }, '“reflect P over AB”, “rotate P about A by 90”, “translate P by AB”, “dilate P from A by 2”. Images follow what they’re made from.'),
    el('p', { className: 'fine' }, '“slider k from 0 to 5”, “set k to 2”; use k as an angle, factor, radius or number of sides (“rotate P about A by k”). “trace P”, “trace P off”, “clear trace”, “show labels”, “hide labels”.'),
    el('p', { className: 'fine' }, '“measure angle ABC”, “measure AB”, “move A to (3, 4)”, “delete C”, “undo”, “redo”, “clear”.'),
    el('p', { className: 'fine' }, 'On the canvas: ] and [ pick the next or previous object, arrow keys move the picked point or slider (Shift for small steps), Enter uses the tool on it, Delete removes it, Escape lets go, Ctrl/⌘+Z undoes, + and − zoom.'),
  );

  root.append(toolbar, paramRow, stage, sliders, form, status, actions, list, help);
  body.append(root);

  // ---------- helpers ----------
  const values = () => fig.values();
  const visible = () => fig.objects.filter((o) => !o.hidden && values().get(o.id));
  const W = () => canvas.clientWidth || 600;
  const H = () => canvas.clientHeight || 380;
  const toScreen = (p: Vec): Vec => ({ x: W() / 2 + (p.x - view.cx) * view.scale, y: H() / 2 - (p.y - view.cy) * view.scale });
  const toWorld = (x: number, y: number): Vec => ({ x: view.cx + (x - W() / 2) / view.scale, y: view.cy - (y - H() / 2) / view.scale });
  const gridStep = () => {
    const raw = 40 / view.scale;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw * 0.99) ?? p * 10;
  };
  const snapStep = () => Math.min(1, gridStep());
  /** Where a new or dragged point lands. `skip` are objects it mustn't stick to (itself and what's built on it). */
  function snapPt(p: Vec, skip: Set<Id> = new Set()): Vec {
    if (snapMode === 'grid') return { x: snap(p.x, snapStep()), y: snap(p.y, snapStep()) };
    if (snapMode === 'objects') {
      const tol = 12 / view.scale;
      let best: Vec | null = null;
      let bestD = Infinity;
      for (const pass of [true, false]) {
        for (const o of visible()) {
          if (skip.has(o.id)) continue;
          const v = values().get(o.id)!;
          if ((v.type === 'point') !== pass) continue;
          const q = nearestOn(v, p);
          if (!q) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d <= tol && d < bestD) [best, bestD] = [q, d];
        }
        if (best) return { x: round(best.x), y: round(best.y) };
      }
    }
    return { x: round(p.x), y: round(p.y) };
  }
  const shapeOfId = (id: Id): Shape | undefined => fig.shape(id);
  const matches = (need: Need, id: Id) => {
    const v = values().get(id);
    const sh = shapeOfId(id);
    if (need === 'point' || need === 'existing') return v?.type === 'point';
    if (need === 'line') return v?.type === 'line';
    if (need === 'circle') return v?.type === 'circle';
    if (need === 'shape') return !!v && (sh === 'point' || sh === 'segment' || sh === 'line' || sh === 'circle' || sh === 'polygon');
    return v?.type === 'line' || v?.type === 'circle';
  };

  /** The object under a screen position: points first, then the nearest other object. */
  function hit(sx: number, sy: number, filter: (id: Id) => boolean = () => true): Id | null {
    const q = toWorld(sx, sy);
    const tol = 10 / view.scale;
    let best: Id | null = null;
    let bestD = Infinity;
    for (const pass of [true, false]) {
      for (const o of visible()) {
        const v = values().get(o.id)!;
        if ((v.type === 'point') !== pass || !filter(o.id)) continue;
        const d = distanceTo(v, q);
        if (d <= (pass ? tol * 1.4 : tol) && d < bestD) [best, bestD] = [o.id, d];
      }
      if (best) return best;
    }
    return best;
  }

  function say(msg: string) {
    status.textContent = msg;
  }

  function act(msg: string) {
    if (selected && !fig.has(selected)) selected = null;
    picks = picks.filter((p) => fig.has(p));
    say(msg);
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 150);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    const data: Saved = { ...fig.toJSON(), view: { cx: view.cx, cy: view.cy, scale: view.scale }, snap: snapMode === 'grid', snapMode, labels: labelsOn, params };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      say('Couldn’t save on this device (storage is full or turned off). Your figure stays until you close this.');
    }
  }

  // ---------- trails (locus) ----------
  function recordTrails() {
    const vals = values();
    for (const id of trails.keys()) if (!fig.get(id)?.trace) trails.delete(id);
    for (const o of fig.objects) {
      if (!o.trace) continue;
      const v = vals.get(o.id);
      let t = trails.get(o.id);
      if (!t) trails.set(o.id, (t = []));
      const last = t[t.length - 1];
      if (v?.type === 'point') {
        if (!last || Math.hypot(last.x - v.p.x, last.y - v.p.y) > 1e-9) t.push({ x: v.p.x, y: v.p.y });
      } else if (last) t.push(null);
      if (t.length > 4000) t.splice(0, t.length - 4000);
    }
    clearTraceBtn.hidden = !fig.objects.some((o) => o.trace) && !trails.size;
  }
  /** Empties the trails; traced points start a new one when they next move. */
  function clearTrails() {
    trails.clear();
    clearTraceBtn.hidden = !fig.objects.some((o) => o.trace);
    draw();
  }

  fig.onChange = () => {
    if (selected && !fig.has(selected)) selected = null;
    recordTrails();
    renderList();
    renderSliders();
    draw();
    save();
  };

  function setTool(id: ToolId) {
    tool = id;
    picks = [];
    for (const b of toolbar.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-checked', String(b.dataset.tool === id));
      b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    }
    root.dataset.tool = id;
    const t = TOOLS.find((x) => x.id === id)!;
    paramRow.hidden = !t.param;
    if (t.param) {
      paramLabel.textContent = t.param.label;
      paramInput.value = params[id] ?? t.param.value;
      paramInput.inputMode = id === 'slider' ? 'text' : 'decimal';
      paramNote.textContent = id === 'slider' ? 'like “0 to 5”' : 'a number or a slider’s name';
    }
    say(t.hint);
    draw();
  }

  function setLabels(on: boolean) {
    labelsOn = on;
    labelsBtn.setAttribute('aria-pressed', String(on));
    root.dataset.labels = String(on);
    save();
    say(on ? 'Measurement labels shown' : 'Measurement labels hidden');
    draw();
  }

  function syncSnap() {
    for (const b of snapBox.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-checked', String(b.dataset.snap === snapMode));
      b.setAttribute('aria-pressed', String(b.dataset.snap === snapMode));
    }
  }

  const desc = (id: Id) => describe(fig.get(id)!, values().get(id), fig);

  function select(id: Id | null, announce = true) {
    selected = id;
    for (const li of list.querySelectorAll<HTMLElement>('li')) li.classList.toggle('is-selected', li.dataset.id === id);
    if (announce && id) {
      const k = fig.get(id)!.def.kind;
      say(`${desc(id)}${k === 'point' ? '. Arrow keys move it' : k === 'slider' ? '. Arrow keys change it' : ''}`);
    }
    draw();
  }

  function renderList() {
    const objs = fig.objects.filter((o) => !o.hidden);
    list.replaceChildren(
      ...objs.map((o) => {
        const li = el('li');
        li.dataset.id = o.id;
        li.classList.toggle('is-selected', o.id === selected);
        const pick = el('button', { type: 'button', className: 'geo-item', textContent: describe(o, values().get(o.id), fig) + (o.trace ? ' · tracing' : '') });
        pick.addEventListener('click', () => select(o.id));
        const del = el('button', { type: 'button', className: 'icon-btn geo-del', textContent: '×', title: `Delete ${o.id}` });
        del.setAttribute('aria-label', `Delete ${o.id}`);
        del.addEventListener('click', () => {
          const gone = fig.remove(o.id);
          act(gone.length > 1 ? `Deleted ${o.id} and what was built on it` : `Deleted ${o.id}`);
        });
        li.append(pick, del);
        return li;
      }),
    );
    if (!objs.length) list.append(el('li', { className: 'geo-empty fine', textContent: 'Nothing here yet. Pick a tool, or type “point A at (1, 2)”.' }));
    undoBtn.disabled = !fig.canUndo;
    redoBtn.disabled = !fig.canRedo;
  }

  /** Range inputs for the sliders. Rebuilt only when sliders come or go, so a drag in progress isn't cut off. */
  let sliderKey = '';
  let sliderDrag: Id | null = null;
  function renderSliders() {
    const ss = fig.objects.filter((o) => o.def.kind === 'slider');
    const key = ss.map((o) => (o.def.kind === 'slider' ? `${o.id}:${o.def.min}:${o.def.max}:${o.def.step ?? ''}` : '')).join('|');
    if (key !== sliderKey) {
      sliderKey = key;
      sliders.replaceChildren(
        ...ss.map((o) => {
          const v = values().get(o.id);
          const row = el('div', { className: 'geo-slider' });
          row.dataset.id = o.id;
          const name = el('label', { className: 'geo-slider-name', textContent: o.id, htmlFor: `geo-slider-${o.id}` });
          const range = el('input', { type: 'range', id: `geo-slider-${o.id}`, className: 'geo-slider-input' } as Partial<HTMLInputElement>);
          if (v?.type === 'number') {
            range.min = String(v.min);
            range.max = String(v.max);
            range.step = String(v.step);
            range.value = String(v.value);
          }
          range.setAttribute('aria-label', `Slider ${o.id}`);
          const out = el('output', { className: 'geo-slider-value' });
          out.setAttribute('for', range.id);
          range.addEventListener('pointerdown', () => {
            if (sliderDrag !== o.id) {
              fig.beginChange();
              sliderDrag = o.id;
            }
          });
          range.addEventListener('input', () => {
            // Keyboard or a programmatic change: each change is its own undo step.
            const record = sliderDrag !== o.id;
            fig.setSlider(o.id, Number(range.value), record);
            if (record) sliderDrag = o.id;
            say(desc(o.id));
          });
          range.addEventListener('change', () => {
            sliderDrag = null;
          });
          row.append(name, range, out);
          return row;
        }),
      );
    }
    for (const row of sliders.querySelectorAll<HTMLElement>('.geo-slider')) {
      const v = values().get(row.dataset.id!);
      if (v?.type !== 'number') continue;
      const range = row.querySelector<HTMLInputElement>('input')!;
      if (Number(range.value) !== v.value && sliderDrag !== row.dataset.id) range.value = String(v.value);
      row.querySelector('output')!.textContent = formatNumber(v.value, 3);
    }
    sliders.hidden = !ss.length;
  }

  /** Keeps every visible point on screen (used on first open). */
  function fit() {
    const pts: Vec[] = [];
    for (const o of visible()) {
      const v = values().get(o.id)!;
      if (v.type === 'point') pts.push(v.p);
      else if (v.type === 'circle') pts.push({ x: v.c.x - v.r, y: v.c.y - v.r }, { x: v.c.x + v.r, y: v.c.y + v.r });
      else if (v.type === 'polygon') pts.push(...v.pts);
    }
    if (!pts.length) {
      view.cx = view.cy = 0;
      view.scale = Math.max(24, Math.min(48, W() / 16));
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    view.cx = (x0 + x1) / 2;
    view.cy = (y0 + y1) / 2;
    view.scale = Math.max(4, Math.min(120, Math.min((W() - 60) / Math.max(1, x1 - x0), (H() - 60) / Math.max(1, y1 - y0))));
  }

  // ---------- drawing ----------
  function colors() {
    const cs = getComputedStyle(root);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return {
      bg: v('--surface', '#fff'),
      ink: v('--ink', '#141416'),
      muted: v('--muted', '#6c6c72'),
      faint: v('--faint', '#a4a4a8'),
      grid: v('--line', '#dcdbd4'),
      accent: v('--accent', '#4d6b00'),
      line: v('--g1', '#2d70b3'),
      circle: v('--g2', '#c74440'),
      poly: v('--g3', '#388c46'),
      measure: v('--g4', '#6042a6'),
      image: v('--g5', '#e07a10'),
      trace: v('--g6', '#127a7a'),
      font: v('--sans', 'system-ui, sans-serif'),
    };
  }
  const CONSTRUCTION_LINES = new Set(['perpendicular', 'parallel', 'perpBisector', 'angleBisector', 'tangent']);

  function draw(ctx?: CanvasRenderingContext2D, w = W(), h = H()) {
    const c = ctx ?? canvas.getContext('2d');
    if (!c) return;
    const col = colors();
    const labels: string[] = [];
    const chip = (text: string, x: number, y: number, color = col.muted) => {
      labels.push(text);
      label(c, text, x, y, color, col.bg, col.font);
    };
    c.save();
    c.fillStyle = col.bg;
    c.fillRect(0, 0, w, h);
    // Grid and axes
    const step = gridStep();
    const tl = toWorld(0, 0);
    const br = toWorld(w, h);
    c.lineWidth = 1;
    c.strokeStyle = col.grid;
    c.beginPath();
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const sx = Math.round(toScreen({ x, y: 0 }).x) + 0.5;
      c.moveTo(sx, 0);
      c.lineTo(sx, h);
    }
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
      const sy = Math.round(toScreen({ x: 0, y }).y) + 0.5;
      c.moveTo(0, sy);
      c.lineTo(w, sy);
    }
    c.stroke();
    const o = toScreen({ x: 0, y: 0 });
    c.strokeStyle = col.faint;
    c.lineWidth = 1.25;
    c.beginPath();
    c.moveTo(0, Math.round(o.y) + 0.5);
    c.lineTo(w, Math.round(o.y) + 0.5);
    c.moveTo(Math.round(o.x) + 0.5, 0);
    c.lineTo(Math.round(o.x) + 0.5, h);
    c.stroke();
    c.fillStyle = col.muted;
    c.font = `11px ${col.font}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    const ly = Math.min(h - 14, Math.max(2, o.y + 3));
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) if (Math.abs(x) > step / 2) c.fillText(formatNumber(x, 4), toScreen({ x, y: 0 }).x, ly);
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    const lx = Math.min(w - 4, Math.max(24, o.x - 4));
    for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) if (Math.abs(y) > step / 2) c.fillText(formatNumber(y, 4), lx, toScreen({ x: 0, y }).y);

    // Trails, under everything else.
    c.strokeStyle = col.trace;
    c.fillStyle = col.trace;
    c.lineWidth = 2.5;
    c.globalAlpha = 0.6;
    for (const t of trails.values()) {
      c.beginPath();
      let pen = false;
      for (const p of t) {
        if (!p) {
          pen = false;
          continue;
        }
        const s = toScreen(p);
        if (pen) c.lineTo(s.x, s.y);
        else c.moveTo(s.x, s.y);
        pen = true;
      }
      c.stroke();
    }
    c.globalAlpha = 1;

    const vals = values();
    const objs = visible();
    const kindOrder = (v: Value) => (v.type === 'polygon' ? 0 : v.type === 'point' ? 2 : 1);
    const ordered = [...objs].sort((a, b) => kindOrder(vals.get(a.id)!) - kindOrder(vals.get(b.id)!));
    const sideKeys = new Set<string>();
    const key = (a: Vec, b: Vec) => [a, b].map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort().join('|');
    const lengthLabel = (a: Vec, b: Vec, inside?: Vec) => {
      const k = key(a, b);
      if (sideKeys.has(k)) return;
      sideKeys.add(k);
      const sa = toScreen(a);
      const sb = toScreen(b);
      const len = Math.hypot(sb.x - sa.x, sb.y - sa.y);
      if (len < 28) return;
      let nx = -(sb.y - sa.y) / len;
      let ny = (sb.x - sa.x) / len;
      // Away from the polygon's middle, so the label sits outside.
      if (inside) {
        const si = toScreen(inside);
        if (nx * (si.x - (sa.x + sb.x) / 2) + ny * (si.y - (sa.y + sb.y) / 2) > 0) [nx, ny] = [-nx, -ny];
      }
      chip(formatNumber(Math.hypot(b.x - a.x, b.y - a.y)), (sa.x + sb.x) / 2 + nx * 13, (sa.y + sb.y) / 2 + ny * 13);
    };
    for (const ob of ordered) {
      const v = vals.get(ob.id)!;
      const sel = ob.id === selected || picks.includes(ob.id);
      const hov = ob.id === hover;
      const image = isTransform(ob.def);
      c.lineWidth = sel ? 3.5 : hov ? 2.75 : 2;
      c.setLineDash([]);
      switch (v.type) {
        case 'polygon': {
          const colr = image ? col.image : col.poly;
          c.beginPath();
          v.pts.forEach((p, i) => {
            const s = toScreen(p);
            if (i) c.lineTo(s.x, s.y);
            else c.moveTo(s.x, s.y);
          });
          c.closePath();
          c.fillStyle = colr;
          c.globalAlpha = 0.14;
          c.fill();
          c.globalAlpha = 1;
          c.strokeStyle = colr;
          c.stroke();
          break;
        }
        case 'line': {
          c.strokeStyle = image ? col.image : col.line;
          if (CONSTRUCTION_LINES.has(ob.def.kind)) c.setLineDash([7, 5]);
          const [a, b] = v.seg ?? clipLine(v.p, v.d, tl, br);
          const sa = toScreen(a);
          const sb = toScreen(b);
          c.beginPath();
          c.moveTo(sa.x, sa.y);
          c.lineTo(sb.x, sb.y);
          c.stroke();
          break;
        }
        case 'circle': {
          const s = toScreen(v.c);
          c.strokeStyle = image ? col.image : col.circle;
          if (ob.def.kind === 'compass') c.setLineDash([2, 5]);
          c.beginPath();
          c.arc(s.x, s.y, v.r * view.scale, 0, Math.PI * 2);
          c.stroke();
          break;
        }
        case 'angle': {
          const s = toScreen(v.at);
          const r = 26;
          c.strokeStyle = col.measure;
          c.fillStyle = col.measure;
          c.beginPath();
          c.moveTo(s.x, s.y);
          // Screen y is flipped, so angles are negated.
          c.arc(s.x, s.y, r, -v.from, -(v.from + v.sweep), v.sweep > 0);
          c.closePath();
          c.globalAlpha = 0.14;
          c.fill();
          c.globalAlpha = 1;
          c.stroke();
          const mid = v.from + v.sweep / 2;
          chip(`${formatNumber(v.deg, 1)}°`, s.x + Math.cos(mid) * (r + 16), s.y - Math.sin(mid) * (r + 16), col.measure);
          break;
        }
        case 'distance': {
          const a = toScreen(v.a);
          const b = toScreen(v.b);
          c.strokeStyle = col.measure;
          c.setLineDash([3, 4]);
          c.globalAlpha = 0.6;
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
          c.globalAlpha = 1;
          chip(`${ob.def.kind === 'distance' ? ob.def.a + ob.def.b : ''} = ${formatNumber(v.length)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, col.measure);
          break;
        }
        case 'point': {
          const s = toScreen(v.p);
          const r = sel ? 6.5 : 5;
          if (sel) {
            c.fillStyle = col.accent;
            c.globalAlpha = 0.25;
            c.beginPath();
            c.arc(s.x, s.y, 12, 0, Math.PI * 2);
            c.fill();
            c.globalAlpha = 1;
          }
          c.beginPath();
          c.arc(s.x, s.y, r, 0, Math.PI * 2);
          c.fillStyle = v.free ? col.accent : image ? col.image : col.bg;
          c.fill();
          c.lineWidth = 2;
          c.strokeStyle = v.free ? col.ink : image ? col.image : col.muted;
          c.stroke();
          c.fillStyle = col.ink;
          c.font = `600 13px ${col.font}`;
          c.textAlign = 'left';
          c.textBaseline = 'bottom';
          c.fillText(ob.id, s.x + 7, s.y - 5);
          break;
        }
      }
    }

    // Measurement labels on the figure: side lengths, polygon corner angles, areas.
    if (labelsOn) {
      for (const ob of ordered) {
        const v = vals.get(ob.id)!;
        if (v.type === 'polygon') {
          const n = v.pts.length;
          const mid = { x: v.pts.reduce((s, p) => s + p.x, 0) / n, y: v.pts.reduce((s, p) => s + p.y, 0) / n };
          let signed = 0;
          for (let i = 0; i < n; i++) signed += v.pts[i]!.x * v.pts[(i + 1) % n]!.y - v.pts[(i + 1) % n]!.x * v.pts[i]!.y;
          for (let i = 0; i < n; i++) {
            const p = v.pts[(i + n - 1) % n]!;
            const q = v.pts[i]!;
            const r = v.pts[(i + 1) % n]!;
            lengthLabel(q, r, mid);
            // Interior angle at q, swept from q→r round to q→p on the inside.
            const u = { x: r.x - q.x, y: r.y - q.y };
            const w2 = { x: p.x - q.x, y: p.y - q.y };
            let a = Math.atan2(u.x * w2.y - u.y * w2.x, u.x * w2.x + u.y * w2.y);
            if (signed < 0) a = -a;
            if (a < 0) a += Math.PI * 2;
            // Corners whose sides are only a few pixels long would just pile labels up.
            if (Math.min(Math.hypot(u.x, u.y), Math.hypot(w2.x, w2.y)) * view.scale < 70) continue;
            const start = Math.atan2(u.y, u.x);
            const bis = start + (signed < 0 ? -a / 2 : a / 2);
            const s = toScreen(q);
            chip(`${formatNumber((a * 180) / Math.PI, 1)}°`, s.x + Math.cos(bis) * 24, s.y - Math.sin(bis) * 24, col.measure);
          }
          const sm = toScreen(mid);
          if (v.area * view.scale * view.scale > 2500) chip(`area ${formatNumber(v.area)}`, sm.x, sm.y);
        } else if (v.type === 'line' && v.seg) {
          lengthLabel(v.seg[0], v.seg[1]);
        } else if (v.type === 'circle') {
          const s = toScreen(v.c);
          const rr = v.r * view.scale;
          chip(`r ${formatNumber(v.r)} · area ${formatNumber(Math.PI * v.r * v.r)}`, s.x, s.y + Math.min(rr * 0.5, 22) + 10);
        }
      }
    }
    c.restore();
    if (!ctx || ctx instanceof SvgContext) lastLabels = labels;
  }

  // ---------- canvas sizing ----------
  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr());
    canvas.height = Math.round(h * dpr());
    canvas.getContext('2d')?.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    if (firstFit) {
      fit();
      firstFit = false;
    }
    draw();
  }
  // Resized on the next frame, not inside the observer callback (which would trip "ResizeObserver loop" errors).
  let resizeRaf = 0;
  const ro =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(resize);
        });
  ro?.observe(stage);
  // Theme switches (Settings → Look, or the system's light/dark) change the tokens the canvas reads.
  const mo = new MutationObserver(() => draw());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look', 'style', 'class'] });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onScheme = () => draw();
  mq?.addEventListener?.('change', onScheme);
  requestAnimationFrame(resize);

  // ---------- tool clicks ----------
  function pointAt(sx: number, sy: number): Id {
    const existing = hit(sx, sy, (id) => values().get(id)?.type === 'point');
    if (existing) return existing;
    const p = snapPt(toWorld(sx, sy));
    return fig.add({ def: { kind: 'point', x: p.x, y: p.y } })[0]!.id;
  }

  /** Carries out a tool by its typed command, so the toolbar and the command box always agree. */
  function runTool(text: string) {
    picks = [];
    const r = cmds.run(text);
    report(r);
    if (r.ok && r.select) select(r.select, false);
    say(r.message);
    draw();
  }

  function toolClick(sx: number, sy: number, picked?: Id) {
    if (tool === 'point') {
      const before = fig.objects.length;
      const id = pointAt(sx, sy);
      select(id, false);
      say(fig.objects.length > before ? desc(id) : `${id} is already there`);
      return;
    }
    if (tool === 'slider') return runTool(`slider from ${params.slider || '0 to 5'}`);
    if (tool === 'polygon') {
      const id = picked && matches('point', picked) ? picked : pointAt(sx, sy);
      if (picks.length >= 3 && id === picks[0]) {
        finish({ kind: 'polygon', pts: picks });
        return;
      }
      if (picks.includes(id)) return say('Pick a different point, or the first one to finish');
      picks.push(id);
      say(`Corners: ${picks.join(', ')}. ${picks.length >= 3 ? `Pick ${picks[0]} again to finish` : 'Pick the next corner'}`);
      draw();
      return;
    }
    const spec = TOOLS.find((t) => t.id === tool)!;
    const need = spec.needs[picks.length];
    if (!need) return;
    let id: Id | null;
    if (picked && matches(need, picked)) id = picked;
    else if (need === 'point') id = pointAt(sx, sy);
    else id = hit(sx, sy, (i) => matches(need, i));
    if (!id) return say(NEED_MISS[need]);
    if (tool === 'trace') {
      return runTool(fig.get(id)?.trace ? `trace ${id} off` : `trace ${id}`);
    }
    if (picks.includes(id)) return say('Pick a different one');
    picks.push(id);
    if (picks.length < spec.needs.length) {
      say(`${picks.join(', ')} picked. ${NEED_SAY[spec.needs[picks.length]!]}`);
      draw();
      return;
    }
    if (spec.cmd) return runTool(spec.cmd(picks, params[tool] ?? spec.param?.value ?? ''));
    const [a, b, c] = picks as [Id, Id, Id];
    switch (tool) {
      case 'segment':
      case 'line':
      case 'midpoint':
      case 'distance':
        return finish({ kind: tool, a, b });
      case 'circle':
        return finish({ kind: 'circle', center: a, through: b });
      case 'perpendicular':
      case 'parallel':
        return finish({ kind: tool, line: a, through: b });
      case 'angle':
        return finish({ kind: 'angle', a, b, c });
    }
  }

  function finish(def: Def) {
    picks = [];
    try {
      const [o] = fig.add({ def });
      select(o!.id, false);
      say(desc(o!.id));
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
      draw();
    }
  }

  // ---------- pointer ----------
  let drag: { id: Id | null; start: Vec; view: Vec; moved: boolean; pointer: number; recorded: boolean; skip: Set<Id> } | null = null;
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    const p = local(e);
    if (tool === 'move') {
      const id = hit(p.x, p.y);
      if (id) select(id);
      const free = id && fig.get(id)?.def.kind === 'point' ? id : null;
      drag = { id: free, start: p, view: { x: view.cx, y: view.cy }, moved: false, pointer: e.pointerId, recorded: false, skip: free ? fig.dependents(free).add(free) : new Set() };
      if (!id) select(null, false);
    } else {
      drag = { id: null, start: p, view: { x: view.cx, y: view.cy }, moved: false, pointer: e.pointerId, recorded: false, skip: new Set() };
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic event) */
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!drag || drag.pointer !== e.pointerId) {
      const h = hit(p.x, p.y);
      if (h !== hover) {
        hover = h;
        canvas.style.cursor = h && tool === 'move' && fig.get(h)?.def.kind === 'point' ? 'grab' : '';
        draw();
      }
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3) return;
    drag.moved = true;
    if (drag.id) {
      if (!drag.recorded) {
        fig.beginChange();
        drag.recorded = true;
      }
      const w = snapPt(toWorld(p.x, p.y), drag.skip);
      fig.move(drag.id, w.x, w.y);
      say(desc(drag.id));
    } else if (tool === 'move') {
      view.cx = drag.view.x - (p.x - drag.start.x) / view.scale;
      view.cy = drag.view.y + (p.y - drag.start.y) / view.scale;
      draw();
    }
  });
  const end = (e: PointerEvent) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.moved && tool !== 'move') toolClick(d.start.x, d.start.y);
    if (d.moved && !d.id) save();
    if (d.id && d.moved) renderList();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => {
    if (drag?.pointer === e.pointerId) drag = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    },
    { passive: false },
  );
  function zoomAt(k: number, sx = W() / 2, sy = H() / 2) {
    const before = toWorld(sx, sy);
    view.scale = Math.max(4, Math.min(400, view.scale * k));
    const after = toWorld(sx, sy);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    draw();
    save();
  }

  // ---------- keyboard ----------
  canvas.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      act((e.shiftKey ? fig.redo() : fig.undo()) ? (e.shiftKey ? 'Redone' : 'Undone') : 'Nothing to undo');
      return;
    }
    if (mod) return;
    const objs = fig.objects.filter((o) => !o.hidden);
    if (e.key === ']' || e.key === '[' || e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (!objs.length) return say('Nothing to pick yet');
      const i = objs.findIndex((o) => o.id === selected);
      const fwd = e.key === ']' || e.key === 'PageDown';
      const next = objs[(i + (fwd ? 1 : -1) + objs.length + (i < 0 && !fwd ? 1 : 0)) % objs.length]!;
      select(next.id);
      return;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dy = e.key === 'ArrowDown' ? -1 : e.key === 'ArrowUp' ? 1 : 0;
      const o = selected ? fig.get(selected) : undefined;
      if (o?.def.kind === 'point') {
        const step = e.shiftKey || snapMode !== 'grid' ? 0.1 : snapStep();
        fig.move(o.id, round(o.def.x + dx * step), round(o.def.y + dy * step), true);
        say(desc(o.id));
      } else if (o?.def.kind === 'slider') {
        const v = values().get(o.id);
        const step = v?.type === 'number' ? v.step * (e.shiftKey ? 1 : 5) : 0.1;
        fig.setSlider(o.id, round(o.def.value + (dx + dy) * step), true);
        say(desc(o.id));
      } else {
        if (o) say(`${o.id} is built from other objects; move the points it depends on`);
        view.cx += (dx * 40) / view.scale;
        view.cy += (dy * 40) / view.scale;
        draw();
      }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      const id = selected;
      const gone = fig.remove(id);
      act(gone.length > 1 ? `Deleted ${id} and what was built on it` : `Deleted ${id}`);
      return;
    }
    if (e.key === 'Escape' && (selected || picks.length)) {
      e.preventDefault();
      e.stopPropagation();
      picks = [];
      select(null, false);
      say('Nothing picked');
      return;
    }
    if (e.key === '+' || e.key === '=') return zoomAt(1.25);
    if (e.key === '-' || e.key === '_') return zoomAt(0.8);
    if (e.key === 'Enter' && tool !== 'move') {
      // Keyboard clicking: acts on the picked object, or at the centre of the view.
      e.preventDefault();
      const v = selected ? values().get(selected) : undefined;
      const s = v?.type === 'point' ? toScreen(v.p) : { x: W() / 2, y: H() / 2 };
      toolClick(s.x, s.y, selected ?? undefined);
    }
  });

  // ---------- commands ----------
  /** What a command does beyond the figure (trails and labels live here). */
  function report(r: CommandResult) {
    if (!r.ok || !r.effect) return;
    if (r.effect === 'clearTrace') clearTrails();
    else setLabels(r.effect === 'labelsOn');
  }
  function runCommand(text: string) {
    const t = text.trim();
    if (!t) return;
    const r = cmds.run(t);
    report(r);
    say(r.message);
    if (r.ok) {
      input.value = '';
      if (r.select) select(r.select, false);
      // Keep new objects in view.
      const v = r.select ? values().get(r.select) : undefined;
      if (v?.type === 'point') {
        const s = toScreen(v.p);
        if (s.x < 10 || s.y < 10 || s.x > W() - 10 || s.y > H() - 10) fit();
      }
      draw();
    }
    root.dataset.lastOk = String(r.ok);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runCommand(input.value);
  });

  let listening = false;
  mic.addEventListener('click', () => {
    if (listening) {
      rec.stop();
      return;
    }
    listening = true;
    mic.setAttribute('aria-pressed', 'true');
    say('Listening… try “circle centered A through B”');
    rec.start(
      { lang: navigator.language || 'en-US', continuous: false, preferOnDevice: true },
      {
        onPartial: (t) => (input.value = t),
        onFinal: (t) => {
          input.value = t;
          runCommand(t);
        },
        onEnd: () => {
          listening = false;
          mic.setAttribute('aria-pressed', 'false');
        },
        onError: (m) => {
          listening = false;
          mic.setAttribute('aria-pressed', 'false');
          say(m);
        },
      },
    );
  });

  // ---------- export ----------
  /** Draws without the picking highlights. */
  function clean<T>(f: () => T): T {
    const keep = { selected, hover, picks };
    selected = hover = null;
    picks = [];
    try {
      return f();
    } finally {
      ({ selected, hover, picks } = keep);
    }
  }
  function download(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(`Saved ${name}`);
  }
  function exportPng() {
    const w = W();
    const h = H();
    const scale = 2;
    const off = document.createElement('canvas');
    off.width = w * scale;
    off.height = h * scale;
    const c = off.getContext('2d');
    if (!c) return host.toast('Couldn’t make the image');
    c.scale(scale, scale);
    clean(() => draw(c, w, h));
    off.toBlob((blob) => {
      if (!blob) return host.toast('Couldn’t make the image');
      download(blob, 'geometry.png');
    }, 'image/png');
  }
  function svgString(): string {
    const ctx = new SvgContext(W(), H());
    clean(() => draw(ctx as unknown as CanvasRenderingContext2D, W(), H()));
    draw();
    return ctx.toString();
  }
  function exportSvg() {
    download(new Blob([svgString()], { type: 'image/svg+xml' }), 'geometry.svg');
  }

  // For e2e tests: where an object is on screen (client coordinates), and what's drawn.
  const testHook = {
    screenOf(id: Id): Vec | null {
      const v = values().get(id);
      if (v?.type !== 'point') return null;
      const r = canvas.getBoundingClientRect();
      const s = toScreen(v.p);
      return { x: r.left + s.x, y: r.top + s.y };
    },
    svg: svgString,
    labels: () => [...lastLabels],
    trail: (id: Id) => (trails.get(id) ?? []).filter(Boolean).length,
  };
  (window as unknown as { __geometry?: typeof testHook }).__geometry = testHook;

  root.dataset.tool = tool;
  labelsBtn.setAttribute('aria-pressed', String(labelsOn));
  root.dataset.labels = String(labelsOn);
  syncSnap();
  recordTrails();
  renderList();
  renderSliders();
  say(fig.objects.length ? `${fig.objects.filter((o) => !o.hidden).length} objects restored` : 'Pick a tool, or type a command like “point A at (1, 2)”');

  return () => {
    saveNow();
    rec.stop();
    cancelAnimationFrame(resizeRaf);
    ro?.disconnect();
    mo.disconnect();
    mq?.removeEventListener?.('change', onScheme);
    fig.onChange = null;
    delete (window as unknown as { __geometry?: unknown }).__geometry;
  };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** The visible part of an infinite line, from the view's corners. */
function clipLine(p: Vec, d: Vec, tl: Vec, br: Vec): [Vec, Vec] {
  const span = Math.hypot(br.x - tl.x, br.y - tl.y);
  const cx = (tl.x + br.x) / 2;
  const cy = (tl.y + br.y) / 2;
  // Project the view centre onto the line, then go a view-diagonal either way.
  const t = (cx - p.x) * d.x + (cy - p.y) * d.y;
  const m = { x: p.x + d.x * t, y: p.y + d.y * t };
  return [
    { x: m.x - d.x * span, y: m.y - d.y * span },
    { x: m.x + d.x * span, y: m.y + d.y * span },
  ];
}

/** A soft rounded chip with a measurement in it. */
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bg: string, font: string) {
  c.font = `600 12px ${font}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = c.measureText(text).width + 10;
  const h = 18;
  const r = h / 2;
  const [x0, y0] = [x - w / 2, y - h / 2];
  c.fillStyle = bg;
  c.globalAlpha = 0.88;
  c.beginPath();
  c.arc(x0 + r, y0 + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  c.lineTo(x0 + w - r, y0);
  c.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = color;
  c.fillText(text, x, y);
}
