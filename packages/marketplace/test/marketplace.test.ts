import type { Answer } from '@lemma/math-core';
import { CATALOG, matchPlugin, runFormula, type FormulaManifest, type PluginManifest } from '@lemma/plugin-engine';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSite, generateKeys, readSources, signIndex, verifySite } from '../cli/build';
import {
  canonicalJson,
  compareReleases,
  findUpdates,
  MarketplaceError,
  searchEntries,
  verifyManifest,
  verifySignedIndex,
  type MarketplaceBundle,
  type SignedIndex,
} from '../src';

const PKG = join(import.meta.dirname, '..');
const SRC = join(PKG, 'extensions');
const temps: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'lemma-market-'));
  temps.push(d);
  return d;
};
afterAll(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

const sources = await readSources(SRC);
const manifests = sources.map((s) => s.manifest);
const byId = (id: string) => manifests.find((m) => m.id === id) as FormulaManifest;

const run = (m: FormulaManifest, q: string) => {
  const match = matchPlugin(m, q);
  if (!match) throw new Error(`no match: ${q}`);
  const r = runFormula(m, match, q);
  if (!r.ok) throw new Error(r.error.message);
  return r as Answer;
};
const line = (a: Answer, label: string) => a.lines?.find((l) => l.label === label)?.display;

describe('seeded extensions', () => {
  it('include the whole built-in catalog, unchanged', () => {
    for (const c of CATALOG) expect(canonicalJson(manifests.find((m) => m.id === c.id))).toBe(canonicalJson(c));
    expect(manifests.length).toBe(CATALOG.length + 6);
  });

  it('every example matches only its own extension', () => {
    for (const m of manifests)
      for (const ex of m.examples ?? []) {
        const hits = manifests.filter((o) => matchPlugin(o, ex.input)).map((o) => o.id);
        expect(hits, ex.input).toEqual([m.id]);
      }
  });

  it('none captures everyday calculator input', () => {
    const everyday = ['5 + 5', '12 * (3 + 4)', 'pace', 'scale', 'save 100', 'screen size', 'concrete', 'led', '20% of 450', '65 inch in cm', 'save 10000 in 5 years', 'scale 2 cups to ml', 'pace for 10 km', 'what is 4% of 10000'];
    for (const q of everyday) for (const m of manifests) expect(matchPlugin(m, q), `${m.id} vs ${q}`).toBeNull();
  });

  it('LED resistor: Ohm’s law and resistor power', () => {
    const m = byId('lemma.led-resistor');
    const a = run(m, 'led resistor 5 v 2 v 20 ma');
    expect(a.primary.display).toBe('150');
    expect(line(a, 'Power in the resistor')).toBe('60 mW');
    expect(run(m, 'led resistor 3.3 2.0 10').primary.display).toBe('130');
    expect(runFormula(m, matchPlugin(m, 'led resistor 5 v 2 v 0 ma')!, 'x').ok).toBe(false); // current must be > 0
  });

  it('Running pace: min/km, s/km, km/h, marathon time', () => {
    const a = run(byId('lemma.running-pace'), 'pace for 10 km in 50 minutes');
    expect(a.primary.display).toBe('5.00');
    expect(line(a, 'Seconds per km')).toBe('300 s');
    expect(line(a, 'Speed')).toBe('12.0 km/h');
    expect(line(a, 'Marathon at this pace')).toBe('3.52 h');
  });

  it('Recipe scaler: proportional, with the factor', () => {
    const m = byId('lemma.recipe-scale');
    const a = run(m, 'scale 250 from 4 to 6 servings');
    expect(line(a, 'Factor')).toBe('1.500 ×');
    expect(run(m, 'scale recipe 1.5 6 2').primary.display).toBe('0.50');
    expect(runFormula(m, matchPlugin(m, 'scale 1 from 0 to 2 servings')!, 'x').ok).toBe(false); // no division by zero
  });

  it('Concrete slab: volume, 10% extra and weight', () => {
    const a = run(byId('lemma.concrete-slab'), 'concrete 5 m x 4 m x 12 cm');
    expect(a.primary.display).toBe('2.40');
    expect(line(a, 'With 10% extra')).toBe('2.64 m³');
    expect(line(a, 'Weight (about 2,400 kg/m³)')).toMatch(/^5,?760 kg$/);
  });

  it('Savings goal: annuity formula, totals add up', () => {
    const m = byId('lemma.savings-goal');
    const a = run(m, 'save 10000 in 5 years at 4%');
    expect(a.primary.display).toBe('150.83');
    const paid = Number(line(a, 'You pay in')!.replace(/,/g, ''));
    const interest = Number(line(a, 'Interest earned')!.replace(/,/g, ''));
    expect(paid + interest).toBeCloseTo(10000, 1);
    // Cross-check against the closed form in floating point.
    const r = 0.04 / 12;
    expect(Number(a.value!.toString())).toBeCloseTo((10000 * r) / ((1 + r) ** 60 - 1), 6);
    expect(runFormula(m, matchPlugin(m, 'save 1000 in 2 years at 0%')!, 'x').ok).toBe(false); // 0% would divide by zero
  });

  it('16:9 screen: width/height from the diagonal (Pythagoras)', () => {
    const a = run(byId('lemma.screen-size'), 'screen size 55 inches');
    const w = Number(a.value!.toString()) / 2.54;
    const h = Number(line(a, 'Height (inches)')!.replace(' in', ''));
    expect(Math.hypot(w, h)).toBeCloseTo(55, 0);
    expect(line(a, 'Width (inches)')).toBe('47.9 in');
    expect(a.primary.display).toBe('121.8');
  });
});

describe('signed index', () => {
  it('the committed site verifies against the app’s trusted key and matches the sources', async () => {
    expect((await verifySite(join(PKG, 'site'))).entries).toBe(manifests.length);
    const bundle = JSON.parse(await readFile(join(PKG, 'site', 'bundle.json'), 'utf8')) as MarketplaceBundle;
    for (const m of manifests) expect(canonicalJson(bundle.manifests[m.id]), `${m.id}: run "npm run build -w @lemma/marketplace"`).toBe(canonicalJson(m));
  });

  const keys = generateKeys();
  const trusted = { [keys.keyId]: keys.publicKey };
  const built = async () => {
    const out = await temp();
    const { signed } = await buildSite({ srcDir: SRC, outDir: out, privatePem: keys.privatePem, trustedKeys: trusted, now: new Date('2026-10-30T00:00:00Z') });
    return { out, signed: JSON.parse(JSON.stringify(signed)) as SignedIndex };
  };

  it('builds, signs and verifies; every manifest hash checks out', async () => {
    const { out, signed } = await built();
    const index = await verifySignedIndex(signed, trusted);
    expect(index.entries.map((e) => e.category)).toContain('cooking');
    expect(await verifySite(out, trusted)).toEqual({ entries: manifests.length });
    const e = index.entries.find((x) => x.id === 'lemma.roman')!;
    expect(e.kind).toBe('script');
    const m = await verifyManifest(e, JSON.parse(await readFile(join(out, e.path), 'utf8')));
    expect(m.id).toBe('lemma.roman');
  });

  it('rejects any change to the listing, an unknown key, or a missing signature', async () => {
    const { signed } = await built();
    const altered = structuredClone(signed);
    altered.index.entries[0]!.description += ' (now with more features)';
    await expect(verifySignedIndex(altered, trusted)).rejects.toThrow(/signature/);
    const swapped = structuredClone(signed);
    swapped.index.entries[0]!.sha256 = swapped.index.entries[1]!.sha256;
    await expect(verifySignedIndex(swapped, trusted)).rejects.toThrow(MarketplaceError);
    await expect(verifySignedIndex(signed, { other: keys.publicKey })).rejects.toThrow(/doesn’t trust/);
    await expect(verifySignedIndex({ ...signed, signature: undefined }, trusted)).rejects.toThrow(/not signed/);
    // A different key signing a perfectly valid index is still refused.
    const evil = generateKeys();
    await expect(verifySignedIndex(signIndex(signed.index, evil.privatePem), trusted)).rejects.toThrow(/doesn’t trust/);
    await expect(verifySignedIndex({ ...signIndex(signed.index, evil.privatePem), keyId: keys.keyId }, trusted)).rejects.toThrow(/signature/);
  });

  it('rejects a manifest that differs from its hash (e.g. a host swapping the script)', async () => {
    const { out, signed } = await built();
    const e = signed.index.entries.find((x) => x.id === 'lemma.roman')!;
    const m = JSON.parse(await readFile(join(out, e.path), 'utf8')) as PluginManifest & { script: string };
    m.script = 'function run(){ return { display: "pwned" } }';
    await expect(verifyManifest(e, m)).rejects.toThrow(/hash mismatch/);
    const bmi = signed.index.entries.find((x) => x.id === 'lemma.bmi')!;
    await expect(verifyManifest(bmi, JSON.parse(await readFile(join(out, e.path), 'utf8')))).rejects.toThrow(/hash mismatch/);
  });

  it('build refuses bad sources: wrong example, unknown category, republished release', async () => {
    const src = await temp();
    const write = async (rel: string, m: unknown) => {
      await mkdir(join(src, rel, '..'), { recursive: true });
      await writeFile(join(src, rel), JSON.stringify(m));
    };
    const good = { ...CATALOG[0]!, id: 'test.bmi' };
    await write('health-fitness/test.bmi.json', good);
    const out = await temp();
    await buildSite({ srcDir: src, outDir: out, privatePem: keys.privatePem, trustedKeys: trusted });
    await write('health-fitness/test.bmi.json', { ...good, description: 'changed' });
    await expect(buildSite({ srcDir: src, outDir: out, privatePem: keys.privatePem, trustedKeys: trusted })).rejects.toThrow(/bump "release"/);
    await write('health-fitness/test.bmi.json', { ...good, description: 'changed', release: '1.0.1' });
    const { signed } = await buildSite({ srcDir: src, outDir: out, privatePem: keys.privatePem, trustedKeys: trusted });
    expect(signed.index.entries[0]!.release).toBe('1.0.1');
    await write('health-fitness/test.bmi.json', { ...good, examples: [{ input: 'bmi 70 kg 1.75 m', expect: '99' }] });
    await expect(readSources(src)).rejects.toThrow(/gives 22.9, expected 99/);
    await write('health-fitness/test.bmi.json', good);
    await write('gambling/test.x.json', { ...good, id: 'test.x' });
    await expect(readSources(src)).rejects.toThrow(/unknown category/);
    // An untrusted signing key is caught at build time, with instructions.
    await rm(join(src, 'gambling'), { recursive: true });
    await expect(buildSite({ srcDir: src, outDir: await temp(), privatePem: generateKeys().privatePem, trustedKeys: trusted })).rejects.toThrow(/keys\.ts/);
  });
});

describe('helpers', () => {
  it('compares releases numerically', () => {
    expect(compareReleases('1.10.0', '1.9.2')).toBe(1);
    expect(compareReleases('1.0', '1.0.0')).toBe(0);
    expect(compareReleases('2.0.0', '10.0.0')).toBe(-1);
  });

  it('finds updates and searches by words and category', async () => {
    const { signed } = JSON.parse(await readFile(join(PKG, 'site', 'bundle.json'), 'utf8')) as MarketplaceBundle;
    const index = signed.index;
    expect(findUpdates([{ id: 'lemma.bmi', release: '0.9.0' }, { id: 'lemma.paint', release: '1.0.0' }, { id: 'someone.else', release: '0.1' }], index).map((u) => u.id)).toEqual(['lemma.bmi']);
    expect(searchEntries(index.entries, 'trip cost').map((e) => e.id).sort()).toEqual(['lemma.trip-fuel-metric', 'lemma.trip-fuel-us']);
    expect(searchEntries(index.entries, 'RÉSISTOR led').map((e) => e.id)).toEqual(['lemma.led-resistor']);
    expect(searchEntries(index.entries, '', 'cooking').map((e) => e.id)).toEqual(['lemma.recipe-scale']);
    expect(searchEntries(index.entries, 'fuel', 'cooking')).toEqual([]);
  });
});
