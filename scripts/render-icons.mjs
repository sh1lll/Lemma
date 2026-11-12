// Renders the app icon (apps/web/public/icon.svg) to every PNG size the web app, desktop app and extension use,
// and the one-colour menu-bar icon (apps/desktop/icons/tray.svg) to its macOS template images.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('apps/web/public/icon.svg', 'utf8');
const tray = readFileSync('apps/desktop/icons/tray.svg', 'utf8');
const targets = [
  ['apps/web/public/icon-192.png', 192],
  ['apps/web/public/icon-512.png', 512],
  ...[32, 64, 192, 512, 1024].map((s) => [`apps/desktop/icons/icon-${s}.png`, s]),
  ['apps/desktop/icons/trayTemplate.png', 16, tray],
  ['apps/desktop/icons/trayTemplate@2x.png', 32, tray],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, art = svg] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${art.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('wrote', file);
}
await browser.close();
