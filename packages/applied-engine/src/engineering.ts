import { K, NUM, SNUM, deg, fail, lab, named, need, num, numbers, ofDim, pct, res, show, temperatures, todeg, withUnit, type Ctx, type Handler } from './util';

const E = 'engineering' as const;

// ─────────────── resistor networks ───────────────
/** Resistances: "4, 6 and 12 ohm" (unit applies to the list), "1k", "4.7kΩ", "220 Ω". */
function resistances(c: Ctx): number[] {
  const out: number[] = [];
  const re = new RegExp(String.raw`(${NUM})\s*(k|M|m)?\s*(Ω|Ω|ohms?|kohms?|kiloohms?|kilohms?|megohms?)?(?![A-Za-z0-9])`, 'g');
  const unitRe = /(?:ohms?|Ω|Ω|kilo?hms?|kohms?|megohms?|\d\s*k\b)/i;
  if (!unitRe.test(c.t) && !/resist/.test(c.s)) return out;
  const pending: number[] = [];
  for (const m of c.t.matchAll(re)) {
    const pre = m[2];
    const u = m[3]?.toLowerCase();
    let mult = pre === 'k' ? 1e3 : pre === 'M' ? 1e6 : pre === 'm' ? 1e-3 : 1;
    if (u && /^k/.test(u)) mult = 1e3;
    if (u && /^meg/.test(u)) mult = 1e6;
    const after = c.t.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    if (/^\s*(?:V|A|W|Hz|s\b|mA|µ|uF|F|H)/.test(after) && !u && !pre) continue;
    const x = num(m[1]!) * mult;
    if (u || pre) {
      for (const p of pending) out.push(p * mult);
      pending.length = 0;
      out.push(x);
    } else pending.push(num(m[1]!));
  }
  out.push(...pending);
  return out;
}
const resistors: Handler = (c) => {
  if (!/resist|ohm|Ω|Ω/.test(c.s) || !/series|parallel|equivalent|combined|total resistance|\|\|/.test(c.s)) return null;
  if (/capacit|inductor|µf|uf\b/.test(c.s)) return null;
  const rs = resistances(c);
  if (rs.length < 2) return need(c, E, 'Give at least two resistances, e.g. "4, 6 and 12 ohm in parallel"');
  const par = /parallel|\|\|/.test(c.s);
  const ser = /series/.test(c.s);
  if (par && ser) return need(c, E, 'Mixed networks: give one series or parallel group at a time (e.g. "6 and 3 ohm in parallel", then add the series part)');
  const tot = par ? 1 / rs.reduce((s, r) => s + 1 / r, 0) : rs.reduce((s, r) => s + r, 0);
  const V = ofDim(c, 'voltage')[0];
  const lines: [string, string][] = [['Resistors', rs.map((r) => withUnit(r, 'Ω')).join(', ')]];
  const table = V
    ? { columns: ['R', 'Voltage', 'Current', 'Power'], rows: rs.map((r) => (par ? [withUnit(r, 'Ω'), withUnit(V.v, 'V'), withUnit(V.v / r, 'A'), withUnit((V.v * V.v) / r, 'W')] : [withUnit(r, 'Ω'), withUnit((V.v * r) / tot, 'V'), withUnit(V.v / tot, 'A'), withUnit((V.v / tot) ** 2 * r, 'W')])) }
    : undefined;
  if (V) lines.push(['Total current', withUnit(V.v / tot, 'A')], ['Total power', withUnit((V.v * V.v) / tot, 'W')]);
  return res(c, { kind: E, expression: `${rs.length} resistors in ${par ? 'parallel' : 'series'}`, value: tot, unit: 'Ω', unitWords: 'ohms', formula: par ? '1/R = Σ 1/Rᵢ' : 'R = Σ Rᵢ', lines, table });
};
const divider: Handler = (c) => {
  if (!/voltage divider|potential divider/.test(c.s)) return null;
  const V = ofDim(c, 'voltage')[0];
  const r1 = named(c, 'r1|r₁');
  const r2 = named(c, 'r2|r₂');
  const rs = resistances(c);
  const [a, b] = r1 !== null && r2 !== null ? [r1, r2] : rs.length >= 2 ? [rs[0]!, rs[1]!] : [null, null];
  if (!V || a === null || b === null) return need(c, E, 'A divider needs the input voltage, R1 (top) and R2 (bottom)');
  const k = (s: string, x: number) => (new RegExp(String.raw`${s}\s*(?:=|:)?\s*${NUM}\s*k`, 'i').test(c.t) ? x * 1000 : x);
  const A = r1 !== null ? k('r1', a) : a;
  const B = r2 !== null ? k('r2', b) : b;
  return res(c, { kind: E, expression: 'Voltage divider output (across R2)', value: (V.v * B) / (A + B), unit: 'V', unitWords: 'volts', formula: 'V_out = V_in · R2/(R1 + R2)', lines: [['R1', withUnit(A, 'Ω')], ['R2', withUnit(B, 'Ω')], ['Divider current', withUnit(V.v / (A + B), 'A')]], notes: ['Unloaded output'] });
};

// ─────────────── AC: reactance, impedance, power ───────────────
const ac: Handler = (c) => {
  const f = ofDim(c, 'frequency')[0];
  const Rr = ofDim(c, 'resistance')[0];
  const L = ofDim(c, 'inductance')[0];
  const Cc = ofDim(c, 'capacitance')[0];
  if (/reactance/.test(c.s) && f && (L || Cc) && !(L && Cc)) {
    if (L) return res(c, { kind: E, expression: 'Inductive reactance', value: 2 * Math.PI * f.v * L.v, unit: 'Ω', unitWords: 'ohms', formula: 'X_L = 2πfL' });
    return res(c, { kind: E, expression: 'Capacitive reactance', value: 1 / (2 * Math.PI * f.v * Cc!.v), unit: 'Ω', unitWords: 'ohms', formula: 'X_C = 1/(2πfC)' });
  }
  if (/impedance|rlc|phase angle/.test(c.s) && f && (Rr || L || Cc)) {
    const w = 2 * Math.PI * f.v;
    const XL = L ? w * L.v : 0;
    const XC = Cc ? 1 / (w * Cc.v) : 0;
    const R = Rr?.v ?? 0;
    if (/parallel/.test(c.s)) return need(c, E, 'Parallel RLC impedance isn’t supported yet; series RLC is');
    const X = XL - XC;
    const Z = Math.hypot(R, X);
    const ph = todeg(Math.atan2(X, R));
    const lines: [string, string][] = [['X_L', withUnit(XL, 'Ω')], ['X_C', withUnit(XC, 'Ω')], ['Net reactance', withUnit(X, 'Ω')], ['Phase angle', `${show(ph)}° (${X > 0 ? 'inductive, current lags' : X < 0 ? 'capacitive, current leads' : 'resistive'})`], ['Power factor', show(Z ? R / Z : 1)]];
    if (L && Cc) lines.push(['Resonant frequency', withUnit(1 / (2 * Math.PI * Math.sqrt(L.v * Cc.v)), 'Hz')]);
    const V = ofDim(c, 'voltage')[0];
    if (V) lines.push(['Current', withUnit(V.v / Z, 'A')]);
    return res(c, { kind: E, expression: 'Series RLC impedance', value: Z, unit: 'Ω', unitWords: 'ohms', formula: 'Z = √(R² + (X_L − X_C)²)', lines });
  }
  if (/three.?phase|3.?phase/.test(c.s)) {
    const V = ofDim(c, 'voltage')[0];
    const I = ofDim(c, 'current')[0];
    const pf = named(c, 'pf|power factor|cos ?φ|cos ?phi') ?? null;
    const Pw = ofDim(c, 'power')[0];
    if (V && I) {
      const S = Math.sqrt(3) * V.v * I.v;
      const p = pf ?? 1;
      return res(c, { kind: E, expression: 'Three-phase real power', value: S * p, unit: 'W', unitWords: 'watts', formula: 'P = √3 · V_L · I_L · pf', lines: [['Apparent power', withUnit(S, 'VA')], ['Reactive power', withUnit(S * Math.sqrt(1 - p * p), 'var')], ['Power factor', show(p)]], notes: [`Line-to-line voltage and line current${pf === null ? '; pf = 1 assumed' : ''}`] });
    }
    if (Pw && V) {
      const p = pf ?? 1;
      return res(c, { kind: E, expression: 'Three-phase line current', value: Pw.v / (Math.sqrt(3) * V.v * p), unit: 'A', unitWords: 'amps', formula: 'I = P/(√3 · V_L · pf)', notes: pf === null ? ['pf = 1 assumed'] : [] });
    }
    return need(c, E, 'Three-phase power needs line voltage and current (and the power factor)');
  }
  if (/power factor|apparent power|reactive power|\bkva\b|\bvar\b/.test(c.s)) {
    const P = ofDim(c, 'power')[0];
    const S = ofDim(c, 'apparent')[0];
    const Q = ofDim(c, 'reactive')[0];
    const pf = named(c, 'pf|power factor');
    if (P && S) return res(c, { kind: E, expression: 'Power factor', value: P.v / S.v, formula: 'pf = P/S', lines: [['Reactive power', withUnit(Math.sqrt(S.v ** 2 - P.v ** 2), 'var')], ['Phase angle', `${show(todeg(Math.acos(P.v / S.v)))}°`]] });
    if (P && Q) {
      const s = Math.hypot(P.v, Q.v);
      return res(c, { kind: E, expression: 'Power factor from P and Q', value: P.v / s, formula: 'pf = P/√(P² + Q²)', lines: [['Apparent power', withUnit(s, 'VA')]] });
    }
    if (pf !== null && S) return res(c, { kind: E, expression: 'Real and reactive power', value: S.v * pf, unit: 'W', formula: 'P = S·pf, Q = S·sin φ', lines: [['Reactive power', withUnit(S.v * Math.sqrt(1 - pf * pf), 'var')]] });
    if (pf !== null && P) return res(c, { kind: E, expression: 'Apparent power', value: P.v / pf, unit: 'VA', formula: 'S = P/pf', lines: [['Reactive power', withUnit((P.v / pf) * Math.sqrt(1 - pf * pf), 'var')]] });
    const V = ofDim(c, 'voltage')[0];
    const I = ofDim(c, 'current')[0];
    if (P && V && I) return res(c, { kind: E, expression: 'Power factor (single-phase)', value: P.v / (V.v * I.v), formula: 'pf = P/(V·I)' });
    return null;
  }
  return null;
};

// ─────────────── signals: dB ───────────────
const decibels: Handler = (c) => {
  if (/\bsound|intensity level|w\/m/.test(c.s)) return null;
  if (/\bdbm\b/.test(c.s)) {
    const p = ofDim(c, 'power')[0];
    const d = new RegExp(String.raw`(${SNUM})\s*dbm\b`).exec(c.s);
    if (d && !p) {
      const mw = 10 ** (num(d[1]!) / 10);
      return res(c, { kind: E, expression: `${d[1]} dBm in watts`, value: mw / 1000, unit: 'W', unitWords: 'watts', formula: 'P(mW) = 10^(dBm/10)', lines: [['In mW', show(mw) + ' mW']] });
    }
    if (p) return res(c, { kind: E, expression: `${p.raw} in dBm`, value: 10 * Math.log10(p.v / 1e-3), unit: 'dBm', formula: 'dBm = 10 log₁₀(P / 1 mW)' });
    return null;
  }
  if (/\bsnr\b|signal.to.noise/.test(c.s)) {
    const ps = ofDim(c, 'power');
    const vs = ofDim(c, 'voltage');
    if (ps.length >= 2) return res(c, { kind: E, expression: 'Signal-to-noise ratio', value: 10 * Math.log10(ps[0]!.v / ps[1]!.v), unit: 'dB', formula: 'SNR = 10 log₁₀(P_signal/P_noise)', lines: [['Linear ratio', show(ps[0]!.v / ps[1]!.v)]] });
    if (vs.length >= 2) return res(c, { kind: E, expression: 'Signal-to-noise ratio (amplitudes)', value: 20 * Math.log10(vs[0]!.v / vs[1]!.v), unit: 'dB', formula: 'SNR = 20 log₁₀(V_signal/V_noise)' });
    const r = named(c, 'ratio|snr');
    if (r !== null) return res(c, { kind: E, expression: 'SNR in dB', value: 10 * Math.log10(r), unit: 'dB', formula: 'SNR = 10 log₁₀(ratio)' });
    return need(c, E, 'SNR needs the signal and noise powers (or amplitudes)');
  }
  if (!/\bdb\b|decibel/.test(c.s)) return null;
  const toRatio = new RegExp(String.raw`(${SNUM})\s*(?:db|decibels?)\b.*(?:to|as|in)\s*(?:a\s+)?(power|voltage|amplitude|current)?\s*(?:ratio|gain|linear|times|factor)`).exec(c.s);
  if (toRatio || new RegExp(String.raw`^(?:what is\s+)?(${SNUM})\s*(?:db|decibels?)\s*(power|voltage|amplitude)?\s*(?:ratio|gain)?$`).test(c.s)) {
    const m = toRatio ?? new RegExp(String.raw`(${SNUM})\s*(?:db|decibels?)`).exec(c.s)!;
    const x = num(m[1]!);
    const amp = /voltage|amplitude|current/.test(c.s);
    return res(c, { kind: E, expression: `${show(x)} dB as a ${amp ? 'voltage' : 'power'} ratio`, value: amp ? 10 ** (x / 20) : 10 ** (x / 10), formula: amp ? 'ratio = 10^(dB/20)' : 'ratio = 10^(dB/10)', lines: [[amp ? 'Power ratio' : 'Voltage ratio', show(amp ? 10 ** (x / 10) : 10 ** (x / 20))]] });
  }
  const amp = /voltage|amplitude|current|gain of \d+ ?v/.test(c.s);
  const r = named(c, 'ratio|gain|factor(?: of)?') ?? (/(?:of|is)\s*(\d[\d.e+-]*)\s*(?:in|to)\s*(?:db|decibels)/.exec(c.s) ? num(/(?:of|is)\s*(\d[\d.e+-]*)\s*(?:in|to)\s*(?:db|decibels)/.exec(c.s)![1]!) : null);
  if (r !== null) return res(c, { kind: E, expression: `${amp ? 'Voltage' : 'Power'} ratio ${show(r)} in decibels`, value: (amp ? 20 : 10) * Math.log10(r), unit: 'dB', unitWords: 'decibels', formula: amp ? 'dB = 20 log₁₀(V₂/V₁)' : 'dB = 10 log₁₀(P₂/P₁)' });
  const ps = ofDim(c, 'power');
  if (ps.length >= 2) return res(c, { kind: E, expression: 'Power ratio in decibels', value: 10 * Math.log10(ps[1]!.v / ps[0]!.v), unit: 'dB', formula: 'dB = 10 log₁₀(P₂/P₁)' });
  return null;
};

// ─────────────── control: transfer functions ───────────────
type Poly = number[]; // coefficients, index = power of s
function padd(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}
function pmul(a: Poly, b: Poly): Poly {
  const out = new Array(a.length + b.length - 1).fill(0) as number[];
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return out;
}
/** Parses a polynomial in s: "s^2 + 3s + 2", "(s+1)(s+2)", "2*s^3 - s". */
export function parsePoly(src: string): Poly | null {
  const t = src.replace(/\s+/g, '').replace(/²/g, '^2').replace(/³/g, '^3');
  let i = 0;
  const peek = () => t[i];
  function expr(): Poly | null {
    let sign = 1;
    if (peek() === '+' || peek() === '-') sign = t[i++] === '-' ? -1 : 1;
    let acc = term();
    if (!acc) return null;
    acc = acc.map((x) => x * sign);
    while (peek() === '+' || peek() === '-') {
      const s = t[i++] === '-' ? -1 : 1;
      const r = term();
      if (!r) return null;
      acc = padd(acc, r.map((x) => x * s));
    }
    return acc;
  }
  function term(): Poly | null {
    let acc = factor();
    if (!acc) return null;
    for (;;) {
      if (peek() === '*') i++;
      else if (!(peek() === '(' || peek() === 's' || /[\d.]/.test(peek() ?? ''))) break;
      const f = factor();
      if (!f) return null;
      acc = pmul(acc, f);
    }
    return acc;
  }
  function factor(): Poly | null {
    let base: Poly | null;
    const ch = peek();
    if (ch === '(') {
      i++;
      base = expr();
      if (peek() !== ')') return null;
      i++;
    } else if (ch === 's') {
      i++;
      base = [0, 1];
    } else {
      const m = /^\d+(?:\.\d+)?(?:e[-+]?\d+)?/.exec(t.slice(i));
      if (!m) return null;
      i += m[0].length;
      base = [Number(m[0])];
    }
    if (!base) return null;
    if (peek() === '^') {
      i++;
      const m = /^\d+/.exec(t.slice(i));
      if (!m) return null;
      i += m[0].length;
      let r: Poly = [1];
      for (let k = 0; k < Number(m[0]); k++) r = pmul(r, base);
      base = r;
    }
    return base;
  }
  const p = expr();
  if (!p || i !== t.length) return null;
  while (p.length > 1 && Math.abs(p[p.length - 1]!) < 1e-15) p.pop();
  return p;
}
type Cx = [number, number];
/** Roots by Durand–Kerner. */
export function roots(p: Poly): Cx[] {
  const n = p.length - 1;
  if (n < 1) return [];
  const a = p.map((x) => x / p[n]!);
  const ev = (z: Cx): Cx => {
    let re = 0;
    let im = 0;
    for (let k = n; k >= 0; k--) {
      const nr = re * z[0] - im * z[1] + a[k]!;
      im = re * z[1] + im * z[0];
      re = nr;
    }
    return [re, im];
  };
  let zs: Cx[] = Array.from({ length: n }, (_, k) => {
    const r = 0.4 + 0.9 * k;
    return [Math.cos(r) * (1 + k * 0.1), Math.sin(r) * (1 + k * 0.1)] as Cx;
  });
  for (let it = 0; it < 500; it++) {
    let delta = 0;
    zs = zs.map((z, i) => {
      let den: Cx = [1, 0];
      zs.forEach((w, j) => {
        if (i === j) return;
        const d: Cx = [z[0] - w[0], z[1] - w[1]];
        den = [den[0] * d[0] - den[1] * d[1], den[0] * d[1] + den[1] * d[0]];
      });
      const f = ev(z);
      const m = den[0] ** 2 + den[1] ** 2;
      const q: Cx = [(f[0] * den[0] + f[1] * den[1]) / m, (f[1] * den[0] - f[0] * den[1]) / m];
      delta = Math.max(delta, Math.hypot(q[0], q[1]));
      return [z[0] - q[0], z[1] - q[1]] as Cx;
    });
    if (delta < 1e-14) break;
  }
  return zs.map(([re, im]) => [Math.abs(re) < 1e-9 ? 0 : re, Math.abs(im) < 1e-9 ? 0 : im] as Cx).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
}
const cx = ([re, im]: Cx) => (im === 0 ? show(re, 4) : `${show(re, 4)} ${im < 0 ? '−' : '+'} ${show(Math.abs(im), 4)}j`);
function polyText(p: Poly): string {
  const parts: string[] = [];
  for (let k = p.length - 1; k >= 0; k--) {
    const a = p[k]!;
    if (a === 0) continue;
    const mag = Math.abs(a);
    const coef = mag === 1 && k > 0 ? '' : show(mag, 4);
    const pw = k === 0 ? '' : k === 1 ? 's' : `s^${k}`;
    parts.push(`${a < 0 ? '−' : parts.length ? '+' : ''} ${coef}${pw}`.trim());
  }
  return parts.join(' ').replace(/^\+ /, '') || '0';
}
const control: Handler = (c) => {
  if (/transfer function|poles|zeros|characteristic (?:equation|polynomial)|routh|stable|stability|\bg\(s\)|\bh\(s\)|dc gain/.test(c.s) && /s/.test(c.s)) {
    const m = /(?:g\(s\)|h\(s\)|t\(s\))?\s*=?\s*(\(?[0-9s+\-*^.()\s²³]+\)?)\s*\/\s*(\(?[0-9s+\-*^.()\s²³]+\)?)\s*$/i.exec(c.t.replace(/^.*?(?:of|for|function|=|:)\s+/i, '').replace(/\s+(?:poles?|zeros?|stability|stable|dc gain)(?:\s+and\s+\w+)?\s*$/i, ''));
    const charM = /(?:characteristic (?:equation|polynomial)|polynomial|roots? of|stable\??|stability of)\s*:?\s*([0-9s+\-*^.()\s²³]+?)(?:\s*=\s*0)?\s*(?:stable)?$/i.exec(c.t);
    let num_: Poly | null = [1];
    let den: Poly | null = null;
    if (m) {
      num_ = parsePoly(m[1]!);
      den = parsePoly(m[2]!);
    } else if (charM) den = parsePoly(charM[1]!);
    if (!den || !num_ || den.length < 2) return null;
    if (den.length > 9) return fail(c, E, 'Polynomials above degree 8 aren’t supported');
    const ps = roots(den);
    const zs = num_.length > 1 ? roots(num_) : [];
    const stable = ps.every((p) => p[0] < -1e-12);
    const marginal = !stable && ps.every((p) => p[0] <= 1e-12) && ps.filter((p) => Math.abs(p[0]) <= 1e-12).length > 0;
    const lines: [string, string][] = [['Denominator', polyText(den)], ['Poles', ps.map(cx).join(', ')]];
    if (zs.length) lines.push(['Zeros', zs.map(cx).join(', ')]);
    if (den[0] !== 0) lines.push(['DC gain G(0)', show(num_[0]! / den[0]!)]);
    const dom = ps[0];
    if (stable && dom) {
      lines.push(['Dominant pole', cx(dom)]);
      const pair = ps.find((p) => p[1] !== 0);
      if (pair) {
        const wn = Math.hypot(pair[0], pair[1]);
        const z = -pair[0] / wn;
        lines.push(['ωn, ζ (complex pair)', `${show(wn)} rad/s, ${show(z)}`]);
      }
      lines.push(['Settling time (2%, dominant pole)', withUnit(4 / -dom[0], 's')]);
    }
    return res(c, { kind: E, expression: m ? 'Transfer function poles and stability' : 'Characteristic polynomial roots and stability', display: stable ? 'Stable' : marginal ? 'Marginally stable' : 'Unstable', lines, notes: ['Continuous-time: stable when every pole has a negative real part', 'Roots found numerically (Durand–Kerner)'] });
  }
  if (/overshoot|damping ratio|zeta|ζ|natural frequency|second.?order (?:system|response)|settling time|rise time|peak time/.test(c.s)) {
    const z = named(c, 'ζ|zeta|damping ratio|damping');
    const wn = named(c, 'ωn|wn|omega_?n|natural frequency') ?? ofDim(c, 'angvel')[0]?.v ?? null;
    const os = new RegExp(String.raw`(${NUM})\s*%\s*overshoot|overshoot\s*(?:of|=|is)?\s*(${NUM})\s*%`).exec(c.s);
    if (z === null && os) {
      const L = Math.log(num(os[1] ?? os[2]!) / 100);
      const zz = -L / Math.sqrt(Math.PI ** 2 + L * L);
      return res(c, { kind: E, expression: 'Damping ratio from percent overshoot', value: zz, formula: 'ζ = −ln(OS)/√(π² + ln²(OS))' });
    }
    if (/time constant|first.?order/.test(c.s)) {
      const tau = ofDim(c, 'time')[0];
      if (tau) return res(c, { kind: E, expression: 'First-order step response', value: 4 * tau.v, unit: 's', formula: 't_s ≈ 4τ (2%)', lines: [['Rise time (10–90%)', withUnit(2.197 * tau.v, 's')], ['63.2% at', withUnit(tau.v, 's')]] });
    }
    if (z === null) return need(c, E, 'What is the damping ratio ζ?');
    const lines: [string, string][] = [];
    if (z >= 1) return res(c, { kind: E, expression: 'Second-order step response', display: z === 1 ? 'Critically damped: no overshoot' : 'Overdamped: no overshoot', value: 0, lines: wn !== null ? [['Settling time (2%) approx.', withUnit(z === 1 ? 5.8336 / wn : 4 / (wn * (z - Math.sqrt(z * z - 1))), 's')]] : [] });
    const Mp = Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
    if (wn !== null) {
      const wd = wn * Math.sqrt(1 - z * z);
      lines.push(['Peak time', withUnit(Math.PI / wd, 's')], ['Settling time (2%)', withUnit(4 / (z * wn), 's')], ['Rise time (0–100%)', withUnit((Math.PI - Math.acos(z)) / wd, 's')], ['Damped frequency ωd', withUnit(wd, 'rad/s')]);
    }
    return res(c, { kind: E, expression: `Second-order step response, ζ = ${show(z)}${wn !== null ? `, ωn = ${show(wn)} rad/s` : ''}`, value: Mp * 100, unit: '%', display: `${show(Mp * 100)}% overshoot`, formula: 'M_p = e^(−ζπ/√(1−ζ²))', lines, notes: ['Standard underdamped second-order system (no zeros)'] });
  }
  if (/\bpid\b/.test(c.s)) {
    const kp = named(c, 'kp|k_p|proportional(?: gain)?') ?? 0;
    const ki = named(c, 'ki|k_i|integral gain') ?? 0;
    const kd = named(c, 'kd|k_d|derivative gain') ?? 0;
    const e = named(c, 'error|e');
    const ie = named(c, 'integral(?: of error)?|∫e|accumulated error') ?? 0;
    const de = named(c, 'derivative(?: of error)?|de/dt|rate of change') ?? 0;
    if (e === null) return need(c, E, 'PID output needs the error e (and optionally the integral and derivative of the error)');
    const u = kp * e + ki * ie + kd * de;
    return res(c, { kind: E, expression: 'PID controller output', value: u, formula: 'u = Kp·e + Ki·∫e dt + Kd·de/dt', lines: [['P term', show(kp * e)], ['I term', show(ki * ie)], ['D term', show(kd * de)]] });
  }
  return null;
};

// ─────────────── structures ───────────────
const structures: Handler = (c) => {
  if (/deflection|beam|cantilever|simply supported|bending moment|bending stress/.test(c.s)) {
    const L = lab(c, 'length', /span|length|\bl\b|long|beam/) ?? ofDim(c, 'length')[0];
    const P = ofDim(c, 'force')[0];
    const wq = /(\d[\d.e+-]*)\s*(kn|n)\s*\/\s*m\b/i.exec(c.s);
    const w = wq ? num(wq[1]!) * (wq[2]!.toLowerCase() === 'kn' ? 1000 : 1) : null;
    const Em = lab(c, 'pressure', /\be\b|modulus|young/) ?? ofDim(c, 'pressure')[0];
    const I = ofDim(c, 'inertia4')[0]?.v ?? named(c, 'i|moment of inertia|second moment');
    const cant = /cantilever/.test(c.s);
    const ss = /simply supported|simple beam|pinned/.test(c.s);
    if (!cant && !ss) return need(c, E, 'Is the beam a cantilever or simply supported?');
    if (!L) return need(c, E, 'What is the span length?');
    const udl = w !== null && /udl|uniform|distributed|\/m/.test(c.s);
    if (!udl && !P) return need(c, E, 'What is the load (point load in N/kN, or uniform load in kN/m)?');
    const Mmax = cant ? (udl ? (w! * L.v ** 2) / 2 : P!.v * L.v) : udl ? (w! * L.v ** 2) / 8 : (P!.v * L.v) / 4;
    const lines: [string, string][] = [['Max bending moment', withUnit(Mmax / 1000, 'kN·m')]];
    const formula = cant ? (udl ? 'δ = wL⁴/(8EI), M = wL²/2' : 'δ = PL³/(3EI), M = PL') : udl ? 'δ = 5wL⁴/(384EI), M = wL²/8' : 'δ = PL³/(48EI), M = PL/4';
    const caseName = `${cant ? 'Cantilever' : 'Simply supported beam'}, ${udl ? 'uniform load' : cant ? 'point load at the free end' : 'point load at mid-span'}`;
    if (/bending moment|moment/.test(c.s) && !/deflect/.test(c.s)) return res(c, { kind: E, expression: `Maximum bending moment: ${caseName}`, value: Mmax / 1000, unit: 'kN·m', formula, lines: [] });
    if (!Em || I === null) return need(c, E, 'Deflection needs E (e.g. 200 GPa) and I (e.g. 8e-6 m^4)');
    const EI = Em.v * I;
    const d = cant ? (udl ? (w! * L.v ** 4) / (8 * EI) : (P!.v * L.v ** 3) / (3 * EI)) : udl ? (5 * w! * L.v ** 4) / (384 * EI) : (P!.v * L.v ** 3) / (48 * EI);
    lines.push(['EI', withUnit(EI, 'N·m²')], ['Span/deflection', show(L.v / d)]);
    return res(c, { kind: E, expression: `Maximum deflection: ${caseName}`, value: d * 1000, unit: 'mm', unitWords: 'millimetres', formula, lines, notes: ['Linear-elastic Euler–Bernoulli beam, small deflections'] });
  }
  if (/moment of inertia|second moment|area moment|section modulus/.test(c.s) && !ofDim(c, 'mass').length) {
    const ls = ofDim(c, 'length');
    const unit = ls[0]?.unit ?? 'm';
    const sc = ls[0] ? ls[0].v / num(ls[0].raw.replace(/[^\d.e+-]/g, '')) : 1;
    const u4 = `${unit}⁴`;
    if (/rectang|\bb\b.*\bh\b|width.*height|beam section/.test(c.s)) {
      const b = lab(c, 'length', /\bb\b|width|base|breadth/) ?? ls[0];
      const h = lab(c, 'length', /\bh\b|height|depth/, b ? [b] : []) ?? ls[1];
      if (!b || !h) return need(c, E, 'A rectangle needs width b and height h');
      const I = (b.v * h.v ** 3) / 12;
      return res(c, { kind: E, expression: 'Second moment of area: rectangle about its centroidal axis', value: I / sc ** 4, unit: u4, formula: 'I = bh³/12', lines: [['In m⁴', withUnit(I, 'm⁴')], ['Section modulus S = I/(h/2)', withUnit(I / (h.v / 2) / sc ** 3, `${unit}³`)]] });
    }
    if (/hollow|tube|pipe|annul/.test(c.s) && ls.length >= 2) {
      const [D, d] = ls[0]!.v > ls[1]!.v ? [ls[0]!.v, ls[1]!.v] : [ls[1]!.v, ls[0]!.v];
      const I = (Math.PI * (D ** 4 - d ** 4)) / 64;
      return res(c, { kind: E, expression: 'Second moment of area: hollow circle', value: I / sc ** 4, unit: u4, formula: 'I = π(D⁴ − d⁴)/64', lines: [['Polar J', withUnit((2 * I) / sc ** 4, u4)]] });
    }
    if (/circ|round|rod|shaft/.test(c.s) && ls.length) {
      const r = lab(c, 'length', /radius/);
      const D = r ? 2 * r.v : ls[0]!.v;
      const I = (Math.PI * D ** 4) / 64;
      return res(c, { kind: E, expression: 'Second moment of area: solid circle', value: I / sc ** 4, unit: u4, formula: 'I = πd⁴/64', lines: [['Polar J = πd⁴/32', withUnit((2 * I) / sc ** 4, u4)]] });
    }
    if (/triang/.test(c.s) && ls.length >= 2) {
      const I = (ls[0]!.v * ls[1]!.v ** 3) / 36;
      return res(c, { kind: E, expression: 'Second moment of area: triangle about its centroid', value: I / sc ** 4, unit: u4, formula: 'I = bh³/36' });
    }
    return null;
  }
  if (/young'?s modulus|modulus of elasticity|elastic modulus/.test(c.s)) {
    const s = ofDim(c, 'pressure')[0];
    const strain = named(c, 'strain|ε');
    if (s && strain !== null) return res(c, { kind: E, expression: "Young's modulus", value: s.v / strain / 1e9, unit: 'GPa', formula: 'E = σ/ε' });
    const F = ofDim(c, 'force')[0];
    const A = ofDim(c, 'area')[0];
    const ls = ofDim(c, 'length');
    if (F && A && ls.length >= 2) {
      const [L, dL] = ls[0]!.v > ls[1]!.v ? [ls[0]!.v, ls[1]!.v] : [ls[1]!.v, ls[0]!.v];
      return res(c, { kind: E, expression: "Young's modulus from a tensile test", value: (F.v * L) / (A.v * dL) / 1e9, unit: 'GPa', formula: 'E = FL/(AΔL)' });
    }
    return need(c, E, "Young's modulus needs stress and strain (or force, area, length and extension)");
  }
  if (/elongat|extension of|stretch(?:es)? by|how much (?:does it|will it) stretch|axial deformation|change in length/.test(c.s) && ofDim(c, 'pressure').length) {
    const F = ofDim(c, 'force')[0];
    const A = ofDim(c, 'area')[0];
    const L = ofDim(c, 'length')[0];
    const Em = ofDim(c, 'pressure')[0];
    let area = A?.v;
    if (!area) {
      const d = lab(c, 'length', /diameter/);
      if (d) area = (Math.PI * d.v ** 2) / 4;
    }
    if (!F || !area || !L || !Em) return need(c, E, 'Axial elongation needs the force, area (or diameter), length and E');
    const dL = (F.v * L.v) / (area * Em.v);
    return res(c, { kind: E, expression: 'Axial elongation', value: dL * 1000, unit: 'mm', unitWords: 'millimetres', formula: 'ΔL = FL/(AE)', lines: [['Stress', withUnit((F.v / area) / 1e6, 'MPa')], ['Strain', show(dL / L.v)]] });
  }
  if (/\bstress\b/.test(c.s) && !/bending/.test(c.s)) {
    const F = ofDim(c, 'force')[0];
    const A = ofDim(c, 'area')[0];
    let area = A?.v;
    if (!area) {
      const d = lab(c, 'length', /diameter/);
      if (d) area = (Math.PI * d.v ** 2) / 4;
    }
    if (F && area) return res(c, { kind: E, expression: /shear/.test(c.s) ? 'Average shear stress' : 'Normal stress', value: F.v / area / 1e6, unit: 'MPa', unitWords: 'megapascals', formula: /shear/.test(c.s) ? 'τ = V/A' : 'σ = F/A', lines: [['In Pa', withUnit(F.v / area, 'Pa')]] });
    return /strain/.test(c.s) ? null : need(c, E, 'Stress needs the force and the cross-sectional area');
  }
  if (/\bstrain\b/.test(c.s)) {
    const ls = ofDim(c, 'length');
    if (ls.length >= 2) {
      const [L, dL] = ls[0]!.v > ls[1]!.v ? [ls[0]!.v, ls[1]!.v] : [ls[1]!.v, ls[0]!.v];
      return res(c, { kind: E, expression: 'Engineering strain', value: dL / L, formula: 'ε = ΔL/L', lines: [['Microstrain', show((dL / L) * 1e6) + ' µε'], ['Percent', pct(dL / L)]] });
    }
    return need(c, E, 'Strain needs the change in length and the original length');
  }
  if (/factor of safety|safety factor/.test(c.s)) {
    const ps = ofDim(c, 'pressure');
    if (ps.length >= 2) {
      const ult = lab(c, 'pressure', /yield|ultimate|strength|allowable|capacity/) ?? ps[0]!;
      const app = ps.find((p) => p !== ult)!;
      return res(c, { kind: E, expression: 'Factor of safety', value: ult.v / app.v, formula: 'FoS = strength / applied stress' });
    }
    return null;
  }
  return null;
};

// ─────────────── fluids (engineering) ───────────────
const pipeFlow: Handler = (c) => {
  if (/reynolds/.test(c.s)) {
    const v = ofDim(c, 'velocity')[0];
    const D = lab(c, 'length', /diameter|pipe|\bd\b|length|chord/) ?? ofDim(c, 'length')[0];
    const nu = ofDim(c, 'kinvisc')[0]?.v ?? named(c, 'kinematic viscosity|ν|nu', 'kinvisc');
    let rho = ofDim(c, 'density')[0]?.v;
    let mu = ofDim(c, 'viscosity')[0]?.v ?? named(c, 'dynamic viscosity|viscosity|μ|mu', 'viscosity');
    const notes: string[] = [];
    if (!v || !D) return need(c, E, 'Reynolds number needs the speed and the characteristic length (pipe diameter)');
    let Re: number;
    if (nu !== null) Re = (v.v * D.v) / nu;
    else {
      if (/\bair\b/.test(c.s)) {
        rho ??= 1.204;
        mu ??= 1.825e-5;
        notes.push('Air at 20 °C: ρ = 1.204 kg/m³, μ = 1.825 × 10⁻⁵ Pa·s');
      } else if ((rho === undefined || mu === null) && /water|\boil\b/.test(c.s) && !/\boil\b/.test(c.s)) {
        rho ??= 998.2;
        mu ??= 1.002e-3;
        notes.push('Water at 20 °C: ρ = 998.2 kg/m³, μ = 1.002 × 10⁻³ Pa·s');
      }
      if (rho === undefined || mu === null) return need(c, E, 'Reynolds number needs the fluid (water/air) or its density and viscosity');
      Re = (rho * v.v * D.v) / mu;
    }
    const regime = Re < 2300 ? 'laminar (Re < 2300)' : Re < 4000 ? 'transitional (2300–4000)' : 'turbulent (Re > 4000)';
    const lines: [string, string][] = [['Flow regime (pipe)', regime]];
    if (Re < 2300) lines.push(['Darcy friction factor 64/Re', show(64 / Re)]);
    return res(c, { kind: E, expression: 'Reynolds number', value: Re, sig: 4, formula: nu !== null ? 'Re = vD/ν' : 'Re = ρvD/μ', lines, notes });
  }
  if (/head loss|darcy|friction loss|pressure drop/.test(c.s) && /pipe|darcy|friction factor/.test(c.s)) {
    const f = named(c, 'f|friction factor|darcy friction factor');
    const L = lab(c, 'length', /length|long|\bl\b/) ?? ofDim(c, 'length')[0];
    const D = lab(c, 'length', /diameter|\bd\b/, L ? [L] : []) ?? ofDim(c, 'length')[1];
    const v = ofDim(c, 'velocity')[0];
    if (f === null || !L || !D || !v) return need(c, E, 'Darcy–Weisbach needs f, pipe length, diameter and velocity');
    const notes: string[] = [];
    const g = 9.81;
    notes.push('g = 9.81 m/s²');
    const h = (f * (L.v / D.v) * v.v ** 2) / (2 * g);
    return res(c, { kind: E, expression: 'Head loss (Darcy–Weisbach)', value: h, unit: 'm', unitWords: 'metres', formula: 'h_f = f(L/D)(v²/2g)', lines: [['Pressure drop (water)', withUnit((1000 * g * h) / 1000, 'kPa')]], notes });
  }
  if (/flow rate|discharge|volumetric flow|how much water flows/.test(c.s) && ofDim(c, 'velocity').length) {
    const v = ofDim(c, 'velocity')[0]!;
    const A = ofDim(c, 'area')[0];
    const D = lab(c, 'length', /diameter/) ?? ofDim(c, 'length')[0];
    const r = lab(c, 'length', /radius/);
    const area = A?.v ?? (r ? Math.PI * r.v ** 2 : D ? (Math.PI * D.v ** 2) / 4 : null);
    if (area === null) return need(c, E, 'Flow rate needs the pipe diameter (or area)');
    const Q = area * v.v;
    return res(c, { kind: E, expression: 'Volumetric flow rate', value: Q, unit: 'm³/s', formula: 'Q = Av', lines: [['In L/s', show(Q * 1000) + ' L/s'], ['In L/min', show(Q * 60000) + ' L/min'], ['Area', withUnit(area, 'm²')]] });
  }
  return null;
};

// ─────────────── thermodynamic cycles ───────────────
const cycles: Handler = (c) => {
  if (/otto/.test(c.s)) {
    const r = named(c, 'compression ratio|r|ratio');
    const g = named(c, 'γ|gamma|k|heat capacity ratio') ?? 1.4;
    if (r === null) return need(c, E, 'What is the compression ratio?');
    return res(c, { kind: E, expression: 'Otto cycle thermal efficiency', value: 1 - r ** (1 - g), display: `${show((1 - r ** (1 - g)) * 100)}%`, formula: 'η = 1 − 1/r^(γ−1)', lines: [['r', show(r)], ['γ', show(g)]], notes: ['Air-standard cycle (cold air, γ = 1.4 unless given)'] });
  }
  if (/diesel/.test(c.s) && /cutoff|cut-off/.test(c.s)) {
    const r = named(c, 'compression ratio|r');
    const rc = named(c, 'cut-?off ratio|rc');
    const g = named(c, 'γ|gamma|k') ?? 1.4;
    if (r === null || rc === null) return need(c, E, 'Diesel cycle needs the compression and cutoff ratios');
    const eta = 1 - (1 / r ** (g - 1)) * ((rc ** g - 1) / (g * (rc - 1)));
    return res(c, { kind: E, expression: 'Diesel cycle thermal efficiency', value: eta, display: `${show(eta * 100)}%`, formula: 'η = 1 − (1/r^(γ−1))·(r_c^γ − 1)/(γ(r_c − 1))' });
  }
  if (/brayton|gas turbine/.test(c.s)) {
    const rp = named(c, 'pressure ratio|rp|r_p|ratio');
    const g = named(c, 'γ|gamma|k') ?? 1.4;
    if (rp === null) return need(c, E, 'What is the pressure ratio?');
    const eta = 1 - rp ** (-(g - 1) / g);
    return res(c, { kind: E, expression: 'Brayton cycle thermal efficiency', value: eta, display: `${show(eta * 100)}%`, formula: 'η = 1 − r_p^(−(γ−1)/γ)' });
  }
  if (/\bcop\b|coefficient of performance|refrigerator|heat pump/.test(c.s)) {
    const ts = temperatures(c);
    if (ts.length >= 2) {
      const [Th, Tc] = ts[0]!.k > ts[1]!.k ? [ts[0]!.k, ts[1]!.k] : [ts[1]!.k, ts[0]!.k];
      const hp = /heat pump|heating/.test(c.s);
      const cop = hp ? Th / (Th - Tc) : Tc / (Th - Tc);
      return res(c, { kind: E, expression: `Carnot COP (${hp ? 'heat pump' : 'refrigerator'})`, value: cop, formula: hp ? 'COP = T_h/(T_h − T_c)' : 'COP = T_c/(T_h − T_c)', lines: [['T_hot', withUnit(Th, 'K')], ['T_cold', withUnit(Tc, 'K')]], notes: ['Ideal (reversible) upper bound'] });
    }
    const es = [...ofDim(c, 'energy'), ...ofDim(c, 'power')];
    if (es.length >= 2) {
      const W = lab(c, ['energy', 'power'], /work|input|electric|consum/) ?? es[1]!;
      const Q = es.find((e) => e !== W)!;
      return res(c, { kind: E, expression: 'Coefficient of performance', value: Q.v / W.v, formula: 'COP = Q/W' });
    }
    return null;
  }
  return null;
};

// ─────────────── reliability & quality ───────────────
const reliability: Handler = (c) => {
  if (/\bmtbf\b|mean time between failures|failure rate|reliability|availability|\bmttr\b|\bmttf\b/.test(c.s)) {
    if (/series|parallel|redundan/.test(c.s) && !/mtbf|failure rate/.test(c.s)) {
      const rs = [...c.s.matchAll(new RegExp(String.raw`(${NUM})\s*(%)?`, 'g'))].map((m) => (m[2] ? num(m[1]!) / 100 : num(m[1]!))).filter((x) => x > 0 && x <= 1);
      const nx = /(\d+)\s*(?:identical\s+)?(?:components|units|parts)\s*(?:each\s*)?(?:with\s+)?(?:reliability\s*)?(?:of\s*)?(\d?\.\d+)/.exec(c.s);
      let list = rs;
      if (nx) list = Array.from({ length: Number(nx[1]) }, () => num(nx[2]!));
      if (list.length < 2) return need(c, E, 'Give each component reliability, e.g. "series reliability 0.9, 0.95, 0.99"');
      const par = /parallel|redundan/.test(c.s);
      const R = par ? 1 - list.reduce((p, r) => p * (1 - r), 1) : list.reduce((p, r) => p * r, 1);
      return res(c, { kind: E, expression: `System reliability, ${list.length} components in ${par ? 'parallel (any one suffices)' : 'series (all must work)'}`, value: R, display: `${show(R, 5)} (${show(R * 100, 5)}%)`, formula: par ? 'R = 1 − Π(1 − Rᵢ)' : 'R = Π Rᵢ', lines: [['Components', list.map((r) => show(r)).join(', ')], ['Unreliability', show(1 - R, 4)]], notes: ['Independent failures'] });
    }
    const mtbf = lab(c, 'time', /mtbf|mttf|mean time/) ?? null;
    const mttr = lab(c, 'time', /mttr|repair/);
    const lam = named(c, 'failure rate|λ|lambda');
    if (/availability/.test(c.s)) {
      if (!mtbf || !mttr) return need(c, E, 'Availability needs MTBF and MTTR');
      const A = mtbf.v / (mtbf.v + mttr.v);
      return res(c, { kind: E, expression: 'Inherent availability', value: A, display: `${show(A * 100, 6)}%`, formula: 'A = MTBF/(MTBF + MTTR)', lines: [['Downtime per year', `${show((1 - A) * 8766)} h`]] });
    }
    const t = ofDim(c, 'time').find((q) => q !== mtbf && q !== mttr);
    const rate = lam ?? (mtbf ? 1 / mtbf.v : null);
    if (rate === null) return need(c, E, 'Reliability needs the MTBF (or failure rate)');
    const hr = mtbf ? mtbf.v / num(mtbf.raw.replace(/[^\d.e+-]/g, '')) : 3600;
    if (t && /reliab|probability|surviv|after|for/.test(c.s)) {
      const R = Math.exp(-rate * t.v * (lam !== null ? 1 / 3600 : 1));
      return res(c, { kind: E, expression: `Reliability over ${t.raw}`, value: R, display: `${show(R, 5)} (${show(R * 100, 4)}%)`, formula: 'R(t) = e^(−λt), λ = 1/MTBF', lines: [['Failure rate λ', `${show(lam ?? rate * hr)} per ${lam !== null ? 'hour' : mtbf!.unit}`], ['Probability of failure', show(1 - R, 4)]], notes: ['Constant failure rate (exponential model)'] });
    }
    if (mtbf) return res(c, { kind: E, expression: 'Failure rate from MTBF', value: 1 / num(mtbf.raw.replace(/[^\d.e+-]/g, '')), unit: `per ${mtbf.unit}`, formula: 'λ = 1/MTBF', lines: [['FIT (failures per 10⁹ h)', show((1 / (mtbf.v / 3600)) * 1e9)]] });
    if (lam !== null) return res(c, { kind: E, expression: 'MTBF from failure rate', value: 1 / lam, formula: 'MTBF = 1/λ', notes: ['Same time unit as λ'] });
    return null;
  }
  if (/\bcpk?\b|process capability/.test(c.s)) {
    const usl = named(c, 'usl|upper(?: spec(?:ification)?)?(?: limit)?');
    const lsl = named(c, 'lsl|lower(?: spec(?:ification)?)?(?: limit)?');
    const sd = named(c, 'σ|sigma|sd|standard deviation|std');
    const mu = named(c, 'mean|μ|mu|average|x̄');
    if (usl === null || lsl === null || sd === null) return need(c, E, 'Cp/Cpk need USL, LSL and σ (and the mean for Cpk)');
    const cp = (usl - lsl) / (6 * sd);
    const lines: [string, string][] = [['Cp', show(cp)]];
    if (mu !== null) {
      const cpu = (usl - mu) / (3 * sd);
      const cpl = (mu - lsl) / (3 * sd);
      const cpk = Math.min(cpu, cpl);
      lines.push(['Cpu', show(cpu)], ['Cpl', show(cpl)], ['Cpk', show(cpk)]);
      if (/cpk/.test(c.s) || mu !== null) return res(c, { kind: E, expression: 'Process capability Cpk', value: cpk, formula: 'Cpk = min(USL − μ, μ − LSL)/(3σ)', lines, notes: [cpk >= 1.33 ? 'Capable (Cpk ≥ 1.33)' : cpk >= 1 ? 'Marginal (1 ≤ Cpk < 1.33)' : 'Not capable (Cpk < 1)'] });
    }
    return res(c, { kind: E, expression: 'Process capability Cp', value: cp, formula: 'Cp = (USL − LSL)/(6σ)', lines });
  }
  if (/control limits?|control chart|\bucl\b|\blcl\b|x.?bar chart|r chart|p chart/.test(c.s)) {
    const A2: Record<number, number> = { 2: 1.88, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 };
    const D3: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223 };
    const D4: Record<number, number> = { 2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777 };
    const mean = named(c, 'grand mean|x̿|xbarbar|mean|center ?line|cl|average');
    const rbar = named(c, 'r-?bar|r̄|average range|mean range');
    const n = named(c, 'n|subgroup size|sample size');
    if (/\bp chart|proportion defective|p-bar|p̄/.test(c.s)) {
      const p = named(c, 'p-?bar|p̄|p|proportion(?: defective)?');
      if (p === null || n === null) return need(c, E, 'A p chart needs p̄ and the sample size n');
      const s = Math.sqrt((p * (1 - p)) / n);
      return res(c, { kind: E, expression: 'p chart control limits', display: `UCL ${show(p + 3 * s)}, LCL ${show(Math.max(0, p - 3 * s))}`, value: p + 3 * s, formula: 'p̄ ± 3√(p̄(1−p̄)/n)', lines: [['Centre line', show(p)]] });
    }
    if (mean !== null && rbar !== null && n !== null) {
      const a2 = A2[n];
      if (a2 === undefined) return fail(c, E, 'Subgroup size must be 2–10 for the tabulated A₂ constant');
      return res(c, { kind: E, expression: `X̄ chart control limits (n = ${n})`, display: `UCL ${show(mean + a2 * rbar)}, LCL ${show(mean - a2 * rbar)}`, value: mean + a2 * rbar, formula: 'X̄̄ ± A₂R̄', lines: [['A₂', show(a2)], ['Centre line', show(mean)], ['R chart UCL (D₄R̄)', show(D4[n]! * rbar)], ['R chart LCL (D₃R̄)', show(D3[n]! * rbar)]], notes: ['A₂, D₃, D₄ from standard SPC tables (Montgomery, Introduction to Statistical Quality Control)'] });
    }
    const sd = named(c, 'σ|sigma|sd|standard deviation');
    if (mean !== null && sd !== null) {
      const k = n !== null ? Math.sqrt(n) : 1;
      return res(c, { kind: E, expression: `3σ control limits${n !== null ? ` for means of ${n}` : ''}`, display: `UCL ${show(mean + (3 * sd) / k)}, LCL ${show(mean - (3 * sd) / k)}`, value: mean + (3 * sd) / k, formula: n !== null ? 'μ ± 3σ/√n' : 'μ ± 3σ', lines: [['Centre line', show(mean)]] });
    }
    return need(c, E, 'Control limits need the mean with σ, or X̄̄ with R̄ and n');
  }
  return null;
};

// ─────────────── robotics ───────────────
const robotics: Handler = (c) => {
  if (!/(?:planar|robot|two.?link|2.?link|three.?link|3.?link|link) ?(?:arm|manipulator|robot)|forward kinematics|inverse kinematics|link lengths?/.test(c.s)) return null;
  const ls = ofDim(c, 'length').map((q) => q.v);
  const linkNums = /link lengths?\s*(?:of\s*)?((?:\d+(?:\.\d+)?\s*(?:,|and)?\s*)+)/.exec(c.s);
  const lengths = ls.length ? ls : linkNums ? numbers(linkNums[1]!) : [];
  if (/inverse/.test(c.s)) {
    const tgt = new RegExp(String.raw`\(\s*(${SNUM})\s*,\s*(${SNUM})\s*\)`).exec(c.s);
    if (lengths.length < 2 || !tgt) return need(c, E, 'Inverse kinematics needs two link lengths and a target point (x, y)');
    const [l1, l2] = [lengths[0]!, lengths[1]!];
    const [x, y] = [num(tgt[1]!), num(tgt[2]!)];
    const cos2 = (x * x + y * y - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    if (Math.abs(cos2) > 1) return fail(c, E, `(${show(x)}, ${show(y)}) is out of reach (distance ${show(Math.hypot(x, y))}, reach ${show(l1 + l2)})`);
    const t2 = Math.acos(cos2);
    const t1 = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(t2), l1 + l2 * Math.cos(t2));
    const t2b = -t2;
    const t1b = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(t2b), l1 + l2 * Math.cos(t2b));
    return res(c, { kind: E, expression: `Two-link inverse kinematics to (${show(x)}, ${show(y)})`, display: `θ₁ = ${show(todeg(t1))}°, θ₂ = ${show(todeg(t2))}°`, value: todeg(t1), formula: 'cos θ₂ = (x² + y² − l₁² − l₂²)/(2l₁l₂)', lines: [['Elbow-down', `θ₁ = ${show(todeg(t1))}°, θ₂ = ${show(todeg(t2))}°`], ['Elbow-up', `θ₁ = ${show(todeg(t1b))}°, θ₂ = ${show(todeg(t2b))}°`]] });
  }
  const angs = ofDim(c, 'angle').map((q) => q.v);
  if (lengths.length < 2 || angs.length < lengths.length) return need(c, E, 'Forward kinematics needs each link length and each joint angle (relative), e.g. "links 1 m, 1 m, angles 30°, 45°"');
  let x = 0;
  let y = 0;
  let th = 0;
  const rows: string[][] = [];
  lengths.forEach((L, i) => {
    th += angs[i]!;
    x += L * Math.cos(deg(th));
    y += L * Math.sin(deg(th));
    rows.push([`Joint ${i + 1}`, show(L), `${show(angs[i]!)}°`, `${show(th)}°`, `(${show(x)}, ${show(y)})`]);
  });
  return res(c, { kind: E, expression: `Planar ${lengths.length}-link forward kinematics`, display: `(${show(x)}, ${show(y)})`, value: x, formula: 'x = Σ lᵢ cos(θ₁+…+θᵢ), y = Σ lᵢ sin(θ₁+…+θᵢ)', table: { columns: ['Link', 'Length', 'Joint angle', 'Absolute angle', 'End point'], rows }, lines: [['End-effector orientation', `${show(th)}°`], ['Distance from base', show(Math.hypot(x, y))]], notes: ['Joint angles are relative to the previous link; base along +x'] });
};

export const engineering: Handler[] = [resistors, divider, ac, decibels, control, structures, pipeFlow, cycles, reliability, robotics];
export { K };
