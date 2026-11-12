import { paramsFor, type Params, type SimId } from './sims';

/**
 * "simulate a projectile at 20 m/s 45 degrees", "simulate a 2 m pendulum at 60°", "simulate a spring with k = 50",
 * "simulate a collision: 2 kg at 3 m/s and 1 kg at -1 m/s, inelastic", "simulate a block on a 30° ramp with
 * friction 0.2" → which lab to open and its settings. Null when the text isn't asking for a simulation.
 */
export interface Preset {
  sim: SimId;
  params: Params;
}

const NUM = String.raw`[-−]?\d+(?:\.\d+)?`;
const n = (s: string) => Number(s.replace('−', '-'));

/** True when the text asks for the physics lab at all (cheap check, safe for the main bundle to copy). */
export const SIM_REQUEST = /^\s*(?:(?:please\s+)?(?:simulate|simulation of|sim|animate|model)\b|(?:open|show)(?: the)? physics(?: lab)?\b|physics lab\b)/i;

const KINDS: [SimId, RegExp][] = [
  ['pendulum', /\bpendul/],
  ['spring', /\bspring|oscillat|harmonic|mass[- ]spring/],
  ['collision', /\bcollid|collision|crash|bump/],
  ['incline', /\bincline|ramp|slope|inclined plane/],
  ['projectile', /\bprojectile|throw|thrown|launch|cannon|ball|kick|fired|shot/],
];

export function parsePreset(text: string): Preset | null {
  if (!SIM_REQUEST.test(text)) return null;
  const s = text.toLowerCase().replace(/[−–]/g, '-').replace(/\s+/g, ' ');
  const sim = KINDS.find(([, re]) => re.test(s))?.[0] ?? 'projectile';
  const p: Params = {};
  const all = (re: RegExp) => [...s.matchAll(re)];
  const first = (re: RegExp) => re.exec(s);

  const speeds = all(new RegExp(`(${NUM})\\s*(?:m/s|mps|meters? per second|metres? per second)`, 'g')).map((m) => n(m[1]!));
  const angle = first(new RegExp(`(${NUM})\\s*(?:°|deg(?:rees?)?\\b)`));
  const masses = all(new RegExp(`(${NUM})\\s*(?:kg|kilograms?)\\b`, 'g')).map((m) => n(m[1]!));
  const metres = first(new RegExp(`(${NUM})\\s*(?:m|meters?|metres?)\\b(?!/)`));

  if (sim === 'projectile') {
    if (speeds[0] !== undefined) p.v0 = speeds[0];
    if (angle) p.angle = n(angle[1]!);
    const h = first(new RegExp(`(?:from|off|height(?: of)?|cliff of|tower of)\\s+(?:a\\s+)?(${NUM})\\s*(?:m|meters?|metres?)\\b`)) ?? first(new RegExp(`(${NUM})\\s*(?:m|meters?|metres?)\\s+(?:high|tall|cliff|tower|building)`));
    if (h) p.h0 = n(h[1]!);
    if (masses[0] !== undefined) p.mass = masses[0];
    const k = first(new RegExp(`drag(?: coefficient)?(?: of| k)?\\s*=?\\s*(${NUM})`));
    if (k) p.drag = n(k[1]!);
    else if (/\bdrag\b|air resistance/.test(s) && !/\bno (?:drag|air resistance)|without (?:drag|air resistance)/.test(s)) p.drag = 0.02;
  } else if (sim === 'pendulum') {
    const L = first(new RegExp(`(?:length(?: of)?|long|l\\s*=)\\s*(${NUM})`)) ?? metres;
    if (L) p.length = n(L[1]!);
    if (angle) p.theta0 = n(angle[1]!);
    if (masses[0] !== undefined) p.mass = masses[0];
    if (/small[- ]angle|linear(?:ised|ized)?|approximat/.test(s)) p.exact = 0;
    const d = first(new RegExp(`damping(?: of)?\\s*=?\\s*(${NUM})`));
    if (d) p.damping = n(d[1]!);
  } else if (sim === 'spring') {
    const k = first(new RegExp(`(?:\\bk\\s*=\\s*|spring constant(?: of)?\\s*)(${NUM})`)) ?? first(new RegExp(`(${NUM})\\s*n/m`));
    if (k) p.k = n(k[1]!);
    if (masses[0] !== undefined) p.mass = masses[0];
    const c = first(new RegExp(`(?:damping(?: of| coefficient)?|\\bc\\s*=)\\s*=?\\s*(${NUM})`));
    if (c) p.c = n(c[1]!);
    else if (/undamped|no damping|without damping/.test(s)) p.c = 0;
    const x = first(new RegExp(`(?:stretch(?:ed)?|pulled|displaced|amplitude|x0\\s*=)\\s*(?:by\\s+|of\\s+)?(${NUM})\\s*(cm|m)?`));
    if (x) p.x0 = n(x[1]!) / (x[2] === 'cm' ? 100 : 1);
  } else if (sim === 'collision') {
    if (masses[0] !== undefined) p.m1 = masses[0];
    if (masses[1] !== undefined) p.m2 = masses[1];
    if (speeds[0] !== undefined) p.v1 = speeds[0];
    if (speeds[1] !== undefined) p.v2 = speeds[1];
    const e = first(new RegExp(`(?:restitution|bounciness|\\be\\s*=)\\s*(?:of\\s+)?=?\\s*(${NUM})`));
    if (e) p.e = n(e[1]!);
    else if (/perfectly inelastic|stick together|sticks?\b/.test(s)) p.e = 0;
    else if (/inelastic/.test(s)) p.e = 0.5;
    else if (/elastic/.test(s)) p.e = 1;
  } else {
    if (angle) p.angle = n(angle[1]!);
    if (masses[0] !== undefined) p.mass = masses[0];
    const mu = all(new RegExp(`(?:friction|μ|mu|coefficient)(?:\\s+(?:coefficient|of))?\\s*=?\\s*(${NUM})`, 'g')).map((m) => n(m[1]!));
    const muS = first(new RegExp(`(?:static friction|μs|mu_?s)(?: of)?\\s*=?\\s*(${NUM})`));
    const muK = first(new RegExp(`(?:kinetic friction|μk|mu_?k)(?: of)?\\s*=?\\s*(${NUM})`));
    if (muS) p.muS = n(muS[1]!);
    if (muK) p.muK = n(muK[1]!);
    if (!muS && !muK && mu[0] !== undefined) {
      p.muK = mu[0];
      p.muS = Math.max(mu[0], mu[0] * 1.2);
    } else if (/frictionless|no friction|without friction/.test(s)) p.muK = p.muS = 0;
    const L = first(new RegExp(`(${NUM})\\s*(?:m|meters?|metres?)\\s+(?:long|ramp|slope|incline)`));
    if (L) p.length = n(L[1]!);
  }
  return { sim, params: paramsFor(sim, p) };
}
