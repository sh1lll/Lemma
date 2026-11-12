/**
 * Token-bucket rate limiter keyed by client IP. `perMinute` tokens refill continuously; a client may
 * burst up to `burst` requests. Idle buckets are dropped so memory stays bounded.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly perMinute: number;
  private readonly burst: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(perMinute: number, burst = perMinute, maxKeys = 50_000, now = () => Date.now()) {
    this.perMinute = perMinute;
    this.burst = burst;
    this.maxKeys = maxKeys;
    this.now = now;
  }

  /** Returns 0 when allowed, otherwise the seconds to wait. */
  take(key: string): number {
    const t = this.now();
    const rate = this.perMinute / 60_000;
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(t, true);
      b = { tokens: this.burst, at: t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + (t - b.at) * rate);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000));
  }

  /** Drops buckets that have fully refilled (or, under pressure, the oldest half). */
  sweep(t = this.now(), pressure = false): void {
    const rate = this.perMinute / 60_000;
    for (const [k, b] of this.buckets) if (b.tokens + (t - b.at) * rate >= this.burst) this.buckets.delete(k);
    if (pressure && this.buckets.size >= this.maxKeys) {
      let drop = Math.ceil(this.buckets.size / 2);
      for (const k of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }
}
