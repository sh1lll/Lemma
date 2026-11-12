// Signal processing: DFT/FFT and inverse, convolution, correlation, moving averages, FIR filtering, Nyquist and
// aliasing, decibels.
import { answer, compile, fmt, numbers, param, refuse, type Result } from './util';

type C = [number, number];

/** "1 0 -1 0", "1+2i, 3, -i" → complex list. */
export function complexList(s: string): C[] {
  const toks = s.replace(/[[\]()]/g, ' ').split(/[,;]|\s+(?![+-]\s*\d*\.?\d*i\b)/).map((t) => t.replace(/\s+/g, '')).filter(Boolean);
  const out: C[] = [];
  for (const t of toks) {
    const m = /^([-+−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?(?:([-+−])((?:\d+\.?\d*|\.\d+)?)i)?$/i.exec(t);
    const pure = /^([-+−]?)((?:\d+\.?\d*|\.\d+)?)i$/i.exec(t);
    if (pure) out.push([0, (pure[1] === '-' || pure[1] === '−' ? -1 : 1) * (pure[2] ? Number(pure[2]) : 1)]);
    else if (m && (m[1] !== undefined || m[2])) out.push([Number((m[1] ?? '0').replace('−', '-')), m[2] ? (m[2] === '+' ? 1 : -1) * (m[3] ? Number(m[3]) : 1) : 0]);
  }
  return out;
}

export function dft(x: C[], inverse = false): C[] {
  const N = x.length;
  const s = inverse ? 1 : -1;
  return Array.from({ length: N }, (_, k) => {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const a = (s * 2 * Math.PI * k * n) / N;
      const [xr, xi] = x[n]!;
      re += xr * Math.cos(a) - xi * Math.sin(a);
      im += xr * Math.sin(a) + xi * Math.cos(a);
    }
    return inverse ? [re / N, im / N] : [re, im];
  });
}

const tidy = (v: number) => (Math.abs(v) < 1e-10 ? 0 : Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) : v);
export const cstr = ([re, im]: C) => {
  const r = tidy(re);
  const i = tidy(im);
  if (i === 0) return fmt(r, 6);
  if (r === 0) return `${i === 1 ? '' : i === -1 ? '−' : fmt(i, 6)}i`.replace(/^-/, '−');
  return `${fmt(r, 6)} ${i < 0 ? '−' : '+'} ${Math.abs(i) === 1 ? '' : fmt(Math.abs(i), 6)}i`;
};

function fourier(input: string): Result {
  const lc = input.toLowerCase();
  const m = /\b(inverse\s+(?:dft|fft|discrete fourier transform|fourier transform)|idft|ifft|dft|fft|discrete fourier transform)\b/.exec(lc);
  if (!m) return null;
  const inverse = /inverse|idft|ifft/.test(m[1]!);
  const x = complexList(input.slice(m.index + m[0].length).replace(/^\s*(?:of|for)\s*/i, ''));
  if (x.length < 1) refuse('Give a list, e.g. “dft of 1 0 -1 0”');
  if (x.length > 4096) refuse('Up to 4096 samples');
  const X = dft(x, inverse);
  const N = x.length;
  const fs = param(input, ['fs', 'sampling rate', 'sample rate', 'sampled at']);
  const rows = X.map((v, k) => [String(k), ...(fs && !inverse ? [fmt((k * fs) / N, 6)] : []), cstr(v), fmt(tidy(Math.hypot(v[0], v[1])), 6), fmt(tidy((Math.atan2(tidy(v[1]), tidy(v[0])) * 180) / Math.PI), 5) + '°']);
  const pow2 = (N & (N - 1)) === 0;
  const energyT = x.reduce((s, [a, b]) => s + a * a + b * b, 0);
  const energyF = X.reduce((s, [a, b]) => s + a * a + b * b, 0) / N;
  return answer(input, 'signal', `${inverse ? 'Inverse ' : ''}${/fft/.test(m[1]!) ? 'FFT' : 'DFT'} of ${N} sample${N === 1 ? '' : 's'}`, `[${X.map(cstr).join(', ')}]`, {
    lines: inverse ? [] : [{ label: 'Parseval check', display: `Σ|x|² = ${fmt(tidy(energyT), 8)} = (1/N)Σ|X|² = ${fmt(tidy(energyF), 8)}` }],
    table: { columns: [inverse ? 'n' : 'k', ...(fs && !inverse ? ['frequency (Hz)'] : []), inverse ? 'x[n]' : 'X[k]', 'magnitude', 'phase'], rows },
    notes: [inverse ? 'x[n] = (1/N) Σ X[k] e^(+2πikn/N).' : 'X[k] = Σ x[n] e^(−2πikn/N).', ...(/fft/.test(m[1]!) ? [pow2 ? 'N is a power of 2, so a radix-2 FFT computes this in O(N log N); the values are the same as the DFT.' : 'N is not a power of 2; the result is the same DFT (mixed-radix or Bluestein FFTs handle any N).'] : [])],
  });
}

function lists(s: string): number[][] {
  const br = [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => numbers(m[1]!));
  if (br.length >= 2) return br;
  const parts = s.split(/\b(?:with|and|by|kernel|filter|h\s*=|x\s*=|g\s*=|coefficients?|input|signal)\b/i).map((p) => numbers(p)).filter((p) => p.length);
  return parts;
}

function convolution(input: string): Result {
  const lc = input.toLowerCase();
  const circ = /\bcircular\b/.test(lc);
  if (!/\bconvol\w*\b/.test(lc)) return null;
  const L = lists(input.replace(/^.*?convol\w*(?:\s+of)?/i, ''));
  if (L.length < 2) refuse('Give two lists: “convolve 1 2 3 with 0 1 0.5”');
  const [a, b] = [L[0]!, L[1]!];
  let y: number[];
  if (circ) {
    const N = Math.max(a.length, b.length);
    y = Array.from({ length: N }, (_, n) => a.reduce((s, _, k) => s + (a[k] ?? 0) * (b[(((n - k) % N) + N) % N] ?? 0), 0));
  } else {
    y = new Array(a.length + b.length - 1).fill(0);
    a.forEach((x, i) => b.forEach((h, j) => (y[i + j]! += x * h)));
  }
  return answer(input, 'signal', `${circ ? 'Circular' : 'Linear'} convolution of [${a.map((v) => fmt(v)).join(', ')}] and [${b.map((v) => fmt(v)).join(', ')}]`, `[${y.map((v) => fmt(tidy(v), 8)).join(', ')}]`, {
    lines: [{ label: 'Length', display: `${y.length}${circ ? '' : ` = ${a.length} + ${b.length} − 1`}` }],
    table: { columns: ['n', 'y[n] = Σ a[k]·b[n−k]'], rows: y.map((v, n) => [String(n), fmt(tidy(v), 8)]) },
    notes: [circ ? 'Indices wrap modulo N; this is what multiplying DFTs computes.' : 'Linear convolution = polynomial multiplication of the coefficient lists.'],
  });
}

function correlation(input: string): Result {
  const lc = input.toLowerCase();
  const auto = /\bauto-?correlation\b/.test(lc);
  if (!auto && !/\bcross-?correlation\b/.test(lc)) return null;
  const L = lists(input.replace(/^.*?correlation(?:\s+of)?/i, ''));
  const a = L[0];
  const b = auto ? a : L[1];
  if (!a || !b) refuse(auto ? 'Give a list' : 'Give two lists');
  const lags: number[] = [];
  const r: number[] = [];
  for (let k = -(b!.length - 1); k <= a!.length - 1; k++) {
    let s = 0;
    for (let n = 0; n < a!.length; n++) {
      const j = n - k;
      if (j >= 0 && j < b!.length) s += a![n]! * b![j]!;
    }
    lags.push(k);
    r.push(s);
  }
  const peak = r.indexOf(Math.max(...r));
  return answer(input, 'signal', `${auto ? 'Autocorrelation' : 'Cross-correlation'} (unnormalised)`, `[${r.map((v) => fmt(tidy(v), 8)).join(', ')}]`, {
    lines: [{ label: 'Peak', display: `${fmt(r[peak]!, 8)} at lag ${lags[peak]}` }],
    table: { columns: ['lag k', 'r[k] = Σ a[n]·b[n−k]'], rows: r.map((v, i) => [String(lags[i]), fmt(tidy(v), 8)]) },
    notes: auto ? ['Autocorrelation is symmetric and peaks at lag 0 (the signal energy).'] : ['The lag of the peak estimates the delay between the signals.'],
  });
}

function movingAverage(input: string): Result {
  const lc = input.toLowerCase();
  const ema = /\b(?:exponential(?:ly weighted)? moving average|ema|ewma|exponential smoothing)\b/.test(lc);
  if (!ema && !/\b(?:moving|rolling|running) (?:average|mean)\b|\bsma\b/.test(lc)) return null;
  const alpha = param(input, ['alpha', 'α', 'smoothing factor']);
  const win = param(input, ['window', 'period', 'n', 'k', 'span']) ?? (/\b(\d+)[- ](?:point|day|period|term)\b/i.exec(input) ? Number(/\b(\d+)[- ](?:point|day|period|term)\b/i.exec(input)![1]) : undefined);
  const data = numbers(input.replace(/\b(?:window|period|alpha|α|smoothing factor|span|n|k)\s*(?:=|:|of|is)?\s*[\d.]+/gi, '').replace(/\b\d+[- ](?:point|day|period|term)\b/gi, ''));
  if (data.length < 2) refuse('Give the data and a window, e.g. “moving average of 1 2 3 4 5 6 window 3”');
  if (ema) {
    const a = alpha ?? (win ? 2 / (win + 1) : undefined);
    if (a === undefined || a <= 0 || a > 1) refuse('Give α between 0 and 1 (or a span N, α = 2/(N+1))');
    const out: number[] = [data[0]!];
    for (let i = 1; i < data.length; i++) out.push(a! * data[i]! + (1 - a!) * out[i - 1]!);
    return answer(input, 'signal', `Exponential moving average, α = ${fmt(a!, 6)}`, `[${out.map((v) => fmt(v, 6)).join(', ')}]`, { table: { columns: ['t', 'x', 'EMA'], rows: data.map((x, i) => [String(i + 1), fmt(x), fmt(out[i]!, 8)]) }, notes: ['sₜ = αxₜ + (1 − α)sₜ₋₁, started at s₁ = x₁.'] });
  }
  const w = win ?? 3;
  if (!Number.isInteger(w) || w < 1 || w > data.length) refuse('Window must be a whole number no longer than the data');
  const out: number[] = [];
  for (let i = 0; i + w <= data.length; i++) out.push(data.slice(i, i + w).reduce((s, x) => s + x, 0) / w);
  return answer(input, 'signal', `${w}-point simple moving average of ${data.length} values`, `[${out.map((v) => fmt(v, 8)).join(', ')}]`, { table: { columns: ['window', 'values', 'average'], rows: out.map((v, i) => [`${i + 1}–${i + w}`, data.slice(i, i + w).map((x) => fmt(x)).join(', '), fmt(v, 8)]) }, notes: ['A moving average is an FIR low-pass filter with equal weights 1/N.'] });
}

function fir(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bfir\b|\bfilter coefficients\b|\bdifference equation\b/.test(lc)) return null;
  const bm = /\b(?:coefficients?|taps|b|h)\s*(?:=|:)?\s*\[?([-−\d.,\s/]+)\]?/i.exec(input);
  const xm = /\b(?:input|x|signal)\s*(?:=|:)?\s*\[?([-−\d.,\s/]+)\]?/i.exec(input);
  if (!bm || !xm) refuse('Give coefficients and input: “fir filter coefficients 0.25 0.5 0.25 input 1 2 3 4”');
  const b = numbers(bm![1]!);
  const x = numbers(xm![1]!);
  const y = x.map((_, n) => b.reduce((s, bk, k) => s + bk * (x[n - k] ?? 0), 0));
  const dc = b.reduce((s, v) => s + v, 0);
  return answer(input, 'signal', `FIR filter, ${b.length} taps, ${x.length} input samples`, `[${y.map((v) => fmt(tidy(v), 8)).join(', ')}]`, {
    lines: [{ label: 'Difference equation', display: `y[n] = ${b.map((c, k) => `${fmt(c)}·x[n${k ? `−${k}` : ''}]`).join(' + ')}` }, { label: 'DC gain Σb', display: fmt(dc, 8) }],
    table: { columns: ['n', 'x[n]', 'y[n]'], rows: x.map((v, n) => [String(n), fmt(v), fmt(tidy(y[n]!), 8)]) },
    notes: ['Samples before n = 0 are taken as 0 (the filter starts at rest).'],
  });
}

const HZ = /([\d.]+)\s*(k|m|g)?hz\b/gi;
const hz = (m: RegExpExecArray | RegExpMatchArray) => Number(m[1]) * ({ k: 1e3, m: 1e6, g: 1e9 }[(m[2] ?? '').toLowerCase() as 'k'] ?? 1);
const hzStr = (f: number) => (f >= 1e9 ? `${fmt(f / 1e9, 6)} GHz` : f >= 1e6 ? `${fmt(f / 1e6, 6)} MHz` : f >= 1e3 ? `${fmt(f / 1e3, 6)} kHz` : `${fmt(f, 6)} Hz`);

function nyquist(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bnyquist\b|\balias\w*\b|\bsampling theorem\b|\bsampled at\b/.test(lc)) return null;
  const fr = [...input.matchAll(HZ)].map(hz);
  if (!fr.length) return null;
  if (fr.length === 1) {
    const f = fr[0]!;
    if (/\bnyquist frequency\b/.test(lc) && /\bsampl/.test(lc)) return answer(input, 'signal', `Nyquist frequency for sampling at ${hzStr(f)}`, hzStr(f / 2), { value: f / 2, notes: ['The Nyquist frequency is half the sampling rate: the highest frequency representable without aliasing.'] });
    return answer(input, 'signal', `Nyquist rate for a signal band-limited to ${hzStr(f)}`, hzStr(2 * f), { value: 2 * f, lines: [{ label: 'Minimum sampling rate', display: `fs > 2·fmax = ${hzStr(2 * f)}` }], notes: ['Shannon–Nyquist: sample faster than twice the highest frequency to reconstruct the signal exactly.'] });
  }
  // Signal f and sampling rate fs: "7 kHz sampled at 10 kHz".
  const sm = /(?:sampled at|sampling (?:rate|frequency)(?: of)?|fs\s*=|at a rate of)\s*([\d.]+)\s*(k|m|g)?hz/i.exec(input);
  const fs = sm ? hz(sm) : Math.max(...fr);
  const f = fr.find((x) => x !== fs) ?? Math.min(...fr);
  const k = Math.round(f / fs);
  const alias = Math.abs(f - k * fs);
  const ok = fs > 2 * f;
  return answer(input, 'signal', `${hzStr(f)} signal sampled at ${hzStr(fs)}`, ok ? `no aliasing (appears at ${hzStr(f)})` : `aliases to ${hzStr(alias)}`, {
    value: alias,
    lines: [
      { label: 'Nyquist frequency fs/2', display: hzStr(fs / 2) },
      { label: 'Nyquist rate needed 2f', display: hzStr(2 * f) },
      { label: 'Apparent frequency |f − k·fs|', display: `${hzStr(alias)} (k = ${k})` },
    ],
    notes: [ok ? 'fs > 2f, so the samples represent the signal faithfully.' : 'fs ≤ 2f: the samples are indistinguishable from a lower-frequency sinusoid (folding about fs/2).'],
  });
}

function decibels(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\bdb[mwvu]?\b|\bdecibels?\b|\bbels?\b/.test(lc)) return null;
  let m: RegExpExecArray | null;
  if ((m = /(-?[\d.]+)\s*dbm\b.*\b(?:to|in)\s*(mw|milliwatts?|w|watts?)\b/i.exec(input))) {
    const mw = 10 ** (Number(m[1]) / 10);
    const watts = /^w|^watt/i.test(m[2]!);
    return answer(input, 'signal', `${m[1]} dBm in ${watts ? 'watts' : 'milliwatts'}`, watts ? `${fmt(mw / 1000, 8)} W` : `${fmt(mw, 8)} mW`, { value: watts ? mw / 1000 : mw, notes: ['dBm is decibels relative to 1 mW: P(mW) = 10^(dBm/10).'] });
  }
  if ((m = /([\d.]+(?:e-?\d+)?)\s*(mw|milliwatts?|w|watts?)\b.*\b(?:to|in)\s*dbm\b/i.exec(input))) {
    const mw = Number(m[1]) * (/^m/i.test(m[2]!) ? 1 : 1000);
    const db = 10 * Math.log10(mw);
    return answer(input, 'signal', `${m[1]} ${m[2]} in dBm`, `${fmt(db, 8)} dBm`, { value: db, notes: ['dBm = 10·log₁₀(P / 1 mW).'] });
  }
  const voltage = /\b(?:voltage|amplitude|current|pressure|field|gain in voltage|v)\b/.test(lc);
  if ((m = /(-?[\d.]+)\s*db\b.*\b(?:to|in|as)\s*(?:a\s+)?(power|voltage|amplitude)?\s*(?:ratio|gain|factor|times)/i.exec(input)) || (m = /\b(power|voltage|amplitude)?\s*(?:ratio|gain)\s*(?:of|for)\s*(-?[\d.]+)\s*db\b/i.exec(input))) {
    const dbVal = Number(/^-?[\d.]+$/.test(m[1] ?? '') ? m[1] : m[2]);
    const isV = voltage || /voltage|amplitude/i.test(m[0]);
    const r = 10 ** (dbVal / (isV ? 20 : 10));
    return answer(input, 'signal', `${fmt(dbVal)} dB as a ${isV ? 'voltage (amplitude)' : 'power'} ratio`, `× ${fmt(r, 8)}`, { value: r, lines: [{ label: 'Formula', display: isV ? 'ratio = 10^(dB/20)' : 'ratio = 10^(dB/10)' }, { label: isV ? 'Power ratio' : 'Amplitude ratio', display: fmt(isV ? r * r : Math.sqrt(r), 8) }], notes: ['+3 dB ≈ double the power; +6 dB ≈ double the amplitude; +10 dB = 10× power.'] });
  }
  if ((m = /\b(?:signal|s)\s*(?:=|:|of|is)?\s*([\d.]+(?:e-?\d+)?)\s*\w*\s*(?:,|and)?\s*(?:noise|n)\s*(?:=|:|of|is)?\s*([\d.]+(?:e-?\d+)?)/i.exec(input))) {
    const s = Number(m[1]);
    const n = Number(m[2]);
    const db = (voltage ? 20 : 10) * Math.log10(s / n);
    return answer(input, 'signal', `SNR with signal ${fmt(s)} and noise ${fmt(n)}${voltage ? ' (amplitudes)' : ' (powers)'}`, `${fmt(db, 8)} dB`, { value: db, lines: [{ label: 'Ratio', display: fmt(s / n, 8) }] });
  }
  if ((m = /\b(?:power\s+|voltage\s+|amplitude\s+)?(?:ratio|gain|factor)\s*(?:of)?\s*([\d.]+(?:e-?\d+)?)\s*(?:to|in|as)\s*(?:db|decibels)/i.exec(input)) || (m = /([\d.]+(?:e-?\d+)?)\s*(?:times|x|×)?\s*(?:power\s+|voltage\s+|amplitude\s+)?(?:ratio|gain)?\s*(?:to|in|as)\s*(?:db|decibels)\b/i.exec(input))) {
    const r = Number(m[1]);
    if (!(r > 0)) refuse('Ratio must be positive');
    const db = (voltage ? 20 : 10) * Math.log10(r);
    return answer(input, 'signal', `${voltage ? 'Voltage' : 'Power'} ratio ${fmt(r)} in decibels`, `${fmt(db, 8)} dB`, { value: db, lines: [{ label: 'Formula', display: voltage ? 'dB = 20·log₁₀(V₁/V₂)' : 'dB = 10·log₁₀(P₁/P₂)' }] });
  }
  return null;
}

function bandlimitedSamples(input: string): Result {
  // "sample sin(2 pi 3 t) at fs = 8 for 8 samples" → sampled values.
  const m = /\bsample\s+(.+?)\s+(?:at|with)\s+(?:fs\s*=\s*)?([\d.]+)\s*(?:hz)?\s*(?:for\s+(\d+)\s+samples)?/i.exec(input);
  if (!m) return null;
  const f = compile(m[1]!, ['t']);
  const fs = Number(m[2]);
  const N = Number(m[3] ?? 8);
  if (N > 1024) refuse('Up to 1024 samples');
  const xs = Array.from({ length: N }, (_, n) => f(n / fs));
  return answer(input, 'signal', `Samples of ${m[1]} at ${fmt(fs)} Hz`, `[${xs.map((v) => fmt(tidy(v), 6)).join(', ')}]`, { table: { columns: ['n', 't = n/fs', 'x[n]'], rows: xs.map((v, n) => [String(n), fmt(n / fs, 6), fmt(tidy(v), 8)]) } });
}

export const signalHandlers = [fourier, convolution, correlation, movingAverage, fir, nyquist, decibels, bandlimitedSamples];
