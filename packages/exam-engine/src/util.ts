/** Small deterministic helpers shared by the exam engine. */

/** mulberry32: same seed, same sequence (mirrors practice-engine's generator, which it does not export). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T {
    const v = items[Math.floor(this.next() * items.length)];
    if (v === undefined) throw new Error('pick from empty list');
    return v;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/** Independent child seeds from one seed. */
export function mixSeed(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a, for stable ids from text. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'doc'
  );
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Most common value (first seen wins ties), or undefined. */
export function mode<T>(xs: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestN = 0;
  for (const x of xs) {
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) [best, bestN] = [x, n];
  }
  return best;
}

/** Splits `total` integer units by weights (largest remainder), deterministic. */
export function allocate<K>(total: number, weights: readonly { key: K; weight: number }[]): { key: K; count: number }[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (!weights.length || sum <= 0 || total <= 0) return weights.map((w) => ({ key: w.key, count: 0 }));
  const raw = weights.map((w) => (Math.max(0, w.weight) / sum) * total);
  const out = raw.map((r, i) => ({ key: weights[i]!.key, count: Math.floor(r), rem: r - Math.floor(r), i }));
  let left = total - out.reduce((s, o) => s + o.count, 0);
  for (const o of [...out].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (left <= 0) break;
    o.count++;
    left--;
  }
  return out.map(({ key, count }) => ({ key, count }));
}

export const round = (x: number, p = 0) => Math.round(x * 10 ** p) / 10 ** p;
