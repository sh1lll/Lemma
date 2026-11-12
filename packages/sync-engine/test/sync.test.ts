import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  CorruptFileError,
  decrypt,
  diffSummary,
  emptySnapshot,
  encrypt,
  estimatePassphraseStrength,
  formulasToItems,
  HEADER_LEN,
  itemsToFormulas,
  itemsToVariables,
  merge,
  parseSnapshot,
  NotLemmaFileError,
  readHeader,
  snapshotSize,
  stampSettings,
  toSnapshotSettings,
  trackChanges,
  UnsupportedVersionError,
  variablesToItems,
  WeakPassphraseError,
  WrongPassphraseError,
  type HistoryEntry,
  type SyncRecord,
  type SyncSnapshot,
} from '../src';

const NOW = Date.UTC(2026, 9, 30);
const DAY = 86_400_000;
const PASS = 'correct horse battery staple 42';

const snap = (deviceId: string, collections: Record<string, SyncRecord[]>, extra: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  format: 'lemma-sync',
  version: 1,
  deviceId,
  createdAt: NOW,
  collections,
  ...extra,
});

const entry = (i: number, at = NOW): HistoryEntry => ({
  id: `h${i}`,
  input: `${i} + 1`,
  expression: `${i}+1`,
  display: String(i + 1),
  plain: String(i + 1),
  at,
});

const sample = (): SyncSnapshot =>
  buildSnapshot({
    deviceId: 'laptop',
    now: NOW,
    collections: {
      history: trackChanges([], [entry(1), entry(2)], { now: NOW, device: 'laptop' }),
      notebooks: [{ id: 'n1', updated: NOW, version: 1, title: 'Physics', angle: 'rad', cells: [{ id: 'c1', type: 'math', source: 'x = 2' }], created: NOW }],
    },
    settings: { angle: 'rad', digits: 10, theme: 'dark' },
    settingsUpdated: { angle: NOW, digits: NOW },
  });

/** Data that must be independent of merge order (the merged deviceId is always the local one). */
const content = (s: SyncSnapshot) => ({ collections: s.collections, settings: s.settings, settingsUpdated: s.settingsUpdated, createdAt: s.createdAt });

describe('encryption', () => {
  it('round-trips a snapshot', async () => {
    const s = sample();
    const bytes = await encrypt(s, PASS);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('LEMMENC1');
    const h = readHeader(bytes);
    expect(h.iterations).toBeGreaterThanOrEqual(600_000);
    expect(h.compressed).toBe(true);
    expect(await decrypt(bytes, PASS)).toEqual(s);
  });

  it('round-trips without compression', async () => {
    const s = sample();
    const bytes = await encrypt(s, PASS, { compress: false });
    expect(readHeader(bytes).compressed).toBe(false);
    expect(await decrypt(bytes, PASS)).toEqual(s);
  });

  it('produces different bytes each time (random salt and IV)', async () => {
    const s = sample();
    const [a, b] = await Promise.all([encrypt(s, PASS), encrypt(s, PASS)]);
    expect(Buffer.from(a.slice(18, 46)).equals(Buffer.from(b.slice(18, 46)))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects a wrong passphrase', async () => {
    const bytes = await encrypt(sample(), PASS);
    await expect(decrypt(bytes, 'not the right passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects a tampered ciphertext byte or header byte', async () => {
    const bytes = await encrypt(sample(), PASS);
    const body = bytes.slice();
    body[HEADER_LEN + 5]! ^= 0x01;
    await expect(decrypt(body, PASS)).rejects.toBeInstanceOf(CorruptFileError);
    const tag = bytes.slice();
    tag[tag.length - 1]! ^= 0x80;
    await expect(decrypt(tag, PASS)).rejects.toBeInstanceOf(CorruptFileError);
    const flag = bytes.slice();
    flag[14] = 0; // claim "uncompressed": header is authenticated, so this fails too
    await expect(decrypt(flag, PASS)).rejects.toBeInstanceOf(CorruptFileError);
  });

  it('rejects truncated files', async () => {
    const bytes = await encrypt(sample(), PASS);
    await expect(decrypt(bytes.slice(0, bytes.length - 1), PASS)).rejects.toBeInstanceOf(CorruptFileError);
    await expect(decrypt(bytes.slice(0, 40), PASS)).rejects.toBeInstanceOf(CorruptFileError);
    await expect(decrypt(bytes.slice(0, 5), PASS)).rejects.toBeInstanceOf(CorruptFileError);
  });

  it('rejects files that are not Lemma files', async () => {
    const bytes = await encrypt(sample(), PASS);
    const wrong = bytes.slice();
    wrong[0] = 0x50; // 'P'
    await expect(decrypt(wrong, PASS)).rejects.toBeInstanceOf(NotLemmaFileError);
    await expect(decrypt(new TextEncoder().encode('{"format":"lemma-sync"}'), PASS)).rejects.toBeInstanceOf(NotLemmaFileError);
    await expect(decrypt(new Uint8Array(0), PASS)).rejects.toBeInstanceOf(CorruptFileError);
  });

  it('rejects unsupported versions', async () => {
    const bytes = await encrypt(sample(), PASS);
    const v2magic = bytes.slice();
    v2magic[7] = 0x32; // LEMMENC2
    await expect(decrypt(v2magic, PASS)).rejects.toBeInstanceOf(UnsupportedVersionError);
    const v2byte = bytes.slice();
    v2byte[8] = 2;
    await expect(decrypt(v2byte, PASS)).rejects.toBeInstanceOf(UnsupportedVersionError);
    const kdf = bytes.slice();
    kdf[9] = 9;
    await expect(decrypt(kdf, PASS)).rejects.toBeInstanceOf(UnsupportedVersionError);
  });

  it('refuses short passphrases and exposes typed codes', async () => {
    const err = await encrypt(sample(), 'short').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeakPassphraseError);
    expect((err as WeakPassphraseError).code).toBe('weak-passphrase');
    expect((err as Error).message).not.toContain('short');
  });

  it('scores passphrase strength', () => {
    expect(estimatePassphraseStrength('').score).toBe(0);
    expect(estimatePassphraseStrength('password123').score).toBe(0);
    expect(estimatePassphraseStrength('aaaaaaaaaaaa').score).toBe(0);
    expect(estimatePassphraseStrength('Abc1!').score).toBe(1);
    expect(estimatePassphraseStrength('abcdefghijkl').score).toBeLessThanOrEqual(1);
    expect(estimatePassphraseStrength('violet tractor museum quietly orbit').score).toBe(4);
    for (const p of ['', 'x', 'hunter2hunter2', 'Tr0ub4dor&3xyz', 'violet tractor museum']) {
      const r = estimatePassphraseStrength(p);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(4);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

// Seeded random snapshots: few ids, few timestamps and few devices so ties and conflicts are common.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomSnapshot(r: () => number, deviceId: string): SyncSnapshot {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const collections: Record<string, SyncRecord[]> = {};
  for (const name of ['history', 'notebooks', 'reminders']) {
    if (r() < 0.2) continue;
    const recs: SyncRecord[] = [];
    const n = Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      const rec: SyncRecord = { id: `r${Math.floor(r() * 6)}`, updated: NOW - Math.floor(r() * 4) * 1000, device: pick(['a', 'b', 'c']) };
      if (r() < 0.3) rec.deleted = true;
      else rec.value = pick(['x', 'y', 'z', 1, 2, { k: [1, 2] }]);
      recs.push(rec);
    }
    collections[name] = recs;
  }
  const s = snap(deviceId, collections, { createdAt: NOW - Math.floor(r() * 5) });
  if (r() < 0.8) {
    s.settings = {};
    s.settingsUpdated = {};
    for (const k of ['angle', 'digits', 'currency']) {
      if (r() < 0.3) continue;
      s.settings[k] = pick(['deg', 'rad', 10, 12, '$', '€']);
      if (r() < 0.8) s.settingsUpdated[k] = NOW - Math.floor(r() * 3);
    }
  }
  return s;
}

describe('merge laws (seeded property test)', () => {
  const opts = { now: NOW };
  const m = (a: SyncSnapshot, b: SyncSnapshot) => merge(a, b, opts).merged;
  const r = rng(20261030);

  it('is commutative, idempotent and associative over 500 random triples', () => {
    for (let i = 0; i < 500; i++) {
      // Normalize inputs once (dedupe, sort), the state every device actually stores.
      const a = m(randomSnapshot(r, 'A'), emptySnapshot('A', 0));
      const b = m(randomSnapshot(r, 'B'), emptySnapshot('B', 0));
      const c = m(randomSnapshot(r, 'C'), emptySnapshot('C', 0));
      expect(content(m(a, b))).toEqual(content(m(b, a)));
      expect(m(a, a)).toEqual(a);
      const ab = m(a, b);
      expect(m(ab, b)).toEqual(ab);
      expect(merge(ab, b, opts).changes).toEqual({ added: [], updated: [], deleted: [], conflicts: [], settings: [] });
      expect(content(m(m(a, b), c))).toEqual(content(m(a, m(b, c))));
    }
  });
});

describe('merge behaviour', () => {
  it('takes the newer edit and reports changes', () => {
    const local = snap('A', { history: [{ id: 'h1', updated: 1, plain: 'old' }] });
    const remote = snap('B', {
      history: [{ id: 'h1', updated: 2, plain: 'new' }, { id: 'h2', updated: 1, plain: '2' }],
      notebooks: [{ id: 'n1', updated: 5, title: 'T' }],
    });
    const { merged, changes } = merge(local, remote, { now: NOW });
    expect(merged.deviceId).toBe('A');
    expect(merged.collections.history).toEqual([{ id: 'h1', updated: 2, plain: 'new' }, { id: 'h2', updated: 1, plain: '2' }]);
    expect(changes.added).toEqual([{ collection: 'history', id: 'h2' }, { collection: 'notebooks', id: 'n1' }]);
    expect(changes.updated).toEqual([{ collection: 'history', id: 'h1' }]);
  });

  it('propagates deletes as tombstones instead of resurrecting', () => {
    const t0 = NOW - 10 * DAY;
    const prev = trackChanges([], [entry(1), entry(2)], { now: t0, device: 'A' });
    const phone = snap('B', { history: prev });
    // Laptop deletes h1.
    const laptopRecs = trackChanges(prev, [entry(2)], { now: t0 + 1000, device: 'A' });
    const laptop = snap('A', { history: laptopRecs });
    expect(laptopRecs.find((x) => x.id === 'h1')).toEqual({ id: 'h1', updated: t0 + 1000, deleted: true, device: 'A' });
    const onPhone = merge(phone, laptop, { now: NOW });
    expect(onPhone.changes.deleted).toEqual([{ collection: 'history', id: 'h1' }]);
    expect(diffSummary(onPhone.changes)).toBe('1 history entry deleted');
    // Phone merges back its stale copy: still deleted.
    const back = merge(laptop, phone, { now: NOW });
    expect(back.merged.collections.history!.find((x) => x.id === 'h1')!.deleted).toBe(true);
    expect(back.changes.added).toEqual([]);
    // A newer edit after the delete wins over the tombstone.
    const revived = snap('B', { history: [{ ...entry(1), updated: t0 + 5000 }] });
    expect(merge(laptop, revived, { now: NOW }).changes.added).toEqual([{ collection: 'history', id: 'h1' }]);
    // A tombstone wins a timestamp tie against an edit.
    const tie = snap('B', { history: [{ ...entry(1), updated: t0 + 1000, device: 'Z' }] });
    expect(merge(laptop, tie, { now: NOW }).merged.collections.history!.find((x) => x.id === 'h1')!.deleted).toBe(true);
  });

  it('garbage-collects tombstones older than 90 days', () => {
    const local = snap('A', {
      notes: [
        { id: 'old', updated: NOW - 91 * DAY, deleted: true },
        { id: 'recent', updated: NOW - 89 * DAY, deleted: true },
        { id: 'live', updated: NOW - 400 * DAY, text: 'kept' },
      ],
    });
    const { merged } = merge(local, emptySnapshot('B', NOW), { now: NOW });
    expect(merged.collections.notes!.map((x) => x.id)).toEqual(['live', 'recent']);
  });

  it('flags records a device offline past the tombstone window would bring back', () => {
    const note = { id: 'n1', updated: NOW - 200 * DAY, text: 'deleted on the laptop 100 days ago' };
    const fresh = { id: 'n2', updated: NOW - DAY, text: 'written offline yesterday' };
    // The laptop's tombstone for n1 has been collected: it simply doesn't have n1 any more.
    const laptop = snap('A', { notes: [] }, { createdAt: NOW });
    const oldPhone = snap('B', { notes: [note, fresh] }, { createdAt: NOW });
    // Phone merging the server copy, last synced 120 days ago: n1 is flagged, n2 (newer than that sync) is not.
    const onPhone = merge(oldPhone, laptop, { now: NOW, localSyncedAt: NOW - 120 * DAY });
    expect(onPhone.maybeDeleted).toEqual([{ collection: 'notes', id: 'n1' }]);
    expect(onPhone.merged.collections.notes!.map((x) => x.id)).toEqual(['n1', 'n2']); // kept: reported, not dropped
    // Importing an old backup: its snapshot is older than the window, so what only it has is flagged.
    const oldBackup = snap('B', { notes: [note] }, { createdAt: NOW - 120 * DAY });
    expect(merge(laptop, oldBackup, { now: NOW }).maybeDeleted).toEqual([{ collection: 'notes', id: 'n1' }]);
    // Within the window nothing is flagged.
    expect(merge(oldPhone, laptop, { now: NOW, localSyncedAt: NOW - 30 * DAY }).maybeDeleted).toEqual([]);
    expect(merge(laptop, { ...oldBackup, createdAt: NOW - 30 * DAY }, { now: NOW }).maybeDeleted).toEqual([]);
  });

  it('reports same-timestamp conflicts and resolves them deterministically', () => {
    const a = snap('A', { notes: [{ id: 'n', updated: 7, device: 'A', text: 'from A' }] });
    const b = snap('B', { notes: [{ id: 'n', updated: 7, device: 'B', text: 'from B' }] });
    const ab = merge(a, b, { now: NOW });
    const ba = merge(b, a, { now: NOW });
    expect(ab.merged.collections.notes).toEqual(ba.merged.collections.notes);
    expect(ab.merged.collections.notes![0]!.text).toBe('from B');
    expect(ab.changes.conflicts).toEqual([{ collection: 'notes', id: 'n' }]);
    expect(ab.changes.updated).toEqual([{ collection: 'notes', id: 'n' }]);
    expect(ba.changes.conflicts).toEqual([]); // B's own version was kept
    expect(diffSummary(ab.changes)).toBe('1 note updated, 1 conflict resolved');
  });

  it('merges settings key by key using timestamps', () => {
    const a = snap('A', {}, { settings: { angle: 'rad', digits: 10, currency: '$' }, settingsUpdated: { angle: 5, digits: 1, currency: 3 } });
    const b = snap('B', {}, { settings: { angle: 'deg', digits: 14, grouping: false }, settingsUpdated: { angle: 2, digits: 9, grouping: 4 } });
    const { merged, changes } = merge(a, b, { now: NOW });
    expect(merged.settings).toEqual({ angle: 'rad', digits: 14, currency: '$', grouping: false });
    expect(merged.settingsUpdated).toEqual({ angle: 5, digits: 9, currency: 3, grouping: 4 });
    expect(changes.settings.sort()).toEqual(['digits', 'grouping']);
    expect(content(merge(b, a, { now: NOW }).merged)).toEqual(content(merged));
  });

  it('stamps only changed settings', () => {
    const stamps = stampSettings({ angle: 'deg', digits: 12 }, { angle: 'rad', digits: 12 }, { angle: 1, digits: 1 }, 100);
    expect(stamps).toEqual({ angle: 100, digits: 1 });
  });
});

describe('settings filter', () => {
  const settings = {
    angle: 'deg',
    digits: 12,
    voiceEngine: 'whisper',
    showKeypad: true,
    theme: 'dark',
    aiProvider: 'anthropic',
    aiModels: { anthropic: 'model-x' },
    aiKey: 'sk-ant-SECRET1',
    apiKey: 'sk-SECRET2',
    aiKeys: { anthropic: 'sk-ant-SECRET3' },
    nested: { openaiApiKey: 'sk-SECRET4', token: 'SECRET5', fine: 1 },
  };

  it('never includes API keys or device-specific choices', () => {
    const out = toSnapshotSettings(settings);
    expect(out).toEqual({ angle: 'deg', digits: 12, aiProvider: 'anthropic', aiModels: { anthropic: 'model-x' }, nested: { fine: 1 } });
    expect(toSnapshotSettings(settings, { syncTheme: true }).theme).toBe('dark');
  });

  it('keeps secrets out of built snapshots and encrypted plaintext', async () => {
    const s = buildSnapshot({ deviceId: 'A', collections: {}, settings, settingsUpdated: { aiKey: 9, angle: 3 }, now: NOW });
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/SECRET/);
    expect(s.settingsUpdated).toEqual({ angle: 3, digits: 0, aiProvider: 0, aiModels: 0, nested: 0 });
    expect(JSON.stringify(await decrypt(await encrypt(s, PASS), PASS))).not.toMatch(/SECRET/);
  });
});

describe('adapters and helpers', () => {
  it('tracks changes, keeping unchanged versions', () => {
    const v1 = trackChanges([], [entry(1)], { now: 100, device: 'A' });
    expect(trackChanges(v1, [entry(1)], { now: 200, device: 'A' })[0]).toBe(v1[0]);
    const edited = trackChanges(v1, [{ ...entry(1), pinned: true }], { now: 200, device: 'A' });
    expect(edited[0]!.updated).toBe(200);
  });

  it('converts variables and formulas', () => {
    const vars = trackChanges([], variablesToItems({ x: '2.5', rate: '0.07' }), { now: 1 });
    expect(itemsToVariables(vars)).toEqual({ x: '2.5', rate: '0.07' });
    const f1 = trackChanges([], formulasToItems(['f(x) = x^2', 'area(r) = pi r^2']), { now: 1 });
    const f2 = trackChanges(f1, formulasToItems(['f(x) = x^3', 'area(r) = pi r^2']), { now: 2 });
    expect(f2.map((r) => r.id)).toEqual(['f', 'area']);
    expect(itemsToFormulas(f2)).toEqual(['f(x) = x^3', 'area(r) = pi r^2']);
  });

  it('summarizes changes in a sentence', () => {
    const refs = (collection: string, n: number) => Array.from({ length: n }, (_, i) => ({ collection, id: String(i) }));
    expect(
      diffSummary({ added: refs('history', 12), updated: refs('notebooks', 1), deleted: refs('notebooks', 2), conflicts: [], settings: [] }),
    ).toBe('12 history entries added, 1 notebook updated, 2 deleted');
    expect(diffSummary({ added: refs('widgets', 1), updated: [], deleted: [], conflicts: [], settings: ['angle'] })).toBe(
      '1 widgets record added, 1 setting changed',
    );
    expect(diffSummary({ added: [], updated: [], deleted: [], conflicts: [], settings: [] })).toBe('Already up to date');
  });

  it('measures snapshot size in bytes', () => {
    const s = snap('A', { notes: [{ id: 'é', updated: 1 }] });
    expect(snapshotSize(s)).toBe(Buffer.byteLength(JSON.stringify(s)));
  });
});

describe('performance', () => {
  it('merges 10,000 history records in under 200 ms', () => {
    const make = (offset: number, device: string) =>
      snap(device, {
        history: Array.from({ length: 10_000 }, (_, i) => ({ ...entry(i), updated: NOW - 1000 + ((i * 7 + offset) % 997), device })),
      });
    const a = make(0, 'A');
    const b = make(3, 'B');
    merge(a, b, { now: NOW }); // warm up
    const t = performance.now();
    const { merged } = merge(a, b, { now: NOW });
    const ms = performance.now() - t;
    expect(merged.collections.history).toHaveLength(10_000);
    expect(ms).toBeLessThan(200);
  });
});

describe('snapshot keys are data, not object members', () => {
  it('merges collections and settings named like Object.prototype members', () => {
    const remote = parseSnapshot(
      JSON.parse('{"format":"lemma-sync","version":1,"deviceId":"b","createdAt":1,"collections":{"toString":[{"id":"x","updated":1}],"constructor":[]},"settings":{"constructor":5,"__proto__":{"x":1}},"settingsUpdated":{"constructor":3}}'),
    );
    // Used to throw "function is not iterable" (local.collections.toString is Object.prototype.toString).
    const { merged, changes } = merge(emptySnapshot('a'), remote);
    expect(Object.keys(merged.collections).sort()).toEqual(['constructor', 'toString']);
    expect(merged.collections.toString).toEqual([{ id: 'x', updated: 1 }]);
    expect(Object.getPrototypeOf(merged.settings)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(merged.settings))).toEqual({ constructor: 5, ['__proto__']: { x: 1 } });
    expect(changes.settings.sort()).toEqual(['__proto__', 'constructor']);
    expect(merge(merged, merged).merged).toEqual(merged);
  });
});
