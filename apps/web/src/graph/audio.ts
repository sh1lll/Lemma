/**
 * Audio trace: a soft sine tone whose pitch follows the traced point's height (low on the bottom edge of the graph,
 * two octaves higher at the top), so a curve can be followed by ear. Created on first use (always inside a user
 * gesture: a trace is a pointer or key action), and fades out shortly after the trace stops moving.
 */

let ctx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let stopTimer = 0;

export function sonify(frac: number): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!osc || !gain) {
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
    }
    const now = ctx.currentTime;
    const f = Number.isFinite(frac) ? 220 * 2 ** (2 * Math.min(1, Math.max(0, frac))) : 0;
    osc.frequency.setTargetAtTime(f || 110, now, 0.02);
    gain.gain.setTargetAtTime(Number.isFinite(frac) && frac >= 0 && frac <= 1 ? 0.07 : 0.015, now, 0.03);
    clearTimeout(stopTimer);
    stopTimer = window.setTimeout(silence, 350);
  } catch {
    // Audio unavailable: tracing still works silently.
  }
}

export function silence(): void {
  if (ctx && gain) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}

/** Plays a whole curve left to right over `ms`: samples are heights as fractions (NaN = a gap). */
export function sweep(fracs: number[], ms = 2000): void {
  if (!fracs.length) return;
  const start = performance.now();
  const step = () => {
    const p = (performance.now() - start) / ms;
    if (p >= 1) return silence();
    sonify(fracs[Math.min(fracs.length - 1, Math.floor(p * fracs.length))]!);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
