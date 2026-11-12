// electron-builder afterPack: keeps only the native model binaries the packaged architecture can load. File
// patterns can't depend on the architecture being built, so the Mac arm64 binary would also land in the Intel app,
// where it can't run (the native runtime has no Intel Mac build; the app uses its in-browser model there).
const fs = require('node:fs');
const path = require('node:path');

const ARCH = { 1: 'x64', 3: 'arm64' }; // electron-builder's Arch enum

exports.default = async function afterPack(ctx) {
  const arch = ARCH[ctx.arch];
  const res = ctx.electronPlatformName === 'darwin' ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(ctx.appOutDir, 'resources');
  const os = { darwin: 'darwin', win32: 'win32', linux: 'linux' }[ctx.electronPlatformName];
  if (!arch || !os) return;
  // sharp: one folder per platform and architecture (e.g. @img/sharp-darwin-x64); keep only this one's.
  const img = path.join(res, 'app.asar.unpacked', 'node_modules', '@img');
  if (fs.existsSync(img)) for (const d of fs.readdirSync(img)) if (/-(arm64|x64)$/.test(d) && !d.endsWith(`-${os}-${arch}`)) fs.rmSync(path.join(img, d), { recursive: true, force: true });
  const bin = path.join(res, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin');
  if (!fs.existsSync(bin)) return;
  for (const napi of fs.readdirSync(bin)) {
    const dir = path.join(bin, napi, os);
    if (!fs.existsSync(dir)) continue;
    for (const a of fs.readdirSync(dir)) if (a !== arch) fs.rmSync(path.join(dir, a), { recursive: true, force: true });
  }
};
