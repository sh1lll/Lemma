import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, LEGACY, MAGIC } from '../src';

// A backup made before the rename (old magic, made by the old engine kept as a fixture) still opens; new files
// get the new magic.
const fixture = new URL('./fixtures/legacy-backup.bin', import.meta.url);

describe('files from before the rename', () => {
  it('a backup with the old magic decrypts', async () => {
    const { readFileSync } = await import('node:fs');
    const bytes = new Uint8Array(readFileSync(fixture));
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe(LEGACY.magic);
    const snap = await decrypt(bytes, 'purple elephant tuesday 42');
    expect(JSON.stringify(snap.collections)).toContain('from-before');
  });
  it('new files start with the new magic', async () => {
    const out = await encrypt({ v: 1, deviceId: 'd', createdAt: 0, collections: {} } as never, 'purple elephant tuesday 42');
    expect(new TextDecoder().decode(out.slice(0, 8))).toBe(MAGIC);
  });
});
