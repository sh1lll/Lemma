// Runs a packaged build's self-test (LEMMA_SMOKE in main.mjs) and fails unless the calculator answers and,
// with --ai, the built-in model answers too (downloads the ~0.5 GB model on first run).
//   node scripts/smoke-packaged.mjs [--ai] [-- <command> <args...>]
// Without a command it runs this platform's build in release/. Pass one for Wine, xvfb-run, etc.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const release = path.join(import.meta.dirname, '..', 'release');
const args = process.argv.slice(2);
const ai = args.includes('--ai');
const sep = args.indexOf('--');
const fallback = {
  darwin: [`mac${process.arch === 'arm64' ? '-arm64' : ''}/Lemma.app/Contents/MacOS/Lemma`],
  win32: ['win-unpacked/Lemma.exe'],
  linux: ['linux-unpacked/lemma', '--no-sandbox'],
}[process.platform];
const [cmd, ...cmdArgs] = sep >= 0 ? args.slice(sep + 1) : [path.join(release, fallback[0]), ...fallback.slice(1)];
if (!existsSync(cmd) && sep < 0) throw new Error(`no build at ${cmd}; run the dist script first`);

const out = path.join(mkdtempSync(path.join(tmpdir(), 'lemma-smoke-')), 'out.txt');
const env = {
  ...process.env,
  LEMMA_SMOKE: '1',
  LEMMA_SMOKE_OUT: out,
  // The calculator check is built into the self-test (both windows); this only adds the assistant question.
  LEMMA_SMOKE_QUERIES: ai ? 'ask:What is 6 times 7?' : '',
};
const child = spawn(cmd, cmdArgs, { env, stdio: 'inherit' });
// A stuck app gets a polite stop, then a forced one: an app hung mid-quit ignores the first.
const timer = setTimeout(() => {
  console.log('self-test timed out');
  child.kill();
  setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
}, (ai ? 20 : 3) * 60_000);
const code = await new Promise((r) => child.on('exit', r));
clearTimeout(timer);

const lines = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n') : [];
console.log(lines.join('\n') || '(no self-test output)');
const line = (tag) => lines.find((l) => l.startsWith(tag + ' '));
const smoke = line('SMOKE') && JSON.parse(line('SMOKE').slice(6));
const checks = {
  'app started': !!smoke && !line('SMOKE-ERROR'),
  'calculator answers 120': smoke?.main.value.includes('120') && smoke?.overlay.value.includes('120'),
  'desktop bridge loaded': smoke?.main.bridge === 'object',
  ...(ai ? { 'built-in AI answers 42': /\b42\b/.test(line('ASK') ?? '') } : {}),
};
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
console.log(`self-test passed (app exit code ${code})`);
