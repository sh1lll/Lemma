/**
 * Lemma was called OMNIMATH before. These are the old names, in one place, so data saved under them still opens:
 * settings, history and notes in the browser, backup files, and data on a sync server. Nothing new is ever written
 * under them. Once every device has opened Lemma once and old backups have been re-made, delete this file and its
 * uses (search for LEGACY): the web app's legacy.ts, readHeader below, the sync server, and sync.ts.
 */
export const LEGACY = {
  /** localStorage keys: "omnimath.history.v1" is now "lemma.history.v1"; "omnimath:last-board" → "lemma:last-board". */
  storagePrefixes: ['omnimath.', 'omnimath:'],
  /** IndexedDB databases (whiteboards, graph images, video lessons), by their new names. */
  databases: { 'omnimath-boards': 'lemma-boards', 'omnimath-graphing': 'lemma-graphing', 'omnimath-videos': 'lemma-videos' } as Record<string, string>,
  /** Encrypted backup and sync files began with these 8 bytes. */
  magic: 'OMNIENC1',
  /** The snapshot inside a backup or sync file named its format this. */
  snapshotFormat: 'omnimath-sync',
  /** Backup files were saved as "….omnisync". */
  fileExtension: '.omnisync',
  /** The sync-server account ID was derived with this salt. */
  syncIdSalt: 'omnimath/sync-server-id/v1',
} as const;
