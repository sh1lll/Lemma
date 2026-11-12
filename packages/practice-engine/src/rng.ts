/** mulberry32: small, fast, and good enough for picking exercise numbers. Same seed, same sequence. */
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
  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** Non-zero integer in [lo, hi]. */
  nz(lo: number, hi: number): number {
    for (;;) {
      const v = this.int(lo, hi);
      if (v !== 0) return v;
    }
  }
  /** Integer in [lo, hi] with a random sign. */
  signed(lo: number, hi: number): number {
    return this.int(lo, hi) * (this.next() < 0.5 ? -1 : 1);
  }
  pick<T>(items: readonly T[]): T {
    const v = items[Math.floor(this.next() * items.length)];
    if (v === undefined) throw new Error('pick from empty list');
    return v;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/** Derives independent child seeds (for test questions) from one seed. */
export function mixSeed(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
