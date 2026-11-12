import { CATALOG } from '@lemma/plugin-engine';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, generateKeys, verifySite } from './build';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEY = join(PKG, '.keys', 'marketplace-ed25519.pem');

const HELP = `lemma-marketplace <command>

  keygen  [--out <pem>]                       Create the Ed25519 signing key (default packages/marketplace/.keys/, gitignored)
  build   [--src <dir>] [--out <dir>] [--key <pem>]
                                              Validate, test and hash every manifest in <src>/<category>/<id>.json,
                                              sign the index, write <out>/index.json, manifests/ and bundle.json.
                                              The key can also come from $LEMMA_MARKETPLACE_KEY (PEM text, for CI).
  verify  [--site <dir>]                      Check the signature and every manifest hash of a built site.
  import-catalog [--src <dir>]                One-off: write the built-in catalog into the sources folder.
`;

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) out[a.slice(2)] = args[i + 1] ?? '';
    if (a.startsWith('--')) i++;
  }
  return out;
}

/** Category of each built-in catalog extension. */
const CATALOG_CATEGORIES: Record<string, string> = {
  'lemma.bmi': 'health-fitness',
  'lemma.trip-fuel-metric': 'travel',
  'lemma.trip-fuel-us': 'travel',
  'lemma.paint': 'home-diy',
  'lemma.power-cost': 'home-diy',
  'lemma.download-time': 'science-tech',
  'lemma.roman': 'numbers-text',
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const f = flags(rest);
  try {
    if (cmd === 'keygen') {
      const out = resolve(f.out || DEFAULT_KEY);
      if (existsSync(out)) throw new Error(`${out} already exists; refusing to overwrite a signing key`);
      const k = generateKeys();
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, k.privatePem, { mode: 0o600 });
      await chmod(out, 0o600);
      console.log(`Private key written to ${out} (keep it out of the repo; it is gitignored).\n`);
      console.log(`Add the public key to packages/marketplace/src/keys.ts:\n\n  '${k.keyId}': '${k.publicKey}',\n`);
      return 0;
    }
    if (cmd === 'build') {
      const src = resolve(f.src || join(PKG, 'extensions'));
      const out = resolve(f.out || join(PKG, 'site'));
      const privatePem = process.env.LEMMA_MARKETPLACE_KEY || (await readFile(resolve(f.key || DEFAULT_KEY), 'utf8').catch(() => ''));
      if (!privatePem) throw new Error(`No signing key. Run "lemma-marketplace keygen", pass --key, or set LEMMA_MARKETPLACE_KEY.`);
      const { signed, written } = await buildSite({ srcDir: src, outDir: out, privatePem });
      console.log(`Signed ${signed.index.entries.length} extensions with ${signed.keyId} (${signed.index.generated}).`);
      console.log(`Wrote ${written.length} files to ${out}`);
      return 0;
    }
    if (cmd === 'verify') {
      const site = resolve(f.site || join(PKG, 'site'));
      const { entries } = await verifySite(site);
      console.log(`OK: signature valid, ${entries} manifests match their hashes.`);
      return 0;
    }
    if (cmd === 'import-catalog') {
      const src = resolve(f.src || join(PKG, 'extensions'));
      for (const m of CATALOG) {
        const cat = CATALOG_CATEGORIES[m.id] ?? 'numbers-text';
        const file = join(src, cat, `${m.id}.json`);
        if (existsSync(file)) continue;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(m, null, 2)}\n`);
        console.log(`wrote ${file}`);
      }
      return 0;
    }
    console.log(HELP);
    return cmd ? 1 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
