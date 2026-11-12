import { describe, expect, it } from 'vitest';
import { agm, Collision, createSim, DT, euler, FixedClock, G, Incline, integrate, parsePreset, Pendulum, Projectile, rk4, Spring, collide, type Deriv } from '../src/index';

const sho: Deriv = (_t, y, o) => {
  o[0] = y[1]!;
  o[1] = -y[0]!;
};

describe('integrator', () => {
  it('RK4 is fourth-order accurate: halving the step cuts the error ~16×', () => {
    const err = (steps: number) => Math.abs(integrate(sho, [1, 0], 0, 10, steps)[0]! - Math.cos(10));
    const e1 = err(200);
    const e2 = err(400);
    expect(e1).toBeLessThan(1e-6);
    expect(e1 / e2).toBeGreaterThan(14);
    expect(e1 / e2).toBeLessThan(18);
  });

  it('exponential growth to 1e-10', () => {
    const y = integrate((_t, s, o) => void (o[0] = s[0]!), [1], 0, 1, 100);
    expect(Math.abs(y[0]! - Math.E)).toBeLessThan(1e-9);
  });

  it('RK4 conserves oscillator energy where Euler drifts', () => {
    let a = [1, 0];
    let b = [1, 0];
    for (let i = 0; i < 2400; i++) {
      a = rk4(sho, i * DT, a, DT);
      b = euler(sho, i * DT, b, DT);
    }
    const E = (y: number[]) => 0.5 * (y[0]! ** 2 + y[1]! ** 2);
    expect(Math.abs(E(a) - 0.5)).toBeLessThan(1e-10);
    expect(Math.abs(E(b) - 0.5)).toBeGreaterThan(1e-3);
  });

  it('fixed clock: whole steps only, remainder carried, long gaps capped', () => {
    const c = new FixedClock(0.25, 8);
    let n = 0;
    expect(c.advance(0.6, () => n++)).toBe(2);
    expect(c.advance(0.15, () => n++)).toBe(1); // 0.1 left over + 0.15
    expect(c.advance(100, () => n++)).toBe(8);
    expect(n).toBe(11);
  });

  it('is deterministic: same settings, same steps, identical numbers', () => {
    const a = (createSim('pendulum', { theta0: 120 }) as Pendulum).run(5);
    const b = (createSim('pendulum', { theta0: 120 }) as Pendulum).run(5);
    expect(a.y).toEqual(b.y);
  });
});

const drift = (s: { energy(): { total: number } }, E0: number) => Math.abs(s.energy().total - E0) / Math.abs(E0);

describe('projectile', () => {
  it('matches the exact range, height and flight time without drag', () => {
    const p = new Projectile(createSim('projectile', { v0: 20, angle: 45 }).params);
    const E0 = p.energy().total;
    let maxDrift = 0;
    while (!p.done) {
      p.step();
      maxDrift = Math.max(maxDrift, drift(p, E0));
    }
    const ideal = p.ideal();
    expect(ideal.range).toBeCloseTo((400 * Math.sin(Math.PI / 2)) / G, 10);
    expect(p.y[0]).toBeCloseTo(ideal.range, 8);
    expect(p.t).toBeCloseTo(ideal.time, 8);
    expect(p.maxHeight).toBeCloseTo(ideal.height, 3);
    expect(maxDrift).toBeLessThan(1e-9);
  });

  it('from a height', () => {
    const p = createSim('projectile', { v0: 10, angle: 0, h0: 20 }).run(10) as Projectile;
    expect(p.t).toBeCloseTo(Math.sqrt((2 * 20) / G), 8);
    expect(p.y[0]).toBeCloseTo(10 * Math.sqrt((2 * 20) / G), 7);
  });

  it('drag shortens the range and the lost energy accounts for the difference', () => {
    const p = createSim('projectile', { v0: 30, angle: 40, drag: 0.02, mass: 2 }) as Projectile;
    const E0 = p.energy().total;
    p.run(20);
    expect(p.y[0]).toBeLessThan(p.ideal().range * 0.8);
    expect(p.energy().dissipated).toBeGreaterThan(10);
    expect(drift(p, E0)).toBeLessThan(1e-8);
  });
});

describe('pendulum', () => {
  it('exact model: energy conserved and period matches the AGM formula', () => {
    const p = createSim('pendulum', { length: 1.5, theta0: 120, exact: 1 }) as Pendulum;
    const E0 = p.energy().total;
    const crossings: number[] = [];
    let prev = p.y[0]!;
    let maxDrift = 0;
    while (p.t < 20) {
      p.step();
      maxDrift = Math.max(maxDrift, drift(p, E0));
      const th = p.y[0]!;
      if (prev > 0 && th <= 0) crossings.push(p.t - DT * (th / (th - prev)));
      prev = th;
    }
    expect(maxDrift).toBeLessThan(1e-7);
    const measured = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
    expect(measured).toBeCloseTo(p.period(), 3);
    // At 120° the true period is much longer than the small-angle one.
    expect(p.period() / (2 * Math.PI * Math.sqrt(1.5 / G))).toBeGreaterThan(1.3);
  });

  it('small-angle model has period 2π√(L/g) at any amplitude, and conserves its own energy', () => {
    const p = createSim('pendulum', { length: 1, theta0: 60, exact: 0 }) as Pendulum;
    const E0 = p.energy().total;
    const T = 2 * Math.PI * Math.sqrt(1 / G);
    p.run(T);
    expect(p.y[0]).toBeCloseTo(((60 * Math.PI) / 180) * Math.cos(Math.sqrt(G) * p.t), 9);
    expect(drift(p, E0)).toBeLessThan(1e-9);
  });

  it('AGM', () => {
    expect(agm(1, Math.SQRT2)).toBeCloseTo(1.19814023473559, 12);
  });

  it('damping removes energy into the dissipated column', () => {
    const p = createSim('pendulum', { damping: 0.3 }) as Pendulum;
    const E0 = p.energy().total;
    p.run(10);
    expect(p.energy().kinetic + p.energy().potential).toBeLessThan(E0 * 0.2);
    expect(drift(p, E0)).toBeLessThan(1e-7);
  });
});

describe('spring–mass', () => {
  it.each([0, 0.5, 2 * Math.sqrt(20), 10])('matches the exact solution and conserves energy (c = %s)', (c) => {
    const s = createSim('spring', { mass: 1, k: 20, c, x0: 0.5 }) as Spring;
    const E0 = s.energy().total;
    for (let i = 0; i < 5; i++) {
      s.run(i + 1);
      expect(Math.abs(s.y[0]! - s.exact(s.t))).toBeLessThan(1e-8);
      expect(drift(s, E0)).toBeLessThan(1e-7);
    }
  });

  it('names its regime', () => {
    const r = (c: number) => (createSim('spring', { mass: 1, k: 16, c }) as Spring).readouts().find((x) => x.key === 'regime')!.value;
    expect(r(0)).toBe('Undamped');
    expect(r(1)).toBe('Underdamped');
    expect(r(8)).toBe('Critically damped');
    expect(r(9)).toBe('Overdamped');
  });
});

describe('collisions', () => {
  it('elastic: momentum and kinetic energy conserved', () => {
    const c = createSim('collision', { m1: 2, v1: 3, m2: 1, v2: -1, e: 1 }) as Collision;
    const p0 = c.momentum();
    const K0 = c.energy().kinetic;
    c.run(10);
    expect(c.hitAt).not.toBeNull();
    expect(c.momentum()).toBeCloseTo(p0, 12);
    expect(c.energy().kinetic).toBeCloseTo(K0, 12);
    expect([c.v1, c.v2]).toEqual(collide(2, 3, 1, -1, 1));
    expect(c.v1).toBeCloseTo(1 / 3, 12);
    expect(c.v2).toBeCloseTo(13 / 3, 12);
  });

  it('perfectly inelastic: they move together and the lost energy is exact', () => {
    const c = createSim('collision', { m1: 2, v1: 3, m2: 1, v2: -1, e: 0 }) as Collision;
    const K0 = c.energy().kinetic;
    c.run(10);
    expect(c.v1).toBeCloseTo(c.v2, 12);
    expect(c.v1).toBeCloseTo(5 / 3, 12);
    const reduced = (2 * 1) / 3;
    expect(c.energy().dissipated).toBeCloseTo(0.5 * reduced * 16, 12);
    expect(c.energy().total).toBeCloseTo(K0, 12);
  });

  it('contact happens at the exact time, whatever the step', () => {
    // Gap 6 − 0.6 = 5.4 m closing at 4 m/s → 1.35 s.
    const c = createSim('collision', { v1: 3, v2: -1 }) as Collision;
    c.run(3);
    expect(c.hitAt).toBeCloseTo(1.35, 12);
  });

  it('never meet when moving apart', () => {
    const c = createSim('collision', { v1: -2, v2: 2 }) as Collision;
    c.run(10);
    expect(c.hitAt).toBeNull();
  });
});

describe('inclined plane', () => {
  it('slides with a = g(sin θ − μk cos θ), reaching the bottom on time, energy balanced', () => {
    const s = createSim('incline', { angle: 30, muS: 0.3, muK: 0.2, mass: 2, length: 5 }) as Incline;
    const a = G * (Math.sin(Math.PI / 6) - 0.2 * Math.cos(Math.PI / 6));
    const E0 = s.energy().total;
    s.run(30);
    expect(s.acceleration()).toBeCloseTo(a, 12);
    expect(s.t).toBeCloseTo(Math.sqrt((2 * 5) / a), 9);
    expect(s.y[1]).toBeCloseTo(Math.sqrt(2 * a * 5), 9);
    expect(drift(s, E0)).toBeLessThan(1e-9);
    expect(s.energy().dissipated).toBeCloseTo(0.2 * 2 * G * Math.cos(Math.PI / 6) * 5, 9);
  });

  it('static friction holds the block when tan θ ≤ μs', () => {
    const s = createSim('incline', { angle: 15, muS: 0.3, muK: 0.2 }) as Incline;
    expect(s.done && s.stuck).toBe(true);
  });

  it('a pushed block on a grippy slope slows and stops', () => {
    const s = createSim('incline', { angle: 10, muS: 0.5, muK: 0.4, v0: 2, length: 10 }) as Incline;
    const E0 = s.energy().total;
    s.run(30);
    expect(s.stuck).toBe(true);
    expect(s.y[1]).toBe(0);
    const a = G * (Math.sin(Math.PI / 18) - 0.4 * Math.cos(Math.PI / 18));
    expect(s.y[0]).toBeCloseTo(-4 / (2 * a), 9);
    expect(drift(s, E0)).toBeLessThan(1e-9);
  });
});

describe('presets from typed questions', () => {
  it('projectile', () => {
    expect(parsePreset('simulate a projectile at 20 m/s 45 degrees')).toEqual({ sim: 'projectile', params: { v0: 20, angle: 45, h0: 0, mass: 1, drag: 0 } });
    expect(parsePreset('simulate a ball thrown at 15 m/s at 30° from 10 m with air resistance')?.params).toMatchObject({ v0: 15, angle: 30, h0: 10, drag: 0.02 });
  });
  it('pendulum, spring, collision, incline', () => {
    expect(parsePreset('simulate a 2 m pendulum at 60 degrees small angle')?.params).toMatchObject({ length: 2, theta0: 60, exact: 0 });
    expect(parsePreset('simulate a spring with k = 50 and 2 kg, undamped')?.params).toMatchObject({ k: 50, mass: 2, c: 0 });
    expect(parsePreset('simulate a collision: 3 kg at 2 m/s and 1 kg at -1 m/s, perfectly inelastic')?.params).toMatchObject({ m1: 3, v1: 2, m2: 1, v2: -1, e: 0 });
    expect(parsePreset('simulate a block on a 40 degree ramp with friction 0.25')?.params).toMatchObject({ angle: 40, muK: 0.25, muS: 0.3 });
  });
  it('clamps to the slider ranges and ignores other questions', () => {
    expect(parsePreset('simulate a projectile at 500 m/s')?.params.v0).toBe(50);
    expect(parsePreset('projectile at 20 m/s at 45 degrees range')).toBeNull();
    expect(parsePreset('open the physics lab')?.sim).toBe('projectile');
  });
});
