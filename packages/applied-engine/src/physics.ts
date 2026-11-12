import type { AnswerResult } from '@lemma/math-core';
import { K, NUM, deg, fail, gravity, lab, named, need, num, ofDim, quantities, res, show, temperatures, todeg, withUnit, duration, type Ctx, type Handler, type Qty } from './util';

const P = 'physics' as const;

// NASA planetary fact sheet (mass kg, mean radius m).
export const BODIES: Record<string, [mass: number, radius: number, name: string]> = {
  sun: [1.9885e30, 6.957e8, 'the Sun'],
  mercury: [3.3011e23, 2.4397e6, 'Mercury'],
  venus: [4.8675e24, 6.0518e6, 'Venus'],
  earth: [5.9722e24, 6.371e6, 'Earth'],
  moon: [7.346e22, 1.7374e6, 'the Moon'],
  mars: [6.4171e23, 3.3895e6, 'Mars'],
  jupiter: [1.89819e27, 6.9911e7, 'Jupiter'],
  saturn: [5.6834e26, 5.8232e7, 'Saturn'],
  uranus: [8.6813e25, 2.5362e7, 'Uranus'],
  neptune: [1.02413e26, 2.4622e7, 'Neptune'],
  pluto: [1.303e22, 1.1883e6, 'Pluto'],
};
const BODY_RE = /\b(sun|mercury|venus|earth|moon|mars|jupiter|saturn|uranus|neptune|pluto)(?:'s)?\b/;
function body(c: Ctx): [number, number, string] | null {
  const m = BODY_RE.exec(c.s);
  return m ? BODIES[m[1]!]! : null;
}

// ─────────────── friction & inclines ───────────────
const friction: Handler = (c) => {
  if (!/\bfriction|\bincline|\bramp\b|\bslope\b|coefficient of friction|\bμ|\bmu\b/.test(c.s)) return null;
  if (/\bincline|\bramp\b|\bslope\b|\bslid/.test(c.s)) {
    const ang = ofDim(c, 'angle')[0];
    if (!ang) return need(c, P, 'What is the angle of the incline (e.g. 30°)?');
    const notes: string[] = [];
    const g = gravity(c, notes);
    const mu = named(c, 'μ|mu|μk|mu_k|coefficient of (?:kinetic )?friction|friction coefficient|coefficient', undefined) ?? 0;
    const th = deg(ang.v);
    const m = ofDim(c, 'mass')[0];
    const a = g * (Math.sin(th) - mu * Math.cos(th));
    const lines: [string, string][] = [['Angle', `${show(ang.v)}°`], ['μ', mu ? show(mu) : '0 (frictionless)']];
    if (m) {
      lines.push(['Weight component along slope', withUnit(m.v * g * Math.sin(th), 'N')], ['Normal force', withUnit(m.v * g * Math.cos(th), 'N')]);
      if (mu) lines.push(['Friction force', withUnit(mu * m.v * g * Math.cos(th), 'N')]);
    }
    if (a <= 0) {
      notes.push(`tan θ = ${show(Math.tan(th))} ≤ μ, so friction can hold the block still (if μ is the static coefficient)`);
      return res(c, { kind: P, expression: 'Block on an incline: acceleration down the slope', value: 0, unit: 'm/s²', formula: 'a = g(sin θ − μ cos θ)', lines, notes });
    }
    if (!mu) notes.push('No friction coefficient given, so the incline is taken as frictionless');
    return res(c, { kind: P, expression: `Block on a ${show(ang.v)}° incline${mu ? `, μ = ${show(mu)}` : ''}: acceleration down the slope`, value: a, unit: 'm/s²', unitWords: 'metres per second squared', formula: 'a = g(sin θ − μ cos θ)', lines, notes });
  }
  const mu = named(c, 'μ|mu|μk|μs|mu_k|mu_s|coefficient of (?:kinetic |static )?friction|friction coefficient|coefficient', undefined);
  const m = ofDim(c, 'mass')[0];
  const N = lab(c, 'force', /normal/);
  if (mu === null) return need(c, P, 'What is the coefficient of friction μ?');
  const notes: string[] = [];
  let normal: number;
  if (N) normal = N.v;
  else if (m) normal = m.v * gravity(c, notes);
  else return need(c, P, 'What is the mass (or the normal force)?');
  return res(c, { kind: P, expression: `Friction force, μ = ${show(mu)}`, value: mu * normal, unit: 'N', unitWords: 'newtons', formula: 'F = μN' + (N ? '' : ' = μmg'), lines: [['Normal force', withUnit(normal, 'N')]], notes: [...notes, 'On a level surface the normal force equals the weight'] });
};

// ─────────────── circular motion ───────────────
const circular: Handler = (c) => {
  if (!/centripetal|circular|in a circle|around a circle|banked/.test(c.s)) return null;
  const v = ofDim(c, 'velocity')[0];
  const r = lab(c, 'length', /radius|\br\b|circle of|curve of/) ?? ofDim(c, 'length')[0];
  const w = ofDim(c, 'angvel')[0];
  const T = lab(c, 'time', /period|takes|every|once/);
  const m = ofDim(c, 'mass')[0];
  if (!r) return need(c, P, 'What is the radius of the circle?');
  let speed: number;
  if (v) speed = v.v;
  else if (w) speed = w.v * r.v;
  else if (T) speed = (2 * Math.PI * r.v) / T.v;
  else return need(c, P, 'What is the speed (or angular velocity, or period)?');
  const a = (speed * speed) / r.v;
  const lines: [string, string][] = [['Speed', withUnit(speed, 'm/s')], ['Radius', withUnit(r.v, 'm')], ['Centripetal acceleration', withUnit(a, 'm/s²')], ['Angular velocity', withUnit(speed / r.v, 'rad/s')], ['Period', withUnit((2 * Math.PI * r.v) / speed, 's')]];
  if (m && /force|tension/.test(c.s)) return res(c, { kind: P, expression: `Centripetal force on ${withUnit(m.v, 'kg')}`, value: m.v * a, unit: 'N', unitWords: 'newtons', formula: 'F = mv²/r', lines });
  return res(c, { kind: P, expression: 'Centripetal acceleration', value: a, unit: 'm/s²', unitWords: 'metres per second squared', formula: 'a = v²/r', lines });
};

// ─────────────── work & power ───────────────
const workPower: Handler = (c) => {
  const isPower = /\bpower\b/.test(c.s) && /\blift|\braise|\bclimb|\bwork\b|\bin \d/.test(c.s);
  const isWork = /\bwork\b/.test(c.s) && !/work function|\bworks\b/.test(c.s);
  if (!isPower && !isWork) return null;
  if (!ofDim(c, 'force', 'mass', 'length').length) return null;
  const notes: string[] = [];
  const F = ofDim(c, 'force')[0];
  const d = ofDim(c, 'length')[0];
  const m = ofDim(c, 'mass')[0];
  const t = ofDim(c, 'time')[0];
  const ang = ofDim(c, 'angle')[0];
  let W: number;
  let formula: string;
  if (F && d) {
    W = F.v * d.v * (ang ? Math.cos(deg(ang.v)) : 1);
    formula = ang ? 'W = Fd cos θ' : 'W = Fd';
  } else if (m && d && /\blift|\braise|\bclimb|height|\bup\b/.test(c.s)) {
    W = m.v * gravity(c, notes) * d.v;
    formula = 'W = mgh';
  } else if (isWork) return need(c, P, 'Work needs a force and a distance (or a mass lifted through a height)');
  else return null;
  if (isPower) {
    if (!t) return need(c, P, 'How long does it take (the time)?');
    return res(c, { kind: P, expression: 'Power = work ÷ time', value: W / t.v, unit: 'W', unitWords: 'watts', formula: `P = W/t, ${formula}`, lines: [['Work', withUnit(W, 'J')], ['Time', withUnit(t.v, 's')], ['In horsepower', show(W / t.v / 745.7) + ' hp']], notes });
  }
  return res(c, { kind: P, expression: 'Work done', value: W, unit: 'J', unitWords: 'joules', formula, lines: ang ? [['Angle between force and motion', `${show(ang.v)}°`]] : [], notes });
};

// ─────────────── collisions & impulse ───────────────
const collisions: Handler = (c) => {
  if (/\bimpulse\b/.test(c.s)) {
    const F = ofDim(c, 'force')[0];
    const t = ofDim(c, 'time')[0];
    const m = ofDim(c, 'mass')[0];
    const vs = ofDim(c, 'velocity');
    if (F && t) return res(c, { kind: P, expression: 'Impulse', value: F.v * t.v, unit: 'N·s', unitWords: 'newton seconds', formula: 'J = FΔt' });
    if (m && vs.length >= 2) return res(c, { kind: P, expression: 'Impulse = change in momentum', value: m.v * (vs[1]!.v - vs[0]!.v), unit: 'N·s', unitWords: 'newton seconds', formula: 'J = m(v − u)' });
    return need(c, P, 'Impulse needs a force and a time, or a mass with initial and final velocities');
  }
  if (!/collision|collide|collides|elastic|stick together|sticks|coalesce/.test(c.s)) return null;
  const ms = ofDim(c, 'mass');
  const vs = ofDim(c, 'velocity');
  if (ms.length < 2) return need(c, P, 'A collision needs both masses');
  const [m1, m2] = [ms[0]!.v, ms[1]!.v];
  let u1: number, u2: number;
  if (vs.length >= 2) [u1, u2] = [vs[0]!.v, vs[1]!.v];
  else if (vs.length === 1 && /\brest\b|stationary|at rest|still/.test(c.s)) {
    // Which body is at rest: the one mentioned after "rest" lacks a velocity.
    const restIdx = c.s.search(/\brest\b|stationary|still/);
    const v1Before = vs[0]!.index < ms[1]!.index || restIdx > ms[1]!.index;
    [u1, u2] = v1Before ? [vs[0]!.v, 0] : [0, vs[0]!.v];
  } else return need(c, P, 'What are both initial velocities (say "at rest" for 0)?');
  const p = m1 * u1 + m2 * u2;
  const ke0 = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  if (/inelastic|stick|coalesce|together/.test(c.s)) {
    const v = p / (m1 + m2);
    const ke1 = 0.5 * (m1 + m2) * v * v;
    return res(c, { kind: P, expression: 'Perfectly inelastic collision (bodies stick together)', value: v, unit: 'm/s', unitWords: 'metres per second', formula: 'v = (m₁u₁ + m₂u₂)/(m₁ + m₂)', lines: [['Total momentum', withUnit(p, 'kg·m/s')], ['Kinetic energy before', withUnit(ke0, 'J')], ['Kinetic energy after', withUnit(ke1, 'J')], ['Kinetic energy lost', withUnit(ke0 - ke1, 'J')]], notes: ['Momentum is conserved; kinetic energy is not'] });
  }
  if (!/\belastic\b/.test(c.s)) return need(c, P, 'Is the collision elastic, or do the bodies stick together (perfectly inelastic)?');
  const v1 = ((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2);
  const v2 = ((m2 - m1) * u2 + 2 * m1 * u1) / (m1 + m2);
  return res(c, {
    kind: P,
    expression: 'Elastic collision in one dimension',
    display: `v₁ = ${withUnit(v1, 'm/s')}, v₂ = ${withUnit(v2, 'm/s')}`,
    value: v2,
    formula: 'v₁ = ((m₁−m₂)u₁ + 2m₂u₂)/(m₁+m₂), v₂ = ((m₂−m₁)u₂ + 2m₁u₁)/(m₁+m₂)',
    lines: [['Body 1 after', withUnit(v1, 'm/s')], ['Body 2 after', withUnit(v2, 'm/s')], ['Total momentum', withUnit(p, 'kg·m/s')], ['Kinetic energy (conserved)', withUnit(ke0, 'J')]],
    notes: ['Momentum and kinetic energy are both conserved; positive is the direction of the first body'],
  });
};

// ─────────────── rotation ───────────────
const SHAPES: [RegExp, number, string, 'R' | 'L' | 'ab'][] = [
  [/hollow sphere|spherical shell|thin shell/, 2 / 3, 'I = ⅔MR²', 'R'],
  [/solid sphere|\bsphere|\bball\b/, 2 / 5, 'I = ⅖MR²', 'R'],
  [/hollow cylinder|thin.?walled cylinder|\bring\b|\bhoop\b|cylindrical shell/, 1, 'I = MR²', 'R'],
  [/solid cylinder|\bdis[ck]\b|\bcylinder|\bwheel|flywheel/, 1 / 2, 'I = ½MR²', 'R'],
  [/rod.*\b(?:end|one end)\b|rod about (?:its |the )?end/, 1 / 3, 'I = ⅓ML²', 'L'],
  [/\brod\b|\bstick\b|\bbar\b/, 1 / 12, 'I = (1/12)ML²', 'L'],
  [/plate|rectang/, 1 / 12, 'I = (1/12)M(a² + b²)', 'ab'],
];
const rotation: Handler = (c) => {
  if (/\btorque\b/.test(c.s) && !/transfer function/.test(c.s)) {
    const F = ofDim(c, 'force')[0];
    const r = ofDim(c, 'length')[0];
    const ang = ofDim(c, 'angle')[0];
    const I = ofDim(c, 'inertia')[0];
    const al = named(c, 'angular acceleration|α|alpha');
    if (I && al !== null) return res(c, { kind: P, expression: 'Torque from Iα', value: I.v * al, unit: 'N·m', unitWords: 'newton metres', formula: 'τ = Iα' });
    if (!F || !r) return need(c, P, 'Torque needs a force and a lever arm (distance)');
    const s = ang ? Math.sin(deg(ang.v)) : 1;
    return res(c, { kind: P, expression: 'Torque', value: F.v * r.v * s, unit: 'N·m', unitWords: 'newton metres', formula: ang ? 'τ = rF sin θ' : 'τ = rF (force perpendicular to the arm)', lines: [['Force', withUnit(F.v, 'N')], ['Lever arm', withUnit(r.v, 'm')]] });
  }
  if (/moment of inertia|rotational inertia/.test(c.s)) {
    const m = ofDim(c, 'mass')[0];
    if (!m) return null; // area moments (sections) are engineering
    const shape = SHAPES.find(([re]) => re.test(c.s));
    if (!shape) return need(c, P, 'Which shape: solid disk/cylinder, ring, solid sphere, hollow sphere, rod (centre or end), or plate?');
    const ls = ofDim(c, 'length');
    let I: number;
    if (shape[3] === 'ab') {
      if (ls.length < 2) return need(c, P, 'A plate needs both side lengths');
      I = shape[1] * m.v * (ls[0]!.v ** 2 + ls[1]!.v ** 2);
    } else {
      let r = shape[3] === 'R' ? lab(c, 'length', /radius|\br\b/) : undefined;
      const d = shape[3] === 'R' ? lab(c, 'length', /diameter/) : undefined;
      const R = r?.v ?? (d ? d.v / 2 : ls[0]?.v);
      if (R === undefined) return need(c, P, shape[3] === 'R' ? 'What is the radius?' : 'What is the length?');
      I = shape[1] * m.v * R * R;
    }
    return res(c, { kind: P, expression: 'Moment of inertia', value: I, unit: 'kg·m²', unitWords: 'kilogram square metres', formula: shape[2], notes: ['About the central (symmetry) axis unless stated'] });
  }
  if (/rotational kinetic|rotational energy|kinetic energy of rotation/.test(c.s)) {
    const I = ofDim(c, 'inertia')[0];
    const w = ofDim(c, 'angvel')[0];
    if (!I || !w) return need(c, P, 'Rotational kinetic energy needs I (kg·m²) and ω (rad/s or rpm)');
    return res(c, { kind: P, expression: 'Rotational kinetic energy', value: 0.5 * I.v * w.v ** 2, unit: 'J', unitWords: 'joules', formula: 'KE = ½Iω²', lines: [['ω', withUnit(w.v, 'rad/s')]] });
  }
  if (/angular momentum/.test(c.s)) {
    const I = ofDim(c, 'inertia')[0];
    const w = ofDim(c, 'angvel')[0];
    if (!I || !w) return need(c, P, 'Angular momentum needs I (kg·m²) and ω');
    return res(c, { kind: P, expression: 'Angular momentum', value: I.v * w.v, unit: 'kg·m²/s', formula: 'L = Iω' });
  }
  const rpm = /^(?:convert\s+)?(\S+)\s*rpm\s+(?:to|in)\s+rad(?:ians)?\s*(?:\/|per)\s*s(?:ec(?:ond)?)?$|angular (?:velocity|speed)/.exec(c.s);
  if (rpm) {
    const w = ofDim(c, 'angvel')[0];
    if (!w) return null;
    return res(c, { kind: P, expression: `Angular velocity of ${w.raw}`, value: w.v, unit: 'rad/s', unitWords: 'radians per second', formula: 'ω = 2π × rpm / 60', lines: [['Frequency', withUnit(w.v / (2 * Math.PI), 'Hz')], ['rpm', show((w.v * 60) / (2 * Math.PI))]] });
  }
  return null;
};

// ─────────────── gravitation, orbits ───────────────
const gravitation: Handler = (c) => {
  const b = body(c);
  if (/escape (?:velocity|speed)/.test(c.s)) {
    let M = lab(c, 'mass', /mass|\bm\b/)?.v ?? ofDim(c, 'mass')[0]?.v;
    let R = lab(c, 'length', /radius|\br\b/)?.v ?? ofDim(c, 'length')[0]?.v;
    if ((M === undefined || R === undefined) && b) [M, R] = [M ?? b[0], R ?? b[1]];
    if (M === undefined || R === undefined) return need(c, P, 'Escape velocity needs the body (e.g. "of Mars") or its mass and radius');
    const v = Math.sqrt((2 * K.G * M) / R);
    return res(c, { kind: P, expression: `Escape velocity${b ? ` from ${b[2]}` : ''}`, value: v, unit: 'm/s', unitWords: 'metres per second', formula: 'v = √(2GM/R)', lines: [['In km/s', show(v / 1000) + ' km/s'], ['Mass', withUnit(M, 'kg')], ['Radius', withUnit(R, 'm')]], notes: b ? ['Mass and mean radius: NASA planetary fact sheet', 'Ignores air resistance and rotation'] : [] });
  }
  if (/orbit|satellite/.test(c.s)) {
    let M = ofDim(c, 'mass')[0]?.v;
    const alt = lab(c, 'length', /altitude|above|height/);
    const rr = lab(c, 'length', /radius|distance|\br\b|semi-?major/) ?? (alt ? undefined : ofDim(c, 'length')[0]);
    const B = b ?? (alt ? BODIES.earth! : null);
    if (M === undefined) M = B?.[0];
    if (M === undefined) return need(c, P, 'Which body is being orbited (e.g. "around Earth"), or its mass?');
    let r: number;
    if (alt) r = (B?.[1] ?? 0) + alt.v;
    else if (rr) r = rr.v;
    else return need(c, P, 'At what orbital radius or altitude?');
    const v = Math.sqrt((K.G * M) / r);
    const T = 2 * Math.PI * Math.sqrt(r ** 3 / (K.G * M));
    const lines: [string, string][] = [['Orbital radius', withUnit(r, 'm')], ['Orbital speed', withUnit(v, 'm/s')], ['Period', `${withUnit(T, 's')} (${duration(T)})`]];
    const notes = alt ? [`Radius = ${B?.[2] ?? 'body'} radius + altitude`, 'Circular orbit'] : ['Circular orbit'];
    if (/period|how long|time/.test(c.s)) return res(c, { kind: P, expression: `Orbital period${B ? ` around ${B[2]}` : ''}`, value: T, unit: 's', unitWords: 'seconds', formula: 'T = 2π√(r³/GM)', lines, notes });
    return res(c, { kind: P, expression: `Orbital speed${B ? ` around ${B[2]}` : ''}`, value: v, unit: 'm/s', unitWords: 'metres per second', formula: 'v = √(GM/r)', lines, notes });
  }
  if (/surface gravity|gravity on|gravitational acceleration (?:on|of|at)|\bg on\b|weigh(?:t)? on/.test(c.s) && b) {
    const g = (K.G * b[0]) / b[1] ** 2;
    const m = ofDim(c, 'mass')[0];
    if (m && /weigh/.test(c.s)) return res(c, { kind: P, expression: `Weight of ${withUnit(m.v, 'kg')} on ${b[2]}`, value: m.v * g, unit: 'N', unitWords: 'newtons', formula: 'W = mg, g = GM/R²', lines: [['Surface gravity', withUnit(g, 'm/s²')], ['Relative to Earth', show(g / 9.80665) + ' g']] });
    return res(c, { kind: P, expression: `Surface gravity of ${b[2]}`, value: g, unit: 'm/s²', unitWords: 'metres per second squared', formula: 'g = GM/R²', lines: [['Relative to Earth', show(g / 9.80665) + ' g']], notes: ['Mass and mean radius: NASA planetary fact sheet; ignores rotation'] });
  }
  if (/gravitational (?:force|attraction|pull)|force of gravity between|newton'?s law of (?:universal )?gravitation/.test(c.s)) {
    const ms = ofDim(c, 'mass');
    const r = ofDim(c, 'length')[0];
    if (ms.length < 2 || !r) return need(c, P, 'Gravitational force needs two masses and the distance between them');
    return res(c, { kind: P, expression: 'Gravitational force between two masses', value: (K.G * ms[0]!.v * ms[1]!.v) / r.v ** 2, unit: 'N', unitWords: 'newtons', formula: 'F = Gm₁m₂/r²', lines: [['G', '6.674 × 10⁻¹¹ N·m²/kg²']] });
  }
  if (/kepler/.test(c.s)) {
    const a = ofDim(c, 'length')[0];
    const T = ofDim(c, 'time')[0];
    const M = ofDim(c, 'mass')[0]?.v ?? (b && b[2] !== 'Earth' ? b[0] : BODIES.sun![0]);
    if (a) {
      const t = 2 * Math.PI * Math.sqrt(a.v ** 3 / (K.G * M));
      return res(c, { kind: P, expression: "Kepler's third law: period from semi-major axis", value: t / 31557600, unit: 'years', formula: 'T² = 4π²a³/(GM)', lines: [['Period', duration(t)]], notes: [M === BODIES.sun![0] ? 'Orbiting the Sun' : `Central mass ${show(M)} kg`] });
    }
    if (T) {
      const ax = Math.cbrt((K.G * M * T.v ** 2) / (4 * Math.PI ** 2));
      return res(c, { kind: P, expression: "Kepler's third law: semi-major axis from period", value: ax / 1.495978707e11, unit: 'AU', formula: 'a³ = GMT²/(4π²)', lines: [['In metres', withUnit(ax, 'm')]], notes: [M === BODIES.sun![0] ? 'Orbiting the Sun' : `Central mass ${show(M)} kg`] });
    }
    return need(c, P, "Kepler's third law needs the semi-major axis (AU) or the period");
  }
  if (/schwarzschild|event horizon/.test(c.s)) {
    const M = ofDim(c, 'mass')[0]?.v ?? b?.[0];
    const solar = /(\d[\d.e+-]*)\s*solar mass/.exec(c.s);
    const mass = solar ? num(solar[1]!) * BODIES.sun![0] : M;
    if (mass === undefined) return need(c, P, 'Schwarzschild radius needs a mass');
    const r = (2 * K.G * mass) / K.c ** 2;
    return res(c, { kind: P, expression: 'Schwarzschild radius', value: r, unit: 'm', unitWords: 'metres', formula: 'r = 2GM/c²', lines: [['In km', show(r / 1000) + ' km']] });
  }
  return null;
};

// ─────────────── SHM: pendulums & springs ───────────────
const shm: Handler = (c) => {
  if (/pendulum/.test(c.s)) {
    const notes: string[] = ['Simple pendulum, small-angle approximation'];
    const g0 = gravity(c, notes);
    const b = body(c);
    const g = b && !/earth/.test(c.s) ? (K.G * b[0]) / b[1] ** 2 : g0;
    if (b && !/earth/.test(c.s)) notes.push(`g on ${b[2]} = ${show(g)} m/s²`);
    const L = ofDim(c, 'length')[0];
    const T = ofDim(c, 'time')[0];
    if (L && !/length|how long a|what length/.test(c.s.slice(0, L.index))) {
      const per = 2 * Math.PI * Math.sqrt(L.v / g);
      if (/frequency/.test(c.s)) return res(c, { kind: P, expression: `Pendulum frequency, L = ${withUnit(L.v, 'm')}`, value: 1 / per, unit: 'Hz', unitWords: 'hertz', formula: 'f = (1/2π)√(g/L)', lines: [['Period', withUnit(per, 's')]], notes });
      return res(c, { kind: P, expression: `Pendulum period, L = ${withUnit(L.v, 'm')}`, value: per, unit: 's', unitWords: 'seconds', formula: 'T = 2π√(L/g)', lines: [['Frequency', withUnit(1 / per, 'Hz')]], notes });
    }
    if (T) return res(c, { kind: P, expression: `Pendulum length for a ${withUnit(T.v, 's')} period`, value: (g * T.v ** 2) / (4 * Math.PI ** 2), unit: 'm', unitWords: 'metres', formula: 'L = gT²/(4π²)', notes });
    return need(c, P, 'What is the pendulum length (or the period)?');
  }
  if (!/spring|hooke|\bk\s*=|oscillat|shm|simple harmonic/.test(c.s)) return null;
  const k = ofDim(c, 'stiffness')[0]?.v ?? named(c, 'k|spring constant|stiffness', 'stiffness');
  const m = ofDim(c, 'mass')[0];
  const x = lab(c, 'length', /stretch|compress|extension|displace|\bx\b|amplitude|by/) ?? ofDim(c, 'length')[0];
  const F = ofDim(c, 'force')[0];
  if (/potential energy|elastic energy|energy stored|spring energy/.test(c.s)) {
    if (k === null || !x) return need(c, P, 'Elastic potential energy needs k and the extension x');
    return res(c, { kind: P, expression: 'Elastic potential energy in a spring', value: 0.5 * k * x.v ** 2, unit: 'J', unitWords: 'joules', formula: 'U = ½kx²' });
  }
  if (/period|frequency|oscillat/.test(c.s) && m && k !== null) {
    const T = 2 * Math.PI * Math.sqrt(m.v / k);
    const lines: [string, string][] = [['Period', withUnit(T, 's')], ['Frequency', withUnit(1 / T, 'Hz')], ['Angular frequency', withUnit(Math.sqrt(k / m.v), 'rad/s')]];
    if (/frequency/.test(c.s) && !/period/.test(c.s)) return res(c, { kind: P, expression: 'Mass–spring oscillator frequency', value: 1 / T, unit: 'Hz', unitWords: 'hertz', formula: 'f = (1/2π)√(k/m)', lines });
    return res(c, { kind: P, expression: 'Mass–spring oscillator period', value: T, unit: 's', unitWords: 'seconds', formula: 'T = 2π√(m/k)', lines });
  }
  if (F && x && k === null) return res(c, { kind: P, expression: "Spring constant (Hooke's law)", value: F.v / x.v, unit: 'N/m', unitWords: 'newtons per metre', formula: 'k = F/x' });
  if (k !== null && x) return res(c, { kind: P, expression: "Spring force (Hooke's law)", value: k * x.v, unit: 'N', unitWords: 'newtons', formula: 'F = kx' });
  if (k !== null && F) return res(c, { kind: P, expression: "Spring extension (Hooke's law)", value: F.v / k, unit: 'm', unitWords: 'metres', formula: 'x = F/k' });
  return null;
};

// ─────────────── fluids ───────────────
const FLUIDS: [RegExp, number, string][] = [
  [/sea ?water|salt ?water|ocean|\bsea\b/, 1025, 'seawater'],
  [/mercury/, 13534, 'mercury'],
  [/\boil\b/, 920, 'oil'],
  [/glycerin|glycerol/, 1260, 'glycerin'],
  [/\bair\b/, 1.225, 'air'],
  [/water|\bpool\b|\blake\b|\btank\b/, 1000, 'water'],
];
function fluid(c: Ctx): [number, string] | null {
  const d = ofDim(c, 'density')[0];
  if (d) return [d.v, `ρ = ${withUnit(d.v, 'kg/m³')}`];
  const f = FLUIDS.find(([re]) => re.test(c.s));
  return f ? [f[1], `${f[2]} (ρ = ${f[1]} kg/m³)`] : null;
}
const fluids: Handler = (c) => {
  if (/pressure (?:at|under)|depth|hydrostatic|below the surface|under ?water/.test(c.s) && !/hole|torricelli|speed|velocity/.test(c.s)) {
    const h = lab(c, 'length', /depth|deep|below|under|at|height/) ?? ofDim(c, 'length')[0];
    if (!h) return need(c, P, 'At what depth?');
    const fl = fluid(c) ?? [1000, 'water (ρ = 1000 kg/m³, assumed)'];
    const notes: string[] = [`Fluid: ${fl[1]}`];
    const g = gravity(c, notes);
    const gauge = fl[0] * g * h.v;
    return res(c, { kind: P, expression: `Pressure at ${withUnit(h.v, 'm')} depth`, value: gauge, unit: 'Pa', unitWords: 'pascals', formula: 'P = ρgh (gauge)', lines: [['Gauge pressure', withUnit(gauge / 1000, 'kPa')], ['Absolute pressure', withUnit((gauge + K.atm) / 1000, 'kPa') + ' (adds 1 atm)'], ['In atmospheres', show(gauge / K.atm) + ' atm gauge']], notes });
  }
  if (/buoyan|archimedes|upthrust/.test(c.s)) {
    const V = ofDim(c, 'volume')[0];
    if (!V) return need(c, P, 'Buoyant force needs the displaced (submerged) volume');
    const fl = fluid(c) ?? [1000, 'water (ρ = 1000 kg/m³, assumed)'];
    const notes = [`Fluid: ${fl[1]}`];
    const g = gravity(c, notes);
    return res(c, { kind: P, expression: 'Buoyant force (Archimedes)', value: fl[0] * g * V.v, unit: 'N', unitWords: 'newtons', formula: 'F_b = ρ_fluid · g · V_displaced', notes });
  }
  if (/torricelli|(?:hole|leak|orifice|spout)/.test(c.s) && /speed|velocity|how fast|efflux/.test(c.s)) {
    const h = ofDim(c, 'length')[0];
    if (!h) return need(c, P, 'How far below the surface is the hole?');
    const notes: string[] = [];
    const g = gravity(c, notes);
    return res(c, { kind: P, expression: "Efflux speed (Torricelli's law)", value: Math.sqrt(2 * g * h.v), unit: 'm/s', unitWords: 'metres per second', formula: 'v = √(2gh)', notes });
  }
  if (/continuity|pipe narrows|narrows|constriction|(?:diameter|radius|area).*(?:to|then|narrow)/.test(c.s) && ofDim(c, 'velocity').length && !/reynolds|head loss|flow rate/.test(c.s)) {
    const v1 = ofDim(c, 'velocity')[0]!;
    const ls = ofDim(c, 'length');
    const as = ofDim(c, 'area');
    let ratio: number;
    if (as.length >= 2) ratio = as[0]!.v / as[1]!.v;
    else if (ls.length >= 2) ratio = (ls[0]!.v / ls[1]!.v) ** 2;
    else return need(c, P, 'The continuity equation needs both diameters (or areas)');
    const v2 = v1.v * ratio;
    const lines: [string, string][] = [['Area ratio A₁/A₂', show(ratio)]];
    const fl = fluid(c);
    if (/bernoulli|pressure/.test(c.s)) lines.push(['Pressure drop (Bernoulli, level pipe)', withUnit((0.5 * (fl?.[0] ?? 1000) * (v2 ** 2 - v1.v ** 2)) / 1000, 'kPa')]);
    return res(c, { kind: P, expression: 'Continuity equation: speed in the narrow section', value: v2, unit: 'm/s', unitWords: 'metres per second', formula: 'A₁v₁ = A₂v₂', lines, notes: ['Incompressible flow'] });
  }
  if (/bernoulli/.test(c.s)) {
    const vs = ofDim(c, 'velocity');
    const fl = fluid(c) ?? [1000, 'water (ρ = 1000 kg/m³, assumed)'];
    if (vs.length >= 2) {
      const dp = 0.5 * fl[0] * (vs[1]!.v ** 2 - vs[0]!.v ** 2);
      const hs = ofDim(c, 'length');
      const notes = [`Fluid: ${fl[1]}`];
      let dz = 0;
      if (hs.length >= 2) dz = fl[0] * gravity(c, notes) * (hs[1]!.v - hs[0]!.v);
      return res(c, { kind: P, expression: 'Bernoulli: pressure difference P₁ − P₂', value: dp + dz, unit: 'Pa', unitWords: 'pascals', formula: 'P₁ − P₂ = ½ρ(v₂² − v₁²) + ρg(h₂ − h₁)', notes });
    }
    return need(c, P, "Bernoulli's equation needs the two speeds (and heights if they differ)");
  }
  return null;
};

// ─────────────── thermodynamics ───────────────
// Specific heats J/(kg·K): Serway & Jewett, Physics for Scientists and Engineers, Table 20.1.
const SPECIFIC: [RegExp, number, string][] = [
  [/\bice\b/, 2090, 'ice'], [/steam/, 2010, 'steam'], [/water/, 4186, 'water'], [/alumin/, 900, 'aluminium'], [/copper/, 387, 'copper'], [/iron/, 448, 'iron'], [/steel/, 490, 'steel'],
  [/lead/, 128, 'lead'], [/silver/, 234, 'silver'], [/gold/, 129, 'gold'], [/glass/, 837, 'glass'], [/brass/, 380, 'brass'], [/wood/, 1700, 'wood'], [/\bair\b/, 1005, 'air'],
];
// Linear expansion coefficients 1/K: Serway & Jewett Table 19.1.
const ALPHA: [RegExp, number, string][] = [[/alumin/, 24e-6, 'aluminium'], [/brass/, 19e-6, 'brass'], [/copper/, 17e-6, 'copper'], [/pyrex/, 3.2e-6, 'Pyrex'], [/glass/, 9e-6, 'glass'], [/lead/, 29e-6, 'lead'], [/steel|iron/, 11e-6, 'steel'], [/invar/, 0.9e-6, 'Invar'], [/concrete/, 12e-6, 'concrete']];

function deltaT(c: Ctx): number | null {
  const ts = temperatures(c);
  const d = ts.find((t) => t.delta);
  const m = /(?:Δt|delta t|dt|temperature change|change in temperature)\s*(?:=|of|:)?\s*(-?\d+(?:\.\d+)?)/.exec(c.s);
  if (m) return num(m[1]!);
  if (d) return d.k - 273.15 + (/k(?:elvin)?$/.test(d.raw) ? 273.15 : 0);
  if (ts.length >= 2) return ts[1]!.k - ts[0]!.k;
  return null;
}
const thermo: Handler = (c) => {
  if (/carnot|heat engine|efficiency/.test(c.s) && !/otto|diesel|brayton|power factor|cop\b|refrigerat|heat pump|compression ratio|pressure ratio/.test(c.s)) {
    const ts = temperatures(c);
    if (ts.length >= 2) {
      const [Th, Tc] = ts[0]!.k > ts[1]!.k ? [ts[0]!.k, ts[1]!.k] : [ts[1]!.k, ts[0]!.k];
      return res(c, { kind: P, expression: 'Carnot (maximum) efficiency', value: 1 - Tc / Th, display: `${show((1 - Tc / Th) * 100)}%`, formula: 'η = 1 − T_c/T_h', lines: [['T_hot', withUnit(Th, 'K')], ['T_cold', withUnit(Tc, 'K')]], notes: ['Temperatures must be absolute (kelvin); °C values were converted'] });
    }
    const es = ofDim(c, 'energy');
    if (es.length >= 2 && /efficiency/.test(c.s)) {
      const Qin = lab(c, 'energy', /in(?:put)?|absorb|heat|supplied|takes/) ?? es[0]!;
      const W = es.find((e) => e !== Qin)!;
      const eff = W.v / Qin.v;
      return res(c, { kind: P, expression: 'Thermal efficiency', value: eff, display: `${show(eff * 100)}%`, formula: 'η = W/Q_in', lines: [['Heat rejected', withUnit(Qin.v - W.v, 'J')]] });
    }
    return null;
  }
  if (/entropy/.test(c.s)) {
    const Q = ofDim(c, 'energy')[0];
    const T = temperatures(c)[0];
    const m = ofDim(c, 'mass')[0];
    if (/melt|fus/.test(c.s) && m) return res(c, { kind: P, expression: 'Entropy change on melting ice', value: (m.v * 3.34e5) / 273.15, unit: 'J/K', formula: 'ΔS = mL_f/T', notes: ['L_f = 334 kJ/kg, T = 273.15 K'] });
    if (!Q || !T) return need(c, P, 'Entropy change ΔS = Q/T needs the heat and the (absolute) temperature');
    return res(c, { kind: P, expression: 'Entropy change at constant temperature', value: Q.v / T.k, unit: 'J/K', unitWords: 'joules per kelvin', formula: 'ΔS = Q/T' });
  }
  if (/thermal expansion|expan(?:d|sion)|expands/.test(c.s)) {
    const L = ofDim(c, 'length')[0];
    const dT = deltaT(c);
    const a = named(c, 'α|alpha|coefficient') ?? ALPHA.find(([re]) => re.test(c.s))?.[1] ?? null;
    if (!L || dT === null || a === null) return need(c, P, 'Linear expansion needs the length, the temperature change and α (or the material)');
    const mat = ALPHA.find(([re]) => re.test(c.s));
    return res(c, { kind: P, expression: 'Linear thermal expansion', value: a * L.v * dT, unit: 'm', unitWords: 'metres', formula: 'ΔL = αLΔT', lines: [['ΔL in mm', show(a * L.v * dT * 1000) + ' mm'], ['α', `${show(a)} /K${mat ? ` (${mat[2]})` : ''}`]], notes: mat ? ['α from Serway & Jewett Table 19.1'] : [] });
  }
  if (/stefan|radiat(?:ed|es|ion) power|black ?body.*power|power radiated/.test(c.s)) {
    const A = ofDim(c, 'area')[0];
    const T = temperatures(c)[0];
    const e = named(c, 'emissivity|ε|epsilon') ?? 1;
    if (!A || !T) return need(c, P, 'Radiated power needs the area and the temperature');
    return res(c, { kind: P, expression: 'Radiated power (Stefan–Boltzmann)', value: e * K.sigma * A.v * T.k ** 4, unit: 'W', unitWords: 'watts', formula: 'P = εσAT⁴', lines: [['Emissivity', show(e)]] });
  }
  if (/wien|peak wavelength/.test(c.s)) {
    const T = temperatures(c)[0];
    if (!T) return need(c, P, 'What temperature?');
    const l = K.wien / T.k;
    return res(c, { kind: P, expression: "Peak wavelength (Wien's law)", value: l * 1e9, unit: 'nm', unitWords: 'nanometres', formula: 'λ_max = b/T, b = 2.898 × 10⁻³ m·K' });
  }
  const latent = /\b(melt|fus(?:e|ion)|freez|vapori[sz]|boil|evaporat|condens)/.exec(c.s);
  const heatQ = /\bheat|energy|how much|joules|calories/.test(c.s);
  if (latent && heatQ && !/\bby\b|from -?\d.*to -?\d|Δt/.test(c.s)) {
    const m = ofDim(c, 'mass')[0];
    if (!m) return need(c, P, 'What mass?');
    const fus = /melt|fus|freez/.test(latent[1]!);
    const L = named(c, 'latent heat|l_f|lf|l_v|lv|l', 'energy') ?? (fus ? 3.34e5 : 2.26e6);
    return res(c, { kind: P, expression: fus ? `Heat to melt ${withUnit(m.v, 'kg')} of ice` : `Heat to vaporise ${withUnit(m.v, 'kg')} of water`, value: m.v * L, unit: 'J', unitWords: 'joules', formula: fus ? 'Q = mL_f' : 'Q = mL_v', lines: [['In kJ', show((m.v * L) / 1000) + ' kJ']], notes: [fus ? 'L_f (water) = 334 kJ/kg' : 'L_v (water) = 2,260 kJ/kg', 'At constant temperature (0 °C / 100 °C)'] });
  }
  if (/\bheat|specific heat|q\s*=\s*mc|raise the temperature|warm|cool/.test(c.s) && !/heat pump|heat engine|heat capacity ratio/.test(c.s)) {
    const m = ofDim(c, 'mass')[0];
    const dT = deltaT(c);
    if (!m || dT === null) return null;
    const given = named(c, 'c|specific heat(?: capacity)?');
    const mat = SPECIFIC.find(([re]) => re.test(c.s));
    const cp = given ?? mat?.[1];
    if (cp === undefined) return need(c, P, 'What is the material (or its specific heat c in J/(kg·K))?');
    const Q = m.v * cp * dT;
    return res(c, { kind: P, expression: `Heat Q = mcΔT${mat && given === null ? ` for ${mat[2]}` : ''}`, value: Q, unit: 'J', unitWords: 'joules', formula: 'Q = mcΔT', lines: [['Mass', withUnit(m.v, 'kg')], ['c', `${show(cp)} J/(kg·K)`], ['ΔT', `${show(dT)} K`], ['In kJ', show(Q / 1000) + ' kJ'], ['In kcal', show(Q / 4184) + ' kcal']], notes: mat && given === null ? ['Specific heat from Serway & Jewett Table 20.1'] : [] });
  }
  return null;
};

// ─────────────── waves & sound ───────────────
function soundSpeed(c: Ctx, notes: string[]): number {
  const v = lab(c, 'velocity', /speed of sound|sound speed|v\s*=/);
  if (v) return v.v;
  notes.push('Speed of sound 343 m/s (air at 20 °C)');
  return 343;
}
const waves: Handler = (c) => {
  if (/speed of sound/.test(c.s) && !/doppler|source|observer/.test(c.s)) {
    const T = temperatures(c)[0];
    const tc = T ? T.k - 273.15 : 20;
    return res(c, { kind: P, expression: `Speed of sound in dry air at ${show(tc)} °C`, value: 331.3 * Math.sqrt(1 + tc / 273.15), unit: 'm/s', unitWords: 'metres per second', formula: 'v = 331.3√(1 + T/273.15) m/s', notes: T ? [] : ['20 °C assumed'] });
  }
  if (/doppler|approach|recede|receding|moving (?:toward|away)|towards? (?:a |the )?(?:stationary )?(?:observer|listener|source)/.test(c.s) && ofDim(c, 'frequency').length) {
    const f = ofDim(c, 'frequency')[0]!;
    const notes: string[] = [];
    const v = soundSpeed(c, notes);
    const speeds = ofDim(c, 'velocity').filter((q) => !/speed of sound|sound speed/.test(c.s.slice(Math.max(0, q.index - 20), q.index)));
    const src = lab(c, 'velocity', /source|siren|car|train|ambulance|horn|emit/) ?? (/observer|listener/.test(c.s) ? undefined : speeds[0]);
    const obs = lab(c, 'velocity', /observer|listener|you|detector/, src ? [src] : []);
    if (!src && !obs) return need(c, P, 'How fast is the source or observer moving?');
    const away = /away|recede|receding|leaving|moving off/.test(c.s);
    const s = away ? -1 : 1;
    const vs = src?.v ?? 0;
    const vo = obs?.v ?? 0;
    const fp = (f.v * (v + s * vo)) / (v - s * vs);
    notes.push(away ? 'Moving apart: frequency falls' : 'Moving together: frequency rises');
    return res(c, { kind: P, expression: 'Doppler-shifted frequency', value: fp, unit: 'Hz', unitWords: 'hertz', formula: "f' = f(v ± v_o)/(v ∓ v_s)", lines: [['Emitted', withUnit(f.v, 'Hz')], ['Source speed', withUnit(vs, 'm/s')], ['Observer speed', withUnit(vo, 'm/s')]], notes });
  }
  if (/\bdecibel|\bdb\b|sound (?:intensity )?level|intensity level/.test(c.s) && /sound|intensity|w\/m|loud|db at|combined|sources/.test(c.s)) {
    const I = ofDim(c, 'intensity')[0];
    const dbs = [...c.s.matchAll(new RegExp(String.raw`(${NUM})\s*(?:db|decibels?)\b`, 'g'))].map((m) => num(m[1]!));
    if (I && !dbs.length) return res(c, { kind: P, expression: 'Sound intensity level', value: 10 * Math.log10(I.v / 1e-12), unit: 'dB', unitWords: 'decibels', formula: 'β = 10 log₁₀(I/I₀), I₀ = 10⁻¹² W/m²' });
    if (dbs.length >= 2 && /combin|together|add|sum|plus|and/.test(c.s)) {
      const tot = 10 * Math.log10(dbs.reduce((s, d) => s + 10 ** (d / 10), 0));
      return res(c, { kind: P, expression: `Combined level of ${dbs.map((d) => `${show(d)} dB`).join(' + ')}`, value: tot, unit: 'dB', unitWords: 'decibels', formula: 'β = 10 log₁₀(Σ 10^(βᵢ/10))', notes: ['Incoherent sources: intensities add'] });
    }
    const ls = ofDim(c, 'length');
    if (dbs.length === 1 && ls.length >= 2) {
      const b2 = dbs[0]! - 20 * Math.log10(ls[1]!.v / ls[0]!.v);
      return res(c, { kind: P, expression: 'Sound level at a new distance (inverse-square law)', value: b2, unit: 'dB', unitWords: 'decibels', formula: 'β₂ = β₁ − 20 log₁₀(r₂/r₁)', notes: ['Point source in free field'] });
    }
    if (dbs.length === 1) return res(c, { kind: P, expression: `Intensity of a ${show(dbs[0]!)} dB sound`, value: 1e-12 * 10 ** (dbs[0]! / 10), unit: 'W/m²', unitWords: 'watts per square metre', formula: 'I = I₀ · 10^(β/10)' });
    return null;
  }
  if (/\bstring\b|guitar|violin|piano wire/.test(c.s) && /frequen|harmonic|fundamental|wave speed/.test(c.s)) {
    const L = ofDim(c, 'length')[0];
    const T = ofDim(c, 'force')[0];
    const mu = ofDim(c, 'linear')[0]?.v ?? named(c, 'μ|mu|linear (?:mass )?density');
    if (!L || !T || mu === null) return need(c, P, 'A string needs its length, tension and linear density (kg/m)');
    const n = named(c, 'n|harmonic') ?? 1;
    const v = Math.sqrt(T.v / mu);
    return res(c, { kind: P, expression: n === 1 ? 'Fundamental frequency of a string' : `Harmonic ${n} of a string`, value: (n * v) / (2 * L.v), unit: 'Hz', unitWords: 'hertz', formula: 'f_n = (n/2L)√(T/μ)', lines: [['Wave speed', withUnit(v, 'm/s')]] });
  }
  if (/\bpipe\b|organ|tube|air column/.test(c.s) && /frequen|harmonic|fundamental|resonan/.test(c.s)) {
    const L = ofDim(c, 'length')[0];
    if (!L) return need(c, P, 'How long is the pipe?');
    const notes: string[] = [];
    const v = soundSpeed(c, notes);
    const closed = /closed|stopped|one end/.test(c.s);
    if (!closed && !/open/.test(c.s)) return need(c, P, 'Is the pipe open at both ends or closed at one end?');
    const f = closed ? v / (4 * L.v) : v / (2 * L.v);
    return res(c, { kind: P, expression: `Fundamental of a pipe ${closed ? 'closed at one end' : 'open at both ends'}`, value: f, unit: 'Hz', unitWords: 'hertz', formula: closed ? 'f = v/4L (odd harmonics only)' : 'f = v/2L', lines: [['Next harmonics', closed ? `${show(3 * f)}, ${show(5 * f)} Hz` : `${show(2 * f)}, ${show(3 * f)} Hz`]], notes });
  }
  if (/\bbeat/.test(c.s)) {
    const fs = ofDim(c, 'frequency');
    if (fs.length < 2) return need(c, P, 'Beat frequency needs two frequencies');
    return res(c, { kind: P, expression: 'Beat frequency', value: Math.abs(fs[0]!.v - fs[1]!.v), unit: 'Hz', unitWords: 'hertz', formula: 'f_beat = |f₁ − f₂|' });
  }
  return null;
};

// ─────────────── optics ───────────────
const INDEX: [RegExp, number, string][] = [[/diamond/, 2.42, 'diamond'], [/water/, 1.333, 'water'], [/crown glass/, 1.52, 'crown glass'], [/glass/, 1.5, 'glass'], [/acrylic|perspex/, 1.49, 'acrylic'], [/ethanol/, 1.36, 'ethanol'], [/\bair\b|vacuum/, 1.0, 'air']];
function indices(c: Ctx): [number, number] | null {
  const n1 = named(c, 'n1|n₁|n_1');
  const n2 = named(c, 'n2|n₂|n_2');
  if (n1 !== null && n2 !== null) return [n1, n2];
  const m = /from (\w+(?: glass)?) (?:in)?to (\w+(?: glass)?)/.exec(c.s);
  if (m) {
    const a = INDEX.find(([re]) => re.test(m[1]!));
    const b = INDEX.find(([re]) => re.test(m[2]!));
    if (a && b) return [n1 ?? a[1], n2 ?? b[1]];
  }
  const ns = [...c.s.matchAll(/(?:index|n)\s*(?:of|=)?\s*(\d\.\d+)/g)].map((x) => num(x[1]!));
  if (ns.length >= 2) return [ns[0]!, ns[1]!];
  return null;
}
const optics: Handler = (c) => {
  if (/\blens|mirror/.test(c.s) && /focal|image|object/.test(c.s) && !/power of|diopter|dioptre/.test(c.s)) {
    const fq = lab(c, 'length', /focal|\bf\b/);
    const doq = lab(c, 'length', /object|\bd_?o\b|\bu\b/, fq ? [fq] : []);
    const diq = lab(c, 'length', /image|\bd_?i\b/, [fq, doq].filter((x): x is Qty => !!x));
    const unit = (fq ?? doq ?? diq)?.unit ?? 'm';
    const scale = (fq ?? doq ?? diq) ? (fq ?? doq ?? diq)!.v / num((fq ?? doq ?? diq)!.raw.replace(/[^\d.e+-]/g, '')) : 1;
    const diverging = /diverging|concave lens|convex mirror/.test(c.s);
    let f = fq?.v;
    if (f !== undefined && diverging && f > 0) f = -f;
    const mirror = /mirror/.test(c.s);
    const notes = [`Real-is-positive sign convention: positive image distance = real image${mirror ? ' (in front of the mirror)' : ' (opposite side of the lens)'}`];
    if (diverging) notes.push('Diverging element: focal length taken as negative');
    if (f !== undefined && doq) {
      const di = 1 / (1 / f - 1 / doq.v);
      const m = -di / doq.v;
      const kind = !Number.isFinite(di) ? 'at infinity' : di > 0 ? 'real, inverted' : 'virtual, upright';
      return res(c, { kind: P, expression: `${mirror ? 'Mirror' : 'Thin lens'}: image distance`, value: di / scale, unit, formula: '1/f = 1/d_o + 1/d_i', lines: [['Magnification', show(m)], ['Image', `${kind}, ${Math.abs(m) > 1 ? 'enlarged' : Math.abs(m) < 1 ? 'reduced' : 'same size'}`]], notes });
    }
    if (f !== undefined && diq) {
      const d0 = 1 / (1 / f - 1 / diq.v);
      return res(c, { kind: P, expression: 'Object distance', value: d0 / scale, unit, formula: '1/f = 1/d_o + 1/d_i', notes });
    }
    if (doq && diq) {
      const ff = 1 / (1 / doq.v + 1 / diq.v);
      return res(c, { kind: P, expression: 'Focal length', value: ff / scale, unit, formula: '1/f = 1/d_o + 1/d_i', lines: [['Magnification', show(-diq.v / doq.v)]], notes });
    }
    return need(c, P, 'The lens equation needs two of focal length, object distance and image distance');
  }
  if (/lens power|power of (?:a |the )?lens|diopt/.test(c.s)) {
    const f = ofDim(c, 'length')[0];
    if (f) return res(c, { kind: P, expression: 'Lens power', value: 1 / f.v, unit: 'D', unitWords: 'dioptres', formula: 'P = 1/f (f in metres)' });
    const d = named(c, 'power|diopters?|dioptres?');
    if (d) return res(c, { kind: P, expression: 'Focal length from lens power', value: 1 / d, unit: 'm', formula: 'f = 1/P' });
    return null;
  }
  if (/critical angle|total internal/.test(c.s)) {
    const ns = indices(c);
    let n1: number, n2: number;
    if (ns) [n1, n2] = ns;
    else {
      const m = INDEX.find(([re]) => re.test(c.s) && !/air/.test(re.source));
      const given = named(c, 'n|index|refractive index');
      if (given === null && !m) return need(c, P, 'What is the refractive index (or material)?');
      [n1, n2] = [given ?? m![1], 1.0];
    }
    if (n1 <= n2) return fail(c, P, 'Total internal reflection only happens going from a higher to a lower refractive index');
    return res(c, { kind: P, expression: `Critical angle, n₁ = ${show(n1)} → n₂ = ${show(n2)}`, value: todeg(Math.asin(n2 / n1)), unit: '°', unitWords: 'degrees', formula: 'sin θ_c = n₂/n₁' });
  }
  if (/brewster/.test(c.s)) {
    const ns = indices(c) ?? [1, named(c, 'n|index') ?? INDEX.find(([re]) => re.test(c.s) && !/air/.test(re.source))?.[1] ?? NaN];
    if (!Number.isFinite(ns[1])) return need(c, P, 'What refractive index?');
    return res(c, { kind: P, expression: "Brewster's angle", value: todeg(Math.atan(ns[1] / ns[0])), unit: '°', unitWords: 'degrees', formula: 'tan θ_B = n₂/n₁' });
  }
  if (/snell|refract/.test(c.s)) {
    const ns = indices(c);
    const a = ofDim(c, 'angle')[0];
    if (!ns || !a) return need(c, P, "Snell's law needs both refractive indices (n1, n2 or materials) and the incident angle");
    const s = (ns[0] * Math.sin(deg(a.v))) / ns[1];
    if (s > 1) return res(c, { kind: P, expression: "Snell's law", display: 'Total internal reflection', formula: 'n₁ sin θ₁ = n₂ sin θ₂', notes: [`n₁ sin θ₁ / n₂ = ${show(s)} > 1, so no refracted ray`] });
    return res(c, { kind: P, expression: `Refraction angle, n₁ = ${show(ns[0])}, n₂ = ${show(ns[1])}, θ₁ = ${show(a.v)}°`, value: todeg(Math.asin(s)), unit: '°', unitWords: 'degrees', formula: 'n₁ sin θ₁ = n₂ sin θ₂' });
  }
  if (/double.?slit|young|fringe/.test(c.s)) {
    const lam = lab(c, 'length', /wavelength|λ|light/) ?? ofDim(c, 'length').find((q) => q.v < 2e-6);
    const d = lab(c, 'length', /slit|spacing|separation|\bd\b/, lam ? [lam] : []);
    const L = lab(c, 'length', /screen|distance|\bl\b/, [lam, d].filter((x): x is Qty => !!x));
    if (!lam || !d || !L) return need(c, P, 'Fringe spacing needs the wavelength, the slit separation and the screen distance');
    const y = (lam.v * L.v) / d.v;
    return res(c, { kind: P, expression: 'Double-slit fringe spacing', value: y * 1000, unit: 'mm', unitWords: 'millimetres', formula: 'Δy = λL/d', notes: ['Small-angle approximation'] });
  }
  if (/grating|diffraction/.test(c.s)) {
    const lines = /(\d[\d,.]*)\s*(?:lines|slits|grooves)\s*(?:\/|per)\s*(mm|cm|m)\b/.exec(c.s);
    const lam = ofDim(c, 'length').find((q) => q.v < 2e-6 && q.v > 1e-8);
    if (!lines || !lam) return need(c, P, 'A grating needs lines per mm (or cm) and the wavelength');
    const d = { mm: 1e-3, cm: 1e-2, m: 1 }[lines[2] as 'mm' | 'cm' | 'm'] / num(lines[1]!);
    const order = named(c, 'order|m|n') ?? (/second order/.test(c.s) ? 2 : /third order/.test(c.s) ? 3 : 1);
    const s = (order * lam.v) / d;
    if (s > 1) return fail(c, P, `Order ${order} doesn't exist for this grating (mλ/d = ${show(s)} > 1)`);
    return res(c, { kind: P, expression: `Diffraction grating, order ${order}`, value: todeg(Math.asin(s)), unit: '°', unitWords: 'degrees', formula: 'd sin θ = mλ', lines: [['Slit spacing d', withUnit(d, 'm')], ['Highest order', String(Math.floor(d / lam.v))]] });
  }
  if (/malus|polari[sz]/.test(c.s)) {
    const a = ofDim(c, 'angle')[0];
    const I0 = ofDim(c, 'intensity')[0];
    if (!a) return need(c, P, 'What angle between the polariser axes?');
    const f = Math.cos(deg(a.v)) ** 2;
    return res(c, { kind: P, expression: "Malus's law", value: I0 ? I0.v * f : f, unit: I0 ? 'W/m²' : '', display: I0 ? undefined : `${show(f * 100)}% transmitted`, formula: 'I = I₀ cos² θ' });
  }
  return null;
};

export const physicsA: Handler[] = [friction, circular, workPower, collisions, rotation, gravitation, shm, fluids, thermo, waves, optics];
export type { AnswerResult };
export { quantities };
