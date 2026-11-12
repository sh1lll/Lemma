import { createInterface } from 'node:readline';
import { createLemma, type OutcomeJSON } from '@lemma/sdk';

const HELP = `lemma: instant calculator, units, dates, finance, stats, science and algebra

Usage:
  lemma "20% of 450 + 30"          one answer
  lemma --json "50 miles to km"     full JSON result
  lemma                             interactive (follow-ups: "that", "ans", x = 5, f(x) = …)
  cat sums.txt | lemma              one answer per input line

Options:
  --json          print JSON (one object per line)
  --digits N      significant digits (default 12)
  --rad           angles in radians (default degrees)
  --offline       never fetch exchange rates
  -h, --help      this help
  --              end of options ("lemma -- -5 + 3")

Exit codes: 0 ok, 1 a question failed, 2 bad usage.

Symbolic algebra (derivatives, integrals, solve…) needs the optional "pyodide" package.`;

const args = process.argv.slice(2);
const flag = (f: string) => {
  const i = args.indexOf(f);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const value = (f: string) => {
  const i = args.indexOf(f);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

if (flag('-h') || flag('--help')) {
  console.log(HELP);
  process.exit(0);
}
function usage(message: string): never {
  process.stderr.write(`lemma: ${message}\nTry "lemma --help".\n`);
  process.exit(2);
}

const asJSON = flag('--json');
const digitsArg = args.includes('--digits') ? (value('--digits') ?? usage('--digits needs a number')) : '12';
const digits = Number(digitsArg);
if (!Number.isInteger(digits) || digits < 1 || digits > 50) usage(`--digits must be a whole number from 1 to 50 (got "${digitsArg}")`);
const rad = flag('--rad');
const offline = flag('--offline');
// Anything else that looks like an option is a typo ("--jsn"), not a question. "--" ends options.
const dashdash = args.indexOf('--');
const unknown = args.slice(0, dashdash < 0 ? args.length : dashdash).find((a) => /^--?[a-z]/i.test(a));
if (unknown) usage(`unknown option ${unknown}`);
if (dashdash >= 0) args.splice(dashdash, 1);

const om = await createLemma({ digits, angle: rad ? 'rad' : 'deg', liveRates: !offline, onStatus: (s) => s && process.stderr.write(`${s}\n`) });

function show(r: OutcomeJSON): string {
  if (asJSON) return JSON.stringify(r);
  if (!r.ok) return r.error ? `error: ${r.error.message}` : '';
  if (r.kind === 'graph') return `(graph: ${r.expression}; open Lemma to see it)`;
  const lines = [`${r.display ?? ''}${r.unit ? ` ${r.unit}` : ''}${r.verified?.ok ? '  ✓ verified' : ''}`];
  for (const l of r.lines ?? []) lines.push(`  ${l.label}: ${l.display}`);
  for (const a of r.alternatives ?? []) lines.push(`  or, ${a.label}: ${a.expression} = ${a.display}`);
  if (r.action) lines.push(`  (${r.action.type}s are kept by the Lemma app; the CLI doesn't store or run them)`);
  return lines.join('\n');
}

let failed = false;
async function run(q: string) {
  const r = await om.compute(q);
  if (!r.ok && r.kind !== 'empty') failed = true;
  const out = show(r);
  if (out) console.log(out);
}

if (args.length) {
  await run(args.join(' '));
  process.exit(failed ? 1 : 0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY, prompt: 'lemma> ' });
if (process.stdin.isTTY) {
  console.log('Lemma · type a calculation, "reset" to clear context, Ctrl+D to quit');
  rl.prompt();
}
for await (const line of rl) {
  const q = line.trim();
  if (q === 'reset') om.reset();
  else if (q && !q.startsWith('#')) await run(q);
  if (process.stdin.isTTY) rl.prompt();
}
process.exit(failed && !process.stdin.isTTY ? 1 : 0);
