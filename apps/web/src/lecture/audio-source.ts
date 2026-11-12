/**
 * Reading long audio files without holding them in memory. Decoding a whole 3-hour upload at once costs gigabytes
 * (the native-rate AudioBuffer, then a full-length 16 kHz copy), so files are opened as an {@link AudioSource}
 * that decodes only the slice asked for:
 *
 * - WAV: the PCM is read straight from byte ranges of the file and resampled in JS.
 * - MP3: a frame index is built once (a few bytes per 26 ms frame); a slice decodes just the frames it covers
 *   (plus a little pre-roll for the decoder's bit reservoir).
 * - Anything else (M4A, Ogg, FLAC, WebM…) has to be decoded whole by the browser, so it is only accepted up to
 *   {@link MAX_WHOLE_DECODE_HOURS}, checked from the file's metadata before decoding starts.
 *
 * Pure apart from the injected decoder and duration probe, so it runs under Node in tests.
 */

export const RATE = 16000;
/** Longest upload accepted at all (streamed formats). */
export const MAX_STREAM_HOURS = 8;
/** Longest upload in a format the browser can only decode whole (and the longest returned as one array). */
export const MAX_WHOLE_DECODE_HOURS = 2;

/** The parts of Blob used here, so tests can pass multi-gigabyte virtual files. */
export interface BlobLike {
  readonly size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** The parts of AudioBuffer used here. */
export interface PcmBuffer {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioDeps {
  /** decodeAudioData (at 16 kHz in browsers, so the browser resamples). */
  decode(data: ArrayBuffer): Promise<PcmBuffer>;
  /** Duration in seconds from the file's metadata, or null when it can't be told without decoding. */
  probeDuration?(file: BlobLike): Promise<number | null>;
}

/** 16 kHz mono audio that is decoded on demand. */
export interface AudioSource {
  /** Length in 16 kHz samples. */
  readonly length: number;
  readonly kind: 'wav' | 'mp3' | 'pcm';
  /** Samples [start, end) at 16 kHz mono. */
  read(start: number, end: number): Promise<Float32Array>;
}

export function tooLong(seconds: number, maxHours: number, hint: string): Error {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return new Error(`This recording is ${h ? `${h} h ` : ''}${m} min long; uploads can be up to ${maxHours} hours${hint}. Split it into shorter parts and transcribe them one at a time.`);
}

// ── Resampling ──────────────────────────────────────────────────────────────

const PHASES = 64;
const filterCache = new Map<string, { half: number; table: Float32Array }>();

/** Windowed-sinc low-pass taps for every fractional phase (looked up, not recomputed per sample). */
function filterFor(inRate: number, outRate: number) {
  const key = `${inRate}:${outRate}`;
  let f = filterCache.get(key);
  if (f) return f;
  const ratio = inRate / outRate;
  const fc = Math.min(1, 1 / ratio) * 0.95; // cutoff as a fraction of the input Nyquist, a little below the output's
  const half = Math.ceil(6 * Math.max(1, ratio));
  const width = 2 * half;
  const table = new Float32Array(PHASES * width);
  for (let p = 0; p < PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let k = 0; k < width; k++) {
      const x = k - half + 1 - frac; // distance from the output position to tap k
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
      const v = Math.abs(x) >= half ? 0 : fc * sinc * win;
      table[p * width + k] = v;
      sum += v;
    }
    for (let k = 0; k < width; k++) table[p * width + k]! /= sum || 1;
  }
  f = { half, table };
  filterCache.set(key, f);
  return f;
}

/**
 * Resamples `input` (whose first sample is native index `inOffset`) to output samples [outStart, outEnd) at
 * `outRate`. Taps beyond the input are treated as missing (the filter renormalises), so callers pass a little
 * margin on both sides for clean slice edges.
 */
export function resampleSlice(input: Float32Array, inRate: number, inOffset: number, outRate: number, outStart: number, outEnd: number): Float32Array {
  const n = Math.max(0, outEnd - outStart);
  const out = new Float32Array(n);
  if (inRate === outRate) {
    for (let i = 0; i < n; i++) out[i] = input[outStart + i - inOffset] ?? 0;
    return out;
  }
  const { half, table } = filterFor(inRate, outRate);
  const width = 2 * half;
  const ratio = inRate / outRate;
  for (let i = 0; i < n; i++) {
    const t = (outStart + i) * ratio - inOffset;
    const base = Math.floor(t);
    const p = Math.min(PHASES - 1, Math.round((t - base) * PHASES));
    const first = base - half + 1;
    let acc = 0;
    let wsum = 0;
    for (let k = 0; k < width; k++) {
      const j = first + k;
      if (j < 0 || j >= input.length) continue;
      const w = table[p * width + k]!;
      acc += input[j]! * w;
      wsum += w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

function mono(buf: PcmBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += d[i]!;
  }
  const k = 1 / buf.numberOfChannels;
  for (let i = 0; i < out.length; i++) out[i]! *= k;
  return out;
}

// ── WAV ─────────────────────────────────────────────────────────────────────

interface WavInfo {
  format: 1 | 3;
  channels: number;
  rate: number;
  bits: number;
  dataStart: number;
  dataBytes: number;
}

const ascii = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

export async function parseWav(file: BlobLike): Promise<WavInfo | null> {
  const head = new DataView(await file.slice(0, 12).arrayBuffer());
  if (head.byteLength < 12 || ascii(head, 0) !== 'RIFF' || ascii(head, 8) !== 'WAVE') return null;
  let pos = 12;
  let fmt: Omit<WavInfo, 'dataStart' | 'dataBytes'> | null = null;
  // Walk the chunks (LIST/INFO and others may come before "data"); only chunk headers are read.
  for (let guard = 0; guard < 64 && pos + 8 <= file.size; guard++) {
    const h = new DataView(await file.slice(pos, pos + 8).arrayBuffer());
    const id = ascii(h, 0);
    const size = h.getUint32(4, true);
    if (id === 'fmt ') {
      const f = new DataView(await file.slice(pos + 8, pos + 8 + Math.min(size, 40)).arrayBuffer());
      let format = f.getUint16(0, true);
      if (format === 0xfffe && size >= 26) format = f.getUint16(24, true); // WAVE_FORMAT_EXTENSIBLE: sub-format GUID
      if (format !== 1 && format !== 3) throw new Error('This WAV file is compressed (not PCM); convert it to plain WAV or MP3.');
      fmt = { format, channels: f.getUint16(2, true), rate: f.getUint32(4, true), bits: f.getUint16(14, true) };
    } else if (id === 'data') {
      if (!fmt) return null;
      const dataStart = pos + 8;
      // Streamed WAVs leave the size at 0 or 0xFFFFFFFF; files over 4 GB overflow it. Trust the file then.
      const dataBytes = size === 0 || size === 0xffffffff || dataStart + size > file.size ? file.size - dataStart : size;
      return { ...fmt, dataStart, dataBytes };
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}

function wavToMono(bytes: ArrayBuffer, w: WavInfo): Float32Array {
  const v = new DataView(bytes);
  const bps = w.bits / 8;
  const frame = bps * w.channels;
  const n = Math.floor(bytes.byteLength / frame);
  const out = new Float32Array(n);
  const k = 1 / w.channels;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < w.channels; c++) {
      const at = i * frame + c * bps;
      if (w.format === 3) s += w.bits === 64 ? v.getFloat64(at, true) : v.getFloat32(at, true);
      else if (w.bits === 16) s += v.getInt16(at, true) / 32768;
      else if (w.bits === 8) s += (v.getUint8(at) - 128) / 128;
      else if (w.bits === 24) s += ((v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)) / 8388608);
      else s += v.getInt32(at, true) / 2147483648;
    }
    out[i] = s * k;
  }
  return out;
}

function wavSource(file: BlobLike, w: WavInfo): AudioSource {
  const frame = (w.bits / 8) * w.channels;
  const frames = Math.floor(w.dataBytes / frame);
  const length = Math.floor((frames * RATE) / w.rate);
  const ratio = w.rate / RATE;
  const pad = Math.ceil(8 * Math.max(1, ratio)) + 2;
  return {
    length,
    kind: 'wav',
    async read(start, end) {
      end = Math.min(end, length);
      if (end <= start) return new Float32Array(0);
      const a = Math.max(0, Math.floor(start * ratio) - pad);
      const b = Math.min(frames, Math.ceil(end * ratio) + pad);
      const bytes = await file.slice(w.dataStart + a * frame, w.dataStart + b * frame).arrayBuffer();
      return resampleSlice(wavToMono(bytes, w), w.rate, a, RATE, start, end);
    },
  };
}

// ── MP3 ─────────────────────────────────────────────────────────────────────

const MP3_BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps by index (MPEG-1 / MPEG-2 & 2.5, layers I, II, III)
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Frame length in bytes, samples per frame and sample rate for an MPEG audio header, or null if it isn't one. */
export function mp3Frame(b0: number, b1: number, b2: number): { bytes: number; samples: number; rate: number } | null {
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const ver = (b1 >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layerBits = (b1 >> 1) & 3;
  if (ver === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bi = (b2 >> 4) & 15;
  const ri = (b2 >> 2) & 3;
  if (bi === 0 || bi === 15 || ri === 3) return null;
  const kbps = MP3_BITRATES[`${ver === 3 ? 1 : 2}-${layer}`]![bi]!;
  const rate = MP3_RATES[ver]![ri]!;
  const pad = (b2 >> 1) & 1;
  if (layer === 1) return { bytes: (Math.floor((12 * kbps * 1000) / rate) + pad) * 4, samples: 384, rate };
  const samples = layer === 3 && ver !== 3 ? 576 : 1152;
  return { bytes: Math.floor(((samples / 8) * kbps * 1000) / rate) + pad, samples, rate };
}

interface Mp3Index {
  offsets: Float64Array; // byte offset of each frame, plus the end
  /** Start time of each frame in seconds. */
  times: Float64Array;
  count: number;
}

/** Scans frame headers block by block; skips an ID3v2 tag and resynchronises over junk. */
export async function indexMp3(file: BlobLike, block = 1 << 20): Promise<Mp3Index | null> {
  let pos = 0;
  const id3 = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (id3.length === 10 && id3[0] === 0x49 && id3[1] === 0x44 && id3[2] === 0x33) {
    pos = 10 + ((id3[6]! & 0x7f) << 21) + ((id3[7]! & 0x7f) << 14) + ((id3[8]! & 0x7f) << 7) + (id3[9]! & 0x7f);
  }
  let offsets = new Float64Array(4096);
  let times = new Float64Array(4096);
  let count = 0;
  let t = 0;
  let firstRate = 0;
  const audioStart = pos;
  let buf = new Uint8Array(0);
  let bufStart = pos;
  // Header bytes at an absolute offset, reading the next block when needed.
  const at = async (p: number) => {
    if (p < bufStart || p + 3 > bufStart + buf.length) {
      bufStart = p;
      buf = new Uint8Array(await file.slice(p, Math.min(file.size, p + block)).arrayBuffer());
    }
    const i = p - bufStart;
    return buf.length - i >= 3 ? mp3Frame(buf[i]!, buf[i + 1]!, buf[i + 2]!) : null;
  };
  while (pos + 4 <= file.size) {
    const f = await at(pos);
    // A frame counts when the one after it also parses (or the file ends), so stray 0xFFEx bytes in other
    // formats (M4A, Ogg…) or in tags aren't taken for MP3.
    const ok = f && (!firstRate || f.rate === firstRate) && (pos + f.bytes + 4 > file.size || (await at(pos + f.bytes))?.rate === f.rate);
    if (!f || !ok) {
      pos++;
      if (count === 0 && pos > audioStart + 65536) return null; // no audio near the start: not an MP3
      continue;
    }
    firstRate ||= f.rate;
    if (count + 1 >= offsets.length) {
      const o = new Float64Array(offsets.length * 2);
      o.set(offsets);
      offsets = o;
      const tt = new Float64Array(times.length * 2);
      tt.set(times);
      times = tt;
    }
    offsets[count] = pos;
    times[count] = t;
    count++;
    t += f.samples / f.rate;
    pos += f.bytes;
  }
  if (count < 2) return null;
  offsets[count] = Math.min(pos, file.size);
  times[count] = t;
  return { offsets: offsets.subarray(0, count + 1), times: times.subarray(0, count + 1), count };
}

/** First frame starting at or before `sec`. */
function frameAt(idx: Mp3Index, sec: number): number {
  let lo = 0;
  let hi = idx.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx.times[mid]! <= sec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function mp3Source(file: BlobLike, idx: Mp3Index, deps: AudioDeps): AudioSource {
  const length = Math.floor(idx.times[idx.count]! * RATE);
  const PREROLL = 4; // frames decoded and dropped before a slice, for the bit reservoir and decoder warm-up
  return {
    length,
    kind: 'mp3',
    async read(start, end) {
      end = Math.min(end, length);
      if (end <= start) return new Float32Array(0);
      const f0 = Math.max(0, frameAt(idx, start / RATE) - PREROLL);
      const f1 = Math.min(idx.count, frameAt(idx, end / RATE) + 2);
      const bytes = await file.slice(idx.offsets[f0]!, idx.offsets[f1]!).arrayBuffer();
      const buf = await deps.decode(bytes);
      const pcm = mono(buf);
      // The decoded audio starts at frame f0's time (decoders trim their own delay on short raw streams well
      // enough for speech; a few ms of drift doesn't matter with overlapping windows).
      const offsetNative = Math.round(idx.times[f0]! * buf.sampleRate);
      return resampleSlice(pcm, buf.sampleRate, offsetNative, RATE, start, end);
    },
  };
}

// ── Opening a file ──────────────────────────────────────────────────────────

/** Whole-file decode, for formats without a cheap way to seek. Refuses long files before decoding them. */
async function wholeSource(file: BlobLike, deps: AudioDeps): Promise<AudioSource> {
  const seconds = (await deps.probeDuration?.(file)) ?? null;
  if (seconds !== null && seconds > MAX_WHOLE_DECODE_HOURS * 3600) throw tooLong(seconds, MAX_WHOLE_DECODE_HOURS, ' in this format (MP3 and WAV can be longer)');
  let buf: PcmBuffer;
  try {
    buf = await deps.decode(await file.slice(0, file.size).arrayBuffer());
  } catch (e) {
    throw new Error(`Could not decode this audio file${e instanceof Error && e.message ? `: ${e.message}` : ''}`);
  }
  if (buf.length / buf.sampleRate > MAX_WHOLE_DECODE_HOURS * 3600) throw tooLong(buf.length / buf.sampleRate, MAX_WHOLE_DECODE_HOURS, ' in this format (MP3 and WAV can be longer)');
  // Mixed down once; the decoded buffer can then be collected. Resampled per slice on demand.
  const pcm = mono(buf);
  const rate = buf.sampleRate;
  const length = Math.floor((pcm.length * RATE) / rate);
  return { length, kind: 'pcm', read: async (start, end) => resampleSlice(pcm, rate, 0, RATE, start, Math.min(end, length)) };
}

/** Opens an audio file for on-demand decoding at 16 kHz mono. */
export async function openAudio(file: BlobLike, deps: AudioDeps): Promise<AudioSource> {
  if (!file.size) return { length: 0, kind: 'pcm', read: async () => new Float32Array(0) };
  let src: AudioSource | null = null;
  const wav = await parseWav(file);
  if (wav) src = wavSource(file, wav);
  else {
    const idx = await indexMp3(file);
    if (idx) src = mp3Source(file, idx, deps);
  }
  if (src) {
    if (src.length > MAX_STREAM_HOURS * 3600 * RATE) throw tooLong(src.length / RATE, MAX_STREAM_HOURS, '');
    return src;
  }
  return wholeSource(file, deps);
}

/**
 * Reads a whole source into one array, in slices (so the only full-length allocation is the 16 kHz result).
 * Refuses sources longer than `maxHours`: at 16 kHz a float array is 230 MB per hour.
 */
export async function readAll(src: AudioSource, maxHours = MAX_WHOLE_DECODE_HOURS, slice = 60 * RATE): Promise<Float32Array> {
  if (src.length > maxHours * 3600 * RATE) throw tooLong(src.length / RATE, maxHours, ' when read in one piece');
  const out = new Float32Array(src.length);
  for (let s = 0; s < src.length; s += slice) out.set(await src.read(s, Math.min(src.length, s + slice)), s);
  return out;
}
