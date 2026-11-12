// The AI library needs sharp, whose native files come per platform, and npm only installs this machine's. Before
// building every desktop target, fetch the ones each target needs (at sharp's own pinned versions).
// Only for `npm run dist` (every platform from one Mac). CI builds each platform on its own machine instead
// (.github/workflows/desktop.yml), where plain `npm ci` installs the right files. --no-save keeps the lockfile clean.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(require.resolve('sharp')), '..', '..', '..');
const sharp = JSON.parse(readFileSync(path.join(root, 'node_modules', 'sharp', 'package.json'), 'utf8'));
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'];
const wanted = Object.entries(sharp.optionalDependencies)
  .filter(([name]) => TARGETS.some((t) => name === `@img/sharp-${t}` || name === `@img/sharp-libvips-${t}`))
  .map(([name, v]) => `${name}@${v}`);
execFileSync('npm', ['install', '--no-save', '--force', '--prefer-offline', '--ignore-scripts', ...wanted], { cwd: root, stdio: 'inherit' });
console.log(`sharp binaries for ${TARGETS.join(', ')} are in place`);
