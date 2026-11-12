import { describe, expect, it } from 'vitest';
import { indexMp3, MAX_WHOLE_DECODE_HOURS, mp3Frame, openAudio, RATE, readAll, resampleSlice, type AudioDeps, type BlobLike, type PcmBuffer } from '../src/lecture/audio-source';

/** A virtual file whose bytes are generated on demand, so multi-gigabyte inputs cost nothing; records every read. */
function virtualFile(size: number, byteAt: (i: number) => number, fill?: (u: Uint8Array, start: number) => void) {
  const reads: number[] = [];
  const file: BlobLike & { reads: number[] } = {
    size,
    reads,
    slice(start = 0, end = size) {
      const a = Math.max(0, start);
      const b = Math.min(size, end);
      return {
        arrayBuffer: async () => {
          reads.push(b - a);
          const u = new Uint8Array(Math.max(0, b - a));
          if (fill) fill(u, a);
          else for (let i = 0; i < u.length; i++) u[i] = byteAt(a + i);
          return u.buffer;
        },
      };
    },
  };
  return file;
}

/** A 16-bit stereo WAV of `seconds` at `rate`, whose left and right channels carry a 440 Hz tone. */
function wav(seconds: number, rate = 48000) {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * 4;
  const header = new DataView(new ArrayBuffer(44));
  const str = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  header.setUint32(4, Math.min(0xffffffff, 36 + dataBytes), true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 2, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 4, true);
  header.setUint16(32, 4, true);
  header.setUint16(34, 16, true);
  str(36, 'data');
  header.setUint32(40, Math.min(0xffffffff, dataBytes), true);
  const h = new Uint8Array(header.buffer);
  return virtualFile(44 + dataBytes, (i) => {
    if (i < 44) return h[i]!;
    const frame = Math.floor((i - 44) / 4);
    const v = Math.round(Math.sin((2 * Math.PI * 440 * frame) / rate) * 16000);
    const lo = v & 0xff;
    const hi = (v >> 8) & 0xff;
    return (i - 44) % 2 === 0 ? lo : hi;
  });
}

const noDecoder: AudioDeps = { decode: () => Promise.reject(new Error('should not decode')) };

describe('lecture audio files', () => {
  it('opens a 3-hour WAV without reading it all, and reads any window from a small byte range', async () => {
    const file = wav(3 * 3600 + 5); // ≈ 2.07 GB on disk
    const src = await openAudio(file, noDecoder);
    expect(src.kind).toBe('wav');
    expect(src.length).toBe((3 * 3600 + 5) * RATE);
    expect(Math.max(...file.reads)).toBeLessThan(1024); // headers only

    const start = 2 * 3600 * RATE; // a 30 s window two hours in
    const win = await src.read(start, start + 30 * RATE);
    expect(win.length).toBe(30 * RATE);
    // About 30 s of 48 kHz stereo 16-bit (5.76 MB) was read for it, not the file.
    expect(file.reads.at(-1)!).toBeLessThan(6_000_000);
    // The tone survives resampling: RMS of a full-scale-ish sine (16000/32768 ≈ 0.49 → RMS ≈ 0.345).
    let ss = 0;
    for (const v of win) ss += v * v;
    expect(Math.sqrt(ss / win.length)).toBeCloseTo(0.345, 2);
  });

  it('refuses to put a 3-hour recording in one array, with a clear message', async () => {
    const src = await openAudio(wav(3 * 3600 + 5), noDecoder);
    await expect(readAll(src)).rejects.toThrow(/3 h 0 min long; uploads can be up to 2 hours/);
  });

  it('reads a short WAV whole, matching window-by-window reads', async () => {
    const src = await openAudio(wav(70, 44100), noDecoder);
    const all = await readAll(src, MAX_WHOLE_DECODE_HOURS, 7 * RATE); // seams every 7 s
    const direct = await src.read(20 * RATE, 22 * RATE);
    for (let i = 0; i < direct.length; i += 97) expect(all[20 * RATE + i]!).toBeCloseTo(direct[i]!, 4);
  });

  it('resamples without edge effects at slice boundaries', () => {
    const rate = 48000;
    const sig = new Float32Array(rate);
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin((2 * Math.PI * 300 * i) / rate);
    const whole = resampleSlice(sig, rate, 0, RATE, 0, RATE);
    const part = resampleSlice(sig.subarray(3000 - 30, 6000 + 30), rate, 3000 - 30, RATE, 1000, 2000);
    for (let i = 0; i < part.length; i++) expect(part[i]!).toBeCloseTo(whole[1000 + i]!, 5);
    // (away from the very start and end of the signal, where half the filter has no input)
    for (let i = 37; i < whole.length - 37; i += 37) expect(whole[i]!).toBeCloseTo(Math.sin((2 * Math.PI * 300 * i) / RATE), 2);
  });

  describe('MP3', () => {
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames of 1152 samples.
    const FRAME = 417;
    const mp3 = (frames: number, junk = 0) =>
      virtualFile(
        junk + frames * FRAME,
        () => 0,
        // Zeros, with a frame header every FRAME bytes after the junk (filled fast: only the headers are set).
        (u, start) => {
          const first = Math.max(0, Math.ceil((start - junk) / FRAME));
          for (let f = first; ; f++) {
            const at = junk + f * FRAME - start;
            if (at >= u.length) break;
            u.set([0xff, 0xfb, 0x90, 0x64].slice(0, u.length - at), at);
          }
        },
      );

    it('parses frame headers', () => {
      expect(mp3Frame(0xff, 0xfb, 0x90)).toEqual({ bytes: 417, samples: 1152, rate: 44100 });
      expect(mp3Frame(0xff, 0xfb, 0xf0)).toBeNull(); // bitrate index 15 is invalid
      expect(mp3Frame(0x49, 0x44, 0x33)).toBeNull(); // "ID3"
    });

    it('indexes a 3-hour file and decodes only the frames a window needs', async () => {
      const frames = Math.ceil((3 * 3600 * 44100) / 1152); // ≈ 172 MB at 128 kbps
      const file = mp3(frames, 300);
      const idx = await indexMp3(file);
      expect(idx?.count).toBe(frames);
      const decoded: number[] = [];
      const deps: AudioDeps = {
        // A fake decoder: returns 16 kHz silence-free audio for however many frames it was given.
        decode: async (data) => {
          const n = Math.round(((data.byteLength / FRAME) * 1152 * RATE) / 44100);
          decoded.push(data.byteLength);
          const d = new Float32Array(n).fill(0.25);
          return { sampleRate: RATE, numberOfChannels: 1, length: n, getChannelData: () => d } satisfies PcmBuffer;
        },
      };
      const src = await openAudio(file, deps);
      expect(src.kind).toBe('mp3');
      expect(Math.round(src.length / RATE)).toBe(3 * 3600);
      const w = await src.read(2 * 3600 * RATE, 2 * 3600 * RATE + 30 * RATE);
      expect(w.length).toBe(30 * RATE);
      expect(w[w.length >> 1]).toBeCloseTo(0.25, 5);
      // ~30 s of 128 kbps is ~480 KB; the pre-roll adds a few frames.
      expect(decoded).toHaveLength(1);
      expect(decoded[0]!).toBeLessThan(520_000);
    });

    it('does not take stray sync bytes in other formats for MP3', async () => {
      // An "M4A" with one lone 0xFFFB90 sequence: not followed by another frame, so not MP3.
      const file = virtualFile(200_000, (i) => (i === 5000 ? 0xff : i === 5001 ? 0xfb : i === 5002 ? 0x90 : 0x11));
      expect(await indexMp3(file)).toBeNull();
    });
  });

  it('refuses long recordings in formats that must be decoded whole, before decoding', async () => {
    let decodes = 0;
    const deps: AudioDeps = {
      decode: async () => {
        decodes++;
        throw new Error('no');
      },
      probeDuration: async () => 3 * 3600,
    };
    await expect(openAudio(virtualFile(100_000, () => 0x22), deps)).rejects.toThrow(/up to 2 hours in this format \(MP3 and WAV can be longer\)/);
    expect(decodes).toBe(0);
  });
});
