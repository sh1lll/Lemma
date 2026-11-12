// Offline sanity check of the Whisper model used for on-device voice: transcribes TTS fixtures
// and runs each transcript through the calculator. Usage: node scripts/whisper-check.mjs [model]
import { pipeline } from '@huggingface/transformers';
import { readFileSync, readdirSync } from 'node:fs';

const model = process.argv[2] ?? 'onnx-community/whisper-tiny.en';
const dir = new URL('./fixtures/', import.meta.url);

function readWavF32(buf) {
  // Minimal WAV reader for 32-bit float mono: find the "data" chunk.
  let o = 12;
  while (o < buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'data') return new Float32Array(buf.buffer.slice(buf.byteOffset + o + 8, buf.byteOffset + o + 8 + size));
    o += 8 + size;
  }
  throw new Error('no data chunk');
}

const t0 = performance.now();
const asr = await pipeline('automatic-speech-recognition', model, { dtype: 'q8' });
console.log(`loaded ${model} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
for (const f of readdirSync(dir).filter((f) => f.endsWith('.wav')).sort()) {
  const audio = readWavF32(readFileSync(new URL(f, dir)));
  const t = performance.now();
  const out = await asr(audio);
  console.log(`${f}  ${(performance.now() - t).toFixed(0)}ms  ${(audio.length / 16000).toFixed(1)}s audio  →  ${out.text.trim()}`);
}
