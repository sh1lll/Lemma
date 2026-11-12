// Classical and toy public-key cryptography: Caesar/ROT13/Atbash/Vigenère/affine, frequency analysis, modular
// exponentiation with steps, RSA, Diffie–Hellman, discrete logs, and SHA-256.
import { answer, egcd, fmt, gcd, modinv, modpow, numbers, refuse, type Line, type Result } from './util';

// English letter frequencies (%), Lewand.
const EN = [8.167, 1.492, 2.782, 4.253, 12.702, 2.228, 2.015, 6.094, 6.966, 0.153, 0.772, 4.025, 2.406, 6.749, 7.507, 1.929, 0.095, 5.987, 6.327, 9.056, 2.758, 0.978, 2.36, 0.15, 1.974, 0.074];

const shiftChar = (c: string, k: number) => {
  const code = c.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + k) % 26 + 26) % 26 + 65);
  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + k) % 26 + 26) % 26 + 97);
  return c;
};
const caesar = (s: string, k: number) => [...s].map((c) => shiftChar(c, k)).join('');

function chiSquared(s: string): number {
  const counts = new Array(26).fill(0) as number[];
  let n = 0;
  for (const c of s.toUpperCase()) {
    const i = c.charCodeAt(0) - 65;
    if (i >= 0 && i < 26) counts[i]!++, n++;
  }
  if (!n) return Infinity;
  return counts.reduce((acc, o, i) => acc + (o - (n * EN[i]!) / 100) ** 2 / ((n * EN[i]!) / 100), 0);
}

function messageText(input: string, after: RegExp): string | null {
  const q = /["“'‘]([^"”'’]+)["”'’]/.exec(input);
  if (q) return q[1]!;
  const m = after.exec(input);
  if (!m) return null;
  let t = input.slice(m.index + m[0].length);
  t = t.replace(/\s*(?:,\s*)?\b(?:with\s+)?(?:shift|key|keyword|k|a|b|by|rotate|rotation)\b\s*(?:=|:|of|is)?\s*[-−]?\w+(?:\s*,?\s*(?:b|and)\s*=?\s*[-−]?\d+)?.*$/i, '');
  t = t.replace(/^\s*(?:the\s+)?(?:message|text|plaintext|ciphertext|word)?\s*:?\s*/i, '');
  return t.trim() || null;
}

function classical(input: string): Result {
  const lc = input.toLowerCase();
  const dec = /\bdecrypt\w*|\bdecod\w*|\bdecipher\w*|\bcrack\w*|\bbreak\b/.test(lc);
  if (/\brot-?13\b/.test(lc)) {
    const t = messageText(input, /\brot-?13\b(?:\s+(?:of|encode|decode))?/i);
    if (!t) refuse('Give some text');
    return answer(input, 'crypto', 'ROT13', caesar(t!, 13), { lines: [{ label: 'Input', display: t! }], notes: ['ROT13 is a Caesar shift of 13; applying it twice gives back the original.'] });
  }
  if (/\batbash\b/.test(lc)) {
    const t = messageText(input, /\batbash\b(?:\s+(?:cipher|of|encrypt|decrypt))*/i);
    if (!t) refuse('Give some text');
    const out = [...t!].map((c) => (/[a-z]/.test(c) ? String.fromCharCode(219 - c.charCodeAt(0)) : /[A-Z]/.test(c) ? String.fromCharCode(155 - c.charCodeAt(0)) : c)).join('');
    return answer(input, 'crypto', 'Atbash cipher (A↔Z, B↔Y, …)', out, { lines: [{ label: 'Input', display: t! }] });
  }
  if (/\bcaesar\b|\bshift cipher\b/.test(lc)) {
    const t = messageText(input, /\b(?:caesar|shift)(?:\s+cipher)?(?:\s+(?:encrypt\w*|decrypt\w*|encod\w*|decod\w*|crack|break|of|on))*\s*/i);
    if (!t) refuse('Give the text, e.g. “caesar encrypt HELLO shift 3”');
    const km = /\b(?:shift|key|k|by|rotate|rotation)\s*(?:=|:|of|is)?\s*([-−]?\d+)/i.exec(input);
    if (km) {
      const k = Number(km[1]!.replace('−', '-'));
      const out = caesar(t!, dec ? -k : k);
      return answer(input, 'crypto', `Caesar ${dec ? 'decrypt' : 'encrypt'} with shift ${k}`, out, { lines: [{ label: 'Input', display: t! }, { label: 'Rule', display: dec ? `each letter moves back ${k}` : `each letter moves forward ${k} (A→${shiftChar('A', k)})` }] });
    }
    // Brute force with a frequency-analysis ranking.
    const all = Array.from({ length: 26 }, (_, k) => ({ k, text: caesar(t!, -k), chi: chiSquared(caesar(t!, -k)) }));
    const best = [...all].sort((a, b) => a.chi - b.chi)[0]!;
    return answer(input, 'crypto', 'Caesar cipher: all 25 shifts, ranked by English letter frequencies', best.text, {
      lines: [{ label: 'Most likely shift', display: String(best.k) }, { label: 'χ² vs English', display: fmt(best.chi, 5) }],
      table: { columns: ['shift', 'decryption', 'χ²'], rows: all.slice(1).map((a) => [String(a.k), a.text.slice(0, 60), fmt(a.chi, 5)]), highlightRow: best.k - 1 },
      notes: ['With only 25 keys, the Caesar cipher falls to brute force; frequency analysis picks the readable one. Short texts can fool the χ² score.'],
    });
  }
  if (/\bvigen[eè]re\b/.test(lc)) {
    const km = /\b(?:key(?:word)?|k)\s*(?:=|:|is)?\s*["']?([A-Za-z]+)["']?/i.exec(input);
    if (!km) refuse('Give a keyword, e.g. “vigenere encrypt ATTACKATDAWN key LEMON”');
    const key = km![1]!.toUpperCase();
    const t = messageText(input.replace(km![0], ''), /\bvigen[eè]re(?:\s+cipher)?(?:\s+(?:encrypt\w*|decrypt\w*|encod\w*|decod\w*|of))*\s*/i);
    if (!t) refuse('Give the text');
    let j = 0;
    const out = [...t!].map((c) => (/[A-Za-z]/.test(c) ? shiftChar(c, (dec ? -1 : 1) * (key.charCodeAt(j++ % key.length) - 65)) : c)).join('');
    let k2 = 0;
    const keyStream = [...t!].map((c) => (/[A-Za-z]/.test(c) ? key[k2++ % key.length] : ' ')).join('');
    return answer(input, 'crypto', `Vigenère ${dec ? 'decrypt' : 'encrypt'} with key ${key}`, out, { lines: [{ label: 'Text', display: t! }, { label: 'Key stream', display: keyStream }, { label: 'Rule', display: dec ? 'Pᵢ = Cᵢ − Kᵢ (mod 26)' : 'Cᵢ = Pᵢ + Kᵢ (mod 26)' }], notes: ['Breaking it: find the key length (Kasiski examination or index of coincidence), then solve each Caesar column by frequency analysis.'] });
  }
  if (/\baffine\b/.test(lc)) {
    const a = Number(/\ba\s*=\s*(\d+)/i.exec(input)?.[1]);
    const b = Number(/\bb\s*=\s*([-−]?\d+)/i.exec(input)?.[1]?.replace('−', '-'));
    if (!Number.isFinite(a) || !Number.isFinite(b)) refuse('Give keys a and b, e.g. “affine encrypt AFFINE CIPHER a=5 b=8”');
    if (gcd(a, 26) !== 1) refuse(`a = ${a} shares a factor with 26, so the cipher can’t be decrypted; use a in {1,3,5,7,9,11,15,17,19,21,23,25}`);
    const inv = Number(modinv(BigInt(a), 26n));
    const t = messageText(input.replace(/\b[ab]\s*=\s*[-−]?\d+/gi, ''), /\baffine(?:\s+cipher)?(?:\s+(?:encrypt\w*|decrypt\w*|of))*\s*/i);
    if (!t) refuse('Give the text');
    const f = (x: number) => (dec ? (inv * (x - b)) % 26 : (a * x + b) % 26);
    const out = [...t!].map((c) => {
      const up = c >= 'A' && c <= 'Z';
      const lo = c >= 'a' && c <= 'z';
      if (!up && !lo) return c;
      const x = c.charCodeAt(0) - (up ? 65 : 97);
      return String.fromCharCode((((f(x) % 26) + 26) % 26) + (up ? 65 : 97));
    }).join('');
    return answer(input, 'crypto', `Affine ${dec ? 'decrypt' : 'encrypt'} (a = ${a}, b = ${b})`, out, { lines: [{ label: 'Text', display: t! }, { label: 'Rule', display: dec ? `x = ${inv}(y − ${b}) mod 26  (${a}⁻¹ ≡ ${inv})` : `y = ${a}x + ${b} mod 26` }] });
  }
  if (/\bfrequency analysis\b|\bletter frequenc\w*\b|\bindex of coincidence\b/.test(lc)) {
    const t = messageText(input, /\b(?:frequency analysis|letter frequenc\w*|index of coincidence)(?:\s+(?:of|on|for))?\s*/i);
    if (!t) refuse('Give some text');
    const counts = new Array(26).fill(0) as number[];
    let n = 0;
    for (const c of t!.toUpperCase()) {
      const i = c.charCodeAt(0) - 65;
      if (i >= 0 && i < 26) counts[i]!++, n++;
    }
    if (!n) refuse('No letters in the text');
    const ic = counts.reduce((s, c) => s + c * (c - 1), 0) / (n * (n - 1) || 1);
    const order = counts.map((c, i) => [i, c] as const).filter(([, c]) => c).sort((a, b) => b[1] - a[1]);
    const top = order[0]![0];
    const guess = (top - 4 + 26) % 26;
    return answer(input, 'crypto', `Frequency analysis of ${n} letters`, order.slice(0, 5).map(([i, c]) => `${String.fromCharCode(65 + i)} ${c}`).join(', '), {
      lines: [
        { label: 'Index of coincidence', display: `${fmt(ic, 4)} (English ≈ 0.0667, random ≈ 0.0385)` },
        { label: 'Hint', display: `If ${String.fromCharCode(65 + top)} stands for E, a Caesar shift of ${guess} decrypts it: ${caesar(t!, -guess).slice(0, 60)}` },
      ],
      table: { columns: ['letter', 'count', '%', 'English %'], rows: order.map(([i, c]) => [String.fromCharCode(65 + i), String(c), fmt((100 * c) / n, 4), fmt(EN[i]!, 4)]) },
      notes: ['A high index of coincidence suggests a monoalphabetic (substitution/Caesar) cipher; a low one suggests a polyalphabetic cipher like Vigenère.'],
    });
  }
  return null;
}

function bigints(s: string): bigint[] {
  return (s.match(/\d+/g) ?? []).map((x) => BigInt(x));
}

function modExp(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\b(?:modular exponentiation|mod(?:ular)? pow\w*|powmod|pow\s*\(|square[- ]and[- ]multiply|fast exponentiation|repeated squaring|binary exponentiation)\b/.test(lc)) return null;
  const m1 = /(\d+)\s*\^\s*(\d+)\s*(?:mod|%|\(mod)\s*(\d+)/i.exec(input);
  const m2 = /pow\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(input);
  let b: bigint, e: bigint, m: bigint;
  if (m1) [b, e, m] = [BigInt(m1[1]!), BigInt(m1[2]!), BigInt(m1[3]!)];
  else if (m2) [b, e, m] = [BigInt(m2[1]!), BigInt(m2[2]!), BigInt(m2[3]!)];
  else {
    const n = bigints(input);
    if (n.length < 3) refuse('Write it as “3^200 mod 13”');
    [b, e, m] = [n[0]!, n[1]!, n[2]!];
  }
  if (m === 0n) refuse('Modulus must be positive');
  const rows: string[][] = [];
  let r = 1n;
  let sq = b % m;
  const bits = e.toString(2);
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[bits.length - 1 - i]!;
    const before = r;
    if (bit === '1') r = (r * sq) % m;
    if (rows.length < 64) rows.push([String(i), bit, `${b}^${1n << BigInt(i)} ≡ ${sq}`, bit === '1' ? `${before}·${sq} ≡ ${r}` : `${r}`]);
    sq = (sq * sq) % m;
  }
  return answer(input, 'crypto', `${b}^${e} mod ${m} by square-and-multiply`, r.toString(), {
    lines: [{ label: 'Exponent in binary', display: bits }, { label: 'Multiplications', display: `${bits.length - 1} squarings + ${[...bits].filter((c) => c === '1').length - 1} multiplications` }],
    table: { columns: ['bit i', 'eᵢ', 'square', 'running result'], rows },
    notes: ['Each step squares the base; bits equal to 1 multiply it into the result. O(log e) multiplications instead of e.'],
  });
}

function isPrimeBig(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while (d % 2n === 0n) (d /= 2n), s++;
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        comp = false;
        break;
      }
    }
    if (comp) return false;
  }
  return true;
}

function rsa(input: string): Result {
  const lc = input.toLowerCase();
  if (!/\brsa\b/.test(lc)) return null;
  const get = (k: string) => {
    const m = new RegExp(`\\b${k}\\s*=\\s*(\\d+)`, 'i').exec(input);
    return m ? BigInt(m[1]!) : undefined;
  };
  let p = get('p');
  let q = get('q');
  let n = get('n');
  let e = get('e');
  let d = get('d');
  const lines: Line[] = [];
  const notes: string[] = [];
  let phi: bigint | undefined;
  if (p !== undefined && q !== undefined) {
    if (!isPrimeBig(p) || !isPrimeBig(q)) refuse(`${!isPrimeBig(p) ? `p = ${p}` : `q = ${q}`} is not prime`);
    if (p === q) refuse('p and q must be different primes');
    n = p * q;
    phi = (p - 1n) * (q - 1n);
    const lam = phi / BigInt(egcd(p - 1n, q - 1n)[0]);
    lines.push({ label: 'n = p·q', display: `${p}·${q} = ${n}` }, { label: 'φ(n) = (p−1)(q−1)', display: phi.toString() }, { label: 'λ(n) = lcm(p−1, q−1)', display: lam.toString() });
    if (e === undefined) {
      e = [65537n, 17n, 7n, 5n, 3n].find((c) => c < phi! && egcd(c, phi!)[0] === 1n) ?? 3n;
      for (let c = 3n; e === undefined || egcd(e, phi)[0] !== 1n; c += 2n) e = c;
      notes.push(`No e given: chose e = ${e}, coprime to φ(n).`);
    }
    if (egcd(e, phi)[0] !== 1n) refuse(`e = ${e} is not coprime to φ(n) = ${phi}; gcd = ${egcd(e, phi)[0]}`);
    d = modinv(e, phi)!;
    lines.push({ label: 'Public key (e, n)', display: `(${e}, ${n})` }, { label: 'd = e⁻¹ mod φ(n)', display: `${d}  (check: ${e}·${d} mod ${phi} = ${(e * d) % phi})` });
  } else if (n === undefined || (e === undefined && d === undefined)) refuse('Give primes p and q (and optionally e), or n with e or d');
  const enc = /\b(?:encrypt\w*|encode)\s*(?:m\s*=\s*|message\s*)?(\d+)/i.exec(input) ?? /\bm\s*=\s*(\d+)/i.exec(input);
  const decm = /\b(?:decrypt\w*|decode)\s*(?:c\s*=\s*|ciphertext\s*)?(\d+)/i.exec(input) ?? /\bc\s*=\s*(\d+)/i.exec(input);
  const sign = /\bsign\w*\s*(\d+)/i.exec(input);
  let primary = `public (${e}, ${n}), private d = ${d}`;
  let value: number | undefined;
  if (enc && e !== undefined) {
    const m = BigInt(enc[1]!);
    if (m >= n!) refuse(`The message must be less than n = ${n}`);
    const c = modpow(m, e, n!);
    lines.push({ label: 'Encrypt c = mᵉ mod n', display: `${m}^${e} mod ${n} = ${c}` });
    if (d !== undefined) lines.push({ label: 'Check: cᵈ mod n', display: `${modpow(c, d, n!)}` });
    primary = `ciphertext ${c}`;
    value = Number(c);
  } else if (decm && d !== undefined) {
    const c = BigInt(decm[1]!);
    const m = modpow(c, d, n!);
    lines.push({ label: 'Decrypt m = cᵈ mod n', display: `${c}^${d} mod ${n} = ${m}` });
    primary = `message ${m}`;
    value = Number(m);
  } else if (sign && d !== undefined) {
    const m = BigInt(sign[1]!);
    const s = modpow(m, d, n!);
    lines.push({ label: 'Signature s = mᵈ mod n', display: s.toString() }, { label: 'Verify sᵉ mod n', display: e !== undefined ? modpow(s, e, n!).toString() : '—' });
    primary = `signature ${s}`;
    value = Number(s);
  }
  notes.push('Toy sizes only: real RSA uses primes of 1024+ bits and padding (OAEP); textbook RSA is deterministic and malleable.');
  return answer(input, 'crypto', `RSA${p !== undefined ? ` · p = ${p}, q = ${q}` : ` · n = ${n}`}${e !== undefined ? `, e = ${e}` : ''}`, primary, { value, lines, notes });
}

function diffieHellman(input: string): Result {
  if (!/\bdiffie[- ]hellman\b|\bdh key exchange\b|\bkey exchange\b/i.test(input)) return null;
  const get = (k: string[]) => {
    for (const name of k) {
      const m = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`, 'i').exec(input);
      if (m) return BigInt(m[1]!);
    }
    return undefined;
  };
  const p = get(['p', 'prime', 'modulus']);
  const g = get(['g', 'generator', 'base']);
  const a = get(['a', 'alice', 'xa']);
  const b = get(['b', 'bob', 'xb']);
  if (p === undefined || g === undefined || a === undefined || b === undefined) refuse('Give p, g and the two secrets a and b, e.g. “diffie hellman p=23 g=5 a=6 b=15”');
  const A = modpow(g!, a!, p!);
  const B = modpow(g!, b!, p!);
  const s1 = modpow(B, a!, p!);
  const s2 = modpow(A, b!, p!);
  return answer(input, 'crypto', `Diffie–Hellman · p = ${p}, g = ${g}`, `shared secret ${s1}`, {
    value: Number(s1),
    lines: [
      { label: 'Alice sends A = gᵃ mod p', display: `${g}^${a} mod ${p} = ${A}` },
      { label: 'Bob sends B = gᵇ mod p', display: `${g}^${b} mod ${p} = ${B}` },
      { label: 'Alice computes Bᵃ mod p', display: s1.toString() },
      { label: 'Bob computes Aᵇ mod p', display: s2.toString() },
    ],
    notes: ['Both get g^(ab) mod p. An eavesdropper sees p, g, A and B but must solve a discrete logarithm to find a or b.', ...(isPrimeBig(p!) ? [] : [`Warning: p = ${p} is not prime.`])],
  });
}

function discreteLog(input: string): Result {
  if (!/\bdiscrete log\w*\b|\bbaby[- ]step\b/i.test(input)) return null;
  const m = /(\d+)\s*\^\s*x\s*(?:≡|=|==)\s*(\d+)\s*(?:\(?\s*mod\s*(\d+)\s*\)?)/i.exec(input);
  let g: bigint, h: bigint, p: bigint;
  if (m) [g, h, p] = [BigInt(m[1]!), BigInt(m[2]!), BigInt(m[3]!)];
  else {
    const n = bigints(input.replace(/^.*?(?:discrete log\w*|baby[- ]step giant[- ]step)/i, ''));
    if (n.length < 3) refuse('Write it as “discrete log 3^x = 13 mod 17”');
    [g, h, p] = [n[0]!, n[1]!, n[2]!];
  }
  if (p > 10n ** 14n) refuse('Up to 10¹⁴ here');
  const mm = BigInt(Math.ceil(Math.sqrt(Number(p))));
  const table = new Map<string, bigint>();
  let cur = 1n;
  for (let j = 0n; j < mm; j++) {
    if (!table.has(cur.toString())) table.set(cur.toString(), j);
    cur = (cur * g) % p;
  }
  const inv = modinv(modpow(g, mm, p), p);
  if (inv === null) refuse(`${g} has no inverse mod ${p}`);
  let gamma = h % p;
  for (let i = 0n; i <= mm; i++) {
    const j = table.get(gamma.toString());
    if (j !== undefined) {
      const x = i * mm + j;
      return answer(input, 'crypto', `Discrete log: ${g}^x ≡ ${h} (mod ${p})`, `x = ${x}`, { value: Number(x), lines: [{ label: 'Check', display: `${g}^${x} mod ${p} = ${modpow(g, x, p)}` }, { label: 'Method', display: `baby-step giant-step, m = ⌈√p⌉ = ${mm}` }], notes: ['Smallest non-negative solution; others differ by multiples of the order of g.'] });
    }
    gamma = (gamma * inv!) % p;
  }
  return answer(input, 'crypto', `Discrete log: ${g}^x ≡ ${h} (mod ${p})`, 'no solution', { notes: [`${h} is not a power of ${g} modulo ${p}.`] });
}

// SHA-256 (FIPS 180-4).
const K256 = Array.from({ length: 64 }, (_, i) => {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  return Math.floor((Math.cbrt(primes[i]!) % 1) * 2 ** 32) >>> 0;
});
export function sha256(msg: Uint8Array): string {
  const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = msg.length;
  const padded = new Uint8Array(Math.ceil((l + 9) / 64) * 64);
  padded.set(msg);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (l * 8) >>> 0);
  dv.setUint32(padded.length - 8, Math.floor((l * 8) / 2 ** 32));
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array(64).fill(0) as number[];
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H0 as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => (H0[i] = (H0[i]! + x) >>> 0));
  }
  return H0.map((x) => x.toString(16).padStart(8, '0')).join('');
}

function hashing(input: string): Result {
  if (!/\bsha-?256\b/i.test(input)) return null;
  const text = /["“'‘]([^"”'’]*)["”'’]/.exec(input)?.[1] ?? /\b(?:of|for|hash)\s+(.+)$/i.exec(input)?.[1];
  if (text === undefined) refuse('Give a quoted string, e.g. sha256 of "abc"');
  const h = sha256(new TextEncoder().encode(text!));
  return answer(input, 'crypto', `SHA-256 of "${text}"`, h, { lines: [{ label: 'Bits', display: '256 (64 hex digits)' }], notes: ['A cryptographic hash is one-way and collision-resistant: changing one character changes about half the output bits (avalanche effect).'] });
}

export const cryptoHandlers = [rsa, diffieHellman, discreteLog, modExp, hashing, classical];
export { numbers };
