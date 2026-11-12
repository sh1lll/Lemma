# Lemma extension marketplace

A marketplace with no server: a **signed static index** that any static host can serve (GitHub Pages, Cloudflare
Pages, Netlify, S3, your own nginx), plus a copy bundled into every app build so the Marketplace tab works offline.

```
packages/marketplace/
  extensions/<category>/<id>.json   sources: one extension manifest per file (creators PR here)
  site/index.json                   signed index (generated)
  site/manifests/<id>/<release>.json  every published version, immutable (generated)
  site/bundle.json                  index + manifests, bundled into the app for offline use (generated)
  src/keys.ts                       the public key(s) the app trusts
  .keys/marketplace-ed25519.pem     the private signing key: gitignored, never committed
```

## How the app trusts it

1. The index lists each extension with the **SHA-256 of its manifest** (canonical JSON: sorted keys, no whitespace).
2. The whole index is signed with **Ed25519**. The app ships the public key (`src/keys.ts`) and refuses an index
   signed by any other key, or with any byte changed.
3. Before installing, the app downloads the manifest and checks its hash against the signed index, then validates it
   with the normal extension validator. **Script extensions still go through the usual approval prompt**, listing the
   network hosts they ask for. Formula extensions run no code.
4. **Rollback protection:** the app remembers the newest index it accepted online and refuses an older one.
5. If the online index can't be fetched or verified, the app falls back to its built-in copy and says why.
6. There are **no ratings, reviews or download counts**. They would need a server and moderation; nothing is shown
   rather than anything invented.

Ed25519 in WebCrypto: Chrome/Edge 137+, Firefox 129+, Safari 17+. Older browsers can still use the bundled copy (it
ships inside the app), but they won't load an online index.

## Submitting an extension (creators)

1. Fork the repo and add **one file**: `packages/marketplace/extensions/<category>/<your.id>.json`.
   - Categories: `health-fitness`, `home-diy`, `travel`, `money`, `science-tech`, `cooking`, `numbers-text`.
   - The file name must be the manifest `id` (reverse-DNS style, for example `com.janedoe.tile-cost.json`).
   - Use the normal extension format (export one from **Settings → Extensions**, or see
     `packages/plugin-engine/src/manifest.ts`). `author` and at least one `examples` entry are required. Give
     formula examples an `expect` value: the build runs them and fails if the result differs.
   - Prefer **formula** extensions. Script extensions are reviewed line by line and should request no network hosts
     unless they really need them.
2. Check it locally (no key needed): `npx vitest run packages/marketplace` validates every source and runs the
   examples. To try it in the app, import the file in **Settings → Extensions → Import**.
3. Open a pull request. **Don't** include anything under `site/`; maintainers rebuild and sign it.

To publish a new version, change the file **and bump `release`**. Published versions are immutable: the build
refuses to sign changed content under an existing release number.

### Review checklist (maintainers)

- The extension does something genuinely useful, and its maths is right. Check the formula and the examples by hand.
- Templates are specific enough not to capture everyday input. The test "none captures everyday calculator input"
  and "every example matches only its own extension" must pass.
- Script extensions: read the whole script; the permissions match what it does; no obfuscation.
- The name and description are honest. No claims of endorsement and no fake metrics.

## Rebuilding and signing the index (maintainers)

```sh
npm run build -w @lemma/marketplace      # validate + test + hash + sign → packages/marketplace/site
npm run verify -w @lemma/marketplace     # re-check the signature and every hash
npx vitest run packages/marketplace         # includes "the committed site verifies and matches the sources"
```

Commit `site/` with the change. Rebuilding with no changes keeps the same build time and signature (Ed25519 is
deterministic), so diffs only appear when something changed.

### Hosting

Upload the **contents of `site/`** to any static host, keeping the paths. Serve with
`Access-Control-Allow-Origin: *` (or at least the app's origins) and `Content-Type: application/json`. Then set
`MARKETPLACE_URL` in `apps/web/src/plugins/marketplace.ts` to the full URL of `index.json` and ship an app update.
Until that's set, the app uses the bundled copy only. For testing, a device can point at another index with
`localStorage['lemma.marketplace-url'] = 'https://…/index.json'`; it still has to be signed with a trusted key.

Example: GitHub Pages from a `marketplace` branch, or a Cloudflare Pages project whose build command is empty and
whose output directory is `packages/marketplace/site`.

## Signing key

- **Create** (once): `node packages/marketplace/bin/lemma-marketplace.mjs keygen`. It writes
  `packages/marketplace/.keys/marketplace-ed25519.pem` (mode 600, gitignored) and prints the public key line to add to
  `src/keys.ts`.
- **Keep it secret.** Anyone with it can publish extensions every Lemma install will offer. Keep an offline backup
  (a password manager or an encrypted USB stick). Never commit it, and never paste it into an issue.
- **CI:** store the PEM text as a secret and expose it as `LEMMA_MARKETPLACE_KEY`; the build reads it from there.
- **Rotate or recover:** generate a new key, add its public key to `src/keys.ts` next to the old one, ship an app
  update, start signing with the new key, and remove the old key in a later release. If the key **leaks**, remove it
  from `src/keys.ts` in an urgent app update. Until users update, a leaked key can sign listings they'll accept
  (scripts still need the user's approval).

The key used to sign the current `site/` was generated on the development machine at
`packages/marketplace/.keys/marketplace-ed25519.pem`. Move it somewhere safe, or replace it with your own (keygen →
update `src/keys.ts` → rebuild) before the first public release.
