import { rk4, type Deriv } from './integrator';

/** Standard gravity, m/s². */
export const G = 9.80665;
/** The fixed step every simulation uses, in seconds. */
export const DT = 1 / 240;

export type SimId = 'projectile' | 'pendulum' | 'spring' | 'collision' | 'incline';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
  /** Shown as a choice of buttons instead of a slider. */
  choices?: { value: number; label: string }[];
}

export interface Readout {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
}

/** Energies in joules. `total` (kinetic + potential + dissipated) stays constant when the physics is right. */
export interface Energy {
  kinetic: number;
  potential: number;
  dissipated: number;
  total: number;
}

export interface SimDef {
  id: SimId;
  label: string;
  params: ParamSpec[];
  /** What the small plot shows. */
  plot: { label: string; unit: string; series: string[] };
}

export const SIMS: Record<SimId, SimDef> = {
  projectile: {
    id: 'projectile',
    label: 'Projectile',
    params: [
      { key: 'v0', label: 'Launch speed', min: 1, max: 50, step: 0.5, unit: 'm/s', value: 20 },
      { key: 'angle', label: 'Launch angle', min: 0, max: 90, step: 1, unit: '°', value: 45 },
      { key: 'h0', label: 'Launch height', min: 0, max: 50, step: 0.5, unit: 'm', value: 0 },
      { key: 'mass', label: 'Mass', min: 0.1, max: 10, step: 0.1, unit: 'kg', value: 1 },
      { key: 'drag', label: 'Air drag k', min: 0, max: 0.1, step: 0.005, unit: '1/m', value: 0 },
    ],
    plot: { label: 'Height', unit: 'm', series: ['height'] },
  },
  pendulum: {
    id: 'pendulum',
    label: 'Pendulum',
    params: [
      { key: 'length', label: 'Length', min: 0.2, max: 5, step: 0.1, unit: 'm', value: 1 },
      { key: 'theta0', label: 'Release angle', min: 1, max: 175, step: 1, unit: '°', value: 30 },
      { key: 'mass', label: 'Mass', min: 0.1, max: 10, step: 0.1, unit: 'kg', value: 1 },
      { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, unit: '1/s', value: 0 },
      { key: 'exact', label: 'Model', min: 0, max: 1, step: 1, unit: '', value: 1, choices: [{ value: 1, label: 'Exact (sin θ)' }, { value: 0, label: 'Small angle (θ)' }] },
    ],
    plot: { label: 'Angle', unit: '°', series: ['angle'] },
  },
  spring: {
    id: 'spring',
    label: 'Spring',
    params: [
      { key: 'mass', label: 'Mass', min: 0.1, max: 5, step: 0.1, unit: 'kg', value: 1 },
      { key: 'k', label: 'Spring constant', min: 1, max: 100, step: 1, unit: 'N/m', value: 20 },
      { key: 'c', label: 'Damping', min: 0, max: 10, step: 0.1, unit: 'N·s/m', value: 0.5 },
      { key: 'x0', label: 'Start stretch', min: -1, max: 1, step: 0.05, unit: 'm', value: 0.5 },
    ],
    plot: { label: 'Displacement', unit: 'm', series: ['x'] },
  },
  collision: {
    id: 'collision',
    label: 'Collision',
    params: [
      { key: 'm1', label: 'Mass 1', min: 0.5, max: 10, step: 0.5, unit: 'kg', value: 2 },
      { key: 'v1', label: 'Velocity 1', min: -5, max: 5, step: 0.5, unit: 'm/s', value: 3 },
      { key: 'm2', label: 'Mass 2', min: 0.5, max: 10, step: 0.5, unit: 'kg', value: 1 },
      { key: 'v2', label: 'Velocity 2', min: -5, max: 5, step: 0.5, unit: 'm/s', value: -1 },
      { key: 'e', label: 'Bounciness e', min: 0, max: 1, step: 0.05, unit: '', value: 1 },
    ],
    plot: { label: 'Velocity', unit: 'm/s', series: ['v₁', 'v₂'] },
  },
  incline: {
    id: 'incline',
    label: 'Incline',
    params: [
      { key: 'angle', label: 'Slope angle', min: 0, max: 60, step: 1, unit: '°', value: 30 },
      { key: 'muS', label: 'Static friction μs', min: 0, max: 1, step: 0.01, unit: '', value: 0.3 },
      { key: 'muK', label: 'Kinetic friction μk', min: 0, max: 1, step: 0.01, unit: '', value: 0.2 },
      { key: 'mass', label: 'Mass', min: 0.5, max: 10, step: 0.5, unit: 'kg', value: 2 },
      { key: 'length', label: 'Slope length', min: 1, max: 10, step: 0.5, unit: 'm', value: 5 },
      { key: 'v0', label: 'Push down the slope', min: 0, max: 5, step: 0.1, unit: 'm/s', value: 0 },
    ],
    plot: { label: 'Speed', unit: 'm/s', series: ['speed'] },
  },
};

export type Params = Record<string, number>;

/** Defaults for a simulation, overridden by `given` (each clamped to its slider's range). */
export function paramsFor(id: SimId, given: Params = {}): Params {
  const out: Params = {};
  for (const p of SIMS[id].params) {
    const v = given[p.key];
    out[p.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.value;
  }
  return out;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const energy = (kinetic: number, potential: number, dissipated: number): Energy => ({ kinetic, potential, dissipated, total: kinetic + potential + dissipated });

/** Shared by every simulation: time, a fixed-step `step()`, readouts, energy, and a plot sample. */
export abstract class Sim {
  abstract readonly id: SimId;
  t = 0;
  done = false;
  constructor(readonly params: Params) {}
  /** Advances one fixed step of `dt` seconds (does nothing once done). */
  abstract step(dt?: number): void;
  abstract readouts(): Readout[];
  abstract energy(): Energy;
  /** Values for the plot's series at the current time. */
  abstract sample(): number[];
  /** Runs until done or `maxT` seconds, in fixed steps. */
  run(maxT: number, dt = DT): this {
    while (!this.done && this.t < maxT - 1e-12) this.step(dt);
    return this;
  }
}

// ---------- projectile (optional quadratic drag) ----------

export class Projectile extends Sim {
  readonly id = 'projectile';
  /** [x, y, vx, vy, energy lost to drag (J)] */
  y: number[];
  maxHeight: number;
  private f: Deriv;
  constructor(params: Params) {
    super(params);
    const { v0, angle, h0, drag, mass } = params as Record<'v0' | 'angle' | 'h0' | 'drag' | 'mass', number>;
    const th = rad(angle);
    this.y = [0, h0, angle === 90 ? 0 : v0 * Math.cos(th), v0 * Math.sin(th), 0];
    this.maxHeight = h0;
    // a = −g ŷ − k|v|v; drag power per unit mass is k|v|³.
    this.f = (_t, s, o) => {
      const sp = Math.hypot(s[2]!, s[3]!);
      o[0] = s[2]!;
      o[1] = s[3]!;
      o[2] = -drag * sp * s[2]!;
      o[3] = -G - drag * sp * s[3]!;
      o[4] = mass * drag * sp * sp * sp;
    };
    if (v0 * Math.sin(th) <= 0 && h0 <= 0) this.done = true;
  }
  step(dt = DT): void {
    if (this.done) return;
    const next = rk4(this.f, this.t, this.y, dt);
    if (next[1]! < 0 && next[3]! < 0) {
      // Find the landing instant inside this step (secant on y), so the range doesn't depend on the step size.
      let lo = 0;
      let hi = dt;
      let ylo = this.y[1]!;
      let yhi = next[1]!;
      let h = dt;
      let s = next;
      for (let i = 0; i < 30 && hi - lo > 1e-13; i++) {
        h = Math.min(hi, Math.max(lo, lo + ((hi - lo) * ylo) / (ylo - yhi)));
        s = rk4(this.f, this.t, this.y, h);
        if (Math.abs(s[1]!) < 1e-12) break;
        if (s[1]! > 0) [lo, ylo] = [h, s[1]!];
        else [hi, yhi] = [h, s[1]!];
      }
      this.y = s;
      this.y[1] = 0;
      this.t += h;
      this.done = true;
      return;
    }
    this.y = next;
    this.t += dt;
    if (this.y[1]! > this.maxHeight) this.maxHeight = this.y[1]!;
  }
  /** Range, height and flight time without air resistance (exact). */
  ideal(): { range: number; height: number; time: number } {
    const { v0, angle, h0 } = this.params as Record<string, number>;
    const th = rad(angle!);
    const vx = angle === 90 ? 0 : v0! * Math.cos(th);
    const vy = v0! * Math.sin(th);
    const time = (vy + Math.sqrt(vy * vy + 2 * G * h0!)) / G;
    return { range: vx * time, height: h0! + (vy * vy) / (2 * G), time };
  }
  energy(): Energy {
    const m = this.params.mass!;
    const [, y, vx, vy, lost] = this.y as [number, number, number, number, number];
    return energy(0.5 * m * (vx * vx + vy * vy), m * G * y, lost);
  }
  readouts(): Readout[] {
    const [x, y, vx, vy] = this.y as [number, number, number, number];
    const out: Readout[] = [
      { key: 't', label: 'Time', value: this.t, unit: 's' },
      { key: 'x', label: 'Distance', value: x, unit: 'm' },
      { key: 'y', label: 'Height', value: y, unit: 'm' },
      { key: 'speed', label: 'Speed', value: Math.hypot(vx, vy), unit: 'm/s' },
      { key: 'maxHeight', label: 'Highest so far', value: this.maxHeight, unit: 'm' },
    ];
    if (!this.params.drag) out.push({ key: 'range', label: 'Range (no air)', value: this.ideal().range, unit: 'm' });
    return out;
  }
  sample(): number[] {
    return [this.y[1]!];
  }
}

// ---------- pendulum (exact or small-angle, RK4) ----------

/** Arithmetic–geometric mean, for the exact pendulum period. */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return a;
}

export class Pendulum extends Sim {
  readonly id = 'pendulum';
  /** [θ (rad), ω (rad/s), energy lost to damping (J)] */
  y: number[];
  private f: Deriv;
  constructor(params: Params) {
    super(params);
    const { length: L, damping: b, exact } = params as Record<string, number>;
    this.y = [rad(params.theta0!), 0, 0];
    const m = params.mass!;
    this.f = (_t, s, o) => {
      o[0] = s[1]!;
      o[1] = -(G / L!) * (exact ? Math.sin(s[0]!) : s[0]!) - b! * s[1]!;
      o[2] = m * b! * L! * L! * s[1]! * s[1]!;
    };
  }
  step(dt = DT): void {
    this.y = rk4(this.f, this.t, this.y, dt);
    this.t += dt;
  }
  /** The period this model predicts (undamped): 2π√(L/g), or that divided by AGM(1, cos(θ₀/2)) when exact. */
  period(): number {
    const T0 = 2 * Math.PI * Math.sqrt(this.params.length! / G);
    return this.params.exact ? T0 / agm(1, Math.cos(rad(this.params.theta0!) / 2)) : T0;
  }
  energy(): Energy {
    const { length: L, mass: m, exact } = this.params as Record<string, number>;
    const [th, w, lost] = this.y as [number, number, number];
    // Each model conserves its own energy: the small-angle one has a quadratic potential.
    const pot = exact ? m! * G * L! * (1 - Math.cos(th)) : 0.5 * m! * G * L! * th * th;
    return energy(0.5 * m! * L! * L! * w * w, pot, lost);
  }
  readouts(): Readout[] {
    return [
      { key: 't', label: 'Time', value: this.t, unit: 's' },
      { key: 'angle', label: 'Angle', value: (this.y[0]! * 180) / Math.PI, unit: '°' },
      { key: 'omega', label: 'Angular speed', value: this.y[1]!, unit: 'rad/s' },
      { key: 'period', label: 'Period (theory)', value: this.period(), unit: 's' },
    ];
  }
  sample(): number[] {
    return [(this.y[0]! * 180) / Math.PI];
  }
}

// ---------- spring–mass with damping ----------

export class Spring extends Sim {
  readonly id = 'spring';
  /** [x (m), v (m/s), energy lost to damping (J)] */
  y: number[];
  private f: Deriv;
  constructor(params: Params) {
    super(params);
    const { mass: m, k, c } = params as Record<string, number>;
    this.y = [params.x0!, 0, 0];
    this.f = (_t, s, o) => {
      o[0] = s[1]!;
      o[1] = (-k! * s[0]! - c! * s[1]!) / m!;
      o[2] = c! * s[1]! * s[1]!;
    };
  }
  step(dt = DT): void {
    this.y = rk4(this.f, this.t, this.y, dt);
    this.t += dt;
  }
  /** Damping ratio ζ = c / (2√(km)). */
  zeta(): number {
    return this.params.c! / (2 * Math.sqrt(this.params.k! * this.params.mass!));
  }
  /** The exact position at time t (released from rest at x0), for checking the integrator. */
  exact(t: number): number {
    const { mass: m, k, c, x0 } = this.params as Record<string, number>;
    const w0 = Math.sqrt(k! / m!);
    const z = this.zeta();
    if (z < 1 - 1e-9) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return x0! * Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    if (z > 1 + 1e-9) {
      const s = w0 * Math.sqrt(z * z - 1);
      const r1 = -z * w0 + s;
      const r2 = -z * w0 - s;
      return (x0! * (r1 * Math.exp(r2 * t) - r2 * Math.exp(r1 * t))) / (r1 - r2);
    }
    void c;
    return x0! * (1 + w0 * t) * Math.exp(-w0 * t);
  }
  energy(): Energy {
    const [x, v, lost] = this.y as [number, number, number];
    return energy(0.5 * this.params.mass! * v * v, 0.5 * this.params.k! * x * x, lost);
  }
  readouts(): Readout[] {
    const z = this.zeta();
    return [
      { key: 't', label: 'Time', value: this.t, unit: 's' },
      { key: 'x', label: 'Displacement', value: this.y[0]!, unit: 'm' },
      { key: 'v', label: 'Velocity', value: this.y[1]!, unit: 'm/s' },
      { key: 'zeta', label: 'Damping ratio ζ', value: z },
      { key: 'regime', label: 'Behaviour', value: z === 0 ? 'Undamped' : z < 1 - 1e-9 ? 'Underdamped' : z > 1 + 1e-9 ? 'Overdamped' : 'Critically damped' },
    ];
  }
  sample(): number[] {
    return [this.y[0]!];
  }
}

// ---------- 1D collision ----------

/** Block width in metres. */
export const BLOCK = 0.6;

/** Velocities after a 1D collision with restitution e (1 elastic, 0 perfectly inelastic). */
export function collide(m1: number, v1: number, m2: number, v2: number, e: number): [number, number] {
  const p = m1 * v1 + m2 * v2;
  return [(p + m2 * e * (v2 - v1)) / (m1 + m2), (p + m1 * e * (v1 - v2)) / (m1 + m2)];
}

export class Collision extends Sim {
  readonly id = 'collision';
  x1 = -3;
  x2 = 3;
  v1: number;
  v2: number;
  /** When they touched, if they have. */
  hitAt: number | null = null;
  private lost = 0;
  constructor(params: Params) {
    super(params);
    this.v1 = params.v1!;
    this.v2 = params.v2!;
  }
  step(dt = DT): void {
    if (this.done) return;
    const closing = this.v1 - this.v2;
    const gap = this.x2 - this.x1 - BLOCK;
    if (this.hitAt === null && closing > 0 && gap <= closing * dt) {
      // They touch inside this step: move to contact, exchange momentum, then use the rest of the step.
      const tau = Math.max(0, gap / closing);
      this.x1 += this.v1 * tau;
      this.x2 += this.v2 * tau;
      const { m1, m2, e } = this.params as Record<string, number>;
      const before = 0.5 * m1! * this.v1 * this.v1 + 0.5 * m2! * this.v2 * this.v2;
      [this.v1, this.v2] = collide(m1!, this.v1, m2!, this.v2, e!);
      this.lost = before - (0.5 * m1! * this.v1 * this.v1 + 0.5 * m2! * this.v2 * this.v2);
      this.hitAt = this.t + tau;
      this.x1 += this.v1 * (dt - tau);
      this.x2 += this.v2 * (dt - tau);
    } else {
      this.x1 += this.v1 * dt;
      this.x2 += this.v2 * dt;
    }
    this.t += dt;
    if (this.t >= 10 || Math.min(Math.abs(this.x1), Math.abs(this.x2)) > 12) this.done = true;
  }
  momentum(): number {
    return this.params.m1! * this.v1 + this.params.m2! * this.v2;
  }
  energy(): Energy {
    return energy(0.5 * this.params.m1! * this.v1 * this.v1 + 0.5 * this.params.m2! * this.v2 * this.v2, 0, this.lost);
  }
  readouts(): Readout[] {
    return [
      { key: 't', label: 'Time', value: this.t, unit: 's' },
      { key: 'v1', label: 'Velocity 1', value: this.v1, unit: 'm/s' },
      { key: 'v2', label: 'Velocity 2', value: this.v2, unit: 'm/s' },
      { key: 'p', label: 'Total momentum', value: this.momentum(), unit: 'kg·m/s' },
      { key: 'ke', label: 'Kinetic energy', value: this.energy().kinetic, unit: 'J' },
      { key: 'lost', label: 'Energy lost', value: this.lost, unit: 'J' },
    ];
  }
  sample(): number[] {
    return [this.v1, this.v2];
  }
}

// ---------- block on an inclined plane with friction ----------

export class Incline extends Sim {
  readonly id = 'incline';
  /** [distance down the slope (m), speed (m/s), energy lost to friction (J)] */
  y: number[];
  /** True once static friction holds the block. */
  stuck = false;
  private f: Deriv;
  constructor(params: Params) {
    super(params);
    const { angle, muK, mass: m } = params as Record<string, number>;
    const th = rad(angle!);
    this.y = [0, params.v0!, 0];
    this.f = (_t, s, o) => {
      o[0] = s[1]!;
      o[1] = G * (Math.sin(th) - muK! * Math.cos(th));
      o[2] = muK! * m! * G * Math.cos(th) * s[1]!;
    };
    if (params.v0! <= 0 && !this.slides()) this.stuck = this.done = true;
  }
  /** Whether gravity along the slope beats static friction (tan θ > μs). */
  slides(): boolean {
    const th = rad(this.params.angle!);
    return Math.sin(th) > this.params.muS! * Math.cos(th) + 1e-12;
  }
  /** Acceleration down the slope while sliding. */
  acceleration(): number {
    const th = rad(this.params.angle!);
    return G * (Math.sin(th) - this.params.muK! * Math.cos(th));
  }
  step(dt = DT): void {
    if (this.done) return;
    const L = this.params.length!;
    const a = this.acceleration();
    const [s, v] = this.y as [number, number];
    if (v <= 0 && a <= 0) {
      // At rest, and kinetic friction would win: it stays where it is.
      this.y[1] = 0;
      this.stuck = this.done = true;
      return;
    }
    // The motion is uniformly accelerated, so the step's end events (bottom reached, block stops) are found exactly.
    const tStop = a < 0 && v > 0 ? -v / a : Infinity;
    const disc = v * v + 2 * a * (L - s);
    const tBottom = disc >= 0 ? (Math.abs(a) < 1e-12 ? (v > 0 ? (L - s) / v : Infinity) : (-v + Math.sqrt(disc)) / a) : Infinity;
    const tEnd = Math.min(tStop, tBottom >= 0 ? tBottom : Infinity);
    if (tEnd <= dt) {
      this.y = rk4(this.f, this.t, this.y, tEnd);
      this.t += tEnd;
      if (tEnd === tStop && tStop < tBottom) {
        this.y[1] = 0;
        this.stuck = !this.slides();
        if (this.stuck) this.done = true;
      } else {
        this.y[0] = L;
        this.done = true;
      }
      return;
    }
    this.y = rk4(this.f, this.t, this.y, dt);
    this.t += dt;
  }
  energy(): Energy {
    const { mass: m, length: L, angle } = this.params as Record<string, number>;
    const [s, v, lost] = this.y as [number, number, number];
    return energy(0.5 * m! * v * v, m! * G * (L! - s) * Math.sin(rad(angle!)), lost);
  }
  readouts(): Readout[] {
    const { mass: m, angle, muK } = this.params as Record<string, number>;
    const N = m! * G * Math.cos(rad(angle!));
    const moving = this.y[1]! > 0 || (!this.stuck && this.slides());
    return [
      { key: 't', label: 'Time', value: this.t, unit: 's' },
      { key: 's', label: 'Distance down', value: this.y[0]!, unit: 'm' },
      { key: 'speed', label: 'Speed', value: this.y[1]!, unit: 'm/s' },
      { key: 'a', label: 'Acceleration', value: moving ? this.acceleration() : 0, unit: 'm/s²' },
      { key: 'normal', label: 'Normal force', value: N, unit: 'N' },
      { key: 'friction', label: 'Friction', value: moving ? muK! * N : m! * G * Math.sin(rad(angle!)), unit: 'N' },
      { key: 'state', label: 'Block', value: this.stuck ? 'Held by friction' : this.done ? 'At the bottom' : 'Sliding' },
    ];
  }
  sample(): number[] {
    return [this.y[1]!];
  }
}

export type AnySim = Projectile | Pendulum | Spring | Collision | Incline;

/** A fresh simulation with the given (or default) settings. */
export function createSim(id: SimId, given: Params = {}): AnySim {
  const p = paramsFor(id, given);
  switch (id) {
    case 'projectile':
      return new Projectile(p);
    case 'pendulum':
      return new Pendulum(p);
    case 'spring':
      return new Spring(p);
    case 'collision':
      return new Collision(p);
    case 'incline':
      return new Incline(p);
  }
}
