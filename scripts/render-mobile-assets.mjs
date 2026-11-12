// Renders the mobile app's icons and launch screens from the app icon (apps/web/public/icon.svg).
// iOS wants one opaque 1024 px icon; Android wants legacy, round and adaptive (foreground) launcher icons per density.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BG = '#1b1d1c';
const svg = readFileSync('apps/web/public/icon.svg', 'utf8');
// The glyph alone (no rounded tile), for adaptive-icon foregrounds and launch screens.
const glyph = svg.replace(/<rect width="512" height="512"[^>]*\/>/, '');
const res = 'apps/mobile/android/app/src/main/res';
const size = (f) => execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f], { encoding: 'utf8' }).match(/\d+/g).slice(-2).map(Number);

const browser = await chromium.launch();
const page = await browser.newPage();
async function draw(file, w, h, { art, scale, bg, round }) {
  await page.setViewportSize({ width: w, height: h });
  const s = Math.round(Math.min(w, h) * scale);
  const tile = round ? `border-radius:50%;overflow:hidden;width:${s}px;height:${s}px;background:${BG}` : '';
  await page.setContent(
    `<html><body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${bg ?? 'transparent'}">` +
      `<div style="${tile}">${art.replace('<svg ', `<svg width="${s}" height="${s}" style="display:block" `)}</div></body></html>`,
  );
  writeFileSync(file, await page.screenshot({ omitBackground: !bg, clip: { x: 0, y: 0, width: w, height: h } }));
}

// iOS: opaque, full bleed (the system rounds the corners).
await draw('apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024, 1024, { art: glyph, scale: 1, bg: BG });
for (const n of ['', '-1', '-2']) await draw(`apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732${n}.png`, 2732, 2732, { art: glyph, scale: 0.18, bg: BG });

// Android launcher icons.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const legacy = Math.round(48 * k);
  await draw(`${res}/mipmap-${d}/ic_launcher.png`, legacy, legacy, { art: svg, scale: 1 });
  await draw(`${res}/mipmap-${d}/ic_launcher_round.png`, legacy, legacy, { art: glyph, scale: 1, round: true });
  // Adaptive foreground: 108 dp canvas, artwork inside the 66 dp safe zone.
  const fg = Math.round(108 * k);
  await draw(`${res}/mipmap-${d}/ic_launcher_foreground.png`, fg, fg, { art: glyph, scale: 0.6 });
}
writeFileSync(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG.toUpperCase()}</color>\n</resources>\n`);

// Android launch screens, every orientation and density, at their existing sizes.
for (const dir of ['drawable', ...['port', 'land'].flatMap((o) => Object.keys(densities).map((d) => `drawable-${o}-${d}`))]) {
  const f = `${res}/${dir}/splash.png`;
  const [w, h] = size(f);
  await draw(f, w, h, { art: glyph, scale: 0.28, bg: BG });
}
await browser.close();
console.log('mobile icons and launch screens written');
