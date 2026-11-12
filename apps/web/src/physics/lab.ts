import { BLOCK, createSim, DT, FixedClock, paramsFor, parsePreset, SIMS, type AnySim, type Params, type SimId } from '@lemma/physics-engine';
import type { ToolContext } from '../study';
import { button, el, segmented } from '../study/ui';
import './physics.css';

/**
 * Study → Physics lab: five small simulations (projectile, pendulum, spring, collision, inclined plane), each
 * with sliders, play/pause/step/reset, a live readout, an energy check and a plot. The physics advances in fixed
 * steps of 1/240 s, so the numbers are the same on every device and frame rate. With reduced motion on, it
 * starts paused. `ctx.query` ("simulate a projectile at 20 m/s 45 degrees") opens a preset.
 */

export interface PhysicsHost {
  toast: (m: string) => void;
}

/** Steps per frame-sized Step press: 1/60 s. */
const STEP_STEPS = 4;
const SAMPLE_EVERY = 4;
const MAX_SAMPLES = 1200;
const ORDER: SimId[] = ['projectile', 'pendulum', 'spring', 'collision', 'incline'];

export function mountPhysics(body: HTMLElement, ctx: ToolContext, _host: PhysicsHost): () => void {
  const preset = ctx.query ? parsePreset(ctx.query) : null;
  let simId: SimId = preset?.sim ?? 'projectile';
  const params: Record<SimId, Params> = Object.fromEntries(ORDER.map((id) => [id, paramsFor(id)])) as Record<SimId, Params>;
  if (preset) params[preset.sim] = preset.params;
  const reduced = (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm';
    } catch {
      return false;
    }
  })();

  let sim: AnySim = createSim(simId, params[simId]);
  let E0 = sim.energy().total;
  let playing = !reduced;
  let steps = 0;
  let samples: number[][] = [];
  let trail: { x: number; y: number }[] = [];
  const clock = new FixedClock(DT);

  // ---------- DOM ----------
  const root = el('div', { className: 'phys' });
  const tabs = segmented(
    ORDER.map((id) => ({ id, label: SIMS[id].label })),
    simId,
    (id) => {
      simId = id as SimId;
      renderParams();
      reset();
    },
  );
  tabs.classList.add('phys-tabs');
  tabs.setAttribute('aria-label', 'Simulation');

  const stage = el('div', { className: 'phys-stage' });
  const scene = el('canvas', { className: 'phys-scene' });
  scene.setAttribute('role', 'img');
  stage.append(scene);

  const playBtn = button('Play', () => {
    if (sim.done) reset();
    setPlaying(!playing);
  });
  playBtn.classList.add('primary', 'phys-play');
  const stepBtn = button('Step', () => {
    setPlaying(false);
    if (sim.done) return;
    for (let i = 0; i < STEP_STEPS; i++) tick();
    render();
  });
  const resetBtn = button('Reset', () => reset());
  const status = el('p', { className: 'phys-status fine' });
  status.setAttribute('aria-live', 'polite');
  const controls = el('div', { className: 'btn-row phys-controls' }, playBtn, stepBtn, resetBtn);

  const readout = el('dl', { className: 'phys-readout' });
  readout.setAttribute('aria-label', 'Readout');
  const plot = el('canvas', { className: 'phys-plot' });
  plot.setAttribute('role', 'img');
  const plotCap = el('p', { className: 'fine phys-plot-cap' });
  const plotBox = el('figure', { className: 'phys-plot-box' }, plot, plotCap);
  const energy = el('p', { className: 'phys-energy fine' });
  const live = el('div', { className: 'phys-live' }, readout, plotBox);
  const paramBox = el('div', { className: 'phys-params' });

  root.append(tabs, stage, controls, status, live, energy, paramBox);
  body.append(root);

  // ---------- params ----------
  function renderParams() {
    const p = params[simId];
    paramBox.replaceChildren(
      ...SIMS[simId].params.map((spec) => {
        const id = `phys-${simId}-${spec.key}`;
        if (spec.choices) {
          const seg = segmented(
            spec.choices.map((c) => ({ id: String(c.value), label: c.label })),
            String(p[spec.key]),
            (v) => {
              p[spec.key] = Number(v);
              reset();
            },
          );
          seg.setAttribute('aria-label', spec.label);
          return el('div', { className: 'phys-param phys-choice' }, el('span', { className: 'phys-label', textContent: spec.label }), seg);
        }
        const out = el('output', { className: 'phys-value' });
        out.htmlFor.add(id);
        const show = () => (out.textContent = `${fmt(p[spec.key]!, decimals(spec.step))}${spec.unit ? ` ${spec.unit}` : ''}`);
        const range = el('input', { type: 'range', id, min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(p[spec.key]) });
        range.dataset.key = spec.key;
        range.addEventListener('input', () => {
          p[spec.key] = Number(range.value);
          show();
          reset();
        });
        show();
        return el('div', { className: 'phys-param' }, el('label', { className: 'phys-label', htmlFor: id, textContent: spec.label } as Partial<HTMLLabelElement>), range, out);
      }),
    );
  }

  // ---------- simulation ----------
  function reset() {
    sim = createSim(simId, params[simId]);
    E0 = sim.energy().total;
    steps = 0;
    samples = [];
    trail = [];
    clock.reset();
    record();
    if (reduced && !playing) status.textContent = 'Paused because reduced motion is on. Press Play or Step.';
    else status.textContent = '';
    render();
  }

  function tick() {
    if (sim.done) return;
    sim.step(DT);
    steps++;
    if (steps % SAMPLE_EVERY === 0 || sim.done) record();
  }

  function record() {
    samples.push([sim.t, ...sim.sample()]);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    if (sim.id === 'projectile') trail.push({ x: sim.y[0]!, y: sim.y[1]! });
  }

  function setPlaying(on: boolean) {
    playing = on;
    playBtn.textContent = on ? 'Pause' : sim.done ? 'Replay' : 'Play';
    playBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      status.textContent = '';
      last = performance.now();
    }
  }

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!playing) return;
    clock.advance(dt, tick);
    if (sim.done) {
      setPlaying(false);
      status.textContent = doneMessage();
    }
    render();
  };

  function doneMessage(): string {
    switch (sim.id) {
      case 'projectile':
        return `Landed after ${fmt(sim.t, 2)} s, ${fmt(sim.y[0]!, 2)} m away`;
      case 'incline':
        return sim.stuck ? 'Friction holds the block' : `Reached the bottom after ${fmt(sim.t, 2)} s at ${fmt(sim.y[1]!, 2)} m/s`;
      default:
        return 'Finished';
    }
  }

  // ---------- rendering ----------
  function render() {
    renderReadout();
    drawScene();
    drawPlot();
    const e = sim.energy();
    const drift = Math.abs(E0) > 1e-12 ? (Math.abs(e.total - E0) / Math.abs(E0)) * 100 : 0;
    energy.textContent = `Energy: kinetic ${fmt(e.kinetic, 2)} J · potential ${fmt(e.potential, 2)} J · lost ${fmt(e.dissipated, 2)} J · total ${fmt(e.total, 3)} J (drift ${drift < 1e-6 ? '< 0.000001' : fmt(drift, 6)}%)`;
    energy.dataset.drift = String(drift);
    playBtn.textContent = playing ? 'Pause' : sim.done ? 'Replay' : 'Play';
    playBtn.setAttribute('aria-pressed', String(playing));
    stepBtn.disabled = sim.done;
  }

  function renderReadout() {
    const rows = sim.readouts();
    if (readout.childElementCount !== rows.length * 2 || readout.dataset.sim !== sim.id) {
      readout.replaceChildren();
      readout.dataset.sim = sim.id;
      for (const r of rows) {
        const dd = el('dd');
        dd.dataset.key = r.key;
        readout.append(el('dt', { textContent: r.label }), dd);
      }
    }
    for (const r of rows) {
      const dd = readout.querySelector<HTMLElement>(`dd[data-key="${r.key}"]`);
      if (dd) dd.textContent = typeof r.value === 'number' ? `${fmt(r.value, r.key === 'zeta' ? 3 : 2)}${r.unit ? ` ${r.unit}` : ''}` : r.value;
    }
  }

  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  function prep(c: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] | null {
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return null;
    const W = Math.round(w * dpr());
    const H = Math.round(h * dpr());
    if (c.width !== W || c.height !== H) [c.width, c.height] = [W, H];
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    return [g, w, h];
  }

  function colors() {
    const cs = getComputedStyle(root);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return { bg: v('--surface', '#fff'), ink: v('--ink', '#141416'), muted: v('--muted', '#6c6c72'), line: v('--line', '#dcdbd4'), accent: v('--accent', '#4d6b00'), a: v('--g1', '#c74440'), b: v('--g2', '#2d70b3'), c: v('--g3', '#388c46'), font: v('--sans', 'system-ui') };
  }

  function drawScene() {
    const got = prep(scene);
    if (!got) return;
    const [g, w, h] = got;
    const col = colors();
    g.fillStyle = col.bg;
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.font = `12px ${col.font}`;
    const p = sim.params;
    switch (sim.id) {
      case 'projectile': {
        const ideal = sim.ideal();
        const xMax = Math.max(5, ideal.range * 1.08, sim.y[0]! * 1.05);
        const yMax = Math.max(3, ideal.height * 1.15);
        const pad = 24;
        const k = Math.min((w - 2 * pad) / xMax, (h - 2 * pad) / yMax);
        const X = (x: number) => pad + x * k;
        const Y = (y: number) => h - pad - y * k;
        ground(g, col, 0, Y(0), w);
        if (p.h0! > 0) {
          g.fillStyle = col.line;
          g.fillRect(X(0) - 14, Y(p.h0!), 14, Y(0) - Y(p.h0!));
        }
        g.strokeStyle = col.a;
        g.lineWidth = 2;
        g.setLineDash([4, 4]);
        g.beginPath();
        trail.forEach((q, i) => (i ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))));
        g.stroke();
        g.setLineDash([]);
        const bx = X(sim.y[0]!);
        const by = Y(sim.y[1]!);
        arrow(g, bx, by, bx + sim.y[2]! * k * 0.25, by - sim.y[3]! * k * 0.25, col.b);
        ball(g, bx, by, 8, col.a, col.ink);
        g.fillStyle = col.muted;
        g.fillText(`${fmt(xMax, 0)} m`, w - pad - 30, h - 8);
        scene.setAttribute('aria-label', `Projectile at ${fmt(sim.y[0]!, 1)} m across and ${fmt(sim.y[1]!, 1)} m up`);
        break;
      }
      case 'pendulum': {
        const L = p.length!;
        const high = p.theta0! > 80;
        const px = w / 2;
        const py = high ? h / 2 : 18;
        const k = (high ? Math.min(w, h) * 0.42 : Math.min(h - 50, w * 0.45)) / L;
        const th = sim.y[0]!;
        const bx = px + Math.sin(th) * L * k;
        const by = py + Math.cos(th) * L * k;
        g.strokeStyle = col.line;
        g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        const a0 = (p.theta0! * Math.PI) / 180;
        g.arc(px, py, L * k, Math.PI / 2 - a0, Math.PI / 2 + a0);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = col.muted;
        g.fillRect(px - 30, py - 4, 60, 4);
        g.strokeStyle = col.ink;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(bx, by);
        g.stroke();
        ball(g, bx, by, 6 + 3 * Math.cbrt(p.mass!), col.a, col.ink);
        scene.setAttribute('aria-label', `Pendulum at ${fmt((th * 180) / Math.PI, 1)}°`);
        break;
      }
      case 'spring': {
        const k = (w - 80) / 3;
        const eq = 30 + 1.5 * k;
        const y = h / 2;
        const bx = eq + sim.y[0]! * k;
        g.fillStyle = col.muted;
        g.fillRect(12, y - 50, 8, 100);
        ground(g, col, 12, y + 26, w - 12);
        g.strokeStyle = col.line;
        g.setLineDash([3, 4]);
        g.beginPath();
        g.moveTo(eq, y - 50);
        g.lineTo(eq, y + 40);
        g.stroke();
        g.setLineDash([]);
        coil(g, 20, bx - 24, y, col.b);
        const s = 22 + 6 * Math.cbrt(p.mass!);
        g.fillStyle = col.a;
        g.strokeStyle = col.ink;
        g.lineWidth = 2;
        g.beginPath();
        g.rect(bx - 24, y + 26 - s, 48, s);
        g.fill();
        g.stroke();
        scene.setAttribute('aria-label', `Spring stretched ${fmt(sim.y[0]!, 2)} m`);
        break;
      }
      case 'collision': {
        const k = (w - 40) / 14;
        const X = (x: number) => w / 2 + x * k;
        const y = h * 0.62;
        ground(g, col, 0, y, w);
        const block = (x: number, m: number, v: number, color: string, name: string) => {
          const s = Math.max(16, BLOCK * k * (0.7 + 0.15 * Math.cbrt(m)));
          g.fillStyle = color;
          g.strokeStyle = col.ink;
          g.lineWidth = 2;
          g.beginPath();
          g.rect(X(x) - (BLOCK * k) / 2, y - s, BLOCK * k, s);
          g.fill();
          g.stroke();
          g.fillStyle = col.ink;
          g.textAlign = 'center';
          g.fillText(`${name} ${fmt(m, 1)} kg`, X(x), y - s - 22);
          g.textAlign = 'start';
          if (Math.abs(v) > 1e-9) arrow(g, X(x), y - s - 10, X(x) + v * k * 0.4, y - s - 10, col.ink);
        };
        block(sim.x1, p.m1!, sim.v1, col.a, 'm₁');
        block(sim.x2, p.m2!, sim.v2, col.b, 'm₂');
        scene.setAttribute('aria-label', `Blocks at ${fmt(sim.x1, 1)} m and ${fmt(sim.x2, 1)} m`);
        break;
      }
      case 'incline': {
        const th = (p.angle! * Math.PI) / 180;
        const L = p.length!;
        const pad = 30;
        const k = Math.min((w - 2 * pad) / (L * Math.cos(th) + 0.5), (h - 2 * pad) / (L * Math.sin(th) + 0.8));
        const x0 = pad;
        const y0 = h - pad - L * Math.sin(th) * k;
        const x1 = pad + L * Math.cos(th) * k;
        const y1 = h - pad;
        g.fillStyle = col.line;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.lineTo(x0, y1);
        g.closePath();
        g.fill();
        g.fillStyle = col.muted;
        g.fillText(`${fmt(p.angle!, 0)}°`, x1 - 46, y1 - 8);
        const s = sim.y[0]!;
        const cx = x0 + s * Math.cos(th) * k;
        const cy = y0 + s * Math.sin(th) * k;
        const size = Math.max(16, Math.min(40, 0.5 * k));
        g.save();
        g.translate(cx, cy);
        g.rotate(th);
        g.fillStyle = col.a;
        g.strokeStyle = col.ink;
        g.lineWidth = 2;
        g.beginPath();
        g.rect(-size / 2, -size, size, size);
        g.fill();
        g.stroke();
        g.restore();
        scene.setAttribute('aria-label', `Block ${fmt(s, 2)} m down a ${fmt(p.angle!, 0)}° slope`);
        break;
      }
    }
  }

  function drawPlot() {
    const got = prep(plot);
    if (!got) return;
    const [g, w, h] = got;
    const col = colors();
    const def = SIMS[sim.id].plot;
    g.fillStyle = col.bg;
    g.fillRect(0, 0, w, h);
    const pad = { l: 40, r: 8, t: 8, b: 18 };
    const t0 = samples[0]?.[0] ?? 0;
    const t1 = Math.max(t0 + 1, samples.at(-1)?.[0] ?? 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of samples) for (let i = 1; i < s.length; i++) [lo, hi] = [Math.min(lo, s[i]!), Math.max(hi, s[i]!)];
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    const m = (hi - lo) * 0.08;
    [lo, hi] = [lo - m, hi + m];
    const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    g.strokeStyle = col.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad.l, pad.t);
    g.lineTo(pad.l, h - pad.b);
    g.lineTo(w - pad.r, h - pad.b);
    if (lo < 0 && hi > 0) {
      g.moveTo(pad.l, Y(0));
      g.lineTo(w - pad.r, Y(0));
    }
    g.stroke();
    g.fillStyle = col.muted;
    g.font = `11px ${col.font}`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(fmt(hi - m, 1), pad.l - 4, Y(hi - m));
    g.fillText(fmt(lo + m, 1), pad.l - 4, Y(lo + m));
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillText(`${fmt(t1, 1)} s`, w - pad.r - 16, h - 4);
    const series = [col.a, col.b];
    for (let i = 0; i < def.series.length; i++) {
      g.strokeStyle = series[i] ?? col.ink;
      g.lineWidth = 2;
      g.beginPath();
      samples.forEach((s, j) => (j ? g.lineTo(X(s[0]!), Y(s[i + 1]!)) : g.moveTo(X(s[0]!), Y(s[i + 1]!))));
      g.stroke();
    }
    plotCap.textContent = `${def.label} (${def.unit}) over time${def.series.length > 1 ? `: ${def.series.join(' and ')}` : ''}`;
    plot.setAttribute('aria-label', `Plot of ${def.label.toLowerCase()} over time`);
  }

  // ---------- go ----------
  renderParams();
  reset();
  setPlaying(playing);
  if (reduced) status.textContent = 'Paused because reduced motion is on. Press Play or Step.';
  raf = requestAnimationFrame(frame);
  // Redrawn on the next frame, not inside the observer callback (which would trip "ResizeObserver loop" errors).
  let resizeRaf = 0;
  const ro =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(render);
        });
  ro?.observe(stage);
  const mo = new MutationObserver(() => render());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look', 'style', 'class'] });

  return () => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(resizeRaf);
    ro?.disconnect();
    mo.disconnect();
  };
}

const decimals = (step: number) => (step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));
function fmt(n: number, dp: number): string {
  const r = n.toFixed(dp);
  return /^-0(?:\.0*)?$/.test(r) ? r.slice(1) : r;
}

function ground(g: CanvasRenderingContext2D, col: { muted: string }, x0: number, y: number, x1: number) {
  g.strokeStyle = col.muted;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
}

function ball(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string) {
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 4) return;
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.strokeStyle = g.fillStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - 8 * Math.cos(a - 0.45), y1 - 8 * Math.sin(a - 0.45));
  g.lineTo(x1 - 8 * Math.cos(a + 0.45), y1 - 8 * Math.sin(a + 0.45));
  g.closePath();
  g.fill();
}

function coil(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, color: string) {
  const n = 12;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x0, y);
  const lead = 8;
  const span = Math.max(4, x1 - x0 - 2 * lead);
  g.lineTo(x0 + lead, y);
  for (let i = 0; i < n; i++) g.lineTo(x0 + lead + ((i + 0.5) / n) * span, y + (i % 2 ? 10 : -10));
  g.lineTo(x1 - lead, y);
  g.lineTo(x1, y);
  g.stroke();
}
