import { NUM, bytesText, duration, fail, named, need, num, ofDim, res, show, withUnit, type Ctx, type Handler } from './util';

const X = 'computing' as const;

function parseInt2(raw: string): bigint | null {
  const t = raw.trim().toLowerCase().replace(/_/g, '');
  const neg = t.startsWith('-');
  const b = neg ? t.slice(1) : t;
  let v: bigint;
  try {
    if (/^0x[0-9a-f]+$/.test(b)) v = BigInt(b);
    else if (/^0b[01]+$/.test(b)) v = BigInt(b);
    else if (/^0o[0-7]+$/.test(b)) v = BigInt(b);
    else if (/^\d+$/.test(b)) v = BigInt(b);
    else return null;
  } catch {
    return null;
  }
  return neg ? -v : v;
}
const bin = (v: bigint, bits: number) => {
  const s = (v & ((1n << BigInt(bits)) - 1n)).toString(2).padStart(bits, '0');
  return s.replace(/(.{4})(?=.)/g, '$1 ');
};

// ─────────────── two's complement ───────────────
const twos: Handler = (c) => {
  if (!/two'?s.?complement|2'?s.?complement|signed (?:binary|integer|\d+.?bit)|ones'? complement|one'?s complement/.test(c.s)) return null;
  const bitsM = /(\d+)\s*-?\s*bits?\b/.exec(c.s);
  const ones = /ones'? complement|one'?s complement/.test(c.s);
  const binLit = /\b(?:0b)?([01]{4,64})\b/.exec(c.s.replace(/(\d+)\s*-?\s*bits?\b/, ''));
  const decLit = /(?<![\w.])(-?\d+)(?![\w.])/.exec(c.s.replace(/(\d+)\s*-?\s*bits?\b/, ''));
  // Binary → decimal ("11111011 two's complement to decimal")
  if (binLit && (/to decimal|value|as (?:a )?(?:signed|decimal)|interpret|means?/.test(c.s) || !decLit || binLit[1]!.length >= 8)) {
    const s = binLit[1]!;
    const bits = bitsM ? Number(bitsM[1]) : s.length;
    const u = BigInt('0b' + s.padStart(bits, '0'));
    const top = 1n << BigInt(bits - 1);
    const v = ones ? (u & top ? -((~u) & ((1n << BigInt(bits)) - 1n)) : u) : u & top ? u - (1n << BigInt(bits)) : u;
    return res(c, { kind: X, expression: `${s} as a ${bits}-bit ${ones ? "ones'" : "two's"}-complement number`, value: Number(v), display: v.toString(), lines: [['Unsigned value', u.toString()], ['Sign bit', u & top ? '1 (negative)' : '0 (non-negative)'], ['Range', ones ? `−${top - 1n} … ${top - 1n}` : `−${top} … ${top - 1n}`]] });
  }
  if (!decLit) return need(c, X, "Which number? e.g. \"-5 in two's complement 8 bit\"");
  const v = BigInt(decLit[1]!);
  const bits = bitsM ? Number(bitsM[1]) : v >= -128n && v <= 127n ? 8 : v >= -32768n && v <= 32767n ? 16 : 32;
  const top = 1n << BigInt(bits - 1);
  if (v < -top || v > top - 1n) return fail(c, X, `${v} doesn't fit in ${bits}-bit two's complement (range −${top} … ${top - 1n})`);
  const enc = ones && v < 0n ? ~(-v) & ((1n << BigInt(bits)) - 1n) : v & ((1n << BigInt(bits)) - 1n);
  const notes = bitsM ? [] : [`${bits} bits chosen as the smallest common width; say "16 bit" to change`];
  const lines: [string, string][] = [['Hex', '0x' + enc.toString(16).toUpperCase().padStart(bits / 4, '0')], ['Range', `−${top} … ${top - 1n}`]];
  if (v < 0n && !ones) lines.unshift(['Method', `invert ${bin(-v, bits)} → ${bin(~(-v), bits)}, add 1`]);
  return res(c, { kind: X, expression: `${v} in ${bits}-bit ${ones ? "ones'" : "two's"} complement`, display: bin(enc, bits), value: Number(v), lines, notes });
};

// ─────────────── bitwise ───────────────
const INT = String.raw`-?(?:0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d+)`;
const bitwise: Handler = (c) => {
  const m = new RegExp(String.raw`^(?:what is |compute |calculate )?(${INT})\s*(and|or|xor|nand|nor|&|\||\^|<<|>>>?|left shift(?:ed)?(?: by)?|right shift(?:ed)?(?: by)?|shifted (?:left|right) by)\s*(${INT})(?:\s+(?:in )?(binary|hex|decimal))?$`, 'i').exec(c.s);
  const not = new RegExp(String.raw`^(?:bitwise )?(?:not|~)\s*(${INT})(?:\s*(?:in|with|using|as)?\s*(\d+)\s*-?\s*bits?)?$`).exec(c.s) ?? new RegExp(String.raw`^(?:bitwise )?(?:not|~)\s*(${INT})\s*\((\d+)\s*-?\s*bits?\)$`).exec(c.s);
  if (not) {
    const v = parseInt2(not[1]!);
    if (v === null) return null;
    const bits = not[2] ? Number(not[2]) : 8;
    const r = ~v & ((1n << BigInt(bits)) - 1n);
    return res(c, { kind: X, expression: `Bitwise NOT of ${not[1]} (${bits}-bit)`, display: r.toString(), value: Number(r), lines: [['Binary', `${bin(v, bits)} → ${bin(r, bits)}`], ['Signed (two’s complement)', String(r >= 1n << BigInt(bits - 1) ? r - (1n << BigInt(bits)) : r)]], notes: not[2] ? [] : ['8-bit width assumed'] });
  }
  if (!m || !/and|or|xor|nand|nor|&|\||\^|<<|>>|shift/.test(m[2]!)) return null;
  // "and" between plain decimals is ambiguous with English unless the user said bitwise or used non-decimal literals.
  const a = parseInt2(m[1]!);
  const b = parseInt2(m[3]!);
  if (a === null || b === null) return null;
  const op = m[2]!.toLowerCase();
  let r: bigint;
  let sym: string;
  if (op === 'and' || op === '&') [r, sym] = [a & b, 'AND'];
  else if (op === 'or' || op === '|') [r, sym] = [a | b, 'OR'];
  else if (op === 'xor' || op === '^') [r, sym] = [a ^ b, 'XOR'];
  else if (op === 'nand') [r, sym] = [~(a & b) & 0xffn, 'NAND (8-bit)'];
  else if (op === 'nor') [r, sym] = [~(a | b) & 0xffn, 'NOR (8-bit)'];
  else if (/<<|left/.test(op)) [r, sym] = [a << b, '<<'];
  else [r, sym] = [a >> b, '>>'];
  if (op === '^' && !/0x|0b|bitwise|xor/.test(c.s) && /^\d+$/.test(m[1]!) && /^\d+$/.test(m[3]!)) return null; // 2^3 is a power
  const width = Math.max(8, Math.ceil(Math.max(a.toString(2).length, b.toString(2).length, r.toString(2).length) / 4) * 4);
  const lines: [string, string][] = [];
  if (a >= 0n && b >= 0n && r >= 0n && !/<<|>>|shift/.test(op)) lines.push(['', `  ${bin(a, width)}`], [sym, `  ${bin(b, width)}`], ['=', `  ${bin(r, width)}`]);
  else lines.push(['Binary', r >= 0n ? r.toString(2) : '-' + (-r).toString(2)]);
  lines.push(['Hex', (r < 0n ? '-0x' + (-r).toString(16) : '0x' + r.toString(16)).toUpperCase().replace('0X', '0x')]);
  return res(c, { kind: X, expression: `${m[1]} ${sym} ${m[3]}`, display: m[4] === 'hex' ? '0x' + r.toString(16).toUpperCase() : m[4] === 'binary' ? '0b' + r.toString(2) : r.toString(), value: Number(r), lines, notes: /<<|left/.test(op) ? [`Same as × 2^${b}`] : />>|right/.test(op) ? [`Same as ÷ 2^${b}, rounded down (arithmetic shift)`] : [] });
};

// ─────────────── Boolean logic ───────────────
type BNode = { t: 'var'; n: string } | { t: 'const'; v: boolean } | { t: 'not'; a: BNode } | { t: 'bin'; op: 'and' | 'or' | 'xor' | 'imp' | 'iff' | 'nand' | 'nor'; a: BNode; b: BNode };
function parseBool(src: string): BNode | null {
  const toks = src
    .replace(/¬|!|~/g, ' not ')
    .replace(/∧|&&|&|·|\*/g, ' and ')
    .replace(/∨|\|\||\||\+/g, ' or ')
    .replace(/⊕|\^/g, ' xor ')
    .replace(/<->|<=>|↔|⇔/g, ' iff ')
    .replace(/->|=>|→|⇒/g, ' imp ')
    .replace(/([()])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x.toLowerCase().replace(/^implies$/, 'imp').replace(/^iff$/, 'iff'));
  let i = 0;
  const prec: Record<string, number> = { iff: 1, imp: 2, or: 3, nor: 3, xor: 4, and: 5, nand: 5 };
  function primary(): BNode | null {
    const t = toks[i++];
    if (t === undefined) return null;
    if (t === 'not') {
      const a = primary();
      return a ? { t: 'not', a } : null;
    }
    if (t === '(') {
      const e = expr(0);
      if (toks[i++] !== ')') return null;
      return e;
    }
    if (t === '1' || t === 'true' || t === 't') return { t: 'const', v: true };
    if (t === '0' || t === 'false' || t === 'f') return { t: 'const', v: false };
    if (/^[a-z]\w{0,2}$/.test(t) && !(t in prec)) return { t: 'var', n: t.toUpperCase() };
    return null;
  }
  function expr(min: number): BNode | null {
    let a = primary();
    if (!a) return null;
    for (;;) {
      const op = toks[i];
      if (!op || !(op in prec) || prec[op]! < min) break;
      i++;
      const b = expr(op === 'imp' ? prec[op]! : prec[op]! + 1);
      if (!b) return null;
      a = { t: 'bin', op: op as 'and', a, b };
    }
    return a;
  }
  const e = expr(0);
  return e && i === toks.length ? e : null;
}
function evalB(n: BNode, env: Map<string, boolean>): boolean {
  switch (n.t) {
    case 'var':
      return env.get(n.n)!;
    case 'const':
      return n.v;
    case 'not':
      return !evalB(n.a, env);
    case 'bin': {
      const a = evalB(n.a, env);
      const b = evalB(n.b, env);
      return { and: a && b, or: a || b, xor: a !== b, imp: !a || b, iff: a === b, nand: !(a && b), nor: !(a || b) }[n.op];
    }
  }
}
function varsOf(n: BNode, s = new Set<string>()): Set<string> {
  if (n.t === 'var') s.add(n.n);
  if (n.t === 'not') varsOf(n.a, s);
  if (n.t === 'bin') {
    varsOf(n.a, s);
    varsOf(n.b, s);
  }
  return s;
}
const boolean: Handler = (c) => {
  const m = /^(?:make |show |build |give me )?(?:a |the )?(?:truth table|tautology|contradiction|satisfiable|is .+ (?:a tautology|satisfiable|a contradiction)|evaluate|boolean|logic)\s*(?:for|of)?\s*:?\s*(.+?)(?:\s+(?:a tautology|satisfiable|a contradiction))?(?:\s+(?:with|where|for)\s+(.+))?$/i.exec(c.t);
  if (!m || !/truth table|tautolog|contradiction|satisfiable|boolean|logic|evaluate/.test(c.s)) return null;
  let src = m[1]!.replace(/^is\s+/i, '');
  if (/evaluate/.test(c.s) && !/\b(?:and|or|not|xor)\b|[∧∨¬&|!]/.test(src)) return null;
  const assign = m[2];
  const tree = parseBool(src);
  if (!tree) return /truth table|tautolog|boolean|logic/.test(c.s) ? fail(c, X, 'I couldn’t read that Boolean expression; use variables like A, B with and/or/not/xor/implies and parentheses') : null;
  const vars = [...varsOf(tree)].sort();
  if (vars.length > 6) return fail(c, X, 'Truth tables are limited to 6 variables (64 rows)');
  if (assign) {
    const env = new Map<string, boolean>();
    for (const a of assign.matchAll(/([a-z]\w{0,2})\s*=\s*(1|0|true|false|t|f)\b/gi)) env.set(a[1]!.toUpperCase(), /^(?:1|true|t)$/i.test(a[2]!));
    if (vars.every((v) => env.has(v))) {
      const r = evalB(tree, env);
      return res(c, { kind: X, expression: `Evaluate ${src} with ${[...env].map(([k, v]) => `${k}=${v ? 1 : 0}`).join(', ')}`, display: r ? '1 (true)' : '0 (false)', value: r ? 1 : 0 });
    }
  }
  const rows: string[][] = [];
  const minterms: number[] = [];
  for (let k = 0; k < 1 << vars.length; k++) {
    const env = new Map(vars.map((v, i) => [v, Boolean((k >> (vars.length - 1 - i)) & 1)]));
    const r = evalB(tree, env);
    if (r) minterms.push(k);
    rows.push([...vars.map((v) => (env.get(v) ? '1' : '0')), r ? '1' : '0']);
  }
  const total = 1 << vars.length;
  const kind = minterms.length === total ? 'Tautology (always true)' : minterms.length === 0 ? 'Contradiction (never true)' : `${minterms.length} of ${total} rows true`;
  const sop = minterms.map((k) => vars.map((v, i) => ((k >> (vars.length - 1 - i)) & 1 ? v : `¬${v}`)).join('∧')).join(' ∨ ');
  return res(c, { kind: X, expression: `Truth table for ${src}`, display: kind, value: minterms.length, table: { columns: [...vars, src.length > 24 ? 'Result' : src], rows }, lines: [['Minterms Σm', `(${minterms.join(', ')})`], ...(minterms.length && minterms.length < total && minterms.length <= 8 ? [['Canonical SOP', sop] as [string, string]] : [])] });
};

// ─────────────── IEEE 754 ───────────────
const ieee: Handler = (c) => {
  if (!/ieee|floating.?point|float32|float64|single precision|double precision|as (?:a )?(?:float|double)\b|\bfloat\b.*\bbits\b/.test(c.s)) return null;
  const hex = /\b0x([0-9a-f]{8}|[0-9a-f]{16})\b/.exec(c.s);
  const dbl = /double|64|float64/.test(c.s) || (hex !== null && hex[1]!.length === 16);
  const buf = new DataView(new ArrayBuffer(8));
  if (hex && /to decimal|as (?:a )?(?:float|double)|value|decode|means?/.test(c.s)) {
    const h = hex[1]!;
    if (h.length === 16) buf.setBigUint64(0, BigInt('0x' + h));
    else buf.setUint32(0, parseInt(h, 16));
    const v = h.length === 16 ? buf.getFloat64(0) : buf.getFloat32(0);
    return res(c, { kind: X, expression: `0x${h.toUpperCase()} as IEEE-754 ${h.length === 16 ? 'double' : 'single'}`, display: String(v), value: v });
  }
  const m = new RegExp(String.raw`(-?${NUM}|-?inf(?:inity)?|nan)`).exec(c.s.replace(/ieee[ -]?754|float32|float64|\b(?:32|64)\b(?:.?bits?)?/g, ''));
  if (!m) return need(c, X, 'Which number should I encode?');
  const x = /inf/.test(m[1]!) ? (m[1]!.startsWith('-') ? -Infinity : Infinity) : /nan/.test(m[1]!) ? NaN : num(m[1]!);
  let bits: string;
  let stored: number;
  if (dbl) {
    buf.setFloat64(0, x);
    bits = buf.getBigUint64(0).toString(2).padStart(64, '0');
    stored = buf.getFloat64(0);
  } else {
    buf.setFloat32(0, x);
    bits = buf.getUint32(0).toString(2).padStart(32, '0');
    stored = buf.getFloat32(0);
  }
  const eb = dbl ? 11 : 8;
  const bias = dbl ? 1023 : 127;
  const sign = bits[0]!;
  const exp = bits.slice(1, 1 + eb);
  const man = bits.slice(1 + eb);
  const e = parseInt(exp, 2);
  const hexStr = '0x' + BigInt('0b' + bits).toString(16).toUpperCase().padStart(dbl ? 16 : 8, '0');
  const exact = stored === x;
  return res(c, {
    kind: X,
    expression: `${m[1]} as IEEE-754 ${dbl ? 'double (64-bit)' : 'single (32-bit)'}`,
    display: hexStr,
    lines: [
      ['Sign', `${sign} (${sign === '1' ? 'negative' : 'positive'})`],
      ['Exponent', `${exp} = ${e}${e === 0 ? ' (subnormal/zero)' : e === (1 << eb) - 1 ? ' (inf/NaN)' : ` → 2^${e - bias} (bias ${bias})`}`],
      ['Mantissa', man],
      ['Bits', `${sign} ${exp} ${man}`],
      ['Stored value', dbl ? String(stored) : stored.toPrecision(9)],
      ['Exact?', exact ? 'yes' : `no (error ${show(stored - x, 3)})`],
    ],
    notes: exact ? [] : [`${m[1]} has no finite binary expansion, so the nearest representable value is stored`],
  });
};

// ─────────────── transfer time, bandwidth ───────────────
const transfer: Handler = (c) => {
  const data = ofDim(c, 'data');
  const rates = ofDim(c, 'rate');
  const time = ofDim(c, 'time');
  if (!data.length || (!rates.length && !time.length)) return null;
  if (!/download|upload|transfer|send|copy|stream|take|how long|bandwidth|throughput|speed|rate|at \d|over\b|link|connection/.test(c.s)) return null;
  const d = data[0]!;
  if (rates.length) {
    const r = rates[0]!;
    const eff = /overhead|efficien/.test(c.s) ? named(c, 'overhead|efficiency') : null;
    const t = d.v / r.v;
    return res(c, { kind: X, expression: `Transfer ${d.raw} at ${r.raw}`, value: t, unit: 's', unitWords: 'seconds', display: duration(t), formula: 'time = size (bits) / rate (bits/s)', lines: [['Size', `${show(d.v)} bits = ${bytesText(d.v / 8)}`], ['Rate', `${show(r.v)} bit/s = ${show(r.v / 8e6)} MB/s`], ['Seconds', show(t)]], notes: [`Ideal: no protocol overhead${eff !== null ? '' : ' (real links often lose 5–10%)'}`, /\b[KMGT]B\b/.test(c.t) && /\b[kKMGT]bps\b|bit/.test(c.t) ? 'B = bytes (8 bits), b = bits; decimal prefixes (1 GB = 10⁹ bytes)' : 'Decimal prefixes (1 GB = 10⁹ bytes); GiB = 2³⁰'] });
  }
  const t = time[0]!;
  const r = d.v / t.v;
  return res(c, { kind: X, expression: `Bandwidth to move ${d.raw} in ${t.raw}`, value: r / 1e6, unit: 'Mbps', unitWords: 'megabits per second', formula: 'rate = size / time', lines: [['In MB/s', show(r / 8e6) + ' MB/s'], ['In Gbps', show(r / 1e9) + ' Gbps']], notes: ['Ideal, no overhead'] });
};

const dataSizes: Handler = (c) => {
  if (!/kb vs kib|kib vs kb|difference between (?:kb|mb|gb|tb) and|(?:kb|mb|gb|tb) (?:vs|versus) (?:kib|mib|gib|tib)|why (?:does|is) (?:my )?(?:\d+\s*)?(?:gb|tb)/.test(c.s)) return null;
  const d = ofDim(c, 'data')[0];
  const bytes = d ? d.v / 8 : 1e12;
  return res(c, { kind: X, expression: 'Decimal (SI) vs binary (IEC) data units', display: `1 KB = 1,000 bytes; 1 KiB = 1,024 bytes`, lines: [['1 MB vs 1 MiB', '1,000,000 vs 1,048,576 bytes'], ['1 GB vs 1 GiB', '10⁹ vs 1,073,741,824 bytes (7.4% larger)'], ['1 TB vs 1 TiB', '10¹² vs 1,099,511,627,776 bytes (10% larger)'], [d ? d.raw : '1 TB', bytesText(bytes)]], notes: ['Drive makers use decimal units; many operating systems report binary units, so a "1 TB" drive shows as about 931 GiB'] });
};

// ─────────────── Big-O ───────────────
const CLASSES: [RegExp, string, (n: number) => number][] = [
  [/^1$/, 'O(1)', () => 1], [/^log\s*\(?\s*log\s*n\s*\)?$/, 'O(log log n)', (n) => Math.log2(Math.log2(n))], [/^log\s*n$|^logn$|^lg\s*n$/, 'O(log n)', (n) => Math.log2(n)], [/^sqrt\s*\(?n\)?$|^√n$|^n\^0\.5$/, 'O(√n)', (n) => Math.sqrt(n)],
  [/^n$/, 'O(n)', (n) => n], [/^n\s*\*?\s*log\s*n$|^nlogn$|^n lg n$/, 'O(n log n)', (n) => n * Math.log2(n)], [/^n\^?2$|^n²$/, 'O(n²)', (n) => n * n], [/^n\^?2\s*\*?\s*log\s*n$/, 'O(n² log n)', (n) => n * n * Math.log2(n)], [/^n\^?3$|^n³$/, 'O(n³)', (n) => n ** 3],
  [/^2\^n$|^2ⁿ$/, 'O(2ⁿ)', (n) => 2 ** n], [/^3\^n$/, 'O(3ⁿ)', (n) => 3 ** n], [/^n!$|^n factorial$/, 'O(n!)', (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }], [/^n\^n$/, 'O(nⁿ)', (n) => n ** n],
];
const RANK = CLASSES.map((x) => x[1]);
const bigO: Handler = (c) => {
  if (!/\bo\s*\(|big.?o|complexity|grows faster|faster growing|asymptotic/.test(c.s)) return null;
  const found: (typeof CLASSES)[number][] = [];
  const cands = [...c.s.matchAll(/o\s*\(\s*([^)]*(?:\([^)]*\))?[^)]*)\)/g)].map((m) => m[1]!.trim());
  if (!cands.length) {
    const m = /(?:compare|between|faster|vs|versus)\s+(.+)$/.exec(c.s);
    if (m) cands.push(...m[1]!.split(/\s*(?:,|\bvs\.?\b|\bversus\b|\band\b|\bor\b)\s*/).map((x) => x.replace(/\s*for n.*$/, '').trim()));
  }
  for (const cd of cands) {
    const k = CLASSES.find(([re]) => re.test(cd.replace(/\s+/g, ' ').replace(/·/g, '*')));
    if (k && !found.includes(k)) found.push(k);
  }
  if (found.length < 1) return null;
  const n = named(c, 'n') ?? (/(?:for|at|with) n\s*=\s*([\d,e.]+)/.exec(c.s) ? num(/(?:for|at|with) n\s*=\s*([\d,e.]+)/.exec(c.s)![1]!) : null);
  found.sort((a, b) => RANK.indexOf(a[1]) - RANK.indexOf(b[1]));
  const rows = found.map((k) => [k[1], n !== null ? show(k[2](n), 4) : '']);
  const fastest = found[found.length - 1]!;
  return res(c, {
    kind: X,
    expression: `Growth-rate comparison${n !== null ? ` at n = ${show(n)}` : ''}`,
    display: found.length > 1 ? `${fastest[1]} grows fastest` : `${found[0]![1]}`,
    table: { columns: n !== null ? ['Class', `Operations at n = ${show(n)}`] : ['Class (slowest → fastest growth)', ''], rows },
    lines: [['Order', found.map((k) => k[1]).join(' < ')]],
    notes: ['Constant factors and lower-order terms are ignored; log base 2 for counts'],
  });
};

// ─────────────── CIDR / subnets ───────────────
const ipToInt = (ip: string): number | null => {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
};
const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const maskOf = (p: number) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
const IP = String.raw`(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`;
const subnet: Handler = (c) => {
  const cidr = new RegExp(String.raw`${IP}\s*\/\s*(\d{1,2})\b`).exec(c.s);
  const maskQ = new RegExp(String.raw`(?:subnet )?mask (?:for |of )?\/(\d{1,2})|^\/(\d{1,2})\s*(?:mask|subnet|netmask|hosts?)|(?:how many )?(?:usable )?hosts? (?:in|for|on) (?:a )?\/(\d{1,2})|\/(\d{1,2}) (?:has how many|hosts)`).exec(c.s);
  const dotted = new RegExp(String.raw`${IP}\s*(?:to|as|in)\s*(?:cidr|prefix)|(?:cidr|prefix) (?:for|of) ${IP}`).exec(c.s);
  if (dotted) {
    const n = ipToInt(dotted[1] ?? dotted[2]!);
    if (n === null) return null;
    const p = n.toString(2).replace(/0+$/, '').length;
    if (maskOf(p) !== n) return fail(c, X, `${dotted[1] ?? dotted[2]} isn't a valid subnet mask (its 1-bits aren't contiguous)`);
    return res(c, { kind: X, expression: `Mask ${dotted[1] ?? dotted[2]} as a prefix`, display: `/${p}`, value: p, lines: [['Usable hosts', show(p >= 31 ? 2 ** (32 - p) : 2 ** (32 - p) - 2)]] });
  }
  if (maskQ && !cidr) {
    const p = Number(maskQ[1] ?? maskQ[2] ?? maskQ[3] ?? maskQ[4]);
    if (p > 32) return fail(c, X, 'IPv4 prefixes run from /0 to /32');
    const hosts = p >= 31 ? 2 ** (32 - p) : 2 ** (32 - p) - 2;
    return res(c, { kind: X, expression: `/${p} subnet`, display: /hosts?/.test(c.s) ? `${hosts.toLocaleString('en-US')} usable hosts` : intToIp(maskOf(p)), value: /hosts?/.test(c.s) ? hosts : p, lines: [['Subnet mask', intToIp(maskOf(p))], ['Wildcard', intToIp(~maskOf(p) >>> 0)], ['Addresses', (2 ** (32 - p)).toLocaleString('en-US')], ['Usable hosts', hosts.toLocaleString('en-US')]], notes: p >= 31 ? ['/31 (point-to-point, RFC 3021) and /32 have no network/broadcast reservation'] : [] });
  }
  if (!cidr) return null;
  const ip = ipToInt(cidr[1]!);
  const p = Number(cidr[2]);
  if (ip === null || p > 32) return fail(c, X, `${cidr[0]} isn't a valid IPv4 CIDR block`);
  const mask = maskOf(p);
  const net = (ip & mask) >>> 0;
  const bc = (net | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - p);
  const hosts = p >= 31 ? total : total - 2;
  const check = new RegExp(String.raw`(?:is|does)\s+${IP}\s+(?:in|inside|belong to|part of)|${IP}\s+(?:in|inside)\s+${IP}\s*\/`).exec(c.s);
  if (check) {
    const t = ipToInt(check[1] ?? check[2]!);
    if (t === null) return null;
    const inside = ((t & mask) >>> 0) === net;
    return res(c, { kind: X, expression: `Is ${check[1] ?? check[2]} in ${intToIp(net)}/${p}?`, display: inside ? 'Yes' : 'No', lines: [['Range', `${intToIp(net)} – ${intToIp(bc)}`]] });
  }
  const split = /(?:split|divide|break)\b.*?into\s+(\d+)\s*(?:equal\s+)?(?:subnets|networks|parts|blocks)/.exec(c.s);
  if (split) {
    const k = Number(split[1]);
    const extra = Math.ceil(Math.log2(k));
    const np = p + extra;
    if (np > 32) return fail(c, X, `A /${p} can't be split into ${k} subnets`);
    const size = 2 ** (32 - np);
    const rows = Array.from({ length: Math.min(2 ** extra, 64) }, (_, i) => {
      const s = net + i * size;
      return [`${intToIp(s)}/${np}`, np >= 31 ? intToIp(s) : intToIp(s + 1), np >= 31 ? intToIp(s + size - 1) : intToIp(s + size - 2), intToIp(s + size - 1)];
    });
    return res(c, { kind: X, expression: `Split ${intToIp(net)}/${p} into ${k} subnets`, display: `${2 ** extra} × /${np}`, table: { columns: ['Subnet', 'First host', 'Last host', 'Broadcast'], rows }, lines: [['Hosts per subnet', String(np >= 31 ? size : size - 2)]], notes: 2 ** extra !== k ? [`${k} isn't a power of two, so ${2 ** extra} subnets are made`] : [] });
  }
  const notes: string[] = [];
  if (net !== ip) notes.push(`${cidr[1]} isn't the network address; the block is ${intToIp(net)}/${p}`);
  const first = p >= 31 ? net : net + 1;
  const last = p >= 31 ? bc : bc - 1;
  const priv = (net >>> 24 === 10) || (net >>> 20 === (172 << 4) + 1) || (net >>> 16 === (192 << 8) + 168);
  if (priv) notes.push('Private address space (RFC 1918)');
  return res(c, {
    kind: X,
    expression: `${intToIp(net)}/${p}`,
    display: `${intToIp(net)} – ${intToIp(bc)}`,
    value: hosts,
    lines: [['Network', intToIp(net)], ['Broadcast', intToIp(bc)], ['First usable', intToIp(first)], ['Last usable', intToIp(last)], ['Usable hosts', hosts.toLocaleString('en-US')], ['Subnet mask', intToIp(mask)], ['Wildcard', intToIp(~mask >>> 0)]],
    notes,
  });
};

// ─────────────── characters ───────────────
function utf8(cp: number): number[] {
  return [...new TextEncoder().encode(String.fromCodePoint(cp))];
}
const chars: Handler = (c) => {
  const code = /^(?:what is (?:the )?)?(?:ascii|unicode|utf-?8|utf-?16|code ?point|char(?:acter)? code|key ?code)\s*(?:code|value|bytes|encoding|number|point)?\s*(?:of|for)\s+(?:the\s+)?(?:character\s+|letter\s+|symbol\s+)?['"“]?(.+?)['"”]?$/i.exec(c.t.trim());
  const back = /^(?:what is |which )?(?:character|char|letter|symbol)\s*(?:is\s+)?(?:for\s+)?(?:ascii|code|unicode|code ?point)?\s*(u\+[0-9a-f]{4,6}|0x[0-9a-f]+|\d+)$|^(?:ascii|unicode|chr)\s*\(?\s*(u\+[0-9a-f]{4,6}|0x[0-9a-f]+|\d+)\s*\)?\s*(?:to char(?:acter)?)?$|^(u\+[0-9a-f]{4,6})$/i.exec(c.t.trim());
  if (back) {
    const raw = (back[1] ?? back[2] ?? back[3])!;
    const cp = /^u\+/i.test(raw) ? parseInt(raw.slice(2), 16) : raw.startsWith('0x') ? parseInt(raw.slice(2), 16) : Number(raw);
    if (!(cp >= 0 && cp <= 0x10ffff)) return fail(c, X, 'Code points run from 0 to U+10FFFF');
    const ch = String.fromCodePoint(cp);
    const ctrl = cp < 32 || cp === 127;
    const NAMES: Record<number, string> = { 0: 'NUL', 7: 'BEL', 8: 'BS', 9: 'TAB', 10: 'LF (newline)', 13: 'CR', 27: 'ESC', 32: 'space', 127: 'DEL' };
    return res(c, { kind: X, expression: `Character for code ${raw}`, display: ctrl || cp === 32 ? NAMES[cp] ?? `control character ${cp}` : ch, value: cp, lines: [['Code point', `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`], ['Decimal', String(cp)], ['UTF-8 bytes', utf8(cp).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')]] });
  }
  if (!code) return null;
  const s = code[1]!;
  const cps = [...s].map((ch) => ch.codePointAt(0)!);
  if (!cps.length || cps.length > 32) return null;
  const rows = cps.map((cp) => [String.fromCodePoint(cp) === ' ' ? '␠' : String.fromCodePoint(cp), String(cp), `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, '0x' + cp.toString(16).toUpperCase(), cp < 128 ? cp.toString(2).padStart(8, '0') : '', utf8(cp).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')]);
  const ascii = /ascii/.test(c.s);
  if (ascii && cps.some((cp) => cp > 127)) return fail(c, X, `“${s}” isn't ASCII (code points above 127); ask for its Unicode code point instead`);
  if (cps.length === 1) {
    const cp = cps[0]!;
    return res(c, { kind: X, expression: `${ascii ? 'ASCII' : 'Unicode'} code of “${s}”`, display: ascii || cp < 128 ? String(cp) : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, value: cp, lines: [['Decimal', String(cp)], ['Hex', '0x' + cp.toString(16).toUpperCase()], ['Code point', `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`], ...(cp < 256 ? [['Binary', cp.toString(2).padStart(8, '0')] as [string, string]] : []), ['UTF-8 bytes', rows[0]![5]!], ['UTF-16', [...String.fromCodePoint(cp)].map(() => '').length ? Array.from({ length: String.fromCodePoint(cp).length }, (_, i) => String.fromCodePoint(cp).charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join(' ') : '']] });
  }
  return res(c, { kind: X, expression: `${ascii ? 'ASCII' : 'Unicode'} codes of “${s}”`, display: cps.join(' '), table: { columns: ['Char', 'Dec', 'Code point', 'Hex', 'Binary', 'UTF-8'], rows }, lines: [['UTF-8 length', `${utf8s(s)} bytes`]] });
};
const utf8s = (s: string) => new TextEncoder().encode(s).length;

// ─────────────── parity, checksums, hashes ───────────────
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function sha256(msg: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = msg.length;
  const padded = new Uint8Array(Math.ceil((l + 9) / 64) * 64);
  padded.set(msg);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (l * 8) >>> 0);
  dv.setUint32(padded.length - 8, Math.floor((l * 8) / 2 ** 32));
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15]!, 7) ^ rotr(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
      const s1 = rotr(W[i - 2]!, 17) ^ rotr(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, cc, d, e, f, g, h] = H as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const mj = (a! & b!) ^ (a! & cc!) ^ (b! & cc!);
      const t2 = (S0 + mj) >>> 0;
      [h, g, f, e, d, cc, b, a] = [g, f, e, (d! + t1) >>> 0, cc, b, a, (t1 + t2) >>> 0];
    }
    H[0] = (H[0]! + a!) >>> 0;
    H[1] = (H[1]! + b!) >>> 0;
    H[2] = (H[2]! + cc!) >>> 0;
    H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0;
    H[5] = (H[5]! + f!) >>> 0;
    H[6] = (H[6]! + g!) >>> 0;
    H[7] = (H[7]! + h!) >>> 0;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}
const quoted = (c: Ctx) => /["“'‘](.*)["”'’]\s*$/.exec(c.t)?.[1] ?? /\bof\s+(.+)$/.exec(c.t)?.[1];
const checks: Handler = (c) => {
  if (/\bparity\b/.test(c.s)) {
    const m = /\b([01]{2,64})\b/.exec(c.s);
    if (!m) return need(c, X, 'Which bit string?');
    const ones = [...m[1]!].filter((b) => b === '1').length;
    const odd = /\bodd\b/.test(c.s);
    if (!odd && !/\beven\b/.test(c.s)) return need(c, X, 'Even or odd parity?');
    const bit = odd ? (ones % 2 === 0 ? 1 : 0) : ones % 2;
    return res(c, { kind: X, expression: `${odd ? 'Odd' : 'Even'} parity bit for ${m[1]}`, display: String(bit), value: bit, lines: [['Number of 1s', String(ones)], ['Transmitted', `${m[1]}${bit}`]] });
  }
  if (/\bluhn\b|credit card check|check digit/.test(c.s)) {
    const m = /(\d[\d ]{1,30}\d)/.exec(c.s);
    if (!m) return need(c, X, 'Which number?');
    const ds = m[1]!.replace(/ /g, '').split('').map(Number);
    const sum = (arr: number[]) => arr.reverse().reduce((s, d, i) => s + (i % 2 === 1 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d), 0);
    if (/check digit|compute|calculate|what digit/.test(c.s)) {
      const s = sum([...ds, 0]);
      const cd = (10 - (s % 10)) % 10;
      return res(c, { kind: X, expression: `Luhn check digit for ${m[1]}`, display: String(cd), value: cd, lines: [['Full number', m[1]!.replace(/ /g, '') + cd]] });
    }
    const ok = sum([...ds]) % 10 === 0;
    return res(c, { kind: X, expression: `Luhn check of ${m[1]}`, display: ok ? 'Valid (passes Luhn)' : 'Invalid (fails Luhn)', lines: [['Digit sum mod 10', String(sum([...ds]) % 10)]], notes: ['Luhn only catches typos; it says nothing about whether a card exists'] });
  }
  if (/\bcrc-?32\b/.test(c.s)) {
    const s = quoted(c);
    if (s === undefined) return need(c, X, 'CRC-32 of what text? Put it in quotes');
    const v = crc32(new TextEncoder().encode(s));
    return res(c, { kind: X, expression: `CRC-32 of “${s}”`, display: '0x' + v.toString(16).toUpperCase().padStart(8, '0'), value: v, lines: [['Decimal', String(v)]], notes: ['CRC-32 (IEEE 802.3, as in zip/PNG) over the UTF-8 bytes'] });
  }
  if (/\bsha-?256\b/.test(c.s)) {
    const s = quoted(c);
    if (s === undefined) return need(c, X, 'SHA-256 of what text? Put it in quotes');
    return res(c, { kind: X, expression: `SHA-256 of “${s}”`, display: sha256(new TextEncoder().encode(s)), notes: ['Over the UTF-8 bytes. A cryptographic hash: tiny input changes scramble the whole output, and it can’t be reversed'] });
  }
  if (/internet checksum|ip checksum|ones'? complement (?:sum|checksum)|16.?bit checksum/.test(c.s)) {
    const words = [...c.s.matchAll(/(?:0x)?([0-9a-f]{4})\b/g)].map((m) => parseInt(m[1]!, 16));
    if (words.length < 2) return need(c, X, 'Give the 16-bit words in hex, e.g. "4500 0073 0000 4000 4011 0000 c0a8 0001 c0a8 00c7"');
    let s = 0;
    for (const w of words) {
      s += w;
      s = (s & 0xffff) + (s >>> 16);
    }
    const ck = ~s & 0xffff;
    return res(c, { kind: X, expression: `Internet checksum of ${words.length} words`, display: '0x' + ck.toString(16).toUpperCase().padStart(4, '0'), value: ck, lines: [["Ones'-complement sum", '0x' + s.toString(16).toUpperCase().padStart(4, '0')]], notes: ['RFC 1071: ones’-complement of the ones’-complement sum'] });
  }
  if (/hash collision|birthday (?:attack|bound|problem)|collision probability/.test(c.s)) {
    const bits = /(\d+)\s*-?\s*bit/.exec(c.s);
    const n = named(c, 'items|keys|values|n|entries|hashes') ?? (/(\d[\d,.e]*)\s*(?:items|keys|values|entries|hashes|objects|files)/.exec(c.s) ? num(/(\d[\d,.e]*)\s*(?:items|keys|values|entries|hashes|objects|files)/.exec(c.s)![1]!) : null);
    if (!bits || n === null) return need(c, X, 'Collision probability needs the hash size in bits and the number of items');
    const N = 2 ** Number(bits[1]);
    const p = -Math.expm1(-(n * (n - 1)) / (2 * N));
    return res(c, { kind: X, expression: `Collision probability: ${show(n)} items in a ${bits[1]}-bit hash`, value: p, display: p < 1e-4 ? show(p, 3) : `${show(p * 100, 4)}%`, formula: 'p ≈ 1 − e^(−n(n−1)/2N)', lines: [['Items for a 50% chance', show(Math.sqrt(2 * N * Math.LN2))]], notes: ['Birthday bound, assuming a uniformly random hash'] });
  }
  if (/what is (?:a )?hash(?:ing| function)?|explain hash|how (?:does|do) hash/.test(c.s)) {
    return res(c, { kind: X, expression: 'Hashing, briefly', display: 'A hash maps any input to a fixed-size value', lines: [['Deterministic', 'same input → same hash'], ['Fixed size', 'e.g. SHA-256 always gives 256 bits'], ['Avalanche', 'a one-bit change flips about half the output bits'], ['One-way (cryptographic)', 'infeasible to recover the input or find collisions'], ['Uses', 'hash tables (fast lookup), checksums, password storage (with salt and a slow hash), digital signatures'], ['Collisions', 'unavoidable in principle; ~50% likely after √(2N ln 2) items (birthday bound)']], notes: ['Try "sha256 of \'abc\'", "crc32 of \'hello\'" or "collision probability 32-bit hash 100000 items"'] });
  }
  return null;
};

export const computing: Handler[] = [subnet, twos, ieee, boolean, bitwise, chars, checks, bigO, dataSizes, transfer];
export { withUnit };
