import { createSyncServer, DEFAULT_ORIGINS } from './server.ts';

/** Entry point. Configuration comes from the environment (see README.md). */
const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const server = createSyncServer({
  dataDir: env.DATA_DIR ?? './data',
  allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS,
  maxBlobBytes: num(env.MAX_BLOB_BYTES, 10 * 1024 * 1024),
  rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 120),
  createsPerHour: num(env.CREATES_PER_HOUR, 10),
  maxSpaces: num(env.MAX_SPACES, 80),
  maxInflightBytes: num(env.MAX_INFLIGHT_BYTES, 64 * 1024 * 1024),
  expireDays: num(env.EXPIRE_DAYS, 180),
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  log: env.LOG === '0' ? undefined : (line) => console.log(`${new Date().toISOString()} ${line}`),
});

const port = num(env.PORT, 8787);
const host = env.HOST ?? '0.0.0.0';
server.listen(port, host, () => console.log(`lemma-sync listening on http://${host}:${port} (data: ${server.store.dir})`));

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
