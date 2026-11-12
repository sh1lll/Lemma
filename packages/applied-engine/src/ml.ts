import { NUM, bytesText, duration, named, need, num, ofDim, res, show, withUnit, type Ctx, type Handler } from './util';

const M = 'ml' as const;

/** "7B", "70 billion", "1.3e9 params", "125M parameters". */
function params(c: Ctx): number | null {
  const m = new RegExp(String.raw`(${NUM})\s*(t|b|bn|m|k|trillion|billion|million|thousand)?\s*(?:-?\s*(?:param(?:eter)?s?|weights)\b|(?=\s*(?:model|llm)\b))`, 'i').exec(c.s)
    ?? new RegExp(String.raw`(?:params?|parameters)\s*(?:=|:|of)?\s*(${NUM})\s*(t|b|bn|m|k|trillion|billion|million)?\b`, 'i').exec(c.s)
    ?? new RegExp(String.raw`\b(${NUM})\s*(b|bn|billion|m|million)\b`, 'i').exec(c.s);
  if (!m) return null;
  const s = (m[2] ?? '').toLowerCase();
  const mult = /^t/.test(s) ? 1e12 : /^b/.test(s) ? 1e9 : /^m/.test(s) ? 1e6 : /^k|thou/.test(s) ? 1e3 : 1;
  return num(m[1]!) * mult;
}
function tokens(c: Ctx): number | null {
  const m = new RegExp(String.raw`(${NUM})\s*(t|b|bn|m|k|trillion|billion|million|thousand)?\s*tokens`, 'i').exec(c.s);
  if (!m) return null;
  const s = (m[2] ?? '').toLowerCase();
  return num(m[1]!) * (/^t/.test(s) ? 1e12 : /^b/.test(s) ? 1e9 : /^m/.test(s) ? 1e6 : /^k|thou/.test(s) ? 1e3 : 1);
}
const PREC: [RegExp, number, string][] = [
  [/fp32|float32|f32|single|32.?bit/, 4, 'fp32'], [/bf16|bfloat16/, 2, 'bf16'], [/fp16|float16|f16|half|16.?bit/, 2, 'fp16'], [/fp8|float8|8.?bit float/, 1, 'fp8'], [/int8|8.?bit|q8/, 1, 'int8'], [/int4|4.?bit|q4|nf4/, 0.5, 'int4'], [/fp64|double/, 8, 'fp64'],
];
// Dense peak tensor throughput (FLOP/s), vendor datasheets.
const GPUS: [RegExp, number, number, string][] = [
  [/h100/, 989e12, 3.35e12, 'H100 SXM (989 TFLOP/s bf16 dense, 3.35 TB/s)'], [/a100/, 312e12, 2.039e12, 'A100 80GB (312 TFLOP/s bf16, 2.0 TB/s)'], [/v100/, 125e12, 0.9e12, 'V100 (125 TFLOP/s fp16, 900 GB/s)'],
  [/4090/, 165e12, 1.008e12, 'RTX 4090 (165 TFLOP/s fp16 dense, 1.0 TB/s)'], [/3090/, 71e12, 0.936e12, 'RTX 3090 (71 TFLOP/s fp16, 936 GB/s)'], [/h200/, 989e12, 4.8e12, 'H200 (989 TFLOP/s bf16, 4.8 TB/s)'], [/b200/, 2250e12, 8e12, 'B200 (2.25 PFLOP/s bf16 dense, 8 TB/s)'],
];

const memory: Handler = (c) => {
  if (!/memory|vram|ram|gpu|size|bytes|gb|fit|footprint|weights|load|quanti[sz]/.test(c.s)) return null;
  if (/kv.?cache|context|flops?|tokens? per second|tok\/s|throughput/.test(c.s)) return null;
  const n = params(c);
  if (n === null || !/param|\bmodel|\bllm|weights|\d\s*b\b/.test(c.s)) return null;
  // "423 B into kilobytes" is a unit conversion of bytes, not a 423-billion-parameter model.
  if (!/param|\bmodel|\bllm|weights|vram|gpu/.test(c.s) && /\d\s*b\s+(?:to|into|in|as)\s/.test(c.s)) return null;
  const p = PREC.find(([re]) => re.test(c.s));
  const training = /train|fine.?tun|adam|optimi[sz]er|gradients?/.test(c.s);
  const rows = PREC.filter((x) => x[2] !== 'fp64' && x[2] !== 'bf16' && x[2] !== 'fp8').map(([, b, name]) => [name, `${show(b * 8)} bits`, bytesText(n * b)]);
  if (training) {
    const bytes = 16;
    return res(c, { kind: M, expression: `Training memory for ${show(n)} parameters (mixed precision + Adam)`, value: (n * bytes) / 1e9, unit: 'GB', formula: '≈ 16 bytes/param: fp16 weights 2 + fp16 grads 2 + fp32 master 4 + Adam m, v 8', lines: [['Total', bytesText(n * bytes)], ['Weights only (fp16)', bytesText(n * 2)]], notes: ['Excludes activations (depend on batch size and sequence length) and framework overhead', 'ZeRO/FSDP sharding divides this across GPUs'] });
  }
  const bytes = p?.[1] ?? null;
  if (bytes === null) return res(c, { kind: M, expression: `Weight memory for ${show(n)} parameters`, display: `${bytesText(n * 2)} at fp16`, value: (n * 2) / 1e9, table: { columns: ['Precision', 'Per weight', 'Memory'], rows }, notes: ['Weights only; add ~10–20% for runtime overhead plus the KV cache for inference'] });
  const gpu = /(\d+)\s*gb\s*(?:gpus?|cards?)/.exec(c.s);
  const lines: [string, string][] = [['Bytes per parameter', show(bytes)], ['Total', bytesText(n * bytes)]];
  if (gpu) lines.push([`${gpu[1]} GB GPUs needed (weights only)`, String(Math.ceil((n * bytes) / (num(gpu[1]!) * 1e9)))]);
  return res(c, { kind: M, expression: `Weight memory for ${show(n)} parameters at ${p![2]}`, value: (n * bytes) / 1e9, unit: 'GB', unitWords: 'gigabytes', formula: 'memory = parameters × bytes per parameter', lines, table: { columns: ['Precision', 'Per weight', 'Memory'], rows }, notes: ['Weights only; add ~10–20% for runtime overhead plus the KV cache for inference', 'GB = 10⁹ bytes'] });
};

const kvCache: Handler = (c) => {
  if (!/kv.?cache|key.?value cache|context (?:window )?memory/.test(c.s)) return null;
  const L = named(c, 'layers|n_layers|num_layers|l') ?? (/(\d+)\s*layers/.exec(c.s) ? num(/(\d+)\s*layers/.exec(c.s)![1]!) : null);
  const d = named(c, 'hidden(?: size)?|d_model|dmodel|model dim(?:ension)?|embedding(?: dim)?') ?? (/(\d+)\s*(?:hidden|d_model|dim)/.exec(c.s) ? num(/(\d+)\s*(?:hidden|d_model|dim)/.exec(c.s)![1]!) : null);
  const seq = named(c, 'context|seq(?:uence)?(?: length)?|tokens|ctx') ?? (/(\d[\d,]*)\s*(?:k\s*)?(?:tokens|context)/.exec(c.s) ? num(/(\d[\d,]*)\s*(?:k\s*)?(?:tokens|context)/.exec(c.s)![1]!) * (/\d\s*k\s*(?:tokens|context)/.test(c.s) ? 1024 : 1) : null);
  const batch = named(c, 'batch(?: size)?') ?? 1;
  const kvHeads = named(c, 'kv heads|kv_heads|n_kv_heads|key.?value heads');
  const headDim = named(c, 'head dim(?:ension)?|head_dim|d_head');
  const p = PREC.find(([re]) => re.test(c.s));
  const bytes = p?.[1] ?? 2;
  if (L === null || seq === null || (d === null && (kvHeads === null || headDim === null))) return need(c, M, 'KV cache size needs layers, context length, and the hidden size (or KV heads × head dim)');
  const width = kvHeads !== null && headDim !== null ? kvHeads * headDim : d!;
  const total = 2 * L * seq * width * bytes * batch;
  return res(c, { kind: M, expression: `KV cache: ${L} layers, ${show(seq)} tokens, width ${width}, batch ${batch}`, value: total / 2 ** 30, unit: 'GiB', formula: 'bytes = 2 (K and V) × layers × tokens × kv width × bytes/value × batch', lines: [['Total', bytesText(total)], ['Per token', bytesText(total / seq / batch)], ['Precision', p?.[2] ?? 'fp16 (assumed)']], notes: kvHeads !== null ? ['Grouped-query attention: KV width = KV heads × head dim'] : ['Multi-head attention (KV width = hidden size); GQA models are smaller'] });
};

const flops: Handler = (c) => {
  if (!/flops?|compute|train(?:ing)? (?:time|cost|budget)|gpu.?(?:hours|days)|how long to train|inference cost/.test(c.s)) return null;
  const n = params(c);
  if (n === null) return null;
  const T = tokens(c);
  const gpu = GPUS.find(([re]) => re.test(c.s));
  const count = /(\d[\d,]*)\s*(?:x\s*)?(?:gpus?|h100s?|a100s?|v100s?|h200s?|b200s?|cards?)/.exec(c.s.replace(/(\d+)\s*gb/g, ''));
  const mfu = /(\d+(?:\.\d+)?)\s*%\s*(?:mfu|utili[sz]ation|efficiency)/.exec(c.s) ?? /(?:mfu|utili[sz]ation|efficiency)\s*(?:of)?\s*(\d+(?:\.\d+)?)\s*%/.exec(c.s);
  if (/inference|per token|forward/.test(c.s) && !/train/.test(c.s)) {
    const per = 2 * n;
    const lines: [string, string][] = [['Per token', `${show(per)} FLOPs`]];
    if (T) lines.push([`For ${show(T)} tokens`, `${show(per * T)} FLOPs`]);
    return res(c, { kind: M, expression: `Inference compute for a ${show(n)}-parameter model`, value: T ? per * T : per, unit: 'FLOPs', formula: '≈ 2N FLOPs per token (forward pass)', lines, notes: ['Ignores attention FLOPs (≈ 2·layers·context·d per token), small for short contexts'] });
  }
  if (T === null) return need(c, M, 'Training compute needs the number of training tokens (e.g. "2T tokens")');
  const C = 6 * n * T;
  const lines: [string, string][] = [['Parameters', show(n)], ['Tokens', show(T)], ['Tokens per parameter', show(T / n)]];
  const notes = ['Kaplan et al. 2020 / Hoffmann et al. 2022: C ≈ 6ND (forward 2ND + backward 4ND)'];
  if (gpu) {
    const k = count ? num(count[1]!) : 1;
    const u = mfu ? num(mfu[1]!) / 100 : 0.4;
    const t = C / (k * gpu[1] * u);
    lines.push(['Hardware', `${show(k)} × ${gpu[3]}`], ['Utilisation (MFU)', `${show(u * 100)}%${mfu ? '' : ' (assumed)'}`], ['Wall-clock time', duration(t)], ['GPU-hours', show((t * k) / 3600)]);
  }
  lines.push(['Chinchilla-optimal tokens (≈20/param)', show(20 * n)]);
  return res(c, { kind: M, expression: `Training compute: ${show(n)} parameters on ${show(T)} tokens`, value: C, unit: 'FLOPs', formula: 'C ≈ 6 · N · D', lines, notes });
};

const throughput: Handler = (c) => {
  if (!/tokens? per (?:second|sec|s)\b|tok\/s|tokens\/s|generation speed|decode speed|how fast.*generate/.test(c.s)) return null;
  const n = params(c);
  const bw = ofDim(c, 'rate')[0];
  const gpu = GPUS.find(([re]) => re.test(c.s));
  const T = tokens(c);
  const rateM = new RegExp(String.raw`(${NUM})\s*(?:tokens? per (?:second|sec|s)|tok\/s|tokens\/s)`).exec(c.s);
  if (T && rateM) {
    const t = T / num(rateM[1]!);
    return res(c, { kind: M, expression: `Time to generate ${show(T)} tokens at ${rateM[1]} tok/s`, value: t, unit: 's', display: duration(t), formula: 'time = tokens / rate' });
  }
  if (n === null) return need(c, M, 'Decode speed needs the model size (parameters) and memory bandwidth (or GPU)');
  const p = PREC.find(([re]) => re.test(c.s));
  const bytes = p?.[1] ?? 2;
  const B = bw ? bw.v / 8 : gpu ? gpu[2] : null;
  if (B === null) return need(c, M, 'What memory bandwidth (e.g. 1000 GB/s) or GPU?');
  const tps = B / (n * bytes);
  return res(c, { kind: M, expression: `Memory-bound decode speed, ${show(n)} parameters at ${p?.[2] ?? 'fp16'}`, value: tps, unit: 'tokens/s', formula: 'tokens/s ≈ bandwidth / bytes of weights (batch 1)', lines: [['Weights', bytesText(n * bytes)], ['Bandwidth', `${show(B / 1e9)} GB/s${gpu && !bw ? ` (${gpu[3]})` : ''}`]], notes: ['Upper bound for single-stream decoding; batching raises total throughput'] });
};

const lrSchedule: Handler = (c) => {
  if (!/learning rate|\blr\b|warm.?up|cosine (?:decay|schedule|annealing)|step decay|exponential decay|lr schedule/.test(c.s)) return null;
  const step = named(c, 'step|at step|iteration|epoch|at epoch|t');
  const total = named(c, 'total(?: steps)?|of|max steps|t_max|steps|epochs');
  const lrMax = named(c, 'max(?: lr)?|peak(?: lr)?|lr_max|base lr|initial lr|lr0|learning rate|lr|initial');
  const lrMin = named(c, 'min(?: lr)?|lr_min|final lr|floor') ?? 0;
  if (/cosine/.test(c.s)) {
    const sm = /(?:step|epoch|iteration)\s*(\d[\d,]*)\s*(?:of|\/|out of)\s*(\d[\d,]*)/.exec(c.s);
    const s = sm ? num(sm[1]!) : step;
    const T = sm ? num(sm[2]!) : total;
    const warm = named(c, 'warm.?up(?: steps)?|warmup') ?? 0;
    if (lrMax === null || s === null || T === null) return need(c, M, 'Cosine schedule needs max LR, the current step and total steps');
    let lr: number;
    if (s < warm) lr = (lrMax * s) / warm;
    else lr = lrMin + 0.5 * (lrMax - lrMin) * (1 + Math.cos((Math.PI * (s - warm)) / (T - warm)));
    return res(c, { kind: M, expression: `Cosine learning rate at step ${show(s)} of ${show(T)}`, value: lr, formula: warm ? 'lr = lr_min + ½(lr_max − lr_min)(1 + cos(π(t−w)/(T−w))), linear warm-up for t < w' : 'lr = lr_min + ½(lr_max − lr_min)(1 + cos(πt/T))', lines: [['Max / min', `${show(lrMax)} / ${show(lrMin)}`], ['Progress', `${show((s / T) * 100)}%`]] });
  }
  if (/warm.?up/.test(c.s)) {
    const w = named(c, 'warm.?up(?: steps)?(?: of)?|over') ?? (/(\d[\d,]*)\s*(?:warm.?up )?steps/.exec(c.s) ? num(/(\d[\d,]*)\s*(?:warm.?up )?steps/.exec(c.s)![1]!) : null);
    const s = /at step\s*(\d[\d,]*)/.exec(c.s);
    if (lrMax === null || w === null || !s) return need(c, M, 'Linear warm-up needs the target LR, the warm-up length and the step');
    const t = num(s[1]!);
    return res(c, { kind: M, expression: `Linear warm-up LR at step ${show(t)}`, value: lrMax * Math.min(1, t / w), formula: 'lr = lr_max · min(1, t/w)' });
  }
  if (/step decay|step lr|decays? by|every \d+ (?:epochs|steps)|gamma/.test(c.s)) {
    const g = named(c, 'gamma|factor|by') ?? null;
    const every = /every\s*(\d+)\s*(?:epochs?|steps?)/.exec(c.s);
    const at = /(?:at|after) (?:epoch|step)\s*(\d+)/.exec(c.s);
    if (lrMax === null || g === null || !every || !at) return need(c, M, 'Step decay needs the initial LR, gamma, the interval and the epoch');
    const k = Math.floor(num(at[1]!) / num(every[1]!));
    return res(c, { kind: M, expression: `Step-decay LR at ${at[0].replace(/^(?:at|after) /, '')}`, value: lrMax * g ** k, formula: 'lr = lr₀ · γ^⌊t/step⌋', lines: [['Decays applied', String(k)]] });
  }
  if (/exponential/.test(c.s)) {
    const r = named(c, 'rate|decay rate|gamma|factor');
    const at = /(?:at|after) (?:epoch|step)\s*(\d+)|(?:step|epoch)\s*(\d+)/.exec(c.s);
    if (lrMax === null || r === null || !at) return need(c, M, 'Exponential decay needs the initial LR, the decay rate and the step');
    const t = num(at[1] ?? at[2]!);
    return res(c, { kind: M, expression: `Exponential-decay LR at step ${t}`, value: lrMax * r ** t, formula: 'lr = lr₀ · r^t' });
  }
  return null;
};

export const ml: Handler[] = [kvCache, flops, throughput, memory, lrSchedule];
export { withUnit };
