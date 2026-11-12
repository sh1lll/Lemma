import { BODIES } from './physics';
import { K, NUM, deg, fail, lab, named, need, num, ofDim, res, show, withUnit, duration, type Ctx, type Handler } from './util';

const P = 'physics' as const;

// ─────────────── electricity & magnetism ───────────────
function charges(c: Ctx) {
  return ofDim(c, 'charge');
}
const electro: Handler = (c) => {
  if (/coulomb'?s law|electric(?:al|static)? force|force between (?:two )?(?:point )?charges|electrostatic/.test(c.s) || (/\bforce\b/.test(c.s) && charges(c).length >= 2)) {
    const q = charges(c);
    const r = ofDim(c, 'length')[0];
    if (q.length < 2 || !r) return need(c, P, "Coulomb's law needs two charges and the distance between them");
    const F = (K.ke * q[0]!.v * q[1]!.v) / r.v ** 2;
    return res(c, { kind: P, expression: "Electrostatic force (Coulomb's law)", value: Math.abs(F), unit: 'N', unitWords: 'newtons', formula: 'F = k|q₁q₂|/r²', lines: [['Direction', F > 0 ? 'repulsive (like charges)' : 'attractive (opposite charges)'], ['k', '8.988 × 10⁹ N·m²/C²']] });
  }
  if (/electric field/.test(c.s) && charges(c).length) {
    const q = charges(c)[0]!;
    const r = ofDim(c, 'length')[0];
    if (!r) return need(c, P, 'At what distance from the charge?');
    return res(c, { kind: P, expression: 'Electric field of a point charge', value: (K.ke * Math.abs(q.v)) / r.v ** 2, unit: 'N/C', unitWords: 'newtons per coulomb', formula: 'E = k|q|/r²' });
  }
  if (/electric(?:al)? potential energy|potential energy (?:of|between) (?:two )?charges/.test(c.s) && charges(c).length >= 2) {
    const q = charges(c);
    const r = ofDim(c, 'length')[0];
    if (!r) return need(c, P, 'At what separation?');
    return res(c, { kind: P, expression: 'Electric potential energy of two charges', value: (K.ke * q[0]!.v * q[1]!.v) / r.v, unit: 'J', unitWords: 'joules', formula: 'U = kq₁q₂/r' });
  }
  if (/electric potential|potential (?:due to|of a|at)/.test(c.s) && charges(c).length) {
    const q = charges(c)[0]!;
    const r = ofDim(c, 'length')[0];
    if (!r) return need(c, P, 'At what distance from the charge?');
    return res(c, { kind: P, expression: 'Electric potential of a point charge', value: (K.ke * q.v) / r.v, unit: 'V', unitWords: 'volts', formula: 'V = kq/r' });
  }
  const caps = ofDim(c, 'capacitance');
  if (/capacit/.test(c.s) && /series|parallel/.test(c.s) && caps.length >= 2) {
    const ser = /series/.test(c.s) && !/parallel/.test(c.s);
    if (/series/.test(c.s) && /parallel/.test(c.s)) return need(c, P, 'Mixed series/parallel: give one group at a time');
    const tot = ser ? 1 / caps.reduce((s, x) => s + 1 / x.v, 0) : caps.reduce((s, x) => s + x.v, 0);
    return res(c, { kind: P, expression: `${caps.length} capacitors in ${ser ? 'series' : 'parallel'}`, value: tot * 1e6, unit: 'µF', unitWords: 'microfarads', formula: ser ? '1/C = Σ 1/Cᵢ' : 'C = Σ Cᵢ' });
  }
  if (/parallel.?plate|plate capacitor/.test(c.s)) {
    const A = ofDim(c, 'area')[0];
    const d = ofDim(c, 'length')[0];
    const kap = named(c, 'κ|kappa|dielectric constant|dielectric|k|relative permittivity|εr') ?? 1;
    if (!A || !d) return need(c, P, 'A parallel-plate capacitor needs the plate area and separation');
    const C = (kap * K.eps0 * A.v) / d.v;
    return res(c, { kind: P, expression: 'Parallel-plate capacitance', value: C * 1e12, unit: 'pF', unitWords: 'picofarads', formula: 'C = κε₀A/d', lines: [['In farads', withUnit(C, 'F')], ['κ', show(kap)]] });
  }
  if (/capacit/.test(c.s) && caps.length && !/time constant|\brc\b|charging|discharg|after|resonan|reactance|impedance/.test(c.s)) {
    const C = caps[0]!.v;
    const V = ofDim(c, 'voltage')[0];
    const Q = charges(c)[0];
    if (/energy|stored/.test(c.s)) {
      if (V) return res(c, { kind: P, expression: 'Energy stored in a capacitor', value: 0.5 * C * V.v ** 2, unit: 'J', unitWords: 'joules', formula: 'U = ½CV²' });
      if (Q) return res(c, { kind: P, expression: 'Energy stored in a capacitor', value: (Q.v ** 2) / (2 * C), unit: 'J', unitWords: 'joules', formula: 'U = Q²/2C' });
      return need(c, P, 'Stored energy needs the voltage (or charge)');
    }
    if (V) return res(c, { kind: P, expression: 'Charge on a capacitor', value: C * V.v * 1e6, unit: 'µC', unitWords: 'microcoulombs', formula: 'Q = CV', lines: [['Energy stored', withUnit(0.5 * C * V.v ** 2, 'J')]] });
    if (Q) return res(c, { kind: P, expression: 'Capacitor voltage', value: Q.v / C, unit: 'V', unitWords: 'volts', formula: 'V = Q/C' });
    return null;
  }
  const R = ofDim(c, 'resistance')[0];
  const Lq = ofDim(c, 'inductance')[0];
  if (/time constant|\brc\b|\brl\b|charging|discharg/.test(c.s) && R && (caps.length || Lq)) {
    if (Lq && !caps.length) {
      const tau = Lq.v / R.v;
      return res(c, { kind: P, expression: 'RL time constant', value: tau, unit: 's', unitWords: 'seconds', formula: 'τ = L/R', lines: [['To ~99% (5τ)', withUnit(5 * tau, 's')]] });
    }
    const tau = R.v * caps[0]!.v;
    const t = ofDim(c, 'time')[0];
    const V = ofDim(c, 'voltage')[0];
    if (t && V) {
      const dis = /discharg/.test(c.s);
      const x = dis ? V.v * Math.exp(-t.v / tau) : V.v * (1 - Math.exp(-t.v / tau));
      return res(c, { kind: P, expression: `Capacitor voltage ${dis ? 'discharging' : 'charging'} after ${withUnit(t.v, 's')}`, value: x, unit: 'V', unitWords: 'volts', formula: dis ? 'V(t) = V₀e^(−t/RC)' : 'V(t) = V₀(1 − e^(−t/RC))', lines: [['τ = RC', withUnit(tau, 's')], ['t/τ', show(t.v / tau)]] });
    }
    return res(c, { kind: P, expression: 'RC time constant', value: tau, unit: 's', unitWords: 'seconds', formula: 'τ = RC', lines: [['63% charged at', withUnit(tau, 's')], ['~99% charged at (5τ)', withUnit(5 * tau, 's')]] });
  }
  if (/resonan|\blc\b|tank circuit/.test(c.s) && Lq && caps.length) {
    const f = 1 / (2 * Math.PI * Math.sqrt(Lq.v * caps[0]!.v));
    return res(c, { kind: P, expression: 'LC resonant frequency', value: f, unit: 'Hz', unitWords: 'hertz', formula: 'f₀ = 1/(2π√(LC))', lines: [['ω₀', withUnit(2 * Math.PI * f, 'rad/s')]] });
  }
  if (/inductor/.test(c.s) && /series|parallel/.test(c.s) && ofDim(c, 'inductance').length >= 2) {
    const ls = ofDim(c, 'inductance');
    const ser = /series/.test(c.s);
    const tot = ser ? ls.reduce((s, x) => s + x.v, 0) : 1 / ls.reduce((s, x) => s + 1 / x.v, 0);
    return res(c, { kind: P, expression: `${ls.length} inductors in ${ser ? 'series' : 'parallel'}`, value: tot * 1000, unit: 'mH', unitWords: 'millihenries', formula: ser ? 'L = Σ Lᵢ' : '1/L = Σ 1/Lᵢ', notes: ['No mutual inductance'] });
  }
  if (/energy (?:stored )?in (?:an |the )?inductor|inductor energy/.test(c.s) && Lq) {
    const I = ofDim(c, 'current')[0];
    if (!I) return need(c, P, 'What current?');
    return res(c, { kind: P, expression: 'Energy stored in an inductor', value: 0.5 * Lq.v * I.v ** 2, unit: 'J', unitWords: 'joules', formula: 'U = ½LI²' });
  }
  const B = ofDim(c, 'field')[0];
  if (/lorentz|magnetic force|force on (?:a |an |the )?(?:charge|electron|proton|particle|wire|conductor)|radius of (?:the )?(?:path|orbit|circle)|cyclotron/.test(c.s) || (B && charges(c).length && ofDim(c, 'velocity').length)) {
    if (!B) return need(c, P, 'What is the magnetic field B (tesla)?');
    const ang = ofDim(c, 'angle')[0];
    const s = ang ? Math.sin(deg(ang.v)) : 1;
    const I = ofDim(c, 'current')[0];
    const L = ofDim(c, 'length')[0];
    if (I && L && /wire|conductor|rod/.test(c.s)) return res(c, { kind: P, expression: 'Force on a current-carrying wire', value: B.v * I.v * L.v * s, unit: 'N', unitWords: 'newtons', formula: ang ? 'F = BIL sin θ' : 'F = BIL (wire ⟂ field)' });
    let q = charges(c)[0]?.v;
    let m: number | undefined = ofDim(c, 'mass')[0]?.v;
    if (q === undefined && /electron|proton/.test(c.s)) q = K.e;
    if (m === undefined) m = /electron/.test(c.s) ? K.me : /proton/.test(c.s) ? K.mp : undefined;
    const v = ofDim(c, 'velocity')[0];
    if (q === undefined || !v) return need(c, P, 'The magnetic force needs the charge (or "electron"/"proton") and its speed');
    if (/radius|cyclotron|circle|path/.test(c.s)) {
      if (m === undefined) return need(c, P, 'What is the particle mass?');
      return res(c, { kind: P, expression: 'Radius of a charged particle in a magnetic field', value: (m * v.v) / (Math.abs(q) * B.v), unit: 'm', unitWords: 'metres', formula: 'r = mv/(|q|B)', lines: [['Cyclotron frequency', withUnit((Math.abs(q) * B.v) / (2 * Math.PI * m), 'Hz')]] });
    }
    return res(c, { kind: P, expression: 'Magnetic (Lorentz) force on a moving charge', value: Math.abs(q) * v.v * B.v * s, unit: 'N', unitWords: 'newtons', formula: ang ? 'F = |q|vB sin θ' : 'F = |q|vB (velocity ⟂ field)' });
  }
  if (/magnetic field/.test(c.s) && ofDim(c, 'current').length) {
    const I = ofDim(c, 'current')[0]!;
    if (/solenoid|coil/.test(c.s)) {
      const turnsPer = /(\d[\d,.]*)\s*turns?\s*(?:\/|per)\s*(m|meter|metre|cm)\b/.exec(c.s);
      const N = /(\d[\d,.]*)\s*turns?\b/.exec(c.s);
      const L = ofDim(c, 'length')[0];
      let n: number;
      if (turnsPer) n = num(turnsPer[1]!) * (turnsPer[2] === 'cm' ? 100 : 1);
      else if (N && L) n = num(N[1]!) / L.v;
      else return need(c, P, 'A solenoid needs turns per metre (or total turns and length)');
      return res(c, { kind: P, expression: 'Magnetic field inside a long solenoid', value: K.mu0 * n * I.v, unit: 'T', unitWords: 'tesla', formula: 'B = μ₀nI', lines: [['n', `${show(n)} turns/m`], ['In mT', show(K.mu0 * n * I.v * 1000) + ' mT']] });
    }
    const r = ofDim(c, 'length')[0];
    if (!r) return need(c, P, 'At what distance from the wire?');
    if (/loop|centre of|center of/.test(c.s)) return res(c, { kind: P, expression: 'Field at the centre of a circular loop', value: (K.mu0 * I.v) / (2 * r.v), unit: 'T', unitWords: 'tesla', formula: 'B = μ₀I/(2R)' });
    return res(c, { kind: P, expression: 'Magnetic field of a long straight wire', value: (K.mu0 * I.v) / (2 * Math.PI * r.v), unit: 'T', unitWords: 'tesla', formula: 'B = μ₀I/(2πr)', lines: [['In µT', show(((K.mu0 * I.v) / (2 * Math.PI * r.v)) * 1e6) + ' µT']] });
  }
  if (/induced emf|faraday'?s law|\bemf\b|induction/.test(c.s)) {
    const N = named(c, 'turns|n') ?? (/(\d+)\s*turns?/.exec(c.s) ? num(/(\d+)\s*turns?/.exec(c.s)![1]!) : 1);
    const fl = ofDim(c, 'flux')[0];
    const t = ofDim(c, 'time')[0];
    if (fl && t) return res(c, { kind: P, expression: "Induced EMF (Faraday's law)", value: (N * fl.v) / t.v, unit: 'V', unitWords: 'volts', formula: 'ε = N ΔΦ/Δt', lines: [['Turns', show(N)]] });
    const v = ofDim(c, 'velocity')[0];
    const L = ofDim(c, 'length')[0];
    if (B && v && L) return res(c, { kind: P, expression: 'Motional EMF', value: B.v * L.v * v.v, unit: 'V', unitWords: 'volts', formula: 'ε = BLv' });
    return need(c, P, 'Induced EMF needs the flux change and time (or B, length and speed for a moving rod)');
  }
  if (/transformer/.test(c.s)) {
    const np = named(c, 'primary|np|n_p|n1') ?? (/(\d+)\s*turns? (?:on the )?primary/.exec(c.s) ? num(/(\d+)\s*turns? (?:on the )?primary/.exec(c.s)![1]!) : null);
    const ns = named(c, 'secondary|ns|n_s|n2') ?? (/(\d+)\s*turns? (?:on the )?secondary/.exec(c.s) ? num(/(\d+)\s*turns? (?:on the )?secondary/.exec(c.s)![1]!) : null);
    const V = ofDim(c, 'voltage')[0];
    if (np === null || ns === null || !V) return need(c, P, 'A transformer needs primary turns, secondary turns and the primary voltage');
    return res(c, { kind: P, expression: 'Ideal transformer: secondary voltage', value: (V.v * ns) / np, unit: 'V', unitWords: 'volts', formula: 'V_s/V_p = N_s/N_p', lines: [['Turns ratio', `${show(np)}:${show(ns)}`], ['Type', ns > np ? 'step-up' : 'step-down']] });
  }
  return null;
};

// ─────────────── relativity ───────────────
function beta(c: Ctx): number | null {
  const m = new RegExp(String.raw`(${NUM})\s*(%\s*(?:of\s+)?(?:the\s+)?(?:speed of light|c\b)|c\b|\s*times the speed of light)`).exec(c.s);
  if (m) return m[2]!.startsWith('%') ? num(m[1]!) / 100 : num(m[1]!);
  const v = ofDim(c, 'velocity')[0];
  return v ? v.v / K.c : null;
}
const relativity: Handler = (c) => {
  if (/e\s*=\s*mc|mass.?energy|rest (?:mass )?energy|energy equivalent/.test(c.s)) {
    let m = ofDim(c, 'mass')[0]?.v;
    let what = m !== undefined ? withUnit(m, 'kg') : '';
    if (m === undefined && /electron/.test(c.s)) [m, what] = [K.me, 'an electron'];
    if (m === undefined && /proton/.test(c.s)) [m, what] = [K.mp, 'a proton'];
    if (m === undefined && /neutron/.test(c.s)) [m, what] = [K.mn, 'a neutron'];
    if (m === undefined) return need(c, P, 'E = mc² needs a mass');
    const E = m * K.c ** 2;
    return res(c, { kind: P, expression: `Rest energy of ${what}`, value: E, unit: 'J', unitWords: 'joules', formula: 'E = mc²', lines: [['In MeV', show(E / K.e / 1e6) + ' MeV'], ['In kWh', show(E / 3.6e6) + ' kWh'], ['TNT equivalent', show(E / 4.184e12) + ' kt']] });
  }
  if (/velocity addition|add(?:ing)? velocities|relativistic(?:ally)? add/.test(c.s)) {
    const bs = [...c.s.matchAll(new RegExp(String.raw`(${NUM})\s*c\b`, 'g'))].map((m) => num(m[1]!));
    if (bs.length < 2) return need(c, P, 'Give both speeds as fractions of c, e.g. "0.6c and 0.7c"');
    const u = (bs[0]! + bs[1]!) / (1 + bs[0]! * bs[1]!);
    return res(c, { kind: P, expression: 'Relativistic velocity addition', value: u, display: `${show(u)}c`, formula: 'u = (v + w)/(1 + vw/c²)', lines: [['In m/s', withUnit(u * K.c, 'm/s')]] });
  }
  if (!/time dilation|length contraction|lorentz factor|\bgamma\b|γ|relativistic|contract|dilat|proper time|proper length|moving clock/.test(c.s)) return null;
  const b = beta(c);
  if (b === null) return need(c, P, 'What speed (e.g. 0.8c)?');
  if (b >= 1) return fail(c, P, 'Speed must be less than the speed of light');
  const g = 1 / Math.sqrt(1 - b * b);
  const lines: [string, string][] = [['β = v/c', show(b)], ['γ', show(g, 6)]];
  if (/length|contract/.test(c.s)) {
    const L = ofDim(c, 'length')[0];
    if (!L) return need(c, P, 'What is the proper (rest) length?');
    return res(c, { kind: P, expression: `Length contraction at ${show(b)}c`, value: L.v / g, unit: 'm', unitWords: 'metres', formula: 'L = L₀/γ = L₀√(1 − v²/c²)', lines });
  }
  if (/kinetic/.test(c.s)) {
    const m = ofDim(c, 'mass')[0]?.v ?? (/electron/.test(c.s) ? K.me : /proton/.test(c.s) ? K.mp : undefined);
    if (m === undefined) return need(c, P, 'What mass?');
    const KE = (g - 1) * m * K.c ** 2;
    return res(c, { kind: P, expression: 'Relativistic kinetic energy', value: KE, unit: 'J', unitWords: 'joules', formula: 'KE = (γ − 1)mc²', lines: [...lines, ['In MeV', show(KE / K.e / 1e6) + ' MeV']] });
  }
  if (/momentum/.test(c.s)) {
    const m = ofDim(c, 'mass')[0]?.v ?? (/electron/.test(c.s) ? K.me : /proton/.test(c.s) ? K.mp : undefined);
    if (m === undefined) return need(c, P, 'What mass?');
    return res(c, { kind: P, expression: 'Relativistic momentum', value: g * m * b * K.c, unit: 'kg·m/s', formula: 'p = γmv', lines });
  }
  const t = ofDim(c, 'time')[0];
  if (t && /time|dilat|clock|ages?|years|seconds|hours/.test(c.s)) {
    const sec = t.v;
    const unitName = t.unit;
    const scale = sec / num(t.raw.replace(/[^\d.e+-]/g, ''));
    return res(c, { kind: P, expression: `Time dilation at ${show(b)}c: ${t.raw} of proper time`, value: (sec * g) / scale, unit: unitName, formula: 'Δt = γΔt₀', lines, notes: ['Δt₀ is the proper time (measured by the moving clock); Δt is measured in the frame where the clock moves'] });
  }
  return res(c, { kind: P, expression: `Lorentz factor at ${show(b)}c`, value: g, sig: 6, formula: 'γ = 1/√(1 − v²/c²)', lines });
};

// ─────────────── quantum ───────────────
function particleMass(c: Ctx): [number, string] | null {
  if (/electron/.test(c.s)) return [K.me, 'electron'];
  if (/proton/.test(c.s)) return [K.mp, 'proton'];
  if (/neutron/.test(c.s)) return [K.mn, 'neutron'];
  const m = ofDim(c, 'mass')[0];
  return m ? [m.v, withUnit(m.v, 'kg')] : null;
}
const quantum: Handler = (c) => {
  if (/photoelectric|work function|threshold (?:frequency|wavelength)|stopping (?:potential|voltage)/.test(c.s)) {
    const phi = lab(c, 'energy', /work function|φ|phi/) ?? ofDim(c, 'energy')[0];
    if (!phi) return need(c, P, 'What is the work function (eV)?');
    const lam = ofDim(c, 'length')[0];
    const f = ofDim(c, 'frequency')[0];
    const lines: [string, string][] = [['Threshold wavelength', withUnit((K.h * K.c) / phi.v * 1e9, 'nm')], ['Threshold frequency', withUnit(phi.v / K.h, 'Hz')]];
    if (/threshold/.test(c.s) && !lam && !f) return res(c, { kind: P, expression: 'Photoelectric threshold', value: (K.h * K.c) / phi.v * 1e9, unit: 'nm', formula: 'λ₀ = hc/φ', lines });
    const E = lam ? (K.h * K.c) / lam.v : f ? K.h * f.v : null;
    if (E === null) return need(c, P, 'What is the light wavelength or frequency?');
    const KE = E - phi.v;
    if (KE <= 0) return res(c, { kind: P, expression: 'Photoelectric effect', display: 'No electrons emitted', formula: 'KE_max = hf − φ', lines: [['Photon energy', withUnit(E / K.e, 'eV')], ...lines], notes: ['Photon energy is below the work function'] });
    return res(c, { kind: P, expression: 'Photoelectric effect: maximum kinetic energy', value: KE / K.e, unit: 'eV', unitWords: 'electron volts', formula: 'KE_max = hf − φ', lines: [['Photon energy', withUnit(E / K.e, 'eV')], ['Stopping potential', withUnit(KE / K.e, 'V')], ...lines] });
  }
  if (/de ?broglie|matter wave/.test(c.s)) {
    const pm = particleMass(c);
    if (!pm) return need(c, P, 'Which particle (electron/proton/neutron) or what mass?');
    const v = ofDim(c, 'velocity')[0];
    const V = ofDim(c, 'voltage')[0];
    const E = ofDim(c, 'energy')[0];
    let p: number;
    let how: string;
    if (v) [p, how] = [pm[0] * v.v, 'λ = h/(mv)'];
    else if (V) [p, how] = [Math.sqrt(2 * pm[0] * K.e * V.v), 'λ = h/√(2meV)'];
    else if (E) [p, how] = [Math.sqrt(2 * pm[0] * E.v), 'λ = h/√(2mE)'];
    else return need(c, P, 'What speed (or accelerating voltage / kinetic energy)?');
    const lam = K.h / p;
    return res(c, { kind: P, expression: `de Broglie wavelength of ${/^\d/.test(pm[1]) ? 'a ' + pm[1] + ' mass' : 'an ' + pm[1]}`, value: lam, unit: 'm', unitWords: 'metres', formula: how, lines: [['In nm', show(lam * 1e9) + ' nm'], ['Momentum', withUnit(p, 'kg·m/s')]], notes: v && v.v > 0.1 * K.c ? ['Speed above 0.1c: the non-relativistic formula is inaccurate'] : [] });
  }
  if (/particle in a box|infinite (?:square )?well|box of (?:width|length)/.test(c.s)) {
    const pm = particleMass(c) ?? [K.me, 'electron'];
    const L = ofDim(c, 'length')[0];
    if (!L) return need(c, P, 'What is the box width L?');
    const n = named(c, 'n|level|state') ?? 1;
    const E = (n * n * K.h * K.h) / (8 * pm[0] * L.v ** 2);
    return res(c, { kind: P, expression: `Particle in a box, n = ${n}`, value: E / K.e, unit: 'eV', unitWords: 'electron volts', formula: 'E_n = n²h²/(8mL²)', lines: [['In joules', withUnit(E, 'J')], ['Particle', pm[1]]], notes: particleMass(c) ? [] : ['Electron assumed'] });
  }
  if (/uncertainty|heisenberg/.test(c.s)) {
    const dx = ofDim(c, 'length')[0];
    if (!dx) return need(c, P, 'What is the position uncertainty Δx?');
    const dp = K.hbar / (2 * dx.v);
    const pm = particleMass(c);
    const lines: [string, string][] = [];
    if (pm) lines.push(['Minimum Δv', withUnit(dp / pm[0], 'm/s')]);
    return res(c, { kind: P, expression: 'Minimum momentum uncertainty (Heisenberg)', value: dp, unit: 'kg·m/s', formula: 'Δx·Δp ≥ ħ/2', lines });
  }
  if (/hydrogen|bohr|energy level|\bn\s*=\s*\d+\s*(?:to|→|->)\s*(?:n\s*=\s*)?\d|balmer|lyman|paschen|rydberg/.test(c.s)) {
    const Z = named(c, 'z') ?? 1;
    const tr = /(?:from\s+)?n\s*=?\s*(\d+)\s*(?:to|→|->|-)\s*(?:n\s*=?\s*)?(\d+)|(\d+)\s*(?:to|→|->)\s*(\d+)/.exec(c.s);
    if (tr) {
      const ni = num(tr[1] ?? tr[3]!);
      const nf = num(tr[2] ?? tr[4]!);
      const dE = K.RydE * Z * Z * Math.abs(1 / (nf * nf) - 1 / (ni * ni));
      const lam = (K.h * K.c) / (dE * K.e);
      return res(c, { kind: P, expression: `Hydrogen${Z > 1 ? '-like (Z=' + Z + ')' : ''} transition n = ${ni} → ${nf}`, value: lam * 1e9, unit: 'nm', unitWords: 'nanometres', formula: '1/λ = RZ²|1/n_f² − 1/n_i²|', lines: [['Photon energy', withUnit(dE, 'eV')], ['Frequency', withUnit((dE * K.e) / K.h, 'Hz')], ['Process', ni > nf ? 'emission' : 'absorption']], notes: ['Bohr model with R∞ (infinite nuclear mass); the reduced-mass correction lengthens λ by about 0.05%'] });
    }
    const n = named(c, 'n|level') ?? null;
    if (n === null) return need(c, P, 'Which level n (or which transition, e.g. n=3 to n=2)?');
    return res(c, { kind: P, expression: `Bohr energy level n = ${n}${Z > 1 ? `, Z = ${Z}` : ''}`, value: (-K.RydE * Z * Z) / (n * n), unit: 'eV', unitWords: 'electron volts', formula: 'E_n = −13.6 eV · Z²/n²', lines: [['Orbit radius', withUnit((5.29177210903e-11 * n * n) / Z, 'm')]] });
  }
  if (/compton/.test(c.s)) {
    const a = ofDim(c, 'angle')[0];
    if (!a) return need(c, P, 'What scattering angle?');
    const d = (K.h / (K.me * K.c)) * (1 - Math.cos(deg(a.v)));
    return res(c, { kind: P, expression: `Compton shift at ${show(a.v)}°`, value: d * 1e12, unit: 'pm', unitWords: 'picometres', formula: 'Δλ = (h/mₑc)(1 − cos θ)' });
  }
  if (/photon|light|wavelength of|frequency of/.test(c.s) && /energy|wavelength|frequency|momentum/.test(c.s)) {
    const lam = ofDim(c, 'length')[0];
    const f = ofDim(c, 'frequency')[0];
    const E = ofDim(c, 'energy')[0];
    if (/momentum/.test(c.s) && lam) return res(c, { kind: P, expression: 'Photon momentum', value: K.h / lam.v, unit: 'kg·m/s', formula: 'p = h/λ' });
    if (E && /wavelength/.test(c.s)) {
      const l = (K.h * K.c) / E.v;
      return res(c, { kind: P, expression: `Wavelength of a ${E.raw} photon`, value: l * 1e9, unit: 'nm', unitWords: 'nanometres', formula: 'λ = hc/E', lines: [['Frequency', withUnit(E.v / K.h, 'Hz')]] });
    }
    if (E && /frequency/.test(c.s)) return res(c, { kind: P, expression: `Frequency of a ${E.raw} photon`, value: E.v / K.h, unit: 'Hz', unitWords: 'hertz', formula: 'f = E/h' });
    if ((lam || f) && /energy/.test(c.s)) {
      const e = lam ? (K.h * K.c) / lam.v : K.h * f!.v;
      return res(c, { kind: P, expression: `Photon energy${lam ? ` at λ = ${lam.raw}` : ` at f = ${f!.raw}`}`, value: e, unit: 'J', unitWords: 'joules', formula: lam ? 'E = hc/λ' : 'E = hf', lines: [['In eV', show(e / K.e) + ' eV'], [lam ? 'Frequency' : 'Wavelength', lam ? withUnit(K.c / lam.v, 'Hz') : withUnit((K.c / f!.v) * 1e9, 'nm')], ['Per mole of photons', withUnit((e * K.NA) / 1000, 'kJ/mol')]] });
    }
  }
  return null;
};

// ─────────────── nuclear ───────────────
const nuclear: Handler = (c) => {
  if (/binding energy|mass defect/.test(c.s)) {
    const dm = ofDim(c, 'mass')[0] ?? null;
    const A = named(c, 'a|nucleons|mass number');
    if (!dm) return need(c, P, 'What is the mass defect (in u or kg)?');
    const E = (dm.v / K.u) * K.uMeV;
    const lines: [string, string][] = [['In joules', withUnit(E * 1e6 * K.e, 'J')]];
    if (A) lines.push(['Per nucleon', withUnit(E / A, 'MeV')]);
    return res(c, { kind: P, expression: 'Nuclear binding energy from the mass defect', value: E, unit: 'MeV', unitWords: 'mega electron volts', formula: 'E = Δm c² (1 u = 931.494 MeV/c²)', lines });
  }
  const carbon = /carbon[- ]?dating|carbon[- ]?14|c-?14|radiocarbon/.test(c.s);
  if (!/half.?li[fv]e|decay|radioactiv|carbon[- ]?dating|carbon[- ]?14|c-?14|radiocarbon|disintegrat/.test(c.s)) return null;
  if (/first.?order|rate constant|\bk\s*=|\[a\]|zero.?order|second.?order|elimination|drug|dose|plasma|mg\/l/.test(c.s)) return null; // chemistry kinetics / pharmacology
  const times = ofDim(c, 'time');
  const hlQ = lab(c, 'time', /half.?li[fv]e|t½|t1\/2/) ?? (carbon ? undefined : times[0]);
  const hl = hlQ?.v ?? (carbon ? 5730 * 31557600 : undefined);
  const notes: string[] = carbon && !hlQ ? ['Carbon-14 half-life 5,730 years (Libby: 5,568)'] : [];
  const unitQ = hlQ ?? times.find((t) => t !== hlQ);
  const unitName = carbon && !hlQ ? 'years' : unitQ ? unitQ.unit : 's';
  const scale = carbon && !hlQ ? 31557600 : unitQ ? unitQ.v / num(unitQ.raw.replace(/[^\d.e+-]/g, '')) : 1;
  if (hl === undefined) return need(c, P, 'What is the half-life?');
  const lambda = Math.LN2 / hl;
  if (/decay constant|lambda|λ/.test(c.s) && !/after|remain|left|elapsed/.test(c.s)) {
    return res(c, { kind: P, expression: 'Decay constant from half-life', value: lambda * scale, unit: `per ${unitName.replace(/s$/, '')}`, formula: 'λ = ln 2 / t½', lines: [['Mean lifetime τ', `${show(1 / lambda / scale)} ${unitName}`]] });
  }
  const t = times.find((x) => x !== hlQ);
  const pctM = new RegExp(String.raw`(${NUM})\s*(%|percent)`).exec(c.s);
  const masses = ofDim(c, 'mass');
  if (t) {
    const f = Math.pow(0.5, t.v / hl);
    if (masses.length) {
      const m0 = masses[0]!;
      const mscale = m0.v / num(m0.raw.replace(/[^\d.e+-]/g, ''));
      return res(c, { kind: P, expression: `Amount remaining after ${t.raw}`, value: (m0.v * f) / mscale, unit: m0.unit, formula: 'N = N₀(½)^(t/t½)', lines: [['Fraction remaining', show(f)], ['Half-lives elapsed', show(t.v / hl)]], notes });
    }
    return res(c, { kind: P, expression: `Fraction remaining after ${t.raw}`, value: f, display: `${show(f)} (${show(f * 100)}%)`, formula: 'N/N₀ = (½)^(t/t½)', lines: [['Half-lives elapsed', show(t.v / hl)], ['Decayed', show((1 - f) * 100) + '%']], notes });
  }
  if (pctM || masses.length >= 2) {
    const f = pctM ? num(pctM[1]!) / 100 : masses[1]!.v / masses[0]!.v;
    if (!(f > 0 && f < 1)) return fail(c, P, 'The remaining fraction must be between 0 and 1');
    const age = (hl * Math.log(1 / f)) / Math.LN2;
    return res(c, { kind: P, expression: carbon ? `Radiocarbon age with ${show(f * 100)}% C-14 remaining` : `Time to decay to ${show(f * 100)}%`, value: age / scale, unit: unitName, formula: 't = t½ · log₂(N₀/N)', lines: [['Half-lives', show(age / hl)]], notes });
  }
  return need(c, P, 'How much time has passed (or what fraction remains)?');
};

// ─────────────── astronomy ───────────────
const astronomy: Handler = (c) => {
  if (/parallax/.test(c.s)) {
    const m = new RegExp(String.raw`(${NUM})\s*(arc ?sec(?:onds?)?|arcsec|"|mas|milli-?arcsec)`).exec(c.s);
    if (!m) return need(c, P, 'What parallax angle (arcseconds)?');
    const p = num(m[1]!) / (/mas|milli/.test(m[2]!) ? 1000 : 1);
    return res(c, { kind: P, expression: 'Distance from parallax', value: 1 / p, unit: 'pc', unitWords: 'parsecs', formula: 'd (pc) = 1 / p (arcsec)', lines: [['In light years', show(3.26156 / p) + ' ly']] });
  }
  if (/distance modulus|absolute magnitude|apparent magnitude/.test(c.s) && /distance|how far/.test(c.s)) {
    const mm = named(c, 'apparent magnitude|apparent|m');
    const MM = named(c, 'absolute magnitude|absolute|M');
    if (mm === null || MM === null) return need(c, P, 'Distance modulus needs the apparent (m) and absolute (M) magnitudes');
    return res(c, { kind: P, expression: 'Distance from the distance modulus', value: 10 ** ((mm - MM + 5) / 5), unit: 'pc', unitWords: 'parsecs', formula: 'd = 10^((m − M + 5)/5) pc', notes: ['Ignores extinction'] });
  }
  if (/magnitude/.test(c.s) && /brighter|brightness ratio|ratio|differ/.test(c.s)) {
    const d = named(c, 'difference|differ by|magnitudes?|Δm') ?? (/(\d+(?:\.\d+)?)\s*magnitudes?/.exec(c.s) ? num(/(\d+(?:\.\d+)?)\s*magnitudes?/.exec(c.s)![1]!) : null);
    if (d === null) return need(c, P, 'What magnitude difference?');
    return res(c, { kind: P, expression: `Brightness ratio for ${show(d)} magnitudes`, value: 100 ** (d / 5), formula: 'ratio = 100^(Δm/5) ≈ 2.512^Δm' });
  }
  if (/hubble|recession/.test(c.s)) {
    const d = ofDim(c, 'length')[0];
    const H0 = named(c, 'h0|h₀|hubble constant') ?? 70;
    if (!d) return need(c, P, 'What distance (e.g. 100 Mpc)?');
    const mpc = d.v / 3.0856775814913673e22;
    return res(c, { kind: P, expression: "Recession speed (Hubble's law)", value: H0 * mpc, unit: 'km/s', formula: 'v = H₀d', lines: [['H₀', `${show(H0)} km/s/Mpc`], ['z (v/c, small z)', show((H0 * mpc * 1000) / K.c)]], notes: named(c, 'h0|h₀|hubble constant') === null ? ['H₀ = 70 km/s/Mpc assumed'] : [] });
  }
  if (/luminosity/.test(c.s) && /star|sun|radius/.test(c.s)) {
    const R = ofDim(c, 'length')[0]?.v ?? (/sun/.test(c.s) ? BODIES.sun![1] : undefined);
    const T = /(\d[\d,.]*)\s*k\b/.exec(c.s);
    if (R === undefined || !T) return need(c, P, 'Stellar luminosity needs the radius and surface temperature (K)');
    const L = 4 * Math.PI * R * R * K.sigma * num(T[1]!) ** 4;
    return res(c, { kind: P, expression: 'Stellar luminosity (Stefan–Boltzmann)', value: L, unit: 'W', unitWords: 'watts', formula: 'L = 4πR²σT⁴', lines: [['In solar luminosities', show(L / 3.828e26) + ' L☉']] });
  }
  if (/light (?:take|travel)|light.?travel time|how long (?:does|for) light/.test(c.s)) {
    let d = ofDim(c, 'length')[0]?.v;
    if (d === undefined && /sun/.test(c.s)) d = 1.495978707e11;
    if (d === undefined && /moon/.test(c.s)) d = 3.844e8;
    if (d === undefined) return need(c, P, 'What distance?');
    const t = d / K.c;
    return res(c, { kind: P, expression: 'Light travel time', value: t, unit: 's', unitWords: 'seconds', formula: 't = d/c', lines: [['', duration(t)]] });
  }
  return null;
};

export const physicsB: Handler[] = [relativity, quantum, nuclear, electro, astronomy];
