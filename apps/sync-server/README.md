# Lemma sync server (optional)

A small, self-hostable server that lets your devices sync automatically (phone ↔ computer) without a shared
folder. It is **zero-knowledge**: it stores only the file your device already encrypted with your passphrase
(the same `LEMMENC1` container as an encrypted backup), and it never sees the passphrase, the key or any plaintext.

- Plain Node (`node:http`), no dependencies, about 400 lines.
- One file per sync space on disk, written atomically (temp file → fsync → rename).
- Optimistic concurrency with ETags, so two devices never overwrite each other.
- Limits: blob size, requests per minute per IP, new sync spaces per hour per IP, number of sync spaces, upload bytes held in memory.
- CORS only for the app's own origins.

## How it works

```
device                                              server
──────                                              ──────
passphrase ──PBKDF2-SHA-256, 600k rounds,
             salt "lemma/sync-server-id/v2 <server URL>"──► sync ID (64 hex)  +  access token (64 hex)
GET  /v1/sync/<id>      Authorization: Bearer <token>   → 200 blob + ETag   (or 404: nothing yet)
decrypt (passphrase) → merge with this device (per record, last edit wins, tombstones)
encrypt (passphrase, fresh random salt + IV)
PUT  /v1/sync/<id>      If-Match: <ETag>  (or If-None-Match: * to create)
                        → 200/201 new ETag
                        → 412 another device wrote first: download again, merge, retry
```

- The **sync ID and token** come from the passphrase with their own salt, which includes the server's address,
  separate from the random per-file salt that derives the encryption key. So the same passphrase on two servers is
  two unrelated spaces, and one precomputed dictionary doesn't work against every server. Spaces made under the
  older fixed salts are found on first sync and moved to the new ID (the old copy stays until deleted).
  New spaces need a strong passphrase (at least 16 characters and rated "Good"). Knowing them does not help decrypt; guessing the passphrase from
  them costs 600,000 PBKDF2 rounds per guess, the same as attacking the encrypted file.
- The server stores only the **SHA-256 of the token** (set by the first upload) and checks it on every request,
  so someone who sees a sync ID in a log can't read, overwrite or delete the data.
- Bodies that aren't Lemma encrypted containers are refused (415), so the server can't be used as general storage.
- A wrong passphrase leads to a *different*, empty sync space. The app asks before starting a new one
  ("This server has nothing stored for this passphrase yet"), which catches typos.
- Tampering on the server is detected by AES-GCM on the device; the device then changes nothing.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `{"ok":true}`; not rate-limited |
| GET | `/v1/sync/:id` | 200 + `ETag`, 304 with matching `If-None-Match`, 404 if empty, 403 wrong token |
| PUT | `/v1/sync/:id` | `If-None-Match: *` → 201; `If-Match: <etag>` → 200; 412 on mismatch; 428 with neither; 413 too large; 415 not an encrypted container; 429 too many new spaces from this IP; 503 too many uploads in progress; 507 server full |
| DELETE | `/v1/sync/:id` | 204; optional `If-Match` |

Every `/v1` request needs `Authorization: Bearer <64 hex>`. 429 responses carry `Retry-After`.

## Configuration (environment)

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `0.0.0.0` | |
| `DATA_DIR` | `./data` | Where blobs live. Put it on a persistent volume and back it up (it's already encrypted). |
| `ALLOWED_ORIGINS` | `https://lemma.app,capacitor://localhost,https://localhost,lemma://app,http://localhost:5178,http://localhost:4178` | Comma-separated exact origins. Add the origin you host the web app on. `*` allows any (safe: auth is a bearer token, never a cookie). |
| `MAX_BLOB_BYTES` | `10485760` (10 MB) | |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per client IP, token bucket. |
| `CREATES_PER_HOUR` | `10` | New sync spaces per client IP per hour (separate from, and much stricter than, the request limit). |
| `MAX_SPACES` | `80` | Sync spaces (one per passphrase) this server will hold. 80 × `MAX_BLOB_BYTES` fits a 1 GB disk; raise it along with the disk. |
| `EXPIRE_DAYS` | `180` | A sync space nobody has read or written for this many days is deleted (checked at start and daily). `0` keeps spaces forever. |
| `MAX_INFLIGHT_BYTES` | `67108864` (64 MB) | Upload bytes buffered in memory across all requests; beyond it uploads get 503 + `Retry-After`. |
| `TRUST_PROXY` | off | `1` behind a reverse proxy/Fly/Render, so the client IP comes from `Fly-Client-IP` or the last `X-Forwarded-For` entry (the one your proxy added). Leave off when exposed directly, or clients can spoof their IP. |
| `LOG` | on | `0` disables request logs. Logs never contain sync IDs or tokens. |

App origins: the iOS app is `capacitor://localhost`, the Android app `https://localhost`, the desktop app
`lemma://app`, the web app whatever origin you serve it from.

## Run locally

```sh
npm start -w @lemma/sync-server          # http://localhost:8787, data in apps/sync-server/data
curl localhost:8787/healthz
```

Then in Lemma: **Settings → Sync & backup → Sync server**: `http://localhost:8787`, **Sync now**, and pick
**Automatic: every N min**. Plain `http://` is only accepted for `localhost`; use HTTPS everywhere else.

Requires Node ≥ 22.18 (runs the TypeScript sources directly).

## Deploy

The server must sit behind **HTTPS** (browsers block mixed content, and the token travels in a header).

### Docker (any host)

```sh
cd apps/sync-server
docker build -t lemma-sync .
docker run -d --name lemma-sync -p 8787:8787 -v lemmasync:/data \
  -e ALLOWED_ORIGINS="https://your-web-app.example,capacitor://localhost,https://localhost,lemma://app" \
  lemma-sync
```

### Fly.io

```sh
cd apps/sync-server
cp fly.toml.example fly.toml        # set `app` and the region
fly launch --no-deploy --copy-config
fly volumes create lemmasync_data --size 1
fly deploy
```

Fly terminates TLS; `TRUST_PROXY=1` is set in the example so rate limits apply per real client.
Run a single machine (the per-space lock is in-process; see Limits).

### Render

New → Web Service → this repo, **Root directory** `apps/sync-server`, **Runtime** Docker. Add a **Disk** mounted
at `/data` (1 GB fits the default limits), set `TRUST_PROXY=1` and `ALLOWED_ORIGINS`, health check path `/healthz`. Keep the
instance count at 1.

### A VPS (systemd + Caddy)

```sh
sudo useradd --system --home /var/lib/lemmasync lemmasync && sudo mkdir -p /var/lib/lemmasync && sudo chown lemmasync /var/lib/lemmasync
sudo cp -r apps/sync-server /opt/lemma-sync
```

`/etc/systemd/system/lemma-sync.service`:

```ini
[Service]
User=lemmasync
WorkingDirectory=/opt/lemma-sync
Environment=PORT=8787 HOST=127.0.0.1 DATA_DIR=/var/lib/lemmasync TRUST_PROXY=1
Environment=ALLOWED_ORIGINS=https://your-web-app.example,capacitor://localhost,https://localhost,lemma://app
ExecStart=/usr/bin/node src/main.ts
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/lemmasync

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile` (automatic HTTPS):

```
sync.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

`sudo systemctl enable --now lemma-sync && sudo systemctl reload caddy`.

## Tests

```sh
npx vitest run --config apps/sync-server/vitest.config.ts
```

They start real servers on ephemeral ports and drive them with the app's own client (`apps/web/src/sync.ts`):
two-device round trip, a forced 412 race and retry, 12 parallel writers (exactly one wins), wrong passphrase,
wrong token, a bit flipped on disk, restart persistence, size/format/precondition/space limits, rate limiting and
CORS. The browser round trip is `e2e/sync-server.spec.ts`.

## Limits

- **One process per data directory.** Writes are serialised per sync space with an in-process lock; running several
  instances on shared storage could let two writes race between the ETag check and the rename. Scale up, not out.
- **No accounts.** The passphrase *is* the identity. Losing it loses the data (by design), and changing it means
  starting a new sync space (old data stays until deleted).
- **The server can delete or roll back data** (it can't read or forge it). Devices keep their own copy, and the next
  sync from any device re-uploads the merged data.
- **Metadata is visible to the host:** blob size, update times and client IPs.
- Tombstones are kept for 90 days, as with folder sync.
