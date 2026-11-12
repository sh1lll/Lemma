/**
 * Fixed-step integration. Every simulation advances in equal steps of `dt` whatever the frame rate, so the
 * same settings always give the same numbers (on every device, and in tests).
 */

/** dy/dt = f(t, y). Writes the derivative into `out`. */
export type Deriv = (t: number, y: readonly number[], out: number[]) => void;

/** One classical Runge–Kutta (RK4) step of size h. Returns the new state; `y` is left alone. */
export function rk4(f: Deriv, t: number, y: readonly number[], h: number): number[] {
  const n = y.length;
  const k1 = new Array<number>(n);
  const k2 = new Array<number>(n);
  const k3 = new Array<number>(n);
  const k4 = new Array<number>(n);
  const tmp = new Array<number>(n);
  f(t, y, k1);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (h / 2) * k1[i]!;
  f(t + h / 2, tmp, k2);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (h / 2) * k2[i]!;
  f(t + h / 2, tmp, k3);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + h * k3[i]!;
  f(t + h, tmp, k4);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = y[i]! + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  return out;
}

/** One explicit Euler step (for comparison in tests: it drifts, RK4 doesn't). */
export function euler(f: Deriv, t: number, y: readonly number[], h: number): number[] {
  const d = new Array<number>(y.length);
  f(t, y, d);
  return y.map((v, i) => v + h * d[i]!);
}

/** Integrates from t0 to t1 in `steps` equal RK4 steps. */
export function integrate(f: Deriv, y0: readonly number[], t0: number, t1: number, steps: number): number[] {
  const h = (t1 - t0) / steps;
  let y = [...y0];
  for (let i = 0; i < steps; i++) y = rk4(f, t0 + i * h, y, h);
  return y;
}

/**
 * Turns wall-clock time into a whole number of fixed steps, carrying the remainder to the next frame. A long
 * pause (a background tab) is capped so the simulation never tries to catch up all at once.
 */
export class FixedClock {
  private acc = 0;
  constructor(
    readonly dt = 1 / 240,
    private maxSteps = 240,
  ) {}

  /** Runs `step` once per whole `dt` in `seconds` (plus what was left over). Returns how many steps ran. */
  advance(seconds: number, step: () => void): number {
    this.acc = Math.min(this.acc + Math.max(0, seconds), this.dt * this.maxSteps);
    let n = 0;
    while (this.acc >= this.dt - 1e-12) {
      step();
      this.acc -= this.dt;
      n++;
    }
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}
